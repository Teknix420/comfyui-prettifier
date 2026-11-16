// ComfyUI Prettifier - actions shared by commands, menus and the dialog.

import { readOptions } from "./settings.js";
import {
  resolveScope,
  prettifyNodes,
  takeSnapshot,
  restoreSnapshot,
  notifyChanged,
  cancelAnimation,
} from "./graph.js";

let lastSnapshot = null;

const LINK_MODES = { straight: 0, linear: 1, spline: 2 };

export function toast(app, severity, summary, detail) {
  try {
    if (app.extensionManager?.toast?.add) {
      app.extensionManager.toast.add({ severity, summary, detail, life: 3000 });
      return;
    }
  } catch {}
  console.log(`[Prettifier] ${summary}${detail ? ": " + detail : ""}`);
}

function applyLinkStyle(app, style) {
  const mode = LINK_MODES[style];
  if (mode === undefined) return;
  try {
    app.extensionManager?.setting?.set?.("Comfy.LinkRenderMode", mode);
  } catch {}
  if (app.canvas) app.canvas.links_render_mode = mode;
}

/**
 * Prettify the workflow (or selection).
 * options: { scope?, overrides?, animate?, recordUndo?, quiet? }
 */
export function prettify(app, { scope, overrides = {}, animate, recordUndo = true, quiet = false } = {}) {
  const o = { ...readOptions(app), ...overrides };
  if (animate !== undefined) o.animate = animate;
  const { graph, nodes, isSelection } = resolveScope(app, scope ?? o.scope);
  if (!graph || !nodes.length) {
    if (!quiet) toast(app, "warn", "Prettifier", isSelection ? "Select some nodes first." : "The workflow is empty.");
    return null;
  }
  if (recordUndo) lastSnapshot = takeSnapshot(graph);
  let result;
  try {
    result = prettifyNodes(app, graph, nodes, { ...o, isSelection, noHistory: !recordUndo });
  } catch (err) {
    console.error("[Prettifier] layout failed", err);
    toast(app, "error", "Prettifier failed", String(err?.message ?? err));
    if (recordUndo && lastSnapshot) restoreSnapshot(lastSnapshot);
    return null;
  }
  applyLinkStyle(app, o.linkStyle);
  if (!quiet && o.showToast) {
    toast(
      app,
      "success",
      "Workflow prettified",
      `${result.moved} node${result.moved === 1 ? "" : "s"}${isSelection ? " (selection)" : ""}, ${result.groups} group${result.groups === 1 ? "" : "s"}.`
    );
  }
  return result;
}

export function hasUndo() {
  return !!lastSnapshot;
}

export function undoLast(app) {
  if (!lastSnapshot) {
    toast(app, "info", "Prettifier", "Nothing to undo.");
    return false;
  }
  cancelAnimation();
  restoreSnapshot(lastSnapshot);
  notifyChanged(app, lastSnapshot.graph);
  lastSnapshot = null;
  app.canvas?.setDirty?.(true, true);
  return true;
}
