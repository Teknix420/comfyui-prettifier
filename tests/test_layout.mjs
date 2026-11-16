// Run with:  node tests/test_layout.mjs [--svg]
// Exercises the pure layout engine on a few workflows and checks basic invariants.
// With --svg, writes before/after pictures into tests/out/.

import { computeLayout, DEFAULTS, parseGroupRules } from "../web/layout.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TITLE_H = 30;
const SLOT_H = 20;
let failures = 0;
const check = (cond, msg) => {
  if (!cond) {
    failures++;
    console.log("  FAIL:", msg);
  }
};

// --- build a model from a ComfyUI workflow JSON (UI format) -----------------
function modelFromWorkflow(wf) {
  const nodes = wf.nodes.map((n) => {
    const ins = n.inputs || [];
    const outs = n.outputs || [];
    const slotRows = Math.max(ins.length, outs.length);
    const widgets = (n.widgets_values || []).length;
    const fitH = slotRows * SLOT_H + widgets * 24 + 10;
    return {
      id: n.id,
      type: n.type,
      category: n.category || "",
      isOutput: /Save|Preview/.test(n.type),
      isNote: /Note/.test(n.type),
      pinned: !!n.flags?.pinned,
      collapsed: !!n.flags?.collapsed,
      x: n.pos[0],
      y: n.pos[1],
      w: n.size[0],
      h: n.size[1],
      fitW: Math.min(n.size[0], 220 + (n.type.length > 14 ? 60 : 0)),
      fitH: Math.min(n.size[1], fitH),
      hasLargeContent: /Note|Save|Preview/.test(n.type),
      inSlots: ins.map((_, i) => TITLE_H + (i + 0.7) * SLOT_H),
      outSlots: outs.map((_, i) => TITLE_H + (i + 0.7) * SLOT_H),
      groups: [],
    };
  });
  const edges = wf.links.map((l) => ({ from: l[1], fromSlot: l[2], to: l[3], toSlot: l[4] }));
  const groups = (wf.groups || []).map((g, index) => {
    const [x, y, w, h] = g.bounding;
    return { index, title: g.title, color: g.color, fontSize: g.font_size || 24, x, y, w, h };
  });
  // membership: node box center inside group
  for (const n of nodes) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    n.groups = groups
      .filter((g) => cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h)
      .sort((a, b) => a.w * a.h - b.w * b.h)
      .map((g) => g.index);
  }
  return { titleH: TITLE_H, nodes, edges, groups };
}

// --- invariants -----------------------------------------------------------
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function validate(name, model, res, opts) {
  const boxes = res.nodes.filter((n) => n.moved).map((n) => ({ id: n.id, x: n.x, y: n.y - TITLE_H, w: n.w, h: n.h + TITLE_H }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      check(!overlaps(boxes[i], boxes[j]), `${name}: nodes ${boxes[i].id} and ${boxes[j].id} overlap`);
  const groups = res.newGroups.length ? res.newGroups : res.groupUpdates;
  if (res.newGroups.length) {
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) check(!overlaps(groups[i], groups[j]), `${name}: groups ${groups[i].title} / ${groups[j].title} overlap`);
  }
  for (const n of res.nodes) {
    check(Number.isFinite(n.x) && Number.isFinite(n.y) && n.w > 0 && n.h >= 0, `${name}: bad geometry for node ${n.id}`);
  }
  if (opts.direction !== "TB") {
    const pos = new Map(res.nodes.map((n) => [n.id, n]));
    let back = 0;
    for (const e of model.edges) if (pos.get(e.to).x < pos.get(e.from).x) back++;
    return back;
  }
  return 0;
}

// --- SVG rendering ----------------------------------------------------------
function svg(model, nodes, groups) {
  const pos = new Map(nodes.map((n) => [n.id, n]));
  const all = [...nodes.map((n) => ({ x: n.x, y: n.y - TITLE_H, w: n.w, h: n.h + TITLE_H })), ...groups];
  const x0 = Math.min(...all.map((b) => b.x)) - 40, y0 = Math.min(...all.map((b) => b.y)) - 40;
  const x1 = Math.max(...all.map((b) => b.x + b.w)) + 40, y1 = Math.max(...all.map((b) => b.y + b.h)) + 40;
  const src = new Map(model.nodes.map((n) => [n.id, n]));
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" width="${Math.min(1600, x1 - x0)}" style="background:#202020;font-family:sans-serif">`;
  for (const g of groups) {
    s += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" fill="${g.color || "#3f789e"}" fill-opacity="0.25" stroke="${g.color || "#3f789e"}"/>`;
    s += `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${Math.round((g.fontSize || 24) * 1.4)}" fill="${g.color || "#3f789e"}" fill-opacity="0.6"/>`;
    s += `<text x="${g.x + 8}" y="${g.y + 24}" fill="#eee" font-size="${g.fontSize || 24}">${g.title ?? ""}</text>`;
  }
  for (const e of model.edges) {
    const a = pos.get(e.from), b = pos.get(e.to);
    const sa = src.get(e.from).outSlots[e.fromSlot] ?? 40, sb = src.get(e.to).inSlots[e.toSlot] ?? 40;
    const ax = a.x + a.w, ay = a.y - TITLE_H + sa, bx = b.x, by = b.y - TITLE_H + sb;
    const dx = Math.max(40, Math.abs(bx - ax) / 2);
    s += `<path d="M${ax},${ay} C${ax + dx},${ay} ${bx - dx},${by} ${bx},${by}" stroke="#9ad" stroke-width="3" fill="none" opacity="0.8"/>`;
  }
  for (const n of nodes) {
    const t = src.get(n.id).type;
    s += `<rect x="${n.x}" y="${n.y - TITLE_H}" width="${n.w}" height="${n.h + TITLE_H}" rx="8" fill="#353535" stroke="#666"/>`;
    s += `<rect x="${n.x}" y="${n.y - TITLE_H}" width="${n.w}" height="${TITLE_H}" rx="8" fill="#222"/>`;
    s += `<text x="${n.x + 10}" y="${n.y - 9}" fill="#ddd" font-size="16">${n.id}: ${t}</text>`;
  }
  return s + "</svg>";
}

// --- fixtures ----------------------------------------------------------------
const defaultWorkflow = {
  nodes: [
    { id: 4, type: "CheckpointLoaderSimple", category: "loaders", pos: [26, 474], size: [315, 98], outputs: [{}, {}, {}], widgets_values: ["x"] },
    { id: 6, type: "CLIPTextEncode", category: "conditioning", pos: [415, 186], size: [422, 164], inputs: [{}], outputs: [{}], widgets_values: ["a"] },
    { id: 7, type: "CLIPTextEncode", category: "conditioning", pos: [413, 389], size: [425, 180], inputs: [{}], outputs: [{}], widgets_values: ["b"] },
    { id: 5, type: "EmptyLatentImage", category: "latent", pos: [473, 609], size: [315, 106], outputs: [{}], widgets_values: [1, 2, 3] },
    { id: 3, type: "KSampler", category: "sampling", pos: [863, 186], size: [315, 262], inputs: [{}, {}, {}, {}], outputs: [{}], widgets_values: [1, 2, 3, 4, 5, 6, 7] },
    { id: 8, type: "VAEDecode", category: "latent", pos: [1209, 188], size: [210, 46], inputs: [{}, {}], outputs: [{}] },
    { id: 9, type: "SaveImage", category: "image", pos: [1451, 189], size: [210, 270], inputs: [{}], widgets_values: ["ComfyUI"] },
  ],
  links: [
    [1, 4, 0, 3, 0], [3, 4, 1, 7, 0], [5, 4, 1, 6, 0], [2, 5, 0, 3, 3],
    [4, 6, 0, 3, 1], [6, 7, 0, 3, 2], [7, 3, 0, 8, 0], [8, 4, 2, 8, 1], [9, 8, 0, 9, 0],
  ],
};

// A messy version: same graph, scrambled positions, plus a note and an orphan.
const messy = JSON.parse(JSON.stringify(defaultWorkflow));
const scramble = [[900, 900], [100, 50], [1300, 600], [200, 1000], [500, 500], [50, 700], [1000, 100]];
messy.nodes.forEach((n, i) => (n.pos = scramble[i]));
messy.nodes.push({ id: 20, type: "Note", category: "utils", pos: [700, 1200], size: [400, 120], widgets_values: ["hi"] });
messy.nodes.push({ id: 21, type: "LoraLoader", category: "loaders", pos: [1500, 1200], size: [300, 130], inputs: [{}, {}], outputs: [{}, {}], widgets_values: [1, 2, 3] });

// With existing groups.
const grouped = JSON.parse(JSON.stringify(messy));
grouped.groups = [
  { title: "Prompts", bounding: [80, -20, 480, 300], color: "#8A8", font_size: 24 },
  { title: "Render", bounding: [960, 50, 500, 400], color: "#A88", font_size: 24 },
];

// Random larger DAG with a cycle.
function randomWorkflow(n, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const cats = ["loaders", "conditioning", "sampling", "latent", "image", "mask", "custom/foo"];
  const nodes = [];
  for (let i = 1; i <= n; i++) {
    nodes.push({
      id: i, type: "Node" + i, category: cats[Math.floor(rnd() * cats.length)],
      pos: [Math.floor(rnd() * 3000), Math.floor(rnd() * 2000)],
      size: [200 + Math.floor(rnd() * 200), 60 + Math.floor(rnd() * 200)],
      inputs: [{}, {}, {}], outputs: [{}, {}], widgets_values: [1],
    });
  }
  const links = [];
  let lid = 1;
  for (let i = 2; i <= n; i++) {
    const k = 1 + Math.floor(rnd() * 2);
    for (let j = 0; j < k; j++) links.push([lid++, 1 + Math.floor(rnd() * (i - 1)), Math.floor(rnd() * 2), i, j]);
  }
  links.push([lid++, n, 0, 2, 2]); // cycle
  return { nodes, links };
}

const cases = [
  ["default", defaultWorkflow, {}],
  ["default-stage-groups", defaultWorkflow, { groupBy: "stage", minGroupSize: 1 }],
  ["messy", messy, {}],
  ["messy-category", messy, { groupBy: "category" }],
  ["messy-component-right", messy, { groupBy: "component", isolatedPlacement: "right", notePlacement: "bottom" }],
  ["grouped-existing", grouped, {}],
  ["grouped-replace-stage", grouped, { groupBy: "stage" }],
  ["messy-TB", messy, { direction: "TB" }],
  ["messy-late-center", messy, { layering: "late", verticalAlign: "center", widthMode: "fit" }],
  ["random-60", randomWorkflow(60), { groupBy: "none" }],
  ["random-60-stage", randomWorkflow(60), { groupBy: "stage" }],
  ["random-150-category", randomWorkflow(150, 3), { groupBy: "category", categoryDepth: 2 }],
  ["messy-type", messy, { groupBy: "type", minGroupSize: 1 }],
  ["messy-rules", messy, { groupBy: "stage", minGroupSize: 1, groupRules: "Loaders #123456 = Loader; Text = TextEncode" }],
  ["random-60-rules-only", randomWorkflow(60), { groupBy: "rules", groupRules: "Sampling = sampl; Images = image" }],
];

const writeSvg = process.argv.includes("--svg");
if (writeSvg) fs.mkdirSync(path.join(here, "out"), { recursive: true });

for (const [name, wf, opts] of cases) {
  const model = modelFromWorkflow(wf);
  const t0 = performance.now();
  const res = computeLayout(model, opts);
  const ms = performance.now() - t0;
  const back = validate(name, model, res, { ...DEFAULTS, ...opts });
  const groups = res.newGroups.length
    ? res.newGroups
    : res.groupUpdates.map((u) => ({ ...model.groups[u.index], ...u }));
  console.log(`${name}: ${model.nodes.length} nodes, ${model.edges.length} links, ${groups.length} groups, ${back} backward links, ${ms.toFixed(1)} ms`);
  if (writeSvg) {
    const before = model.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    fs.writeFileSync(path.join(here, "out", `${name}-before.svg`), svg(model, before, model.groups));
    fs.writeFileSync(path.join(here, "out", `${name}-after.svg`), svg(model, res.nodes, groups));
  }
}

// --- grouping options -------------------------------------------------------
{
  const titles = (opts) => computeLayout(modelFromWorkflow(messy), { minGroupSize: 1, ...opts }).newGroups.map((g) => g.title).sort();
  const groupsOf = (opts) => computeLayout(modelFromWorkflow(messy), { minGroupSize: 1, ...opts }).newGroups;
  const eq = (a, b, msg) => check(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}`);

  eq(parseGroupRules("Loaders #3f789e = Loader|Checkpoint; Bad = (; Prompts = TextEncode\n = x; NoPattern =").map((r) => [r.name, r.color ?? null, r.re.source]), [["Loaders", "#3f789e", "Loader|Checkpoint"], ["Prompts", null, "TextEncode"]], "rule parsing");

  // custom rules claim nodes first, the mode handles the rest
  const ruled = groupsOf({ groupBy: "stage", groupRules: "Loaders #123456 = Loader; Text = TextEncode" });
  check(ruled.some((g) => g.title === "Loaders" && g.color === "#123456"), "rule group with its color");
  check(ruled.some((g) => g.title === "Text"), "second rule group");
  check(!ruled.some((g) => g.title === "Models" || g.title === "Prompt"), "ruled nodes are not also grouped by stage");
  check(ruled.some((g) => g.title === "Sampling"), "other nodes still grouped by stage");

  // only rules
  eq(titles({ groupBy: "rules", groupRules: "Text = TextEncode" }), ["Text"], "rules only");
  eq(titles({ groupBy: "rules", groupRules: "" }), [], "rules only, no rules");

  // by type
  check(titles({ groupBy: "type" }).includes("CLIPTextEncode"), "group by type");

  // by color
  const colored = JSON.parse(JSON.stringify(messy));
  const cm = modelFromWorkflow(colored);
  cm.nodes.forEach((n) => { if (n.type === "CLIPTextEncode") n.color = "#322"; if (n.type === "KSampler") n.color = "#232"; });
  eq(computeLayout(cm, { groupBy: "color", minGroupSize: 1 }).newGroups.length, 2, "group by color");

  // exclude, template, find/replace, numbering
  const base = titles({ groupBy: "stage" });
  check(base.includes("Output") && base.includes("Models"), "stage groups present");
  check(!titles({ groupBy: "stage", groupExclude: "Output|Models" }).some((t) => /Output|Models/.test(t)), "excluded groups are not created");
  check(titles({ groupBy: "stage", groupTitleTemplate: "{name} ({count})" }).some((t) => /^Prompt \(2\)$/.test(t)), "name template with count");
  check(titles({ groupBy: "stage", groupTitleRules: "Models => Loaders; Output => Results" }).includes("Loaders"), "name find/replace");
  const numbered = groupsOf({ groupBy: "stage", groupTitleTemplate: "Stage", groupNumberDuplicates: true }).map((g) => g.title).sort();
  check(numbered.length > 1 && numbered.every((t, i) => t === `Stage ${i + 1}`), "duplicate names are numbered");

  // restyle existing groups
  const ex = computeLayout(modelFromWorkflow(grouped), { groupRestyleExisting: true, groupFontSize: 30 });
  check(ex.groupUpdates.length > 0 && ex.groupUpdates.every((u) => u.fontSize === 30), "existing groups get the title size");
  check(computeLayout(modelFromWorkflow(grouped), {}).groupUpdates.every((u) => u.fontSize === undefined), "existing groups left alone by default");
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
