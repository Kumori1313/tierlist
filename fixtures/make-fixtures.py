#!/usr/bin/env python3
"""Regenerate the ZIP fixtures used by smoke.js.

The archives are committed, so this only needs running to add a writer or
change the sample document. It needs 7-Zip and bsdtar on PATH; Python's own
zipfile covers the third writer.

    python3 fixtures/make-fixtures.py

Three writers, because they disagree about where to put extra fields — and in
opposite directions, which is what makes them worth testing against:

    7-Zip       36 bytes in the central directory, 0 in local headers
    libarchive  24 bytes in the central directory, 32 in local headers
    zipfile     none in either

A reader that trusts the central directory's extra-field length to find file
data misreads every entry from one writer or the other. libarchive also sets
the data-descriptor flag, zeroing the size fields in its local headers, so
sizes have to come from the central directory too.
"""

import json
import os
import struct
import subprocess
import sys
import zlib
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")


def png(width, height, rgb):
    """A real, decodable PNG — the point is that the bytes are binary."""
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data)))

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", header)
            + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


IMAGES = {
    "images/img_alpha.png": png(1, 1, (255, 0, 0)),
    "images/img_beta.png": png(2, 2, (0, 128, 255)),
}


def manifest():
    return {
        "schema": 1,
        "app": "tierlist",
        "title": "External Archive Test",
        "createdAt": "2026-08-03T00:00:00.000Z",
        "modifiedAt": "2026-08-03T00:00:00.000Z",
        "tiers": [
            {"id": "t_s", "name": "S", "color": "#ff7f7f", "items": ["i_1"]},
            {"id": "t_a", "name": "A", "color": "#ffbf7f", "items": ["i_2"]},
        ],
        "pool": ["i_3"],
        "items": {
            "i_1": {"id": "i_1", "name": "Alpha", "shortType": "image",
                    "shortText": "kept", "image": "images/img_alpha.png",
                    "description": "first", "accent": None},
            "i_2": {"id": "i_2", "name": "Beta", "shortType": "image",
                    "shortText": "", "image": "images/img_beta.png",
                    "description": "second", "accent": None},
            "i_3": {"id": "i_3", "name": "Gamma", "shortType": "text",
                    "shortText": "no picture", "image": None,
                    "description": "third", "accent": None},
        },
        "images": {
            path: {"filename": os.path.basename(path), "mime": "image/png",
                   "bytes": len(data), "width": 1 if "alpha" in path else 2,
                   "height": 1 if "alpha" in path else 2}
            for path, data in IMAGES.items()
        },
    }


def write_source():
    os.makedirs(os.path.join(SRC, "images"), exist_ok=True)
    for path, data in IMAGES.items():
        with open(os.path.join(SRC, path), "wb") as handle:
            handle.write(data)
    with open(os.path.join(SRC, "tierlist.json"), "w") as handle:
        handle.write(json.dumps(manifest(), indent=2))


NAMES = ["tierlist.json", *IMAGES]


def write_python_archives():
    for label, method in (("py-deflate", zipfile.ZIP_DEFLATED),
                          ("py-store", zipfile.ZIP_STORED)):
        with zipfile.ZipFile(os.path.join(HERE, label + ".tierlist"), "w", method) as z:
            z.writestr(zipfile.ZipInfo("images/"), b"")   # explicit directory entry
            for name in NAMES:
                z.write(os.path.join(SRC, name), name)

    # An archive comment displaces the end-of-central-directory record, which
    # the reader has to scan backwards to find.
    path = os.path.join(HERE, "py-comment.tierlist")
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        for name in NAMES:
            z.write(os.path.join(SRC, name), name)
        z.comment = b"written by python zipfile, with a comment " * 6


def run(command):
    subprocess.run(command, cwd=SRC, check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def write_external_archives():
    out = lambda name: os.path.join(HERE, name)
    for name in ("7z-deflate", "7z-store", "7z-lzma",
                 "bsdtar-deflate", "bsdtar-store"):
        if os.path.exists(out(name + ".tierlist")):
            os.remove(out(name + ".tierlist"))   # 7z appends to an existing archive

    run(["7z", "a", "-tzip", "-bso0", "-bsp0", out("7z-deflate.tierlist"), *NAMES[:1], "images"])
    run(["7z", "a", "-tzip", "-mx0", "-bso0", "-bsp0", out("7z-store.tierlist"), *NAMES[:1], "images"])
    # LZMA inside a ZIP is method 14 — the reader should refuse it by name
    # rather than misread it.
    run(["7z", "a", "-tzip", "-mm=LZMA", "-bso0", "-bsp0", out("7z-lzma.tierlist"), *NAMES[:1], "images"])

    run(["bsdtar", "--format", "zip", "-cf", out("bsdtar-deflate.tierlist"), *NAMES[:1], "images"])
    run(["bsdtar", "--format", "zip", "--options", "zip:compression=store",
         "-cf", out("bsdtar-store.tierlist"), *NAMES[:1], "images"])


def report():
    """Print each writer's extra-field layout, the thing under test."""
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".tierlist"):
            continue
        data = open(os.path.join(HERE, name), "rb").read()
        eocd = data.rfind(b"PK\x05\x06")
        count = struct.unpack_from("<H", data, eocd + 10)[0]
        pointer = struct.unpack_from("<I", data, eocd + 16)[0]

        rows = []
        for _ in range(count):
            name_len, extra_len = struct.unpack_from("<HH", data, pointer + 28)
            local = struct.unpack_from("<I", data, pointer + 42)[0]
            local_extra = struct.unpack_from("<H", data, local + 28)[0]
            flags = struct.unpack_from("<H", data, local + 6)[0]
            rows.append((extra_len, local_extra, flags))
            pointer += (46 + name_len + extra_len
                        + struct.unpack_from("<H", data, pointer + 32)[0])

        central, local_, flags = rows[0]
        print(f"  {name:26} central extra {central:>3}  local extra {local_:>3}  "
              f"flags 0x{flags:04x}")


if __name__ == "__main__":
    write_source()
    write_python_archives()
    try:
        write_external_archives()
    except FileNotFoundError as missing:
        print(f"skipped external writers: {missing.filename} not on PATH", file=sys.stderr)
    print("fixtures written to", HERE)
    report()
