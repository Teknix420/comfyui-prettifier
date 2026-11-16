// ComfyUI Prettifier - color palettes and saved themes.
// A palette colors groups and nodes per pipeline stage. A theme is a named set of
// Prettifier options (including the palette) that can be saved, exported, imported.

import { STAGES, STAGE_GROUP_COLORS, STAGE_NODE_COLORS } from "./layout.js";

const pal = (colors) => {
  // colors: stage -> [groupColor, nodeTitleColor, nodeBodyColor]
  const group = {}, node = {};
  for (const s of STAGES) {
    const c = colors[s] ?? colors.Other;
    group[s] = c[0];
    node[s] = c[1] ? { color: c[1], bgcolor: c[2] } : null;
  }
  return { group, node };
};

export const PALETTES = {
  default: { group: STAGE_GROUP_COLORS, node: STAGE_NODE_COLORS },
  pastel: pal({
    Models: ["#7fb3d5", "#2c4a5e", "#3d6a85"], Inputs: ["#76d7c4", "#235048", "#327267"], Prompt: ["#a9dfbf", "#2d5038", "#3f7350"],
    Sampling: ["#d2b4de", "#4a3556", "#6a4c7a"], Latent: ["#f9e79f", "#5a4f24", "#7d6e33"], Image: ["#aab7e8", "#313b63", "#46548c"],
    Mask: ["#f5cba7", "#5c4028", "#825b39"], Output: ["#f1948a", "#5e2c27", "#864038"], Utilities: ["#aab7b8", "#333a3b", "#4a5354"], Other: ["#bfc9ca", "#3a3f40", "#52595a"],
  }),
  vivid: pal({
    Models: ["#0a84ff", "#06315e", "#0a4a8c"], Inputs: ["#00c7be", "#00403d", "#00635e"], Prompt: ["#30d158", "#0f4a1e", "#176e2d"],
    Sampling: ["#bf5af2", "#45205a", "#663085"], Latent: ["#ffd60a", "#5c4d00", "#857000"], Image: ["#5e5ce6", "#222158", "#333285"],
    Mask: ["#ff9f0a", "#5c3900", "#855300"], Output: ["#ff453a", "#5e1712", "#8a221b"], Utilities: ["#8e8e93", "#2c2c2e", "#3a3a3c"], Other: ["#636366", "#2c2c2e", "#3a3a3c"],
  }),
  mono: pal({
    Models: ["#888", "#2a2a2a", "#3a3a3a"], Inputs: ["#777", "#262626", "#363636"], Prompt: ["#999", "#2e2e2e", "#404040"],
    Sampling: ["#aaa", "#333", "#474747"], Latent: ["#808080", "#282828", "#383838"], Image: ["#909090", "#2c2c2c", "#3d3d3d"],
    Mask: ["#707070", "#242424", "#343434"], Output: ["#bbb", "#383838", "#4d4d4d"], Utilities: ["#555", "#1e1e1e", "#2b2b2b"], Other: ["#666", "#222", "#303030"],
  }),
  ocean: pal({
    Models: ["#1b4f72", "#102f44", "#17425f"], Inputs: ["#117a65", "#0b4a3d", "#0f6654"], Prompt: ["#148f77", "#0d5547", "#127562"],
    Sampling: ["#2874a6", "#184563", "#21608a"], Latent: ["#5499c7", "#2c5370", "#3d749c"], Image: ["#7fb3d5", "#3a5568", "#517791"],
    Mask: ["#45b39d", "#27665a", "#368d7c"], Output: ["#f4d03f", "#5e5018", "#857122"], Utilities: ["#34495e", "#1c2732", "#273746"], Other: ["#5d6d7e", "#2f3740", "#414d59"],
  }),
};

/** Resolve the palette named in the options (falls back to default on bad custom JSON). */
export function resolvePalette(opts) {
  if (opts.palette === "custom") {
    try {
      const c = JSON.parse(opts.customPalette || "{}");
      const group = { ...STAGE_GROUP_COLORS }, node = { ...STAGE_NODE_COLORS };
      for (const [stage, v] of Object.entries(c)) {
        if (typeof v === "string") group[stage] = v;
        else if (Array.isArray(v)) {
          if (v[0]) group[stage] = v[0];
          if (v[1]) node[stage] = { color: v[1], bgcolor: v[2] ?? v[1] };
        } else if (v && typeof v === "object") {
          if (v.group) group[stage] = v.group;
          if (v.title || v.body) node[stage] = { color: v.title ?? v.body, bgcolor: v.body ?? v.title };
        }
      }
      return { group, node };
    } catch {
      return PALETTES.default;
    }
  }
  return PALETTES[opts.palette] ?? PALETTES.default;
}

// --- saved themes -------------------------------------------------------------

const THEMES_ID = "Prettifier.SavedThemes";

export function themeSettingDefinition() {
  return { id: THEMES_ID, name: "Saved Prettifier themes", type: "hidden", defaultValue: "{}" };
}

export function loadThemes(app) {
  try {
    const raw = app.extensionManager?.setting?.get?.(THEMES_ID) ?? app.ui?.settings?.getSettingValue?.(THEMES_ID);
    const o = typeof raw === "string" ? JSON.parse(raw || "{}") : raw;
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export async function saveThemes(app, themes) {
  const raw = JSON.stringify(themes);
  try {
    if (app.extensionManager?.setting?.set) return await app.extensionManager.setting.set(THEMES_ID, raw);
  } catch {}
  try {
    app.ui?.settings?.setSettingValue?.(THEMES_ID, raw);
  } catch {}
}

export function exportTheme(name, options) {
  const blob = new Blob([JSON.stringify({ prettifierTheme: 1, name, options }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${String(name || "prettifier-theme").replace(/[^\w.-]+/g, "_")}.prettifier.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Ask for a theme file and resolve to { name, options } (validated against known keys). */
export function importTheme(knownDefaults) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        const src = data.options ?? data;
        const options = {};
        for (const [k, def] of Object.entries(knownDefaults)) {
          if (!(k in src) || typeof src[k] !== typeof def) continue;
          options[k] = src[k];
        }
        resolve({ name: String(data.name ?? input.files[0].name.replace(/\.prettifier\.json$|\.json$/i, "")).slice(0, 60), options });
      } catch {
        resolve(null);
      }
    });
    input.click();
  });
}
