// ComfyUI Prettifier - extension entry point.
// Registers settings, commands, a keybinding, the top menu, and canvas menu entries.

import { app } from "../../scripts/app.js";
import { settingDefinitions } from "./settings.js";
import { applyDisplay, prettify, undoLast, renameOnly, reroutesOnly, summaryNote, toast, linksToVariablesNow, variablesToLinksNow } from "./core.js";
import { registerVariableNodes } from "./variables.js";
import { openLintReport } from "./lintdialog.js";
import { forgetWorkflowOptions, isStampCurrent } from "./extras.js";
import { getOption } from "./settings.js";
import { openDialog } from "./dialog.js";
import { alignNodes, fitGroupsToNodes, fitView, activeGraph } from "./graph.js";

const cmd = (id, label, fn, icon) => ({ id: "Prettifier." + id, label, icon, function: () => fn() });

const ALIGN = [
  ["left", "Align Left"],
  ["right", "Align Right"],
  ["top", "Align Top"],
  ["bottom", "Align Bottom"],
  ["centerX", "Center Horizontally"],
  ["centerY", "Center Vertically"],
  ["distributeX", "Distribute Horizontally"],
  ["distributeY", "Distribute Vertically"],
  ["matchWidth", "Match Widths"],
  ["matchHeight", "Match Heights"],
  ["fitContent", "Shrink to Fit Content"],
];

const commands = [
  cmd("Prettify", "Prettify Workflow", () => prettify(app), "pi pi-sparkles"),
  cmd("PrettifyAll", "Prettify Whole Workflow", () => prettify(app, { scope: "all" }), "pi pi-sitemap"),
  cmd("PrettifySelection", "Prettify Selected Nodes", () => prettify(app, { scope: "selection" }), "pi pi-th-large"),
  cmd("Rename", "Rename Nodes and Connectors", () => renameOnly(app), "pi pi-tag"),
  cmd("Lint", "Lint Workflow", () => openLintReport(app), "pi pi-check-circle"),
  cmd("SummaryNote", "Create or Update Summary Note", () => summaryNote(app), "pi pi-file-edit"),
  cmd("Reroutes.Auto", "Reroute Links Around Nodes", () => reroutesOnly(app, "auto"), "pi pi-share-alt"),
  cmd("Reroutes.Remove", "Remove All Reroute Dots", () => reroutesOnly(app, "remove"), "pi pi-times"),
  cmd("Variables.Create", "Replace Long Links with Variables", () => linksToVariablesNow(app), "pi pi-at"),
  cmd("Variables.Remove", "Turn Variables Back into Links", () => variablesToLinksNow(app), "pi pi-link"),
  cmd("ForgetWorkflowOptions", "Forget This Workflow's Remembered Options", () => {
    forgetWorkflowOptions(app);
    toast(app, "info", "Prettifier", "This workflow will use your global options again.");
  }),
  cmd("OpenDialog", "Prettifier Options…", () => openDialog(app), "pi pi-sliders-h"),
  cmd("Undo", "Undo Last Prettify", () => undoLast(app), "pi pi-undo"),
  cmd("FitGroups", "Fit Groups to Their Nodes", () => fitGroupsToNodes(app), "pi pi-stop"),
  cmd("FitView", "Zoom to Fit Workflow", () => fitView(app, activeGraph(app)), "pi pi-expand"),
  ...ALIGN.map(([mode, label]) => cmd("Align." + mode, label, () => alignNodes(app, mode))),
];

function menuItems() {
  return [
    { content: "✨ Prettify Workflow", callback: () => prettify(app) },
    { content: "Prettify Selected Nodes", callback: () => prettify(app, { scope: "selection" }) },
    { content: "Rename Nodes and Connectors", callback: () => renameOnly(app) },
    { content: "Lint Workflow", callback: () => openLintReport(app) },
    { content: "Create or Update Summary Note", callback: () => summaryNote(app) },
    { content: "Reroute Links Around Nodes", callback: () => reroutesOnly(app, "auto") },
    { content: "Remove All Reroute Dots", callback: () => reroutesOnly(app, "remove") },
    { content: "Replace Long Links with Variables", callback: () => linksToVariablesNow(app) },
    { content: "Turn Variables Back into Links", callback: () => variablesToLinksNow(app) },
    { content: "Prettifier Options…", callback: () => openDialog(app) },
    { content: "Undo Last Prettify", callback: () => undoLast(app) },
    { content: "Fit Groups to Their Nodes", callback: () => fitGroupsToNodes(app) },
    {
      content: "Align Selected",
      has_submenu: true,
      submenu: { options: ALIGN.map(([mode, label]) => ({ content: label, callback: () => alignNodes(app, mode) })) },
    },
  ];
}

const canvasMenu = () => [null, { content: "Prettifier", has_submenu: true, submenu: { options: menuItems() } }];

let autoBusy = false;

/** Prettify on save (optional): wrap ComfyUI's save commands. */
function hookSave() {
  const list = app.extensionManager?.command?.commands;
  if (!Array.isArray(list)) return;
  for (const c of list) {
    if (!/^Comfy\.(SaveWorkflow|SaveWorkflowAs)$/.test(c.id) || c.__prettifierWrapped) continue;
    const orig = c.function;
    c.function = async function (...args) {
      const mode = getOption(app, "autoRun");
      if ((mode === "save" || mode === "both") && !isStampCurrent(app)) {
        try {
          prettify(app, { scope: "all", animate: false, quiet: true });
        } catch (err) {
          console.warn("[Prettifier] prettify on save failed", err);
        }
      }
      return orig.apply(this, args);
    };
    c.__prettifierWrapped = true;
  }
}

// Display settings take effect as soon as they are changed, without a prettify.
const DISPLAY_KEYS = new Set(["linkColors", "groupFill", "groupOpacity", "palette", "customPalette"]);
let displayTimer = 0;
function refreshDisplay(delay = 0) {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(() => applyDisplay(app), delay);
}
function onOptionChange(key) {
  if (DISPLAY_KEYS.has(key)) refreshDisplay(30);
}

app.registerExtension({
  name: "Comfy.Prettifier",
  settings: settingDefinitions(onOptionChange),
  commands,
  keybindings: [
    { combo: { key: "p", alt: true }, commandId: "Prettifier.Prettify" },
    { combo: { key: "p", alt: true, shift: true }, commandId: "Prettifier.OpenDialog" },
  ],
  menuCommands: [
    {
      path: ["Extensions", "Prettifier"],
      commands: ["Prettifier.Prettify", "Prettifier.PrettifySelection", "Prettifier.Rename", "Prettifier.Lint", "Prettifier.SummaryNote", "Prettifier.Reroutes.Auto", "Prettifier.Reroutes.Remove", "Prettifier.Variables.Create", "Prettifier.Variables.Remove", "Prettifier.OpenDialog", "Prettifier.Undo", "Prettifier.FitGroups", "Prettifier.ForgetWorkflowOptions"],
    },
    { path: ["Extensions", "Prettifier", "Align selected"], commands: ALIGN.map(([m]) => "Prettifier.Align." + m) },
  ],

  // The Set / Get nodes that stand in for long links.
  registerCustomNodes() {
    registerVariableNodes();
  },

  // Newer frontends: canvas right-click menu.
  getCanvasMenuItems() {
    return canvasMenu();
  },

  // Prettify on open (optional). Skipped during undo/redo and when the arrangement
  // is still the one Prettifier produced.
  afterConfigureGraph() {
    refreshDisplay(100); // a newly opened workflow can bring new data types
    const mode = getOption(app, "autoRun");
    if (mode !== "load" && mode !== "both") return;
    const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
    if (tracker?._restoringState || autoBusy) return;
    setTimeout(() => {
      if (isStampCurrent(app)) return;
      autoBusy = true;
      try {
        prettify(app, { scope: "all", animate: false, quiet: true });
      } finally {
        autoBusy = false;
      }
    }, 50);
  },

  setup() {
    hookSave();
    refreshDisplay(500);
    // Older frontends without getCanvasMenuItems / extension commands: patch the canvas menu.
    if (app.extensionManager?.command) return;
    const LGraphCanvas = globalThis.LGraphCanvas;
    if (!LGraphCanvas?.prototype?.getCanvasMenuOptions) return;
    const orig = LGraphCanvas.prototype.getCanvasMenuOptions;
    LGraphCanvas.prototype.getCanvasMenuOptions = function () {
      const options = orig.apply(this, arguments);
      options.push(...canvasMenu());
      return options;
    };
  },
});
