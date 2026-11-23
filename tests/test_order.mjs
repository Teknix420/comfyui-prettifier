// "Respect Current Top-to-Bottom Order": nodes in one column keep the order they
// have on the canvas, unless that would make links cross. Crossing reduction used
// to reorder a whole connected section as soon as one crossing existed anywhere in it.
import assert from "node:assert/strict";
import { prettifyNodes } from "../web/graph.js";

globalThis.LiteGraph = { LGraphGroup: class { constructor(t) { this.title = t; this._bounding = [0, 0, 0, 0]; this.font_size = 24; } } };

function build({ swapPrompts = false, withCleaner = true } = {}) {
  let linkId = 0;
  const nodes = [];
  const links = new Map();
  const node = (id, x, y, h, nIn, nOut = 1) => {
    const n = {
      id, title: "N" + id, type: "T" + id, pos: [x, y], size: [300, h], flags: {},
      inputs: Array.from({ length: nIn }, () => ({ name: "in", type: "X", link: null })),
      outputs: Array.from({ length: nOut }, () => ({ name: "out", type: "X", links: [] })),
    };
    nodes.push(n);
    return n;
  };
  const link = (from, to, slot) => {
    const l = { id: ++linkId, origin_id: from.id, origin_slot: 0, target_id: to.id, target_slot: slot };
    links.set(l.id, l);
    from.outputs[0].links.push(l.id);
    to.inputs[slot].link = l.id;
  };
  // Column 1: an image loader, a connection and its options. Column 2..: a cleaner
  // after the loader, two prompts, then the generator they all feed.
  const image = node(1, 0, 100, 330, 0);
  const conn = node(2, 0, 560, 160, 0);
  const options = node(3, 0, 800, 400, 0);
  const promptA = node(4, 700, swapPrompts ? 480 : 100, 280, 0);
  const promptB = node(5, 700, swapPrompts ? 100 : 480, 240, 0);
  const generate = node(6, 1100, 100, 300, 7);
  const preview = node(7, 1500, 100, 350, 1);
  const video = node(8, 1900, 100, 400, 12);
  link(promptA, generate, 5);
  link(promptB, generate, 6);
  link(conn, generate, 0);
  link(options, generate, 1);
  link(generate, preview, 0);
  link(preview, video, 0);
  if (withCleaner) {
    const cleaner = node(9, 350, 100, 30, 1);
    link(image, cleaner, 0);
    link(cleaner, generate, 2);
    link(cleaner, video, 11);
  } else {
    link(image, generate, 2);
    link(image, video, 11);
  }
  const graph = { _nodes: nodes, _groups: [], links, remove() {}, add() {} };
  return { graph, nodes, promptA, promptB };
}

const OPTS = { noHistory: true, groupBy: "none", preserveOrder: true };

for (const withCleaner of [false, true]) {
  for (const swapPrompts of [false, true]) {
    const t = build({ swapPrompts, withCleaner });
    prettifyNodes({}, t.graph, t.nodes, OPTS);
    const label = `${withCleaner ? "with" : "without"} the extra node, prompts ${swapPrompts ? "swapped" : "as built"}`;
    assert.equal(t.promptA.pos[0], t.promptB.pos[0], `${label}: prompts share a column`);
    assert.equal(t.promptB.pos[1] < t.promptA.pos[1], swapPrompts, `${label}: prompts keep their canvas order`);
    // A second run leaves it alone.
    const before = t.nodes.map((n) => n.pos.join());
    prettifyNodes({}, t.graph, t.nodes, OPTS);
    assert.deepEqual(t.nodes.map((n) => n.pos.join()), before, `${label}: repeat run is stable`);
  }
}

console.log("All order checks passed");
