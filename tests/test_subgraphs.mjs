// Subgraph connectors: renaming, reordering and undo, on a minimal fake subgraph.
import assert from "node:assert/strict";
import { renameSubgraphSlots, reorderSubgraphSlots, snapshotSubgraphIO, restoreSubgraphIO, subgraphsInnerFirst } from "../web/subgraphs.js";

const node = (id, title, y, inputs, outputs) => ({
  id, title, pos: [300, y], size: [200, 100], flags: {},
  inputs: inputs.map((name) => ({ name, type: name.toUpperCase(), link: null })),
  outputs: outputs.map((name) => ({ name, type: name.toUpperCase(), links: [] })),
  getConnectionPos(isInput, i) { return [this.pos[0] + (isInput ? 0 : 200), this.pos[1] + 14 + i * 20]; },
});

function build() {
  // Inside: Top (y 0) takes "b", Bottom (y 400) takes "a" and "c"; output from Bottom then Top.
  const top = node(1, "Top", 0, ["b"], ["img"]);
  const bottom = node(2, "Bottom", 400, ["a", "c"], ["img"]);
  const links = new Map();
  let id = 0;
  const link = (o, os, t, ts) => { const l = { id: ++id, origin_id: o, origin_slot: os, target_id: t, target_slot: ts }; links.set(l.id, l); return l; };
  const sg = {
    name: "Sub", _nodes: [top, bottom], links,
    inputNode: { id: -10, pos: [0, 0], arrange() {} }, outputNode: { id: -20, pos: [900, 0], arrange() {} },
    inputs: ["a", "b", "c", "unused"].map((name) => ({ name, type: name.toUpperCase(), linkIds: [] })),
    outputs: ["first", "second"].map((name) => ({ name, type: "IMG", linkIds: [] })),
    getNodeById(i) { return this._nodes.find((n) => n.id == i); },
    renamed: [],
    renameInput(slot, name) { this.renamed.push(["in", this.inputs.indexOf(slot), name]); slot.label = name; },
    renameOutput(slot, name) { this.renamed.push(["out", this.outputs.indexOf(slot), name]); slot.label = name; },
  };
  const wire = (slotIdx, n, ts) => { const l = link(-10, slotIdx, n.id, ts); sg.inputs[slotIdx].linkIds.push(l.id); n.inputs[ts].link = l.id; };
  wire(0, bottom, 0); wire(1, top, 0); wire(2, bottom, 1);
  const out = (n, slotIdx) => { const l = link(n.id, 0, -20, slotIdx); sg.outputs[slotIdx].linkIds.push(l.id); n.outputs[0].links.push(l.id); };
  out(bottom, 0); out(top, 1);

  // Outside: a subgraph node fed by Src A (low on the canvas) into "a" and Src C (high) into "c".
  const inst = node(5, "Sub", 0, ["a", "b", "c", "unused"], ["first", "second"]);
  inst.subgraph = sg;
  const srcA = node(6, "Src A", 600, [], ["a"]);
  const srcC = node(7, "Src C", -200, [], ["c"]);
  const sink = node(8, "Sink", 0, ["x"], []);
  const rlinks = new Map();
  const rl = (o, os, t, ts) => { const l = { id: 100 + rlinks.size, origin_id: o.id, origin_slot: os, target_id: t.id, target_slot: ts }; rlinks.set(l.id, l); return l; };
  let l = rl(srcA, 0, inst, 0); inst.inputs[0].link = l.id; srcA.outputs[0].links.push(l.id);
  l = rl(srcC, 0, inst, 2); inst.inputs[2].link = l.id; srcC.outputs[0].links.push(l.id);
  l = rl(inst, 1, sink, 0); inst.outputs[1].links.push(l.id); sink.inputs[0].link = l.id;
  const root = { _nodes: [inst, srcA, srcC, sink], links: rlinks, subgraphs: new Map([["s", sg]]), getNodeById(i) { return this._nodes.find((n) => n.id == i); } };
  return { app: { graph: root }, root, sg, inst, top, bottom, srcA, srcC, sink };
}

// What each outside source ends up feeding inside, by name. Must never change.
function wiring({ root, sg, inst }) {
  const out = [];
  for (const l of root.links.values()) {
    if (l.target_id === inst.id) {
      const slot = sg.inputs[l.target_slot];
      assert.equal(inst.inputs[l.target_slot].link, l.id);
      for (const id of slot.linkIds) {
        const il = sg.links.get(id);
        assert.equal(il.origin_slot, l.target_slot);
        out.push(`${root.getNodeById(l.origin_id).title}>${sg.getNodeById(il.target_id).title}.${sg.getNodeById(il.target_id).inputs[il.target_slot].name}`);
      }
    }
    if (l.origin_id === inst.id) {
      const slot = sg.outputs[l.origin_slot];
      assert.ok(inst.outputs[l.origin_slot].links.includes(l.id));
      for (const id of slot.linkIds) {
        const il = sg.links.get(id);
        assert.equal(il.target_slot, l.origin_slot);
        out.push(`${sg.getNodeById(il.origin_id).title}>${root.getNodeById(l.target_id).title}`);
      }
    }
  }
  return out.sort().join(" | ");
}
const names = (list) => list.map((s) => s.name).join(",");

// --- rename
{
  const w = build();
  assert.equal(renameSubgraphSlots(w.app, w.sg, { subgraphSlotMode: "keep" }), 0);
  const n = renameSubgraphSlots(w.app, w.sg, { subgraphSlotMode: "template", subgraphSlotTemplate: "{node} {inner}[ from {source}]", slotLabelCase: "none" });
  assert.equal(n, 5); // the unconnected input has no tokens to fill and keeps its name
  assert.deepEqual(w.sg.inputs.map((s) => s.label), ["Bottom a from Src A", "Top b", "Bottom c from Src C", undefined]);
  assert.deepEqual(w.sg.outputs.map((s) => s.label), ["Bottom img", "Top img"]);
  assert.deepEqual(w.inst.inputs.map((s) => s.label), ["Bottom a from Src A", "Top b", "Bottom c from Src C", undefined]);
  assert.deepEqual(w.inst.outputs.map((s) => s.label), ["Bottom img", "Top img"]);
  assert.ok(w.sg.renamed.length >= 5);
  // running again changes nothing
  assert.equal(renameSubgraphSlots(w.app, w.sg, { subgraphSlotMode: "template", subgraphSlotTemplate: "{node} {inner}[ from {source}]" }), 0);
  assert.equal(renameSubgraphSlots(w.app, w.sg, { subgraphSlotMode: "reset" }), 5);
  assert.deepEqual(w.inst.inputs.map((s) => s.label), [undefined, undefined, undefined, undefined]);
}

// --- reorder to match the inside
{
  const w = build();
  const before = wiring(w);
  const snap = snapshotSubgraphIO(w.sg);
  assert.equal(reorderSubgraphSlots(w.app, w.sg, "inside"), 2);
  assert.equal(names(w.sg.inputs), "b,a,c,unused");
  assert.equal(names(w.inst.inputs), "b,a,c,unused");
  assert.equal(names(w.sg.outputs), "second,first");
  assert.equal(names(w.inst.outputs), "second,first");
  assert.equal(wiring(w), before);
  assert.equal(reorderSubgraphSlots(w.app, w.sg, "inside"), 0); // already in order
  // undo
  w.sg.inputs[0].label = "Changed";
  restoreSubgraphIO(w.app, snap);
  assert.equal(names(w.sg.inputs), "a,b,c,unused");
  assert.equal(names(w.inst.outputs), "first,second");
  assert.equal(w.sg.inputs[1].label, undefined);
  assert.equal(wiring(w), before);
}

// --- reorder to match the outside
{
  const w = build();
  const before = wiring(w);
  assert.equal(reorderSubgraphSlots(w.app, w.sg, "outside"), 1); // Src C is above Src A; outputs have one link
  assert.equal(names(w.sg.inputs), "c,unused,a,b");
  assert.equal(names(w.inst.inputs), "c,unused,a,b");
  assert.equal(wiring(w), before);
  assert.equal(reorderSubgraphSlots(w.app, w.sg, "keep"), 0);
}

// --- nesting order
{
  const w = build();
  const outerSg = { name: "Outer", _nodes: [{ id: 1, subgraph: w.sg, inputs: [], outputs: [], pos: [0, 0], size: [1, 1] }], inputs: [], outputs: [], inputNode: {}, links: new Map() };
  w.root.subgraphs = new Map([["o", outerSg], ["s", w.sg]]);
  assert.deepEqual(subgraphsInnerFirst(w.app).map((s) => s.name), ["Sub", "Outer"]);
}

console.log("All subgraph connector checks passed");
