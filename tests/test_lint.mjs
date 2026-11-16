// Run with: node tests/test_lint.mjs
import { lintModel } from "../web/lint.js";
import assert from "node:assert/strict";

const nodes = [
  { id: 1, title: "Load Checkpoint", type: "CheckpointLoaderSimple", stage: "Models", mode: 0, inputs: [], outputs: [{ name: "MODEL", connected: true }],
    widgets: [{ name: "ckpt_name", value: "gone.safetensors", choices: ["a.safetensors"] }] },
  { id: 2, title: "Load Checkpoint", type: "CheckpointLoaderSimple", stage: "Models", mode: 0, inputs: [], outputs: [{ name: "MODEL", connected: false }],
    widgets: [{ name: "ckpt_name", value: "gone.safetensors", choices: ["a.safetensors"] }] },
  { id: 3, title: "KSampler", type: "KSampler", stage: "Sampling", mode: 0,
    inputs: [{ name: "model", required: true, connected: true }, { name: "latent_image", required: true, connected: false }],
    outputs: [{ name: "LATENT", connected: true }],
    widgets: [{ name: "steps", value: 500, min: 1, max: 10000 }, { name: "cfg", value: 8 }, { name: "denoise", value: 0 }] },
  { id: 4, title: "Save", type: "SaveImage", stage: "Output", isOutput: true, mode: 4, inputs: [{ name: "images", required: true, connected: false }], outputs: [], widgets: [] },
];
const f = lintModel(nodes);
const has = (id, re) => f.some((x) => x.nodeId === id && re.test(x.message));
assert.ok(has(1, /not in the list/));
assert.ok(has(2, /outputs are used/));
assert.ok(has(2, /Same loader/));
assert.ok(has(3, /"latent_image" is not connected/));
assert.ok(has(3, /500 steps/));
assert.ok(has(3, /Denoise is 0/));
assert.ok(has(4, /bypassed/));
assert.ok(!has(4, /not connected/)); // inactive nodes are not checked for inputs
assert.equal(f[0].severity, "error");
assert.equal(lintModel(nodes, { lintMissing: false, lintUnused: false, lintDuplicates: false, lintValues: false, lintInactive: false }).length, 0);
console.log("All lint checks passed");
