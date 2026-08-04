// Archives written by other tools, read back with tierlist.html's own reader.
//
//   gjs ziptest.js [path/to/tierlist.html]
//
// Fixtures in fixtures/ come from 7-Zip, libarchive and Python's zipfile —
// three writers that lay out ZIP headers differently, and in opposite
// directions, which is what a hand-written reader has to survive:
//
//     7-Zip       36 bytes of extra field centrally, 0 in local headers
//     libarchive  24 centrally, 32 locally, plus the data-descriptor flag
//     zipfile     none in either
//
// A reader that trusts the central directory's extra-field length to locate
// file data misreads every entry from one writer or the other, so testing
// against a single external tool could pass by luck.
//
// Regenerate the fixtures with: python3 fixtures/make-fixtures.py

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
const { api, state: s, check, integrity, run, fileWithBytes,
        fireTimers, inflateRawGio, urlsMinted, urlsRevoked } = env;

const FIXTURES = GLib.path_get_dirname(TARGET) + "/fixtures";

function readFixture(relative) {
  const [, bytes] = GLib.file_get_contents(FIXTURES + "/" + relative);
  return new Uint8Array(bytes);
}

const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);

async function archives() {
  if (!GLib.file_test(FIXTURES, GLib.FileTest.IS_DIR)) {
    print("SKIP  archive fixtures not found at " + FIXTURES);
    return;
  }

  // What the reader should produce, taken from disk rather than the archive.
  const expected = {
    "tierlist.json": readFixture("src/tierlist.json"),
    "images/img_alpha.png": readFixture("src/images/img_alpha.png"),
    "images/img_beta.png": readFixture("src/images/img_beta.png"),
  };

  const readable = (label, filename) => {
    const files = api.readZip(readFixture(filename));
    check(label + ": all three files found", files.size === 3);
    check(label + ": directory entries skipped", !files.has("images/"));

    for (const [name, want] of Object.entries(expected)) {
      const entry = files.get(name);
      if (!entry) { check(label + ": " + name + " present", false); continue; }
      check(label + ": " + name + " reports its real size", entry.size === want.length);
      // Inflating here with GLib proves the reader sliced the right bytes,
      // which is the part that depends on header layout.
      const got = entry.method === 0 ? entry.raw : inflateRawGio(entry.raw);
      check(label + ": " + name + " is byte-exact (method " + entry.method + ")",
        sameBytes(got, want));
    }
  };

  // 7-Zip puts 36 bytes of extra field in the central directory and none in
  // local headers; libarchive does the opposite, 24 central against 32 local,
  // and sets the data-descriptor flag so its local size fields read zero.
  // Trusting either one's layout misreads every entry from the other.
  readable("7-Zip/deflate", "7z-deflate.tierlist");
  readable("7-Zip/store", "7z-store.tierlist");
  readable("libarchive/deflate", "bsdtar-deflate.tierlist");
  readable("libarchive/store", "bsdtar-store.tierlist");
  readable("python/deflate", "py-deflate.tierlist");
  readable("python/store", "py-store.tierlist");

  const commented = api.readZip(readFixture("py-comment.tierlist"));
  check("a trailing archive comment does not hide the EOCD", commented.size === 3);
  check("...and the manifest still reads",
    sameBytes(await api.unpack(commented.get("tierlist.json")), expected["tierlist.json"]));

  // LZMA inside a ZIP: a method this reader does not implement.
  const lzma = api.readZip(readFixture("7z-lzma.tierlist"));
  check("an archive using an unsupported method still parses", lzma.size === 3);
  check("...entries this reader can handle are unaffected",
    sameBytes(await api.unpack(lzma.get("images/img_alpha.png")),
              expected["images/img_alpha.png"]));
  let refusal = null;
  try { await api.unpack(lzma.get("tierlist.json")); }
  catch (error) { refusal = error.message; }
  check("...and the unsupported entry is refused, not misread",
    refusal !== null && refusal.includes("Unsupported compression"));
  check("...naming the method", refusal !== null && refusal.includes("14"));

  // Stored archives can go all the way through the import path.
  for (const [label, filename] of [["7-Zip", "7z-store.tierlist"],
                                   ["libarchive", "bsdtar-store.tierlist"],
                                   ["python", "py-store.tierlist"]]) {
    await api.importList(fileWithBytes(filename, readFixture(filename)));
    check(label + ": imported end to end", s.title === "External Archive Test");
    check(label + ": tiers restored", s.tiers.length === 2 && s.tiers[0].name === "S");
    check(label + ": placements restored",
      s.tiers[0].items[0] === "i_1" && s.pool[0] === "i_3");
    check(label + ": image bytes intact",
      sameBytes(api.runtime.images.get("images/img_alpha.png").blob._bytes,
                expected["images/img_alpha.png"]));
    check(label + ": no repairs were needed", api.runtime.banner.tone === "info");
    integrity(label + ": integrity after a foreign archive");
  }

  fireTimers();
  const live = new Set([...api.runtime.images.values()].map(e => e.url));
  const loose = [...urlsMinted].filter(u => !urlsRevoked.has(u) && !live.has(u));
  check("no object URL leaked across the whole run (" + urlsMinted.size +
        " minted, " + urlsRevoked.size + " revoked, " + live.size + " live)",
        loose.length === 0);
}

run(archives);
