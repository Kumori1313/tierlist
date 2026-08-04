// Behaviour tests for tierlist.html.
//
//   gjs smoke.js [path/to/tierlist.html]
//
// The stubbed browser these run against lives in harness.js; see that file for
// what is and is not simulated. Archives written by other tools are covered
// separately by ziptest.js.
//
// What this covers: state transitions, the drag engine's insertion maths and
// commit path, panel editing, the image pipeline's branching, ZIP round-trips,
// import repair, persistence, undo, keyboard placement, and object-URL
// lifetime — every mint and revoke is tracked, so leaks fail the run.
//
// What it cannot cover: CSS, real layout, animation, actual pixels. A pass
// means the logic holds, not that the app looks or feels right.

const GLib = imports.gi.GLib;

imports.searchPath.unshift(GLib.path_get_dirname(
  GLib.canonicalize_filename(imports.system.programInvocationName, null)));

const TARGET = (typeof ARGV !== "undefined" && ARGV[0])
  ? ARGV[0]
  : GLib.build_filenamev([GLib.get_current_dir(), "tierlist.html"]);

if (!GLib.file_test(TARGET, GLib.FileTest.EXISTS)) {
  print("Cannot find " + TARGET + " — run this from the project directory, " +
        "or pass the path to tierlist.html as an argument.");
  imports.system.exit(1);
}

const env = imports.harness.Harness.create(TARGET);
const {
  api, state: s, Node, shell, boardScroll, tiersEl, poolDrop, panel, main, liveEl,
  check, integrity, run,
  layout, zoneOf, cardFor, drag, dragTier, gesture,
  tick, fireTimers, fireWindow, settle,
  fakeFile, fileWithBytes, downloads, canvas,
  urlsMinted, urlsRevoked,
  CARD, ZONE_L,
} = env;

/* --- phase 0 / 1 ---------------------------------------------------------- */

check("5 seed tiers", s.tiers.length === 5);
check("tier colour reached the label as a custom property",
  tiersEl.children[0].children[0].style._custom["--tier-color"] === "#ff7f7f");
check("toolbar has its six actions",
  shell["#toolbar"].children.filter(c => c.tagName === "button").length === 6);
check("temporary move control is gone", boardScroll.querySelectorAll(".item-move").length === 0);

const ids = [];
for (let i = 0; i < 5; i++) ids.push(api.addItem());
check("5 items in the pool", s.pool.length === 5);
check("card has body + name", poolDrop.find("item-body") && poolDrop.find("item-name"));

check("cards no longer rename inline", poolDrop.find("item-name")._class === "item-name");

// tier rename + recolour + add
const tierName = tiersEl.children[0].find("tier-name");
tierName.fire("click");
const tInput = tierName.children[0];
tInput.value = "SS";
tInput.fire("keydown", { key: "Enter" });
check("tier renamed", s.tiers[0].name === "SS");
tiersEl.children[0].find("tier-color").fire("change", { target: { value: "#123456" } });
check("tier recoloured", s.tiers[0].color === "#123456");

/* --- phase 2: dragging ---------------------------------------------------- */

layout();

// pool -> tier S, dropped past every card (empty tier: straight in)
drag(ids[0], [[300, 105], [400, 130]]);
check("dropped into tier S", s.tiers[0].items.length === 1 && s.tiers[0].items[0] === ids[0]);
check("removed from the pool", !s.pool.includes(ids[0]) && s.pool.length === 4);
integrity("integrity after cross-zone drop");

// three more into S so ordering can be tested
layout();
drag(ids[1], [[300, 105], [600, 130]]);
layout();
drag(ids[2], [[300, 105], [600, 130]]);
layout();
check("S holds 3 in drop order", JSON.stringify(s.tiers[0].items) === JSON.stringify([ids[0], ids[1], ids[2]]));

// reorder within a zone: drag the 3rd card left past the 1st card's midpoint
const zoneS = zoneOf(0);
const firstRect = zoneS.children.filter(c => c.classList.contains("item"))[0]._rect;
drag(ids[2], [[firstRect.left + 20, firstRect.top + 40], [firstRect.left + 5, firstRect.top + 40]]);
check("reordered to the front",
  JSON.stringify(s.tiers[0].items) === JSON.stringify([ids[2], ids[0], ids[1]]));
integrity("integrity after same-zone reorder");

// insertion midpoint: just right of a card's centre lands after it
layout();
const rects = zoneOf(0).children.filter(c => c.classList.contains("item")).map(c => c._rect);
drag(ids[2], [[rects[1].left + 20, rects[1].top + 40],
              [rects[1].left + CARD / 2 + 4, rects[1].top + 40]]);
check("lands after the card whose midpoint was passed",
  JSON.stringify(s.tiers[0].items) === JSON.stringify([ids[0], ids[2], ids[1]]));

// second row: a pointer below row 1 appends past it
layout();
drag(ids[3], [[300, 105], [ZONE_L + 20, zoneOf(0)._rect.bottom - 4]]);
check("4 items in S", s.tiers[0].items.length === 4);
integrity("integrity after wrap-row drop");

// escape cancels, state untouched
layout();
const before = JSON.stringify(s.tiers.map(t => t.items));
drag(ids[0], [[300, 130], [700, 320]], { escape: true });
check("escape left state untouched", JSON.stringify(s.tiers.map(t => t.items)) === before);
check("no drag left running", api.runtime.drag === null);
check("ghost removed", shell["#drag-layer"].children.length === 0);
check("placeholder class cleared",
  boardScroll.querySelectorAll(".is-placeholder").length === 0);

// below the threshold is a click, not a drag
layout();
const quiet = JSON.stringify(s.tiers.map(t => t.items));
drag(ids[0], [[cardFor(ids[0])._rect.left + 22, cardFor(ids[0])._rect.top + 21]]);
check("3px of travel does not start a drag", api.runtime.drag === null);
check("...and changes nothing", JSON.stringify(s.tiers.map(t => t.items)) === quiet);

// drop outside every zone keeps the last previewed position
layout();
drag(ids[0], [[300, 130], [ZONE_L + 20, zoneOf(2)._rect.top + 40], [1150, 40]]);
check("release outside a zone keeps the last preview", s.tiers[2].items.includes(ids[0]));
integrity("integrity after out-of-bounds release");

// dragging the only card out of a tier
layout();
check("C holds exactly one", s.tiers[2].items.length === 1);
drag(ids[0], [[300, 130], [ZONE_L + 20, zoneOf(4)._rect.top + 40]]);
check("C emptied", s.tiers[2].items.length === 0);
check("E received it", s.tiers[4].items.includes(ids[0]));
check("emptied zone re-renders its hint", zoneOf(2).find("empty-hint") !== null);
integrity("integrity after emptying a tier");

// dragging back into the pool
layout();
drag(ids[0], [[300, 130], [ZONE_L + 20, poolDrop._rect.top + 40]]);
check("returned to the pool", s.pool.includes(ids[0]));
integrity("integrity after drop into the pool");

// drop-target highlight does not linger
check("no zone left highlighted",
  boardScroll.querySelectorAll(".is-drop-target").length === 0);

/* --- phase 3: tier reordering --------------------------------------------- */

layout();
const order = () => s.tiers.map(t => t.id).join("|");
const seq = (...i) => i.map(n => before3[n]).join("|");
const before3 = s.tiers.map(t => t.id);
check("known starting order", before3.length === 5);

// drag the top row down past the midpoint of the third
const thirdMid = tiersEl.children[2]._rect.top + tiersEl.children[2]._rect.height / 2 + 4;
dragTier(0, [[40, 140], [40, thirdMid]]);
check("row moved down two places", order() === seq(1, 2, 0, 3, 4));
check("still 5 tiers", s.tiers.length === 5);
integrity("integrity after tier reorder");

// and back up again
layout();
const nowIds = s.tiers.map(t => t.id);
dragTier(2, [[40, tiersEl.children[2]._rect.top + 20], [40, 105]]);
check("row moved back to the top",
  order() === [nowIds[2], nowIds[0], nowIds[1], nowIds[3], nowIds[4]].join("|"));

// items ride along with their row
layout();
const carrier = s.tiers.findIndex(t => t.items.length > 0);
if (carrier >= 0) {
  const carried = [...s.tiers[carrier].items];
  const carriedName = s.tiers[carrier].name;
  dragTier(carrier, [[40, tiersEl.children[carrier]._rect.top + 20],
                     [40, tiersEl.children[4]._rect.bottom - 4]]);
  const moved = s.tiers.find(t => t.name === carriedName);
  check("a reordered row keeps its items",
    JSON.stringify(moved.items) === JSON.stringify(carried));
}
integrity("integrity after moving a populated row");

// escape aborts a tier drag
layout();
const beforeEsc = order();
dragTier(0, [[40, 140], [40, 600]], { escape: true });
check("escape left the tier order untouched", order() === beforeEsc);
check("no tier placeholder left behind",
  tiersEl.querySelectorAll(".is-placeholder").length === 0);
check("ghost cleaned up", shell["#drag-layer"].children.length === 0);

// the pool is not a tier and cannot be reordered into #tiers
layout();
const tierCount = s.tiers.length;
dragTier(0, [[40, 140], [40, poolDrop._rect.top + 20]]);
check("dragging a row past the pool keeps the count", s.tiers.length === tierCount);
check("pool is still not a tier", tiersEl.children.length === tierCount);
integrity("integrity after dragging a row past the pool");

// dragging a card must not be confused for dragging its row
layout();
const orderBeforeCard = order();
const anyItem = s.tiers.flatMap(t => t.items)[0] || s.pool[0];
drag(anyItem, [[300, 130], [ZONE_L + 20, zoneOf(1)._rect.top + 20]]);
check("card drag left the tier order alone", order() === orderBeforeCard);

/* --- touch: long press ----------------------------------------------------- */

layout();
const touchTarget = s.pool[0] || s.tiers.flatMap(t => t.items)[0];
const touchBefore = JSON.stringify(s.tiers.map(t => t.items));

// moving before the hold completes is a scroll, not a drag
const tCard = cardFor(touchTarget);
api.onBoardPointerDown({
  target: tCard, pointerType: "touch", button: 0, pointerId: 1,
  clientX: tCard._rect.left + 20, clientY: tCard._rect.top + 20,
});
fireWindow("pointermove", {
  pointerId: 1, clientX: tCard._rect.left + 20, clientY: tCard._rect.top + 60,
  preventDefault() {}, target: tCard,
});
check("touch move before the hold does not start a drag", api.runtime.drag === null);
check("...and abandons the pending press", api.runtime.pendingDrag === null);
fireTimers();
check("...so the timer cannot fire late", api.runtime.drag === null);
check("...and nothing moved", JSON.stringify(s.tiers.map(t => t.items)) === touchBefore);

// holding still first does start one
layout();
drag(touchTarget, [[ZONE_L + 20, zoneOf(3)._rect.top + 20]], { pointerType: "touch" });
check("long press then move drops the item", s.tiers[3].items.includes(touchTarget));
integrity("integrity after a touch drag");

// a tier row by long press too
layout();
const beforeTouchTier = order();
dragTier(0, [[40, 140], [40, tiersEl.children[2]._rect.top +
  tiersEl.children[2]._rect.height / 2 + 4]], { pointerType: "touch" });
check("long press reorders a row too", order() !== beforeTouchTier);
integrity("integrity after a touch tier drag");


/* --- phase 4: detail panel ------------------------------------------------ */

const panelBody = shell["#panel-body"];
const field = cls => panelBody.querySelectorAll("." + cls)[0];

check("panel starts closed", panel.attrs["aria-hidden"] === "true");

// clicking a card opens it
layout();
const subject = s.pool[0] || s.tiers.flatMap(t => t.items)[0];
cardFor(subject).fire("click", { target: cardFor(subject) });
check("card click opened the panel", api.runtime.panelOpen === true);
check("panel is showing that item", api.runtime.selectedItemId === subject);
check("aria-hidden flipped", panel.attrs["aria-hidden"] === "false");
check("main got the panel-open class", main._class.includes("panel-open"));
check("focus moved into the panel", document.activeElement === panelBody);
check("the card is marked selected", cardFor(subject)._class.includes("is-selected"));
check("exactly one card is selected",
  boardScroll.querySelectorAll(".is-selected").length === 1);

// the fields are populated
check("title field carries the name", field("panel-title").attrs.value === s.items[subject].name);
check("short field present", field("panel-short") !== undefined);
check("description field present", field("panel-desc") !== undefined);
check("footer shows where the item lives", panelBody.find("panel-where") !== null);

// typing edits state without rebuilding the board
const titleEl = field("panel-title");
const cardBefore = cardFor(subject);
titleEl.value = "Edited in the panel";
titleEl.fire("input", { target: titleEl });
check("typing updated state", s.items[subject].name === "Edited in the panel");
check("...without re-rendering the board", cardFor(subject) === cardBefore);
check("...and without rebuilding the panel", field("panel-title") === titleEl);

// the card catches up once typing pauses
fireTimers();
const cardAfter = cardFor(subject);
check("debounced refresh replaced just that card", cardAfter !== cardBefore);
check("card shows the new name", cardAfter.find("item-name")._text === "Edited in the panel");
check("refreshed card kept its selected outline", cardAfter._class.includes("is-selected"));

// short + long descriptions
const shortEl = field("panel-short");
shortEl.value = "brief";
shortEl.fire("input", { target: shortEl });
const descEl = field("panel-desc");
descEl.value = "the long version";
descEl.fire("input", { target: descEl });
check("short description stored", s.items[subject].shortText === "brief");
check("description stored", s.items[subject].description === "the long version");
fireTimers();
check("card body shows the short description",
  cardFor(subject).find("item-body")._text === null &&
  cardFor(subject).find("item-body").children[0]._text === "brief");
check("card body no longer marked empty",
  !cardFor(subject).find("item-body")._class.includes("is-empty"));

// switching items swaps contents in place
layout();
const other = s.pool.find(id => id !== subject) || s.tiers.flatMap(t => t.items).find(id => id !== subject);
cardFor(other).fire("click", { target: cardFor(other) });
check("panel stayed open", api.runtime.panelOpen === true);
check("panel swapped to the other item", api.runtime.selectedItemId === other);
check("selection followed", cardFor(other)._class.includes("is-selected"));
check("previous card deselected", !cardFor(subject)._class.includes("is-selected"));
check("still exactly one selection",
  boardScroll.querySelectorAll(".is-selected").length === 1);

// clicking the item's tools must not open the panel
layout();
const toolsCard = cardFor(subject);
toolsCard.fire("click", { target: toolsCard.find("item-del") });
check("clicking a card control does not hijack the panel",
  api.runtime.selectedItemId === other);
api.clearPendingDelete();

// closing
layout();
api.closePanel();
check("panel closed", api.runtime.panelOpen === false);
check("aria-hidden restored", panel.attrs["aria-hidden"] === "true");
check("no card left selected", boardScroll.querySelectorAll(".is-selected").length === 0);
check("focus returned to the originating card", document.activeElement === cardFor(other));

// deleting from the panel closes it in one pass
layout();
const victim = s.pool[0] || s.tiers.flatMap(t => t.items)[0];
api.openPanel(victim);
panelBody.find("panel-delete").fire("click");
check("first click arms", api.runtime.pendingDelete === "item:" + victim);
check("panel still open while armed", api.runtime.panelOpen === true);
panelBody.find("panel-delete").fire("click");
check("second click deleted the item", s.items[victim] === undefined);
check("panel closed with it", api.runtime.panelOpen === false);
check("selection cleared", api.runtime.selectedItemId === null);
integrity("integrity after deleting from the panel");

// a dragged card must not also open the panel
layout();
const dragged = s.tiers.flatMap(t => t.items)[0] || s.pool[0];
check("panel is closed before the drag", api.runtime.panelOpen === false);
drag(dragged, [[300, 130], [ZONE_L + 20, poolDrop._rect.top + 20]]);
check("dragging did not open the panel", api.runtime.panelOpen === false);
integrity("integrity after drag with the panel closed");

// a stale selection cannot leave the panel showing a ghost
api.openPanel(dragged);
check("open on a live item", api.runtime.panelOpen === true);
api.deleteItem(dragged);
check("deleting the shown item closes the panel", api.runtime.panelOpen === false);
check("panel body emptied", panelBody.children.length === 0);


/* --- deletes still work --------------------------------------------------- */

api.armDelete("tier:" + s.tiers[0].id);
check("armed tier shows confirm UI", tiersEl.children[0].find("confirm-msg") !== null);
const held = s.tiers[0].items.length;
const pooled = s.pool.length;
tiersEl.children[0].find("confirm-row").children[0].fire("click");
check("tier deleted", s.tiers.length === 4);
check("its items fell back to the pool", s.pool.length === pooled + held);
integrity("integrity after tier delete");

const doomed = s.pool[0] || s.tiers.flatMap(t => t.items)[0];
api.armDelete("item:" + doomed);
const armed = cardFor(doomed);
check("the armed card shows its confirm state",
  armed.find("item-del")._class.includes("confirming"));
armed.find("item-del").fire("click");
check("item deleted", s.items[doomed] === undefined && api.locateItem(doomed) === null);
integrity("integrity after item delete");


/* ========================================================================== */
/* phase 5: images — async, so it runs inside a main loop                     */
/* ========================================================================== */

async function phase5() {
  // Images stay reachable while undo can still restore a reference to them,
  // so freeing is only observable once history is out of the way.
  const collect = () => { api.clearHistory(); api.collectImages(); };

  const panelBody = shell["#panel-body"];
  const field = cls => panelBody.querySelectorAll("." + cls)[0];

  const subject = api.addItem();
  api.openPanel(subject);

  check("panel starts in text mode", s.items[subject].shortType === "text");
  check("mode switch rendered", panelBody.querySelectorAll(".seg").length === 2);
  check("text mode shows the textarea", field("panel-short") !== undefined);
  check("...and no image editor", field("image-editor") === undefined);

  // give the item some text first, to prove switching does not destroy it
  const shortEl = field("panel-short");
  shortEl.value = "kept text";
  shortEl.fire("input", { target: shortEl });
  check("short text stored", s.items[subject].shortText === "kept text");

  // switch to image mode
  panelBody.querySelectorAll(".seg")[1].fire("click");
  check("switched to image mode", s.items[subject].shortType === "image");
  check("image editor rendered", field("image-editor") !== undefined);
  check("textarea gone", field("panel-short") === undefined);
  check("switching kept the text in state", s.items[subject].shortText === "kept text");
  check("card shows the no-image state",
    cardFor(subject).find("item-body")._class.includes("is-empty"));

  // attach a small image: no downscale
  canvas.last = null;
  await api.attachImage(subject, fakeFile("holiday.png", "image/png", { w: 400, h: 300 }));
  const path = s.items[subject].image;
  check("item now points at an archive path", typeof path === "string" && path.startsWith("images/"));
  check("path keeps the source extension", path.endsWith(".png"));
  check("bytes registered at that same path", api.runtime.images.has(path));
  check("manifest entry written", s.images[path] !== undefined);
  check("original filename preserved", s.images[path].filename === "holiday.png");
  check("dimensions recorded", s.images[path].width === 400 && s.images[path].height === 300);
  check("a small image is not re-encoded", canvas.last === null);
  check("state holds no bytes", s.images[path].blob === undefined);

  // the card renders it
  const card = cardFor(subject);
  check("card marked has-image", card._class.includes("has-image"));
  const img = card.find("item-img");
  check("card renders an img", img !== null);
  check("...from the object URL", img.attrs.src === api.runtime.images.get(path).url);
  check("name still rendered over it", card.find("item-name") !== null);

  // panel preview + actions
  check("panel shows a preview", panelBody.find("image-preview") !== null);
  check("panel offers replace/remove", panelBody.find("image-actions") !== null);
  check("panel reports size", panelBody.find("image-meta")._text.includes("400×300"));

  // switching back to text is non-destructive both ways
  panelBody.querySelectorAll(".seg")[0].fire("click");
  check("back in text mode", s.items[subject].shortType === "text");
  check("image reference retained", s.items[subject].image === path);
  check("bytes retained", api.runtime.images.has(path));
  check("card shows the text again", cardFor(subject).find("item-body").children[0]._text === "kept text");
  check("card no longer has-image", !cardFor(subject)._class.includes("has-image"));

  panelBody.querySelectorAll(".seg")[1].fire("click");
  check("returning to image mode shows it again", cardFor(subject)._class.includes("has-image"));

  // replacing: the old bytes stay reachable while undo can still want them
  const oldUrl = api.runtime.images.get(path).url;
  await api.attachImage(subject, fakeFile("second.jpg", "image/jpeg", { w: 200, h: 200 }));
  const newPath = s.items[subject].image;
  check("replacement got a new path", newPath !== path);
  check("new bytes live", api.runtime.images.has(newPath));
  check("the replaced image is held for undo", api.runtime.images.has(path));
  check("...and not yet revoked", !urlsRevoked.has(oldUrl));

  collect();
  check("old bytes released once undo can no longer reach them",
    !api.runtime.images.has(path));
  check("old manifest entry dropped", s.images[path] === undefined);
  check("old object URL revoked", urlsRevoked.has(oldUrl));

  // oversized images are downscaled and re-encoded to webp
  canvas.last = null;
  await api.attachImage(subject, fakeFile("huge.png", "image/png", { w: 4000, h: 2000 }));
  const bigPath = s.items[subject].image;
  check("oversized image was re-encoded", canvas.last !== null);
  check("longest edge clamped to 1024", s.images[bigPath].width === 1024);
  check("aspect ratio preserved", s.images[bigPath].height === 512);
  check("re-encoded as webp", s.images[bigPath].mime === "image/webp");
  check("stored under a .webp path", bigPath.endsWith(".webp"));
  check("original filename still recorded", s.images[bigPath].filename === "huge.png");

  // animated GIFs bypass the canvas so the animation survives
  canvas.last = null;
  await api.attachImage(subject, fakeFile("dance.gif", "image/gif", { w: 3000, h: 3000 }));
  check("a large GIF is passed through untouched", canvas.last === null);
  check("GIF keeps its full size", s.images[s.items[subject].image].width === 3000);
  check("GIF keeps its type", s.images[s.items[subject].image].mime === "image/gif");

  // rejection path
  const before = s.items[subject].image;
  await api.attachImage(subject, fakeFile("notes.pdf", "application/pdf"));
  check("non-image rejected", s.items[subject].image === before);
  check("error surfaced in the panel", typeof api.runtime.panelError === "string");
  check("error mentions the accepted formats", api.runtime.panelError.includes("PNG"));
  check("error rendered", panelBody.find("panel-error") !== null);

  // unreadable image
  const broken = fakeFile("corrupt.png", "image/png");
  broken._broken = true;
  await api.attachImage(subject, broken);
  check("undecodable image rejected", s.items[subject].image === before);
  check("...with its own message", api.runtime.panelError.includes("corrupt"));

  // removing reverts to text
  const liveUrl = api.runtime.images.get(before).url;
  api.removeImage(subject);
  check("removal reverted to text mode", s.items[subject].shortType === "text");
  check("image reference cleared", s.items[subject].image === null);
  check("bytes held while the removal is undoable", api.runtime.images.has(before));
  collect();
  check("bytes freed once it is not", !api.runtime.images.has(before));
  check("URL revoked on removal", urlsRevoked.has(liveUrl));
  check("text came back on the card",
    cardFor(subject).find("item-body").children[0]._text === "kept text");

  // deleting an item with an image frees it
  const doomed = api.addItem();
  api.openPanel(doomed);
  await api.attachImage(doomed, fakeFile("bye.png", "image/png"));
  const doomedPath = s.items[doomed].image;
  const doomedUrl = api.runtime.images.get(doomedPath).url;
  api.deleteItem(doomed);
  collect();
  check("deleting the item freed its bytes", !api.runtime.images.has(doomedPath));
  check("...and revoked its URL", urlsRevoked.has(doomedUrl));
  check("...and dropped it from the manifest", s.images[doomedPath] === undefined);

  // two items sharing one path must not free it out from under each other
  const a = api.addItem();
  const b = api.addItem();
  api.openPanel(a);
  await api.attachImage(a, fakeFile("shared.png", "image/png"));
  const sharedPath = s.items[a].image;
  s.items[b].image = sharedPath;
  s.items[b].shortType = "image";
  api.deleteItem(a);
  collect();
  check("a still-referenced image survives its other owner",
    api.runtime.images.has(sharedPath));
  check("...and stays in the manifest", s.images[sharedPath] !== undefined);
  api.deleteItem(b);
  collect();
  check("...and is freed once the last owner goes",
    !api.runtime.images.has(sharedPath));

  // the exit criterion: nothing minted is left dangling
  const live = new Set([...api.runtime.images.values()].map(e => e.url));
  const leaked = [...urlsMinted].filter(u => !urlsRevoked.has(u) && !live.has(u));
  check("no object URL leaked (" + urlsMinted.size + " minted, " +
        urlsRevoked.size + " revoked, " + live.size + " live)", leaked.length === 0);

  integrity("integrity after the image phase");
}


/* ========================================================================== */
/* phase 6: export and import                                                 */
/* ========================================================================== */

async function phase6() {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* --- the ZIP layer in isolation ---------------------------------------- */

  check("crc32 matches the known IEEE vector for \"123456789\"",
    api.crc32(enc.encode("123456789")) === 0xcbf43926);
  check("crc32 of empty input is 0", api.crc32(new Uint8Array(0)) === 0);

  const payload = enc.encode("hello archive");
  const zipBytes = await api.buildZip([
    { name: "a.txt", data: payload, compress: false },
    { name: "nested/b.bin", data: new Uint8Array([1, 2, 3, 250]), compress: false },
  ]);

  check("archive starts with the local file signature",
    new DataView(zipBytes.buffer).getUint32(0, true) === 0x04034b50);

  const back = api.readZip(zipBytes);
  check("both entries found", back.size === 2);
  check("names survived", back.has("a.txt") && back.has("nested/b.bin"));
  check("stored when compression is unavailable", back.get("a.txt").method === 0);
  check("content round-tripped", dec.decode(await api.unpack(back.get("a.txt"))) === "hello archive");
  const binary = await api.unpack(back.get("nested/b.bin"));
  check("binary content round-tripped",
    binary.length === 4 && binary[3] === 250 && binary[0] === 1);
  check("uncompressed size recorded", back.get("a.txt").size === payload.length);

  // a trailing comment must not defeat the EOCD scan
  const commented = new Uint8Array(zipBytes.length + 5);
  commented.set(zipBytes, 0);
  new DataView(commented.buffer).setUint16(zipBytes.length - 2, 5, true);
  commented.set(enc.encode("hello"), zipBytes.length);
  check("EOCD found past a trailing comment", api.readZip(commented).size === 2);

  // garbage is rejected, not misread
  let threw = null;
  try { api.readZip(enc.encode("this is definitely not a zip file at all")); }
  catch (e) { threw = e.message; }
  check("non-ZIP input is rejected", threw !== null && threw.includes("not a ZIP"));

  /* --- a real document round trip ----------------------------------------- */

  // build something with structure worth preserving
  api.installDocument(
    { schema: 1, app: "tierlist", title: "Round Trip", createdAt: "x", modifiedAt: "y",
      tiers: [], pool: [], items: {}, images: {} }, new Map());
  s.tiers = [
    { id: "t_a", name: "Best", color: "#ff0000", items: [] },
    { id: "t_b", name: "Worst", color: "#00ff00", items: [] },
  ];
  const withText = api.addItem();
  const withImage = api.addItem();
  const inPool = api.addItem();
  s.items[withText].name = "Text item";
  s.items[withText].shortText = "on the card";
  s.items[withText].description = "the long story";
  s.items[withImage].name = "Picture item";
  s.pool = [inPool];
  s.tiers[0].items = [withText];
  s.tiers[1].items = [withImage];
  s.title = "Round Trip";

  api.openPanel(withImage);
  await api.attachImage(withImage, fakeFile("cover.png", "image/png", { w: 640, h: 480 }));
  const imagePath = s.items[withImage].image;
  const originalBytes = api.runtime.images.get(imagePath).blob._bytes;

  // an image kept by a text-mode item must still be written
  api.setShortType(withImage, "text");
  api.setShortType(withImage, "image");

  const archive = await api.buildArchiveBytes();
  const contents = api.readZip(archive);
  check("archive contains the manifest", contents.has("tierlist.json"));
  check("archive contains the image at its manifest path", contents.has(imagePath));
  check("archive holds exactly manifest + image", contents.size === 2);

  const manifest = JSON.parse(dec.decode(await api.unpack(contents.get("tierlist.json"))));
  check("manifest is schema 1", manifest.schema === 1);
  check("manifest names the app", manifest.app === "tierlist");
  check("manifest carries the title", manifest.title === "Round Trip");
  check("manifest points the item at the archive path", manifest.items[withImage].image === imagePath);
  check("manifest describes that image", manifest.images[imagePath].filename === "cover.png");
  check("manifest carries no bytes", manifest.images[imagePath].blob === undefined);

  // now read it back into a blank app
  const file = fileWithBytes("round-trip.tierlist", archive);
  await api.importList(file);

  check("title restored", s.title === "Round Trip");
  check("tier order restored", s.tiers.map(t => t.name).join(",") === "Best,Worst");
  check("tier colours restored", s.tiers[0].color === "#ff0000");
  check("placements restored",
    s.tiers[0].items.length === 1 && s.tiers[1].items.length === 1 && s.pool.length === 1);
  check("item names restored", s.items[withText].name === "Text item");
  check("short text restored", s.items[withText].shortText === "on the card");
  check("long description restored", s.items[withText].description === "the long story");
  check("image mode restored", s.items[withImage].shortType === "image");
  check("image path restored", s.items[withImage].image === imagePath);
  check("image bytes are back", api.runtime.images.has(imagePath));

  const restored = api.runtime.images.get(imagePath).blob._bytes;
  check("image bytes are byte-for-byte identical",
    restored.length === originalBytes.length &&
    restored.every((b, i) => b === originalBytes[i]));
  check("image metadata restored",
    s.images[imagePath].width === 640 && s.images[imagePath].filename === "cover.png");
  check("the card renders the reloaded image",
    cardFor(withImage) !== null && cardFor(withImage)._class.includes("has-image"));
  check("import cleared the dirty flag", api.runtime.dirty === false);
  check("a clean import reports no repairs",
    api.runtime.banner !== null && api.runtime.banner.tone === "info");

  /* --- damaged archives are repaired, not rejected ------------------------ */

  const damaged = {
    schema: 1, app: "tierlist", title: "Damaged",
    tiers: [
      { id: "d1", name: "A", color: "#fff", items: ["keep", "keep", "ghost"] },
      { name: "No id", color: "#eee", items: [] },
      "not a tier",
    ],
    pool: ["keep"],
    items: {
      keep: { name: "Kept", shortType: "text", shortText: "x" },
      stranded: { name: "Stranded", shortType: "text" },
      pictured: { name: "Pictured", shortType: "image", image: "images/gone.png" },
    },
    images: { "images/gone.png": { filename: "gone.png", mime: "image/png" },
              "images/unused.png": { filename: "unused.png", mime: "image/png" } },
  };
  const damagedZip = await api.buildZip([
    { name: "tierlist.json", data: enc.encode(JSON.stringify(damaged)), compress: false },
  ]);
  await api.importList(fileWithBytes("damaged.tierlist", damagedZip));

  check("damaged archive still loaded", s.title === "Damaged");
  check("duplicate placement removed", s.tiers[0].items.filter(id => id === "keep").length === 1);
  check("item appears in exactly one list",
    [...s.tiers.flatMap(t => t.items), ...s.pool].filter(id => id === "keep").length === 1);
  check("reference to a missing item dropped", !s.tiers[0].items.includes("ghost"));
  check("unplaced item parked in the pool", s.pool.includes("stranded"));
  check("malformed tier entries skipped", s.tiers.length === 2);
  check("tier without an id was given one", typeof s.tiers[1].id === "string" && s.tiers[1].id.length > 0);
  check("item with a missing image fell back to text",
    s.items.pictured.shortType === "text" && s.items.pictured.image === null);
  check("unused image dropped from the manifest", s.images["images/unused.png"] === undefined);
  check("repairs were reported", api.runtime.banner.tone === "warn");
  check("...naming the missing image", api.runtime.banner.text.includes("missing"));
  check("...and the duplicate", api.runtime.banner.text.includes("duplicate"));
  integrity("integrity after importing a damaged archive");

  /* --- refusals ----------------------------------------------------------- */

  const futureZip = await api.buildZip([
    { name: "tierlist.json", data: enc.encode(JSON.stringify({ schema: 99 })), compress: false },
  ]);
  await api.importList(fileWithBytes("future.tierlist", futureZip));
  check("a newer schema is refused", api.runtime.banner.text.includes("newer version"));
  check("...leaving the current list alone", s.title === "Damaged");

  const noManifest = await api.buildZip([
    { name: "readme.txt", data: enc.encode("nope"), compress: false },
  ]);
  await api.importList(fileWithBytes("bare.tierlist", noManifest));
  check("an archive without a manifest is refused",
    api.runtime.banner.text.includes("not a tier list"));

  const badJson = await api.buildZip([
    { name: "tierlist.json", data: enc.encode("{ definitely not json"), compress: false },
  ]);
  await api.importList(fileWithBytes("broken.tierlist", badJson));
  check("unparseable JSON is refused", api.runtime.banner.text.includes("not valid JSON"));
  check("...and is the only fatal manifest error", s.title === "Damaged");

  /* --- unsaved-work confirmation ------------------------------------------ */

  api.addItem();                     // makes the document dirty
  check("editing marks the document dirty", api.runtime.dirty === true);
  api.requestImport(fileWithBytes("later.tierlist", archive));
  check("a dirty document asks before replacing",
    api.runtime.banner.actions !== undefined && api.runtime.banner.actions.length === 2);
  check("...and has not replaced anything yet", s.title === "Damaged");
  api.runtime.banner.actions[1].onClick();     // Cancel
  check("cancelling leaves the list alone", s.title === "Damaged");
  check("...and dismisses the prompt", api.runtime.banner === null);

  api.requestImport(fileWithBytes("later.tierlist", archive));
  await api.runtime.banner.actions[0].onClick();   // Replace
  check("confirming performs the import", s.title === "Round Trip");

  /* --- export names and freshness ----------------------------------------- */

  check("filename slugified from the title", api.slugify("Round Trip!") === "round-trip");
  check("an empty title still yields a name", api.slugify("   ") === "tierlist");
  check("unicode titles degrade to something usable", api.slugify("日本語 list") === "list");

  api.addItem();
  check("dirty again after an edit", api.runtime.dirty === true);
  await api.exportList();
  check("saving produced a download", downloads.length > 0);
  check("...named from the title", downloads[downloads.length - 1].name === "round-trip.tierlist");
  check("saving clears the dirty flag", api.runtime.dirty === false);

  // downloadBlob defers its revoke; let that timer run before auditing
  fireTimers();

  // old object URLs must not survive a document swap
  const liveNow = new Set([...api.runtime.images.values()].map(e => e.url));
  const leaked = [...urlsMinted].filter(u => !urlsRevoked.has(u) && !liveNow.has(u));
  check("no object URL leaked across imports (" + urlsMinted.size + " minted, " +
        urlsRevoked.size + " revoked, " + liveNow.size + " live)", leaked.length === 0);

  integrity("integrity at the end of the archive phase");
}


/* ========================================================================== */
/* phase 7: persistence                                                       */
/* ========================================================================== */

/** setTimeout is manual here, so autosave needs an explicit nudge. */
async function flushSave() {
  fireTimers();
  await settle();
}

async function phase7() {
  // earlier phases already triggered saves — start from an empty database
  const fakeDb = env.resetDatabase();
  api.runtime.storage.available = null;
  api.runtime.storage.db = null;

  check("storage probed as available", await api.initStorage() === true);

  // build a small document with an image
  api.installDocument(api.createEmptyDocument(), new Map());
  s.title = "Persisted";
  const plain = api.addItem();
  const pictured = api.addItem();
  s.items[plain].name = "Plain";
  s.items[plain].shortText = "short";
  s.items[plain].description = "long";
  s.items[pictured].name = "Pictured";
  s.tiers[0].items = [plain];
  s.pool = [pictured];

  api.openPanel(pictured);
  await api.attachImage(pictured, fakeFile("saved.png", "image/png", { w: 320, h: 240 }));
  const imagePath = s.items[pictured].image;
  const savedBytes = api.runtime.images.get(imagePath).blob._bytes;

  // editing schedules an autosave rather than writing immediately
  s.title = "Persisted";
  api.addTier();
  check("an edit schedules a save, it does not write at once",
    fakeDb.stores.get("document").get("current") === undefined);

  await flushSave();
  const storedDoc = fakeDb.stores.get("document").get("current");
  check("the debounced save wrote the document", storedDoc !== undefined);
  check("...with the title", storedDoc.title === "Persisted");
  check("...with the placements", storedDoc.tiers[0].items[0] === plain);
  check("image bytes stored separately", fakeDb.stores.get("images").has(imagePath));
  check("the document holds no bytes", storedDoc.images[imagePath].blob === undefined);

  /* --- restore into a fresh app ------------------------------------------- */

  api.installDocument(api.createEmptyDocument(), new Map());
  check("wiped before restoring", s.title === "Untitled Tier List");

  await api.restoreSession();
  check("session restored", s.title === "Persisted");
  check("items came back", Object.keys(s.items).length === 2);
  check("names came back", s.items[plain].name === "Plain");
  check("descriptions came back",
    s.items[plain].shortText === "short" && s.items[plain].description === "long");
  check("placements came back", s.tiers[0].items[0] === plain && s.pool[0] === pictured);
  check("the added tier came back", s.tiers.length === 6);
  check("image reference came back", s.items[pictured].image === imagePath);
  check("image bytes came back", api.runtime.images.has(imagePath));

  const restoredBytes = api.runtime.images.get(imagePath).blob._bytes;
  check("image bytes are identical after a restore",
    restoredBytes.length === savedBytes.length &&
    restoredBytes.every((b, i) => b === savedBytes[i]));
  check("the card renders the restored image", cardFor(pictured)._class.includes("has-image"));
  check("a restore is not dirty", api.runtime.dirty === false);
  integrity("integrity after restoring a session");

  /* --- stale blobs are collected ------------------------------------------ */

  api.removeImage(pictured);
  await flushSave();
  check("an unreferenced blob is dropped from storage",
    !fakeDb.stores.get("images").has(imagePath));
  check("...and from the stored manifest",
    fakeDb.stores.get("document").get("current").images[imagePath] === undefined);

  /* --- a session missing its blobs degrades rather than breaks ------------- */

  api.openPanel(pictured);
  await api.attachImage(pictured, fakeFile("vanishing.png", "image/png"));
  const doomedPath = s.items[pictured].image;
  await flushSave();
  check("stored again", fakeDb.stores.get("images").has(doomedPath));

  fakeDb.stores.get("images").delete(doomedPath);      // simulate partial loss
  api.installDocument(api.createEmptyDocument(), new Map());
  await api.restoreSession();
  check("a session with missing bytes still loads", s.title === "Persisted");
  check("the affected item fell back to text", s.items[pictured].shortType === "text");
  check("...and dropped the dead reference", s.items[pictured].image === null);
  check("...and said so", api.runtime.banner.text.includes("Restored with repairs"));
  integrity("integrity after a partial restore");

  /* --- New list ----------------------------------------------------------- */

  api.addItem();
  check("dirty before starting over", api.runtime.dirty === true);
  api.newList();
  check("a dirty list asks before being thrown away",
    api.runtime.banner.actions && api.runtime.banner.actions.length === 2);
  check("...and has not cleared anything yet", s.title === "Persisted");
  api.runtime.banner.actions[1].onClick();
  check("cancelling keeps the list", s.title === "Persisted");

  api.newList();
  await api.runtime.banner.actions[0].onClick();
  await settle();
  check("confirming starts an empty list", s.title === "Untitled Tier List");
  check("...with no items", Object.keys(s.items).length === 0);
  check("...and the default tiers", s.tiers.length === 5);
  check("...and no leftover images", api.runtime.images.size === 0);
  check("stored images cleared", fakeDb.stores.get("images").size === 0);

  /* --- write failures are reported, not swallowed ------------------------- */

  api.runtime.storage.available = true;
  fakeDb.failNextWriteWith("QuotaExceededError");
  api.addItem();
  await flushSave();
  check("a failed write is reported", api.runtime.banner.tone === "warn");
  check("...naming the cause", api.runtime.banner.text.includes("QuotaExceeded"));
  check("...and stops retrying on every edit", api.runtime.storage.available === false);

  /* --- refused storage degrades to export-only ---------------------------- */

  const savedIdb = globalThis.indexedDB;
  globalThis.indexedDB = null;
  api.runtime.storage.available = null;
  api.runtime.storage.db = null;
  check("storage probes as unavailable", await api.initStorage() === false);

  await api.restoreSession();
  check("an unavailable store warns the user", api.runtime.banner.tone === "warn");
  check("...explaining work is not kept", api.runtime.banner.text.includes("Save"));
  const titleBefore = s.title;
  api.addItem();
  await flushSave();
  check("the app still works without storage", s.title === titleBefore);
  check("...and stays usable", Object.keys(s.items).length > 0);

  globalThis.indexedDB = savedIdb;
  api.runtime.storage.available = null;
  api.runtime.storage.db = null;

  integrity("integrity at the end of the persistence phase");
}


/* ========================================================================== */
/* phase 8: history, keyboard, snapshot                                       */
/* ========================================================================== */

const keyEvent = (key, extra = {}) =>
  ({ key, preventDefault() {}, stopPropagation() {}, ...extra });

async function phase8() {
  api.installDocument(api.createEmptyDocument(), new Map());
  const one = api.addItem();
  const two = api.addItem();
  s.items[one].name = "First";
  s.items[two].name = "Second";

  /* --- undo / redo -------------------------------------------------------- */

  const before = JSON.stringify(s.pool);
  api.deleteItem(two);
  check("an item was deleted", s.items[two] === undefined);
  check("undo restores it", api.undo() === true && s.items[two] !== undefined);
  check("...to the same place", JSON.stringify(s.pool) === before);
  check("redo removes it again", api.redo() === true && s.items[two] === undefined);
  check("undo again brings it back", api.undo() === true && s.items[two] !== undefined);
  integrity("integrity after undo and redo");

  // a fresh edit clears the redo branch
  api.addTier();
  check("a new edit discards the redo branch", api.history.future.length === 0);
  check("...but is itself undoable", api.undo() === true);

  // typing coalesces into one step
  api.openPanel(one);
  const beforeTyping = api.history.past.length;
  for (const text of ["a", "ab", "abc", "abcd"]) {
    api.updateItem(one, draft => { draft.name = text; }, "name");
  }
  check("typing folds into a single undo step",
    api.history.past.length === beforeTyping + 1);
  check("the text was applied", s.items[one].name === "abcd");
  api.undo();
  check("one undo reverts the whole burst", s.items[one].name === "First");

  // history is bounded
  const deep = api.addItem();
  for (let i = 0; i < 80; i++) api.updateItem(deep, d => { d.name = "n" + i; }, "burst" + i);
  check("history stays bounded", api.history.past.length <= 60);

  // images survive an undo of their removal
  api.openPanel(deep);
  await api.attachImage(deep, fakeFile("undo-me.png", "image/png"));
  const undoPath = s.items[deep].image;
  const undoUrl = api.runtime.images.get(undoPath).url;
  api.removeImage(deep);
  check("removing detaches the image", s.items[deep].image === null);
  check("...but the bytes are kept while undo can reach them",
    api.runtime.images.has(undoPath));
  check("...and the URL is not revoked", !urlsRevoked.has(undoUrl));
  api.undo();
  check("undo restores the reference", s.items[deep].image === undoPath);
  check("...and the picture still renders",
    api.runtime.images.get(undoPath).url === undoUrl);

  // replacing the document forgets history
  api.installDocument(api.createEmptyDocument(), new Map());
  check("a document swap clears history", api.history.past.length === 0);
  check("...and undo does nothing", api.undo() === false);

  /* --- keyboard placement ------------------------------------------------- */

  const a = api.addItem();
  const b = api.addItem();
  const c = api.addItem();
  s.items[a].name = "A"; s.items[b].name = "B"; s.items[c].name = "C";
  api.closePanel();
  api.render();

  check("cards are focusable", cardFor(a).attrs.tabindex === "0");
  check("cards describe themselves",
    cardFor(a).attrs["aria-label"].includes("Unassigned, position 1 of 3"));
  check("zones are lists", zoneOf(0).attrs.role === "list");

  // arrows walk focus when nothing is held
  api.onCardKeyDown(keyEvent("ArrowRight"), a);
  check("arrow keys move focus, not the item",
    document.activeElement === cardFor(b) && s.pool[0] === a);

  // space picks up
  api.onCardKeyDown(keyEvent(" "), a);
  check("space picks the item up", api.runtime.grab !== null && api.runtime.grab.id === a);
  check("...marks the card", cardFor(a)._class.includes("is-grabbed"));
  check("...exposes it to assistive tech", cardFor(a).attrs["aria-grabbed"] === "true");
  check("...and announces it", liveEl._text.includes("Picked up A"));

  // arrows now move it
  api.onCardKeyDown(keyEvent("ArrowRight"), a);
  check("right moves it along the row", s.pool.indexOf(a) === 1);
  check("...and announces the new position", liveEl._text.includes("position 2 of 3"));
  api.onCardKeyDown(keyEvent("ArrowLeft"), a);
  check("left moves it back", s.pool.indexOf(a) === 0);

  api.onCardKeyDown(keyEvent("ArrowUp"), a);
  check("up moves it into the last tier", s.tiers[4].items.includes(a));
  check("...and out of the pool", !s.pool.includes(a));
  for (let i = 0; i < 4; i++) api.onCardKeyDown(keyEvent("ArrowUp"), a);
  check("repeated ups reach the first tier", s.tiers[0].items.includes(a));
  api.onCardKeyDown(keyEvent("ArrowUp"), a);
  check("...and stop there", s.tiers[0].items.includes(a));
  integrity("integrity after keyboard moves");

  // space drops
  api.onCardKeyDown(keyEvent(" "), a);
  check("space drops it", api.runtime.grab === null);
  check("...announcing where it landed", liveEl._text.includes("Dropped"));
  check("...and clears the marker", !cardFor(a)._class.includes("is-grabbed"));

  // escape puts it back
  const home = JSON.stringify(s.tiers.map(t => t.items));
  api.onCardKeyDown(keyEvent(" "), a);
  api.onCardKeyDown(keyEvent("ArrowDown"), a);
  api.onCardKeyDown(keyEvent("ArrowDown"), a);
  check("moved away from home", JSON.stringify(s.tiers.map(t => t.items)) !== home);
  check("escape cancels the move", api.cancelGrab() === true);
  check("...restoring the original position",
    JSON.stringify(s.tiers.map(t => t.items)) === home);
  check("...and saying so", liveEl._text.includes("cancelled"));
  integrity("integrity after a cancelled keyboard move");

  // enter opens the panel
  api.onCardKeyDown(keyEvent("Enter"), b);
  check("enter opens the details", api.runtime.panelOpen && api.runtime.selectedItemId === b);
  api.closePanel();

  // keyboard tier reordering
  const rowIds = () => s.tiers.map(t => t.id).join("|");
  const firstTier = s.tiers[0].id;
  const startRows = rowIds();
  api.onGripKeyDown(keyEvent(" "), firstTier);
  check("space picks up a tier", api.runtime.grab && api.runtime.grab.kind === "tier");
  api.onGripKeyDown(keyEvent("ArrowDown"), firstTier);
  check("down moves the row", rowIds() !== startRows);
  check("...to second place", s.tiers[1].id === firstTier);
  check("...and announces it", liveEl._text.includes("row 2 of"));
  api.onGripKeyDown(keyEvent(" "), firstTier);
  check("space drops the tier", api.runtime.grab === null);
  check("the moved row is undoable", api.undo() === true && rowIds() === startRows);

  /* --- undo shortcut is not stolen from text fields ------------------------ */

  const editable = new Node("textarea");
  document.activeElement = editable;
  const stolen = { key: "z", ctrlKey: true, preventDefault() {}, stopPropagation() {} };
  check("ctrl+z inside a text field is left to the browser", !api.isUndoShortcut(stolen));
  document.activeElement = null;
  check("ctrl+z outside one is ours", api.isUndoShortcut(stolen));

  /* --- empty states ------------------------------------------------------- */

  api.installDocument(api.createEmptyDocument(), new Map());
  check("a brand-new list explains itself",
    poolDrop.find("empty-hint")._text.includes("Add item"));
  check("empty tiers invite a drop", zoneOf(0).find("empty-hint")._text === "Drop items here");
  const solo = api.addItem();
  check("once something exists the pool hint changes",
    poolDrop.find("empty-hint") === null);
  api.deleteItem(solo);
  check("...and reverts when it is emptied again",
    poolDrop.find("empty-hint")._text.includes("Add item"));

  /* --- snapshot ----------------------------------------------------------- */

  const shot = api.addItem();
  s.items[shot].name = "Snapshot me";
  s.items[shot].shortText = "with words";
  s.tiers[0].items = [shot];
  s.pool = [];
  s.title = "Picture This";

  const png = await api.renderSnapshot();
  check("a snapshot was produced", png !== null && png.type === "image/png");

  const drawn = canvas.last.getContext().calls;
  check("the snapshot canvas was sized", canvas.last.width > 0 && canvas.last.height > 0);
  check("...at 2x for sharpness", canvas.last.width % 2 === 0);

  await api.exportSnapshot();
  check("saving a picture names it from the title",
    downloads[downloads.length - 1].name === "picture-this.png");

  fireTimers();
  const liveUrls = new Set([...api.runtime.images.values()].map(e => e.url));
  const stillOut = [...urlsMinted].filter(u => !urlsRevoked.has(u) && !liveUrls.has(u));
  check("no object URL leaked overall (" + urlsMinted.size + " minted, " +
        urlsRevoked.size + " revoked, " + liveUrls.size + " live)", stillOut.length === 0);

  integrity("integrity at the very end");
}


run(async () => {
  await phase5();
  await phase6();
  await phase7();
  await phase8();
});
