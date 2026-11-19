// ComfyUI Prettifier - lint report panel. Click a finding to jump to its node.

import { ensureStyle } from "./dialog.js";
import { activeGraph, graphNodes } from "./graph.js";
import { runLint } from "./extras.js";
import { effectiveOptions } from "./core.js";

let panel = null;

export function openLintReport(app) {
  ensureStyle();
  panel?.remove();
  const graph = activeGraph(app);
  const findings = runLint(graph, effectiveOptions(app));

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const overlay = el("div", "pf-overlay");
  const dialog = el("div", "pf-dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", "Workflow lint report");
  const head = el("div", "pf-head");
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  head.append(el("h3", null, `Lint Report: ${findings.length ? `${counts.error} errors, ${counts.warning} warnings, ${counts.info} notes` : "All Clear"}`));
  const x = el("button", "pf-x", "×");
  x.title = "Close";
  head.append(x);
  const body = el("div", "pf-body");
  body.style.margin = "10px";
  body.style.borderRadius = "6px";
  if (!findings.length) body.append(el("div", "pf-muted", "No problems found with the enabled checks."));
  else {
    const list = el("ul", "pf-lint");
    for (const f of findings) {
      const li = el("li");
      li.title = "Click to show this node";
      li.append(el("span", "pf-sev " + f.severity, f.severity));
      const text = el("div");
      text.append(el("b", null, `${f.title} (#${f.nodeId})`), el("span", null, f.message));
      li.append(text);
      li.addEventListener("click", () => {
        const node = graphNodes(graph).find((n) => n.id === f.nodeId);
        if (!node) return;
        try {
          app.canvas.centerOnNode(node);
          app.canvas.selectNode?.(node, false);
          app.canvas.setDirty(true, true);
        } catch {}
      });
      list.append(li);
    }
    body.append(list);
  }
  const foot = el("div", "pf-foot");
  const again = el("button", "pf-btn", "Check Again");
  again.addEventListener("click", () => openLintReport(app));
  const close = el("button", "pf-btn primary", "Close");
  foot.append(again, close);
  dialog.append(head, body, foot);
  overlay.append(dialog);
  const done = () => {
    overlay.remove();
    if (panel === overlay) panel = null;
  };
  x.addEventListener("click", done);
  close.addEventListener("click", done);
  document.body.append(overlay);
  panel = overlay;
  return findings;
}
