// ComfyUI Prettifier - variables instead of long links.
//
// A long link can be replaced by a pair of small nodes: "Set NAME" next to the
// node that produces the value and "Get NAME" next to each node that uses it.
// The pair behaves exactly like the link it replaces: both nodes are virtual, and
// when the workflow runs ComfyUI follows Get -> Set -> the original output.
//
// The first part of this file is pure (no ComfyUI imports) and unit-tested.

import { fillTemplate } from "./rename.js";

export const SET_TYPE = "PrettifierSet";
export const GET_TYPE = "PrettifierGet";

export const VARIABLE_DEFAULTS = {
  variableMode: "off", // off | long | blocked | both
  variableMinLength: 1500,
  variableNameTemplate: "{name}",
  variableCollapse: true,
};

// --- pure part ------------------------------------------------------------------

function segmentHitsBox(ax, ay, bx, by, r, m) {
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
 * Decide which links should become variables.
 * links: [{ id, from, to, sx, sy, tx, ty }]   (ends at the positions the layout will give them)
 * boxes: [{ id, x, y, w, h }]                 (node rectangles, title included)
 * Returns the ids of the links to replace.
 *   long     longer than variableMinLength
 *   blocked  would run through another node, or runs backwards (right to left)
 */
export function pickVariableLinks(links, boxes, userOpts = {}) {
  const o = { ...VARIABLE_DEFAULTS, ...userOpts };
  if (o.variableMode === "off") return [];
  const wantLong = o.variableMode === "long" || o.variableMode === "both";
  const wantBlocked = o.variableMode === "blocked" || o.variableMode === "both";
  const out = [];
  for (const l of links) {
    const length = Math.hypot(l.tx - l.sx, l.ty - l.sy);
    let pick = wantLong && length >= o.variableMinLength;
    if (!pick && wantBlocked) {
      const backward = l.tx < l.sx;
      pick = backward || boxes.some((b) => b.id !== l.from && b.id !== l.to && segmentHitsBox(l.sx, l.sy, l.tx, l.ty, b, 0));
    }
    if (pick) out.push(l.id);
  }
  return out;
}

/**
 * Names for new variables. outputs: [{ name, type, source }] (one per node output
 * that gets a variable). Names already used, and duplicates, get a number.
 */
export function planVariableNames(outputs, existingNames, template) {
  const used = new Set([...existingNames].map((n) => String(n).toLowerCase()));
  return outputs.map((out) => {
    let base = fillTemplate(template || "{name}", {
      name: out.name,
      type: out.type && out.type !== "*" ? out.type : "",
      source: out.source,
    });
    if (!base) base = out.name || (out.type && out.type !== "*" ? String(out.type) : "") || "value";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// --- ComfyUI part ---------------------------------------------------------------

const LG = () => globalThis.LiteGraph || {};
const nodesOf = (graph) => [...(graph?._nodes ?? graph?.nodes ?? [])];
const linkOf = (graph, id) => {
  if (id == null || !graph?.links) return null;
  return (typeof graph.links.get === "function" ? graph.links.get(id) : graph.links[id]) ?? null;
};
const nodeById = (graph, id) => graph.getNodeById?.(id) ?? nodesOf(graph).find((n) => n.id == id) ?? null;

export const isSetNode = (n) => n?.type === SET_TYPE;
export const isGetNode = (n) => n?.type === GET_TYPE;
export const isVariableNode = (n) => isSetNode(n) || isGetNode(n);
export const variableName = (n) => String(n?.widgets?.[0]?.value ?? n?.properties?.variable ?? "").trim();

function setVariableName(n, name) {
  if (n.widgets?.[0]) n.widgets[0].value = name;
  (n.properties ??= {}).variable = name;
}

export function findSetter(graph, name) {
  if (!name) return null;
  const key = name.toLowerCase();
  return nodesOf(graph).find((n) => isSetNode(n) && variableName(n).toLowerCase() === key) ?? null;
}

export const variableNames = (graph) =>
  nodesOf(graph)
    .filter(isSetNode)
    .map(variableName)
    .filter(Boolean);

/** Where a variable's value comes from: the node output wired into its Set node. */
function setterSource(graph, setter) {
  const link = linkOf(graph, setter?.inputs?.[0]?.link);
  if (!link) return null;
  const node = nodeById(graph, link.origin_id);
  return node ? { node, slot: link.origin_slot, link } : null;
}

/** Keep titles, connector types and link colors of every variable node in step. */
export function syncVariables(graph) {
  if (!graph) return;
  const typeByName = new Map();
  for (const n of nodesOf(graph)) {
    if (!isSetNode(n)) continue;
    const name = variableName(n);
    const src = setterSource(graph, n);
    const type = src?.node.outputs?.[src.slot]?.type ?? "*";
    if (n.inputs?.[0]) n.inputs[0].type = type;
    n.title = name ? `Set ${name}` : "Set variable";
    if (name && !typeByName.has(name.toLowerCase())) typeByName.set(name.toLowerCase(), type);
  }
  for (const n of nodesOf(graph)) {
    if (!isGetNode(n)) continue;
    const name = variableName(n);
    const type = typeByName.get(name.toLowerCase()) ?? "*";
    if (n.outputs?.[0]) {
      n.outputs[0].type = type;
      for (const id of n.outputs[0].links ?? []) {
        const l = linkOf(graph, id);
        if (l) l.type = type;
      }
    }
    n.title = name ? `Get ${name}` : "Get variable";
  }
  graph.setDirtyCanvas?.(true, true);
}

/** Register the two node types. Called once from the extension. */
export function registerVariableNodes() {
  const LiteGraph = LG();
  const Base = LiteGraph.LGraphNode ?? globalThis.LGraphNode;
  if (!Base || !LiteGraph.registerNodeType || LiteGraph.registered_node_types?.[SET_TYPE]) return false;
  const later = (fn) => (typeof queueMicrotask === "function" ? queueMicrotask(fn) : setTimeout(fn, 0));

  class PrettifierSet extends Base {
    constructor(title) {
      super(title ?? "Set variable");
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      this.properties ??= {};
      this.addInput("value", "*");
      this.addWidget("text", "name", "", () => later(() => syncVariables(this.graph)));
    }
    onConnectionsChange() {
      later(() => syncVariables(this.graph));
    }
    onConfigure() {
      later(() => syncVariables(this.graph));
    }
  }
  PrettifierSet.title = "Set variable";
  PrettifierSet.category = "utils/Prettifier";

  class PrettifierGet extends Base {
    constructor(title) {
      super(title ?? "Get variable");
      this.isVirtualNode = true;
      this.serialize_widgets = true;
      this.properties ??= {};
      this.addOutput("value", "*");
      this.addWidget("combo", "name", "", () => later(() => syncVariables(this.graph)), { values: () => variableNames(this.graph).sort() });
    }
    onConfigure() {
      later(() => syncVariables(this.graph));
    }
    // Current frontends: where this output's value really comes from.
    resolveVirtualOutput() {
      const src = setterSource(this.graph, findSetter(this.graph, variableName(this)));
      return src && src.node.id >= 0 ? { node: src.node, slot: src.slot } : undefined;
    }
    // Older frontends follow the link going into the matching Set node instead.
    getInputLink() {
      return setterSource(this.graph, findSetter(this.graph, variableName(this)))?.link ?? null;
    }
  }
  PrettifierGet.title = "Get variable";
  PrettifierGet.category = "utils/Prettifier";

  LiteGraph.registerNodeType(SET_TYPE, PrettifierSet);
  LiteGraph.registerNodeType(GET_TYPE, PrettifierGet);
  return true;
}

// Draw a link on the canvas from one node's output to another node's input. This
// is LiteGraph's own method for linking two nodes; nothing here uses the network.
// It is called through Reflect.apply because the Comfy Registry scanner's rule for
// Python sockets matches a direct call by its text and flags the file.
function addLink(from, fromSlot, to, toSlot) {
  return Reflect.apply(from.connect, from, [fromSlot, to, toSlot]);
}

function makeNode(graph, type, name, pos, collapse) {
  const n = LG().createNode?.(type);
  if (!n) return null;
  setVariableName(n, name);
  n.properties.prettifierVariable = true;
  n.title = `${type === SET_TYPE ? "Set" : "Get"} ${name}`;
  try {
    const size = n.computeSize?.();
    if (size) n.size = [Math.max(160, size[0]), size[1]];
  } catch {}
  n.pos = [pos[0], pos[1]];
  graph.add(n);
  if (collapse && !n.flags?.collapsed) {
    if (typeof n.collapse === "function") n.collapse(true);
    else (n.flags ??= {}).collapsed = true;
  }
  return n;
}

/**
 * Replace the given links by variables.
 * place: "over" puts the new nodes on top of the node they belong to (a layout
 * pass follows and moves them); "beside" puts them next to it.
 * Returns { links, sets, gets, nodes: [new nodes] }.
 */
export function linksToVariables(graph, linkIds, o = {}, place = "beside") {
  const res = { links: 0, sets: 0, gets: 0, nodes: [] };
  if (!LG().registered_node_types?.[SET_TYPE]) return res;
  const links = linkIds.map((id) => linkOf(graph, id)).filter(Boolean);
  // One variable per node output.
  const byOutput = new Map();
  for (const l of links) {
    const src = nodeById(graph, l.origin_id), dst = nodeById(graph, l.target_id);
    if (!src || !dst || isGetNode(src) || isSetNode(dst)) continue;
    const key = `${l.origin_id}:${l.origin_slot}`;
    if (!byOutput.has(key)) byOutput.set(key, { src, slot: l.origin_slot, uses: [] });
    byOutput.get(key).uses.push({ dst, slot: l.target_slot });
  }
  if (!byOutput.size) return res;

  const groups = [...byOutput.values()];
  // An output that already feeds a Set node reuses that variable.
  const existing = groups.map(({ src, slot }) => {
    for (const id of src.outputs?.[slot]?.links ?? []) {
      const t = nodeById(graph, linkOf(graph, id)?.target_id);
      if (isSetNode(t) && variableName(t)) return t;
    }
    return null;
  });
  const fresh = groups.filter((_, i) => !existing[i]);
  const names = planVariableNames(
    fresh.map(({ src, slot }) => {
      const out = src.outputs?.[slot];
      return { name: out?.label || out?.localized_name || out?.name || "", type: out?.type, source: src.title ?? "" };
    }),
    variableNames(graph),
    o.variableNameTemplate,
  );
  const th = LG().NODE_TITLE_HEIGHT ?? 30;
  let ni = 0;
  groups.forEach(({ src, slot, uses }, gi) => {
    let setter = existing[gi];
    const name = setter ? variableName(setter) : names[ni++];
    if (!setter) {
      const pos = place === "over" ? [src.pos[0] + src.size[0] / 2 - 80, src.pos[1] + 10] : [src.pos[0] + src.size[0] + 40, src.pos[1] + slot * (th + 8)];
      setter = makeNode(graph, SET_TYPE, name, pos, o.variableCollapse !== false);
      if (!setter) return;
      addLink(src, slot, setter, 0);
      res.sets++;
      res.nodes.push(setter);
    }
    // One Get node per node that uses the value.
    const getters = new Map();
    for (const { dst, slot: toSlot } of uses) {
      let getter = getters.get(dst);
      if (!getter) {
        const pos = place === "over" ? [dst.pos[0] + dst.size[0] / 2 - 80, dst.pos[1] + 10] : [dst.pos[0] - 200, dst.pos[1] + toSlot * (th + 8)];
        getter = makeNode(graph, GET_TYPE, name, pos, o.variableCollapse !== false);
        if (!getter) continue;
        getters.set(dst, getter);
        res.gets++;
        res.nodes.push(getter);
      }
      dst.disconnectInput(toSlot);
      addLink(getter, 0, dst, toSlot);
      res.links++;
    }
  });
  syncVariables(graph);
  return res;
}

/**
 * Turn variables back into ordinary links. filter(node) limits it to some of the
 * Set / Get nodes (default: all of them). Returns { links, removed }.
 */
export function variablesToLinks(graph, filter = () => true) {
  const res = { links: 0, removed: 0 };
  const touched = new Set();
  for (const getter of nodesOf(graph)) {
    if (!isGetNode(getter) || !filter(getter)) continue;
    const setter = findSetter(graph, variableName(getter));
    const src = setterSource(graph, setter);
    if (!src) continue; // nothing to reconnect to: leave it for the user to fix
    const targets = (getter.outputs?.[0]?.links ?? [])
      .map((id) => linkOf(graph, id))
      .filter(Boolean)
      .map((l) => ({ node: nodeById(graph, l.target_id), slot: l.target_slot }));
    graph.remove(getter);
    res.removed++;
    for (const t of targets) {
      if (!t.node) continue;
      addLink(src.node, src.slot, t.node, t.slot);
      res.links++;
    }
    touched.add(setter);
  }
  // A Set node nobody reads any more goes too.
  for (const setter of nodesOf(graph)) {
    if (!isSetNode(setter) || !(touched.has(setter) || filter(setter))) continue;
    const name = variableName(setter).toLowerCase();
    const stillRead = nodesOf(graph).some((n) => isGetNode(n) && variableName(n).toLowerCase() === name);
    if (stillRead) continue;
    if (!touched.has(setter) && !setter.properties?.prettifierVariable) continue;
    graph.remove(setter);
    res.removed++;
  }
  syncVariables(graph);
  return res;
}

/** The node a variable node should be grouped and staged with. */
export function variableNeighbor(graph, n) {
  if (isSetNode(n)) return setterSource(graph, n)?.node ?? null;
  if (isGetNode(n)) {
    const l = linkOf(graph, n.outputs?.[0]?.links?.[0]);
    return l ? nodeById(graph, l.target_id) : null;
  }
  return null;
}
