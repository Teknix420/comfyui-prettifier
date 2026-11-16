// ComfyUI Prettifier - extra passes that run around the layout:
// collapse / inactive-node styling, reroute cleanup, summary note, per-workflow
// settings, lint data gathering, and subgraph helpers.

import { stageOf } from "./layout.js";
import { lintModel } from "./lint.js";
import { graphNodes, getLink, isNote, titleHeight, nodeCategory, defaultTitle, graphLinks } from "./graph.js";

const LG = () => globalThis.LiteGraph || {};
const safeRegex = (src) => {
  if (!src) return null;
  try {
    return new RegExp(src, "i");
  } catch {
    return null;
  }
};
const nodeType = (n) => n.type ?? n.comfyClass ?? "";
const nodeStage = (n) =>
  stageOf({ type: nodeType(n), category: nodeCategory(n), isNote: isNote(n), isOutput: !!n.constructor?.nodeData?.output_node });
const widgetValue = (n, name) => (n.widgets || []).find((w) => w?.name === name)?.value;

// --- collapse & inactive nodes --------------------------------------------------

export const INACTIVE_COLORS = { color: "#262626", bgcolor: "#1b1b1b" };

function setCollapsed(n, want) {
  const is = !!(n.collapsed ?? n.flags?.collapsed);
  if (is === want) return false;
  if (typeof n.collapse === "function") n.collapse(true);
  else (n.flags ??= {}).collapsed = want;
  return true;
}

/** Collapse / expand nodes by rule and restyle muted or bypassed nodes. Returns count changed. */
export function applyCollapseRules(nodes, o) {
  let changed = 0;
  const re = safeRegex(o.collapseMatch);
  for (const n of nodes) {
    const inactive = n.mode === 2 || n.mode === 4;
    if (o.collapseMode === "expand") changed += setCollapsed(n, false) ? 1 : 0;
    else if (o.collapseMode === "collapse" && re && !isNote(n)) {
      if (re.test(nodeType(n)) || re.test(n.title ?? "") || re.test(nodeStage(n))) changed += setCollapsed(n, true) ? 1 : 0;
    }
    if (inactive && (o.inactiveStyle === "collapse" || o.inactiveStyle === "both")) changed += setCollapsed(n, true) ? 1 : 0;
    if (inactive && (o.inactiveStyle === "dim" || o.inactiveStyle === "both")) {
      if (n.color !== INACTIVE_COLORS.color || n.bgcolor !== INACTIVE_COLORS.bgcolor) changed++;
      n.color = INACTIVE_COLORS.color;
      n.bgcolor = INACTIVE_COLORS.bgcolor;
    }
  }
  return changed;
}

// --- reroutes -------------------------------------------------------------------

function slotPos(node, isInput, slot) {
  try {
    const p = node.getConnectionPos?.(isInput, slot, [0, 0]);
    if (p && Number.isFinite(p[0])) return [p[0], p[1]];
  } catch {}
  const th = titleHeight();
  return [node.pos[0] + (isInput ? 0 : node.size[0]), node.pos[1] + (slot + 0.7) * (LG().NODE_SLOT_HEIGHT ?? 20) - (node.flags?.collapsed ? th / 2 : 0)];
}

function nodeBox(n) {
  const th = titleHeight();
  const collapsed = !!n.flags?.collapsed;
  return { x: n.pos[0], y: n.pos[1] - th, w: collapsed ? n._collapsed_width ?? 120 : n.size[0], h: collapsed ? th : n.size[1] + th };
}

function segmentHitsBox(ax, ay, bx, by, r, m) {
  // Liang-Barsky clip of segment against the box grown by margin m.
  const x0 = r.x - m, y0 = r.y - m, x1 = r.x + r.w + m, y1 = r.y + r.h + m;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Reroute cleanup for links between the given nodes (at their current positions).
 * mode: keep | remove | auto.  Returns { removed, added }.
 */
export function cleanReroutes(graph, nodes, o) {
  const res = { removed: 0, added: 0 };
  if (o.rerouteMode === "keep" || !graph.reroutes || typeof graph.removeReroute !== "function") return res;
  const inScope = new Map(nodes.map((n) => [n.id, n]));
  const links = graphLinks(graph).filter((l) => inScope.has(l.origin_id) && inScope.has(l.target_id));
  const linkIds = new Set(links.map((l) => l.id));

  // Remove reroute dots that only serve links in scope.
  for (const [id, r] of [...graph.reroutes]) {
    const ids = [...(r.linkIds ?? [])];
    if (ids.length && ids.every((i) => linkIds.has(i))) {
      graph.removeReroute(id);
      res.removed++;
    }
  }
  if (o.rerouteMode !== "auto" || typeof graph.createReroute !== "function") return res;

  const boxes = nodes.map((n) => ({ n, ...nodeBox(n) }));
  const margin = Math.max(4, o.rerouteClearance ?? 16);
  const lanes = new Map(); // rounded y -> uses
  const lane = (y) => {
    const key = Math.round(y / 8);
    const uses = lanes.get(key) || 0;
    lanes.set(key, uses + 1);
    return uses;
  };

  // Links that share an output and take the same detour share dots, so sort for determinism.
  links.sort((a, b) => a.origin_id - b.origin_id || a.origin_slot - b.origin_slot || a.target_id - b.target_id);
  for (const link of links) {
    const src = inScope.get(link.origin_id), dst = inScope.get(link.target_id);
    const [sx, sy] = slotPos(src, false, link.origin_slot);
    const [tx, ty] = slotPos(dst, true, link.target_slot);
    const others = boxes.filter((b) => b.n !== src && b.n !== dst);
    const backward = tx < sx + 20;
    let hit = others.filter((b) => segmentHitsBox(sx, sy, tx, ty, b, 2));
    if (!hit.length && !backward) continue;
    if (!backward && tx - sx < (o.rerouteMinLength ?? 300)) continue;

    // Grow the set of obstacles until the detour lane itself is clear.
    let top, bottom, left, right, y;
    const span = backward ? boxes.filter((b) => b.x < sx + 40 && b.x + b.w > tx - 40) : hit;
    let set = new Set(span.length ? span : hit);
    if (backward) {
      set.add(boxes.find((b) => b.n === src));
      set.add(boxes.find((b) => b.n === dst));
    }
    for (let iter = 0; iter < 6; iter++) {
      const arr = [...set];
      top = Math.min(...arr.map((b) => b.y));
      bottom = Math.max(...arr.map((b) => b.y + b.h));
      left = Math.min(...arr.map((b) => b.x));
      right = Math.max(...arr.map((b) => b.x + b.w));
      const above = top - margin, below = bottom + margin;
      const costA = Math.abs(sy - above) + Math.abs(ty - above), costB = Math.abs(sy - below) + Math.abs(ty - below);
      y = backward ? below : costA <= costB ? above : below;
      const x0 = backward ? tx - 30 : left - 30, x1 = backward ? sx + 30 : right + 30;
      const blockers = others.filter((b) => !set.has(b) && segmentHitsBox(Math.min(x0, x1), y, Math.max(x0, x1), y, b, 2));
      if (!blockers.length) break;
      blockers.forEach((b) => set.add(b));
    }
    const shift = lane(y) * 10 * (y < (sy + ty) / 2 ? -1 : 1);
    y += shift;
    const gap = Math.min(40, Math.max(16, (o.hGap ?? 80) / 2));
    const ax = backward ? sx + gap : Math.max(sx + 16, left - gap);
    const bx = backward ? tx - gap : Math.min(tx - 16, right + gap);
    if (!backward && bx - ax < 20) continue;
    try {
      // createReroute inserts before the given segment, so create the far dot first.
      const second = graph.createReroute([bx, y], link);
      graph.createReroute([ax, y], second);
      res.added += 2;
    } catch (err) {
      console.warn("[Prettifier] could not add reroute", err);
      break;
    }
  }
  return res;
}

export function snapshotReroutes(graph) {
  if (!graph.reroutes) return null;
  return {
    reroutes: [...graph.reroutes.values()].map((r) => {
      try {
        return JSON.parse(JSON.stringify(r.asSerialisable()));
      } catch {
        return { id: r.id, parentId: r.parentId, pos: [r.pos[0], r.pos[1]], linkIds: [...(r.linkIds ?? [])] };
      }
    }),
    parents: graphLinks(graph).map((l) => [l.id, l.parentId]),
  };
}

export function restoreReroutes(graph, snap) {
  if (!snap || !graph.reroutes || typeof graph.setReroute !== "function") return;
  const same =
    snap.reroutes.length === graph.reroutes.size &&
    snap.reroutes.every((r) => {
      const cur = graph.reroutes.get(r.id);
      return cur && cur.pos[0] === r.pos[0] && cur.pos[1] === r.pos[1] && cur.parentId === r.parentId;
    });
  if (same) return;
  for (const id of [...graph.reroutes.keys()]) graph.removeReroute(id);
  for (const r of snap.reroutes) graph.setReroute(r);
  const parents = new Map(snap.parents);
  for (const l of graphLinks(graph)) {
    const p = parents.get(l.id);
    if (p === undefined) delete l.parentId;
    else l.parentId = p;
  }
}

// --- summary note ---------------------------------------------------------------

const base = (s) => String(s ?? "").split(/[\\/]/).pop();

export function summarize(graph, o) {
  const nodes = graphNodes(graph).filter((n) => !n.mode && !n.properties?.prettifierSummary);
  const models = [], loras = [], vaes = [], samplers = [], sizes = [], prompts = [], other = [];
  for (const n of nodes) {
    const t = nodeType(n);
    for (const w of n.widgets || []) {
      if (typeof w?.value !== "string") continue;
      const name = w.name;
      if (/^(ckpt_name|unet_name|model_name)$/.test(name)) models.push(base(w.value));
      else if (name === "lora_name") {
        const sm = widgetValue(n, "strength_model"), sc = widgetValue(n, "strength_clip");
        loras.push(`${base(w.value)}${sm != null ? ` (model ${sm}${sc != null ? `, clip ${sc}` : ""})` : ""}`);
      } else if (name === "vae_name") vaes.push(base(w.value));
      else if (/^(control_net_name|clip_name\d*|upscale_model|style_model_name)$/.test(name)) other.push(`${name.replace(/_name\d*$/, "")}: ${base(w.value)}`);
    }
    if (widgetValue(n, "sampler_name") != null && widgetValue(n, "steps") != null) {
      const seed = widgetValue(n, "seed") ?? widgetValue(n, "noise_seed");
      const bits = [
        widgetValue(n, "sampler_name"),
        widgetValue(n, "scheduler"),
        `${widgetValue(n, "steps")} steps`,
        widgetValue(n, "cfg") != null ? `CFG ${widgetValue(n, "cfg")}` : null,
        widgetValue(n, "denoise") != null && widgetValue(n, "denoise") !== 1 ? `denoise ${widgetValue(n, "denoise")}` : null,
        seed != null ? `seed ${seed}` : null,
      ].filter(Boolean);
      samplers.push(bits.join(", "));
    }
    if (/latent/i.test(t) && widgetValue(n, "width") != null && widgetValue(n, "height") != null) {
      const b = widgetValue(n, "batch_size");
      sizes.push(`${widgetValue(n, "width")} × ${widgetValue(n, "height")}${b > 1 ? ` (batch ${b})` : ""}`);
    }
    if (o.noteIncludePrompts && /textencode/i.test(t)) {
      const text = widgetValue(n, "text");
      if (typeof text === "string" && text.trim()) prompts.push(text.trim().replace(/\s+/g, " ").slice(0, 200));
    }
  }
  const uniq = (a) => [...new Set(a)];
  const sections = [
    ["Models", uniq(models)],
    ["LoRAs", uniq(loras)],
    ["VAE", uniq(vaes)],
    ["Other", uniq(other)],
    ["Resolution", uniq(sizes)],
    ["Sampling", samplers],
    ["Prompts", uniq(prompts)],
  ].filter(([, v]) => v.length);
  const md = o.noteStyle !== "plain";
  const lines = [md ? `## ${o.noteTitle || "Workflow summary"}` : (o.noteTitle || "Workflow summary").toUpperCase(), ""];
  for (const [name, values] of sections) {
    lines.push(md ? `**${name}**` : `${name}:`);
    for (const v of values) lines.push(md ? `- ${v}` : `  - ${v}`);
    lines.push("");
  }
  lines.push(md ? `*${nodes.length} active nodes*` : `${nodes.length} active nodes`);
  return { text: lines.join("\n"), lines: lines.length };
}

/** Create or update the summary note. Returns the note node (or null). */
export function upsertSummaryNote(graph, o) {
  const { text, lines } = summarize(graph, o);
  let note = graphNodes(graph).find((n) => n.properties?.prettifierSummary);
  const wantType = o.noteStyle === "plain" ? "Note" : "MarkdownNote";
  if (note && nodeType(note) !== wantType) {
    graph.remove(note);
    note = null;
  }
  let created = false;
  if (!note) {
    const types = LG().registered_node_types || {};
    const type = types[wantType] ? wantType : types.Note ? "Note" : null;
    if (!type || typeof LG().createNode !== "function") return null;
    note = LG().createNode(type);
    if (!note) return null;
    note.properties = { ...(note.properties || {}), prettifierSummary: true };
    note.title = o.noteTitle || "Workflow summary";
    const ns = graphNodes(graph);
    const x = ns.length ? Math.min(...ns.map((n) => n.pos[0])) : 0;
    const y = ns.length ? Math.min(...ns.map((n) => n.pos[1])) - 400 : 0;
    note.pos = [x, y];
    graph.add(note);
    created = true;
  }
  const w = (note.widgets || [])[0];
  if (w) {
    w.value = text;
    try {
      w.callback?.(text);
    } catch {}
  }
  const size = [Math.max(note.size?.[0] ?? 0, 380), Math.max(140, Math.min(700, lines * 22 + 50))];
  if (typeof note.setSize === "function") note.setSize(size);
  else note.size = size;
  return { note, created };
}

// --- per-workflow settings --------------------------------------------------------

const rootGraph = (app) => app.rootGraph ?? app.graph;

// Options about how Prettifier behaves for you, not how this workflow should look.
const NOT_REMEMBERED = new Set(["animate", "animationMs", "scope", "autoRun", "showToast", "rememberWorkflowOptions", "useWorkflowOptions", "lintOnPrettify"]);

export function workflowOptions(app) {
  const o = rootGraph(app)?.extra?.prettifier?.options;
  return o && typeof o === "object" ? o : null;
}

export function rememberWorkflowOptions(app, options, defaults) {
  const g = rootGraph(app);
  if (!g) return;
  const diff = {};
  for (const [k, v] of Object.entries(options)) if (k in defaults && v !== defaults[k] && !NOT_REMEMBERED.has(k)) diff[k] = v;
  g.extra ??= {};
  g.extra.prettifier = { ...(g.extra.prettifier || {}), version: 1, options: diff };
}

export function forgetWorkflowOptions(app) {
  const g = rootGraph(app);
  if (g?.extra?.prettifier) delete g.extra.prettifier;
}

/** A cheap fingerprint of the arrangement, used to skip auto-prettify when nothing changed. */
export function layoutStamp(graph) {
  let h = 0;
  for (const n of graphNodes(graph)) {
    const s = `${n.id}:${Math.round(n.pos[0])},${Math.round(n.pos[1])},${Math.round(n.size[0])},${Math.round(n.size[1])}`;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return h;
}

export function stampWorkflow(app) {
  const g = rootGraph(app);
  if (!g) return;
  g.extra ??= {};
  g.extra.prettifier = { ...(g.extra.prettifier || {}), stamp: layoutStamp(g) };
}

export function isStampCurrent(app) {
  const g = rootGraph(app);
  return g?.extra?.prettifier?.stamp === layoutStamp(g);
}

// --- subgraphs --------------------------------------------------------------------

export function allSubgraphs(app) {
  const g = rootGraph(app);
  const m = g?.subgraphs ?? g?._subgraphs;
  if (!m) return [];
  return typeof m.values === "function" ? [...m.values()] : Object.values(m);
}

/** Put a subgraph's input / output boundary nodes at the left and right of its content. */
export function placeSubgraphIO(sg, gap = 120) {
  const nodes = graphNodes(sg);
  if (!nodes.length) return;
  const th = titleHeight();
  const x0 = Math.min(...nodes.map((n) => n.pos[0]));
  const x1 = Math.max(...nodes.map((n) => n.pos[0] + n.size[0]));
  const y0 = Math.min(...nodes.map((n) => n.pos[1] - th));
  const y1 = Math.max(...nodes.map((n) => n.pos[1] + n.size[1]));
  const place = (io, x) => {
    if (!io?.pos) return;
    const h = io.size?.[1] ?? io.boundingRect?.[3] ?? 100;
    try {
      io.pos[0] = x;
      io.pos[1] = (y0 + y1) / 2 - h / 2;
      io.arrange?.();
    } catch {}
  };
  const inW = sg.inputNode?.size?.[0] ?? sg.inputNode?.boundingRect?.[2] ?? 120;
  place(sg.inputNode, x0 - gap - inW);
  place(sg.outputNode, x1 + gap);
}

// --- lint -------------------------------------------------------------------------

export function runLint(graph, o) {
  const types = LG().registered_node_types || {};
  const model = graphNodes(graph).map((n) => {
    const def = n.constructor?.nodeData;
    const required = new Set(Object.keys(def?.input?.required ?? {}));
    return {
      id: n.id,
      title: n.title || defaultTitle(n),
      type: nodeType(n),
      stage: nodeStage(n),
      isOutput: !!def?.output_node,
      isNote: isNote(n),
      mode: n.mode,
      missingType: !!n.has_errors && !types[nodeType(n)],
      inputs: (n.inputs || []).map((s) => ({ name: s?.name, required: required.has(s?.name), connected: !!getLink(graph, s?.link), isWidget: !!s?.widget })),
      outputs: (n.outputs || []).map((s) => ({ name: s?.name, connected: !!s?.links?.length })),
      widgets: (n.widgets || [])
        .filter((w) => w && (typeof w.value === "number" || typeof w.value === "string"))
        .map((w) => ({ name: w.name, value: w.value, min: w.options?.min, max: w.options?.max, choices: Array.isArray(w.options?.values) ? w.options.values : null })),
    };
  });
  return lintModel(model, o);
}
