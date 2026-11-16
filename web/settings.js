// ComfyUI Prettifier - option schema.
// One list drives both the ComfyUI Settings panel and the Prettifier dialog.

import { DEFAULTS } from "./layout.js";

export const PREFIX = "Prettifier.";

const combo = (key, section, name, options, tooltip) => ({ key, section, name, type: "combo", options, tooltip });
const slider = (key, section, name, min, max, step, tooltip) => ({ key, section, name, type: "slider", attrs: { min, max, step }, tooltip });
const bool = (key, section, name, tooltip) => ({ key, section, name, type: "boolean", tooltip });
const text = (key, section, name, tooltip) => ({ key, section, name, type: "text", tooltip });
const opt = (value, text) => ({ value, text });

export const OPTIONS = [
  // Layout
  combo("direction", "Layout", "Flow direction", [opt("LR", "Left to right"), opt("TB", "Top to bottom")], "Which way the workflow reads. Left to right suits ComfyUI's side-mounted inputs and outputs."),
  combo("layering", "Layout", "Column assignment", [
    opt("balanced", "Balanced (loaders sit next to what uses them)"),
    opt("early", "As early as possible"),
    opt("late", "As late as possible (pack toward outputs)"),
  ], "How nodes are assigned to columns along the flow."),
  combo("verticalAlign", "Layout", "Vertical alignment", [
    opt("links", "Straighten links"),
    opt("top", "Stack from top"),
    opt("center", "Center each column"),
  ], "Straighten links lines up connected sockets so links run as flat as possible."),
  combo("columnAlign", "Layout", "Node alignment inside a column", [opt("left", "Left"), opt("center", "Center"), opt("right", "Right")]),
  slider("orderingPasses", "Layout", "Crossing reduction passes", 0, 24, 1, "More passes means fewer crossing links on big workflows, at the cost of speed."),
  slider("alignIterations", "Layout", "Link straightening iterations", 0, 30, 1),
  bool("preserveOrder", "Layout", "Respect current top-to-bottom order", "Use the existing vertical order of nodes as the starting point."),

  // Spacing
  slider("hGap", "Spacing", "Horizontal gap between columns", 0, 400, 10),
  slider("vGap", "Spacing", "Vertical gap between nodes", 0, 300, 5),
  slider("componentGap", "Spacing", "Gap between separate sections", 0, 800, 10, "Space between unconnected parts of the workflow."),
  bool("snapToGrid", "Spacing", "Snap to grid"),
  slider("gridSize", "Spacing", "Grid size", 1, 100, 1),
  combo("origin", "Spacing", "Anchor", [opt("keep", "Keep workflow where it is"), opt("zero", "Move to canvas origin")]),

  // Sizing
  combo("widthMode", "Sizing", "Node width", [
    opt("column", "Uniform per column"),
    opt("fit", "Fit content"),
    opt("fixed", "Fixed width"),
    opt("keep", "Don't change"),
  ]),
  slider("fixedWidth", "Sizing", "Fixed width", 100, 1000, 10),
  slider("minWidth", "Sizing", "Minimum width", 50, 800, 10),
  slider("maxWidth", "Sizing", "Maximum width", 100, 1600, 10),
  combo("heightMode", "Sizing", "Node height", [opt("fit", "Fit content"), opt("keep", "Don't change")]),
  bool("shrinkLarge", "Sizing", "Also shrink nodes with images or text boxes", "When off, nodes showing images, previews or multiline text are never made smaller."),

  // Groups
  combo("groupBy", "Groups", "Create groups by", [
    opt("auto", "Auto (keep my groups, otherwise by stage)"),
    opt("existing", "Keep and tidy my existing groups"),
    opt("stage", "Pipeline stage (Models, Prompt, Sampling…)"),
    opt("category", "Node category"),
    opt("component", "Connected section"),
    opt("none", "No groups (removes groups)"),
  ], "Grouped nodes are laid out together and the group is sized to fit them."),
  slider("minGroupSize", "Groups", "Minimum nodes per new group", 1, 10, 1),
  slider("categoryDepth", "Groups", "Category depth", 1, 4, 1, "For 'Node category': how many levels of the category path to use (e.g. 1 = 'image', 2 = 'image/upscaling')."),
  slider("groupPadding", "Groups", "Group padding", 0, 120, 2),
  slider("groupFontSize", "Groups", "Group title size", 10, 64, 1),
  combo("groupColor", "Groups", "Group color", [
    opt("auto", "Auto (keep existing, stage colors for new)"),
    opt("stage", "By pipeline stage"),
    opt("single", "Single color"),
    opt("none", "Don't change"),
  ]),
  text("groupSingleColor", "Groups", "Single group color", "Any CSS color, e.g. #3f789e"),

  // Placement
  combo("isolatedPlacement", "Placement", "Unconnected nodes", [opt("bottom", "Row below"), opt("right", "Column to the right"), opt("keep", "Leave where they are")]),
  combo("notePlacement", "Placement", "Notes", [opt("top", "Row above the workflow"), opt("bottom", "Row below"), opt("keep", "Leave where they are")]),
  combo("componentPacking", "Placement", "Separate sections", [opt("vertical", "Stack vertically"), opt("horizontal", "Side by side")]),
  bool("respectPinned", "Placement", "Never move pinned nodes"),

  // Appearance
  combo("colorNodes", "Appearance", "Node colors", [opt("keep", "Don't change"), opt("stage", "Color by pipeline stage"), opt("clear", "Reset to default")]),
  combo("linkStyle", "Appearance", "Link style", [opt("keep", "Don't change"), opt("spline", "Spline"), opt("linear", "Linear"), opt("straight", "Straight (right angles)")]),
  bool("animate", "Appearance", "Animate node movement"),
  slider("animationMs", "Appearance", "Animation duration (ms)", 0, 2000, 50),
  bool("fitView", "Appearance", "Zoom to fit afterwards"),

  // Behavior
  combo("scope", "Behavior", "Prettify what", [
    opt("auto", "Selection if 2+ nodes selected, else everything"),
    opt("all", "Always the whole workflow"),
    opt("selection", "Only selected nodes"),
  ]),
  bool("showToast", "Behavior", "Show a summary message"),
];

export const EXTRA_DEFAULTS = {
  colorNodes: "keep",
  linkStyle: "keep",
  animate: true,
  animationMs: 350,
  fitView: false,
  scope: "auto",
  showToast: true,
};

export const ALL_DEFAULTS = { ...DEFAULTS, ...EXTRA_DEFAULTS };

export const SECTIONS = ["Layout", "Spacing", "Sizing", "Groups", "Placement", "Appearance", "Behavior"];

export const PRESETS = {
  Default: {},
  Compact: { hGap: 40, vGap: 20, componentGap: 80, groupPadding: 10, widthMode: "fit", groupBy: "none", groupFontSize: 18 },
  Spacious: { hGap: 160, vGap: 70, componentGap: 260, groupPadding: 36, widthMode: "column" },
  Presentation: { groupBy: "stage", minGroupSize: 1, colorNodes: "stage", groupColor: "stage", hGap: 120, vGap: 50, linkStyle: "spline", fitView: true },
  "Tidy only": { widthMode: "keep", heightMode: "keep", groupBy: "existing", colorNodes: "keep", layering: "early" },
};

export function settingId(key) {
  return PREFIX + key[0].toUpperCase() + key.slice(1);
}

/** Setting definitions for app.registerExtension({ settings }). */
export function settingDefinitions(onChange) {
  return OPTIONS.map((o) => {
    const def = {
      id: settingId(o.key),
      category: ["Prettifier", o.section, o.key],
      name: o.name,
      type: o.type,
      defaultValue: ALL_DEFAULTS[o.key],
      tooltip: o.tooltip,
      onChange: onChange ? (v) => onChange(o.key, v) : undefined,
    };
    if (o.options) def.options = o.options;
    if (o.attrs) def.attrs = o.attrs;
    return def;
  });
}

export function getOption(app, key) {
  const id = settingId(key);
  try {
    const v = app.extensionManager?.setting?.get?.(id);
    if (v !== undefined && v !== null) return v;
  } catch {}
  try {
    const v = app.ui?.settings?.getSettingValue?.(id);
    if (v !== undefined && v !== null) return v;
  } catch {}
  return ALL_DEFAULTS[key];
}

export async function setOption(app, key, value) {
  const id = settingId(key);
  try {
    if (app.extensionManager?.setting?.set) return await app.extensionManager.setting.set(id, value);
  } catch {}
  try {
    return await app.ui?.settings?.setSettingValueAsync?.(id, value);
  } catch {}
  try {
    app.ui?.settings?.setSettingValue?.(id, value);
  } catch {}
}

export function readOptions(app) {
  const o = {};
  for (const key of Object.keys(ALL_DEFAULTS)) {
    let v = getOption(app, key);
    const def = ALL_DEFAULTS[key];
    if (typeof def === "number") v = Number(v);
    if (typeof def === "boolean") v = v === true || v === "true";
    o[key] = v;
  }
  return o;
}
