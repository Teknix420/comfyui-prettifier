// ComfyUI Prettifier - option schema.
// One list drives both the ComfyUI Settings panel and the Prettifier dialog.

import { VARIABLE_DEFAULTS } from "./variables.js";
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
    opt("type", "Node type (all KSamplers together…)"),
    opt("color", "Node color (nodes I colored the same)"),
    opt("rules", "Only my custom rules"),
    opt("none", "No groups (removes groups)"),
  ], "Grouped nodes are laid out together and the group is sized to fit them."),
  combo("packing", "Groups", "Arrangement", [
    opt("flow", "Follow the flow (can get tall)"),
    opt("pack", "Compact: pack separate pieces side by side"),
    opt("wrap", "Most compact: also wrap tall columns"),
  ], "How groups, and the nodes inside them, are arranged. Compact fills rows instead of one tall stack. Wrapping also splits a tall column into several, at the cost of some links passing other nodes."),
  slider("packAspect", "Groups", "Target shape (width ÷ height)", 0.5, 4, 0.1, "Used by the compact arrangements. 1 is square, 1.6 is about the shape of a screen, higher is wider and flatter."),
  text("groupRules", "Groups", "Custom group rules", "Name = pattern, separated by ; . Add a color after the name if you like. The pattern is a regular expression matched against node type, title, category and pipeline stage. Rules are checked first, in order; other nodes follow 'Create groups by'. Example: Loaders #3f789e = Loader|Checkpoint; Prompts = TextEncode; Upscale = upscal"),
  text("groupExclude", "Groups", "Don't create groups named", "Regular expression matched against the group name. Example: Utilities|Other"),
  text("groupTitleTemplate", "Groups", "Group name template", "Tokens: {name} the group's name, {count} number of nodes, {n} group number, {stage} pipeline stage. Example: {n}. {name} ({count})"),
  text("groupTitleRules", "Groups", "Group name find/replace rules", "find => replace, separated by ; (find is a regular expression). Example: Models => Loaders; Output => Results"),
  bool("groupNumberDuplicates", "Groups", "Number groups with the same name", "A stage can end up as two groups (for example prompts before and after a sampler). This names them Prompt 1 and Prompt 2."),
  bool("groupRestyleExisting", "Groups", "Apply title size to my existing groups"),
  slider("minGroupSize", "Groups", "Minimum nodes per new group", 1, 10, 1),
  slider("categoryDepth", "Groups", "Category depth", 1, 4, 1, "For 'Node category': how many levels of the category path to use (e.g. 1 = 'image', 2 = 'image/upscaling')."),
  slider("groupPadding", "Groups", "Group padding", 0, 120, 2),
  slider("groupFontSize", "Groups", "Group title size", 10, 64, 1),
  combo("groupFill", "Groups", "Group background", [
    opt("default", "ComfyUI default"),
    opt("fill", "Filled, at the opacity below"),
    opt("outline", "Outline only"),
  ], "How every group is drawn in the editor. Outline only keeps the border and title and leaves the inside clear. A display setting, not saved in the workflow."),
  slider("groupOpacity", "Groups", "Group background opacity (%)", 0, 100, 5, "Used with 'Filled'. ComfyUI's own value is 25."),
  combo("groupColor", "Groups", "Group color", [
    opt("auto", "Auto (keep existing, stage colors for new)"),
    opt("stage", "By pipeline stage"),
    opt("cycle", "A different palette color for each group"),
    opt("single", "Single color"),
    opt("none", "Don't change"),
  ]),
  text("groupSingleColor", "Groups", "Single group color", "Any CSS color, e.g. #3f789e"),

  // Placement
  combo("isolatedPlacement", "Placement", "Unconnected nodes", [opt("bottom", "Row below"), opt("right", "Column to the right"), opt("keep", "Leave where they are")]),
  combo("notePlacement", "Placement", "Notes", [opt("top", "Row above the workflow"), opt("bottom", "Row below"), opt("keep", "Leave where they are")]),
  combo("componentPacking", "Placement", "Separate sections", [opt("vertical", "Stack vertically"), opt("horizontal", "Side by side")]),
  combo("looseAlign", "Placement", "Align ungrouped nodes with", [opt("box", "The group box"), opt("nodes", "The nodes inside groups")], "Next to a group, an ungrouped node can line up with the edge of the group box or, inset by the group padding, with the nodes inside it."),
  bool("looseMatchWidth", "Placement", "Ungrouped nodes match grouped node width", "With 'The nodes inside groups': an ungrouped node in the same column as a group is widened to the width of the group's interior."),
  bool("respectPinned", "Placement", "Never move pinned nodes"),

  // Links
  combo("rerouteMode", "Links", "Reroute dots", [
    opt("auto", "Auto (clear old dots, add new ones around nodes and groups)"),
    opt("remove", "Remove all reroute dots"),
    opt("keep", "Leave reroute dots alone"),
  ], "Auto routes long links above or below the nodes they would otherwise run through."),
  combo("rerouteStyle", "Links", "Rerouted links", [
    opt("detour", "Take the shortest way around"),
    opt("level", "Stay level, bend only where needed"),
  ], "Stay level: a rerouted link runs horizontally as far as it can and only gets a dot where it has to change height to pass something, or just before its input."),
  combo("rerouteTurn", "Links", "Link direction preference", [
    opt("auto", "No preference (ComfyUI turns half-way)"),
    opt("horizontal", "Horizontal first: run level, turn near the input"),
    opt("vertical", "Vertical first: turn near the output, then run level"),
  ], "For links whose two ends are at different heights and that are longer than 'Only reroute links longer than'. Two dots make the link turn once, at the chosen end, instead of wherever the middle happens to be. Most visible with the Straight link style."),
  combo("rerouteLane", "Links", "Send rerouted links", [
    opt("auto", "Around whatever is in the way"),
    opt("above", "Above the whole workflow"),
    opt("below", "Below the whole workflow"),
  ], "Above or below: every link that has to be rerouted runs in its own lane outside all nodes and groups, instead of weaving between them. Links from the same output share a lane."),
  combo("rerouteBend", "Links", "Where rerouted links bend", [
    opt("center", "Centered between columns"),
    opt("near", "Next to the node they go around"),
  ], "Centered puts the dots in the middle of the gap between two columns, so a link changes height half-way across the gap."),
  bool("rerouteAvoidGroups", "Links", "Route around groups", "Auto also keeps a link out of any group that neither of its ends is in."),
  slider("rerouteClearance", "Links", "Clearance around nodes and groups", 4, 80, 2, "How far a rerouted link stays from the nodes and groups it avoids."),
  slider("rerouteMinLength", "Links", "Only reroute links longer than", 0, 2000, 50, "Short links are left straight even if they clip a node."),

  combo("variableMode", "Links", "Replace links with variables", [
    opt("off", "No"),
    opt("long", "Long links"),
    opt("blocked", "Links that would cross a node or run backwards"),
    opt("both", "Long or blocked links"),
  ], "Swaps a link for a small Set node next to its source and a Get node next to each node that uses it. The workflow runs the same, but it then needs Prettifier installed to open."),
  slider("variableMinLength", "Links", "A link is long from", 300, 6000, 100, "Length in canvas pixels after the layout."),
  text("variableNameTemplate", "Links", "Variable name template", "Tokens: {name} the output's name, {type} data type, {source} title of the node it comes from. Names already in use get a number. Example: {source} {name}"),
  bool("variableCollapse", "Links", "Collapse variable nodes"),

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
  combo("palette", "Appearance", "Color palette", [opt("default", "ComfyUI classic"), opt("pastel", "Pastel"), opt("vivid", "Vivid"), opt("mono", "Monochrome"), opt("ocean", "Ocean"), opt("sunset", "Sunset"), opt("forest", "Forest"), opt("earth", "Earth"), opt("neon", "Neon"), opt("candy", "Candy"), opt("contrast", "High contrast"), opt("nord", "Nord"), opt("dracula", "Dracula"), opt("solarized", "Solarized"), opt("gruvbox", "Gruvbox"), opt("custom", "Custom (JSON below)")], "Colors used for stage-colored groups and nodes."),
  text("customPalette", "Appearance", "Custom palette JSON", 'Stage name to colors: {"Models": ["#group", "#nodeTitle", "#nodeBody"], "Prompt": "#groupOnly"}. Stages: Models, Inputs, Prompt, Sampling, Latent, Image, Mask, Output, Utilities, Other.'),
  combo("colorNodes", "Appearance", "Node colors", [
    opt("keep", "Don't change"),
    opt("group", "Match the group the node is in"),
    opt("stage", "Color by pipeline stage"),
    opt("type", "Color by node type (same type, same color)"),
    opt("category", "Color by node category"),
    opt("clear", "Reset to default"),
  ], "Match the group: each node takes a darker shade of its group's color, and nodes outside any group go back to the default. By type and by category pick colors from the palette."),
  text("nodeColorRules", "Appearance", "Custom node color rules", "pattern = color, separated by ; . The pattern is a regular expression matched against node type, title, category and pipeline stage. A rule wins over the choice above, and works even with 'Don't change'. Example: KSampler = #8e44ad; Loader = #1f618d; Save|Preview = #a93226"),
  combo("linkColors", "Appearance", "Link colors by data type", [
    opt("keep", "Don't change"),
    opt("palette", "Follow the color palette above"),
    opt("vivid", "Vivid"),
    opt("pastel", "Pastel"),
    opt("neon", "Neon"),
    opt("warm", "Warm"),
    opt("cool", "Cool"),
    opt("mono", "Monochrome"),
    opt("classic", "Back to ComfyUI's own colors"),
  ], "Every data type (model, latent, image, ...) gets its own link and connector color. This is a display setting of the editor, not something saved in the workflow."),
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
  linkColors: "keep",
  groupFill: "default",
  groupOpacity: 25,
  nodeColorRules: "",
  linkStyle: "keep",
  animate: true,
  animationMs: 350,
  fitView: false,
  scope: "auto",
  showToast: true,
  rerouteMode: "auto",
  rerouteStyle: "detour",
  rerouteBend: "center",
  rerouteTurn: "auto",
  rerouteLane: "auto",
  rerouteAvoidGroups: true,
  rerouteClearance: 16,
  rerouteMinLength: 300,
  ...VARIABLE_DEFAULTS,
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
