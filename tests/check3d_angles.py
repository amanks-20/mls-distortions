#!/usr/bin/env python3
"""Dev-only validation of gamma, beta, alpha (model(), paper) against angles
measured from the simulate3D cloud. Not used by the site.

    python3 tests/check3d_angles.py [--xlsx PATH]

PASS/FAIL IS ON MAGNITUDES ONLY: | |3D estimate| - |model()| | <= 1.9 deg for
gamma, beta, alpha. Signs are printed in a separate INFO section and never
cause a FAIL.

DEFINITIONS (paper: Singh & Lohani 2026, J. Surv. Eng.; PDF pages)
  p.4  right-handed mapper frame, x = nose, z up; counter-clockwise angles positive.
  p.5, p.7  a moving cuboid scans as a parallelepiped: top/bottom faces tilt by
       gamma, side faces by beta, and the front/back faces deviate by alpha.
  p.7  gamma: the front-top edge is crossed by the scan plane over time while the
       object moves, so it appears skewed in the top view.
       tan(gamma) = vo tan(phi_gamma) / vo_l,  phi_gamma = theta - phiH (R), theta + phiH (L).
  p.8  beta: same construction in the side view on the vertical front edge,
       tan(beta) = vo tan(phi_beta) / vo_l, phi_beta piecewise by side and theta.
       Degenerate vo = vl (same direction): gamma = phi_gamma, beta = phi_beta.
  p.9  alpha = tau - acos(+-sin(gamma) sin(beta)), tau = 90 deg for a box,
       "+" for 0 <= theta < 180 - phiH, "-" otherwise; designed to be acute.
  model() (explorer.js) wraps gamma, beta to (-90, 90].

METHOD (fixed before running)
  Points are taken from simulate3D in world coordinates (as scanned) and
  assigned to box edges by their position on the moving box at their own time.
  Edge points are exact plane-edge intersections.
  gamma: line fit (principal direction) through top-face points on the scanned
         front-top edge (back-top edge if the front has < 3 points); angle from
         the box width axis w.
  beta:  line fit through side-face points on the scanned vertical front edge of
         the visible side face (back edge as fallback); angle from vertical.
  alpha: "direct" = 90 deg minus the angle between the top and vertical boundary
         edges of the visible front (or back) face, fitted from that face's own
         points; if neither face is visible, "formula" = the paper's alpha formula
         applied to the ESTIMATED gamma and beta.
  The 3D estimate carries the Convention A sign (below); only its magnitude is
  used for PASS/FAIL.
  N/A: over-elongation and instant capture (model() quantity undefined), and
  any edge with fewer than 3 points (reason given).

TOLERANCE (fixed before running): 1.9 deg = atan(0.05 m / 1.5 m), i.e. one
  profile step (0.05 m) of position error across the shortest box edge
  (1.5 m height): the worst case if an edge were located only to one step.

RESULTS.XLSX CASES
  The 18 simulated cases A0..E3 are read at run time from the "Result Sheet"
  of Distortions/Data/Results/Results.xlsx (standard library only): theta row 3,
  vo row 4, vm row 5 (cm/s, converted to km/h with x * 0.036), columns C..T;
  observed alpha, beta, gamma: Left rows 9, 11, 13; Right rows 18, 20, 22.
  phiH = 45, phiV = 30 (paper Table 2). A2-L, A2-R and C2-R are over-elongation
  in model() and are N/A. For these cases |model()|, |3D estimate| and
  |observed| are printed, with RMS(|3D| - |obs|) next to RMS(|model| - |obs|).
  The observed values are measured by hand in CloudCompare; that comparison is
  reported, it is not a PASS/FAIL criterion.

SIGNS (INFO only; reported, not resolved; no sign claim is made)
  model():      implements the paper's Eq. (6) literally.
  Convention A: the geometric counter-clockwise reading of the 3D estimate:
                CCW seen from outside the face the angle belongs to (gamma from
                above, beta from outside the visible side face, alpha from the
                front/back face or the paper's formula with estimated gamma, beta).
  observed:     the sign as entered in Results.xlsx (= the paper's Table 3).
  Observed sign agreement in the paper's Table 3 (printed in INFO; A0 and the
  N/A cases left out):
    theta = 0:   gamma, beta, alpha match Convention A (beta also matches model()).
    theta = 180: gamma matches Convention A; beta matches model() and not A;
                 alpha matches neither model() nor A.
    theta = 90, 40, 130: gamma, beta, alpha all match model().
  These facts are reported here, not resolved; this test makes no claim about
  which sign is correct.
  A value with magnitude below 0.01 deg is shown as sign 0.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
TOL = math.degrees(math.atan(0.05 / 1.5))          # 1.909 deg, see docstring
ZERO = 0.01                                         # deg, sign shown as 0 below this
XLSX_DEFAULT = os.path.join(os.path.dirname(ROOT), "Distortions", "Data", "Results", "Results.xlsx")
EXPECTED_NA = {"A2-L", "A2-R", "C2-R"}
ANGLES = ("gamma", "beta", "alpha")
OBS_ROWS = {"L": {"alpha": 9, "beta": 11, "gamma": 13}, "R": {"alpha": 18, "beta": 20, "gamma": 22}}
COLS = [chr(c) for c in range(ord("C"), ord("T") + 1)]   # C..T, 18 cases


def read_xlsx(path):
    """Cell values of the 'Result Sheet' as {'C3': '0', ...} (stdlib only)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rid = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    z = zipfile.ZipFile(path)
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    sheet = {s.get("name"): s.get(rid) for s in wb.find("m:sheets", ns)}["Result Sheet"]
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    target = rels[sheet].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
    cells = {}
    for c in ET.fromstring(z.read(target)).iter("{%s}c" % ns["m"]):
        v = c.find("m:v", ns)
        if v is None or v.text is None:
            continue
        cells[c.get("r")] = shared[int(v.text)] if c.get("t") == "s" else v.text
    return cells


def xlsx_cases(path):
    cells = read_xlsx(path)
    out = []
    for col in COLS:
        name = cells[f"{col}2"]
        theta, vo, vm = (float(cells[f"{col}{r}"]) for r in (3, 4, 5))
        for side in ("L", "R"):
            out.append({"id": f"{name}-{side}", "group": "xlsx", "col": col,
                        "s": {"vm": vm * 0.036, "vo": vo * 0.036, "theta": theta, "side": side, "phiH": 45, "phiV": 30},
                        "cm_s": (vo, vm),
                        "obs": {a: float(cells[f"{col}{OBS_ROWS[side][a]}"]) for a in ANGLES}})
    return out


def run(extra):
    node = shutil.which("node")
    cmd = [node, "tests/harness3d_angles.js"] if node else [JSC, "tests/harness3d_angles.js"]
    tmp = None
    if extra:
        fd, tmp = tempfile.mkstemp(suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump([{"id": c["id"], "group": c["group"], "s": c["s"]} for c in extra], f)
        cmd += [tmp] if node else ["--", tmp]
    try:
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    finally:
        if tmp:
            os.unlink(tmp)
    if res.returncode != 0:
        sys.exit("Harness failed:\n" + res.stderr + res.stdout)
    return json.loads(res.stdout.strip().splitlines()[-1])


def wrap90(d):
    while d > 90:
        d -= 180
    while d <= -90:
        d += 180
    return d


def sgn(x):
    if x is None:
        return "·"
    return "0" if abs(x) < ZERO else ("+" if x > 0 else "-")


def rms(xs):
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else float("nan")


def note_for(angle, r):
    note = []
    if angle == "alpha" and r["est"]["aMethod"]:
        note.append(r["est"]["aMethod"])
    if angle == "gamma" and r["est"]["gInfo"]:
        note.append(f"{r['est']['gInfo']['edge']} edge, n={r['est']['gInfo']['n']}")
    if angle == "beta" and r["est"]["bInfo"]:
        note.append(f"{r['est']['bInfo']['edge']} edge on {r['est']['bInfo']['side']} side, n={r['est']['bInfo']['n']}")
    if r["est"]["capped"]:
        note.append("scan capped")
    return "; ".join(note)


NOT_SAMPLED = {"gamma": "front/back-top edge not sampled", "beta": "vertical edge of visible side not sampled",
               "alpha": "no front/back face and no gamma/beta estimate"}


def magnitude_section(title, rows, summary, fails):
    print(f"########## {title} ##########\n")
    for angle in ANGLES:
        print(f"===== {angle} (magnitudes) =====")
        print(f"{'case':24} {'|model|':>8} {'|est.|':>8} {'diff':>8}  result   note")
        diffs = []
        for r in rows:
            m, e = r["model"][angle], r["est"][angle]
            if r["undefinedWhy"]:
                print(f"{r['id']:24} {'':>8} {'':>8} {'':>8}  N/A      {r['undefinedWhy']}")
                continue
            if e is None:
                print(f"{r['id']:24} {abs(m):8.2f} {'—':>8} {'':>8}  N/A      {NOT_SAMPLED[angle]}")
                continue
            am, ae = abs(wrap90(m)), abs(wrap90(e))
            d = ae - am
            diffs.append(d)
            ok = abs(d) <= TOL
            if not ok:
                fails.append((title, angle, r["id"], d))
            print(f"{r['id']:24} {am:8.2f} {ae:8.2f} {d:8.2f}  {'PASS' if ok else 'FAIL'}     {note_for(angle, r)}")
        summary.append((title, angle, rms(diffs), len(diffs), sum(1 for x in diffs if abs(x) <= TOL)))
        print()


def observed_section(rows, obs):
    print("########## Results.xlsx: |model()|, |3D estimate|, |observed| (reported, not PASS/FAIL) ##########\n")
    pooled = {}
    for angle in ANGLES:
        print(f"===== {angle} =====")
        print(f"{'case':8} {'|model|':>8} {'|est.|':>8} {'|obs|':>8} {'|est|-|obs|':>12} {'|model|-|obs|':>14}  note")
        de, dm = [], []
        for r in rows:
            o = obs[r["id"]][angle]
            m, e = r["model"][angle], r["est"][angle]
            if r["undefinedWhy"]:
                print(f"{r['id']:8} {'':>8} {'':>8} {abs(o):8.2f} {'':>12} {'':>14}  N/A ({r['undefinedWhy']})")
                continue
            if e is None:
                print(f"{r['id']:8} {abs(m):8.2f} {'—':>8} {abs(o):8.2f} {'':>12} {abs(m) - abs(o):14.2f}  "
                      f"N/A for 3D ({NOT_SAMPLED[angle]}); left out of both RMS")
                continue
            a, b = abs(wrap90(e)) - abs(o), abs(wrap90(m)) - abs(o)
            de.append(a)
            dm.append(b)
            print(f"{r['id']:8} {abs(wrap90(m)):8.2f} {abs(wrap90(e)):8.2f} {abs(o):8.2f} {a:12.2f} {b:14.2f}")
        pooled[angle] = (rms(de), rms(dm), len(de))
        print(f"RMS over {len(de)} cases: |3D| - |obs| {rms(de):.3f} deg   |model| - |obs| {rms(dm):.3f} deg\n")
    return pooled


def sign_section(xrows, obs, grid_rows):
    print("########## INFO: signs (never PASS/FAIL; reported, not resolved; no sign claim is made) ##########\n")
    print("model() = paper Eq. (6) as written; A = Convention A (geometric CCW, see docstring);")
    print(f"obs = sign entered in Results.xlsx (= paper Table 3). 0 = |value| < {ZERO} deg; · = not available.\n")
    print(f"{'case':8} {'theta':>5}   {'gamma m/A/obs':>13}   {'beta m/A/obs':>12}   {'alpha m/A/obs':>13}  note")
    tally = {}
    for r in xrows:
        th = int(r["s"]["theta"])
        cells = []
        for angle in ANGLES:
            m = None if r["undefinedWhy"] else r["model"][angle]
            a = None if r["undefinedWhy"] else r["est"][angle]
            o = obs[r["id"]][angle]
            cells.append(f"{sgn(m)} / {sgn(a)} / {sgn(o)}")
            if m is None or a is None or abs(o) < ZERO:
                continue
            t = tally.setdefault((th, angle), [0, 0, 0])
            t[0] += 1
            t[1] += sgn(o) == sgn(m)
            t[2] += sgn(o) == sgn(a)
        note = f"N/A ({r['undefinedWhy']})" if r["undefinedWhy"] else ""
        print(f"{r['id']:8} {th:5d}   {cells[0]:>13}   {cells[1]:>12}   {cells[2]:>13}  {note}")
    print("\nAgreement of the observed sign, per theta and angle (cases with all three signs, |obs| >= 0.01 deg):")
    print(f"{'theta':>5} {'angle':6} {'n':>3} {'obs = model()':>14} {'obs = Conv. A':>14}")
    for th in (0, 180, 90, 40, 130):
        for angle in ANGLES:
            if (th, angle) in tally:
                n, wm, wa = tally[(th, angle)]
                print(f"{th:5d} {angle:6} {n:3d} {wm:>10d}/{n:<3d} {wa:>10d}/{n:<3d}")
    print("\nSynthetic presets + grid (no observed values): model() vs Convention A sign")
    for angle in ANGLES:
        same = opp = zero = 0
        for r in grid_rows:
            m, e = r["model"][angle], r["est"][angle]
            if r["undefinedWhy"] or e is None:
                continue
            if abs(m) < ZERO and abs(e) < ZERO:
                zero += 1
            elif sgn(m) == sgn(e):
                same += 1
            else:
                opp += 1
        print(f"  {angle:6} same {same:3d}, opposite {opp:3d}, both 0 {zero:3d}")
    print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", default=os.environ.get("MLS_RESULTS_XLSX", XLSX_DEFAULT))
    a = ap.parse_args()
    extra = xlsx_cases(a.xlsx) if os.path.exists(a.xlsx) else []
    rows = run(extra)
    grid = [r for r in rows if r["group"] != "xlsx"]
    xrows = [r for r in rows if r["group"] == "xlsx"]
    print(f"Tolerance {TOL:.2f} deg on magnitudes (fixed before running). {len(grid)} synthetic cases "
          f"(12 presets + {len(grid) - 12} grid), {len(xrows)} Results.xlsx cases.\n")

    summary, fails = [], []
    magnitude_section("synthetic presets + grid: |3D estimate| vs |model()|", grid, summary, fails)
    pooled = None
    if xrows:
        print(f"Results.xlsx: {a.xlsx}")
        for c in extra[::2]:
            print(f"  {c['id'][:-2]:3} col {c['col']}  theta {c['s']['theta']:5.0f}  vo {c['cm_s'][0]:5.0f} cm/s = "
                  f"{c['s']['vo']:6.2f} km/h  vm {c['cm_s'][1]:5.0f} cm/s = {c['s']['vm']:6.2f} km/h")
        print()
        na = {r["id"] for r in xrows if r["undefinedWhy"]}
        if na != EXPECTED_NA:
            print(f"NOTE: model() N/A set {sorted(na)} differs from the expected {sorted(EXPECTED_NA)}\n")
        magnitude_section("Results.xlsx cases: |3D estimate| vs |model()|", xrows, summary, fails)
        obs = {c["id"]: c["obs"] for c in extra}
        pooled = observed_section(xrows, obs)
        sign_section(xrows, obs, grid)
    else:
        print(f"SKIPPED Results.xlsx section: file not found at {a.xlsx} (use --xlsx PATH)\n")

    print("===== summary (PASS/FAIL on magnitudes only) =====")
    for title, angle, r, n, npass in summary:
        print(f"{title.split(':')[0]:28} {angle:6} RMS ||est|-|model|| {r:7.3f} deg over {n:3d} cases, {npass} PASS, {n - npass} FAIL")
    if pooled:
        print("\nResults.xlsx vs observed (reported only):")
        for angle, (re_, rm_, n) in pooled.items():
            print(f"  {angle:6} RMS |3D|-|obs| {re_:6.3f} deg   RMS |model|-|obs| {rm_:6.3f} deg   over {n} cases")
    if fails:
        print(f"\nFAIL: {len(fails)} magnitude comparison(s) outside {TOL:.2f} deg")
        for f in fails:
            print("  ", f)
        return 1
    print(f"\nPASS: all compared magnitudes within {TOL:.2f} deg (signs reported in INFO, not tested)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
