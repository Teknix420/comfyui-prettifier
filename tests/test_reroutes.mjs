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

const base = { rerouteMode: "auto", rerouteClearance: 16, rerouteMinLength: 300, hGap: 80 };

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

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all reroute checks passed");
