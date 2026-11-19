// Reroute cleanup: links detour around nodes and around groups they don't belong to.
// Uses a minimal fake graph, so it runs in plain Node.
import { cleanReroutes } from "../web/extras.js";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!ok) failed++;
};

function makeGraph(nodes, links, groups) {
  let nextId = 1;
  const g = {
    _nodes: nodes,
    _groups: groups.map((b) => ({ _bounding: b })),
    links: new Map(links.map((l, i) => [i + 1, { id: i + 1, origin_id: l[0], origin_slot: 0, target_id: l[1], target_slot: 0, path: [] }])),
    reroutes: new Map(),
    removeReroute(id) {
      this.reroutes.delete(id);
    },
    // Like LiteGraph: inserts the new dot before the given link or dot.
    createReroute(pos, before) {
      const link = before.path ? before : before.link;
      const r = { id: nextId++, pos, link, linkIds: new Set([link.id]) };
      const at = before.path ? link.path.length : link.path.indexOf(before);
      link.path.splice(at, 0, r);
      this.reroutes.set(r.id, r);
      return r;
    },
  };
  return g;
}
const node = (id, x, y, w = 200, h = 100) => ({ id, pos: [x, y], size: [w, h], flags: {} });

function pathOf(graph, linkId, a, b) {
  const link = graph.links.get(linkId);
  const pt = (n, isInput) => [n.pos[0] + (isInput ? 0 : n.size[0]), n.pos[1] + 14];
  return [pt(a, false), ...link.path.map((r) => r.pos), pt(b, true)];
}
function crossesRect(path, [x, y, w, h]) {
  for (let i = 0; i + 1 < path.length; i++) {
    for (let t = 0; t <= 1; t += 0.01) {
      const px = path[i][0] + (path[i + 1][0] - path[i][0]) * t;
      const py = path[i][1] + (path[i + 1][1] - path[i][1]) * t;
      if (px > x && px < x + w && py > y && py < y + h) return true;
    }
  }
  return false;
}

const base = { rerouteBend: "near", rerouteMode: "auto", rerouteClearance: 16, rerouteMinLength: 300, hGap: 80 };

// A --> B with a group in between whose only node sits below the straight line.
{
  const A = node(1, 0, 0), B = node(2, 1200, 0), C = node(3, 520, 260);
  const rect = [480, -80, 280, 480];
  const g = makeGraph([A, B, C], [[1, 2]], [rect]);
  const r = cleanReroutes(g, [A, B, C], { ...base, rerouteAvoidGroups: true });
  check("group in the way adds dots", r.added === 2, JSON.stringify(r));
  check("rerouted link stays out of the group", !crossesRect(pathOf(g, 1, A, B), rect));

  const g2 = makeGraph([A, B, C], [[1, 2]], [rect]);
  const r2 = cleanReroutes(g2, [A, B, C], { ...base, rerouteAvoidGroups: false });
  check("option off leaves the link straight", r2.added === 0, JSON.stringify(r2));
}

// A link that ends inside a group is allowed to enter it.
{
  const A = node(1, 0, 0), B = node(2, 700, 0);
  const g = makeGraph([A, B], [[1, 2]], [[600, -80, 400, 300]]);
  const r = cleanReroutes(g, [A, B], { ...base, rerouteAvoidGroups: true });
  check("target's own group is not an obstacle", r.added === 0, JSON.stringify(r));
}

// Both ends in the same group: no detour, even though the line is inside the group.
{
  const A = node(1, 0, 0), B = node(2, 700, 0);
  const g = makeGraph([A, B], [[1, 2]], [[-40, -80, 1000, 300]]);
  const r = cleanReroutes(g, [A, B], { ...base, rerouteAvoidGroups: true });
  check("link inside its own group is left alone", r.added === 0, JSON.stringify(r));
}

// A node in the way still works, and the lane clears a neighbouring group as well.
{
  const A = node(1, 0, 0), B = node(2, 1400, 0), C = node(3, 500, -20), D = node(4, 820, -300);
  const rect = [780, -380, 300, 340]; // sits just above the line, where the detour would go
  const g = makeGraph([A, B, C, D], [[1, 2]], [rect]);
  const r = cleanReroutes(g, [A, B, C, D], { ...base, rerouteAvoidGroups: true });
  const path = pathOf(g, 1, A, B);
  check("node in the way adds dots", r.added === 2, JSON.stringify(r));
  check("detour avoids the node", !crossesRect(path, [500, -50, 200, 130]));
  check("detour avoids the nearby group", !crossesRect(path, rect));
}

// --- stay level -----------------------------------------------------------------
const levelOpts = { ...base, rerouteStyle: "level" };
const levelLength = (path) => {
  let n = 0;
  for (let i = 0; i + 1 < path.length; i++) if (Math.abs(path[i][1] - path[i + 1][1]) < 1) n += Math.abs(path[i + 1][0] - path[i][0]);
  return n;
};

// The target is lower and a node sits on the straight line, but not at the source's height.
{
  const A = node(1, 0, 0), B = node(2, 1400, 400), C = node(3, 600, 150);
  const g = makeGraph([A, B, C], [[1, 2]], []);
  const r = cleanReroutes(g, [A, B, C], levelOpts);
  const path = pathOf(g, 1, A, B);
  check("level: one dot is enough when the source's height is clear", r.added === 1, JSON.stringify(r));
  check("level: runs level from the output", path[1][1] === path[0][1] && path[1][0] > 1300, JSON.stringify(path));
  check("level: avoids the node", !crossesRect(path, [600, 120, 200, 130]));
}

// Something at the source's height: stay level up to it, then move to the input's height.
{
  const A = node(1, 0, 0), B = node(2, 1400, 300), C = node(3, 300, -20);
  const g = makeGraph([A, B, C], [[1, 2]], []);
  const r = cleanReroutes(g, [A, B, C], levelOpts);
  const path = pathOf(g, 1, A, B);
  check("level: two dots around a node", r.added === 2, JSON.stringify(r));
  check("level: first run and last run are level", path[0][1] === path[1][1] && path[2][1] === path[3][1], JSON.stringify(path));
  check("level: most of the link is level", levelLength(path) > 1000, String(levelLength(path)));
  check("level: avoids the node", !crossesRect(path, [300, -50, 200, 130]));
}

// Source and target at the same height with a node between: over it, level, and back down.
{
  const A = node(1, 0, 0), B = node(2, 1400, 0), C = node(3, 600, -20);
  const rect = [560, -100, 300, 260];
  const g = makeGraph([A, B, C], [[1, 2]], [rect]);
  const r = cleanReroutes(g, [A, B, C], { ...levelOpts, rerouteAvoidGroups: true });
  const path = pathOf(g, 1, A, B);
  check("level: three dots when it must return to the same height", r.added === 3, JSON.stringify(r));
  check("level: stays out of the group", !crossesRect(path, rect), JSON.stringify(path));
}

// An unblocked link gets no dots, level or not.
{
  const A = node(1, 0, 0), B = node(2, 1400, 400);
  const g = makeGraph([A, B], [[1, 2]], []);
  check("level: clear link is left alone", cleanReroutes(g, [A, B], levelOpts).added === 0);
}

// --- clearing old dots ------------------------------------------------------------
{
  const A = node(1, 0, 0), B = node(2, 1400, 0), C = node(3, 600, -20);
  const g = makeGraph([A, B, C], [[1, 2]], []);
  cleanReroutes(g, [A, B, C], { ...base, clearAll: true });
  const first = [...g.reroutes.values()].map((r) => r.pos.join());
  // Leftovers: a dot no link uses, and one whose link is gone.
  g.reroutes.set(900, { id: 900, pos: [5, 5], linkIds: new Set() });
  g.reroutes.set(901, { id: 901, pos: [9, 9], linkIds: new Set([777]) });
  g.links.get(1).path = [];
  const r = cleanReroutes(g, [A, B, C], { ...base, clearAll: true });
  const second = [...g.reroutes.values()].map((x) => x.pos.join());
  check("whole workflow clears every old dot", r.removed === 4 && !g.reroutes.has(900) && !g.reroutes.has(901), JSON.stringify(r));
  check("and puts the same dots back", first.join("|") === second.join("|") && second.length === 2, second.join("|"));

  g.reroutes.set(902, { id: 902, pos: [5, 5], linkIds: new Set() });
  g.links.get(1).path = [];
  const r2 = cleanReroutes(g, [A, B, C], { ...base });
  check("a selection leaves other dots alone", g.reroutes.has(902) && r2.removed === 2, JSON.stringify(r2));
}

// --- bends centered between columns ---------------------------------------------
{
  // Columns: A ends at 200, C spans 600..800, B starts at 1400.
  const A = node(1, 0, 0), B = node(2, 1400, 300), C = node(3, 600, -20);
  // rerouteMinLength 0 and a target low enough that the straight line clips C
  const B2 = node(2, 1400, 60);
  const g1 = makeGraph([A, B2, C], [[1, 2]], []);
  const r1 = cleanReroutes(g1, [A, B2, C], { ...base, rerouteBend: "center" });
  const p1 = pathOf(g1, 1, A, B2);
  check("center: detour dots sit mid-gap", r1.added === 2 && p1[1][0] === 400 && p1[2][0] === 1100, JSON.stringify(p1));
  check("center: detour avoids the node", !crossesRect(p1, [600, -50, 200, 130]));

  const g2 = makeGraph([A, B2, C], [[1, 2]], []);
  const r2 = cleanReroutes(g2, [A, B2, C], { ...base, rerouteBend: "center", rerouteStyle: "level" });
  const p2 = pathOf(g2, 1, A, B2);
  check("center + level: the step is vertical and mid-gap", r2.added >= 2 && p2[1][0] === 400 && p2[2][0] === 400, JSON.stringify(p2));
  check("center + level: avoids the node", !crossesRect(p2, [600, -50, 200, 130]));
  const last = p2[p2.length - 2], end = p2[p2.length - 1];
  check("center + level: enters the input level", Math.abs(last[1] - end[1]) < 1, JSON.stringify(p2));

  // Two links bending in the same gap do not sit on top of each other.
  const A2 = node(4, 0, 200), B3 = node(5, 1400, 200), C2 = node(6, 600, 180);
  const g3 = makeGraph([A, B2, C, A2, B3, C2], [[1, 2], [4, 5]], []);
  cleanReroutes(g3, [A, B2, C, A2, B3, C2], { ...base, rerouteBend: "center", rerouteStyle: "level" });
  const xs = [...g3.reroutes.values()].map((r) => r.pos[0]);
  check("center: bends in one gap fan out", new Set(xs).size > 1 && xs.every((x) => (x > 200 && x < 600) || (x > 800 && x < 1400)), xs.join());
}

// --- tight columns: stay level still works when nodes are close together ---------
{
  const A = node(1, 0, 0), C = node(3, 230, -20), B = node(2, 900, 300);
  const g = makeGraph([A, B, C], [[1, 2]], []);
  const r = cleanReroutes(g, [A, B, C], { ...base, hGap: 80, rerouteStyle: "level" });
  const path = pathOf(g, 1, A, B);
  check("level: finds a path with a 30px gap between columns", r.added >= 1 && path.slice(-2)[0][1] === path.slice(-1)[0][1], JSON.stringify(path));
  check("level: tight path avoids the node", !crossesRect(path, [230, -50, 200, 130]));
}

// --- direction preference and right-angle links ----------------------------------
{
  // Nothing in the way; ends at different heights.
  const A = node(1, 0, 0), B = node(2, 1400, 400);
  for (const [turn, x] of [["horizontal", 1360], ["vertical", 240]]) {
    const g = makeGraph([A, B], [[1, 2]], []);
    const r = cleanReroutes(g, [A, B], { ...base, rerouteTurn: turn });
    const p = pathOf(g, 1, A, B);
    check(`${turn} first: one turn, at the right end`, r.added === 2 && p[1][0] === x && p[2][0] === x && p[1][1] === p[0][1] && p[2][1] === p[3][1], JSON.stringify(p));
  }
  const gc = makeGraph([A, B], [[1, 2]], []);
  cleanReroutes(gc, [A, B], { ...base, rerouteBend: "center", rerouteTurn: "horizontal" });
  check("horizontal first + centered: the turn is mid-gap", pathOf(gc, 1, A, B)[1][0] === 800, JSON.stringify(pathOf(gc, 1, A, B)));
  const g0 = makeGraph([A, B], [[1, 2]], []);
  check("no preference: a clear link gets no dots", cleanReroutes(g0, [A, B], { ...base }).added === 0);
  const gs = makeGraph([A, node(2, 250, 400)], [[1, 2]], []);
  check("preference leaves short links alone", cleanReroutes(gs, gs._nodes, { ...base, rerouteTurn: "horizontal" }).added === 0);

  // The preferred turn is blocked, the other end is free.
  const C = node(3, 1000, -20);
  const g2 = makeGraph([A, B, C], [[1, 2]], []);
  cleanReroutes(g2, [A, B, C], { ...base, rerouteTurn: "horizontal" });
  const p2 = pathOf(g2, 1, A, B);
  check("horizontal first falls back to vertical first when blocked", p2[1][0] === 240 && !crossesRect(p2, [1000, -50, 200, 130]), JSON.stringify(p2));

  // Right-angle links: the half-way step of a clear diagonal can still hit a node.
  const D = node(4, 700, 150, 200, 100);
  const A3 = node(1, 0, 0), B3 = node(2, 1400, 500);
  const g3 = makeGraph([A3, B3, D], [[1, 2]], []);
  const diag = cleanReroutes(g3, [A3, B3, D], { ...base });
  const g4 = makeGraph([A3, B3, D], [[1, 2]], []);
  const orth = cleanReroutes(g4, [A3, B3, D], { ...base, linkOrthogonal: true });
  const p4 = pathOf(g4, 1, A3, B3);
  check("right-angle links: the drawn path is what gets tested", orth.added > 0, JSON.stringify([diag, orth]));
  check("right-angle detour leaves and enters level", p4[1][1] === p4[0][1] && p4[p4.length - 2][1] === p4[p4.length - 1][1], JSON.stringify(p4));
}

// --- forced lane above / below the whole workflow ---------------------------------
{
  const A = node(1, 0, 0), B = node(2, 1400, 0), C = node(3, 600, -20), E = node(5, 600, 400), F = node(6, 600, -500);
  const rect = [560, 340, 300, 260];
  for (const [where, test] of [["above", (y) => y < -530], ["below", (y) => y > 600]]) {
    const g = makeGraph([A, B, C, E, F], [[1, 2]], [rect]);
    const r = cleanReroutes(g, g._nodes, { ...base, rerouteLane: where });
    const p = pathOf(g, 1, A, B);
    check(`${where}: the lane is outside every node and group`, r.added === 2 && test(p[1][1]) && p[1][1] === p[2][1], JSON.stringify(p));
    const g2 = makeGraph([A, B, C, E, F], [[1, 2]], [rect]);
    cleanReroutes(g2, g2._nodes, { ...base, rerouteLane: where, linkOrthogonal: true });
    const p2 = pathOf(g2, 1, A, B);
    check(`${where} + right-angle links: four dots, level at both ends`, p2.length === 6 && p2[1][1] === p2[0][1] && p2[4][1] === p2[5][1] && p2[1][0] === p2[2][0], JSON.stringify(p2));
  }
  const g3 = makeGraph([A, node(2, 1400, 0)], [[1, 2]], []);
  check("forced lane leaves clear links alone", cleanReroutes(g3, g3._nodes, { ...base, rerouteLane: "above" }).added === 0);
}

// --- lanes shared by several links stay clear of what is next to them ---------------
{
  // Two links go around C. The second one's lane is moved over by 10 so the links do
  // not overlap; that must not push it into D, which sits just beyond the first lane.
  const A = node(1, 0, 0), A2 = node(5, 0, 20, 200, 60), B = node(2, 1400, 0), B2 = node(6, 1400, 20, 200, 60);
  const C = node(3, 500, -20, 300, 140), D = node(4, 500, -220, 300, 150);
  const all = [A, A2, B, B2, C, D];
  const g = makeGraph(all, [[1, 2], [5, 6]], []);
  cleanReroutes(g, all, { ...base, rerouteMinLength: 0 });
  const boxOf = (n) => [n.pos[0], n.pos[1] - 30, n.size[0], n.size[1] + 30];
  for (const [id, a, b] of [[1, A, B], [2, A2, B2]]) {
    const path = pathOf(g, id, a, b);
    check(`shared lane: link ${id} got dots`, path.length > 2, JSON.stringify(path));
    for (const o of [C, D]) check(`shared lane: link ${id} stays out of node ${o.id}`, !crossesRect(path, boxOf(o)), JSON.stringify(path));
  }
}

// --- a narrow (collapsed) node in a column of wider ones -----------------------------
{
  // S is collapsed and narrower than the nodes above and below it in its column, so
  // its link starts in the middle of the column. The step to the lane has to happen
  // in the gap beside the column, not through the neighbours.
  const S = node(1, 0, 300, 220, 100), U = node(2, 0, 0, 220, 250), V = node(3, 0, 380, 220, 250);
  S.flags.collapsed = true;
  S._collapsed_width = 120;
  S.size[0] = 120; // the fake path helper reads the output position from size
  const W = node(4, 300, 100, 300, 400), T = node(5, 1000, 290, 200, 100);
  const all = [S, U, V, W, T];
  const g = makeGraph(all, [[1, 5]], []);
  const r = cleanReroutes(g, all, { ...base, rerouteMinLength: 0, linkOrthogonal: true, rerouteBend: "center" });
  const raw = pathOf(g, 1, S, T);
  raw[0][1] = S.pos[1] - 15; // a collapsed node's output is on its title bar
  // Draw it the way right-angle links are drawn.
  const path = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    if (a[0] !== b[0] && a[1] !== b[1]) path.push([(a[0] + b[0]) / 2, a[1]], [(a[0] + b[0]) / 2, b[1]]);
    path.push(b);
  }
  check("narrow source: the link is rerouted", r.added >= 2, JSON.stringify(raw));
  for (const o of [U, V, W]) check(`narrow source: clear of node ${o.id}`, !crossesRect(path, [o.pos[0], o.pos[1] - 30, o.size[0], o.size[1] + 30]), JSON.stringify(path));
}

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all reroute checks passed");
