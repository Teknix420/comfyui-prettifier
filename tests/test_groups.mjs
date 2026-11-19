// Existing groups keep their collapsed (minimized) nodes. A collapsed node is drawn
// as its title bar only, while node.size still holds the expanded size.
import assert from "node:assert/strict";
import { readModel, prettifyNodes, nodeRect, fitGroupsToNodes, groupRect } from "../web/graph.js";

const TH = 30; // LiteGraph.NODE_TITLE_HEIGHT fallback
let linkId = 0;

const node = (id, title, x, y, w, h, nIn = 1, nOut = 1) => ({
  id, title, type: title, pos: [x, y], size: [w, h], flags: {},
  inputs: Array.from({ length: nIn }, () => ({ name: "in", type: "X", link: null })),
  outputs: Array.from({ length: nOut }, () => ({ name: "out", type: "X", links: [] })),
});
const group = (title, x, y, w, h) => ({ title, _bounding: [x, y, w, h], font_size: 24, color: "#335" });

function build() {
  // Group "Loaders": an expanded node on top and a collapsed one at the bottom edge.
  // The collapsed node's expanded size (300 tall) reaches far below the group and
  // into the group underneath it.
  const a = node(1, "Load", 40, 100, 220, 120, 0);
  const b = node(2, "Minimized", 40, 300, 220, 300);
  b.flags.collapsed = true;
  b._collapsed_width = 140;
  // Group "Sampling" to the right; group "Below" directly under "Loaders".
  const c = node(3, "Sample", 500, 100, 240, 200);
  const d = node(4, "Lower", 40, 520, 220, 120, 1, 0);
  const nodes = [a, b, c, d];
  const links = new Map();
  const link = (from, to) => {
    const l = { id: ++linkId, origin_id: from.id, origin_slot: 0, target_id: to.id, target_slot: 0 };
    links.set(l.id, l);
    from.outputs[0].links.push(l.id);
    to.inputs[0].link = l.id;
  };
  link(a, b);
  link(b, c);
  link(c, d);
  const groups = [
    group("Loaders", 20, 20, 260, 300), // y 20..320; the collapsed title bar is at 270..300
    group("Sampling", 480, 20, 280, 300),
    group("Below", 20, 440, 260, 220), // y 440..660; node 2's expanded center (y 435..) is near here
  ];
  const graph = { _nodes: nodes, _groups: groups, links, remove(g) { groups.splice(groups.indexOf(g), 1); }, add(g) { groups.push(g); } };
  return { graph, nodes, groups, a, b, c, d };
}

const inside = (n, g) => {
  const b = nodeRect(n, TH), r = groupRect(g);
  return b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h;
};

// 1. The model puts the collapsed node in the group it is drawn in.
{
  const { graph, nodes } = build();
  const m = readModel(graph, nodes);
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  assert.deepEqual(byId.get(1).groups, [0]);
  assert.deepEqual(byId.get(2).groups, [0], "collapsed node belongs to the group around its title bar");
  assert.deepEqual(byId.get(4).groups, [2]);
}

// 2. A collapsed node whose expanded body would reach into another group stays out of that group.
{
  const { graph, nodes, b } = build();
  b.pos[1] = 380; // title bar 350..380, between the groups; expanded center at y 515 is inside "Below"
  const m = readModel(graph, nodes);
  assert.deepEqual(m.nodes.find((n) => n.id === 2).groups, [], "a collapsed node between groups is in neither");
}

// 3. After a prettify every group still holds the same nodes, in every link style.
const app = {};
for (const extra of [{}, { linkOrthogonal: true, hGap: 40, vGap: 20 }, { groupBy: "existing" }, { widthMode: "fit", heightMode: "fit" }]) {
  const { graph, nodes, groups, a, b, c, d } = build();
  prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
  const label = JSON.stringify(extra);
  assert.equal(groups.length, 3, `groups kept ${label}`);
  assert.ok(inside(a, groups[0]), `expanded node stays in Loaders ${label}`);
  assert.ok(inside(b, groups[0]), `collapsed node stays in Loaders ${label}`);
  assert.ok(inside(c, groups[1]), `Sampling keeps its node ${label}`);
  assert.ok(inside(d, groups[2]), `Below keeps its node ${label}`);
  assert.ok(!inside(b, groups[2]), `collapsed node is not pulled into Below ${label}`);
  assert.ok(b.flags.collapsed, "still collapsed");
  assert.deepEqual(b.size, [220, 300], "expanded size untouched");
}

// 4. "Fit groups to nodes" wraps the title bar of a collapsed node, not its expanded size.
{
  const { graph, groups, b } = build();
  fitGroupsToNodes({ graph }, 20);
  const r = groupRect(groups[0]);
  assert.ok(inside(b, groups[0]));
  assert.equal(r.y + r.h, b.pos[1] + 20, "group ends one padding below the collapsed title bar");
}

console.log("All group checks passed");

// --- more group checks ------------------------------------------------------------
import { alignNodes } from "../web/graph.js";
globalThis.LiteGraph = { LGraphGroup: class { constructor(t) { this.title = t; this._bounding = [0, 0, 0, 0]; this.font_size = 24; } } };
const state = (nodes, groups) => JSON.stringify([nodes.map((n) => [...n.pos, ...n.size]), groups.map(groupRect)]);

// 5. Prettifying again changes nothing: the workflow must not drift on every run.
for (const extra of [{}, { linkOrthogonal: true, hGap: 40, vGap: 20 }, { groupBy: "stage", minGroupSize: 1 }, { groupPadding: 21 }, { gridSize: 16 }, { snapToGrid: false }]) {
  const { graph, nodes, groups } = build();
  prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
  const first = state(nodes, graph._groups);
  for (let i = 0; i < 3; i++) prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
  assert.equal(state(nodes, graph._groups), first, `a repeat run moves nothing ${JSON.stringify(extra)}`);
}

// 6. A group with a big title keeps its nodes below the title.
{
  const { graph, nodes, groups } = build();
  groups[0].font_size = 60;
  prettifyNodes(app, graph, nodes, { noHistory: true });
  const r = groupRect(groups[0]);
  for (const n of nodes.slice(0, 2)) assert.ok(nodeRect(n, TH).y >= r.y + Math.round(60 * 1.4), "node sits below a 60px group title");
  assert.equal(groups[0].font_size, 60, "title size untouched");
  // ... unless existing groups are restyled to the standard title size.
  const again = build();
  again.groups[0].font_size = 60;
  prettifyNodes(app, again.graph, again.nodes, { noHistory: true, groupRestyleExisting: true });
  assert.equal(again.groups[0].font_size, 24);
}

// 7. Auto: a selection inside a bigger group gets no new groups of its own.
{
  const { graph, a, b, c } = build();
  const before = graph._groups.length;
  prettifyNodes(app, graph, [a, c], { noHistory: true, isSelection: true });
  assert.equal(graph._groups.length, before, "no stage groups are created for part of an existing group");
  // With no groups anywhere, Auto still groups by stage.
  const bare = build();
  bare.graph._groups.length = 0;
  prettifyNodes(app, bare.graph, bare.nodes, { noHistory: true, minGroupSize: 1 });
  assert.ok(bare.graph._groups.length > 0, "auto groups by stage when the workflow has no groups");
}

// 8. Align tools use the drawn size of a collapsed node.
{
  const { a, b } = build(); // a: expanded 220x120 at y 100; b: collapsed (140 wide, title bar only) at y 300
  const fake = { canvas: { selected_nodes: { 1: a, 2: b }, graph: { _nodes: [a, b], _groups: [] } } };
  alignNodes(fake, "right");
  assert.equal(b.pos[0] + nodeRect(b, TH).w, a.pos[0] + a.size[0], "align right: collapsed node's drawn edge lines up");
  alignNodes(fake, "bottom");
  assert.equal(b.pos[1], a.pos[1] + a.size[1], "align bottom: collapsed title bar ends at the bottom edge");
  assert.deepEqual(b.size, [220, 300], "collapsed node keeps its expanded size");
}

console.log("All extra group checks passed");

// --- nested groups, pinned nodes, repeat runs ----------------------------------------
const overlap = (a, b) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const within = (b, r) => b.x >= r.x - 0.5 && b.y >= r.y - 0.5 && b.x + b.w <= r.x + r.w + 0.5 && b.y + b.h <= r.y + r.h + 0.5;

function graphOf(nodes, groups, pairs) {
  const links = new Map();
  for (const [from, to] of pairs) {
    const l = { id: ++linkId, origin_id: from.id, origin_slot: 0, target_id: to.id, target_slot: 0 };
    links.set(l.id, l);
    from.outputs[0].links.push(l.id);
    to.inputs[0].link = l.id;
  }
  return { _nodes: nodes, _groups: groups, links, remove(g) { groups.splice(groups.indexOf(g), 1); }, add(g) { groups.push(g); } };
}

// 9. Groups inside a group: the inner groups stay inside the outer one, and the
//    outer one does not grow over the group next to it.
for (const extra of [{}, { linkOrthogonal: true, hGap: 40, vGap: 20 }, { direction: "TB" }, { packing: "pack" }]) {
  const a = node(1, "A", 40, 120, 220, 120, 0), b = node(2, "B", 40, 300, 220, 160);
  const c = node(3, "C", 380, 120, 240, 200), d = node(4, "D", 380, 380, 240, 100);
  const e = node(5, "E", 60, 700, 220, 120), f = node(6, "F", 60, 880, 220, 120, 1, 0);
  const own = node(7, "Own", 700, 150, 200, 100); // sits in the outer group only
  const groups = [
    group("Inner 1", 20, 60, 260, 420),
    group("Inner 2", 360, 60, 280, 440),
    group("Outer", 0, 0, 940, 520),
    group("Neighbour", 40, 640, 260, 380),
  ];
  const nodes = [a, b, c, d, e, f, own];
  const graph = graphOf(nodes, groups, [[a, e], [e, c], [b, d], [c, own], [e, f]]);
  prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
  const [g1, g2, outer, other] = groups.map(groupRect);
  const tag = JSON.stringify(extra);
  assert.ok(within(g1, outer) && within(g2, outer), `inner groups stay inside the outer group ${tag}`);
  assert.ok(!overlap(g1, g2), `inner groups do not overlap ${tag}`);
  assert.ok(!overlap(outer, other), `the outer group stays off the group next to it ${tag}`);
  for (const n of [a, b]) assert.ok(within(nodeRect(n, TH), g1), `Inner 1 keeps its nodes ${tag}`);
  for (const n of [c, d]) assert.ok(within(nodeRect(n, TH), g2), `Inner 2 keeps its nodes ${tag}`);
  assert.ok(within(nodeRect(own, TH), outer), `the outer group keeps its own node ${tag}`);
  assert.ok(!overlap(nodeRect(own, TH), g1) && !overlap(nodeRect(own, TH), g2), `the outer group's own node is not inside an inner group ${tag}`);
  for (const n of [e, f]) {
    assert.ok(within(nodeRect(n, TH), other), `the neighbour keeps its nodes ${tag}`);
    assert.ok(!overlap(nodeRect(n, TH), outer), `the neighbour's nodes are not covered by the outer group ${tag}`);
  }
}

// 10. A pinned node stays where it is, and its group is not stretched to reach it.
{
  const a = node(1, "A", 40, 100, 220, 120, 0), b = node(2, "B", 40, 300, 220, 120), c = node(3, "C", 40, 500, 220, 120, 1, 0);
  b.flags.pinned = true;
  const groups = [group("Stack", 20, 40, 260, 600)];
  const nodes = [a, b, c];
  const graph = graphOf(nodes, groups, [[a, c]]);
  // Move the two free nodes far from the pinned one before the run.
  for (const n of [a, c]) n.pos[0] += 3000;
  groups[0]._bounding[2] = 3260; // the group as the editor would have it: around all three
  prettifyNodes(app, graph, nodes, { noHistory: true });
  assert.deepEqual([...b.pos], [40, 300], "the pinned node does not move");
  const g = groupRect(groups[0]);
  for (const n of [a, c]) assert.ok(within(nodeRect(n, TH), g), "the group wraps the nodes that were laid out");
  assert.ok(g.w < 1000, `the group is not stretched across the canvas to the pinned node (width ${g.w})`);
}

// 11. Random workflows: a second prettify never moves anything.
{
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ri = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  for (let s = 1; s <= 60; s++) {
    seed = s * 7919;
    const nodes = [], groups = [], pairs = [];
    let id = 0, gx = 0;
    const mk = (x, y) => {
      const n = node(++id, "N" + id, x, y, ri(160, 320), ri(60, 300), ri(1, 3), ri(1, 2));
      n.type = "T" + (id % 5);
      if (rnd() < 0.25) {
        n.flags.collapsed = true;
        n._collapsed_width = ri(100, 180);
      }
      nodes.push(n);
      return n;
    };
    for (let g = ri(2, 5); g > 0; g--) {
      let y = 100, w = 0;
      for (let i = ri(1, 5); i > 0; i--) {
        const r = nodeRect(mk(gx + 20, y + TH), TH);
        y += r.h + 30;
        w = Math.max(w, r.w);
      }
      groups.push(group("G" + groups.length, gx, 46, w + 40, y - 46));
      gx += w + ri(60, 200);
    }
    for (let i = ri(0, 4); i > 0; i--) mk(ri(0, gx), ri(900, 1400));
    const graph = graphOf(nodes, groups, []);
    for (const to of nodes) {
      to.inputs.forEach((slot, si) => {
        const before = nodes.filter((n) => n.id < to.id);
        if (rnd() < 0.3 || !before.length) return;
        const from = before[ri(0, before.length - 1)], os = ri(0, from.outputs.length - 1);
        const l = { id: ++linkId, origin_id: from.id, origin_slot: os, target_id: to.id, target_slot: si };
        graph.links.set(l.id, l);
        from.outputs[os].links.push(l.id);
        slot.link = l.id;
      });
    }
    for (const extra of [{ linkOrthogonal: true, hGap: 40, vGap: 20 }, { packing: "wrap" }]) {
      prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
      const first = state(nodes, graph._groups);
      prettifyNodes(app, graph, nodes, { noHistory: true, ...extra });
      assert.equal(state(nodes, graph._groups), first, `a second run moves nothing (workflow ${s}, ${JSON.stringify(extra)})`);
    }
  }
}

console.log("All nested / pinned / repeat-run checks passed");
