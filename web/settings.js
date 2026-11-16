// ComfyUI Prettifier - option schema.
// One list drives both the ComfyUI Settings panel and the Prettifier dialog.

import { DEFAULTS } from "./layout.js";
import { RENAME_DEFAULTS } from "./rename.js";
import { LINT_DEFAULTS } from "./lint.js";
import { themeSettingDefinition } from "./themes.js";

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

  // Links
  combo("rerouteMode", "Links", "Reroute dots", [
    opt("auto", "Auto (clear old dots, add new ones around nodes and groups)"),
    opt("remove", "Remove all reroute dots"),
    opt("keep", "Leave reroute dots alone"),
  ], "Auto routes long links above or below the nodes they would otherwise run through."),
  bool("rerouteAvoidGroups", "Links", "Route around groups", "Auto also keeps a link out of any group that neither of its ends is in."),
  slider("rerouteClearance", "Links", "Clearance around nodes and groups", 4, 80, 2, "How far a rerouted link stays from the nodes and groups it avoids."),
  slider("rerouteMinLength", "Links", "Only reroute links longer than", 0, 2000, 50, "Short links are left straight even if they clip a node."),

  // Nodes
  combo("collapseMode", "Nodes", "Collapse nodes", [opt("keep", "Don't change"), opt("collapse", "Collapse matching nodes"), opt("expand", "Expand everything")]),
  text("collapseMatch", "Nodes", "Collapse nodes matching", "Regular expression matched against node type, title and pipeline stage. Example: Loader|Primitive|Utilities"),
  combo("inactiveStyle", "Nodes", "Muted and bypassed nodes", [opt("keep", "Don't change"), opt("dim", "Dim"), opt("collapse", "Collapse"), opt("both", "Dim and collapse")]),
  combo("subgraphMode", "Nodes", "Subgraphs", [opt("all", "Prettify inside every subgraph too"), opt("current", "Only the graph I'm looking at")], "Applies when prettifying a whole workflow."),
  combo("subgraphSlotOrder", "Nodes", "Subgraph connector order", [
    opt("keep", "Don't change"),
    opt("inside", "Match the layout inside the subgraph"),
    opt("outside", "Match the nodes around the subgraph"),
  ], "Reorders a subgraph's inputs and outputs so fewer links cross. Inside: follows the nodes they connect to within the subgraph. Outside: follows the nodes connected to the subgraph node on the parent canvas."),

  // Notes
  bool("autoNote", "Notes", "Keep a summary note up to date", "Adds a note listing models, LoRAs, resolution, sampler settings and seeds, and refreshes it on every prettify."),
  combo("noteStyle", "Notes", "Summary note type", [opt("markdown", "Markdown note"), opt("plain", "Plain note")]),
  text("noteTitle", "Notes", "Summary note title"),
  bool("noteIncludePrompts", "Notes", "Include prompt text"),

  // Appearance
  combo("palette", "Appearance", "Color palette", [opt("default", "ComfyUI classic"), opt("pastel", "Pastel"), opt("vivid", "Vivid"), opt("mono", "Monochrome"), opt("ocean", "Ocean"), opt("custom", "Custom (JSON below)")], "Colors used for stage-colored groups and nodes."),
  text("customPalette", "Appearance", "Custom palette JSON", 'Stage name to colors: {"Models": ["#group", "#nodeTitle", "#nodeBody"], "Prompt": "#groupOnly"}. Stages: Models, Inputs, Prompt, Sampling, Latent, Image, Mask, Output, Utilities, Other.'),
  combo("colorNodes", "Appearance", "Node colors", [opt("keep", "Don't change"), opt("stage", "Color by pipeline stage"), opt("clear", "Reset to default")]),
  combo("linkStyle", "Appearance", "Link style", [opt("keep", "Don't change"), opt("spline", "Spline"), opt("linear", "Linear"), opt("straight", "Straight (right angles)")]),
  bool("animate", "Appearance", "Animate node movement"),
  slider("animationMs", "Appearance", "Animation duration (ms)", 0, 2000, 50),
  bool("fitView", "Appearance", "Zoom to fit afterwards"),

  // Renaming
  bool("renameOnPrettify", "Renaming", "Apply renaming when prettifying", "When off, renaming only happens through the 'Rename nodes and connectors' command."),
  combo("nodeTitleMode", "Renaming", "Node titles", [opt("keep", "Don't change"), opt("default", "Reset to default names"), opt("template", "Use template")]),
  text("nodeTitleTemplate", "Renaming", "Node title template", "Tokens: {title} current title (use {default} instead if you re-run often, so prefixes don't stack), {default} default name, {type}, {id}, {n} number among nodes of the same type, {stage}, {category}, {group}, {widget:NAME} a widget's value (e.g. {widget:ckpt_name}). [Bracketed parts] are dropped when a token inside is empty. Example: {stage}: {default}[ ({widget:sampler_name})]"),
  combo("nodeTitleApplyTo", "Renaming", "Rename which nodes", [opt("all", "All nodes"), opt("untouched", "Only nodes still using their default name"), opt("renamed", "Only nodes I renamed")]),
  text("nodeTypeFilter", "Renaming", "Only node types matching", "Regular expression matched against the node type or default name. Empty = every node. Example: Sampler|Loader"),
  combo("nodeTitleCase", "Renaming", "Node title capitalization", [opt("none", "Don't change"), opt("title", "Title Case"), opt("upper", "UPPERCASE"), opt("lower", "lowercase")]),
  combo("nodeNumbering", "Renaming", "Number node titles", [opt("none", "No"), opt("duplicates", "Only duplicates (KSampler 1, KSampler 2)"), opt("all", "Every renamed node")], "Numbers follow the flow, left to right then top to bottom."),
  text("nodeTitleRules", "Renaming", "Node title find/replace rules", "find => replace, separated by ; (find is a regular expression). Prefix with a type filter using :: to limit a rule. Example: \\(Prompt\\) => ; CLIPTextEncode :: ^CLIP Text Encode => Prompt"),
  combo("slotLabelMode", "Renaming", "Connector labels", [opt("keep", "Don't change"), opt("reset", "Reset to default names"), opt("type", "Show data type (MODEL, LATENT…)"), opt("template", "Use template")]),
  text("slotLabelTemplate", "Renaming", "Connector label template", "Tokens: {name} connector name, {label} current label, {type} data type, {node} this node's title, {source} title of the node feeding this input, {sourceSlot} name of that node's output. Example: {name}[ ← {source}]"),
  combo("slotApplyTo", "Renaming", "Rename which connectors", [opt("both", "Inputs and outputs"), opt("inputs", "Inputs only"), opt("outputs", "Outputs only")]),
  bool("slotOnlyConnected", "Renaming", "Only connected connectors"),
  bool("slotIncludeWidgets", "Renaming", "Also relabel widget inputs", "Widgets (seed, steps, text…) double as inputs. When off, they are only relabelled if something is connected to them."),
  combo("slotLabelCase", "Renaming", "Connector capitalization", [opt("none", "Don't change"), opt("title", "Title Case (latent_image → Latent Image)"), opt("upper", "UPPERCASE"), opt("lower", "lowercase")]),
  text("slotLabelRules", "Renaming", "Connector find/replace rules", "find => replace, separated by ; . Prefix with a data type filter using :: . Example: CONDITIONING :: ^positive$ => + prompt; _ => (space)"),

  combo("subgraphSlotMode", "Renaming", "Subgraph connectors", [opt("keep", "Don't change"), opt("reset", "Reset to original names"), opt("type", "Show data type (MODEL, LATENT…)"), opt("template", "Use template")], "Renames a subgraph's own inputs and outputs: the panels inside it and the connectors on the subgraph node. Uses the connector capitalization and find/replace rules."),
  text("subgraphSlotTemplate", "Renaming", "Subgraph connector template", "Tokens: {name} original name, {label} current label, {type} data type, {inner} name of the connector it is wired to inside, {node} title of that inside node, {source} title of the node feeding it on the parent canvas, {subgraph} subgraph name. Example: {node}: {inner}"),

  // Behavior
  combo("scope", "Behavior", "Prettify what", [
    opt("auto", "Selection if 2+ nodes selected, else everything"),
    opt("all", "Always the whole workflow"),
    opt("selection", "Only selected nodes"),
  ]),
  combo("autoRun", "Behavior", "Prettify automatically", [opt("off", "Never"), opt("load", "When a workflow is opened"), opt("save", "When a workflow is saved"), opt("both", "On open and on save")], "On open is skipped when the workflow is still arranged the way Prettifier left it."),
  bool("rememberWorkflowOptions", "Behavior", "Remember options inside each workflow", "Stores the options a workflow was prettified with in the workflow file."),
  bool("useWorkflowOptions", "Behavior", "Use a workflow's remembered options", "When a workflow carries remembered options, quick prettify uses them instead of your global ones."),
  bool("showToast", "Behavior", "Show a summary message"),

  // Lint
  bool("lintOnPrettify", "Lint", "Check the workflow when prettifying", "Adds the number of findings to the summary message."),
  bool("lintMissing", "Lint", "Missing inputs, models and node types"),
  bool("lintUnused", "Lint", "Nodes whose outputs are never used"),
  bool("lintDuplicates", "Lint", "Duplicate loaders"),
  bool("lintValues", "Lint", "Suspicious widget values"),
  bool("lintInactive", "Lint", "Muted and bypassed nodes"),
  slider("lintMaxSteps", "Lint", "Flag steps above", 10, 500, 5),
  slider("lintMaxCfg", "Lint", "Flag CFG above", 1, 100, 1),
];

export const EXTRA_DEFAULTS = {
  colorNodes: "keep",
  linkStyle: "keep",
  animate: true,
  animationMs: 350,
  fitView: false,
  scope: "auto",
  showToast: true,
  rerouteMode: "auto",
  rerouteAvoidGroups: true,
  rerouteClearance: 16,
  rerouteMinLength: 300,
  collapseMode: "keep",
  collapseMatch: "Loader|Primitive",
  inactiveStyle: "keep",
  subgraphMode: "all",
  subgraphSlotOrder: "keep",
  autoNote: false,
  noteStyle: "markdown",
  noteTitle: "Workflow summary",
  noteIncludePrompts: false,
  palette: "default",
  customPalette: "",
  autoRun: "off",
  rememberWorkflowOptions: true,
  useWorkflowOptions: true,
};

export const ALL_DEFAULTS = { ...DEFAULTS, ...RENAME_DEFAULTS, ...LINT_DEFAULTS, ...EXTRA_DEFAULTS };

export const SECTIONS = ["Layout", "Spacing", "Sizing", "Groups", "Placement", "Links", "Nodes", "Renaming", "Notes", "Appearance", "Behavior", "Lint"];

export const PRESETS = {
  Default: {},
  Compact: { hGap: 40, vGap: 20, componentGap: 80, groupPadding: 10, widthMode: "fit", groupBy: "none", groupFontSize: 18 },
  Spacious: { hGap: 160, vGap: 70, componentGap: 260, groupPadding: 36, widthMode: "column" },
  Presentation: { groupBy: "stage", minGroupSize: 1, colorNodes: "stage", groupColor: "stage", palette: "pastel", hGap: 120, vGap: 50, linkStyle: "spline", fitView: true, autoNote: true },
  "Clean names": {
    nodeTitleMode: "template",
    nodeTitleTemplate: "{default}",
    nodeTitleApplyTo: "untouched",
    nodeNumbering: "duplicates",
    slotLabelMode: "template",
    slotLabelTemplate: "{name}",
    slotLabelCase: "title",
    subgraphSlotMode: "template",
    subgraphSlotTemplate: "{name}",
  },
  "Tidy only": { widthMode: "keep", heightMode: "keep", groupBy: "existing", colorNodes: "keep", layering: "early" },
};

export function settingId(key) {
  return PREFIX + key[0].toUpperCase() + key.slice(1);
}

/** Setting definitions for app.registerExtension({ settings }). */
export function settingDefinitions(onChange) {
  return [themeSettingDefinition(), ...optionDefinitions(onChange)];
}

function optionDefinitions(onChange) {
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
