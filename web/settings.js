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
  combo("direction", "Layout", "Flow Direction", [opt("LR", "Left to Right"), opt("TB", "Top to Bottom")], "Which way the workflow reads. Left to right suits ComfyUI's side-mounted inputs and outputs."),
  combo("layering", "Layout", "Column Assignment", [
    opt("balanced", "Balanced (loaders sit next to what uses them)"),
    opt("early", "As Early as Possible"),
    opt("late", "As Late as Possible (pack toward outputs)"),
  ], "How nodes are assigned to columns along the flow."),
  combo("verticalAlign", "Layout", "Vertical Alignment", [
    opt("links", "Straighten Links"),
    opt("top", "Stack from Top"),
    opt("center", "Center Each Column"),
  ], "Straighten links lines up connected sockets so links run as flat as possible."),
  combo("columnAlign", "Layout", "Node Alignment Inside a Column", [opt("left", "Left"), opt("center", "Center"), opt("right", "Right")]),
  slider("orderingPasses", "Layout", "Crossing Reduction Passes", 0, 24, 1, "More passes means fewer crossing links on big workflows, at the cost of speed."),
  slider("alignIterations", "Layout", "Link Straightening Iterations", 0, 30, 1),
  bool("preserveOrder", "Layout", "Respect Current Top-to-Bottom Order", "Use the existing vertical order of nodes as the starting point."),

  // Spacing
  slider("hGap", "Spacing", "Horizontal Gap Between Columns", 0, 400, 10),
  slider("vGap", "Spacing", "Vertical Gap Between Nodes", 0, 300, 5),
  slider("componentGap", "Spacing", "Gap Between Separate Sections", 0, 800, 10, "Space between unconnected parts of the workflow."),
  bool("snapToGrid", "Spacing", "Snap to Grid"),
  slider("gridSize", "Spacing", "Grid Size", 1, 100, 1),
  combo("origin", "Spacing", "Anchor", [opt("keep", "Keep Workflow Where It Is"), opt("zero", "Move to Canvas Origin")]),

  // Sizing
  combo("widthMode", "Sizing", "Node Width", [
    opt("column", "Uniform per Column"),
    opt("fit", "Fit Content"),
    opt("fixed", "Fixed Width"),
    opt("keep", "Don't Change"),
  ]),
  slider("fixedWidth", "Sizing", "Fixed Width", 100, 1000, 10),
  slider("minWidth", "Sizing", "Minimum Width", 50, 800, 10),
  slider("maxWidth", "Sizing", "Maximum Width", 100, 1600, 10),
  combo("heightMode", "Sizing", "Node Height", [opt("fit", "Fit Content"), opt("keep", "Don't Change")]),
  bool("shrinkLarge", "Sizing", "Also Shrink Nodes with Images or Text Boxes", "When off, nodes showing images, previews or multiline text are never made smaller."),

  // Groups
  combo("groupBy", "Groups", "Create Groups By", [
    opt("auto", "Auto (keep my groups, otherwise by stage)"),
    opt("existing", "Keep and Tidy My Existing Groups"),
    opt("stage", "Pipeline Stage (Models, Prompt, Sampling…)"),
    opt("category", "Node Category"),
    opt("component", "Connected Section"),
    opt("type", "Node Type (all KSamplers together…)"),
    opt("color", "Node Color (nodes I colored the same)"),
    opt("rules", "Only My Custom Rules"),
    opt("none", "No Groups (removes groups)"),
  ], "Grouped nodes are laid out together and the group is sized to fit them."),
  combo("packing", "Groups", "Arrangement", [
    opt("flow", "Follow the Flow (can get tall)"),
    opt("pack", "Compact: pack separate pieces side by side"),
    opt("wrap", "Most Compact: also wrap tall columns"),
  ], "How groups, and the nodes inside them, are arranged. Compact fills rows instead of one tall stack. Wrapping also splits a tall column into several, at the cost of some links passing other nodes."),
  slider("packAspect", "Groups", "Target Shape (width ÷ height)", 0.5, 4, 0.1, "Used by the compact arrangements. 1 is square, 1.6 is about the shape of a screen, higher is wider and flatter."),
  text("groupRules", "Groups", "Custom Group Rules", "Name = pattern, separated by ; . Add a color after the name if you like. The pattern is a regular expression matched against node type, title, category and pipeline stage. Rules are checked first, in order; other nodes follow 'Create groups by'. Example: Loaders #3f789e = Loader|Checkpoint; Prompts = TextEncode; Upscale = upscal"),
  text("groupExclude", "Groups", "Don't Create Groups Named", "Regular expression matched against the group name. Example: Utilities|Other"),
  text("groupTitleTemplate", "Groups", "Group Name Template", "Tokens: {name} the group's name, {count} number of nodes, {n} group number, {stage} pipeline stage. Example: {n}. {name} ({count})"),
  text("groupTitleRules", "Groups", "Group Name Find/Replace Rules", "find => replace, separated by ; (find is a regular expression). Example: Models => Loaders; Output => Results"),
  bool("groupNumberDuplicates", "Groups", "Number Groups with the Same Name", "A stage can end up as two groups (for example prompts before and after a sampler). This names them Prompt 1 and Prompt 2."),
  bool("groupRestyleExisting", "Groups", "Apply Title Size to My Existing Groups"),
  slider("minGroupSize", "Groups", "Minimum Nodes per New Group", 1, 10, 1),
  slider("categoryDepth", "Groups", "Category Depth", 1, 4, 1, "For 'Node category': how many levels of the category path to use (e.g. 1 = 'image', 2 = 'image/upscaling')."),
  slider("groupPadding", "Groups", "Group Padding", 0, 120, 2),
  slider("groupFontSize", "Groups", "Group Title Size", 10, 64, 1),
  combo("groupFill", "Groups", "Group Background", [
    opt("default", "ComfyUI Default"),
    opt("fill", "Filled, at the Opacity Below"),
    opt("outline", "Outline Only"),
  ], "How every group is drawn in the editor. Outline only keeps the border and title and leaves the inside clear. A display setting, not saved in the workflow."),
  slider("groupOpacity", "Groups", "Group Background Opacity (%)", 0, 100, 5, "Used with 'Filled'. ComfyUI's own value is 25."),
  combo("groupColor", "Groups", "Group Color", [
    opt("auto", "Auto (keep existing, stage colors for new)"),
    opt("stage", "By Pipeline Stage"),
    opt("cycle", "A Different Palette Color for Each Group"),
    opt("single", "Single Color"),
    opt("none", "Don't Change"),
  ]),
  text("groupSingleColor", "Groups", "Single Group Color", "Any CSS color, e.g. #3f789e"),

  // Placement
  combo("isolatedPlacement", "Placement", "Unconnected Nodes", [opt("bottom", "Row Below"), opt("right", "Column to the Right"), opt("keep", "Leave Where They Are")]),
  combo("notePlacement", "Placement", "Notes", [opt("top", "Row Above the Workflow"), opt("bottom", "Row Below"), opt("keep", "Leave Where They Are")]),
  combo("looseSort", "Placement", "Sort Unconnected Nodes By", [opt("id", "Node ID"), opt("title", "Title A to Z"), opt("position", "Current Position")], "The order of notes and of nodes with no links, on the canvas and inside groups. Nodes with links follow the wiring instead."),
  combo("componentPacking", "Placement", "Separate Sections", [opt("vertical", "Stack Vertically"), opt("horizontal", "Side by Side")]),
  combo("looseAlign", "Placement", "Align Ungrouped Nodes With", [opt("box", "The Group Box"), opt("nodes", "The Nodes Inside Groups")], "Next to a group, an ungrouped node can line up with the edge of the group box or, inset by the group padding, with the nodes inside it."),
  bool("looseMatchWidth", "Placement", "Ungrouped Nodes Match Grouped Node Width", "With 'The nodes inside groups': an ungrouped node in the same column as a group is widened to the width of the group's interior."),
  bool("respectPinned", "Placement", "Never Move Pinned Nodes"),

  // Links
  combo("rerouteMode", "Links", "Reroute Dots", [
    opt("auto", "Auto (clear old dots, add new ones around nodes and groups)"),
    opt("remove", "Remove All Reroute Dots"),
    opt("keep", "Leave Reroute Dots Alone"),
  ], "Auto routes long links above or below the nodes they would otherwise run through."),
  combo("rerouteStyle", "Links", "Rerouted Links", [
    opt("detour", "Take the Shortest Way Around"),
    opt("level", "Stay Level, Bend Only Where Needed"),
  ], "Stay level: a rerouted link runs horizontally as far as it can and only gets a dot where it has to change height to pass something, or just before its input."),
  combo("rerouteTurn", "Links", "Link Direction Preference", [
    opt("auto", "No Preference (ComfyUI turns half-way)"),
    opt("horizontal", "Horizontal First: run level, turn near the input"),
    opt("vertical", "Vertical First: turn near the output, then run level"),
  ], "For links whose two ends are at different heights and that are longer than 'Only reroute links longer than'. Two dots make the link turn once, at the chosen end, instead of wherever the middle happens to be. Most visible with the Straight link style."),
  combo("rerouteLane", "Links", "Send Rerouted Links", [
    opt("auto", "Around Whatever Is in the Way"),
    opt("above", "Above the Whole Workflow"),
    opt("below", "Below the Whole Workflow"),
  ], "Above or below: every link that has to be rerouted runs in its own lane outside all nodes and groups, instead of weaving between them. Links from the same output share a lane."),
  combo("rerouteMerge", "Links", "Overlapping Links", [
    opt("off", "Keep Links Side by Side"),
    opt("output", "Merge Links From the Same Output"),
    opt("all", "Merge All Links on the Same Path"),
  ], "Rerouted links that take the same path normally run next to each other, each in its own lane. Merging lets them run on top of each other as one line. Links from the same output then share their dots until they branch."),
  combo("rerouteBend", "Links", "Where Rerouted Links Bend", [
    opt("center", "Centered Between Columns"),
    opt("near", "Next to the Node They Go Around"),
  ], "Centered puts the dots in the middle of the gap between two columns, so a link changes height half-way across the gap."),
  bool("rerouteAvoidGroups", "Links", "Route Around Groups", "Auto also keeps a link out of any group that neither of its ends is in."),
  slider("rerouteClearance", "Links", "Clearance Around Nodes and Groups", 4, 80, 2, "How far a rerouted link stays from the nodes and groups it avoids."),
  slider("rerouteMinLength", "Links", "Only Reroute Links Longer Than", 0, 2000, 50, "Short links are left straight even if they clip a node."),

  combo("variableMode", "Links", "Replace Links with Variables", [
    opt("off", "No"),
    opt("long", "Long Links"),
    opt("blocked", "Links That Would Cross a Node or Run Backwards"),
    opt("both", "Long or Blocked Links"),
  ], "Swaps a link for a small Set node next to its source and a Get node next to each node that uses it. The workflow runs the same, but it then needs Prettifier installed to open."),
  slider("variableMinLength", "Links", "A Link Is Long From", 300, 6000, 100, "Length in canvas pixels after the layout."),
  text("variableNameTemplate", "Links", "Variable Name Template", "Tokens: {name} the output's name, {type} data type, {source} title of the node it comes from. Names already in use get a number. Example: {source} {name}"),
  bool("variableCollapse", "Links", "Collapse Variable Nodes"),

  // Nodes
  combo("collapseMode", "Nodes", "Collapse Nodes", [opt("keep", "Don't Change"), opt("collapse", "Collapse Matching Nodes"), opt("expand", "Expand Everything")]),
  text("collapseMatch", "Nodes", "Collapse Nodes Matching", "Regular expression matched against node type, title and pipeline stage. Example: Loader|Primitive|Utilities"),
  combo("inactiveStyle", "Nodes", "Muted and Bypassed Nodes", [opt("keep", "Don't Change"), opt("dim", "Dim"), opt("collapse", "Collapse"), opt("both", "Dim and Collapse")]),
  combo("subgraphMode", "Nodes", "Subgraphs", [opt("all", "Prettify Inside Every Subgraph Too"), opt("current", "Only the Graph I'm Looking At")], "Applies when prettifying a whole workflow."),
  combo("subgraphSlotOrder", "Nodes", "Subgraph Connector Order", [
    opt("keep", "Don't Change"),
    opt("inside", "Match the Layout Inside the Subgraph"),
    opt("outside", "Match the Nodes Around the Subgraph"),
  ], "Reorders a subgraph's inputs and outputs so fewer links cross. Inside: follows the nodes they connect to within the subgraph. Outside: follows the nodes connected to the subgraph node on the parent canvas."),

  // Notes
  bool("autoNote", "Notes", "Keep a Summary Note Up to Date", "Adds a note listing models, LoRAs, resolution, sampler settings and seeds, and refreshes it on every prettify."),
  combo("noteStyle", "Notes", "Summary Note Type", [opt("markdown", "Markdown Note"), opt("plain", "Plain Note")]),
  text("noteTitle", "Notes", "Summary Note Title"),
  bool("noteIncludePrompts", "Notes", "Include Prompt Text"),

  // Appearance
  combo("palette", "Appearance", "Color Palette", [opt("default", "ComfyUI Classic"), opt("pastel", "Pastel"), opt("vivid", "Vivid"), opt("mono", "Monochrome"), opt("ocean", "Ocean"), opt("sunset", "Sunset"), opt("forest", "Forest"), opt("earth", "Earth"), opt("neon", "Neon"), opt("candy", "Candy"), opt("contrast", "High Contrast"), opt("nord", "Nord"), opt("dracula", "Dracula"), opt("solarized", "Solarized"), opt("gruvbox", "Gruvbox"), opt("custom", "Custom (JSON below)")], "Colors used for stage-colored groups and nodes."),
  text("customPalette", "Appearance", "Custom Palette JSON", 'Stage name to colors: {"Models": ["#group", "#nodeTitle", "#nodeBody"], "Prompt": "#groupOnly"}. Stages: Models, Inputs, Prompt, Sampling, Latent, Image, Mask, Output, Utilities, Other.'),
  combo("colorNodes", "Appearance", "Node Colors", [
    opt("keep", "Don't Change"),
    opt("group", "Match the Group the Node Is In"),
    opt("stage", "Color by Pipeline Stage"),
    opt("type", "Color by Node Type (same type, same color)"),
    opt("category", "Color by Node Category"),
    opt("clear", "Reset to Default"),
  ], "Match the group: each node takes a darker shade of its group's color, and nodes outside any group go back to the default. By type and by category pick colors from the palette."),
  text("nodeColorRules", "Appearance", "Custom Node Color Rules", "pattern = color, separated by ; . The pattern is a regular expression matched against node type, title, category and pipeline stage. A rule wins over the choice above, and works even with 'Don't change'. Example: KSampler = #8e44ad; Loader = #1f618d; Save|Preview = #a93226"),
  combo("linkColors", "Appearance", "Link Colors by Data Type", [
    opt("keep", "Don't Change"),
    opt("palette", "Follow the Color Palette Above"),
    opt("vivid", "Vivid"),
    opt("pastel", "Pastel"),
    opt("neon", "Neon"),
    opt("warm", "Warm"),
    opt("cool", "Cool"),
    opt("mono", "Monochrome"),
    opt("classic", "Back to ComfyUI's Own Colors"),
  ], "Every data type (model, latent, image, ...) gets its own link and connector color. This is a display setting of the editor, not something saved in the workflow."),
  combo("linkStyle", "Appearance", "Link Style", [opt("keep", "Don't Change"), opt("spline", "Spline"), opt("linear", "Linear"), opt("straight", "Straight (right angles)")]),
  bool("animate", "Appearance", "Animate Node Movement"),
  slider("animationMs", "Appearance", "Animation Duration (ms)", 0, 2000, 50),
  bool("fitView", "Appearance", "Zoom to Fit Afterwards"),

  // Renaming
  bool("renameOnPrettify", "Renaming", "Apply Renaming When Prettifying", "When off, renaming only happens through the 'Rename nodes and connectors' command."),
  combo("nodeTitleMode", "Renaming", "Node Titles", [opt("keep", "Don't Change"), opt("default", "Reset to Default Names"), opt("template", "Use Template")]),
  text("nodeTitleTemplate", "Renaming", "Node Title Template", "Tokens: {title} current title (use {default} instead if you re-run often, so prefixes don't stack), {default} default name, {type}, {id}, {n} number among nodes of the same type, {stage}, {category}, {group}, {widget:NAME} a widget's value (e.g. {widget:ckpt_name}). [Bracketed parts] are dropped when a token inside is empty. Example: {stage}: {default}[ ({widget:sampler_name})]"),
  combo("nodeTitleApplyTo", "Renaming", "Rename Which Nodes", [opt("all", "All Nodes"), opt("untouched", "Only Nodes Still Using Their Default Name"), opt("renamed", "Only Nodes I Renamed")]),
  text("nodeTypeFilter", "Renaming", "Only Node Types Matching", "Regular expression matched against the node type or default name. Empty = every node. Example: Sampler|Loader"),
  combo("nodeTitleCase", "Renaming", "Node Title Capitalization", [opt("none", "Don't Change"), opt("title", "Title Case"), opt("upper", "UPPERCASE"), opt("lower", "lowercase")]),
  combo("nodeNumbering", "Renaming", "Number Node Titles", [opt("none", "No"), opt("duplicates", "Only Duplicates (KSampler 1, KSampler 2)"), opt("all", "Every Renamed Node")], "Numbers follow the flow, left to right then top to bottom."),
  text("nodeTitleRules", "Renaming", "Node Title Find/Replace Rules", "find => replace, separated by ; (find is a regular expression). Prefix with a type filter using :: to limit a rule. Example: \\(Prompt\\) => ; CLIPTextEncode :: ^CLIP Text Encode => Prompt"),
  combo("slotLabelMode", "Renaming", "Connector Labels", [opt("keep", "Don't Change"), opt("reset", "Reset to Default Names"), opt("type", "Show Data Type (MODEL, LATENT…)"), opt("template", "Use Template")]),
  text("slotLabelTemplate", "Renaming", "Connector Label Template", "Tokens: {name} connector name, {label} current label, {type} data type, {node} this node's title, {source} title of the node feeding this input, {sourceSlot} name of that node's output. Example: {name}[ ← {source}]"),
  combo("slotApplyTo", "Renaming", "Rename Which Connectors", [opt("both", "Inputs and Outputs"), opt("inputs", "Inputs Only"), opt("outputs", "Outputs Only")]),
  bool("slotOnlyConnected", "Renaming", "Only Connected Connectors"),
  bool("slotIncludeWidgets", "Renaming", "Also Relabel Widget Inputs", "Widgets (seed, steps, text…) double as inputs. When off, they are only relabelled if something is connected to them."),
  combo("slotLabelCase", "Renaming", "Connector Capitalization", [opt("none", "Don't Change"), opt("title", "Title Case (latent_image → Latent Image)"), opt("upper", "UPPERCASE"), opt("lower", "lowercase")]),
  text("slotLabelRules", "Renaming", "Connector Find/Replace Rules", "find => replace, separated by ; . Prefix with a data type filter using :: . Example: CONDITIONING :: ^positive$ => + prompt; _ => (space)"),

  combo("subgraphSlotMode", "Renaming", "Subgraph Connectors", [opt("keep", "Don't Change"), opt("reset", "Reset to Original Names"), opt("type", "Show Data Type (MODEL, LATENT…)"), opt("template", "Use Template")], "Renames a subgraph's own inputs and outputs: the panels inside it and the connectors on the subgraph node. Uses the connector capitalization and find/replace rules."),
  text("subgraphSlotTemplate", "Renaming", "Subgraph Connector Template", "Tokens: {name} original name, {label} current label, {type} data type, {inner} name of the connector it is wired to inside, {node} title of that inside node, {source} title of the node feeding it on the parent canvas, {subgraph} subgraph name. Example: {node}: {inner}"),

  // Behavior
  combo("scope", "Behavior", "Prettify What", [
    opt("auto", "Selection If 2+ Nodes Selected, Else Everything"),
    opt("all", "Always the Whole Workflow"),
    opt("selection", "Only Selected Nodes"),
  ]),
  combo("autoRun", "Behavior", "Prettify Automatically", [opt("off", "Never"), opt("load", "When a Workflow Is Opened"), opt("save", "When a Workflow Is Saved"), opt("both", "On Open and on Save")], "On open is skipped when the workflow is still arranged the way Prettifier left it."),
  bool("rememberWorkflowOptions", "Behavior", "Remember Options Inside Each Workflow", "Stores the options a workflow was prettified with in the workflow file."),
  bool("useWorkflowOptions", "Behavior", "Use a Workflow's Remembered Options", "When a workflow carries remembered options, quick prettify uses them instead of your global ones."),
  bool("showToast", "Behavior", "Show a Summary Message"),

  // Lint
  bool("lintOnPrettify", "Lint", "Check the Workflow When Prettifying", "Adds the number of findings to the summary message."),
  bool("lintMissing", "Lint", "Missing Inputs, Models and Node Types"),
  bool("lintUnused", "Lint", "Nodes Whose Outputs Are Never Used"),
  bool("lintDuplicates", "Lint", "Duplicate Loaders"),
  bool("lintValues", "Lint", "Suspicious Widget Values"),
  bool("lintInactive", "Lint", "Muted and Bypassed Nodes"),
  slider("lintMaxSteps", "Lint", "Flag Steps Above", 10, 500, 5),
  slider("lintMaxCfg", "Lint", "Flag CFG Above", 1, 100, 1),
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
  rerouteMerge: "off",
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
