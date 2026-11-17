// Color helpers, palettes and node coloring rules. Runs in plain Node.
import { parseColor, shade, nodeColorsFrom, parseColorRules, planNodeColors } from "../web/colors.js";
import { PALETTES, resolvePalette } from "../web/themes.js";
import { STAGES, computeLayout } from "../web/layout.js";
import { LINK_SCHEMES, linkColorsFor, groupFillAlpha } from "../web/display.js";

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " " + extra : ""}`);
  if (!ok) failed++;
};
const lum = (c) => {
  const [r, g, b] = parseColor(c);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
};

check("parses #rgb, #rrggbb and rgb()", String(parseColor("#abc")) === "170,187,204" && String(parseColor("#3F789E")) === "63,120,158" && String(parseColor("rgb(1, 2, 3)")) === "1,2,3");
check("rejects other text", parseColor("tomato") === null && parseColor("") === null);
check("shade darkens", shade("#808080", 0.5) === "#404040");
const nc = nodeColorsFrom("#ffffff");
check("node colors stay dark enough for light text", lum(nc.color) <= 0.21 && lum(nc.bgcolor) <= 0.31 && lum(nc.color) < lum(nc.bgcolor), JSON.stringify(nc));

// Every palette covers every stage with usable colors.
for (const [name, p] of Object.entries(PALETTES)) {
  const ok = STAGES.every((s) => parseColor(p.group[s]) && (p.node[s] === null || (parseColor(p.node[s].color) && parseColor(p.node[s].bgcolor))));
  check(`palette ${name} is complete`, ok);
}
check("there are at least 15 palettes", Object.keys(PALETTES).length >= 15, String(Object.keys(PALETTES).length));
check("unknown palette falls back to the default", resolvePalette({ palette: "nope" }) === PALETTES.default);

const nodes = [
  { id: 1, type: "CheckpointLoaderSimple", title: "Load Checkpoint", category: "loaders", stage: "Models", groupColor: "#3f789e" },
  { id: 2, type: "KSampler", title: "KSampler", category: "sampling", stage: "Sampling", groupColor: "#a1309b" },
  { id: 3, type: "KSampler", title: "Second pass", category: "sampling", stage: "Sampling", groupColor: null },
  { id: 4, type: "SaveImage", title: "Save Image", category: "image", stage: "Output", groupColor: "#3f789e" },
];
const pal = PALETTES.nord;

const keep = planNodeColors(nodes, { colorNodes: "keep" }, pal);
check("keep changes nothing", keep.size === 0);

const group = planNodeColors(nodes, { colorNodes: "group" }, pal);
check("group: nodes in the same group match", group.get(1).bgcolor === group.get(4).bgcolor && group.get(1).bgcolor !== group.get(2).bgcolor);
check("group: the node is a darker shade of its group", lum(group.get(1).bgcolor) < lum("#3f789e"));
check("group: a node outside any group is reset", group.get(3) === null);

const type = planNodeColors(nodes, { colorNodes: "type" }, pal);
check("type: same type, same color", type.get(2).color === type.get(3).color && !!type.get(1));

const cat = planNodeColors(nodes, { colorNodes: "category" }, pal);
check("category: same category, same color", cat.get(2).color === cat.get(3).color);

const stage = planNodeColors(nodes, { colorNodes: "stage" }, pal);
check("stage: uses the palette's node colors", stage.get(1) === pal.node.Models && stage.get(4) === pal.node.Output);

const clear = planNodeColors(nodes, { colorNodes: "clear" }, pal);
check("clear resets every node", [...clear.values()].every((v) => v === null) && clear.size === 4);

check("rules parse and skip bad entries", parseColorRules("KSampler = #8e44ad; broken; x = notacolor; Save|Preview = #a93226").length === 2);
const ruled = planNodeColors(nodes, { colorNodes: "keep", nodeColorRules: "KSampler = #8e44ad; Save = #a93226" }, pal);
check("rules color matching nodes even with keep", ruled.size === 3 && ruled.get(2).color === nodeColorsFrom("#8e44ad").color && !ruled.has(1));
const mixed = planNodeColors(nodes, { colorNodes: "group", nodeColorRules: "KSampler = #8e44ad" }, pal);
check("a rule wins over the mode", mixed.get(2).color === nodeColorsFrom("#8e44ad").color && mixed.get(1).color === group.get(1).color);

// Group color "cycle": every new group gets a different palette color.
{
  const slots = (n) => Array.from({ length: n }, (_, i) => 30 + (i + 0.7) * 20);
  const mk = (id, type, category, ins, outs) => ({ id, type, category, x: id * 300, y: 0, w: 200, h: 100, fitW: 200, fitH: 100, inSlots: slots(ins), outSlots: slots(outs), groups: [], isOutput: type === "SaveImage" });
  const model = {
    titleH: 30, groups: [],
    nodes: [mk(1, "CheckpointLoaderSimple", "loaders", 0, 1), mk(2, "CLIPTextEncode", "conditioning", 1, 1), mk(3, "KSampler", "sampling", 1, 1), mk(4, "SaveImage", "image", 1, 0)],
    edges: [[1, 2], [2, 3], [3, 4]].map(([from, to]) => ({ from, fromSlot: 0, to, toSlot: 0 })),
  };
  const res = computeLayout(model, { groupBy: "stage", minGroupSize: 1, groupColor: "cycle", stageGroupColors: pal.group });
  const colors = res.newGroups.map((g) => g.color);
  check("cycle: each group gets its own palette color", colors.length >= 3 && new Set(colors).size === colors.length && colors.every((c) => Object.values(pal.group).includes(c)), colors.join());
}

// Link colors by data type.
{
  const types = ["MODEL", "CLIP", "VAE", "LATENT", "IMAGE", "MASK", "CONDITIONING", "MY_CUSTOM_TYPE", "ANOTHER"];
  for (const name of Object.keys(LINK_SCHEMES)) {
    const c = linkColorsFor(types, name);
    check(`link scheme ${name}: every type gets a color`, types.every((t) => parseColor(c[t])));
  }
  const v = linkColorsFor(types, "vivid");
  check("link colors: main types are all different", new Set(["MODEL", "CLIP", "VAE", "LATENT", "IMAGE", "MASK", "CONDITIONING"].map((t) => v[t])).size === 7);
  check("link colors: stable for unknown types", linkColorsFor(["MY_CUSTOM_TYPE"], "vivid").MY_CUSTOM_TYPE === v.MY_CUSTOM_TYPE);
  const p = linkColorsFor(types, "palette", pal.group);
  check("link colors: palette mode follows the stage colors", p.MODEL === pal.group.Models && p.LATENT === pal.group.Latent && p.IMAGE === pal.group.Image && !!p.MY_CUSTOM_TYPE);
  check("link colors: unknown scheme changes nothing", Object.keys(linkColorsFor(types, "nope")).length === 0);
}
check("group fill: outline is clear, default is ComfyUI's, fill uses the slider", groupFillAlpha("outline", 80) === 0 && groupFillAlpha("default", 80) === 0.25 && groupFillAlpha("fill", 60) === 0.6);

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all color checks passed");
