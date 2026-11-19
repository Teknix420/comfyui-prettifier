// ComfyUI Prettifier - how links and groups are drawn: link colors per data type,
// and group fill opacity / outline-only. These are display settings of the editor;
// they are not stored in the workflow.

import { parseColor } from "./colors.js";
import { STAGE_GROUP_COLORS } from "./layout.js";

// Data type -> pipeline stage, for "follow the color palette".
const TYPE_STAGE = {
  MODEL: "Models", VAE: "Output", CLIP: "Inputs", CLIP_VISION: "Models", CONTROL_NET: "Models", STYLE_MODEL: "Models", UPSCALE_MODEL: "Models", GLIGEN: "Models", LORA_MODEL: "Models",
  CONDITIONING: "Prompt", STRING: "Prompt", CLIP_VISION_OUTPUT: "Prompt",
  LATENT: "Latent", NOISE: "Sampling", SAMPLER: "Sampling", SIGMAS: "Sampling", GUIDER: "Sampling",
  IMAGE: "Image", VIDEO: "Image", MASK: "Mask", AUDIO: "Inputs",
  INT: "Utilities", FLOAT: "Utilities", BOOLEAN: "Utilities", COMBO: "Utilities",
};

//                       MODEL      CLIP       VAE        CONDITION. LATENT     IMAGE      MASK       CONTROL    numbers    text       other types, in turn
const scheme = (model, clip, vae, cond, latent, image, mask, control, number, string, ...rest) => ({
  known: { MODEL: model, CLIP: clip, VAE: vae, CONDITIONING: cond, LATENT: latent, IMAGE: image, MASK: mask, CONTROL_NET: control, INT: number, FLOAT: number, BOOLEAN: number, STRING: string, VIDEO: image, AUDIO: rest[0] ?? string },
  cycle: rest.length ? rest : [model, clip, vae, cond, latent, image, mask, control],
});

export const LINK_SCHEMES = {
  vivid: scheme("#b39ddb", "#ffd500", "#ff6e6e", "#ffa931", "#ff9cf9", "#64b5f6", "#81c784", "#00d78d", "#a1a1a1", "#77ff77", "#4dd0e1", "#f06292", "#aed581", "#ffb74d", "#9575cd", "#4db6ac"),
  pastel: scheme("#cdb4db", "#fff1a8", "#ffb3ab", "#ffd6a5", "#f9c6f4", "#a2d2ff", "#b9e4c9", "#a0e7e5", "#c9c9c9", "#d0f4de", "#bde0fe", "#ffc8dd", "#e2f0cb", "#ffdac1", "#c7ceea", "#b5ead7"),
  neon: scheme("#b388ff", "#ffea00", "#ff1744", "#ff9100", "#ff4dff", "#00b0ff", "#00e676", "#1de9b6", "#eeeeee", "#c6ff00", "#18ffff", "#ff4081", "#76ff03", "#ffc400", "#7c4dff", "#64ffda"),
  warm: scheme("#e07a5f", "#f2cc8f", "#d1495b", "#edae49", "#f4a261", "#e9c46a", "#bc6c25", "#dda15e", "#b5a28a", "#ffe8a3", "#e76f51", "#f28482", "#ffbf69", "#cb997e", "#ddb892", "#ee9b00"),
  cool: scheme("#7b9acc", "#8ecae6", "#5e60ce", "#48bfe3", "#72efdd", "#4ea8de", "#80ffdb", "#56cfe1", "#9aa5b1", "#caf0f8", "#6930c3", "#64dfdf", "#5390d9", "#00b4d8", "#90e0ef", "#7400b8"),
  mono: scheme("#d0d0d0", "#b8b8b8", "#a0a0a0", "#e0e0e0", "#c4c4c4", "#f0f0f0", "#8c8c8c", "#acacac", "#787878", "#dcdcdc", "#bcbcbc", "#989898", "#cccccc", "#a8a8a8", "#e8e8e8", "#848484"),
};

function hashOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/**
 * Colors for the given data types. mode: a LINK_SCHEMES name, or "palette" to follow
 * the node/group color palette (stageColors: stage -> color). Pure.
 */
export function linkColorsFor(types, mode, stageColors) {
  const out = {};
  if (mode === "palette") {
    const colors = stageColors ?? STAGE_GROUP_COLORS;
    const cycle = [...new Set(Object.values(colors).filter((c) => parseColor(c)))];
    for (const t of types) out[t] = colors[TYPE_STAGE[t]] ?? cycle[hashOf(t) % cycle.length];
    return out;
  }
  const s = LINK_SCHEMES[mode];
  if (!s) return out;
  for (const t of types) out[t] = s.known[t] ?? s.cycle[hashOf(t) % s.cycle.length];
  return out;
}

const canvasClass = (app) => app.canvas?.constructor ?? globalThis.LGraphCanvas ?? globalThis.LiteGraph?.LGraphCanvas;

function typesInUse(app) {
  const types = new Set(Object.keys(TYPE_STAGE));
  const visit = (graph) => {
    for (const n of graph?._nodes ?? graph?.nodes ?? []) {
      for (const s of [...(n.inputs ?? []), ...(n.outputs ?? [])]) {
        const t = s?.type;
        if (typeof t === "string" && t && t !== "*" && !t.includes(",")) types.add(t);
      }
    }
  };
  const root = app.rootGraph ?? app.graph;
  visit(root);
  for (const sg of root?.subgraphs?.values?.() ?? []) visit(sg);
  return [...types];
}

let originalLinks = null; // what ComfyUI had before the first change
let appliedTypes = new Set();

/** Apply (or, with "classic", undo) link colors by data type. "keep" does nothing. */
export function applyLinkColors(app, mode, stageColors) {
  const cls = canvasClass(app);
  const table = cls?.link_type_colors;
  if (!table || !mode || mode === "keep") return false;
  const slots = app.canvas?.default_connection_color_byType;
  if (!originalLinks) originalLinks = { links: { ...table }, slots: slots ? { ...slots } : null };
  if (mode === "classic") {
    for (const t of appliedTypes) {
      if (t in originalLinks.links) table[t] = originalLinks.links[t];
      else delete table[t];
      if (slots) {
        if (originalLinks.slots && t in originalLinks.slots) slots[t] = originalLinks.slots[t];
        else delete slots[t];
      }
    }
    appliedTypes = new Set();
  } else {
    const colors = linkColorsFor(typesInUse(app), mode, stageColors);
    for (const [t, c] of Object.entries(colors)) {
      if (!c) continue;
      table[t] = c;
      if (slots) slots[t] = c;
      appliedTypes.add(t);
    }
  }
  app.canvas?.setDirty?.(true, true);
  return true;
}

/** The link colors as they are now, and a way to put them back (used by the dialog's Cancel). */
export function snapshotLinkColors(app) {
  const table = canvasClass(app)?.link_type_colors;
  const slots = app.canvas?.default_connection_color_byType;
  return { table: table ? { ...table } : null, slots: slots ? { ...slots } : null, applied: new Set(appliedTypes) };
}

export function restoreLinkColors(app, snap) {
  const put = (target, saved) => {
    if (!target || !saved) return;
    for (const k of Object.keys(target)) if (!(k in saved)) delete target[k];
    Object.assign(target, saved);
  };
  put(canvasClass(app)?.link_type_colors, snap?.table);
  put(app.canvas?.default_connection_color_byType, snap?.slots);
  if (snap?.applied) appliedTypes = new Set(snap.applied);
  app.canvas?.setDirty?.(true, true);
}

// --- groups ---------------------------------------------------------------------

const groupStyle = { mode: "default", opacity: 25 };
let groupPatched = false;

/** ComfyUI fills a group at 25% of its color. Map that to the chosen opacity. */
export function groupFillAlpha(mode, opacity) {
  if (mode === "outline") return 0;
  if (mode === "fill") return Math.max(0, Math.min(100, Number(opacity) || 0)) / 100;
  return 0.25;
}

/**
 * mode: default | fill (use `opacity`, 0..100) | outline (border and title only).
 * The group's own drawing is kept; only the transparency it fills with is changed.
 */
export function applyGroupStyle(app, mode, opacity) {
  groupStyle.mode = mode || "default";
  groupStyle.opacity = opacity ?? 25;
  if (groupStyle.mode !== "default" && !groupPatched) patchGroupDraw();
  app.canvas?.setDirty?.(true, true);
}

function patchGroupDraw() {
  const Group = globalThis.LiteGraph?.LGraphGroup ?? globalThis.LGraphGroup;
  const proto = Group?.prototype;
  const Ctx = globalThis.CanvasRenderingContext2D;
  const desc = Ctx && Object.getOwnPropertyDescriptor(Ctx.prototype, "globalAlpha");
  if (typeof proto?.draw !== "function" || !desc?.set) return;
  const draw = proto.draw;
  proto.draw = function (canvas, ctx) {
    if (groupStyle.mode === "default" || !ctx) return draw.apply(this, arguments);
    const base = canvas?.editor_alpha ?? 1;
    const fill = groupFillAlpha(groupStyle.mode, groupStyle.opacity) * base;
    // While this group draws, the fill transparency ComfyUI asks for is swapped
    // for ours. The border and title are drawn at full strength and are left alone.
    Object.defineProperty(ctx, "globalAlpha", {
      configurable: true,
      get() {
        return desc.get.call(this);
      },
      set(v) {
        desc.set.call(this, Math.abs(v - 0.25 * base) < 1e-6 ? fill : v);
      },
    });
    try {
      return draw.apply(this, arguments);
    } finally {
      delete ctx.globalAlpha;
    }
  };
  groupPatched = true;
}
