# Tierlist

A tier list maker in a single HTML file. No build step, no server, no dependencies —
download `tierlist.html`, open it in a browser, and it works, including offline.

Lists save as a `.tierlist` file that bundles the configuration and every uploaded
image together, so the exact same list opens on another machine.

## Getting started

1. Download [`tierlist.html`](tierlist.html).
2. Open it — double-click, or drag it into a browser window.

That's the whole installation. The page never contacts the network.

## What it does

- **Tiers** — add, remove, rename, recolour, and reorder rows. Deleting a tier returns
  its items to the unassigned pool rather than destroying them.
- **Items** — drag between tiers and the pool, or reorder within a row. Every item has
  a name, a short description shown on its card, and a long description.
- **Images** — an item's card can carry a picture instead of text. Choose a file, drop
  one in from your desktop, or paste from the clipboard. Large images are scaled down
  and re-encoded to WebP so archives stay a sensible size; GIFs are left alone so their
  animation survives.
- **Details panel** — click any card to open it on the right, where everything about
  that item is edited.
- **Autosave** — the session is kept in the browser and restored when you return.
- **Save / Open** — export the whole list as a `.tierlist` file and open it anywhere.
- **PNG** — a picture of the ranking, for sharing. One-way; it cannot be opened back up.
- **Undo/redo** — `Ctrl+Z` and `Ctrl+Shift+Z` (or `Ctrl+Y`), over everything.

## Keyboard

Every drag has a keyboard equivalent. Cards and tier handles are reachable by `Tab`.

| Key | On a card | On a tier handle (⠿) |
|---|---|---|
| `←` `→` `↑` `↓` | Move focus between cards | — |
| `Space` | Pick up / put down | Pick up / put down |
| `←` `→` | *(while held)* move within the row | — |
| `↑` `↓` | *(while held)* move between tiers | *(while held)* reorder the row |
| `Enter` | Open the details panel | Pick up |
| `Escape` | Cancel the move, or close the panel | Cancel the move |

Moves are announced through a live region, and undo covers them like any other change.

## The `.tierlist` format

A `.tierlist` file is an ordinary ZIP archive. Rename it to `.zip` and any archiver will
open it:

```
my-list.tierlist
├── tierlist.json     the whole configuration, schema-versioned
└── images/
    ├── img_9f2c4a.webp
    └── img_be71d0.png
```

`tierlist.json` refers to images by their exact path inside the archive, so the mapping
between an item and its picture is explicit rather than positional. Nothing is encoded
into the JSON as base64 — the image files are the real bytes.

Opening a file repairs what it can rather than refusing: duplicate placements,
references to items that no longer exist, items belonging to no list, and images the
archive is missing are all fixed, and the repairs are reported. Only a missing or
unreadable manifest, or a file saved by a newer version, is refused outright — and a
refusal never disturbs the list already open.

## Where your data lives

Everything stays on your machine. The session autosaves to IndexedDB under the page's
own origin; nothing is uploaded anywhere.

Some browsers refuse persistent storage to pages opened directly from disk over
`file://`. If that happens the app says so in a banner and keeps working — you just need
to use **Save** to keep your work, and closing the tab will warn you first. Serving the
file over `http://localhost` avoids the restriction entirely if your browser is strict:

```sh
python3 -m http.server
```

## Browser support

Any current version of Chrome, Firefox, or Safari. Two capabilities degrade gracefully
rather than breaking:

- **`CompressionStream`** — used to deflate the manifest. Without it, archives are
  written uncompressed, which is still a valid ZIP that this app and any archiver can
  read.
- **IndexedDB** — used for autosave. Without it, the app is export-only and says so.

## Development

`tierlist.html` is the entire application: markup, styles, and script in one file, split
into numbered sections — constants, state, DOM helpers, actions, render, dragging,
archive, storage, keyboard, events, boot. Every mutation goes through a single
`commit()`, which is what makes undo and autosave possible without touching each call
site.

`ROADMAP.md` records the plan the app was built to, including the decisions that changed
along the way and why.

### Tests

There is no build step and no test framework, so the harness supplies a browser instead
— a minimal DOM with fake geometry, a fake IndexedDB, and stand-ins for `Blob`, canvas,
image decoding and object URLs. It loads the real `<script>` out of the HTML and runs it.

```sh
gjs smoke.js                       # from this directory
gjs smoke.js path/to/tierlist.html # from anywhere
```

350 assertions covering state transitions, the drag engine's insertion maths, panel
editing, the image pipeline, ZIP round-trips, import repair, persistence, undo, and
keyboard placement. Every object URL minted and revoked is tracked, so a leak fails the
run.

It cannot cover CSS, layout, animation, or actual pixels, and the fakes only approximate
their real counterparts. A pass means the logic holds — not that the app looks right.
The harness asserts on DOM structure and internal function names, so it needs updating
alongside changes to the app's shape.

## Licence

None specified yet.
