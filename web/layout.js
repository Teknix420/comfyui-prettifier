// ComfyUI Prettifier - layout engine.
//
// This module is pure: it knows nothing about ComfyUI or LiteGraph, so it can be
// unit-tested with plain Node. The adapter (graph.js) converts a LiteGraph graph
// into the small "model" described below, and applies the result back.
//
// Model:
//   {
//     titleH: number,                       // node title bar height
//     nodes: [{
//       id, type, category, isOutput, isNote, pinned, collapsed,
//       x, y, w, h,                         // current body position/size (pos/size in LiteGraph)
//       fitW, fitH,                         // minimum size that still fits the content
//       hasLargeContent,                    // images, text boxes, etc.
//       inSlots: [offsetY], outSlots: [offsetY], // slot Y offsets measured from the TOP OF THE TITLE BAR
//       groups: [groupIndex]                // existing groups containing this node (innermost first)
//     }],
//     edges: [{ from, to, fromSlot, toSlot }],
//     groups: [{ index, title, color, fontSize, x, y, w, h }]  // existing groups fully in scope
//   }
//
// Result:
//   {
//     nodes: [{ id, x, y, w, h, stage, moved }],
//     groupUpdates: [{ index, x, y, w, h, color? }],
//     groupRemovals: [index],
//     newGroups: [{ title, color, fontSize, x, y, w, h }],
//   }

export const DEFAULTS = {
  direction: "LR", // LR | TB
  layering: "balanced", // balanced | early | late
  verticalAlign: "links", // links | top | center
  columnAlign: "left", // left | center | right
  orderingPasses: 8,
  alignIterations: 12,
  preserveOrder: true,

  hGap: 80,
  vGap: 40,
  componentGap: 160,
  snapToGrid: true,
  gridSize: 10,
  origin: "keep", // keep | zero

  widthMode: "column", // keep | fit | column | fixed
  fixedWidth: 320,
  minWidth: 200,
  maxWidth: 600,
  heightMode: "fit", // keep | fit
  shrinkLarge: false,

  groupBy: "auto", // auto | existing | stage | category | component | none
  minGroupSize: 2,
  groupPadding: 20,
  groupFontSize: 24,
  groupColor: "auto", // auto | stage | single | none
  groupSingleColor: "#3f789e",
  categoryDepth: 1,

  isolatedPlacement: "bottom", // bottom | right | keep
  notePlacement: "top", // top | bottom | keep
  componentPacking: "vertical", // vertical | horizontal
  respectPinned: true,
};

// ---------------------------------------------------------------------------
// Stages: a coarse "what part of the pipeline is this" classification.

export const STAGES = ["Models", "Inputs", "Prompt", "Sampling", "Latent", "Image", "Mask", "Output", "Utilities", "Other"];

export const STAGE_GROUP_COLORS = {
  Models: "#3f789e",
  Inputs: "#8AA",
  Prompt: "#8A8",
  Sampling: "#a1309b",
  Latent: "#b58b2a",
  Image: "#88A",
  Mask: "#b06634",
  Output: "#A88",
  Utilities: "#444",
  Other: "#666",
};

// Matches LiteGraph's built-in node color pairs.
export const STAGE_NODE_COLORS = {
  Models: { color: "#2a363b", bgcolor: "#3f5159" },
  Inputs: { color: "#233", bgcolor: "#355" },
  Prompt: { color: "#232", bgcolor: "#353" },
  Sampling: { color: "#323", bgcolor: "#535" },
  Latent: { color: "#432", bgcolor: "#653" },
  Image: { color: "#223", bgcolor: "#335" },
  Mask: { color: "#332922", bgcolor: "#593930" },
  Output: { color: "#322", bgcolor: "#533" },
  Utilities: { color: "#222", bgcolor: "#000" },
  Other: null,
};

export function stageOf(n) {
  const t = String(n.type || "").toLowerCase();
  const c = String(n.category || "").toLowerCase();
  if (n.isNote) return "Utilities";
  if (n.isOutput || /save|preview/.test(t)) return "Output";
  if (/vaedecode/.test(t)) return "Output";
  if (c.startsWith("loaders") || /loader/.test(t) || c.includes("model_patches") || c.startsWith("advanced/model")) return "Models";
  if (c.startsWith("conditioning") || /textencode|conditioning|^clip/.test(t)) return "Prompt";
  if (c.startsWith("sampling") || /sampler|sigmas|scheduler|guider|noise/.test(t)) return "Sampling";
  if (/emptylatent|loadimage/.test(t)) return "Inputs";
  if (c.startsWith("latent") || /latent|vaeencode/.test(t)) return "Latent";
  if (c.startsWith("mask") || /mask/.test(t)) return "Mask";
  if (c.startsWith("image") || /image|upscale/.test(t)) return "Image";
  if (c.startsWith("utils") || /primitive|reroute/.test(t)) return "Utilities";
  return "Other";
}

// ---------------------------------------------------------------------------
// Small helpers

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const titleCase = (s) => String(s).replace(/[_-]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (a) => {
    while (parent.get(a) !== a) {
      parent.set(a, parent.get(parent.get(a)));
      a = parent.get(a);
    }
    return a;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { find, union };
}

function components(ids, edges) {
  const uf = unionFind(ids);
  for (const e of edges) uf.union(e.from, e.to);
  const map = new Map();
  for (const id of ids) {
    const r = uf.find(id);
    if (!map.has(r)) map.set(r, []);
    map.get(r).push(id);
  }
  return [...map.values()];
}

// Pool-adjacent-violators: place boxes in a fixed order, each at least
// (prev.h + gap) below the previous, as close as possible (least squares) to
// its desired y.
function placeOrdered(desired, heights, gap) {
  const n = desired.length;
  const offs = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    offs[i] = acc;
    acc += heights[i] + gap;
  }
  const blocks = []; // {sum, cnt, start}
  for (let i = 0; i < n; i++) {
    blocks.push({ sum: desired[i] - offs[i], cnt: 1, start: i });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.cnt <= b.sum / b.cnt) break;
      a.sum += b.sum;
      a.cnt += b.cnt;
      blocks.pop();
    }
  }
  const out = new Array(n);
  for (let k = 0; k < blocks.length; k++) {
    const b = blocks[k];
    const end = k + 1 < blocks.length ? blocks[k + 1].start : n;
    const z = b.sum / b.cnt;
    for (let i = b.start; i < end; i++) out[i] = z + offs[i];
  }
  return out;
}

// Tarjan strongly connected components.
function tarjan(ids, adj) {
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], out = [];
  const strong = (v) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v) || []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
    }
    if (low.get(v) === idx.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const v of ids) if (!idx.has(v)) strong(v);
  return out;
}

// ---------------------------------------------------------------------------
// Layered (Sugiyama-style) layout of a set of boxes.
//
// items: [{id, w, h, origX, origY, flex}]  (box = whole node incl. title bar)
// edges: [{from, to, fromSlot, toSlot, fromOff, toOff}] offsets from box top, or null = center
// Returns { pos: Map id -> {x, y}, width: Map id -> w, w, h } in real (untransposed) coordinates.

export function layered(items, edges, o, opts = {}) {
  const TB = o.direction === "TB";
  const its = items.map((it) =>
    TB ? { ...it, w: it.h, h: it.w, origX: it.origY, origY: it.origX, flex: false } : { ...it }
  );
  const ids = new Set(its.map((i) => i.id));
  const eds = edges
    .filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to)
    .map((e) => (TB ? { ...e, fromOff: null, toOff: null } : e));

  const isolatedPlacement = opts.isolatedPlacement ?? (o.isolatedPlacement === "keep" ? "bottom" : o.isolatedPlacement);
  const byId = new Map(its.map((i) => [i.id, i]));
  const comps = components([...ids], eds);
  const connected = [];
  const isolated = [];
  const deg = new Map();
  for (const e of eds) {
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }
  for (const c of comps) {
    if (c.length === 1 && !deg.get(c[0])) isolated.push(byId.get(c[0]));
    else connected.push(c);
  }

  const pos = new Map();
  const width = new Map();
  const origKey = (list) => {
    let mx = Infinity, my = Infinity;
    for (const id of list) {
      const it = byId.get(id);
      mx = Math.min(mx, it.origX);
      my = Math.min(my, it.origY);
    }
    return o.componentPacking === "horizontal" ? [mx, my] : [my, mx];
  };
  connected.sort((a, b) => {
    const ka = origKey(a), kb = origKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1];
  });

  let cursor = 0, mainW = 0, mainH = 0;
  for (const c of connected) {
    const set = new Set(c);
    const r = layoutComponent(
      c.map((id) => byId.get(id)),
      eds.filter((e) => set.has(e.from)),
      o
    );
    const dx = o.componentPacking === "horizontal" ? cursor : 0;
    const dy = o.componentPacking === "horizontal" ? 0 : cursor;
    for (const [id, p] of r.pos) pos.set(id, { x: p.x + dx, y: p.y + dy });
    for (const [id, w] of r.width) width.set(id, w);
    if (o.componentPacking === "horizontal") {
      cursor += r.w + o.componentGap;
      mainW = cursor - o.componentGap;
      mainH = Math.max(mainH, r.h);
    } else {
      cursor += r.h + o.componentGap;
      mainH = cursor - o.componentGap;
      mainW = Math.max(mainW, r.w);
    }
  }

  if (isolated.length) {
    isolated.sort((a, b) => a.origY - b.origY || a.origX - b.origX);
    const hasMain = connected.length > 0;
    if (isolatedPlacement === "column") {
      // one column under the main area (used inside groups)
      let y = hasMain ? mainH + o.vGap : 0;
      for (const it of isolated) {
        pos.set(it.id, { x: 0, y });
        width.set(it.id, it.w);
        y += it.h + o.vGap;
      }
    } else if (isolatedPlacement === "right" && !TB) {
      // columns to the right of the main area
      const limit = Math.max(mainH, 800);
      let x = hasMain ? mainW + o.componentGap : 0, y = 0, colW = 0;
      for (const it of isolated) {
        if (y > 0 && y + it.h > limit) {
          x += colW + o.hGap;
          y = 0;
          colW = 0;
        }
        pos.set(it.id, { x, y });
        width.set(it.id, it.w);
        y += it.h + o.vGap;
        colW = Math.max(colW, it.w);
      }
    } else {
      // rows below the main area
      const limit = Math.max(mainW, 1200);
      let x = 0, y = hasMain ? mainH + o.componentGap : 0, rowH = 0;
      for (const it of isolated) {
        if (x > 0 && x + it.w > limit) {
          y += rowH + o.vGap;
          x = 0;
          rowH = 0;
        }
        pos.set(it.id, { x, y });
        width.set(it.id, it.w);
        x += it.w + o.hGap;
        rowH = Math.max(rowH, it.h);
      }
    }
  }

  // bounding box + transpose back
  let W = 0, H = 0;
  const outPos = new Map();
  const outW = new Map();
  for (const it of its) {
    const p = pos.get(it.id);
    const w = width.get(it.id) ?? it.w;
    if (TB) {
      outPos.set(it.id, { x: p.y, y: p.x });
      outW.set(it.id, it.h); // real width is transposed height
      W = Math.max(W, p.y + it.h);
      H = Math.max(H, p.x + w);
    } else {
      outPos.set(it.id, p);
      outW.set(it.id, w);
      W = Math.max(W, p.x + w);
      H = Math.max(H, p.y + it.h);
    }
  }
  return { pos: outPos, width: outW, w: W, h: H };
}

function layoutComponent(items, edges, o) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const sorted = [...items].sort((a, b) => a.origX - b.origX || a.origY - b.origY);
  const out = new Map(items.map((i) => [i.id, []]));
  const inn = new Map(items.map((i) => [i.id, []]));
  for (const e of edges) {
    out.get(e.from).push(e);
    inn.get(e.to).push(e);
  }

  // 1. Break cycles (DFS, reverse back edges).
  const state = new Map();
  const dag = [];
  const visit = (v) => {
    state.set(v, 1);
    for (const e of out.get(v)) {
      const s = state.get(e.to);
      if (s === 1) dag.push({ from: e.to, to: e.from, fromSlot: e.toSlot, toSlot: e.fromSlot });
      else {
        dag.push(e);
        if (!s) visit(e.to);
      }
    }
    state.set(v, 2);
  };
  for (const it of sorted) if (!inn.get(it.id).length && !state.has(it.id)) visit(it.id);
  for (const it of sorted) if (!state.has(it.id)) visit(it.id);

  const dOut = new Map(items.map((i) => [i.id, []]));
  const dIn = new Map(items.map((i) => [i.id, []]));
  for (const e of dag) {
    dOut.get(e.from).push(e.to);
    dIn.get(e.to).push(e.from);
  }

  // 2. Topological order (Kahn, stable by original position).
  const indeg = new Map(items.map((i) => [i.id, dIn.get(i.id).length]));
  const topo = [];
  const queue = sorted.filter((i) => !indeg.get(i.id)).map((i) => i.id);
  while (queue.length) {
    const v = queue.shift();
    topo.push(v);
    for (const w of dOut.get(v)) {
      indeg.set(w, indeg.get(w) - 1);
      if (!indeg.get(w)) queue.push(w);
    }
  }

  // 3. Layer assignment.
  const L = new Map();
  for (const v of topo) {
    let l = 0;
    for (const u of dIn.get(v)) l = Math.max(l, L.get(u) + 1);
    L.set(v, l);
  }
  if (o.layering === "late") {
    const R = new Map();
    let maxR = 0;
    for (let i = topo.length - 1; i >= 0; i--) {
      const v = topo[i];
      let r = 0;
      for (const w of dOut.get(v)) r = Math.max(r, R.get(w) + 1);
      R.set(v, r);
      maxR = Math.max(maxR, r);
    }
    for (const v of topo) L.set(v, maxR - R.get(v));
  } else if (o.layering !== "early") {
    for (let i = topo.length - 1; i >= 0; i--) {
      const v = topo[i];
      if (!dIn.get(v).length && dOut.get(v).length) {
        let m = Infinity;
        for (const w of dOut.get(v)) m = Math.min(m, L.get(w));
        L.set(v, m - 1);
      }
    }
  }
  const used = [...new Set(L.values())].sort((a, b) => a - b);
  const remap = new Map(used.map((l, i) => [l, i]));
  const layers = used.map(() => []);
  for (const v of topo) {
    const l = remap.get(L.get(v));
    L.set(v, l);
    layers[l].push(v);
  }
  const topoIdx = new Map(topo.map((v, i) => [v, i]));
  for (const layer of layers) {
    layer.sort((a, b) =>
      o.preserveOrder ? byId.get(a).origY - byId.get(b).origY || topoIdx.get(a) - topoIdx.get(b) : topoIdx.get(a) - topoIdx.get(b)
    );
  }

  // 4. Crossing reduction (barycenter sweeps across all layers).
  const adj = new Map(items.map((i) => [i.id, []]));
  for (const e of edges) {
    adj.get(e.from).push(e);
    adj.get(e.to).push(e);
  }
  const rank = new Map();
  const refreshRanks = () => layers.forEach((layer) => layer.forEach((v, i) => rank.set(v, i)));
  refreshRanks();
  const norm = (v) => (rank.get(v) + 0.5) / layers[L.get(v)].length;

  const countCrossings = () => {
    if (dag.length > 400) return 0;
    const segs = dag.map((e) => [L.get(e.from), norm(e.from), L.get(e.to), norm(e.to), e.from, e.to]);
    let c = 0;
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i];
      for (let j = i + 1; j < segs.length; j++) {
        const b = segs[j];
        const lo = Math.max(a[0], b[0]), hi = Math.min(a[2], b[2]);
        if (hi <= lo) continue;
        if (a[4] === b[4] || a[5] === b[5]) continue;
        const at = (s, l) => s[1] + ((s[3] - s[1]) * (l - s[0])) / (s[2] - s[0]);
        const d1 = at(a, lo) - at(b, lo), d2 = at(a, hi) - at(b, hi);
        if (d1 * d2 < -1e-9) c++;
      }
    }
    return c;
  };

  const sweep = (dir) => {
    const n = layers.length;
    for (let k = 0; k < n; k++) {
      const i = dir > 0 ? k : n - 1 - k;
      const layer = layers[i];
      const keys = new Map();
      for (const v of layer) {
        let s = 0, w = 0;
        for (const e of adj.get(v)) {
          const u = e.from === v ? e.to : e.from;
          const lu = L.get(u);
          if (dir > 0 ? lu < i : lu > i) {
            const wt = 1 / Math.abs(lu - i);
            const slot = (e.to === v ? e.fromSlot : e.toSlot) || 0;
            s += wt * (norm(u) + slot * 1e-3);
            w += wt;
          }
        }
        keys.set(v, w ? s / w : norm(v));
      }
      layer.sort((a, b) => keys.get(a) - keys.get(b));
      layer.forEach((v, idx) => rank.set(v, idx));
    }
  };

  if (o.orderingPasses > 0 && layers.length > 1) {
    let best = layers.map((l) => [...l]);
    let bestC = countCrossings();
    for (let p = 0; p < o.orderingPasses && bestC > 0; p++) {
      sweep(1);
      sweep(-1);
      const c = countCrossings();
      if (c < bestC || dag.length > 400) {
        bestC = c;
        best = layers.map((l) => [...l]);
      }
    }
    best.forEach((l, i) => (layers[i] = l));
    refreshRanks();
  }

  // 5. Column widths (flex nodes share their column's width).
  const width = new Map(items.map((i) => [i.id, i.w]));
  const colW = layers.map((layer) => {
    let flexMax = 0;
    for (const v of layer) if (byId.get(v).flex) flexMax = Math.max(flexMax, byId.get(v).w);
    for (const v of layer) if (byId.get(v).flex) width.set(v, flexMax);
    return Math.max(...layer.map((v) => width.get(v)));
  });
  const colX = [];
  let acc = 0;
  for (let i = 0; i < layers.length; i++) {
    colX.push(acc);
    acc += colW[i] + o.hGap;
  }
  const xOf = (v) => {
    const i = L.get(v);
    const slack = colW[i] - width.get(v);
    const f = o.columnAlign === "center" ? 0.5 : o.columnAlign === "right" ? 1 : 0;
    return colX[i] + slack * f;
  };

  // 6. Vertical placement.
  const y = new Map();
  for (const layer of layers) {
    let cy = 0;
    for (const v of layer) {
      y.set(v, cy);
      cy += byId.get(v).h + o.vGap;
    }
  }
  const layerH = (layer) => layer.reduce((s, v) => s + byId.get(v).h, 0) + o.vGap * (layer.length - 1);
  if (o.verticalAlign === "center") {
    const maxH = Math.max(...layers.map(layerH));
    for (const layer of layers) {
      const off = (maxH - layerH(layer)) / 2;
      for (const v of layer) y.set(v, y.get(v) + off);
    }
  } else if (o.verticalAlign === "links") {
    const offOf = (v, off) => (off == null ? byId.get(v).h / 2 : off);
    for (let r = 0; r < o.alignIterations; r++) {
      const n = layers.length;
      for (let k = 0; k < n; k++) {
        const i = r % 2 === 0 ? k : n - 1 - k;
        const layer = layers[i];
        const desired = layer.map((v) => {
          let s = 0, w = 0;
          for (const e of adj.get(v)) {
            const u = e.from === v ? e.to : e.from;
            const span = Math.abs(L.get(u) - i);
            if (!span) continue;
            const wt = 1 / span;
            const target =
              e.to === v
                ? y.get(u) + offOf(u, e.fromOff) - offOf(v, e.toOff)
                : y.get(u) + offOf(u, e.toOff) - offOf(v, e.fromOff);
            s += wt * target;
            w += wt;
          }
          return w ? s / w : y.get(v);
        });
        const ys = placeOrdered(desired, layer.map((v) => byId.get(v).h), o.vGap);
        layer.forEach((v, idx) => y.set(v, ys[idx]));
      }
    }
  }
  let minY = Infinity;
  for (const v of y.keys()) minY = Math.min(minY, y.get(v));

  const pos = new Map();
  let W = 0, H = 0;
  for (const it of items) {
    const p = { x: xOf(it.id), y: y.get(it.id) - minY };
    pos.set(it.id, p);
    W = Math.max(W, p.x + width.get(it.id));
    H = Math.max(H, p.y + it.h);
  }
  return { pos, width, w: W, h: H };
}

// ---------------------------------------------------------------------------
// Sizing

function sizeNode(n, o) {
  if (n.collapsed) return { w: n.w, h: n.h, flex: false };
  const protect = n.hasLargeContent && !o.shrinkLarge;
  let w = n.w, h = n.h, flex = false;
  const fitW = n.fitW || n.w;
  const fitH = n.fitH || n.h;
  if (o.widthMode === "fit") w = clamp(fitW, o.minWidth, Math.max(o.minWidth, o.maxWidth));
  else if (o.widthMode === "fixed") w = Math.max(o.fixedWidth, Math.min(fitW, o.maxWidth));
  else if (o.widthMode === "column") {
    w = clamp(fitW, o.minWidth, Math.max(o.minWidth, o.maxWidth));
    flex = true;
  }
  if (protect) w = Math.max(w, n.w);
  if (o.heightMode === "fit") h = protect ? Math.max(n.h, fitH) : fitH;
  h = Math.max(h, fitH);
  return { w, h, flex };
}

// ---------------------------------------------------------------------------
// Clustering (groups)

function clusterKeys(nodes, edges, model, o) {
  const mode = o.groupBy === "auto" ? (model.groups?.length ? "existing" : "stage") : o.groupBy;
  const key = new Map();
  const titles = new Map();
  const colors = new Map();
  if (mode === "none") return { mode, key, titles, colors };

  if (mode === "existing") {
    const gById = new Map((model.groups || []).map((g) => [g.index, g]));
    for (const n of nodes) {
      const g = (n.groups || []).find((gi) => gById.has(gi));
      if (g == null) continue;
      key.set(n.id, "g" + g);
      titles.set("g" + g, gById.get(g).title);
      colors.set("g" + g, gById.get(g).color);
    }
    return { mode, key, titles, colors };
  }

  const eligible = nodes.filter((n) => !n.isNote);
  if (mode === "stage") {
    for (const n of eligible) {
      const s = stageOf(n);
      key.set(n.id, "s:" + s);
      titles.set("s:" + s, s);
    }
  } else if (mode === "category") {
    for (const n of eligible) {
      const parts = String(n.category || "").split("/").filter(Boolean).slice(0, Math.max(1, o.categoryDepth));
      const k = "c:" + (parts.join("/") || "uncategorized");
      key.set(n.id, k);
      titles.set(k, parts.length ? parts.map(titleCase).join(" › ") : "Uncategorized");
    }
  } else if (mode === "component") {
    const set = new Set(eligible.map((n) => n.id));
    const comps = components([...set], edges.filter((e) => set.has(e.from) && set.has(e.to)))
      .filter((c) => c.length > 1)
      .map((c) => ({ c, y: Math.min(...c.map((id) => nodes.find((n) => n.id === id).y)) }))
      .sort((a, b) => a.y - b.y);
    comps.forEach(({ c }, i) => {
      for (const id of c) key.set(id, "k:" + i);
      titles.set("k:" + i, comps.length > 1 ? `Section ${i + 1}` : "Workflow");
    });
  }

  // Split clusters that would create cycles between groups (non-convex clusters),
  // otherwise the group layout would need backwards links.
  const ids = nodes.map((n) => n.id);
  const globalLayer = simpleLayers(ids, edges);
  let serial = 0;
  for (let iter = 0; iter < 30; iter++) {
    const cOf = (id) => key.get(id) ?? "n:" + id;
    const sAdj = new Map();
    const sIds = new Set(ids.map(cOf));
    for (const s of sIds) sAdj.set(s, new Set());
    for (const e of edges) {
      const a = cOf(e.from), b = cOf(e.to);
      if (a !== b) sAdj.get(a).add(b);
    }
    const bad = tarjan([...sIds], new Map([...sAdj].map(([k, v]) => [k, [...v]]))).filter((c) => c.length > 1);
    if (!bad.length) break;
    for (const scc of bad) {
      const members = (k) => ids.filter((id) => key.get(id) === k);
      const candidates = scc.filter((k) => !k.startsWith("n:")).sort((a, b) => members(b).length - members(a).length);
      if (!candidates.length) continue;
      const k = candidates[0];
      const mem = members(k);
      const memSet = new Set(mem);
      const parts = components(mem, edges.filter((e) => memSet.has(e.from) && memSet.has(e.to)));
      let pieces;
      if (parts.length > 1) pieces = parts;
      else {
        const ls = mem.map((id) => globalLayer.get(id)).sort((a, b) => a - b);
        const med = ls[Math.floor((ls.length - 1) / 2)];
        const lo = mem.filter((id) => globalLayer.get(id) <= med);
        const hi = mem.filter((id) => globalLayer.get(id) > med);
        pieces = hi.length && lo.length ? [lo, hi] : mem.map((id) => [id]);
      }
      const title = titles.get(k);
      for (const piece of pieces) {
        const nk = k.split("#")[0] + "#" + ++serial;
        titles.set(nk, title);
        for (const id of piece) key.set(id, nk);
      }
    }
  }
  return { mode, key, titles, colors };
}

function simpleLayers(ids, edges) {
  // ASAP layering on a cycle-broken copy, used only to split clusters.
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of edges) if (out.has(e.from) && out.has(e.to)) out.get(e.from).push(e.to);
  const state = new Map(), order = [];
  const dagOut = new Map(ids.map((id) => [id, []]));
  const visit = (v) => {
    state.set(v, 1);
    for (const w of out.get(v)) {
      if (state.get(w) === 1) continue;
      dagOut.get(v).push(w);
      if (!state.has(w)) visit(w);
    }
    state.set(v, 2);
    order.push(v);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  order.reverse();
  const L = new Map(ids.map((id) => [id, 0]));
  for (const v of order) for (const w of dagOut.get(v)) L.set(w, Math.max(L.get(w), L.get(v) + 1));
  return L;
}

// ---------------------------------------------------------------------------
// Main entry

export function computeLayout(model, userOpts = {}) {
  const o = { ...DEFAULTS, ...userOpts };
  const titleH = model.titleH ?? 30;
  const groupTitleH = Math.round(o.groupFontSize * 1.4);
  const nodes = model.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = model.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to);

  // 1. Pinned nodes never move.
  const fixed = new Set(nodes.filter((n) => o.respectPinned && n.pinned).map((n) => n.id));
  let live = nodes.filter((n) => !fixed.has(n.id));
  let liveEdges = edges.filter((e) => !fixed.has(e.from) && !fixed.has(e.to));

  // 2. Clusters.
  const cl = clusterKeys(live, liveEdges, model, o);
  const minSize = cl.mode === "existing" ? 1 : Math.max(1, o.minGroupSize);
  const counts = new Map();
  for (const k of cl.key.values()) counts.set(k, (counts.get(k) || 0) + 1);
  for (const [id, k] of [...cl.key]) if (counts.get(k) < minSize) cl.key.delete(id);

  // 3. Loose notes / isolated nodes.
  const degree = new Map();
  for (const e of liveEdges) {
    degree.set(e.from, (degree.get(e.from) || 0) + 1);
    degree.set(e.to, (degree.get(e.to) || 0) + 1);
  }
  const noteBand = [];
  for (const n of live) {
    if (cl.key.has(n.id) || degree.get(n.id)) continue;
    if (n.isNote) {
      if (o.notePlacement === "keep") fixed.add(n.id);
      else noteBand.push(n);
    } else if (o.isolatedPlacement === "keep") fixed.add(n.id);
  }
  const bandSet = new Set(noteBand.map((n) => n.id));
  live = live.filter((n) => !fixed.has(n.id));
  liveEdges = liveEdges.filter((e) => !fixed.has(e.from) && !fixed.has(e.to));
  const layoutNodes = live.filter((n) => !bandSet.has(n.id));

  // 4. Sizes & items.
  const size = new Map();
  for (const n of live) size.set(n.id, sizeNode(n, o));
  if (o.direction === "TB") for (const s of size.values()) s.flex = false;
  const item = (n) => ({
    id: n.id,
    w: size.get(n.id).w,
    h: size.get(n.id).h + titleH,
    origX: n.x,
    origY: n.y - titleH,
    flex: size.get(n.id).flex,
  });
  const slotOff = (n, isInput, slot) => {
    const arr = isInput ? n.inSlots : n.outSlots;
    return arr && arr[slot] != null ? arr[slot] : null;
  };
  const withOffsets = (e) => ({
    ...e,
    fromOff: slotOff(byId.get(e.from), false, e.fromSlot),
    toOff: slotOff(byId.get(e.to), true, e.toSlot),
  });

  // 4b. A flat layout of everything (ignoring groups) gives every node a sensible
  // relative order; the group layouts below use it as their starting order.
  const hint = new Map();
  if (cl.key.size) {
    const set = new Set(layoutNodes.map((n) => n.id));
    const flat = layered(
      layoutNodes.map(item),
      liveEdges.filter((e) => set.has(e.from) && set.has(e.to)).map(withOffsets),
      { ...o, alignIterations: Math.min(o.alignIterations, 4) }
    );
    for (const [id, p] of flat.pos) hint.set(id, p);
  }
  const hinted = (n) => {
    const it = item(n);
    const h = hint.get(n.id);
    if (h) {
      it.origX = h.x;
      it.origY = h.y;
    }
    return it;
  };

  // 5. Inner cluster layouts.
  const clusterMembers = new Map();
  for (const n of layoutNodes) {
    const k = cl.key.get(n.id);
    if (k == null) continue;
    if (!clusterMembers.has(k)) clusterMembers.set(k, []);
    clusterMembers.get(k).push(n);
  }
  const inner = new Map(); // key -> {pos, width, w, h}
  const memberOf = new Map();
  for (const [k, mem] of clusterMembers) {
    const set = new Set(mem.map((n) => n.id));
    const r = layered(
      mem.map(hinted),
      liveEdges.filter((e) => set.has(e.from) && set.has(e.to)).map(withOffsets),
      o,
      { isolatedPlacement: "column" }
    );
    inner.set(k, r);
    for (const n of mem) memberOf.set(n.id, k);
  }

  // 6. Super layout (clusters + loose nodes).
  const pad = o.groupPadding;
  const superId = (id) => (memberOf.has(id) ? "c:" + memberOf.get(id) : id);
  const innerOff = (id) => {
    const k = memberOf.get(id);
    if (k == null) return { x: 0, y: 0 };
    const p = inner.get(k).pos.get(id);
    return { x: p.x + pad, y: p.y + pad + groupTitleH };
  };
  const superItems = [];
  for (const n of layoutNodes) if (!memberOf.has(n.id)) superItems.push(hinted(n));
  for (const [k, mem] of clusterMembers) {
    const r = inner.get(k);
    const its = mem.map(hinted);
    superItems.push({
      id: "c:" + k,
      w: r.w + pad * 2,
      h: r.h + pad * 2 + groupTitleH,
      origX: Math.min(...its.map((i) => i.origX)),
      origY: Math.min(...its.map((i) => i.origY)),
      flex: false,
    });
  }
  const superEdges = [];
  for (const e of liveEdges) {
    if (bandSet.has(e.from) || bandSet.has(e.to)) continue;
    const a = superId(e.from), b = superId(e.to);
    if (a === b) continue;
    const fo = slotOff(byId.get(e.from), false, e.fromSlot);
    const to = slotOff(byId.get(e.to), true, e.toSlot);
    superEdges.push({
      from: a,
      to: b,
      fromSlot: e.fromSlot,
      toSlot: e.toSlot,
      fromOff: (fo ?? (size.get(e.from).h + titleH) / 2) + innerOff(e.from).y,
      toOff: (to ?? (size.get(e.to).h + titleH) / 2) + innerOff(e.to).y,
    });
  }
  const sup = layered(superItems, superEdges, o);

  // Final box positions (box = includes title bar).
  const box = new Map();
  for (const n of layoutNodes) {
    let x, y, w;
    if (memberOf.has(n.id)) {
      const k = memberOf.get(n.id);
      const sp = sup.pos.get("c:" + k);
      const off = innerOff(n.id);
      x = sp.x + off.x;
      y = sp.y + off.y;
      w = inner.get(k).width.get(n.id);
    } else {
      const sp = sup.pos.get(n.id);
      x = sp.x;
      y = sp.y;
      w = sup.width.get(n.id);
    }
    box.set(n.id, { x, y, w, h: size.get(n.id).h + titleH });
  }

  // 7. Notes band.
  if (noteBand.length) {
    noteBand.sort((a, b) => a.x - b.x || a.y - b.y);
    const limit = Math.max(sup.w, 1000);
    const rows = [];
    let row = [], rw = 0;
    for (const n of noteBand) {
      const w = size.get(n.id).w;
      if (row.length && rw + w > limit) {
        rows.push(row);
        row = [];
        rw = 0;
      }
      row.push(n);
      rw += w + o.hGap;
    }
    rows.push(row);
    const rowHs = rows.map((r) => Math.max(...r.map((n) => size.get(n.id).h + titleH)));
    const bandH = rowHs.reduce((a, b) => a + b, 0) + o.vGap * (rows.length - 1);
    let y = o.notePlacement === "bottom" && layoutNodes.length ? sup.h + o.componentGap : layoutNodes.length ? -(bandH + o.componentGap) : 0;
    rows.forEach((r, i) => {
      let x = 0;
      for (const n of r) {
        const w = size.get(n.id).w;
        box.set(n.id, { x, y, w, h: size.get(n.id).h + titleH });
        x += w + o.hGap;
      }
      y += rowHs[i] + o.vGap;
    });
  }

  // 8. Translate to origin.
  if (box.size) {
    let minX = Infinity, minY = Infinity;
    for (const b of box.values()) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
    }
    const hasGroups = clusterMembers.size > 0;
    if (hasGroups) {
      minX -= pad;
      minY -= pad + groupTitleH;
    }
    let tx = 0, ty = 0;
    if (o.origin === "keep") {
      const movers = live;
      tx = Math.min(...movers.map((n) => n.x));
      ty = Math.min(...movers.map((n) => n.y - titleH));
      if (model.groups?.length) {
        for (const g of model.groups) {
          tx = Math.min(tx, g.x);
          ty = Math.min(ty, g.y);
        }
      }
    }
    for (const b of box.values()) {
      b.x += tx - minX;
      b.y += ty - minY;
    }
  }

  // 9. Snap.
  const g = o.snapToGrid ? Math.max(1, o.gridSize) : 0;
  const resized = o.widthMode !== "keep" || o.heightMode !== "keep";
  const result = { nodes: [], groupUpdates: [], groupRemovals: [], newGroups: [] };
  for (const n of nodes) {
    const b = box.get(n.id);
    if (!b) {
      result.nodes.push({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h, stage: stageOf(n), moved: false });
      continue;
    }
    let x = b.x, y = b.y + titleH, w = b.w, h = b.h - titleH;
    if (g) {
      x = Math.round(x / g) * g;
      y = Math.round(y / g) * g;
      if (resized && !n.collapsed) {
        w = Math.ceil(w / g) * g;
        h = Math.ceil(h / g) * g;
      }
    }
    if (n.collapsed) {
      w = n.w;
      h = n.h;
    }
    result.nodes.push({ id: n.id, x, y, w, h, stage: stageOf(n), moved: true });
  }

  // 10. Groups.
  const finalBox = new Map(result.nodes.map((r) => [r.id, { x: r.x, y: r.y - titleH, w: r.w, h: r.h + titleH }]));
  const rectAround = (ids, extra = []) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const b = finalBox.get(id);
      if (!b) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    for (const r of extra) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    if (!isFinite(x0)) return null;
    const r = { x: x0 - pad, y: y0 - pad - groupTitleH, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + groupTitleH };
    if (g) {
      r.x = Math.floor(r.x / g) * g;
      r.y = Math.floor(r.y / g) * g;
      r.w = Math.ceil(r.w / g) * g;
      r.h = Math.ceil(r.h / g) * g;
    }
    return r;
  };
  const majorityStage = (ids) => {
    const c = new Map();
    for (const id of ids) {
      const s = stageOf(byId.get(id));
      c.set(s, (c.get(s) || 0) + 1);
    }
    return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
  };
  const colorFor = (ids, existing) => {
    switch (o.groupColor) {
      case "single":
        return o.groupSingleColor;
      case "stage":
        return (o.stageGroupColors ?? STAGE_GROUP_COLORS)[majorityStage(ids)];
      case "none":
        return existing ?? undefined;
      default:
        return existing ?? (o.stageGroupColors ?? STAGE_GROUP_COLORS)[majorityStage(ids)];
    }
  };

  const existing = model.groups || [];
  if (cl.mode === "existing") {
    // Refit every existing group around its original members, inner groups first.
    const members = new Map(existing.map((gr) => [gr.index, nodes.filter((n) => (n.groups || []).includes(gr.index)).map((n) => n.id)]));
    const order = [...existing].sort((a, b) => members.get(a.index).length - members.get(b.index).length);
    const rects = new Map();
    for (const gr of order) {
      const mem = members.get(gr.index);
      if (!mem.length || !mem.some((id) => box.has(id))) continue;
      const memSet = new Set(mem);
      const children = order.filter(
        (c) => c !== gr && rects.has(c.index) && members.get(c.index).length < mem.length && members.get(c.index).every((id) => memSet.has(id))
      );
      const r = rectAround(mem, children.map((c) => rects.get(c.index)));
      if (!r) continue;
      rects.set(gr.index, r);
      const upd = { index: gr.index, ...r };
      const col = colorFor(mem, gr.color);
      if (col !== gr.color) upd.color = col;
      result.groupUpdates.push(upd);
    }
  } else {
    for (const gr of existing) result.groupRemovals.push(gr.index);
    for (const [k, mem] of clusterMembers) {
      const ids = mem.map((n) => n.id);
      const r = rectAround(ids);
      if (!r) continue;
      result.newGroups.push({ title: cl.titles.get(k) ?? "Group", color: colorFor(ids), fontSize: o.groupFontSize, ...r });
    }
  }
  return result;
}
