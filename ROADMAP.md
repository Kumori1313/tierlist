# Tierlist — Development Roadmap

A single standalone HTML file (`tierlist.html`) containing all markup, styles, and script.
No build step, no runtime network dependencies, opens by double-click from the filesystem.

---

## Architectural decisions (made up front, before Phase 0)

These shape every phase, so they're settled here rather than discovered mid-build.

### 1. Zero external libraries

"Standalone HTML file" is taken literally: no CDN `<script>` tags, no bundled minified
copy of JSZip or SortableJS. Everything is hand-written. This is feasible because:

- **ZIP** can be written and read by hand. The format needed here is small: local file
  headers, a central directory, and an end-of-central-directory record. CRC-32 is ~15
  lines with a precomputed table.
- **Compression** is native. `CompressionStream('deflate-raw')` and
  `DecompressionStream('deflate-raw')` ship in every current browser, so the ZIP can be
  genuinely deflated rather than store-only — and imported ZIPs produced by other tools
  (7-Zip, macOS Archive Utility) will still decompress.
- **Drag and drop** is better hand-rolled here anyway (see next point).

### 2. Pointer Events for drag & drop, not the HTML5 Drag-and-Drop API

The native DnD API has poor touch support, an unstylable drag image on several
platforms, and awkward `dragover`/`dragleave` event storms on nested drop targets.
Since both *items* and *whole tiers* must be draggable — two different drag behaviours
sharing one code path — a unified `pointerdown`/`pointermove`/`pointerup` engine with a
custom floating drag layer gives consistent results on desktop and touch, and makes
animated gap-insertion feasible.

Native DnD is still wired up for **one** narrow purpose: dropping image files from the
OS onto the app (`dragover`/`drop` on the detail panel's image slot).

### 3. Items live in a lookup, tiers hold ID lists

Items are stored once in a flat `items` map keyed by ID; each tier holds an ordered
array of item IDs. This keeps reordering as cheap array splices, makes an item's
identity stable while it moves between tiers, and means the detail panel edits one
canonical object.

### 4. An unassigned item pool is required

Not in the original spec, but a tierlist is unusable without it: newly created items
need somewhere to live, and users need a bench to pull from while ranking. A pool row
sits below the tiers and behaves as a drop target like any other. It is not exported as
a tier — it is its own field in the config.

### 5. Images are Blobs in memory, referenced by ID

State never holds base64. Each uploaded image gets an ID; the runtime keeps
`Map<imageId, {blob, objectURL, filename, mime}>`. The item record only stores
`imageId`. This means:
- Rendering is `<img src="blob:...">` — fast, memory-efficient, no giant strings in state.
- Export writes the raw blob bytes straight into the ZIP.
- Import reverses it exactly.

Object URLs are revoked when an image is replaced or its last referencing item is
deleted.

### 6. The export format

A ZIP, extension `.tierlist` (still a valid ZIP; renaming to `.zip` opens it in any
archiver, which is useful for debugging and for user trust).

```
mylist.tierlist
├── tierlist.json        # the whole config, schema-versioned
└── images/
    ├── img_a1b2c3.png
    ├── img_d4e5f6.jpg
    └── ...
```

`tierlist.json` references images by the exact path inside the archive, so the mapping
is explicit and self-describing rather than positional.

---

## Data model

The contract that Phases 0–7 all build against. Version it from day one so future
schema changes can be migrated on import instead of rejected.

```jsonc
{
  "schema": 1,
  "app": "tierlist",
  "title": "My Tier List",
  "createdAt": "2026-08-03T12:00:00.000Z",
  "modifiedAt": "2026-08-03T12:34:56.000Z",

  "tiers": [
    {
      "id": "tier_s",
      "name": "S",
      "color": "#ff7f7f",
      "items": ["item_01", "item_04"]
    }
  ],

  "pool": ["item_02", "item_03"],

  "items": {
    "item_01": {
      "id": "item_01",
      "name": "Item name",

      // exactly one of these two is active — enforced by the app, validated on import
      "shortType": "text",          // "text" | "image"
      "shortText": "brief label",   // used when shortType === "text"
      "image": "images/img_a1b2c3.png",  // used when shortType === "image"; null otherwise

      "description": "The long-form description shown in the detail panel.",
      "accent": null                // optional per-item colour, reserved
    }
  },

  "images": {
    "images/img_a1b2c3.png": {
      "filename": "original-upload-name.png",
      "mime": "image/png",
      "bytes": 48213,
      "width": 512,
      "height": 512
    }
  }
}
```

**Invariants the app maintains and the importer validates:**
- Every ID in `tiers[].items` and `pool` exists in `items`, appears exactly once across
  all of them, and never in two places.
- `shortType === "image"` ⟺ `image` is a non-null key present in `images`.
- Every key in `images` has a corresponding file in the archive; orphaned images are
  dropped on import, missing ones degrade the item to a text short description with a
  visible warning rather than failing the whole load.

---

## Phase 0 — Skeleton & state core

**Goal:** a file that runs, holds state, and renders nothing interactive yet.

- `tierlist.html` scaffold: `<style>`, markup shell, `<script>` — all inline.
- Layout shell: header (list title, toolbar), main board column, right detail panel
  (present in the DOM, closed/translated off-screen), pool row.
- CSS custom-property design tokens: colours, spacing scale, radii, shadows, panel
  width, transition durations. Dark theme as the default, light theme via
  `prefers-color-scheme`.
- `state` object matching the schema above, plus a runtime-only `images` Map.
- ID generation (`item_` / `tier_` / `img_` + short random suffix).
- Central `render()` entry point and the per-section render functions it calls.
- Seed state: five default tiers (S/A/B/C/D with the conventional red→green ramp) and
  an empty pool.

**Done when:** opening the file shows the five empty tier rows and an empty pool,
correctly laid out at desktop and narrow widths.

---

## Phase 1 — Tiers & items as static content

**Goal:** the board is fully populated and correct, still with no dragging.

- Tier row rendering: label cell (name + colour) on the left, drop zone to the right.
- Item card rendering: fixed-size square-ish tile showing the short representation
  (text for now) and the item name.
- Add tier / delete tier. Deleting a tier moves its items back to the pool rather than
  destroying them, with an undo-able confirm for non-empty tiers.
- Add item (creates in the pool with a placeholder name) / delete item.
- Tier renaming: click the label to edit in place (`contenteditable` or a swapped
  `<input>`), commit on blur/Enter, cancel on Escape.
- Tier colour: swatch picker on the tier label.
- Item renaming: the same inline editor, on the card's name footer — a stopgap so that
  Phase 1 can meet its own exit criterion of naming everything by clicking. Phase 4
  moves it into the detail panel and takes it off the card, restoring the single
  editing surface.
- List title renaming, same editor. Phase 6 derives the export filename from it.

**Done when:** a full tierlist can be constructed and named entirely by clicking, with
items placed only via a temporary "move to tier" control that Phase 2 replaces.

---

## Phase 2 — Item drag & drop

**Goal:** the core interaction.

- Generic pointer drag engine, auto-cancelling on `pointercancel` and Escape. Starting
  a drag differs by input device: a mouse needs a few pixels of travel (so clicks still
  register as clicks), touch needs a ~400ms long press. The long press is what lets a
  finger resting on a card still scroll the board — `touch-action: none` on cards would
  have cost that, and cards cover most of the board. Once a touch drag is live the
  engine calls `preventDefault` on `touchmove` to stop the page scrolling underneath it.
- Floating drag layer: the dragged card is cloned into a fixed-position element that
  follows the pointer, tilted and shadowed; the original becomes a dimmed placeholder.
- Drop targets: every tier's drop zone and the pool. Hit-testing by geometry against
  cached rects, recomputed at drag start (and on scroll).
- Insertion index: compare pointer X against the midpoints of the sibling cards in the
  hovered row; render a live gap at the computed index so the drop position is
  unambiguous before release.
- Commit: splice out of the source list, splice into the target list, re-render.
- Edge cases: releasing outside every drop zone keeps the last previewed position
  rather than snapping back to the origin — the gap on screen is a promise, and
  breaking it because the pointer strayed a few pixels off the board is worse than
  honouring it. Escape is the way to abort. Also: dragging the only item in a tier;
  drag while the detail panel is open (panel stays open and follows the item).
- Removing the temporary `<select>` leaves no keyboard route for placing an item until
  Phase 8 adds one. Known regression, tracked there.
- Auto-scroll the board when dragging near the viewport's top/bottom edge.

**Done when:** items can be freely rearranged within a tier, between tiers, and to and
from the pool, on both mouse and touch.

---

## Phase 3 — Tier drag & drop

**Goal:** reorder whole rows, reusing the Phase 2 engine.

- A dedicated grab handle on the tier label, so dragging a tier never conflicts with
  dragging items inside it or with renaming.
- Vertical variant of the drag engine: the row lifts, remaining rows animate to open a
  gap at the target index (a `FLIP` transform pass keeps this smooth).
- Drop commits by splicing `state.tiers`.
- The pool is pinned below all tiers and is not reorderable.

**Done when:** rows can be reordered by their handles, item drag still works
identically, and the two drag modes cannot be triggered simultaneously.

---

## Phase 4 — Detail panel (Notion-style)

**Goal:** the editing surface for an item.

- Opens on item card click, slides in from the right over a scrim-free board (the board
  compresses or the panel overlays, decided by viewport width: overlay under ~1100px,
  push above it).
- Contents, top to bottom:
  - Item **name**, large, editable inline.
  - **Short display** control — the mode switch and its editor (built in Phase 5; in
    this phase, the text-only version).
  - **Description** — a large auto-growing textarea for the long-form text.
  - Metadata footer: current tier, plus delete-item.
- Behaviour: edits write to state on input (debounced re-render of just the affected
  card, not the whole board). Escape closes. Clicking another item swaps the panel
  contents without a close/open animation. Clicking empty board space closes it.
- Focus management: focus moves into the panel on open and returns to the originating
  card on close; the panel is a focus trap only while it overlays.
- The open item's card gets a persistent selected outline on the board.

**Done when:** every item property except the image can be edited from the panel, and
the panel feels like a Notion page peek — quiet, keyboard-dismissible, non-modal.

---

## Phase 5 — Images as the short description

**Goal:** the text-or-image exclusivity, done properly.

- A two-option segmented control in the panel: **Text** / **Image**. Switching modes
  sets `shortType`; the inactive field's value is *retained* in state so toggling back
  and forth is non-destructive. Only the active one is rendered on the card — but both
  are exported, or the round trip would quietly destroy whichever mode was switched
  away from before saving.
- Image intake, three paths: file picker button, drag a file from the OS onto the image
  drop area, and paste from clipboard while the panel is focused.
- Validation: accept `image/png`, `image/jpeg`, `image/webp`, `image/gif`, `image/avif`.
  Reject non-images with an inline message.
- Downscaling: images above a max edge (~1024px) are re-encoded through a canvas to
  WebP before storage, keeping export sizes sane. Original filename and dimensions are
  preserved in metadata. Animated GIFs bypass downscaling (canvas would flatten them).
- Storage: blob into the runtime image map, object URL created, `imageId` written to the
  item.
- Card rendering: image mode fills the card with `object-fit: cover`, name overlaid on a
  gradient scrim for legibility; text mode renders as in Phase 1.
- Replace / remove image controls. Removing reverts the card to text mode. Object URL
  revocation on replace and on item delete.

**Done when:** an item can carry an image on its card, the mode is strictly one-or-the-
other, and no orphaned object URLs leak across a long session.

---

## Phase 6 — Export & import

**Goal:** the portability requirement — the same list, images included, on any device.

**6a — ZIP writer**
- CRC-32 table + implementation.
- `deflate-raw` via `CompressionStream` for `tierlist.json`; images written store-only
  (method 0) since they're already compressed formats.
- Emit local file headers, file data, central directory, EOCD. Use the ZIP64-free
  layout; guard against >4GB totals with an explicit error (unreachable in practice).
- Assemble as a `Blob`, trigger download via an object URL on a synthetic `<a download>`.
- Filename derived from the list title, slugified, `.tierlist` extension.

**6b — Serialization**
- Walk state, write `images` metadata, stamp `modifiedAt`, drop unreferenced images.
  "Referenced" means some item's `image` field names it — *not* that the item is
  currently in image mode, since a retained image belonging to a text-mode item must
  survive the round trip. Paths are assigned at upload and never rewritten, so an
  item's archive path is stable across exports.

**6c — ZIP reader**
- Locate EOCD by scanning backwards from the end (handles a trailing comment).
- Parse the central directory for entry names, methods, offsets, sizes.
- Read local headers, slice the data, inflate via `DecompressionStream('deflate-raw')`
  for method 8, pass through for method 0.
- Tolerate archives produced by other tools — do not assume our own writer's byte layout.

**6d — Import & validation**
- Load via a toolbar button and via dropping a `.tierlist` file anywhere on the window.
- Parse `tierlist.json`, check `schema` and run a migration chain if it's older.
- Enforce the invariants listed in the data model; repair what's repairable (duplicate
  IDs, orphaned references, missing images) and surface a summary of what was fixed.
  Reject only on unparseable JSON or a missing manifest.
- Rebuild the runtime image map from the archive blobs, mint fresh object URLs.
- Confirm before replacing the current list if it has unsaved content.

**Done when:** export on one machine, import on another, and the board — ordering,
names, both description fields, colours, images — is byte-for-byte the same list.

---

## Phase 7 — Persistence & session safety

**Goal:** don't lose work between the export button presses.

- Autosave to **IndexedDB** (not localStorage — blobs, and a 5MB quota that images blow
  through instantly). One object store for the JSON state, one for image blobs.
- Debounced writes on any state mutation; restore on load if a session exists.
- `beforeunload` warning only when work would genuinely be lost — that is, when the
  document is dirty *and* storage is unavailable. Warning on every close while autosave
  is quietly working teaches people to dismiss the dialog without reading it, which
  costs exactly the one time it mattered.
- "New list" / "Clear" with confirmation.

**Done when:** closing and reopening the file restores the exact working state,
including images, with no manual export step.

---

## Phase 8 — Polish, robustness, accessibility

**Goal:** the difference between a demo and something usable daily.

- **Undo/redo** (`Ctrl+Z` / `Ctrl+Shift+Z`) over a bounded stack of state snapshots.
  Cheap to add once all mutations funnel through a single `commit()` — worth routing
  them that way from Phase 0.
- **Keyboard accessibility**: every drag operation needs a non-pointer equivalent —
  select a card, then move it with arrow keys / bracket keys across tiers. Tiers get
  ARIA list semantics; the detail panel is announced properly; drag state is exposed via
  `aria-grabbed`-equivalent live-region messaging.
- **Responsive**: below ~700px the tier rows scroll horizontally and the detail panel
  becomes a bottom sheet.
- **Empty states**: an empty pool, an empty tier, and a fresh list each say something
  useful rather than sitting blank.
- **Errors**: Phase 6 already added the banner strip under the header — it carries
  import results, repair summaries, refusals, and the replace-unsaved-work
  confirmation, and the panel has its own inline error line for rejected images.
  What remains here is routing quota failures into the same place and deciding
  whether anything genuinely warrants a transient toast rather than a persistent
  banner. Nothing should ever fail silently or via `alert()`.
- **PNG snapshot export** (nice-to-have): render the board to a canvas for sharing.
  Distinct from the config export and explicitly one-way.
- Cross-browser pass: Chrome, Firefox, Safari — particularly `CompressionStream`
  behaviour, pointer capture on touch, and `file://` restrictions.

---

## Sequencing rationale

Phases 0–1 establish the data model and rendering, because both drag systems and the
panel are just mutations of that model — building them first would mean rewriting them.
Item drag (2) precedes tier drag (3) because the second reuses the first's engine, and
item dragging is the interaction that makes the app testable by hand. The detail panel
(4) comes before images (5) because the image control lives inside it and has nowhere to
exist otherwise. Export (6) comes after images because the image pipeline defines what
actually goes into the archive — attempting it earlier means designing the ZIP layout
against a guess. Persistence (7) reuses the exact serialization written for export.
Polish (8) is last by definition, with the caveat that undo/redo's plumbing —
funnelling mutations through one commit function — should be respected from Phase 0
onward, or retrofitting it means touching every phase again.

---

## Risk notes

| Risk | Mitigation |
|---|---|
| `file://` origin restrictions (IndexedDB is available, but some browsers treat every `file://` page as a unique opaque origin) | Test early in Phase 7; fall back to export-only with a clear message if the browser refuses storage |
| Hand-rolled ZIP reading foreign archives | Parse the central directory rather than streaming local headers; test against archives from at least two external tools |
| Large image sets producing multi-hundred-MB exports | Downscale + re-encode on upload (Phase 5), show a running total size in the toolbar |
| Two drag systems interfering | Single shared engine with a mode flag and a global "a drag is active" guard |
| Growing to one unmaintainable file | Keep strict internal sections with banner comments: tokens → state → serialization → zip → render → drag → panel → boot |
