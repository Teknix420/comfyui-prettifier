// ComfyUI Prettifier - extension entry point.
// Registers settings, commands, a keybinding, the top menu, and canvas menu entries.

import { app } from "../../scripts/app.js";
import { settingDefinitions } from "./settings.js";
import { prettify, undoLast } from "./core.js";
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
      commands: ["Prettifier.Prettify", "Prettifier.PrettifySelection", "Prettifier.OpenDialog", "Prettifier.Undo", "Prettifier.FitGroups"],
    },
    { path: ["Extensions", "Prettifier", "Align selected"], commands: ALIGN.map(([m]) => "Prettifier.Align." + m) },
  ],

  // Newer frontends: canvas right-click menu.
  getCanvasMenuItems() {
    return canvasMenu();
  },

  setup() {
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
