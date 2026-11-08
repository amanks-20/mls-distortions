#!/usr/bin/env python3
"""Dev-only: hash the explorer's 2D canvas for all 6 presets x both sides.

Needs Google Chrome and a local server on the repo root:
    python3 -m http.server 8765          # in the repo root, separate terminal
    python3 tests/canvas_capture.py --save tests/canvas-2d.json   # record
    python3 tests/canvas_capture.py --compare tests/canvas-2d.json   # compare

Uses tests/canvas-capture.html, which loads /index.html?case=..&side=.. in an
iframe and SHA-256-hashes canvas.toDataURL(). Device pixel ratio is forced to 1.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def capture(port, tries=4):
    for _ in range(tries):
        prof = tempfile.mkdtemp(prefix="cc-")
        try:
            out = subprocess.run([CHROME, "--headless=new", "--disable-gpu", f"--user-data-dir={prof}",
                                  "--force-device-scale-factor=1", "--window-size=1500,2500", "--virtual-time-budget=60000",
                                  "--dump-dom", f"http://localhost:{port}/tests/canvas-capture.html"],
                                 capture_output=True, text=True, timeout=120).stdout
        finally:
            shutil.rmtree(prof, ignore_errors=True)
        m = re.search(r"RESULT (\{.*?\})</pre>", out, re.S)
        if m:
            res = json.loads(m.group(1).replace("&quot;", '"'))
            if all(v["sha"] for v in res.values()) and len(res) == 12:
                return res
    sys.exit("capture failed (page did not finish); is the server running?")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--save")
    g.add_argument("--compare")
    a = ap.parse_args()
    res = capture(a.port)
    if a.save:
        json.dump(res, open(a.save, "w"), indent=1, sort_keys=True)
        print(f"saved {len(res)} canvas hashes to {a.save}")
        for k, v in sorted(res.items()):
            print(f"  {k}: {v['w']}x{v['h']} {v['sha'][:16]}")
        return 0
    ref = json.load(open(a.compare))
    bad = [k for k in sorted(ref) if ref[k] != res.get(k)]
    for k in sorted(ref):
        print(f"  {k}: {'identical' if k not in bad else 'DIFFERENT'}  {ref[k]['sha'][:16]} -> {res[k]['sha'][:16]}")
    if bad:
        print(f"FAIL: {len(bad)} of {len(ref)} canvases differ")
        return 1
    print(f"PASS: all {len(ref)} 2D canvases pixel-identical")
    return 0


if __name__ == "__main__":
    sys.exit(main())
