// ComfyUI Prettifier - renaming engine.
//
// Pure module (no ComfyUI imports): given a description of the nodes and the
// renaming options, it returns the new node titles and connector (slot) labels.
//
// Input nodes:
//   [{ id, title, defaultTitle, type, category, stage, group, x, y,
//      widgets: { name: value },
//      inputs:  [{ name, type, label, connected, isWidget, sourceId, sourceSlot,
//                 sourceTitle?, sourceSlotName? }],
//      outputs: [{ name, type, label }] }]
//
// Result:
//   { titles: Map id -> string            (only nodes whose title changes)
//     inputs: Map id -> [label|null|undefined]   null = remove label, undefined = leave
//     outputs: Map id -> [...] }

export const RENAME_DEFAULTS = {
  renameOnPrettify: true,

  nodeTitleMode: "keep", // keep | default | template
  nodeTitleTemplate: "{title}",
  nodeTitleApplyTo: "all", // all | untouched | renamed
  nodeTypeFilter: "",
  nodeTitleCase: "none", // none | title | upper | lower
  nodeNumbering: "none", // none | duplicates | all
  nodeTitleRules: "",

  slotLabelMode: "keep", // keep | reset | type | template
  slotLabelTemplate: "{name}",
  slotApplyTo: "both", // both | inputs | outputs
  slotOnlyConnected: false,
  slotIncludeWidgets: false,
  slotLabelCase: "none", // none | title | upper | lower
  slotLabelRules: "",

  subgraphSlotMode: "keep", // keep | reset | type | template
  subgraphSlotTemplate: "{name}",
};

// --- helpers ------------------------------------------------------------------

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "via"]);

export function applyCase(s, mode) {
  if (!s) return s;
  switch (mode) {
    case "upper":
      return s.toUpperCase();
    case "lower":
      return s.toLowerCase();
    case "title":
      return s
        .replace(/[_]+/g, " ")
        .split(/(\s+)/)
        .map((w, i) => {
          if (!w.trim()) return w;
          if (/[A-Z]/.test(w.slice(1))) return w; // keep acronyms / CamelCase: VAE, KSampler, LoRA
          const lower = w.toLowerCase();
          if (i > 0 && SMALL_WORDS.has(lower)) return lower;
          return lower[0].toUpperCase() + lower.slice(1);
        })
        .join("");
    default:
      return s;
  }
}

/**
 * Fill a template. {token} is replaced by tokens[token]; {widget:name} reads a
 * widget value. A [bracketed section] is dropped entirely when any token inside
 * it is empty, e.g. "{name}[ ← {source}]".
 */
export function fillTemplate(template, tokens) {
  const lookup = (key) => {
    const k = key.trim();
    if (k.toLowerCase().startsWith("widget:")) {
      const v = tokens.widgets?.[k.slice(7).trim()];
      return v == null ? "" : String(v);
    }
    const v = tokens[k];
    return v == null ? "" : String(v);
  };
  const fill = (s) => {
    let empty = false;
    const out = s.replace(/\{([^{}]+)\}/g, (_, key) => {
      const v = lookup(key);
      if (!v) empty = true;
      return v;
    });
    return { out, empty };
  };
  let s = String(template ?? "").replace(/\[([^\[\]]*)\]/g, (_, inner) => {
    const r = fill(inner);
    return r.empty ? "" : r.out;
  });
  s = fill(s).out;
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Parse find/replace rules: "find => replace; find2 => replace2".
 * A rule may be limited to matching node types / slot types with a prefix:
 * "KSampler :: ^.*$ => Sampler". find is a regular expression (case-insensitive).
 */
export function parseRules(text) {
  const rules = [];
  for (const raw of String(text ?? "").split(/;|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const arrow = line.indexOf("=>");
    if (arrow < 0) continue;
    let left = line.slice(0, arrow).trim();
    const replace = line.slice(arrow + 2).trim();
    let filter = null;
    const sep = left.indexOf("::");
    if (sep >= 0) {
      filter = safeRegex(left.slice(0, sep).trim());
      left = left.slice(sep + 2).trim();
    }
    const find = safeRegex(left, "gi");
    if (find) rules.push({ filter, find, replace });
  }
  return rules;
}

function safeRegex(src, flags = "i") {
  if (!src) return null;
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

function applyRules(s, rules, filterSubject) {
  for (const r of rules) {
    if (r.filter && !r.filter.test(filterSubject ?? "")) continue;
    r.find.lastIndex = 0;
    s = s.replace(r.find, r.replace);
  }
  return s.replace(/\s+/g, " ").trim();
}

// --- main ----------------------------------------------------------------------

export function computeRenames(nodes, userOpts = {}) {
  const o = { ...RENAME_DEFAULTS, ...userOpts };
  const result = { titles: new Map(), inputs: new Map(), outputs: new Map() };
  const ordered = [...nodes].sort((a, b) => a.x - b.x || a.y - b.y);
  const finalTitle = new Map(nodes.map((n) => [n.id, n.title]));

  // ----- node titles
  if (o.nodeTitleMode !== "keep") {
    const typeFilter = safeRegex(o.nodeTypeFilter);
    const rules = parseRules(o.nodeTitleRules);
    const perType = new Map();
    const eligible = [];
    for (const n of ordered) {
      const idx = (perType.get(n.type) || 0) + 1;
      perType.set(n.type, idx);
      const untouched = !n.title || n.title === n.defaultTitle;
      if (o.nodeTitleApplyTo === "untouched" && !untouched) continue;
      if (o.nodeTitleApplyTo === "renamed" && untouched) continue;
      if (typeFilter && !typeFilter.test(n.type) && !typeFilter.test(n.defaultTitle ?? "")) continue;
      let t;
      if (o.nodeTitleMode === "default") t = n.defaultTitle || n.title;
      else
        t = fillTemplate(o.nodeTitleTemplate, {
          title: n.title,
          default: n.defaultTitle,
          type: n.type,
          id: n.id,
          n: idx,
          stage: n.stage,
          category: n.category,
          group: n.group,
          widgets: n.widgets,
        });
      t = applyRules(t, rules, n.type);
      t = applyCase(t, o.nodeTitleCase);
      if (!t) continue; // never blank a title
      finalTitle.set(n.id, t);
      eligible.push(n);
    }
    // numbering
    if (o.nodeNumbering !== "none") {
      const byTitle = new Map();
      for (const n of eligible) {
        const t = finalTitle.get(n.id).replace(/\s+#?\d+$/, "");
        if (!byTitle.has(t)) byTitle.set(t, []);
        byTitle.get(t).push(n);
      }
      for (const [t, list] of byTitle) {
        if (list.length < 2 && o.nodeNumbering !== "all") {
          continue;
        }
        list.forEach((n, i) => finalTitle.set(n.id, `${t} ${i + 1}`));
      }
    }
    for (const n of nodes) if (finalTitle.get(n.id) !== n.title) result.titles.set(n.id, finalTitle.get(n.id));
  }

  // ----- connector labels
  if (o.slotLabelMode !== "keep") {
    const rules = parseRules(o.slotLabelRules);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const label = (n, slot, isInput) => {
      if (o.slotLabelMode === "reset") return null;
      let s;
      if (o.slotLabelMode === "type") s = slot.type && slot.type !== "*" ? String(slot.type) : slot.name;
      else {
        const src = isInput && slot.sourceId != null ? byId.get(slot.sourceId) : null;
        s = fillTemplate(o.slotLabelTemplate, {
          name: slot.name,
          label: slot.label || slot.name,
          type: slot.type && slot.type !== "*" ? slot.type : "",
          node: finalTitle.get(n.id),
          // sourceTitle / sourceSlotName: the feeder is not a node (a subgraph's input panel).
          source: src ? finalTitle.get(src.id) : slot.sourceTitle ?? "",
          sourceSlot: src ? src.outputs?.[slot.sourceSlot]?.name ?? "" : slot.sourceSlotName ?? "",
        });
      }
      s = applyRules(s ?? "", rules, String(slot.type ?? ""));
      s = applyCase(s, o.slotLabelCase);
      if (!s || s === slot.name) return null; // same as the built-in name: no label needed
      return s;
    };
    for (const n of nodes) {
      const doSide = (slots, isInput) =>
        (slots || []).map((slot) => {
          if (o.slotOnlyConnected && !slot.connected) return undefined;
          if (slot.isWidget && !o.slotIncludeWidgets && !slot.connected) return undefined;
          const next = label(n, slot, isInput);
          const cur = slot.label || null;
          return next === cur ? undefined : next;
        });
      if (o.slotApplyTo !== "outputs") {
        const r = doSide(n.inputs, true);
        if (r.some((v) => v !== undefined)) result.inputs.set(n.id, r);
      }
      if (o.slotApplyTo !== "inputs") {
        const r = doSide(n.outputs, false);
        if (r.some((v) => v !== undefined)) result.outputs.set(n.id, r);
      }
    }
  }
  return result;
}

/**
 * Labels for a subgraph's own inputs or outputs (the connectors on its input /
 * output panel, mirrored on the subgraph node outside).
 *
 * slots: [{ name, label, type, connected, inner, node, source }]
 *   inner  name of the connector inside the subgraph this one is wired to
 *   node   title of that inside node
 *   source title of the node feeding this input on the parent canvas (inputs only)
 * Returns one entry per slot: a string, null (remove the label) or undefined (leave).
 * Uses the connector capitalization and find/replace rules; duplicates get numbered.
 */
export function computeSubgraphSlotLabels(slots, userOpts = {}, extra = {}) {
  const o = { ...RENAME_DEFAULTS, ...userOpts };
  if (o.subgraphSlotMode === "keep") return slots.map(() => undefined);
  if (extra.side && o.slotApplyTo !== "both" && o.slotApplyTo !== extra.side) return slots.map(() => undefined);
  const rules = parseRules(o.slotLabelRules);
  const next = slots.map((slot) => {
    if (o.slotOnlyConnected && !slot.connected) return undefined;
    if (o.subgraphSlotMode === "reset") return null;
    let s;
    if (o.subgraphSlotMode === "type") s = slot.type && slot.type !== "*" ? String(slot.type) : slot.name;
    else
      s = fillTemplate(o.subgraphSlotTemplate, {
        name: slot.name,
        label: slot.label || slot.name,
        type: slot.type && slot.type !== "*" ? slot.type : "",
        inner: slot.inner,
        node: slot.node,
        source: slot.source,
        subgraph: extra.subgraph,
      });
    s = applyRules(s ?? "", rules, String(slot.type ?? ""));
    s = applyCase(s, o.slotLabelCase);
    return s || null;
  });
  // Two connectors with the same label are hard to tell apart: number them.
  if (o.subgraphSlotMode !== "reset") {
    const groups = new Map();
    next.forEach((s, i) => {
      const shown = s === undefined ? slots[i].label || slots[i].name : s ?? slots[i].name;
      if (!groups.has(shown)) groups.set(shown, []);
      groups.get(shown).push(i);
    });
    for (const [shown, list] of groups) {
      const mine = list.filter((i) => next[i] !== undefined);
      if (list.length < 2 || !mine.length) continue;
      let n = 0;
      for (const i of list) {
        n++;
        if (next[i] !== undefined) next[i] = `${shown} ${n}`;
      }
    }
  }
  return next.map((s, i) => {
    if (s === undefined) return undefined;
    const want = s === slots[i].name ? null : s;
    return want === (slots[i].label || null) ? undefined : want;
  });
}
