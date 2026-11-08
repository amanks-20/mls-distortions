#!/usr/bin/env python3
"""Dev-only regression check for the distortion explorer (not used by the site).

Runs tests/harness.js against static/js/explorer.js and compares the results
with tests/golden.json.

    python3 tests/check.py            # check, prints PASS or FAIL
    python3 tests/check.py --update   # re-record tests/golden.json (only on purpose!)

Needs a JavaScript engine: Node if it is on PATH, otherwise the JavaScriptCore
shell that ships with macOS.
"""
import json
import math
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HARNESS = os.path.join("tests", "harness.js")
GOLDEN = os.path.join(ROOT, "tests", "golden.json")
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
REL_TOL = 1e-9


def engine():
    node = shutil.which("node")
    if node:
        return [node, HARNESS]
    if os.path.exists(JSC):
        return [JSC, HARNESS]
    sys.exit("No JavaScript engine found (install Node, or run on macOS).")


def run():
    res = subprocess.run(engine(), cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit("Harness failed:\n" + res.stderr + res.stdout)
    return json.loads(res.stdout.strip().splitlines()[-1])


def same(a, b):
    if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, str) or isinstance(b, str):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return math.isclose(a, b, rel_tol=REL_TOL, abs_tol=REL_TOL)
    return a == b


def diff(golden, now):
    problems = []
    for cid in sorted(set(golden) | set(now)):
        if cid not in now:
            problems.append(f"{cid}: missing from current run")
            continue
        if cid not in golden:
            problems.append(f"{cid}: not in golden.json")
            continue
        g, n = golden[cid], now[cid]
        if g["input"] != n["input"]:
            problems.append(f"{cid}: input changed {g['input']} -> {n['input']}")
        for part in ("model", "sim"):
            for k in sorted(set(g[part]) | set(n[part])):
                gv, nv = g[part].get(k, "<absent>"), n[part].get(k, "<absent>")
                if not same(gv, nv):
                    problems.append(f"{cid}: {part}.{k} {gv!r} -> {nv!r}")
    return problems


def main():
    now = run()
    if "--update" in sys.argv:
        with open(GOLDEN, "w") as f:
            json.dump(now, f, indent=1, sort_keys=True)
            f.write("\n")
        print(f"Wrote {GOLDEN} ({len(now['cases'])} cases, engine: {now['engine']})")
        return 0
    with open(GOLDEN) as f:
        golden = json.load(f)
    problems = diff(golden["cases"], now["cases"])
    n = len(golden["cases"])
    if problems:
        print(f"FAIL: {len(problems)} difference(s) across {n} cases (engine: {now['engine']})")
        for p in problems:
            print("  " + p)
        return 1
    print(f"PASS: {n} cases match tests/golden.json (model + simulate, engine: {now['engine']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
