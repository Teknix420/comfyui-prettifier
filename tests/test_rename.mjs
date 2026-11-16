// Run with: node tests/test_rename.mjs
import { computeRenames, computeSubgraphSlotLabels, fillTemplate, applyCase, parseRules } from "../web/rename.js";
import assert from "node:assert/strict";

const nodes = [
  { id: 1, title: "Load Checkpoint", defaultTitle: "Load Checkpoint", type: "CheckpointLoaderSimple", stage: "Models", category: "loaders", group: "", x: 0, y: 0,
    widgets: { ckpt_name: "sdxl.safetensors" }, inputs: [], outputs: [{ name: "MODEL", type: "MODEL" }, { name: "CLIP", type: "CLIP" }] },
  { id: 2, title: "CLIP Text Encode (Prompt)", defaultTitle: "CLIP Text Encode (Prompt)", type: "CLIPTextEncode", stage: "Prompt", category: "conditioning", group: "Prompts", x: 300, y: 0,
    widgets: { text: "a cat" }, inputs: [{ name: "clip", type: "CLIP", connected: true, sourceId: 1, sourceSlot: 1 }], outputs: [{ name: "CONDITIONING", type: "CONDITIONING" }] },
  { id: 3, title: "My negative", defaultTitle: "CLIP Text Encode (Prompt)", type: "CLIPTextEncode", stage: "Prompt", category: "conditioning", group: "Prompts", x: 300, y: 200,
    widgets: { text: "blurry" }, inputs: [{ name: "clip", type: "CLIP", connected: true, sourceId: 1, sourceSlot: 1 }], outputs: [{ name: "CONDITIONING", type: "CONDITIONING" }] },
  { id: 4, title: "KSampler", defaultTitle: "KSampler", type: "KSampler", stage: "Sampling", category: "sampling", group: "", x: 600, y: 0,
    widgets: { sampler_name: "euler", steps: 20 },
    inputs: [{ name: "model", type: "MODEL", connected: true, sourceId: 1, sourceSlot: 0 }, { name: "latent_image", type: "LATENT", connected: false }], outputs: [{ name: "LATENT", type: "LATENT" }] },
];

// defaults change nothing
let r = computeRenames(nodes, {});
assert.equal(r.titles.size + r.inputs.size + r.outputs.size, 0);

// template + tokens + optional section
assert.equal(fillTemplate("{stage}: {default}[ ({widget:sampler_name})]", { stage: "Sampling", default: "KSampler", widgets: { sampler_name: "euler" } }), "Sampling: KSampler (euler)");
assert.equal(fillTemplate("{name}[ <- {source}]", { name: "clip", source: "" }), "clip");

// only untouched nodes, numbering duplicates
r = computeRenames(nodes, { nodeTitleMode: "template", nodeTitleTemplate: "{stage}: {default}", nodeTitleApplyTo: "untouched" });
assert.equal(r.titles.get(2), "Prompt: CLIP Text Encode (Prompt)");
assert.equal(r.titles.has(3), false);

r = computeRenames(nodes, { nodeTitleMode: "default", nodeNumbering: "duplicates" });
assert.equal(r.titles.get(2), "CLIP Text Encode (Prompt) 1");
assert.equal(r.titles.get(3), "CLIP Text Encode (Prompt) 2");
assert.equal(r.titles.has(4), false);

// rules with a type filter, type filter option
r = computeRenames(nodes, { nodeTitleMode: "template", nodeTitleRules: "CLIPTextEncode :: ^.*$ => Prompt; \\s*\\(.*\\) => ", nodeTypeFilter: "CLIP|KSampler", nodeNumbering: "duplicates" });
assert.equal(r.titles.get(2), "Prompt 1");
assert.equal(r.titles.get(3), "Prompt 2");
assert.equal(r.titles.has(1), false);

// widget token
r = computeRenames(nodes, { nodeTitleMode: "template", nodeTitleTemplate: "{default}[ - {widget:ckpt_name}]", nodeTypeFilter: "Checkpoint" });
assert.equal(r.titles.get(1), "Load Checkpoint - sdxl.safetensors");

// case
assert.equal(applyCase("latent_image", "title"), "Latent Image");
assert.equal(applyCase("load VAE for KSampler", "title"), "Load VAE for KSampler");

// connector labels
r = computeRenames(nodes, { slotLabelMode: "template", slotLabelTemplate: "{name}[ ← {source}]", slotApplyTo: "inputs" });
assert.deepEqual(r.inputs.get(4), ["model ← Load Checkpoint", undefined]);
assert.equal(r.outputs.size, 0);

r = computeRenames(nodes, { slotLabelMode: "template", slotLabelCase: "title", slotOnlyConnected: true });
assert.deepEqual(r.inputs.get(4), ["Model", undefined]);

r = computeRenames(nodes, { slotLabelMode: "type" });
assert.deepEqual(r.inputs.get(4), ["MODEL", "LATENT"]);
assert.equal(r.outputs.size, 0); // outputs are already named after their type

const labelled = structuredClone(nodes);
labelled[3].inputs[0].label = "custom";
r = computeRenames(labelled, { slotLabelMode: "reset" });
assert.deepEqual(r.inputs.get(4), [null, undefined]);

assert.equal(parseRules("a => b; bad( => c; T :: x => y").length, 2);
// {source} for an input fed by something that is not a node (a subgraph's input panel)
r = computeRenames([{ id: 9, title: "Sampler", type: "KSampler", x: 0, y: 0, inputs: [{ name: "model", type: "MODEL", connected: true, sourceId: -10, sourceSlot: 0, sourceTitle: "Base model", sourceSlotName: "Base model" }], outputs: [] }], { slotLabelMode: "template", slotLabelTemplate: "{name}[ ← {source}]" });
assert.deepEqual(r.inputs.get(9), ["model ← Base model"]);

// subgraph connectors
const sgSlots = [
  { name: "clip", type: "CLIP", connected: true, inner: "clip", node: "Positive", source: "Load LoRA" },
  { name: "latent_image", type: "LATENT", connected: true, inner: "latent_image", node: "KSampler", source: "" },
  { name: "text", type: "STRING", connected: true, inner: "text", node: "Positive" },
  { name: "text_1", type: "STRING", connected: true, inner: "text", node: "Negative" },
  { name: "spare", label: "Old", type: "INT", connected: false },
];
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, {}), [undefined, undefined, undefined, undefined, undefined]); // keep
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "template", slotLabelCase: "title" }), [
  "Clip", "Latent Image", "Text", "Text 1", "Spare",
]);
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "template", subgraphSlotTemplate: "{node}: {inner}[ ({source})]" }), [
  "Positive: clip (Load LoRA)", "KSampler: latent_image", "Positive: text", "Negative: text", ":",
]);
// duplicates are numbered, unconnected ones can be skipped
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "template", subgraphSlotTemplate: "{inner}", slotOnlyConnected: true }), [
  undefined, undefined, "text 1", "text 2", undefined,
]);
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "type" }), ["CLIP", "LATENT", "STRING 1", "STRING 2", "INT"]);
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "reset" }), [undefined, undefined, undefined, undefined, null]);
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "type", slotApplyTo: "outputs" }, { side: "inputs" }), [undefined, undefined, undefined, undefined, undefined]);
assert.deepEqual(computeSubgraphSlotLabels(sgSlots, { subgraphSlotMode: "template", slotLabelRules: "STRING :: ^text.*$ => Prompt; _image => " }).slice(1, 4), ["latent", "Prompt 1", "Prompt 2"]);

console.log("All rename checks passed");
