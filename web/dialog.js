// ComfyUI Prettifier - options dialog with live preview.

import { OPTIONS, SECTIONS, PRESETS, ALL_DEFAULTS, readOptions, setOption } from "./settings.js";
import { activeGraph, cancelAnimation, changeTracker } from "./graph.js";
import { prettify, effectiveOptions, snapshotAll, restoreAll, toast, applyDisplay } from "./core.js";
import { snapshotLinkColors, restoreLinkColors } from "./display.js";
import { loadThemes, saveThemes, exportTheme, importTheme } from "./themes.js";

const STYLE_ID = "prettifier-dialog-style";
const CSS = `
.pf-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:flex-start;justify-content:flex-end;pointer-events:none}
.pf-dialog{pointer-events:auto;margin:60px 16px 16px;width:460px;max-width:calc(100vw - 32px);max-height:calc(100vh - 80px);display:flex;flex-direction:column;
  background:var(--comfy-menu-bg,#202020);color:var(--fg-color,#ddd);border:1px solid var(--border-color,#444);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.5);font:13px/1.4 system-ui,sans-serif}
.pf-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border-color,#444);cursor:move;user-select:none}
.pf-head h3{margin:0;font-size:15px;flex:1}
.pf-x{background:none;border:0;color:inherit;font-size:18px;cursor:pointer;opacity:.7}
.pf-x:hover{opacity:1}
.pf-bar{display:flex;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border-color,#444);flex-wrap:wrap}
.pf-tabs{display:flex;gap:4px;padding:8px 10px 0;flex-wrap:wrap}
.pf-tab{background:none;border:1px solid transparent;border-bottom:0;color:inherit;opacity:.7;padding:6px 10px;border-radius:6px 6px 0 0;cursor:pointer;font:inherit}
.pf-tab.on{opacity:1;background:var(--comfy-input-bg,#2a2a2a);border-color:var(--border-color,#444)}
.pf-body{overflow:auto;padding:10px 14px;flex:1;background:var(--comfy-input-bg,#2a2a2a);margin:0 10px;border:1px solid var(--border-color,#444);border-radius:0 6px 6px 6px}
.pf-row{display:grid;grid-template-columns:1fr 170px;gap:10px;align-items:center;padding:6px 0;border-bottom:1px dashed rgba(127,127,127,.15)}
.pf-row:last-child{border-bottom:0}
.pf-row label{cursor:help}
.pf-row select,.pf-row input[type=text],.pf-bar select{width:100%;background:var(--comfy-menu-bg,#202020);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 6px;font:inherit}
.pf-bar select{width:auto}
.pf-slider{display:flex;gap:6px;align-items:center}
.pf-slider input[type=range]{flex:1;min-width:0}
.pf-slider input[type=number]{width:56px;background:var(--comfy-menu-bg,#202020);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:3px 4px;font:inherit}
.pf-foot{display:flex;gap:8px;padding:12px 14px;justify-content:flex-end;flex-wrap:wrap}
.pf-btn{background:var(--comfy-input-bg,#2a2a2a);color:inherit;border:1px solid var(--border-color,#444);border-radius:6px;padding:6px 12px;cursor:pointer;font:inherit}
.pf-btn:hover{filter:brightness(1.2)}
.pf-btn.primary{background:#3f789e;border-color:#3f789e;color:#fff}
.pf-spacer{flex:1}
.pf-lint{list-style:none;margin:0;padding:0}
.pf-lint li{display:grid;grid-template-columns:70px 1fr;gap:8px;padding:7px 4px;border-bottom:1px dashed rgba(127,127,127,.15);cursor:pointer;border-radius:4px}
.pf-lint li:hover{background:rgba(127,127,127,.12)}
.pf-sev{font-size:11px;font-weight:600;text-transform:uppercase;border-radius:4px;padding:2px 6px;align-self:start;text-align:center}
.pf-sev.error{background:#8a221b;color:#fff}.pf-sev.warning{background:#857000;color:#fff}.pf-sev.info{background:#21608a;color:#fff}
.pf-lint b{display:block}.pf-muted{opacity:.7}
.pf-btn.sm{padding:3px 8px;font-size:12px}
.pf-themes input{background:var(--comfy-menu-bg,#202020);color:inherit;border:1px solid var(--border-color,#444);border-radius:5px;padding:3px 6px;font:inherit}
.pf-check{display:flex;gap:6px;align-items:center;cursor:pointer}
`;

let open = null;

export function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement("style");
  st.id = STYLE_ID;
  st.textContent = CSS;
  document.head.appendChild(st);
}

export function openDialog(app) {
  if (open) {
    open.focus();
    return;
  }
  ensureStyle();

  const values = effectiveOptions(app);
  const initial = readOptions(app); // global values, restored on Cancel
  // Keep previews out of the undo history; one entry is recorded when the dialog closes.
  const tracker = changeTracker(app);
  tracker?.beforeChange?.();
  // Previews also change how links are drawn; Cancel puts that back as well.
  const linkMode = app.canvas?.links_render_mode;
  const linkColors = snapshotLinkColors(app);
  let snapshot = null; // taken on first preview
  let live = true;
  let scope = values.scope;
  let section = SECTIONS[0];
  let previewTimer = 0;

  const el = (tag, attrs = {}, ...children) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  };

  const overlay = el("div", { class: "pf-overlay" });
  const dialog = el("div", { class: "pf-dialog", role: "dialog", "aria-label": "Prettifier" });
  overlay.append(dialog);

  // Header (draggable)
  const head = el("div", { class: "pf-head" }, el("h3", {}, "✨ Prettify Workflow"), el("button", { class: "pf-x", title: "Close", onclick: () => cancel() }, "×"));
  dialog.append(head);
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    const r = dialog.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    overlay.style.justifyContent = "flex-start";
    dialog.style.margin = "0";
    dialog.style.position = "fixed";
    dialog.style.left = Math.max(0, e.clientX - drag.dx) + "px";
    dialog.style.top = Math.max(0, e.clientY - drag.dy) + "px";
  });
  head.addEventListener("pointerup", () => (drag = null));

  // Top bar: preset, scope, live preview
  const applyValues = async (next) => {
    for (const o of OPTIONS) {
      if (next[o.key] !== undefined && values[o.key] !== next[o.key]) {
        values[o.key] = next[o.key];
        await setOption(app, o.key, next[o.key]);
      }
    }
    renderBody();
    schedulePreview();
  };
  let themes = loadThemes(app);
  const presetSel = el("select", { title: "Pick a preset or one of your saved themes, then press Load" });
  const fillPresets = (keep = presetSel.value) => {
    presetSel.replaceChildren(
      el("option", { value: "" }, "Preset / Theme…"),
      el("optgroup", { label: "Presets" }, ...Object.keys(PRESETS).map((p) => el("option", { value: "p:" + p }, p))),
      ...(Object.keys(themes).length ? [el("optgroup", { label: "My Themes" }, ...Object.keys(themes).map((t) => el("option", { value: "t:" + t }, t)))] : [])
    );
    // Keep the choice shown; fall back to the placeholder when it no longer exists.
    presetSel.value = keep;
    if (presetSel.value !== keep) presetSel.value = "";
  };
  fillPresets("");
  // Picking a preset or theme only selects it. Load applies it, so a theme can be
  // picked and saved over with the options as they are now.
  const applyPicked = async () => {
    const v = presetSel.value;
    const src = v.startsWith("p:") ? PRESETS[v.slice(2)] : v.startsWith("t:") ? themes[v.slice(2)] : null;
    if (!src) return presetSel.focus();
    await applyValues({ ...ALL_DEFAULTS, ...src });
  };
  const applyPickedBtn = el("button", { class: "pf-btn sm", title: "Load the selected preset or theme", onclick: applyPicked }, "Load");
  presetSel.addEventListener("change", () => {
    const v = presetSel.value;
    // A saved theme's name goes into the name box, ready for Save or Delete.
    if (v.startsWith("t:")) themeName.value = v.slice(2);
  });

  // Theme tools: save current options under a name, export, import, delete.
  const themeName = el("input", { type: "text", placeholder: "Theme Name", style: "width:110px" });
  // The name typed in the box, or else the theme picked in the list.
  const pickedTheme = () => themeName.value.trim() || (presetSel.value.startsWith("t:") ? presetSel.value.slice(2) : "");
  const diffFromDefaults = () => {
    const d = {};
    for (const o of OPTIONS) if (values[o.key] !== ALL_DEFAULTS[o.key]) d[o.key] = values[o.key];
    return d;
  };
  const themeBar = el(
    "div",
    { class: "pf-bar pf-themes" },
    themeName,
    el("button", { class: "pf-btn sm", title: "Save the current options as a theme with this name. Saving under an existing name updates that theme.", onclick: async () => {
      const name = pickedTheme();
      if (!name) return themeName.focus();
      const updated = name in themes;
      themes = { ...themes, [name]: diffFromDefaults() };
      await saveThemes(app, themes);
      themeName.value = name;
      fillPresets("t:" + name);
      toast(app, "success", updated ? "Theme Updated" : "Theme Saved", name);
    } }, "Save"),
    el("button", { class: "pf-btn sm", title: "Delete the theme with this name", onclick: async () => {
      const name = pickedTheme();
      if (!themes[name]) return themeName.focus();
      themes = { ...themes };
      delete themes[name];
      await saveThemes(app, themes);
      themeName.value = "";
      fillPresets();
      toast(app, "info", "Theme Deleted", name);
    } }, "Delete"),
    el("span", { class: "pf-spacer" }),
    el("button", { class: "pf-btn sm", title: "Download the current options as a theme file", onclick: () => exportTheme(pickedTheme() || "prettifier-theme", diffFromDefaults()) }, "Export"),
    el("button", { class: "pf-btn sm", title: "Load a theme file", onclick: async () => {
      const t = await importTheme(ALL_DEFAULTS);
      if (!t) return toast(app, "error", "Prettifier", "That file is not a Prettifier theme.");
      themeName.value = t.name;
      themes = { ...themes, [t.name]: t.options };
      await saveThemes(app, themes);
      fillPresets("t:" + t.name);
      await applyValues({ ...ALL_DEFAULTS, ...t.options });
    } }, "Import")
  );
  const scopeSel = el("select", { title: "What to rearrange" }, el("option", { value: "auto" }, "Auto Scope"), el("option", { value: "all" }, "Whole Workflow"), el("option", { value: "selection" }, "Selection Only"));
  scopeSel.value = scope;
  scopeSel.addEventListener("change", () => {
    scope = scopeSel.value;
    schedulePreview();
  });
  const liveBox = el("input", { type: "checkbox" });
  liveBox.checked = live;
  liveBox.addEventListener("change", () => {
    live = liveBox.checked;
    if (live) schedulePreview();
    else revert();
  });
  dialog.append(el("div", { class: "pf-bar" }, presetSel, applyPickedBtn, scopeSel, el("span", { class: "pf-spacer" }), el("label", { class: "pf-check", title: "Re-arrange the canvas as you change options" }, liveBox, "Live Preview")), themeBar);

  // Tabs + body
  const tabs = el("div", { class: "pf-tabs" });
  const body = el("div", { class: "pf-body" });
  dialog.append(tabs, body);
  const renderTabs = () => {
    tabs.replaceChildren(
      ...SECTIONS.map((s) =>
        el("button", { class: "pf-tab" + (s === section ? " on" : ""), onclick: () => ((section = s), renderTabs(), renderBody()) }, s)
      )
    );
  };

  const commit = async (key, v) => {
    values[key] = v;
    await setOption(app, key, v);
    schedulePreview();
  };

  const control = (o) => {
    const v = values[o.key];
    if (o.type === "boolean") {
      const c = el("input", { type: "checkbox" });
      c.checked = !!v;
      c.addEventListener("change", () => commit(o.key, c.checked));
      return c;
    }
    if (o.type === "combo") {
      const s = el("select", {}, ...o.options.map((x) => el("option", { value: x.value }, x.text)));
      s.value = v;
      s.addEventListener("change", () => commit(o.key, s.value));
      return s;
    }
    if (o.type === "slider") {
      const r = el("input", { type: "range", min: o.attrs.min, max: o.attrs.max, step: o.attrs.step });
      const n = el("input", { type: "number", min: o.attrs.min, max: o.attrs.max, step: o.attrs.step });
      r.value = n.value = v;
      r.addEventListener("input", () => {
        n.value = r.value;
        commit(o.key, Number(r.value));
      });
      n.addEventListener("change", () => {
        r.value = n.value;
        commit(o.key, Number(n.value));
      });
      return el("div", { class: "pf-slider" }, r, n);
    }
    const t = el("input", { type: "text", value: v ?? "" });
    t.addEventListener("change", () => commit(o.key, t.value));
    return t;
  };

  const renderBody = () => {
    body.replaceChildren(
      ...OPTIONS.filter((o) => o.section === section && o.key !== "scope").map((o) =>
        el("div", { class: "pf-row" }, el("label", { title: o.tooltip ?? "" }, o.name), control(o))
      )
    );
  };

  // Footer
  const resetBtn = el("button", { class: "pf-btn", title: "Reset every option to its default" }, "Reset Defaults");
  resetBtn.addEventListener("click", () => {
    applyValues({ ...ALL_DEFAULTS });
  });
  const cancelBtn = el("button", { class: "pf-btn" }, "Cancel");
  cancelBtn.addEventListener("click", () => cancel());
  const applyBtn = el("button", { class: "pf-btn primary" }, "Apply");
  applyBtn.addEventListener("click", () => apply());
  dialog.append(el("div", { class: "pf-foot" }, resetBtn, el("span", { class: "pf-spacer" }), cancelBtn, applyBtn));

  // Behaviour
  function revert() {
    clearTimeout(previewTimer);
    cancelAnimation();
    if (snapshot) {
      restoreAll(snapshot);
      app.canvas?.setDirty?.(true, true);
    }
  }
  function schedulePreview() {
    if (!live) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const graph = activeGraph(app);
      if (!snapshot || snapshot.graph !== graph) snapshot = snapshotAll(app, graph);
      else revert();
      prettify(app, { scope, overrides: { ...values, fitView: false }, animate: false, recordUndo: false, quiet: true });
    }, 120);
  }
  function apply() {
    revert();
    prettify(app, { scope, overrides: values, animate: !snapshot && values.animate });
    snapshot = null;
    close();
  }
  function cancel() {
    revert();
    snapshot = null;
    // Cancel also discards option changes made in the dialog.
    const now = readOptions(app);
    const pending = OPTIONS.filter((o) => now[o.key] !== initial[o.key]).map((o) => setOption(app, o.key, initial[o.key]));
    if (app.canvas && linkMode !== undefined && app.canvas.links_render_mode !== linkMode) {
      try {
        app.extensionManager?.setting?.set?.("Comfy.LinkRenderMode", linkMode);
      } catch {}
      app.canvas.links_render_mode = linkMode;
    }
    // Once the options are back, redo the display with them, on the colors the dialog started from.
    Promise.allSettled(pending).then(() => {
      restoreLinkColors(app, linkColors);
      applyDisplay(app);
    });
    close();
  }
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      cancel();
    }
  };
  function close() {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    open = null;
    try {
      tracker?.afterChange?.();
    } catch {}
  }

  document.addEventListener("keydown", onKey, true);
  renderTabs();
  renderBody();
  document.body.append(overlay);
  open = { focus: () => dialog.querySelector("select,input,button")?.focus() };
  schedulePreview();
}
