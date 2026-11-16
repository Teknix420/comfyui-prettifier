// ComfyUI Prettifier - extension entry point.
// Registers settings, commands, a keybinding, the top menu, and canvas menu entries.

import { app } from "../../scripts/app.js";
import { settingDefinitions } from "./settings.js";
import { prettify, undoLast, renameOnly, reroutesOnly, summaryNote, toast, linksToVariablesNow, variablesToLinksNow } from "./core.js";
import { registerVariableNodes } from "./variables.js";
import { openLintReport } from "./lintdialog.js";
import { forgetWorkflowOptions, isStampCurrent } from "./extras.js";
import { getOption } from "./settings.js";
import { openDialog } from "./dialog.js";
import { alignNodes, fitGroupsToNodes, fitView, activeGraph } from "./graph.js";

const cmd = (id, label, fn, icon) => ({ id: "Prettifier." + id, label, icon, function: () => fn() });

const ALIGN = [
  ["left", "Align left"],
  ["right", "Align right"],
  ["top", "Align top"],
  ["bottom", "Align bottom"],
  ["centerX", "Center horizontally"],
  ["centerY", "Center vertically"],
  ["distributeX", "Distribute horizontally"],
  ["distributeY", "Distribute vertically"],
  ["matchWidth", "Match widths"],
  ["matchHeight", "Match heights"],
  ["fitContent", "Shrink to fit content"],
];

const commands = [
  cmd("Prettify", "Prettify workflow", () => prettify(app), "pi pi-sparkles"),
  cmd("PrettifyAll", "Prettify whole workflow", () => prettify(app, { scope: "all" }), "pi pi-sitemap"),
  cmd("PrettifySelection", "Prettify selected nodes", () => prettify(app, { scope: "selection" }), "pi pi-th-large"),
  cmd("Rename", "Rename nodes and connectors", () => renameOnly(app), "pi pi-tag"),
  cmd("Lint", "Lint workflow", () => openLintReport(app), "pi pi-check-circle"),
  cmd("SummaryNote", "Create or update summary note", () => summaryNote(app), "pi pi-file-edit"),
  cmd("Reroutes.Auto", "Reroute links around nodes", () => reroutesOnly(app, "auto"), "pi pi-share-alt"),
  cmd("Reroutes.Remove", "Remove all reroute dots", () => reroutesOnly(app, "remove"), "pi pi-times"),
  cmd("Variables.Create", "Replace long links with variables", () => linksToVariablesNow(app), "pi pi-at"),
  cmd("Variables.Remove", "Turn variables back into links", () => variablesToLinksNow(app), "pi pi-link"),
  cmd("ForgetWorkflowOptions", "Forget this workflow's remembered options", () => {
    forgetWorkflowOptions(app);
    toast(app, "info", "Prettifier", "This workflow will use your global options again.");
  }),
  cmd("OpenDialog", "Prettifier options…", () => openDialog(app), "pi pi-sliders-h"),
  cmd("Undo", "Undo last prettify", () => undoLast(app), "pi pi-undo"),
  cmd("FitGroups", "Fit groups to their nodes", () => fitGroupsToNodes(app), "pi pi-stop"),
  cmd("FitView", "Zoom to fit workflow", () => fitView(app, activeGraph(app)), "pi pi-expand"),
  ...ALIGN.map(([mode, label]) => cmd("Align." + mode, label, () => alignNodes(app, mode))),
];

function menuItems() {
  return [
    { content: "✨ Prettify workflow", callback: () => prettify(app) },
    { content: "Prettify selected nodes", callback: () => prettify(app, { scope: "selection" }) },
    { content: "Rename nodes and connectors", callback: () => renameOnly(app) },
    { content: "Lint workflow", callback: () => openLintReport(app) },
    { content: "Create or update summary note", callback: () => summaryNote(app) },
    { content: "Reroute links around nodes", callback: () => reroutesOnly(app, "auto") },
    { content: "Remove all reroute dots", callback: () => reroutesOnly(app, "remove") },
    { content: "Replace long links with variables", callback: () => linksToVariablesNow(app) },
    { content: "Turn variables back into links", callback: () => variablesToLinksNow(app) },
    { content: "Prettifier options…", callback: () => openDialog(app) },
    { content: "Undo last prettify", callback: () => undoLast(app) },
    { content: "Fit groups to their nodes", callback: () => fitGroupsToNodes(app) },
    {
      content: "Align selected",
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

app.registerExtension({
  name: "Comfy.Prettifier",
  settings: settingDefinitions(),
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
