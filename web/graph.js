// ComfyUI Prettifier - LiteGraph adapter.
// Reads the live graph into the engine's model, applies results, and keeps
// snapshots so a prettify can be undone or previewed.

import { computeLayout, STAGE_GROUP_COLORS, STAGE_NODE_COLORS, stageOf } from "./layout.js";
import { planNodeColors } from "./colors.js";
import { computeRenames } from "./rename.js";
import { isVariableNode, variableNeighbor } from "./variables.js";

const LG = () => globalThis.LiteGraph || {};
export const titleHeight = () => LG().NODE_TITLE_HEIGHT ?? 30;

export function activeGraph(app) {
  return app.canvas?.graph ?? app.graph;
}

export function graphNodes(graph) {
  return [...(graph?._nodes ?? graph?.nodes ?? [])];
}

export function graphGroups(graph) {
  return [...(graph?._groups ?? graph?.groups ?? [])];
}

export function graphLinks(graph) {
  const links = graph?.links;
  if (!links) return [];
  if (typeof links.values === "function") return [...links.values()];
  return Object.values(links).filter(Boolean);
}

export function getLink(graph, id) {
  if (id == null) return null;
  const links = graph.links;
  if (!links) return null;
  if (typeof links.get === "function") return links.get(id);
  return links[id];
}

export function selectedNodes(app) {
  const c = app.canvas;
  if (!c) return [];
  if (c.selected_nodes) return Object.values(c.selected_nodes);
  if (c.selectedItems) return [...c.selectedItems].filter((i) => i && i.id != null && i.pos && i.size && "inputs" in i);
  return [];
}

export function groupRect(g) {
  const b = g._bounding ?? g.bounding;
  if (b) return { x: b[0], y: b[1], w: b[2], h: b[3] };
  return { x: g.pos[0], y: g.pos[1], w: g.size[0], h: g.size[1] };
}

function setGroupRect(g, r) {
  const b = g._bounding ?? g.bounding;
  if (b && typeof b.length === "number" && b.length >= 4) {
    b[0] = r.x;
    b[1] = r.y;
    b[2] = r.w;
    b[3] = r.h;
  }
  try {
    g.pos = [r.x, r.y];
  } catch {}
  try {
    g.size = [r.w, r.h];
  } catch {}
}

function groupCtor(graph) {
  return LG().LGraphGroup ?? globalThis.LGraphGroup ?? graphGroups(graph)[0]?.constructor;
}

export function isNote(node) {
  const t = String(node.type || "");
  return /^(Note|MarkdownNote|PrimitiveNote)$/i.test(t) || /note/i.test(t) && !(node.outputs?.length || node.inputs?.length);
}

function hasLargeContent(node) {
  if (node.imgs?.length || node.images?.length) return true;
  // Output nodes such as Save/Preview Image grow to show results after a run.
  if (node.constructor?.nodeData?.output_node && (node.inputs || []).some((i) => /IMAGE|VIDEO|MASK/.test(String(i?.type)))) return true;
  if (node.animatedImages || node.videoContainer) return true;
  return (node.widgets || []).some(
    (w) => w && (w.element || w.inputEl || w.type === "customtext" || w.type === "MARKDOWN" || w.computeLayoutSize || w.type === "image")
  );
}

let measureCtx = null;
function textWidth(text, font) {
  if (!text) return 0;
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = font || `${LG().NODE_TEXT_SIZE ?? 14}px Arial`;
    return measureCtx.measureText(String(text)).width;
  } catch {
    return String(text).length * 8;
  }
}

function collapsedWidth(n) {
  // The frontend's own formula, with the font the title is drawn in.
  const est = Math.min(n.size[0], textWidth(n.title, n.titleFontStyle) + titleHeight() * 2);
  return Math.max(n._collapsed_width ?? 0, est) || 120;
}

/**
 * The rectangle a node covers on the canvas, title bar included. A collapsed node
 * is only its title bar: node.size still holds the expanded size, so using it
 * would place the node far below (and right of) where it is actually drawn.
 */
export function nodeRect(n, titleH = titleHeight(), pos = n.pos) {
  if (n.flags?.collapsed) return { x: pos[0], y: pos[1] - titleH, w: collapsedWidth(n), h: titleH };
  return { x: pos[0], y: pos[1] - titleH, w: n.size?.[0] ?? 0, h: (n.size?.[1] ?? 0) + titleH };
}

/** Whether the center of the node, as drawn, lies inside the rectangle. */
function centerInside(n, r, titleH, pos) {
  const b = nodeRect(n, titleH, pos);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
}

function fitSize(node) {
  try {
    const s = node.computeSize?.();
    if (s && s[0] > 0 && s[1] >= 0) return [Math.max(s[0], textWidth(node.title) + 50), s[1]];
  } catch {}
  return [node.size[0], node.size[1]];
}

function slotOffsets(node, isInput, titleH) {
  const slots = (isInput ? node.inputs : node.outputs) || [];
  const top = node.pos[1] - titleH;
  return slots.map((_, i) => {
    try {
      const p = node.getConnectionPos?.(isInput, i, [0, 0]);
      if (p && Number.isFinite(p[1])) return p[1] - top;
    } catch {}
    return titleH + (i + 0.7) * (LG().NODE_SLOT_HEIGHT ?? 20);
  });
}

/** Decide which nodes are in scope: "all", "selection", or "auto" (selection if 2+ selected). */
export function resolveScope(app, scope) {
  const graph = activeGraph(app);
  const all = graphNodes(graph);
  const sel = selectedNodes(app);
  if (scope === "selection" || (scope === "auto" && sel.length >= 2)) return { graph, nodes: sel, isSelection: true };
  return { graph, nodes: all, isSelection: false };
}

export function readModel(graph, nodes) {
  const titleH = titleHeight();
  const inScope = new Set(nodes.map((n) => n.id));
  const groups = graphGroups(graph);

  // Group membership: a node belongs to a group if its center, as drawn, is inside it.
  const groupInfo = groups.map((g, index) => ({ g, index, ...groupRect(g) }));
  const membership = new Map();
  for (const n of graphNodes(graph)) {
    const containing = groupInfo
      .filter((g) => centerInside(n, g, titleH))
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .map((g) => g.index);
    membership.set(n.id, containing);
  }
  // Only groups whose members are all in scope are touched.
  let partialGroups = 0;
  const scopeGroups = groupInfo.filter((gi) => {
    const mem = graphNodes(graph).filter((n) => membership.get(n.id).includes(gi.index));
    const whole = mem.length > 0 && mem.every((n) => inScope.has(n.id));
    // A group that holds some of the nodes in scope, and others besides.
    if (!whole && mem.some((n) => inScope.has(n.id))) partialGroups++;
    return whole;
  });

  const modelNodes = nodes.map((n) => {
    const collapsed = !!n.flags?.collapsed;
    const [fw, fh] = fitSize(n);
    const cw = collapsedWidth(n);
    // Variable nodes are grouped with the node they sit next to.
    const like = isVariableNode(n) ? variableNeighbor(graph, n) : null;
    return {
      id: n.id,
      type: n.type ?? n.comfyClass,
      title: n.title ?? "",
      typeName: defaultTitle(n),
      color: n.color,
      category: nodeCategory(like ?? n),
      stageLike: like ? { type: like.type ?? like.comfyClass, category: nodeCategory(like), isOutput: !!(like.constructor?.nodeData?.output_node ?? like.isOutputNode), isNote: false } : undefined,
      isOutput: !!(n.constructor?.nodeData?.output_node ?? n.isOutputNode),
      isNote: isNote(n),
      pinned: !!(n.pinned ?? n.flags?.pinned),
      collapsed,
      x: n.pos[0],
      y: n.pos[1],
      w: collapsed ? cw : n.size[0],
      h: collapsed ? 0 : n.size[1],
      fitW: collapsed ? cw : fw,
      fitH: collapsed ? 0 : fh,
      hasLargeContent: hasLargeContent(n),
      inSlots: collapsed ? (n.inputs || []).map(() => titleH / 2) : slotOffsets(n, true, titleH),
      outSlots: collapsed ? (n.outputs || []).map(() => titleH / 2) : slotOffsets(n, false, titleH),
      groups: membership.get(n.id) ?? [],
    };
  });

  const edges = [];
  for (const n of nodes) {
    (n.inputs || []).forEach((input, toSlot) => {
      const link = getLink(graph, input?.link);
      if (!link) return;
      const from = link.origin_id ?? link[1];
      if (!inScope.has(from)) return;
      edges.push({ from, to: n.id, fromSlot: link.origin_slot ?? link[2] ?? 0, toSlot });
    });
  }

  return {
    titleH,
    nodes: modelNodes,
    edges,
    partialGroups,
    groups: scopeGroups.map((gi) => ({
      index: gi.index,
      title: gi.g.title,
      color: gi.g.color,
      fontSize: gi.g.font_size,
      x: gi.x,
      y: gi.y,
      w: gi.w,
      h: gi.h,
    })),
  };
}

// --- snapshots ----------------------------------------------------------------

export function takeSnapshot(graph) {
  return {
    graph,
    nodes: graphNodes(graph).map((n) => ({
      node: n,
      pos: [n.pos[0], n.pos[1]],
      size: [n.size[0], n.size[1]],
      color: n.color,
      bgcolor: n.bgcolor,
      title: n.title,
      collapsed: !!n.flags?.collapsed,
      inLabels: (n.inputs || []).map((i) => i?.label),
      outLabels: (n.outputs || []).map((i) => i?.label),
    })),
    groups: graphGroups(graph).map((g) => ({ group: g, data: safeSerialize(g) })),
  };
}

function safeSerialize(g) {
  try {
    return JSON.parse(JSON.stringify(g.serialize()));
  } catch {
    const r = groupRect(g);
    return { title: g.title, bounding: [r.x, r.y, r.w, r.h], color: g.color, font_size: g.font_size };
  }
}

export function restoreSnapshot(snap) {
  const graph = snap.graph;
  // Nodes Prettifier added after the snapshot (the summary note) are removed again.
  const known = new Set(snap.nodes.map((s) => s.node));
  for (const n of graphNodes(graph)) if (!known.has(n) && n.properties?.prettifierSummary) graph.remove(n);
  for (const s of snap.nodes) {
    const n = s.node;
    if (!graphNodes(graph).includes(n)) continue;
    if (!!n.flags?.collapsed !== s.collapsed) {
      if (typeof n.collapse === "function") n.collapse(true);
      else (n.flags ??= {}).collapsed = s.collapsed;
    }
    setNodeSize(n, s.size);
    n.pos[0] = s.pos[0];
    n.pos[1] = s.pos[1];
    n.color = s.color;
    n.bgcolor = s.bgcolor;
    if (s.title !== undefined) n.title = s.title;
    (n.inputs || []).forEach((slot, i) => slot && setSlotLabel(slot, s.inLabels?.[i]));
    (n.outputs || []).forEach((slot, i) => slot && setSlotLabel(slot, s.outLabels?.[i]));
  }
  // Remove groups that did not exist, restore those that did.
  const original = new Set(snap.groups.map((s) => s.group));
  for (const g of graphGroups(graph)) if (!original.has(g)) graph.remove(g);
  const present = new Set(graphGroups(graph));
  for (const s of snap.groups) {
    if (!present.has(s.group)) graph.add(s.group);
    try {
      s.group.configure(s.data);
    } catch {
      const b = s.data.bounding;
      setGroupRect(s.group, { x: b[0], y: b[1], w: b[2], h: b[3] });
      s.group.color = s.data.color;
      s.group.title = s.data.title;
    }
  }
  graph.setDirtyCanvas?.(true, true);
}

function setNodeSize(n, size) {
  if (typeof n.setSize === "function") n.setSize([size[0], size[1]]);
  else {
    n.size[0] = size[0];
    n.size[1] = size[1];
  }
}

// --- renaming -----------------------------------------------------------------

function setSlotLabel(slot, label) {
  if (label == null || label === "") delete slot.label;
  else slot.label = label;
}

export function isSubgraphNode(n) {
  return !!n && ((typeof n.isSubgraphNode === "function" && n.isSubgraphNode()) || (!!n.subgraph && typeof n.subgraph === "object" && Array.isArray(n.subgraph.inputs)));
}

export function nodeCategory(n) {
  return n.constructor?.nodeData?.category ?? n.constructor?.category ?? n.category ?? "";
}

export function defaultTitle(n) {
  return n.constructor?.nodeData?.display_name || n.constructor?.title || n.type || "";
}

/** Apply the renaming rules to the given nodes. Returns { titles, labels } counts. */
export function renameNodes(graph, nodes, opts) {
  if (opts.nodeTitleMode === "keep" && opts.slotLabelMode === "keep") return { titles: 0, labels: 0 };
  nodes = nodes.filter((n) => !isVariableNode(n)); // their titles carry the variable name
  const titleH = titleHeight();
  const groups = graphGroups(graph).map((g) => ({ g, ...groupRect(g) }));
  const model = nodes.map((n) => {
    const group = groups
      .filter((g) => centerInside(n, g, titleH))
      .sort((a, b) => a.w * a.h - b.w * b.h)[0];
    const widgets = {};
    for (const w of n.widgets || []) if (w?.name && (typeof w.value === "string" || typeof w.value === "number")) widgets[w.name] = w.value;
    const category = nodeCategory(n);
    const type = n.type ?? n.comfyClass;
    return {
      id: n.id,
      title: n.title ?? "",
      defaultTitle: defaultTitle(n),
      type,
      category,
      stage: stageOf({ type, category, isNote: isNote(n), isOutput: !!n.constructor?.nodeData?.output_node }),
      group: group?.g.title ?? "",
      x: n.pos[0],
      y: n.pos[1],
      widgets,
      inputs: (n.inputs || []).map((slot) => {
        const link = getLink(graph, slot?.link);
        const sourceId = link ? link.origin_id ?? link[1] : null;
        const sourceSlot = link ? link.origin_slot ?? link[2] : null;
        // Inside a subgraph, an input can be fed by the subgraph's own input panel.
        const panel = link && graph.inputNode && sourceId == graph.inputNode.id ? graph.inputs?.[sourceSlot] : null;
        const panelName = panel ? panel.label || panel.localized_name || panel.name || "" : undefined;
        return {
          name: slot?.localized_name || slot?.name || "",
          type: slot?.type,
          label: slot?.label,
          connected: !!link,
          isWidget: !!slot?.widget,
          sourceId,
          sourceSlot,
          sourceTitle: panelName,
          sourceSlotName: panelName,
        };
      }),
      outputs: (n.outputs || []).map((slot) => ({
        name: slot?.localized_name || slot?.name || "",
        type: slot?.type,
        label: slot?.label,
        connected: !!slot?.links?.length,
      })),
    };
  });
  const res = computeRenames(model, opts);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let labels = 0;
  for (const [id, title] of res.titles) byId.get(id).title = title;
  for (const [side, map] of [["inputs", res.inputs], ["outputs", res.outputs]]) {
    for (const [id, list] of map) {
      // A subgraph node's connectors follow the subgraph's own inputs / outputs.
      if (opts.manageSubgraphSlots && isSubgraphNode(byId.get(id))) continue;
      const slots = byId.get(id)[side] || [];
      list.forEach((label, i) => {
        if (label === undefined || !slots[i]) return;
        setSlotLabel(slots[i], label);
        labels++;
      });
    }
  }
  graph.setDirtyCanvas?.(true, true);
  return { titles: res.titles.size, labels };
}

/**
 * Link ends and node rectangles, either where they are now (opts omitted) or
 * where a layout with the given options would put them. Used to judge which links
 * are long or blocked before anything moves.
 * Returns { links: [{ id, from, to, sx, sy, tx, ty }], boxes: [{ id, x, y, w, h }] }.
 */
export function linkGeometry(graph, nodes, opts) {
  const model = readModel(graph, nodes);
  const th = model.titleH ?? titleHeight();
  const placed = new Map(model.nodes.map((m) => [m.id, { ...m }]));
  if (opts) {
    try {
      for (const r of computeLayout(model, opts).nodes) {
        const p = placed.get(r.id);
        if (p) Object.assign(p, { x: r.x, y: r.y, w: r.w, h: p.collapsed ? 0 : r.h });
      }
    } catch (err) {
      console.warn("[Prettifier] could not predict the layout", err);
    }
  }
  const boxes = [...placed.values()].map((p) => ({ id: p.id, x: p.x, y: p.y - th, w: p.w, h: p.h + th }));
  const links = [];
  for (const n of nodes) {
    (n.inputs || []).forEach((input, toSlot) => {
      const link = getLink(graph, input?.link);
      if (!link) return;
      const a = placed.get(link.origin_id), b = placed.get(n.id);
      if (!a || !b) return;
      links.push({
        id: link.id,
        from: a.id,
        to: b.id,
        sx: a.x + a.w,
        sy: a.y - th + (a.outSlots?.[link.origin_slot] ?? th / 2),
        tx: b.x,
        ty: b.y - th + (b.inSlots?.[toSlot] ?? th / 2),
      });
    });
  }
  return { links, boxes };
}

// --- apply --------------------------------------------------------------------

// The animation currently running, if any. Holding the change tracker open while it
// runs keeps half-way positions out of ComfyUI's undo history.
let active = null;

export function changeTracker(app) {
  return app.extensionManager?.workflow?.activeWorkflow?.changeTracker ?? app.workflowManager?.activeWorkflow?.changeTracker ?? null;
}

// How many times the layout may be re-run on its own result before it is taken as is.
const SETTLE_PASSES = 8;

const r1 = (v) => Math.round(v * 10) / 10;

/** Everything the layout reads back from the graph that it also writes. */
function layoutState(graph, nodes) {
  const ns = nodes.map((n) => `${n.id}:${r1(n.pos[0])},${r1(n.pos[1])},${r1(n.size?.[0] ?? 0)},${r1(n.size?.[1] ?? 0)}`);
  const gs = graphGroups(graph).map((g) => {
    const r = groupRect(g);
    return `${g.title}:${r1(r.x)},${r1(r.y)},${r1(r.w)},${r1(r.h)},${g.color ?? ""},${g.font_size ?? ""}`;
  });
  return ns.join("|") + "#" + gs.join("|");
}

/** Put a layout result on the graph: node sizes and positions, and the groups. */
function placeResult(graph, res, byId, resized) {
  for (const r of res.nodes) {
    const n = byId.get(r.id);
    if (!n || !r.moved) continue;
    if (resized && !n.flags?.collapsed) setNodeSize(n, [r.w, r.h]);
    n.pos[0] = r.x;
    n.pos[1] = r.y;
  }
  const groups = graphGroups(graph);
  for (const u of res.groupUpdates) {
    const g = groups[u.index];
    if (!g) continue;
    setGroupRect(g, u);
    if (u.color !== undefined) g.color = u.color;
    if (u.fontSize) g.font_size = u.fontSize;
  }
  for (const idx of res.groupRemovals) {
    const g = groups[idx];
    if (g) graph.remove(g);
  }
  const Ctor = groupCtor(graph);
  for (const ng of res.newGroups) {
    if (!Ctor) break;
    const g = new Ctor(ng.title);
    if (ng.fontSize) g.font_size = ng.fontSize;
    if (ng.color) g.color = ng.color;
    graph.add(g);
    setGroupRect(g, ng);
  }
}

/**
 * Run the layout on the given graph/nodes with the given options and apply it.
 * Returns { moved, groups } counts.
 *
 * The layout looks at where things are now (to keep their order, and to find the
 * groups), so its own result can make it choose differently the next time. It is
 * therefore re-run on its result until that no longer changes anything, so that
 * prettifying an already prettified workflow leaves it as it is.
 */
export function prettifyNodes(app, graph, nodes, opts) {
  cancelAnimation();
  let model = readModel(graph, nodes);
  if (!model.nodes.length) return { moved: 0, groups: 0 };
  const layoutOpts = opts.paletteColors?.group ? { ...opts, stageGroupColors: opts.paletteColors.group } : opts;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resized = opts.widthMode !== "keep" || opts.heightMode !== "keep";

  const tracker = opts.noHistory ? null : changeTracker(app);
  tracker?.beforeChange?.();
  try {
    const start = new Map(nodes.map((n) => [n.id, [n.pos[0], n.pos[1]]]));
    const seen = [layoutState(graph, nodes)];
    let res = computeLayout(model, layoutOpts);
    let groupCount = 0;
    let target = null; // the state to stop at once the layout is found to go in circles
    for (let pass = 1; ; pass++) {
      placeResult(graph, res, byId, resized);
      groupCount = Math.max(groupCount, res.newGroups.length + res.groupUpdates.length);
      const state = layoutState(graph, nodes);
      if (pass >= SETTLE_PASSES || opts.settle === false) break;
      if (target !== null) {
        if (state === target) break;
      } else {
        if (state === seen[seen.length - 1]) break; // settled
        const at = seen.indexOf(state);
        if (at >= 0) {
          // Going in circles: always stop at the same one of the states in the circle.
          target = seen.slice(at).reduce((a, b) => (b < a ? b : a));
          if (state === target) break;
        }
      }
      seen.push(state);
      model = readModel(graph, nodes);
      res = computeLayout(model, layoutOpts);
    }
    return applyLayout(app, graph, nodes, opts, model, res, byId, start, groupCount, tracker);
  } catch (err) {
    // Never leave ComfyUI's undo history held open.
    try {
      tracker?.afterChange?.();
    } catch {}
    throw err;
  }
}

/** Finish a layout that is already on the graph: colors, follow-up passes, animation, history. */
function applyLayout(app, graph, nodes, opts, model, res, byId, start, groupCount, tracker) {
  const moves = [];
  for (const r of res.nodes) {
    const n = byId.get(r.id);
    if (!n || !r.moved) continue;
    moves.push({ n, from: start.get(r.id) ?? [n.pos[0], n.pos[1]], to: [n.pos[0], n.pos[1]] });
  }

  // Node colors, now that the groups have their final place and color.
  if ((opts.colorNodes && opts.colorNodes !== "keep") || opts.nodeColorRules) {
    const info = new Map(model.nodes.map((n) => [n.id, n]));
    const target = new Map(moves.map((m) => [m.n.id, m.to]));
    const rects = graphGroups(graph).map((g) => ({ color: g.color, ...groupRect(g) }));
    const described = res.nodes
      .filter((r) => r.moved && byId.has(r.id))
      .map((r) => {
        const n = byId.get(r.id), i = info.get(r.id) ?? {};
        const at = target.get(r.id) ?? n.pos;
        // The innermost group that holds the node.
        const holder = rects.filter((g) => centerInside(n, g, model.titleH, at)).sort((a, b) => a.w * a.h - b.w * b.h)[0];
        return { id: r.id, type: i.type ?? n.type, title: n.title, category: i.category, stage: r.stage, groupColor: holder?.color };
      });
    const palette = opts.paletteColors ?? { group: STAGE_GROUP_COLORS, node: STAGE_NODE_COLORS };
    for (const [id, c] of planNodeColors(described, opts, palette)) {
      const n = byId.get(id);
      if (c) {
        n.color = c.color;
        n.bgcolor = c.bgcolor;
      } else {
        delete n.color;
        delete n.bgcolor;
      }
    }
  }

  // Passes that need final positions (reroute cleanup) run with nodes placed, before any animation.
  if (opts.onPlaced) {
    try {
      opts.onPlaced();
    } catch (err) {
      console.warn("[Prettifier] post-layout pass failed", err);
    }
  }

  let released = false;
  const finish = () => {
    if (released) return;
    released = true;
    if (active?.finish === finish) active = null;
    for (const m of moves) {
      m.n.pos[0] = m.to[0];
      m.n.pos[1] = m.to[1];
    }
    graph.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    if (opts.fitView) fitView(app, graph, opts.isSelection ? moves.map((m) => m.n) : null);
    if (tracker?.afterChange) tracker.afterChange();
    else if (!opts.noHistory) notifyChanged(app, graph);
  };

  if (opts.animate && opts.animationMs > 0 && moves.length && typeof requestAnimationFrame === "function") {
    active = { finish };
    for (const m of moves) {
      m.n.pos[0] = m.from[0];
      m.n.pos[1] = m.from[1];
    }
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const step = (now) => {
      if (released) return; // finished early (cancelled or superseded)
      const t = Math.min(1, (now - start) / opts.animationMs);
      const k = ease(t);
      for (const m of moves) {
        m.n.pos[0] = m.from[0] + (m.to[0] - m.from[0]) * k;
        m.n.pos[1] = m.from[1] + (m.to[1] - m.from[1]) * k;
      }
      app.canvas?.setDirty?.(true, true);
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
  } else finish();

  return { moved: moves.length, groups: groupCount };
}

/** Let ComfyUI's undo history know the graph changed (so Ctrl+Z works). */
export function notifyChanged(app, graph) {
  try {
    graph?.change?.();
  } catch {}
  const t = changeTracker(app);
  try {
    if (t?.captureCanvasState) t.captureCanvasState();
    else t?.checkState?.();
  } catch {}
}

/** Jump a running animation to its end. */
export function cancelAnimation() {
  active?.finish();
  active = null;
}

// --- view ---------------------------------------------------------------------

export function fitView(app, graph, onlyNodes) {
  const canvas = app.canvas;
  if (!canvas?.ds) return;
  const titleH = titleHeight();
  const nodes = onlyNodes ?? graphNodes(graph);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, w, h) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const n of nodes) {
    const b = nodeRect(n, titleH);
    add(b.x, b.y, b.w, b.h);
  }
  if (!onlyNodes) for (const g of graphGroups(graph)) {
    const r = groupRect(g);
    add(r.x, r.y, r.w, r.h);
  }
  if (!isFinite(x0)) return;
  const bounds = [x0, y0, x1 - x0, y1 - y0];
  try {
    if (typeof canvas.ds.fitToBounds === "function") {
      canvas.ds.fitToBounds(bounds, { zoom: 0.9 });
      canvas.setDirty?.(true, true);
      return;
    }
  } catch {}
  const el = canvas.canvas;
  const cw = el?.clientWidth || el?.width || 1200;
  const ch = el?.clientHeight || el?.height || 800;
  const margin = 60;
  const scale = Math.max(0.1, Math.min(1.25, Math.min(cw / (x1 - x0 + margin * 2), ch / (y1 - y0 + margin * 2))));
  canvas.ds.scale = scale;
  canvas.ds.offset[0] = cw / (2 * scale) - (x0 + x1) / 2;
  canvas.ds.offset[1] = ch / (2 * scale) - (y0 + y1) / 2;
  canvas.setDirty?.(true, true);
}

// --- alignment tools ------------------------------------------------------------

export function alignNodes(app, mode) {
  const nodes = selectedNodes(app);
  if (nodes.length < 2) return false;
  const graph = activeGraph(app);
  const titleH = titleHeight();
  // Work with what is drawn: a collapsed node is only its title bar.
  const box = new Map(nodes.map((n) => [n, nodeRect(n, titleH)]));
  const W = (n) => box.get(n).w, H = (n) => box.get(n).h; // H includes the title bar
  const L = Math.min(...nodes.map((n) => n.pos[0]));
  const R = Math.max(...nodes.map((n) => n.pos[0] + W(n)));
  const T = Math.min(...nodes.map((n) => n.pos[1] - titleH));
  const B = Math.max(...nodes.map((n) => n.pos[1] - titleH + H(n)));
  const gap = (axis) => {
    const sorted = [...nodes].sort((a, b) => a.pos[axis] - b.pos[axis]);
    const len = (n) => (axis ? H(n) : W(n));
    const total = sorted.reduce((s, n) => s + len(n), 0);
    const span = axis ? B - T : R - L;
    const g = (span - total) / (sorted.length - 1);
    let cur = axis ? T : L;
    for (const n of sorted) {
      n.pos[axis] = axis ? cur + titleH : cur;
      cur += len(n) + g;
    }
  };
  const expanded = nodes.filter((n) => !n.flags?.collapsed);
  switch (mode) {
    case "left": nodes.forEach((n) => (n.pos[0] = L)); break;
    case "right": nodes.forEach((n) => (n.pos[0] = R - W(n))); break;
    case "top": nodes.forEach((n) => (n.pos[1] = T + titleH)); break;
    case "bottom": nodes.forEach((n) => (n.pos[1] = B - H(n) + titleH)); break;
    case "centerX": nodes.forEach((n) => (n.pos[0] = (L + R) / 2 - W(n) / 2)); break;
    case "centerY": nodes.forEach((n) => (n.pos[1] = (T + B) / 2 - H(n) / 2 + titleH)); break;
    case "distributeX": gap(0); break;
    case "distributeY": gap(1); break;
    case "matchWidth": {
      if (!expanded.length) return false;
      const w = Math.max(...expanded.map((n) => n.size[0]));
      expanded.forEach((n) => setNodeSize(n, [w, n.size[1]]));
      break;
    }
    case "matchHeight": {
      if (!expanded.length) return false;
      const h = Math.max(...expanded.map((n) => n.size[1]));
      expanded.forEach((n) => setNodeSize(n, [n.size[0], h]));
      break;
    }
    case "fitContent":
      expanded.forEach((n) => setNodeSize(n, fitSize(n)));
      break;
    default:
      return false;
  }
  graph.setDirtyCanvas?.(true, true);
  notifyChanged(app, graph);
  return true;
}

/** Shrink/grow every group to wrap the nodes inside it. */
export function fitGroupsToNodes(app, padding = 20) {
  const graph = activeGraph(app);
  const titleH = titleHeight();
  const nodes = graphNodes(graph);
  let count = 0;
  for (const g of graphGroups(graph)) {
    const r = groupRect(g);
    const gTitle = Math.round((g.font_size ?? 24) * 1.4);
    const inside = nodes.filter((n) => centerInside(n, r, titleH)).map((n) => nodeRect(n, titleH));
    if (!inside.length) continue;
    const x0 = Math.min(...inside.map((b) => b.x));
    const y0 = Math.min(...inside.map((b) => b.y));
    const x1 = Math.max(...inside.map((b) => b.x + b.w));
    const y1 = Math.max(...inside.map((b) => b.y + b.h));
    setGroupRect(g, { x: x0 - padding, y: y0 - padding - gTitle, w: x1 - x0 + padding * 2, h: y1 - y0 + padding * 2 + gTitle });
    count++;
  }
  graph.setDirtyCanvas?.(true, true);
  notifyChanged(app, graph);
  return count;
}
