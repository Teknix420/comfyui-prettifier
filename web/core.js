// ComfyUI Prettifier - actions shared by commands, menus and the dialog.

import { readOptions, ALL_DEFAULTS } from "./settings.js";
import { resolvePalette } from "./themes.js";
import {
  resolveScope,
  prettifyNodes,
  renameNodes,
  changeTracker,
  takeSnapshot,
  restoreSnapshot,
  notifyChanged,
  cancelAnimation,
  graphNodes,
  activeGraph,
} from "./graph.js";
import {
  applyCollapseRules,
  cleanReroutes,
  snapshotReroutes,
  restoreReroutes,
  upsertSummaryNote,
  workflowOptions,
  rememberWorkflowOptions,
  stampWorkflow,
  allSubgraphs,
  placeSubgraphIO,
  runLint,
} from "./extras.js";

let lastSnapshot = null;

const LINK_MODES = { straight: 0, linear: 1, spline: 2 };

export function toast(app, severity, summary, detail) {
  try {
    if (app.extensionManager?.toast?.add) {
      app.extensionManager.toast.add({ severity, summary, detail, life: 3500 });
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

/** Global options, with this workflow's remembered options on top when enabled. */
export function effectiveOptions(app) {
  const o = readOptions(app);
  if (o.useWorkflowOptions) {
    const saved = workflowOptions(app);
    if (saved) for (const [k, v] of Object.entries(saved)) if (k in ALL_DEFAULTS && typeof v === typeof ALL_DEFAULTS[k]) o[k] = v;
  }
  return o;
}

// --- snapshots covering everything a prettify may touch ---------------------------

export function snapshotAll(app, graph) {
  const graphs = [graph, ...allSubgraphs(app).filter((g) => g !== graph)];
  return { graph, parts: graphs.map((g) => ({ main: takeSnapshot(g), reroutes: snapshotReroutes(g) })) };
}

export function restoreAll(snap) {
  for (const part of snap.parts) {
    restoreSnapshot(part.main);
    try {
      restoreReroutes(part.main.graph, part.reroutes);
    } catch (err) {
      console.warn("[Prettifier] could not restore reroutes", err);
    }
  }
}

// --- prettify -------------------------------------------------------------------

function runPasses(app, graph, nodes, o, { isSelection, noHistory, isChild }) {
  const stats = { moved: 0, groups: 0, renamed: { titles: 0, labels: 0 }, collapsed: 0, reroutes: { removed: 0, added: 0 } };
  stats.collapsed = applyCollapseRules(nodes, o);
  if (o.autoNote && !isSelection && !isChild) {
    const r = upsertSummaryNote(graph, o);
    if (r?.created) nodes = graphNodes(graph);
  }
  if (o.renameOnPrettify) stats.renamed = renameNodes(graph, nodes, o);
  const r = prettifyNodes(app, graph, nodes, {
    ...o,
    isSelection,
    noHistory,
    paletteColors: resolvePalette(o),
    animate: o.animate && !isChild,
    fitView: o.fitView && !isChild,
    onPlaced: () => {
      stats.reroutes = cleanReroutes(graph, nodes, o);
    },
  });
  // Stage coloring runs inside the layout pass; dimming of inactive nodes wins over it.
  if (o.inactiveStyle === "dim" || o.inactiveStyle === "both") applyCollapseRules(nodes, { ...o, collapseMode: "keep", inactiveStyle: "dim" });
  stats.moved = r.moved;
  stats.groups = r.groups;
  return stats;
}

/**
 * Prettify the workflow (or selection).
 * options: { scope?, overrides?, animate?, recordUndo?, quiet? }
 */
export function prettify(app, { scope, overrides, animate, recordUndo = true, quiet = false } = {}) {
  const o = overrides ? { ...readOptions(app), ...overrides } : effectiveOptions(app);
  if (animate !== undefined) o.animate = animate;
  const { graph, nodes, isSelection } = resolveScope(app, scope ?? o.scope);
  if (!graph || !nodes.length) {
    if (!quiet) toast(app, "warn", "Prettifier", isSelection ? "Select some nodes first." : "The workflow is empty.");
    return null;
  }
  cancelAnimation();
  if (recordUndo) lastSnapshot = snapshotAll(app, graph);
  let stats;
  // Hold the undo history open so every pass becomes a single undo step.
  const tracker = recordUndo ? changeTracker(app) : null;
  tracker?.beforeChange?.();
  try {
    stats = runPasses(app, graph, nodes, o, { isSelection, noHistory: !recordUndo, isChild: false });
    if (o.subgraphMode === "all" && !isSelection) {
      for (const sg of allSubgraphs(app)) {
        if (sg === graph) continue;
        const inner = graphNodes(sg);
        if (!inner.length) continue;
        const s = runPasses(app, sg, inner, o, { isSelection: false, noHistory: true, isChild: true });
        placeSubgraphIO(sg, Math.max(60, o.hGap));
        stats.moved += s.moved;
        stats.groups += s.groups;
        stats.subgraphs = (stats.subgraphs || 0) + 1;
      }
    } else if (!isSelection && graph !== (app.rootGraph ?? app.graph)) {
      placeSubgraphIO(graph, Math.max(60, o.hGap));
    }
    if (recordUndo && !isSelection) {
      if (o.rememberWorkflowOptions && !quiet) rememberWorkflowOptions(app, o, ALL_DEFAULTS);
      stampWorkflow(app);
    }
  } catch (err) {
    console.error("[Prettifier] failed", err);
    toast(app, "error", "Prettifier failed", String(err?.message ?? err));
    if (recordUndo && lastSnapshot) restoreAll(lastSnapshot);
    return null;
  } finally {
    tracker?.afterChange?.();
  }
  applyLinkStyle(app, o.linkStyle);
  let issues = null;
  if (o.lintOnPrettify && !quiet) issues = runLint(graph, o);
  if (!quiet && o.showToast) {
    const parts = [
      `${stats.moved} node${stats.moved === 1 ? "" : "s"}${isSelection ? " (selection)" : ""}`,
      `${stats.groups} group${stats.groups === 1 ? "" : "s"}`,
    ];
    if (stats.renamed.titles || stats.renamed.labels) parts.push(`${stats.renamed.titles} renamed, ${stats.renamed.labels} connector labels`);
    if (stats.reroutes.added || stats.reroutes.removed) parts.push(`${stats.reroutes.added} reroute dots added, ${stats.reroutes.removed} removed`);
    if (stats.subgraphs) parts.push(`${stats.subgraphs} subgraph${stats.subgraphs === 1 ? "" : "s"}`);
    if (issues?.length) parts.push(`${issues.length} lint finding${issues.length === 1 ? "" : "s"} (run "Lint workflow")`);
    toast(app, "success", "Workflow prettified", parts.join(", ") + ".");
  }
  return stats;
}

/** Apply only the renaming rules (no layout). */
export function renameOnly(app, { scope } = {}) {
  const o = effectiveOptions(app);
  const { graph, nodes, isSelection } = resolveScope(app, scope ?? o.scope);
  if (!graph || !nodes.length) {
    toast(app, "warn", "Prettifier", isSelection ? "Select some nodes first." : "The workflow is empty.");
    return null;
  }
  if (o.nodeTitleMode === "keep" && o.slotLabelMode === "keep") {
    toast(app, "info", "Prettifier", "No renaming rules are set. Open Prettifier options, Renaming tab.");
    return null;
  }
  lastSnapshot = snapshotAll(app, graph);
  const r = renameNodes(graph, nodes, o);
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Renamed", `${r.titles} node title${r.titles === 1 ? "" : "s"}, ${r.labels} connector label${r.labels === 1 ? "" : "s"}.`);
  return r;
}

/** Reroute cleanup only, using the current option (or "auto" if it is set to keep). */
export function reroutesOnly(app, mode) {
  const o = effectiveOptions(app);
  const graph = activeGraph(app);
  const nodes = graphNodes(graph);
  if (!nodes.length) return null;
  lastSnapshot = snapshotAll(app, graph);
  const r = cleanReroutes(graph, nodes, { ...o, rerouteMode: mode ?? (o.rerouteMode === "keep" ? "auto" : o.rerouteMode) });
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Reroutes", `${r.added} dots added, ${r.removed} removed.`);
  return r;
}

/** Create or refresh the summary note. */
export function summaryNote(app) {
  const o = effectiveOptions(app);
  const graph = activeGraph(app);
  lastSnapshot = snapshotAll(app, graph);
  const r = upsertSummaryNote(graph, o);
  if (!r) {
    toast(app, "warn", "Prettifier", "Could not create a note node.");
    return null;
  }
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Summary note", r.created ? "Created." : "Updated.");
  return r.note;
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
  restoreAll(lastSnapshot);
  notifyChanged(app, lastSnapshot.graph);
  lastSnapshot = null;
  app.canvas?.setDirty?.(true, true);
  return true;
}
