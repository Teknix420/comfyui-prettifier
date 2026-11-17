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
function textWidth(text) {
  if (!text) return 0;
  try {
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${LG().NODE_TEXT_SIZE ?? 14}px Arial`;
    return measureCtx.measureText(String(text)).width;
  } catch {
    return String(text).length * 8;
  }
}

function collapsedWidth(n) {
  const est = Math.min(n.size[0], textWidth(n.title) + titleHeight() * 2);
  return Math.max(n._collapsed_width ?? 0, est) || 120;
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

  // Group membership: a node belongs to a group if its center is inside it.
  const groupInfo = groups.map((g, index) => ({ g, index, ...groupRect(g) }));
  const membership = new Map();
  for (const n of graphNodes(graph)) {
    const cx = n.pos[0] + n.size[0] / 2;
    const cy = n.pos[1] + n.size[1] / 2 - titleH / 2;
    const containing = groupInfo
      .filter((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .map((g) => g.index);
    membership.set(n.id, containing);
  }
  // Only groups whose members are all in scope are touched.
  const scopeGroups = groupInfo.filter((gi) => {
    const mem = graphNodes(graph).filter((n) => membership.get(n.id).includes(gi.index));
    return mem.length > 0 && mem.every((n) => inScope.has(n.id));
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
    const cx = n.pos[0] + n.size[0] / 2, cy = n.pos[1] + n.size[1] / 2 - titleH / 2;
    const group = groups
      .filter((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h)
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

/**
 * Run the layout on the given graph/nodes with the given options and apply it.
 * Returns { moved, groups } counts.
 */
export function prettifyNodes(app, graph, nodes, opts) {
  cancelAnimation();
  const model = readModel(graph, nodes);
  if (!model.nodes.length) return { moved: 0, groups: 0 };
  const res = computeLayout(model, opts.paletteColors?.group ? { ...opts, stageGroupColors: opts.paletteColors.group } : opts);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const resized = opts.widthMode !== "keep" || opts.heightMode !== "keep";

  const tracker = opts.noHistory ? null : changeTracker(app);
  tracker?.beforeChange?.();

  // Sizes apply immediately; positions may animate.
  const moves = [];
  for (const r of res.nodes) {
    const n = byId.get(r.id);
    if (!n || !r.moved) continue;
    if (resized && !n.flags?.collapsed) setNodeSize(n, [r.w, r.h]);
    moves.push({ n, from: [n.pos[0], n.pos[1]], to: [r.x, r.y] });
  }

  // Groups.
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

  // Node colors, now that the groups have their final place and color.
  if ((opts.colorNodes && opts.colorNodes !== "keep") || opts.nodeColorRules) {
    const info = new Map(model.nodes.map((n) => [n.id, n]));
    const target = new Map(moves.map((m) => [m.n.id, m.to]));
    const rects = graphGroups(graph).map((g) => ({ color: g.color, ...groupRect(g) }));
    const described = res.nodes
      .filter((r) => r.moved && byId.has(r.id))
      .map((r) => {
        const n = byId.get(r.id), i = info.get(r.id) ?? {};
        const [x, y] = target.get(r.id) ?? n.pos;
        const cx = x + (n.size?.[0] ?? 0) / 2, cy = y + (n.flags?.collapsed ? 0 : (n.size?.[1] ?? 0) / 2);
        // The innermost group that holds the node.
        const holder = rects.filter((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h).sort((a, b) => a.w * a.h - b.w * b.h)[0];
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
    for (const m of moves) {
      m.n.pos[0] = m.to[0];
      m.n.pos[1] = m.to[1];
    }
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

  return { moved: moves.length, groups: res.newGroups.length + res.groupUpdates.length };
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
  for (const n of nodes) add(n.pos[0], n.pos[1] - titleH, n.size[0], n.size[1] + titleH);
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
  const L = Math.min(...nodes.map((n) => n.pos[0]));
  const R = Math.max(...nodes.map((n) => n.pos[0] + n.size[0]));
  const T = Math.min(...nodes.map((n) => n.pos[1] - titleH));
  const B = Math.max(...nodes.map((n) => n.pos[1] + n.size[1]));
  const gap = (axis) => {
    const sorted = [...nodes].sort((a, b) => a.pos[axis] - b.pos[axis]);
    const total = sorted.reduce((s, n) => s + n.size[axis] + (axis ? titleH : 0), 0);
    const span = axis ? B - T : R - L;
    const g = (span - total) / (sorted.length - 1);
    let cur = axis ? T : L;
    for (const n of sorted) {
      n.pos[axis] = axis ? cur + titleH : cur;
      cur += n.size[axis] + (axis ? titleH : 0) + g;
    }
  };
  switch (mode) {
    case "left": nodes.forEach((n) => (n.pos[0] = L)); break;
    case "right": nodes.forEach((n) => (n.pos[0] = R - n.size[0])); break;
    case "top": nodes.forEach((n) => (n.pos[1] = T + titleH)); break;
    case "bottom": nodes.forEach((n) => (n.pos[1] = B - n.size[1])); break;
    case "centerX": nodes.forEach((n) => (n.pos[0] = (L + R) / 2 - n.size[0] / 2)); break;
    case "centerY": nodes.forEach((n) => (n.pos[1] = (T + B) / 2 - n.size[1] / 2 + titleH / 2)); break;
    case "distributeX": gap(0); break;
    case "distributeY": gap(1); break;
    case "matchWidth": {
      const w = Math.max(...nodes.map((n) => n.size[0]));
      nodes.forEach((n) => setNodeSize(n, [w, n.size[1]]));
      break;
    }
    case "matchHeight": {
      const h = Math.max(...nodes.map((n) => n.size[1]));
      nodes.forEach((n) => setNodeSize(n, [n.size[0], h]));
      break;
    }
    case "fitContent":
      nodes.forEach((n) => setNodeSize(n, fitSize(n)));
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
    const inside = nodes.filter((n) => {
      const cx = n.pos[0] + n.size[0] / 2, cy = n.pos[1] + n.size[1] / 2;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    });
    if (!inside.length) continue;
    const x0 = Math.min(...inside.map((n) => n.pos[0]));
    const y0 = Math.min(...inside.map((n) => n.pos[1] - titleH));
    const x1 = Math.max(...inside.map((n) => n.pos[0] + n.size[0]));
    const y1 = Math.max(...inside.map((n) => n.pos[1] + n.size[1]));
    setGroupRect(g, { x: x0 - padding, y: y0 - padding - gTitle, w: x1 - x0 + padding * 2, h: y1 - y0 + padding * 2 + gTitle });
    count++;
  }
  graph.setDirtyCanvas?.(true, true);
  notifyChanged(app, graph);
  return count;
}
