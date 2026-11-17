// ComfyUI Prettifier - color helpers and the node coloring rules. Pure: no ComfyUI.

/** "#rgb", "#rrggbb" or "rgb(r, g, b)" -> [r, g, b], or null for anything else. */
export function parseColor(value) {
  const s = String(value ?? "").trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(s);
  if (m) return [1, 2, 3].map((i) => Math.min(255, Number(m[i])));
  return null;
}

const hex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** The color scaled towards black until it is no brighter than `max` (0..1). */
export function shade(value, factor, max = 1) {
  const rgb = parseColor(value);
  if (!rgb) return null;
  let out = rgb.map((v) => v * factor);
  const l = luminance(out);
  if (l > max) out = out.map((v) => (v * max) / l);
  return hex(out);
}

/**
 * Title and body colors for a node, from one base color (a group's color, say).
 * Dark enough for ComfyUI's light text to stay readable on any base.
 */
export function nodeColorsFrom(base) {
  const color = shade(base, 0.4, 0.2), bgcolor = shade(base, 0.6, 0.3);
  return color && bgcolor ? { color, bgcolor } : null;
}

/** "pattern = #color; pattern = #color": regular expressions matched against a node. */
export function parseColorRules(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/;|\n/)) {
    const eq = raw.lastIndexOf("=");
    if (eq < 0) continue;
    const pattern = raw.slice(0, eq).trim(), color = raw.slice(eq + 1).trim();
    if (!pattern || !parseColor(color)) continue;
    try {
      rules.push({ re: new RegExp(pattern, "i"), color });
    } catch {}
  }
  return rules;
}

function hashOf(text) {
  let h = 2166136261;
  for (const ch of String(text)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

/**
 * Decide each node's colors.
 * nodes: [{ id, type, title, category, stage, groupColor }]
 * opts: { colorNodes: keep | stage | group | type | category | clear, nodeColorRules }
 * palette: { group: stage -> color, node: stage -> { color, bgcolor } | null }
 * Returns Map(id -> { color, bgcolor }) to set, or null to reset; nodes left alone are absent.
 */
export function planNodeColors(nodes, opts, palette) {
  const out = new Map();
  const mode = opts.colorNodes ?? "keep";
  const rules = parseColorRules(opts.nodeColorRules);
  // Distinct colors of the palette, for the modes that hand colors out by name.
  const cycle = [...new Set(Object.values(palette?.group ?? {}).filter((c) => parseColor(c)))];
  const byName = (name) => (cycle.length && name ? nodeColorsFrom(cycle[hashOf(name) % cycle.length]) : null);
  for (const n of nodes) {
    const hay = [n.type, n.title, n.category, n.stage].filter(Boolean).join("\n");
    const rule = rules.find((r) => r.re.test(hay));
    if (rule) {
      out.set(n.id, nodeColorsFrom(rule.color));
      continue;
    }
    if (mode === "stage") out.set(n.id, palette?.node?.[n.stage] ?? null);
    else if (mode === "group") out.set(n.id, n.groupColor ? nodeColorsFrom(n.groupColor) : null);
    else if (mode === "type") out.set(n.id, byName(n.type));
    else if (mode === "category") out.set(n.id, byName(String(n.category ?? "").split("/")[0]));
    else if (mode === "clear") out.set(n.id, null);
  }
  return out;
}
