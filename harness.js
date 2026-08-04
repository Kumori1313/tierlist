// Shared test environment for tierlist.html.
//
// The app is a single HTML file with no build step and no test framework, so
// this supplies the browser it expects: a minimal DOM with fake geometry, a
// fake IndexedDB, and stand-ins for Blob, canvas, image decoding and object
// URLs. It loads the real <script> out of the HTML and returns handles to it.
//
//   imports.searchPath.unshift(directoryContainingThisFile);
//   const env = imports.harness.Harness.create("path/to/tierlist.html");
//
// Used by smoke.js (the app's behaviour) and ziptest.js (archives written by
// other tools). Everything the tests need to reach is on the returned object;
// the stubs themselves are installed on globalThis, so create() may only be
// called once per process.

const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

var Harness = {
  /** @param {string} TARGET path to tierlist.html */
  create(TARGET) {
  /* ========================================================================== */
  /* DOM stub                                                                   */
  /* ========================================================================== */

  function matches(node, selector) {
    return selector.split(",").map(s => s.trim()).some(sel => {
      if (sel.startsWith(".")) return node._class.split(" ").includes(sel.slice(1));
      if (sel.startsWith("[") && sel.endsWith("]")) {
        const attr = sel.slice(1, -1);                        // data-drop-zone
        const key = attr.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^data/, "");
        return node.dataset[key[0].toLowerCase() + key.slice(1)] !== undefined;
      }
      return node.tagName === sel;
    });
  }

  class Node {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = { _custom: {}, setProperty(k, v) { this._custom[k] = v; } };
      this.listeners = {};
      this.parentNode = null;
      this._text = null;
      this._class = "";
      this._rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }

    get className() { return this._class; }
    set className(v) { this._class = v; }
    get classList() {
      const self = this;
      return {
        add(...c) { self._class = [...new Set(self._class.split(" ").filter(Boolean).concat(c))].join(" "); },
        remove(c) { self._class = self._class.split(" ").filter(x => x && x !== c).join(" "); },
        contains(c) { return self._class.split(" ").includes(c); },
        toggle(c, on) { on ? this.add(c) : this.remove(c); },
      };
    }

    get textContent() { return this._text; }
    set textContent(v) { this._text = String(v); this.children = []; }

    get firstChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.children.indexOf(this);
      return this.parentNode.children[i + 1] || null;
    }

    append(...kids) {
      for (const k of kids) { k.parentNode?.removeChild(k); k.parentNode = this; this.children.push(k); }
    }
    insertBefore(node, ref) {
      node.parentNode?.removeChild(node);
      node.parentNode = this;
      if (!ref) { this.children.push(node); return node; }
      this.children.splice(this.children.indexOf(ref), 0, node);
      return node;
    }
    removeChild(c) { this.children = this.children.filter(x => x !== c); c.parentNode = null; }
    remove() { this.parentNode?.removeChild(this); }
    replaceChildren(...kids) {
      for (const c of this.children) c.parentNode = null;
      this.children = [];
      this._text = null;
      this.append(...kids);
    }

    replaceWith(node) {
      const parent = this.parentNode;
      if (!parent) return;
      parent.children.splice(parent.children.indexOf(this), 1, node);
      node.parentNode = parent;
      this.parentNode = null;
    }
    contains(node) {
      for (let n = node; n; n = n.parentNode) if (n === this) return true;
      return false;
    }
    get scrollHeight() { return this._rect.height; }
    focus() { globalThis.document.activeElement = this; }

    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k]; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    select() {} click() {}
    getBoundingClientRect() { return this._rect; }
    get offsetTop() { return this._rect.top; }
    get offsetHeight() { return this._rect.height; }

    cloneNode() {
      const copy = new Node(this.tagName);
      copy._class = this._class;
      copy._text = this._text;
      Object.assign(copy.attrs, this.attrs);
      Object.assign(copy.dataset, this.dataset);
      copy._rect = { ...this._rect };
      for (const c of this.children) copy.append(c.cloneNode());
      return copy;
    }

    closest(sel) {
      let n = this;
      while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
      return null;
    }
    querySelectorAll(sel, out = []) {
      for (const c of this.children) { if (matches(c, sel)) out.push(c); c.querySelectorAll(sel, out); }
      return out;
    }

    fire(type, event = {}) {
      for (const fn of this.listeners[type] || []) {
        fn({ currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...event });
      }
    }
    find(cls) {
      if (this._class.split(" ").includes(cls)) return this;
      for (const c of this.children) { const hit = c.find?.(cls); if (hit) return hit; }
      return null;
    }
    findAll(cls, out = []) {
      if (this._class.split(" ").includes(cls)) out.push(this);
      for (const c of this.children) c.findAll?.(cls, out);
      return out;
    }
  }

  /* --- the app's static shell, with real containment ------------------------ */

  const shell = {};
  const mk = id => (shell[id] = new Node(id));

  const main = mk("#main");
  const boardScroll = mk("#board-scroll");
  const board = new Node("#board");
  const tiersEl = mk("#tiers");
  const poolSection = new Node("#pool-section");
  const poolDrop = mk("#pool-drop");
  const panel = mk("#panel");
  mk("#list-title"); mk("#toolbar"); mk("#panel-body"); mk("#panel-close"); mk("#drag-layer");
  const bannerEl = mk("#banner");
  const liveEl = mk("#live");

  boardScroll.append(board);
  board.append(tiersEl, poolSection);
  poolSection.append(poolDrop);
  main.append(boardScroll, panel);
  boardScroll._rect = { left: 0, top: 60, right: 1200, bottom: 860, width: 1200, height: 800 };
  boardScroll.scrollTop = 0;

  globalThis.document = {
    body: new Node("body"),
    activeElement: null,
    querySelector: sel => shell[sel] || null,
    createElement: tag => {
      const node = new Node(tag);
      if (tag === "a") node.click = () => downloads.push({ name: node.attrs.download });
      if (tag === "canvas") {
        node.getContext = () => ({
          calls: [],
          save() {}, restore() {}, scale() {}, beginPath() {}, clip() {}, stroke() {},
          rect() {}, roundRect() {}, fillRect() {}, drawImage() { this.calls.push("image"); },
          fillText(text) { this.calls.push("text:" + text); },
          measureText: text => ({ width: text.length * 6 }),
          createLinearGradient: () => ({ addColorStop() {} }),
          set fillStyle(v) {}, set strokeStyle(v) {}, set font(v) {},
          set textAlign(v) {}, set textBaseline(v) {}, set lineWidth(v) {},
        });
        node.toBlob = (cb, type) => {
          const bytes = new Uint8Array(64).map((_, i) => i & 0xff);
          cb({
            type, size: bytes.length, _bytes: bytes,
            async arrayBuffer() { return bytes.buffer.slice(0, bytes.length); },
          });
        };
        canvas.last = node;
      }
      return node;
    },
    addEventListener() {},
  };
  globalThis.crypto = {
    getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256); return a; },
  };

  // GJS already exposes `window` as an alias of the global object and won't let
  // it be replaced, so the listener API goes straight onto globalThis.
  const winListeners = {};
  globalThis.addEventListener = (t, fn) => { (winListeners[t] ||= []).push(fn); };
  globalThis.removeEventListener = (t, fn) => {
    winListeners[t] = (winListeners[t] || []).filter(f => f !== fn);
  };
  const fireWindow = (t, ev) => { for (const fn of [...(winListeners[t] || [])]) fn(ev); };

  // A queue, not a slot: flipRows schedules nested frames from inside dragFrame.
  let frameQueue = [];
  globalThis.requestAnimationFrame = fn => frameQueue.push(fn);
  globalThis.cancelAnimationFrame = () => { frameQueue = []; };

  // Long-press timers, driven manually so tests never wait on wall time.
  let timers = [];
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const fireTimers = () => { const due = timers; timers = []; for (const t of due) t.fn?.(); };

  globalThis.navigator = { vibrate() {} };

  /* --- image stubs, with object-URL bookkeeping ------------------------------
     The phase 5 exit criterion is that no object URL leaks, so every mint and
     every revoke is recorded. */

  let urlSeq = 0;
  const urlsMinted = new Set();
  const urlsRevoked = new Set();
  globalThis.URL = {
    createObjectURL(blob) {
      const url = "blob:fake/" + (++urlSeq);
      urlsMinted.add(url);
      return url;
    },
    revokeObjectURL(url) { urlsRevoked.add(url); },
  };

  /** A stand-in File. `w`/`h` drive what createImageBitmap reports. */
  function fakeFile(name, type, { w = 400, h = 300, size = 12 } = {}) {
    const bytes = new Uint8Array(size).map((_, i) => (i * 7 + name.length) & 0xff);
    return {
      name, type, size: bytes.length, _w: w, _h: h, _bytes: bytes,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  }

  globalThis.createImageBitmap = async file => {
    if (file._broken) throw new Error("decode failed");
    return { width: file._w, height: file._h, close() {} };
  };

  // canvas: records what it was asked to draw so downscaling can be asserted
  const canvas = { last: null };

  /* --- Blob / file stubs -----------------------------------------------------
     GJS has no Blob, Response or CompressionStream. The absent compression
     streams are deliberate: the writer must fall back to storing, and a
     store-only archive is what the round-trip test then exercises. */

  globalThis.Blob = class Blob {
    constructor(parts = [], options = {}) {
      let total = 0;
      for (const part of parts) total += part.length ?? part.byteLength ?? 0;
      const merged = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        const bytes = part instanceof Uint8Array ? part : new Uint8Array(part);
        merged.set(bytes, at);
        at += bytes.length;
      }
      this._bytes = merged;
      this.size = merged.length;
      this.type = options.type || "";
    }
    async arrayBuffer() {
      return this._bytes.buffer.slice(
        this._bytes.byteOffset, this._bytes.byteOffset + this._bytes.byteLength);
    }
  };

  /** A File carrying real bytes, for archive round-trips. */
  function fileWithBytes(name, bytes) {
    return {
      name,
      type: "application/zip",
      size: bytes.length,
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  }

  const downloads = [];

  /* --- fake IndexedDB --------------------------------------------------------
     Faithful enough for this app's use: requests settle on the microtask queue,
     transactions fire oncomplete once their requests have all settled. It is a
     stand-in, not a conformance suite — real IDB semantics around transaction
     lifetime are only approximated. */

  function makeFakeIndexedDb() {
    const stores = new Map();
    let failNextWrite = null;

    const clone = value =>
      (value && typeof value.arrayBuffer === "function") ? value : JSON.parse(JSON.stringify(value));

    const db = {
      objectStoreNames: { contains: name => stores.has(name) },
      createObjectStore(name) { stores.set(name, new Map()); return {}; },
      close() {},
      transaction(names, mode) {
        const tx = { pending: 0, done: false, error: null,
                     oncomplete: null, onerror: null, onabort: null };

        const settle = () => {
          tx.pending--;
          if (tx.pending === 0 && !tx.done) {
            tx.done = true;
            Promise.resolve().then(() => tx.oncomplete && tx.oncomplete());
          }
        };

        tx.objectStore = name => {
          const map = stores.get(name);
          const request = compute => {
            const r = { result: undefined, error: null, onsuccess: null, onerror: null };
            tx.pending++;
            Promise.resolve().then(() => {
              if (failNextWrite && mode === "readwrite") {
                tx.error = new Error(failNextWrite);
                failNextWrite = null;
                tx.done = true;
                tx.pending = 0;
                if (tx.onerror) tx.onerror();
                return;
              }
              r.result = compute();
              if (r.onsuccess) r.onsuccess();
              settle();
            });
            return r;
          };
          return {
            put: (value, key) => request(() => map.set(key, clone(value))),
            get: key => request(() => map.get(key)),
            delete: key => request(() => map.delete(key)),
            clear: () => request(() => map.clear()),
            getAllKeys: () => request(() => [...map.keys()]),
          };
        };

        Promise.resolve().then(() => {
          if (tx.pending === 0 && !tx.done) { tx.done = true; tx.oncomplete && tx.oncomplete(); }
        });
        return tx;
      },
    };

    return {
      stores,
      failNextWriteWith(message) { failNextWrite = message; },
      api: {
        open() {
          const request = { result: null, error: null,
                            onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
          Promise.resolve().then(() => {
            request.result = db;
            if (stores.size === 0 && request.onupgradeneeded) request.onupgradeneeded();
            if (request.onsuccess) request.onsuccess();
          });
          return request;
        },
      },
    };
  }

  let fakeDb = makeFakeIndexedDb();
  globalThis.indexedDB = fakeDb.api;

  /** Start over with an empty database; returns the new one. */
  function resetDatabase() {
    fakeDb = makeFakeIndexedDb();
    globalThis.indexedDB = fakeDb.api;
    return fakeDb;
  }

  /** run one animation frame (draining what was queued before it) */
  const tick = () => { const due = frameQueue; frameQueue = []; for (const fn of due) fn(); };

  /* ========================================================================== */
  /* load the app                                                               */
  /* ========================================================================== */

  if (!GLib.file_test(TARGET, GLib.FileTest.EXISTS)) {
    print("Cannot find " + TARGET + " — run this from the project directory, " +
          "or pass the path to tierlist.html as an argument.");
    imports.system.exit(1);
  }

  const [, bytes] = GLib.file_get_contents(TARGET);
  const html = new TextDecoder().decode(bytes);
  const source = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

  let api;
  try {
    api = new Function(source + `
      ;return { get state() { return state; }, runtime, render, locateItem, getTier,
                addItem, addTier, renameTier, deleteTier, deleteItem,
                armDelete, clearPendingDelete,
                onBoardPointerDown, insertionRef, zoneAt, endDrag,
                syncListFromDom, syncTiersFromDom, tierInsertionRef,
                openPanel, closePanel, updateItem, refreshItemCard, findCardNode,
                attachImage, removeImage, setShortType, releaseImage, readImageFile,
                buildZip, readZip, unpack, crc32, serializeDocument, slugify,
                buildArchiveBytes, readArchive, installDocument, importList,
                undo, redo, history, toggleGrab, cancelGrab, dropGrab,
                onCardKeyDown, onGripKeyDown, renderSnapshot, exportSnapshot,
                announce, pushHistory, clearHistory, collectImages, isUndoShortcut,
                initStorage, saveNow, saveSession, loadSession, restoreSession,
                clearStoredSession, newList, adoptManifest, createEmptyDocument,
                requestImport, exportList, showBanner, dismissBanner };
    `)();
  } catch (e) {
    print("ERROR loading app: " + e + "\n" + (e.stack || ""));
    imports.system.exit(1);
  }
  print("boot: OK");

  // `state` is rebound wholesale on import, so reads must go through the app
  // rather than through a captured reference.
  const s = new Proxy({}, {
    get: (_, key) => api.state[key],
    set: (_, key, value) => { api.state[key] = value; return true; },
  });

  /* ========================================================================== */
  /* fake layout                                                                */
  /* ========================================================================== */

  const CARD = 88, GAP = 8, PAD = 8, PER_ROW = 6, ZONE_L = 120, ZONE_R = 900;

  /** Assigns plausible rects to rows, drop zones and cards. Re-run after moves. */
  function layout() {
    let y = 100;

    for (const row of tiersEl.children) {
      const zone = row.find("tier-drop");
      const cards = zone.children.filter(c => c.classList.contains("item"));
      const rows = Math.max(1, Math.ceil(cards.length / PER_ROW));
      const h = PAD * 2 + rows * CARD + (rows - 1) * GAP;

      row._rect = { left: 0, right: 1000, top: y, bottom: y + h, width: 1000, height: h };
      zone._rect = { left: ZONE_L, right: ZONE_R, top: y, bottom: y + h, width: ZONE_R - ZONE_L, height: h };
      placeCards(cards, y);
      y += h + 2;
    }

    tiersEl._rect = { left: 0, right: 1000, top: 100, bottom: y, width: 1000, height: y - 100 };

    const poolCards = poolDrop.children.filter(c => c.classList.contains("item"));
    const poolRows = Math.max(1, Math.ceil(poolCards.length / PER_ROW));
    const poolH = PAD * 2 + poolRows * CARD + (poolRows - 1) * GAP;
    y += 24;
    poolDrop._rect = { left: ZONE_L, right: ZONE_R, top: y, bottom: y + poolH, width: ZONE_R - ZONE_L, height: poolH };
    placeCards(poolCards, y);
  }

  function placeCards(cards, zoneTop) {
    cards.forEach((card, i) => {
      const col = i % PER_ROW, row = Math.floor(i / PER_ROW);
      const left = ZONE_L + PAD + col * (CARD + GAP);
      const top = zoneTop + PAD + row * (CARD + GAP);
      card._rect = { left, top, right: left + CARD, bottom: top + CARD, width: CARD, height: CARD };
    });
  }

  const zoneOf = i => tiersEl.children[i].find("tier-drop");
  const idsIn = zone => zone.children.filter(c => c.classList.contains("item")).map(c => c.dataset.itemId);
  const cardFor = id => boardScroll.querySelectorAll(".item").find(c => c.dataset.itemId === id);

  /** Drives a full press -> move -> release gesture in viewport coordinates. */
  function gesture(eventTarget, startRect, path, opts = {}) {
    const pointerType = opts.pointerType || "mouse";
    const startX = startRect.left + 20;
    const startY = startRect.top + 20;

    api.onBoardPointerDown({
      target: eventTarget, pointerType, button: 0, pointerId: 1,
      clientX: startX, clientY: startY,
    });

    // Touch has to hold still for the long press before it becomes a drag.
    if (pointerType !== "mouse" && opts.holdFirst !== false) fireTimers();

    for (const [x, y] of path) {
      fireWindow("pointermove", {
        pointerId: 1, clientX: x, clientY: y, preventDefault() {}, target: eventTarget,
      });
      layout();
      tick();
    }

    if (opts.escape) { api.endDrag(false); return; }
    if (opts.release !== false) fireWindow("pointerup", { pointerId: 1, target: eventTarget });
  }

  function drag(itemId, path, opts) {
    const card = cardFor(itemId);
    return gesture(card, card._rect, path, opts);
  }

  function dragTier(index, path, opts) {
    const row = tiersEl.children[index];
    return gesture(row.find("tier-grip"), row._rect, path, opts);
  }

  /* ========================================================================== */
  /* assertions                                                                 */
  /* ========================================================================== */

  let failed = 0;
  function check(label, cond) {
    print((cond ? "PASS  " : "FAIL  ") + label);
    if (!cond) failed++;
  }
  function integrity(label) {
    const seen = new Set();
    let bad = 0;
    for (const id of [...s.tiers.flatMap(t => t.items), ...s.pool]) {
      if (seen.has(id) || !s.items[id]) bad++;
      seen.add(id);
    }
    check(label, bad === 0 && seen.size === Object.keys(s.items).length);
  }


  /* ========================================================================== */
  /* extras the app's own environment would provide                             */
  /* ========================================================================== */

  /** GJS has no DecompressionStream, but GLib has raw zlib. */
  function inflateRawGio(bytes) {
    const decompressor = Gio.ZlibDecompressor.new(Gio.ZlibCompressorFormat.RAW);
    const input = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(bytes));
    const converted = Gio.ConverterInputStream.new(input, decompressor);
    const output = Gio.MemoryOutputStream.new_resizable();
    output.splice(converted,
      Gio.OutputStreamSpliceFlags.CLOSE_SOURCE | Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
      null);
    return new Uint8Array(output.steal_as_bytes().get_data());
  }

  /** Let queued microtasks — the fake database's requests — run to completion. */
  function settle() {
    return new Promise(resolve => {
      let spins = 0;
      const step = () => (++spins < 40 ? Promise.resolve().then(step) : resolve());
      step();
    });
  }

  function fail(message) {
    print("ERROR: " + message);
    failed++;
  }

  /** Prints the summary and returns the exit status. */
  function report() {
    print("");
    print(failed ? `*** ${failed} CHECK(S) FAILED ***` : "all checks passed");
    return failed ? 1 : 0;
  }

  /**
   * Runs an async body inside a GLib main loop, since GJS will not drain the
   * microtask queue on its own once the script body finishes.
   */
  function run(body) {
    const loop = GLib.MainLoop.new(null, false);
    let status = 1;
    (async () => {
      try {
        await body();
      } catch (error) {
        fail(String(error) + "\n" + (error.stack || ""));
      }
      status = report();
      loop.quit();
    })();
    loop.run();
    imports.system.exit(status);
  }

  return {
    api, state: s, Node, shell,
    main, boardScroll, tiersEl, poolDrop, panel, bannerEl, liveEl,
    check, integrity, fail, report, run,
    layout, zoneOf, idsIn, cardFor, gesture, drag, dragTier,
    tick, fireTimers, fireWindow, settle,
    fakeFile, fileWithBytes, downloads, canvas,
    urlsMinted, urlsRevoked, inflateRawGio,
    resetDatabase, database: () => fakeDb,
    CARD, GAP, PAD, PER_ROW, ZONE_L, ZONE_R,
  };

  },
};
