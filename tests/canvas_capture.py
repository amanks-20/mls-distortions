#!/usr/bin/env python3
"""Dev-only: check the explorer's 2D canvas for all 6 presets x both sides, in both themes.

Needs Google Chrome. It serves the repo root itself (a threaded server with a
large listen backlog: python3 -m http.server has a backlog of 5, and Chrome's
parallel requests on a cold load could overflow it, so a script was sometimes
never loaded). --port N uses an already running server instead.
    python3 tests/canvas_capture.py --save tests/canvas-2d.json   # record
    python3 tests/canvas_capture.py --compare tests/canvas-2d.json   # compare

Two checks, run together, each for the light and the dark colour scheme:

1. Pixel hashes (tests/canvas-capture.html): loads /index.html?case=..&side=.. in
   an iframe and SHA-256-hashes canvas.toDataURL(). Device pixel ratio is forced
   to 1. These depend on the browser's rasteriser, so the browser and its exact
   version are stored in the baseline ("_browser") and printed on a mismatch.
2. Draw record (tests/canvas-record.html): logs every 2D-context call (method,
   coordinates, text, colours, line widths, fonts) while the explorer redraws,
   and hashes the log. Nothing is rasterised, so this check does not depend on
   the browser version: if only the pixel hashes differ, the geometry and
   colours drawn are unchanged and the difference is in rendering.

The colour scheme is pinned with --blink-settings=preferredColorScheme (Blink's
enum: 0 = dark, 1 = light). Without it headless Chrome follows the macOS
appearance, and the canvas colours follow the page theme: that, not a Chrome
update, made all 12 hashes fail on 2026-11-10 (the old baseline had been
recorded while macOS was in dark mode).

--chrome PATH runs another Chromium build with the same flags (for example a
fixed-version Chromium); the default is the system Google Chrome.
"""
import argparse
import functools
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMES = {"light": 1, "dark": 0}          # Blink PreferredColorScheme: kDark = 0, kLight = 1


def run_page(chrome, port, page, scheme, tries=4):
    for _ in range(tries):
        prof = tempfile.mkdtemp(prefix="cc-")
        try:
            out = subprocess.run([chrome, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}",
                                  "--force-device-scale-factor=1", "--window-size=1500,2500", "--virtual-time-budget=60000",
                                  f"--blink-settings=preferredColorScheme={SCHEMES[scheme]}",
                                  "--dump-dom", f"http://127.0.0.1:{port}/tests/{page}"],
                                 capture_output=True, text=True, timeout=180).stdout
        finally:
            shutil.rmtree(prof, ignore_errors=True)
        m = re.search(r"RESULT (\{.*?\})</pre>", out, re.S)
        if m:
            res = json.loads(m.group(1).replace("&quot;", '"'))
            if (len(res) == 12 and all(v["sha"] for v in res.values())
                    and all(v["dark"] == (scheme == "dark") for v in res.values())):
                return res
    sys.exit(f"capture failed ({page}, {scheme}): the page did not finish or ignored the colour scheme")


class _Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = _Server(("127.0.0.1", 0), functools.partial(_Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def capture(chrome, port):
    version = subprocess.run([chrome, "--version"], capture_output=True, text=True).stdout.strip()
    out = {"_browser": {"version": version, "flags": "--headless=new --disable-gpu --force-device-scale-factor=1 "
                        "--window-size=1500,2500 --blink-settings=preferredColorScheme=<0 dark | 1 light>"}}
    for scheme in SCHEMES:
        px = run_page(chrome, port, "canvas-capture.html", scheme)
        rec = run_page(chrome, port, "canvas-record.html", scheme)
        out[scheme] = {k: {"w": px[k]["w"], "h": px[k]["h"], "sha": px[k]["sha"],
                           "draw_calls": rec[k]["calls"], "draw_sha": rec[k]["sha"]} for k in sorted(px)}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=None, help="use a server already running on this port (default: serve the repo root)")
    ap.add_argument("--chrome", default=CHROME, help="Chrome or Chromium binary (default: system Google Chrome)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--save")
    g.add_argument("--compare")
    a = ap.parse_args()
    res = capture(a.chrome, a.port or serve())
    if a.save:
        json.dump(res, open(a.save, "w"), indent=1, sort_keys=True)
        open(a.save, "a").write("\n")
        print(f"saved 2 x 12 canvas hashes and draw records to {a.save} ({res['_browser']['version']})")
        for s in SCHEMES:
            for k, v in res[s].items():
                print(f"  {s:5s} {k}: {v['w']}x{v['h']} {v['sha'][:16]}  draw {v['draw_calls']} calls {v['draw_sha'][:16]}")
        return 0
    ref = json.load(open(a.compare))
    if "_browser" not in ref:
        sys.exit(f"{a.compare} is in the old format (one scheme, no browser version); re-record it with --save")
    bad_px, bad_draw = [], []
    for s in SCHEMES:
        for k in sorted(ref[s]):
            r, n = ref[s][k], res[s].get(k, {})
            px_ok = (r["w"], r["h"], r["sha"]) == (n.get("w"), n.get("h"), n.get("sha"))
            dr_ok = (r["draw_calls"], r["draw_sha"]) == (n.get("draw_calls"), n.get("draw_sha"))
            bad_px += [] if px_ok else [f"{s} {k}"]
            bad_draw += [] if dr_ok else [f"{s} {k}"]
            print(f"  {s:5s} {k}: pixels {'identical' if px_ok else 'DIFFERENT'}, draw calls {'identical' if dr_ok else 'DIFFERENT'}")
    print(f"browser: recorded {ref['_browser']['version']}, now {res['_browser']['version']}")
    if bad_draw:
        print(f"FAIL: the draw calls differ for {len(bad_draw)} of 24 canvases (geometry, colours or text changed)")
        return 1
    print("PASS: draw calls identical for all 24 canvases (12 x light and dark)")
    if bad_px:
        print(f"FAIL: pixel hashes differ for {len(bad_px)} of 24 canvases although the draw calls are identical:"
              " a rendering difference (browser version?), not a change in what is drawn")
        return 1
    print("PASS: all 24 2D canvases pixel-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
