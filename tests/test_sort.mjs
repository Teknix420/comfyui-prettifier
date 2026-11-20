// "Sort Unconnected Nodes By": notes and nodes with no links come out in node ID
// order, title order, or the order they are in now, and stay there on repeat runs.
import assert from "node:assert/strict";
import { computeLayout } from "../web/layout.js";

const note = (id, title, x, y, h = 300) => ({ id, type: "MarkdownNote", title, isNote: true, x, y, w: 210, h, fitW: 210, fitH: h });
const plain = (id, title, x, y, extra = {}) => ({ id, type: "Prim", title, x, y, w: 200, h: 100, fitW: 200, fitH: 100, inSlots: [45], outSlots: [45], ...extra });

// The notes from the bug report: ids 1 3 5 8 7 4 in one row, 2 6 in the next.
const titles = { 1: "Model Links", 2: "MiniMax Music 3", 3: "Caption 10", 4: "Caption 2", 5: "Lyrics B", 6: "lyrics a", 7: "System Caption", 8: "System Lyrics" };
const reported = () => {
  const row1 = [1, 3, 5, 8, 7, 4], row2 = [2, 6];
  return [
    ...row1.map((id, i) => note(id, titles[id], i * 235, 0, 440 + (id % 3) * 20)),
    ...row2.map((id, i) => note(id, titles[id], i * 235, 540, 400)),
  ];
};
const model = (nodes, edges = [], groups = []) => ({ titleH: 30, nodes, edges, groups });
// Reading order of the result: rows top to bottom, then left to right.
const order = (res, ids) => {
  const set = new Set(ids);
  return res.nodes.filter((n) => set.has(n.id)).sort((a, b) => a.y - b.y || a.x - b.x).map((n) => n.id);
};
const rerun = (m, res) => model(m.nodes.map((n) => ({ ...n, ...Object.fromEntries(Object.entries(res.nodes.find((r) => r.id === n.id)).filter(([k]) => "xywh".includes(k))) })), m.edges, m.groups);
const all = [1, 2, 3, 4, 5, 6, 7, 8];
let checks = 0;
const eq = (got, want, msg) => { assert.deepEqual(got, want, msg); checks++; console.log("ok   " + msg); };

for (const packing of ["flow", "pack"]) {
  // Notes: default is node ID
  let m = model(reported());
  let res = computeLayout(m, { packing });
  eq(order(res, all), all, `${packing}: notes sort by node ID by default`);
  eq(order(computeLayout(rerun(m, res), { packing }), all), all, `${packing}: and stay that way on a second run`);

  res = computeLayout(m, { packing, looseSort: "title" });
  // number aware (Caption 2 before Caption 10) and case blind (lyrics a before Lyrics B)
  eq(order(res, all), [4, 3, 6, 5, 2, 1, 7, 8], `${packing}: notes sort by title A to Z`);

  // Current position: a wrapped band must come back in the same order (it used to
  // shuffle the rows together, because it sorted left to right first).
  m = model(reported().map((n) => ({ ...n, w: 400, fitW: 400 })));
  res = computeLayout(m, { packing, looseSort: "position" });
  const first = order(res, all);
  eq(first, [1, 3, 5, 8, 7, 4, 2, 6], `${packing}: current position keeps the reading order`);
  assert.ok(new Set(res.nodes.map((n) => n.y)).size > 1, "the band wraps");
  let m2 = m;
  for (let i = 0; i < 3; i++) {
    m2 = rerun(m2, res);
    res = computeLayout(m2, { packing, looseSort: "position" });
    eq(order(res, all), first, `${packing}: current position is stable on run ${i + 2}`);
  }
}

// Unconnected nodes that are not notes, next to a linked chain.
const chain = [plain(20, "A", 0, 0), plain(21, "B", 300, 0)];
const edges = [{ from: 20, to: 21, fromSlot: 0, toSlot: 0 }];
const looseIds = [9, 4, 12, 7, 3];
const loose = () => looseIds.map((id, i) => plain(id, ["Zeta", "alpha", "Node 10", "Node 9", "Beta"][i], 100 + i * 37, 400 + ((i * 53) % 90)));
for (const isolatedPlacement of ["bottom", "right"]) {
  for (const direction of ["LR", "TB"]) {
    const o = { groupBy: "none", isolatedPlacement, direction };
    const m = model([...chain, ...loose()], edges);
    const seq = (res) => {
      // rows below read left to right; a column to the right reads top to bottom
      const set = new Set(looseIds);
      const ns = res.nodes.filter((n) => set.has(n.id));
      const uniq = (k) => new Set(ns.map((n) => Math.round(n[k]))).size;
      const col = uniq("x") < uniq("y");
      return ns.sort((a, b) => (col ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x)).map((n) => n.id);
    };
    let res = computeLayout(m, o);
    eq(seq(res), [3, 4, 7, 9, 12], `${isolatedPlacement}/${direction}: unconnected nodes sort by node ID`);
    eq(seq(computeLayout(m, { ...o, looseSort: "title" })), [4, 3, 7, 12, 9], `${isolatedPlacement}/${direction}: and by title`);
    res = computeLayout(m, { ...o, looseSort: "position" });
    const first = seq(res);
    eq(seq(computeLayout(rerun(m, res), { ...o, looseSort: "position" })), first, `${isolatedPlacement}/${direction}: current position is stable`);
    // linked nodes are not reordered
    const a = res.nodes.find((n) => n.id === 20), b = res.nodes.find((n) => n.id === 21);
    assert.ok(direction === "TB" ? a.y < b.y : a.x < b.x, "the chain still flows forward");
  }
}

// Inside an existing group: unconnected members sort too.
{
  const members = [8, 2, 5].map((id, i) => plain(id, "N" + id, 40, 60 + i * 130, { groups: [0] }));
  const m = model(members, [], [{ index: 0, title: "Stuff", x: 20, y: 20, w: 260, h: 460 }]);
  for (const packing of ["flow", "pack"]) {
    const res = computeLayout(m, { groupBy: "existing", packing });
    eq(order(res, [8, 2, 5]), [2, 5, 8], `${packing}: unconnected nodes inside a group sort by node ID`);
  }
}
console.log(`All ${checks} sort checks passed`);
