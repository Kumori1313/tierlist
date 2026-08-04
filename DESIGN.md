# Tierlist — Design Notes

Why the app is built the way it is. The code says what it does; this says what the
alternatives were and why they lost.

Originally written as a build roadmap before any code existed, then kept honest as
decisions met reality. The phase-by-phase plan has been folded into *Build order*
below — the commit history has the blow-by-blow, and each commit message carries its
own reasoning.

---

## The premise

A single standalone HTML file: all markup, styles, and script inline. No build step, no
server, no runtime network access. It has to open by double-click from the filesystem
and keep working.

Everything below follows from taking that literally.

---

## Architectural decisions

### 1. Zero external libraries

No CDN `<script>` tags, no bundled minified copy of JSZip or SortableJS. A CDN tag
breaks the offline promise outright; a vendored copy makes the "single file" claim
technically true and practically a lie. Both major dependencies turned out to be
avoidable:

- **ZIP** is small to write by hand — local file headers, a central directory, an
  end-of-central-directory record, and CRC-32 from a precomputed table. About 120 lines
  for both directions.
- **Compression** is native. `CompressionStream('deflate-raw')` and its inverse ship in
  every current browser, so archives are genuinely deflated rather than store-only, and
  archives from other tools decompress. Where it is unavailable the writer falls back to
  storing, which is still a valid ZIP.
- **Drag and drop** is better hand-rolled here anyway — see next.

### 2. Pointer Events for dragging, not the HTML5 drag-and-drop API

The native API has poor touch support, an unstylable drag image on several platforms,
and `dragover`/`dragleave` storms across nested drop targets. Items and whole tiers both
need to drag, which is two behaviours sharing one engine, and the engine needs to
animate a gap opening at the insertion point. A `pointerdown`/`pointermove`/`pointerup`
engine with a custom drag layer gives all of that and behaves the same on desktop and
touch.

Native DnD is still used for exactly one thing: files arriving from outside the page —
an image dropped onto the panel, or a `.tierlist` dropped onto the window.

**The dragged element is its own placeholder.** It moves through the DOM during the drag
to preview the drop while a clone follows the pointer; on release the affected lists are
read back out of the DOM. What was previewed is therefore what commits, by construction.
`state` is untouched until the drop, which makes cancelling a matter of re-rendering.

**Starting a drag differs by device.** A mouse needs a few pixels of travel, so clicks
still register as clicks. Touch needs a ~400ms long press — `touch-action: none` on
cards would have bought simpler code at the cost of scrolling the board with a finger
resting on a card, and cards cover most of the board. Once a touch drag is live,
`touchmove` is `preventDefault`ed so the page does not slide underneath it.

**Hit-testing measures differently for the two kinds.** Cards use live rects, re-read
each frame because moving the placeholder reflows the board. Rows use `offsetTop`,
because rows carry FLIP transforms mid-animation and testing against animated positions
makes the decision feed back into itself and flicker. Layout position is the stable
input.

### 3. Items live in a lookup, tiers hold ID lists

Items are stored once in a flat `items` map keyed by ID; each tier holds an ordered array
of those IDs. Reordering is a pair of array splices, an item's identity survives moving
between tiers, and the detail panel edits one canonical object.

### 4. An unassigned pool is required

Not in the original brief, but a tier list is unusable without it: new items need
somewhere to exist, and ranking needs a bench to pull from. The pool is a drop target
like any other, but it is its own field in the document rather than a tier, so it never
appears in the ranking or in the exported PNG.

### 5. Images are blobs in memory, referenced by archive path

State never holds base64. An item stores the path it will occupy inside the archive —
`images/img_9f2c.webp` — and the bytes plus their object URL live in `runtime.images`
under that same key. So:

- rendering is `<img src="blob:…">`; no megabyte strings in the document,
- export writes the blob straight into the archive at the path the manifest already
  names, making the item-to-file mapping explicit rather than positional,
- import and session restore reverse it identically,
- paths are minted once at upload and never rewritten, so they are stable across saves.

Object URLs are refcounted against everything that can still reach them: the document,
and every undo snapshot. Freeing on removal alone would mean undoing that removal
restores an item pointing at bytes already gone. A sweep runs when a snapshot falls off
the end of the history — deferred until after the mutation, since running it during the
snapshot push collects the image the caller is midway through attaching.

### 6. The export format

A ZIP with a `.tierlist` extension — still an ordinary ZIP, so renaming it to `.zip`
opens it in any archiver. That matters for debugging and for trusting the format with
your data.

```
my-list.tierlist
├── tierlist.json     the whole document, schema-versioned
└── images/
    ├── img_9f2c4a.webp
    └── img_be71d0.png
```

Reading parses the central directory rather than walking local headers, and takes each
local header's own name and extra-field lengths rather than assuming this writer's
layout — other tools pad them differently. The EOCD scan runs backwards to survive a
trailing comment.

### 7. One mutation funnel

Every change to the document goes through `commit()`. Undo, autosave, and the dirty flag
each hook that one function instead of every call site. This was built in before there
was anything to undo or save, on the grounds that retrofitting it later means touching
every feature again — the single highest-leverage decision in the file.

---

## Data model

The contract the importer validates against.

```jsonc
{
  "schema": 1,
  "app": "tierlist",
  "title": "My Tier List",
  "createdAt": "2026-08-03T12:00:00.000Z",
  "modifiedAt": "2026-08-03T12:34:56.000Z",

  "tiers": [
    { "id": "tier_s", "name": "S", "color": "#ff7f7f", "items": ["item_01", "item_04"] }
  ],

  "pool": ["item_02", "item_03"],

  "items": {
    "item_01": {
      "id": "item_01",
      "name": "Item name",

      "shortType": "text",               // "text" | "image" — which one the card shows
      "shortText": "brief label",
      "image": "images/img_a1b2c3.png",  // retained even in text mode, see below

      "description": "The long-form text shown in the detail panel.",
      "accent": null                     // reserved
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

**Invariants the app maintains and the importer enforces:**

- Every ID in `tiers[].items` and `pool` exists in `items` and appears exactly once
  across all of them.
- `shortType` decides which short description the card renders; the other is *retained*,
  so toggling the mode is non-destructive. Both are written on export — dropping the
  inactive one would silently destroy whichever mode you switched away from before
  saving.
- An image is "referenced" when some item's `image` field names it, whether or not that
  item is currently in image mode. Unreferenced images are dropped on export and import.
- Bytes missing for a referenced path degrade that item to text with a visible warning,
  rather than failing the load.

The importer repairs rather than refuses wherever intent is recoverable — duplicate
placements, references to items that no longer exist, items belonging to no list,
malformed tier entries, missing image bytes — and reports every repair. Only a missing
manifest, an unparseable one, or a newer `schema` is fatal, and a refusal never disturbs
the list already open.

Session restore runs the *same* validation: `adoptManifest` takes a resolver for image
bytes rather than an archive, so a restored session and an imported file get identical
treatment.

---

## Build order

The sequence mattered, and would matter again for anything similar.

The data model and rendering came first, because both drag systems and the panel are
just mutations of that model — building them against a provisional shape would have
meant rewriting them. Item dragging preceded tier dragging, since the second reuses the
first's engine and the first is what makes the app testable by hand. The detail panel
preceded images, because the image control lives inside it and had nowhere else to
exist. Export came after images, because the image pipeline defines what actually goes
into the archive; attempting it earlier means designing the ZIP layout against a guess.
Persistence reused the serialization written for export verbatim. Polish went last,
except for the `commit()` funnel, which had to exist from the beginning.

Two stopgaps were built knowing they would be thrown away, and both earned their keep:
a temporary "move to tier" `<select>` so items could reach a tier before dragging
existed, and inline renaming on the card before there was a panel to hold it.

---

## Decisions that changed under contact with reality

Recorded because the reasoning is the useful part, and because each of these looked
correct on paper.

**Releasing a drag outside every drop zone keeps the last previewed position** rather
than snapping back to the origin. The gap on screen is a promise; breaking it because
the pointer strayed a few pixels off the board is worse than honouring it. Escape is the
deliberate abort.

**Touch drags start on a long press**, not on travel. The original plan put
`touch-action: none` on cards, which would have broken scrolling from the largest part
of the board.

**Both short descriptions are exported**, not just the active one. The plan said only
the active mode was meaningful on export, which would have made toggling to image and
back to text destroy the image on the next save.

**`beforeunload` warns only when work would genuinely be lost** — dirty *and* storage
unavailable. The plan said "changes since the last export", but warning on every close
while autosave is quietly working teaches people to dismiss the dialog unread, which
costs exactly the one time it mattered.

**Keyboard placement follows pick-up / move / drop**, not bare arrows moving things.
Arrows have to stay free to walk between cards; that is what a keyboard user expects a
list to do.

**Item renaming moved twice** — onto the card when there was no panel, then off it again
once the panel existed. The round trip was the right call both times.

---

## Risks, and how they landed

| Risk | Outcome |
|---|---|
| `file://` origin restrictions on IndexedDB | Probed once at boot behind a timeout, since some contexts neither resolve nor reject. Failure degrades to export-only with a visible banner. Verified working from `file://` in Firefox. |
| Hand-rolled ZIP reading foreign archives | Reader parses the central directory and trusts each local header's own lengths. Not yet tested against archives from an external tool — the most likely remaining gap. |
| Large image sets producing huge exports | Anything over 1024px on its longest edge is re-encoded to WebP on upload. GIFs bypass it so animation survives. A running archive-size indicator was never built. |
| Two drag systems interfering | One engine with a `kind` flag and a single active-drag guard; the two cannot run at once. |
| Growing into one unmaintainable file | Eleven banner-commented sections: constants, state, DOM helpers, actions, render, dragging, archive, storage, keyboard, events, boot. |

---

## Testing

`smoke.js` runs the real script out of the HTML against a stubbed browser — see the
README. It covers logic, not pixels, and the fakes approximate their originals most
loosely around IndexedDB transaction lifetime. Compression is a known blind spot: GJS has
no `CompressionStream`, so the deflate path is only ever exercised in a real browser.
