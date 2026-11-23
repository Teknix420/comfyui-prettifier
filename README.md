# ComfyUI Prettifier

![Prettifier](docs/banner.png)

**Alt + P** prettifies the workflow. **Alt + Shift + P** opens the options.

Turns a tangled ComfyUI workflow into a clean, readable one with a single shortcut.
It lays nodes out along the flow of the graph, straightens links, resizes nodes,
creates or tidies groups, and gives you a lot of knobs to make the result look the
way you like.

| Before | After (default options) |
| --- | --- |
| ![before](docs/before.png) | ![after](docs/after-default.png) |

With the *Presentation* preset (stage groups and node colors):

![presentation](docs/after-presentation.png)

## Install

Copy (or clone) this folder into `ComfyUI/custom_nodes/`, so you have
`ComfyUI/custom_nodes/comfyui-prettifier/__init__.py`, then restart ComfyUI and
refresh the browser. It is frontend-only: no Python dependencies, no new nodes.

## Use it

| How | What |
| --- | --- |
| **Alt + P** | Prettify (the selection if 2+ nodes are selected, otherwise the whole workflow) |
| **Alt + Shift + P** | Open the options dialog with live preview |
| Top menu → **Extensions → Prettifier** | All commands, plus an *Align selected* submenu |
| Right-click the canvas → **Prettifier** | Same commands |
| **Settings → Prettifier** | Every option, saved with your ComfyUI settings |

Prettify records an undo step with ComfyUI's normal history (Ctrl+Z), and also has
its own **Undo last prettify** command.

### The options dialog

The dialog shows every option grouped in tabs. With **Live Preview** on, the canvas
re-arranges as you change things; **Apply** keeps the result and **Cancel** (or Esc)
puts everything back. Presets (*Compact*, *Spacious*, *Presentation*, *Tidy only*)
set several options at once. **Apply** saves the options as your defaults; **Cancel** discards them.

## What it does

**Layout**
1. **Columns by flow.** Nodes are placed in columns following the links
   (a Sugiyama-style layered layout). Cycles are handled, and loaders can sit right
   next to the nodes that use them.
2. **Fewer crossings.** Nodes inside each column are reordered to reduce crossing
   links, using socket order as a tie-breaker (so a positive prompt lands above the
   negative one feeding the same KSampler).
3. **Straight links.** Each node is moved vertically so its sockets line up with
   the sockets it connects to, without ever overlapping.
4. **Sizing.** Nodes can be shrunk to fit their content, made a uniform width per
   column, or a fixed width. Nodes with images or text boxes are protected from
   shrinking unless you allow it.
5. **Groups.** Either keeps and tidies your existing groups, or creates new ones by
   pipeline stage (Models, Inputs, Prompt, Sampling, Latent, Image, Mask, Output),
   node category, node type, node color, connected section, or your own rules.
   Grouped nodes are laid out together and groups never overlap.

**Around the layout**
- **Reroute cleanup.** Old reroute dots are cleared and long links that would run
  through a node get new dots that carry them above or below it. Links are also
  kept out of groups they don't belong to (neither end inside), which you can turn
  off. Or just remove every dot, or leave them alone. With **Stay level**, a
  rerouted link runs horizontally as far as it can and only gets a dot where it
  has to change height. Bends are centered in the gap between two columns (or, if
  you prefer, placed right next to the node they go around). A **direction
  preference** makes long links turn once, either near the input (horizontal
  first) or near the output (vertical first), and rerouted links can be sent
  **above or below the whole workflow** instead of between the nodes. With the
  Straight link style every turn gets its own dot, so links leave and enter
  nodes level. **Overlapping links** can be merged: links that take the same path
  run on top of each other as one line instead of side by side, either only links
  from the same output (they then share their dots until they branch) or all
  links. Prettifying the whole workflow clears every old dot first
  (a selection only clears the dots of its own links), and running it again gives
  the same result.
- **Variables instead of long links.** Optionally swap long links, or links that
  would cross a node or run backwards, for a small **Set** node next to the
  source and a **Get** node next to each node that uses the value. The workflow
  runs exactly the same. One variable is made per output and named from a
  template, and "Turn variables back into links" undoes it at any time.
- **Renaming.** Rename node titles and connector labels from templates
  (`{stage}: {default}`, `{name}[ ← {source}]`), with criteria (only untouched
  nodes, only matching types, only connected connectors), capitalization,
  numbering of duplicates, and find/replace rules.
- **Collapse and inactive nodes.** Auto-collapse nodes matching a pattern (loaders,
  primitives…), expand everything, and dim and/or collapse muted or bypassed nodes.
- **Colors.** Fifteen built-in color palettes (ComfyUI classic, Pastel, Vivid,
  Monochrome, Ocean, Sunset, Forest, Earth, Neon, Candy, High contrast, Nord,
  Dracula, Solarized, Gruvbox) plus a custom one.
  - *Nodes* can match the color of the group they are in, or be colored by
    pipeline stage, by node type or by category. Your own rules
    (`KSampler = #8e44ad; Loader = #1f618d`) win over all of these.
  - *Groups* can be colored by stage, get a different palette color each, or
    share one color. They can be drawn filled at any opacity, or as an outline only.
  - *Links* can be colored by data type (model, latent, image, ...) from one of
    six link schemes, or follow the palette.

  ![colors](docs/colors.png)
- **Themes.** Save any set of options, colors included, as a named theme in the
  options dialog, and export or import themes as JSON files to share them. Pick a
  preset or theme in the list and press Load to use it. Picking a theme does not
  load it, so you can pick one and press Save to update it with the options as
  they are now.
- **Per-workflow options.** The options a workflow was prettified with are stored
  in the workflow file and reused next time.
- **Summary note.** A note listing models, LoRAs, resolution, sampler settings and
  seeds (optionally prompts), refreshed on every prettify.
- **Lint report.** Flags missing required inputs, models that are not in the list,
  missing node types, unused nodes, duplicate loaders, suspicious values (very high
  steps or CFG, zero denoise, sizes not divisible by 8…) and muted or bypassed
  nodes. Click a finding to jump to the node.
- **Automatic runs.** Optionally prettify when a workflow is opened and/or saved.
- **Subgraphs.** Prettifying a workflow also tidies the inside of every subgraph.
  A subgraph's own inputs and outputs can be renamed from a template (the panels
  inside and the connectors on the subgraph node change together) and reordered
  so fewer links cross, either to match the layout inside the subgraph or the
  nodes around the subgraph node.
- Notes are gathered into a row, unconnected nodes are packed neatly, pinned nodes
  stay put, plus snap to grid, zoom to fit and an animated transition.

Also included: align left/right/top/bottom/center, distribute, match width/height,
shrink to fit content, and fit groups to their nodes.

### Renaming templates

| Where | Tokens |
| --- | --- |
| Node titles | `{title}` current title, `{default}` default name, `{type}`, `{id}`, `{n}` number among nodes of the same type, `{stage}`, `{category}`, `{group}`, `{widget:NAME}` a widget value |
| Connectors | `{name}`, `{label}` current label, `{type}` data type, `{node}` this node's title, `{source}` title of the node feeding an input, `{sourceSlot}` |
| Subgraph connectors | `{name}` original name, `{label}`, `{type}`, `{inner}` name of the connector it is wired to inside, `{node}` title of that inside node, `{source}` title of the node feeding it on the parent canvas, `{subgraph}` |

A `[bracketed part]` is dropped when a token inside it is empty. Find/replace rules
look like `find => replace; find2 => replace2` (regular expressions), and can be
limited to node or data types: `CLIPTextEncode :: ^.*$ => Prompt`.

Subgraph connectors use the connector capitalization and find/replace rules, and
connectors that would end up with the same label are numbered. Inside a subgraph,
`{source}` on an input fed by the input panel is that subgraph input's name.

## Options

| Tab | Options |
| --- | --- |
| Layout | Flow direction, column assignment, vertical alignment, alignment inside a column, crossing reduction passes, link straightening iterations, respect current order |
| Spacing | Horizontal, vertical and section gaps, snap to grid, grid size, anchor |
| Sizing | Node width mode, fixed/min/max width, node height mode, shrink nodes with images or text |
| Groups | Arrangement (follow the flow, compact, most compact), target shape, group by (auto, existing, stage, category, section, node type, node color, only my rules, none), custom group rules, groups not to create, name template, name find/replace, number duplicate names, restyle existing groups, minimum group size, category depth, padding, title size, color mode, single color |
| Placement | Unconnected nodes, notes, sort unconnected nodes by node ID, title or current position, separate sections, align ungrouped nodes with the group box or with the nodes inside groups, match grouped node width, never move pinned nodes |
| Links | Reroute dots (auto, remove, keep), rerouted links take the shortest way or stay level, bends centered between columns or next to the node, direction preference (horizontal or vertical first), send rerouted links above or below the workflow, overlapping links side by side or merged (by output, or all), route around groups, clearance, minimum link length, replace links with variables (long, blocked, both), length that counts as long, variable name template, collapse variable nodes |
| Nodes | Collapse mode and pattern, muted/bypassed style, subgraphs, subgraph connector order |
| Renaming | Rename on prettify, title mode/template/criteria/type filter/capitalization/numbering/rules, connector mode/template/sides/only connected/widget inputs/capitalization/rules, subgraph connector mode/template |
| Notes | Summary note on/off, type, title, include prompts |
| Appearance | Palette, custom palette JSON, node colors (by group, stage, type, category), custom node color rules, link colors by data type, link style, animation, zoom to fit |
| Behavior | Scope, prettify on open/save, remember and use per-workflow options, summary message |
| Lint | Check on prettify, each check on/off, step and CFG thresholds |

### Compact arrangement

By default everything follows the flow, which can make a group of unconnected
nodes (a dozen loaders, say) one tall stack. **Groups → Arrangement** changes that:

- *Compact* packs separate pieces side by side in rows: the nodes inside a group
  that are not linked to each other, and separate sections of the workflow.
- *Most compact* also splits a tall column of linked nodes or groups into several
  columns. Flow still runs left to right, but some links then pass other nodes.

"Target shape" sets how wide the result should be compared to its height.

### Custom groups

Custom group rules look like `Name = pattern`, separated by `;`, with an optional
color after the name: `Loaders #3f789e = Loader|Checkpoint; Prompts = TextEncode`.
The pattern is a regular expression matched against a node's type, title, category
and pipeline stage. Rules are checked first and in order; nodes no rule claims
follow "Create Groups By" (choose "Only My Custom Rules" to leave them ungrouped).
A rule's color wins over the group color mode.

Group names can be shaped with a template (`{name}`, `{count}`, `{n}`, `{stage}`,
for example `{n}. {name} ({count})`) and with find/replace rules
(`Models => Loaders`). "Don't create groups named" skips groups by name, such as
`Utilities|Other`.

An ungrouped node that shares a column with a group normally lines up with the
group box. **Placement → Align ungrouped nodes with → The nodes inside groups**
insets it by the group padding so it lines up with the grouped nodes instead, and
"Ungrouped nodes match grouped node width" also gives it their width.

"Auto" grouping keeps your groups if the workflow has any, and otherwise groups by
pipeline stage. "No groups" removes groups in the area being prettified.

Commands (top menu, canvas right-click, or bind your own keys): Prettify workflow,
Prettify selected nodes, Rename nodes and connectors, Lint workflow, Create or update
summary note, Reroute links around nodes, Remove all reroute dots, Replace long links with
variables, Turn variables back into links, Prettifier
options, Undo last prettify, Fit groups to their nodes, Forget this workflow's
remembered options, and the Align tools.

## Project layout

```
__init__.py        tells ComfyUI to serve ./web (no Python nodes)
web/prettifier.js  extension entry: commands, keybindings, menus, settings registration
web/settings.js    option schema, defaults, presets, settings read/write
web/layout.js      pure layout engine (no ComfyUI imports, unit-testable)
web/graph.js       LiteGraph adapter: read graph, apply result, snapshots, align tools
web/core.js        prettify / rename / undo actions, pass ordering
web/rename.js      pure renaming engine (templates, rules)
web/lint.js        pure lint checks
web/extras.js      reroutes, collapse rules, summary note, per-workflow options, subgraphs
web/subgraphs.js   subgraph inputs/outputs: renaming, reordering, undo
web/variables.js   Set / Get variable nodes and swapping links for them
web/themes.js      palettes, saved themes, export/import
web/colors.js      color helpers, node coloring rules
web/display.js     link colors by data type, group fill and outline
web/dialog.js      options dialog with live preview
web/lintdialog.js  lint report panel
tests/             Node tests for the engine (node tests/test_layout.mjs --svg)
```

## Development

The engine runs in plain Node 18+:

```
node tests/test_layout.mjs          # invariants: no overlaps, groups don't overlap, flow goes forward
node tests/test_layout.mjs --svg    # also writes before/after SVGs to tests/out/
node tests/test_rename.mjs
node tests/test_lint.mjs
node tests/test_reroutes.mjs
node tests/test_subgraphs.mjs
node tests/test_variables.mjs
node tests/test_colors.mjs
node tests/test_groups.mjs          # collapsed nodes stay in their groups
node tests/test_sort.mjs            # unconnected nodes and notes sort by ID, title or position
node tests/test_order.mjs           # nodes in a column keep their canvas order
```

Before a release, `python3 .github/scripts/registry_scan.py` checks the files that
get uploaded for code the Comfy Registry's scanner is known to flag. The publish
workflow runs it first and stops if it finds anything.

## Known limitations

- Reroute cleanup works on native reroute dots; legacy Reroute nodes are laid out
  like any other node. Auto routing is a simple above-or-below detour, not a full
  router, so busy graphs can still have links crossing nodes or groups.
- Prettify on save hooks ComfyUI's Save and Save As commands; other ways of
  saving (export, API) are not affected.
- Variables: the Set and Get nodes come with Prettifier, so a workflow that uses
  them needs Prettifier installed to open and run (turn them back into links
  before sharing it with someone who does not have it). A variable is only
  visible inside the graph or subgraph it is in.
- New groups are a single level: Prettifier does not create groups inside groups.
- Nested groups are kept as they are (inner groups are laid out inside their
  outer group), but a group that only partly overlaps another one is treated as
  a separate group.
- A pinned node stays put while the rest of its group is laid out, and the group
  is fitted around the nodes that were laid out. The layout does not steer
  around pinned nodes, so one can end up under other nodes or outside its group.
- Inside a subgraph, the open subgraph is what gets prettified.
- Subgraph connector order follows one side at a time: matching the inside can
  add crossings outside and the other way round. With several copies of the same
  subgraph, "outside" follows the first copy that has anything connected.
