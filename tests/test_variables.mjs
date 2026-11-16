// Variables instead of long links: which links are picked, and how they are named.
import assert from "node:assert/strict";
import { pickVariableLinks, planVariableNames } from "../web/variables.js";

const boxes = [
  { id: 1, x: 0, y: 0, w: 200, h: 100 },
  { id: 2, x: 400, y: 0, w: 200, h: 100 },
  { id: 3, x: 2400, y: 0, w: 200, h: 100 },
  { id: 4, x: 400, y: 300, w: 200, h: 100 },
];
const links = [
  { id: "short", from: 1, to: 2, sx: 200, sy: 40, tx: 400, ty: 40 },
  { id: "long-blocked", from: 1, to: 3, sx: 200, sy: 60, tx: 2400, ty: 60 }, // runs through node 2
  { id: "long-clear", from: 4, to: 3, sx: 600, sy: 340, tx: 2400, ty: 80 },
  { id: "back", from: 2, to: 4, sx: 600, sy: 40, tx: 400, ty: 340 }, // right to left
];
assert.deepEqual(pickVariableLinks(links, boxes, {}), []); // off by default
assert.deepEqual(pickVariableLinks(links, boxes, { variableMode: "long", variableMinLength: 1500 }), ["long-blocked", "long-clear"]);
assert.deepEqual(pickVariableLinks(links, boxes, { variableMode: "long", variableMinLength: 2000 }), ["long-blocked"]);
assert.deepEqual(pickVariableLinks(links, boxes, { variableMode: "blocked" }), ["long-blocked", "back"]);
assert.deepEqual(pickVariableLinks(links, boxes, { variableMode: "both", variableMinLength: 1500 }), ["long-blocked", "long-clear", "back"]);
assert.deepEqual(pickVariableLinks(links, boxes, { variableMode: "long", variableMinLength: 100 }).length, 4);

// names
assert.deepEqual(
  planVariableNames([{ name: "MODEL", type: "MODEL", source: "Load Checkpoint" }, { name: "CLIP", type: "CLIP", source: "Load LoRA" }, { name: "CLIP", type: "CLIP", source: "Load Checkpoint" }], ["model"], "{name}"),
  ["MODEL 2", "CLIP", "CLIP 2"],
);
assert.deepEqual(planVariableNames([{ name: "CLIP", type: "CLIP", source: "Load LoRA" }], [], "{source} {name}"), ["Load LoRA CLIP"]);
assert.deepEqual(planVariableNames([{ name: "", type: "IMAGE", source: "" }, { name: "", type: "*", source: "" }], [], "{name}"), ["IMAGE", "value"]);

console.log("All variable checks passed");
