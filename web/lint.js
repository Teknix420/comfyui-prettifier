// ComfyUI Prettifier - workflow lint checks (pure, no ComfyUI imports).
//
// nodes: [{ id, title, type, stage, isOutput, isNote, mode (0 active, 2 muted, 4 bypassed), missingType,
//           inputs:  [{ name, required, connected, isWidget }],
//           outputs: [{ name, connected }],
//           widgets: [{ name, value, min, max, choices }] }]
// Returns [{ severity: "error"|"warning"|"info", check, nodeId, title, message }]

export const LINT_DEFAULTS = {
  lintOnPrettify: false,
  lintMissing: true,
  lintUnused: true,
  lintDuplicates: true,
  lintValues: true,
  lintInactive: true,
  lintMaxSteps: 100,
  lintMaxCfg: 20,
};

const ORDER = { error: 0, warning: 1, info: 2 };

export function lintModel(nodes, userOpts = {}) {
  const o = { ...LINT_DEFAULTS, ...userOpts };
  const out = [];
  const add = (severity, check, n, message) => out.push({ severity, check, nodeId: n.id, title: n.title || n.type, message });

  for (const n of nodes) {
    if (n.isNote) continue;
    const active = !n.mode;

    if (o.lintMissing) {
      if (n.missingType) add("error", "missing", n, `Node type "${n.type}" is not installed.`);
      if (active)
        for (const i of n.inputs || [])
          if (i.required && !i.connected && !i.isWidget) add("error", "missing", n, `Required input "${i.name}" is not connected.`);
      for (const w of n.widgets || [])
        if (Array.isArray(w.choices) && w.choices.length && typeof w.value === "string" && !w.choices.includes(w.value))
          add("error", "missing", n, `"${w.name}" is set to "${w.value}", which is not in the list of available options.`);
    }

    if (o.lintUnused && active && !n.isOutput && (n.outputs || []).length && !(n.outputs || []).some((x) => x.connected))
      add("warning", "unused", n, "None of this node's outputs are used.");

    if (o.lintInactive && n.mode) add("info", "inactive", n, n.mode === 4 ? "Node is bypassed." : "Node is muted.");

    if (o.lintValues && active) {
      for (const w of n.widgets || []) {
        const v = w.value;
        const name = String(w.name || "").toLowerCase();
        if (typeof v === "number") {
          if (w.min != null && v < w.min) add("warning", "values", n, `"${w.name}" is ${v}, below its minimum of ${w.min}.`);
          if (w.max != null && v > w.max) add("warning", "values", n, `"${w.name}" is ${v}, above its maximum of ${w.max}.`);
          if (name === "steps" && v > o.lintMaxSteps) add("warning", "values", n, `${v} steps is unusually high.`);
          if (name === "cfg" && v > o.lintMaxCfg) add("warning", "values", n, `CFG ${v} is unusually high.`);
          if (name === "denoise" && v === 0) add("warning", "values", n, "Denoise is 0, so this sampler does nothing.");
          if ((name === "width" || name === "height") && /latent/i.test(n.type) && v % 8 !== 0)
            add("warning", "values", n, `${w.name} ${v} is not a multiple of 8.`);
          if (/^strength/.test(name) && v === 0 && /lora/i.test(n.type)) add("info", "values", n, `"${w.name}" is 0, so this LoRA has no effect there.`);
        } else if (typeof v === "string") {
          if (name === "text" && /textencode/i.test(n.type) && !v.trim()) {
            const linked = (n.inputs || []).some((i) => i.name === w.name && i.connected);
            if (!linked) add("info", "values", n, "Prompt text is empty.");
          }
        }
      }
    }
  }

  if (o.lintDuplicates) {
    const seen = new Map();
    for (const n of nodes) {
      if (n.isNote || n.stage !== "Models" || (n.inputs || []).some((i) => i.connected)) continue;
      const key = n.type + "|" + JSON.stringify((n.widgets || []).map((w) => [w.name, w.value]));
      if (seen.has(key)) add("info", "duplicates", n, `Same loader and settings as "${seen.get(key).title || seen.get(key).type}" (#${seen.get(key).id}); one could feed both.`);
      else seen.set(key, n);
    }
  }

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
