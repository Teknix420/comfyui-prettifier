// ComfyUI Prettifier - a subgraph's own connectors: the inputs / outputs shown on
// the panels inside the subgraph and mirrored on every subgraph node outside.
// Renaming, reordering (to reduce crossed links) and undo snapshots.

import { graphNodes, getLink, isSubgraphNode } from "./graph.js";
import { computeSubgraphSlotLabels } from "./rename.js";
import { allSubgraphs } from "./extras.js";

const rootGraph = (app) => app.rootGraph ?? app.graph;

export const isSubgraph = (g) => !!g && !!g.inputNode && Array.isArray(g.inputs) && Array.isArray(g.outputs);

/** Every subgraph node (with the graph it sits in) that uses the given subgraph. */
export function instancesOf(app, sg) {
  const out = [];
  const seen = new Set();
  for (const g of [rootGraph(app), ...allSubgraphs(app)]) {
    if (!g || seen.has(g)) continue;
    seen.add(g);
    for (const n of graphNodes(g)) if (isSubgraphNode(n) && n.subgraph === sg) out.push({ node: n, graph: g });
  }
  return out;
}

/** Subgraphs ordered so that a subgraph comes after the subgraphs used inside it. */
export function subgraphsInnerFirst(app) {
  const all = allSubgraphs(app);
  const known = new Set(all);
  const done = new Set();
  const out = [];
  const visit = (sg, trail) => {
    if (done.has(sg) || trail.has(sg)) return;
    trail.add(sg);
    for (const n of graphNodes(sg)) if (isSubgraphNode(n) && known.has(n.subgraph)) visit(n.subgraph, trail);
    trail.delete(sg);
    done.add(sg);
    out.push(sg);
  };
  for (const sg of all) visit(sg, new Set());
  return out;
}

const nodeById = (graph, id) => graph.getNodeById?.(id) ?? graphNodes(graph).find((n) => n.id == id) ?? null;
const slotName = (slot) => slot?.label || slot?.localized_name || slot?.name || "";

function slotLinks(sg, slot) {
  const out = [];
  for (const id of slot.linkIds ?? []) {
    const l = getLink(sg, id);
    if (l) out.push(l);
  }
  return out;
}

function connectionY(node, isInput, index) {
  const slot = (isInput ? node.inputs : node.outputs)?.[index];
  const LG = globalThis.LiteGraph || {};
  // A widget's input sits on the widget's row. Until the node has been drawn the
  // frontend has no position for it, so estimate the row.
  if (isInput && slot?.widget && Array.isArray(node.widgets)) {
    const wi = node.widgets.findIndex((w) => w?.name === slot.widget.name);
    if (wi >= 0) {
      const w = node.widgets[wi];
      if (Number.isFinite(w.y) && w.y > 0) return node.pos[1] + w.y + 10;
      const plain = (node.inputs || []).filter((i) => !i?.widget).length;
      const rows = Math.max(plain, (node.outputs || []).length);
      return node.pos[1] + rows * (LG.NODE_SLOT_HEIGHT ?? 20) + 10 + wi * ((LG.NODE_WIDGET_HEIGHT ?? 20) + 4) + 10;
    }
  }
  try {
    const p = node.getConnectionPos?.(isInput, index, [0, 0]);
    if (p && Number.isFinite(p[1])) return p[1];
  } catch {}
  return node.pos[1] + index * 20;
}

// --- renaming -------------------------------------------------------------------

function setLabel(sg, side, slot, label) {
  const rename = side === "inputs" ? sg.renameInput : sg.renameOutput;
  const shown = label ?? slot.localized_name ?? slot.name;
  try {
    // Tells every subgraph node using this subgraph to follow the new name.
    if (typeof rename === "function") rename.call(sg, slot, shown);
  } catch (err) {
    console.warn("[Prettifier] could not rename subgraph connector", err);
  }
  if (label == null || label === "") slot.label = undefined;
  else slot.label = label;
}

/** Make the connectors on every subgraph node show the same labels as the subgraph. */
function syncInstanceLabels(app, sg) {
  for (const { node } of instancesOf(app, sg)) {
    for (const side of ["inputs", "outputs"]) {
      const mine = node[side] || [];
      if (mine.length !== sg[side].length) continue;
      sg[side].forEach((slot, i) => {
        if (!mine[i]) return;
        if (slot.label) mine[i].label = slot.label;
        else delete mine[i].label;
      });
    }
    node.setDirtyCanvas?.(true, true);
  }
}

/**
 * Rename a subgraph's inputs and outputs using the subgraph connector options.
 * Returns the number of labels changed.
 */
export function renameSubgraphSlots(app, sg, o) {
  if (!isSubgraph(sg) || o.subgraphSlotMode === "keep") return 0;
  const instances = instancesOf(app, sg);
  let changed = 0;
  for (const side of ["inputs", "outputs"]) {
    const isInput = side === "inputs";
    const model = sg[side].map((slot, i) => {
      const links = slotLinks(sg, slot);
      const first = links[0];
      const inner = first ? nodeById(sg, isInput ? first.target_id : first.origin_id) : null;
      const innerSlot = inner ? (isInput ? inner.inputs : inner.outputs)?.[isInput ? first.target_slot : first.origin_slot] : null;
      let source = "";
      if (isInput) {
        for (const { node, graph } of instances) {
          const l = getLink(graph, node.inputs?.[i]?.link);
          const src = l ? nodeById(graph, l.origin_id) : null;
          if (src) {
            source = src.title ?? "";
            break;
          }
        }
      }
      return {
        name: slot.localized_name || slot.name || "",
        label: slot.label,
        type: slot.type,
        connected: links.length > 0,
        inner: innerSlot ? innerSlot.localized_name || innerSlot.name || "" : "",
        node: inner?.title ?? "",
        source,
      };
    });
    const labels = computeSubgraphSlotLabels(model, o, { side, subgraph: sg.name ?? "" });
    labels.forEach((label, i) => {
      if (label === undefined) return;
      setLabel(sg, side, sg[side][i], label);
      changed++;
    });
  }
  if (changed) {
    syncInstanceLabels(app, sg);
    arrangePanels(sg);
  }
  return changed;
}

function arrangePanels(sg) {
  try {
    sg.inputNode?.arrange?.();
    sg.outputNode?.arrange?.();
  } catch {}
}

// --- ordering -------------------------------------------------------------------

/** Put sg[side] into the given order (an array of the same slot objects) everywhere. */
function applyOrder(app, sg, side, order) {
  const slots = sg[side];
  if (order.length !== slots.length || order.some((s) => !slots.includes(s))) return false;
  if (order.every((s, i) => s === slots[i])) return false;
  const isInput = side === "inputs";
  const from = order.map((s) => slots.indexOf(s)); // new index -> old index
  const instances = instancesOf(app, sg).filter(({ node }) => (node[side] || []).length === slots.length);

  slots.splice(0, slots.length, ...order);
  // Links inside the subgraph address the panel connector by index.
  slots.forEach((slot, j) => {
    for (const l of slotLinks(sg, slot)) {
      if (isInput) l.origin_slot = j;
      else l.target_slot = j;
    }
  });
  // Same permutation on every subgraph node, and on the links attached to it. The
  // links are looked up before anything moves: a link knows which connector it
  // belongs to by position, so it would not follow the connector on its own.
  for (const { node, graph } of instances) {
    const mine = node[side];
    const held = mine.map((slot) => {
      const ids = isInput ? (slot?.link != null ? [slot.link] : []) : [...(slot?.links ?? [])];
      return ids.map((id) => getLink(graph, id)).filter(Boolean);
    });
    const moved = from.map((old) => mine[old]);
    mine.splice(0, mine.length, ...moved);
    // Two steps, through positions nothing uses, so that no two links ever claim
    // the same input at once (the frontend indexes links by the input they feed).
    const key = isInput ? "target_slot" : "origin_slot";
    from.forEach((old, j) => held[old].forEach((l) => (l[key] = mine.length + j)));
    from.forEach((old, j) => held[old].forEach((l) => (l[key] = j)));
    // Older frontends keep the link ids on the connector itself.
    mine.forEach((slot, j) => {
      if (!slot) return;
      const ids = held[from[j]].map((l) => l.id);
      try {
        if (isInput) {
          if ((slot.link ?? null) !== (ids[0] ?? null)) slot.link = ids[0] ?? null;
        } else if ((slot.links ?? []).join() !== ids.join()) slot.links = ids;
      } catch {}
    });
    node.setDirtyCanvas?.(true, true);
  }
  arrangePanels(sg);
  return true;
}

/**
 * Reorder a subgraph's inputs and outputs so fewer links cross.
 * mode "inside": by the height of the connectors they are wired to within the subgraph.
 * mode "outside": by the height of the connectors wired to the subgraph node outside.
 * Unconnected connectors stay right after the one they followed. Returns how many sides changed.
 */
export function reorderSubgraphSlots(app, sg, mode) {
  if (!isSubgraph(sg) || (mode !== "inside" && mode !== "outside")) return 0;
  let changed = 0;
  const outer = mode === "outside" ? instancesOf(app, sg) : [];
  for (const side of ["inputs", "outputs"]) {
    const isInput = side === "inputs";
    const slots = sg[side];
    if (slots.length < 2) continue;
    const raw = slots.map((slot, i) => {
      const ys = [];
      if (mode === "inside") {
        for (const l of slotLinks(sg, slot)) {
          const n = nodeById(sg, isInput ? l.target_id : l.origin_id);
          if (n) ys.push(connectionY(n, isInput, isInput ? l.target_slot : l.origin_slot));
        }
      } else {
        // Use the first subgraph node that has anything connected on this side.
        for (const { node, graph } of outer) {
          const mine = node[side] || [];
          if (mine.length !== slots.length) continue;
          const ids = (s) => (isInput ? (s?.link != null ? [s.link] : []) : s?.links ?? []);
          if (!mine.some((s) => ids(s).length)) continue;
          for (const id of ids(mine[i])) {
            const l = getLink(graph, id);
            const n = l ? nodeById(graph, isInput ? l.origin_id : l.target_id) : null;
            if (n) ys.push(connectionY(n, !isInput, isInput ? l.origin_slot : l.target_slot));
          }
          break;
        }
      }
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
    });
    if (raw.every((v) => v === null)) continue;
    let last = -Infinity;
    const keyed = slots.map((slot, i) => {
      if (raw[i] !== null) last = raw[i];
      return { slot, key: raw[i] ?? last, i };
    });
    keyed.sort((a, b) => a.key - b.key || a.i - b.i);
    if (applyOrder(app, sg, side, keyed.map((k) => k.slot))) changed++;
  }
  return changed;
}

// --- undo snapshots -------------------------------------------------------------

export function snapshotSubgraphIO(sg) {
  if (!isSubgraph(sg)) return null;
  const side = (list) => list.map((slot) => ({ slot, label: slot.label }));
  const pos = (io) => (io?.pos ? [io.pos[0], io.pos[1]] : null);
  return { sg, inputs: side(sg.inputs), outputs: side(sg.outputs), inPos: pos(sg.inputNode), outPos: pos(sg.outputNode) };
}

export function restoreSubgraphIO(app, snap) {
  if (!snap) return;
  const { sg } = snap;
  for (const side of ["inputs", "outputs"]) {
    applyOrder(app, sg, side, snap[side].map((s) => s.slot));
    for (const s of snap[side]) {
      if (!sg[side].includes(s.slot)) continue;
      if ((s.slot.label || null) !== (s.label || null)) setLabel(sg, side, s.slot, s.label);
    }
  }
  const put = (io, p) => {
    if (!io?.pos || !p) return;
    try {
      io.pos[0] = p[0];
      io.pos[1] = p[1];
    } catch {}
  };
  put(sg.inputNode, snap.inPos);
  put(sg.outputNode, snap.outPos);
  arrangePanels(sg);
}
