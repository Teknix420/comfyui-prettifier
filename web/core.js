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
  linkGeometry,
  selectedNodes,
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
import { pickVariableLinks, linksToVariables, variablesToLinks, isVariableNode, isSetNode, isGetNode, variableName } from "./variables.js";
import { isSubgraph, subgraphsInnerFirst, renameSubgraphSlots, reorderSubgraphSlots, snapshotSubgraphIO, restoreSubgraphIO } from "./subgraphs.js";

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

/** Are links drawn with right angles ("Straight"), now or after this run? */
function linksAreOrthogonal(app, o) {
  const mode = LINK_MODES[o.linkStyle] ?? app.canvas?.links_render_mode;
  return mode === LINK_MODES.straight;
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
  return { app, graph, parts: graphs.map((g) => ({ main: takeSnapshot(g), reroutes: snapshotReroutes(g), io: snapshotSubgraphIO(g) })) };
}

export function restoreAll(snap) {
  // Subgraph connector order first: node snapshots address connectors by position.
  for (const part of snap.parts) {
    try {
      restoreSubgraphIO(snap.app, part.io);
    } catch (err) {
      console.warn("[Prettifier] could not restore subgraph connectors", err);
    }
  }
  for (const part of snap.parts) {
    // Variables created since the snapshot become ordinary links again.
    try {
      const known = new Set(part.main.nodes.map((s) => s.node));
      variablesToLinks(part.main.graph, (n) => !known.has(n));
    } catch (err) {
      console.warn("[Prettifier] could not restore links replaced by variables", err);
    }
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
  const stats = { moved: 0, groups: 0, renamed: { titles: 0, labels: 0 }, collapsed: 0, reroutes: { removed: 0, added: 0 }, variables: 0 };
  stats.collapsed = applyCollapseRules(nodes, o);
  if (o.autoNote && !isSelection && !isChild) {
    const r = upsertSummaryNote(graph, o);
    if (r?.created) nodes = graphNodes(graph);
  }
  if (o.renameOnPrettify) {
    // A subgraph's own connectors are renamed first so {source} inside it sees the new names.
    const io = !isSelection && isSubgraph(graph) ? renameSubgraphSlots(app, graph, o) : 0;
    stats.renamed = renameNodes(graph, nodes, renameOpts(o));
    stats.renamed.labels += io;
  }
  if (o.variableMode !== "off") {
    // Judge links by where the layout is about to put them, swap the long ones for
    // variables, then lay everything out with the new nodes in place.
    const geo = linkGeometry(graph, nodes.filter((n) => !isVariableNode(n)), { ...o, isSelection });
    const made = linksToVariables(graph, pickVariableLinks(geo.links, geo.boxes, o), o, "over");
    if (made.nodes.length) nodes = isSelection ? [...nodes, ...made.nodes] : graphNodes(graph);
    stats.variables = made.links;
  }
  const r = prettifyNodes(app, graph, nodes, {
    ...o,
    isSelection,
    noHistory,
    paletteColors: resolvePalette(o),
    animate: o.animate && !isChild,
    fitView: o.fitView && !isChild,
    onPlaced: () => {
      stats.reroutes = cleanReroutes(graph, nodes, { ...o, clearAll: !isSelection, linkOrthogonal: linksAreOrthogonal(app, o) });
    },
  });
  // Stage coloring runs inside the layout pass; dimming of inactive nodes wins over it.
  if (o.inactiveStyle === "dim" || o.inactiveStyle === "both") applyCollapseRules(nodes, { ...o, collapseMode: "keep", inactiveStyle: "dim" });
  stats.moved = r.moved;
  stats.groups = r.groups;
  if (!isSelection && isSubgraph(graph)) {
    if (o.subgraphSlotOrder === "inside") reorderSubgraphSlots(app, graph, "inside");
    placeSubgraphIO(graph, Math.max(60, o.hGap));
  }
  return stats;
}

// Subgraph nodes take their connector names from the subgraph when those are managed.
const renameOpts = (o) => ({ ...o, manageSubgraphSlots: o.subgraphSlotMode !== "keep" && o.subgraphMode === "all" });

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
    // Subgraphs go first (innermost first): reordering their connectors changes the
    // subgraph nodes that the outer layout then lines up.
    const child = { moved: 0, groups: 0, labels: 0, variables: 0, count: 0 };
    const withSubgraphs = o.subgraphMode === "all" && !isSelection;
    if (withSubgraphs) {
      for (const sg of subgraphsInnerFirst(app)) {
        if (sg === graph) continue;
        const inner = graphNodes(sg);
        if (!inner.length) continue;
        const s = runPasses(app, sg, inner, o, { isSelection: false, noHistory: true, isChild: true });
        child.moved += s.moved;
        child.groups += s.groups;
        child.labels += s.renamed.labels;
        child.variables += s.variables;
        child.count++;
      }
    }
    stats = runPasses(app, graph, nodes, o, { isSelection, noHistory: !recordUndo, isChild: false });
    stats.moved += child.moved;
    stats.groups += child.groups;
    stats.renamed.labels += child.labels;
    stats.variables += child.variables;
    if (child.count) stats.subgraphs = child.count;
    if (o.subgraphSlotOrder === "outside" && !isSelection) {
      for (const sg of withSubgraphs ? subgraphsInnerFirst(app) : isSubgraph(graph) ? [graph] : []) {
        if (reorderSubgraphSlots(app, sg, "outside")) placeSubgraphIO(sg, Math.max(60, o.hGap));
      }
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
    if (stats.variables) parts.push(`${stats.variables} link${stats.variables === 1 ? "" : "s"} replaced by variables`);
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
  if (o.nodeTitleMode === "keep" && o.slotLabelMode === "keep" && o.subgraphSlotMode === "keep") {
    toast(app, "info", "Prettifier", "No renaming rules are set. Open Prettifier options, Renaming tab.");
    return null;
  }
  lastSnapshot = snapshotAll(app, graph);
  const r = { titles: 0, labels: 0 };
  const targets = [{ graph, nodes }];
  if (!isSelection && o.subgraphMode === "all") for (const sg of subgraphsInnerFirst(app)) if (sg !== graph) targets.push({ graph: sg, nodes: graphNodes(sg) });
  for (const t of targets) {
    if (!isSelection && isSubgraph(t.graph)) r.labels += renameSubgraphSlots(app, t.graph, o);
    const part = renameNodes(t.graph, t.nodes, renameOpts(o));
    r.titles += part.titles;
    r.labels += part.labels;
  }
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
  const r = cleanReroutes(graph, nodes, { ...o, clearAll: true, linkOrthogonal: linksAreOrthogonal(app, o), rerouteMode: mode ?? (o.rerouteMode === "keep" ? "auto" : o.rerouteMode) });
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Reroutes", `${r.added} dots added, ${r.removed} removed.`);
  return r;
}

/** Replace long or blocked links by variables, judged by where the nodes are now. */
export function linksToVariablesNow(app) {
  const o = effectiveOptions(app);
  const { graph, nodes, isSelection } = resolveScope(app, o.scope);
  if (!graph || !nodes.length) return null;
  const mode = o.variableMode === "off" ? "long" : o.variableMode;
  const geo = linkGeometry(graph, nodes.filter((n) => !isVariableNode(n)));
  const ids = pickVariableLinks(geo.links, geo.boxes, { ...o, variableMode: mode });
  if (!ids.length) {
    toast(app, "info", "Prettifier", mode === "long" ? `No links longer than ${o.variableMinLength} here${isSelection ? " (selection)" : ""}.` : "No long or blocked links here.");
    return null;
  }
  lastSnapshot = snapshotAll(app, graph);
  const r = linksToVariables(graph, ids, o, "beside");
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Variables", `${r.links} link${r.links === 1 ? "" : "s"} replaced. Prettify to tidy the new nodes.`);
  return r;
}

/** Turn variables back into links: the selected Set / Get nodes, or all of them. */
export function variablesToLinksNow(app) {
  const o = effectiveOptions(app);
  const graph = activeGraph(app);
  const picked = new Set(selectedNodes(app).filter(isVariableNode));
  // Selecting a Set node means its Get nodes too.
  const names = new Set([...picked].filter(isSetNode).map((n) => variableName(n).toLowerCase()));
  for (const n of graphNodes(graph)) if (isGetNode(n) && names.has(variableName(n).toLowerCase())) picked.add(n);
  const r = variablesToLinks(graph, picked.size ? (n) => picked.has(n) : undefined);
  if (!r.removed) {
    toast(app, "info", "Prettifier", "There are no Prettifier variables to turn back into links.");
    return null;
  }
  lastSnapshot = null;
  notifyChanged(app, graph);
  app.canvas?.setDirty?.(true, true);
  if (o.showToast) toast(app, "success", "Variables", `${r.links} link${r.links === 1 ? "" : "s"} restored.`);
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
