#!/usr/bin/env python3
"""Dev-only checks for simulate3D (static/js/simulate3d.js). Not used by the site.

    python3 tests/check3d.py

(a) top-face points projected to (x, y): edge length and front/back order vs simulate()
(b) phiV must not change the top-view length or order
(c) a static object (vo = 0) gives an undistorted 4 m x 2 m top face
(d) (a) repeated for scanner heights 1.8, 2.0, 2.5 m: results must not depend on it
plus a sanity check that every point lies on the scan plane, on the box surface,
and on a face the scanner can see, and (e) that every point lies on the plane
window.mlsScanPlane(state, side, t) returns, the helper the 3D view draws.
(e) proves the drawn scan plane is the sampling plane (tolerance TOL_PLANE).

Lengths are compared, not absolute positions or times (the scanner height
shifts those). Tolerance: TOL_LEN metres (two profile steps of 0.05 m).

A2 GEOMETRY, LIMITS IN (b), AND TESTS b2-b4
Derived here from the plane's geometry, not read from simulate3d.js.

Plane. The scan plane at time t is N . (p - S(t)) = 0 with scanner
S(t) = (vm t, 0, H), H = H_SCANNER, and unit normal
    N = (cos(phiV) n_h, -sin(phiV)),   n_h = (cos phiH, +-sin phiH)  (+ right, - left)
Its upper half leans towards the direction of motion: moving up the plane
(steepest ascent), x increases by tan(phiV) cos(phiH) per metre of height
(test f checks this without reading the sign from the code).

A2 is a frozen slice. A2 has theta = 0 and vo = vm, so the box centre
C(t) = c0 + vm t x and C(t) - S(t) = c0 - H z for every t: the plane cuts ONE
slice of the box for the whole scan. Which slice is fixed by the start
position (the box is centred on the explorer's 2D ground line, as in
simulate(), so n_h . c0 = 0), not by the physics of the distortion. Write a
box point as p = C(t) + q + z z (q horizontal, relative to the box centre,
z the height above the ground; u, w the box's long and short axes). Then
    cos(phiV) n_h . q - sin(phiV) (z - H) = 0   =>   n_h . q = tan(phiV) (z - H)     (*)
(the previous sign gave n_h . q = tan(phiV) (H - z)).

Where (*) cuts the faces (box L x W x HGT = 4 x 2 x 1.5 m):
  top face z = HGT:       n_h . q = shift,   shift = -tan(phiV) (H - HGT)  (<= 0 for phiV >= 0)
  side faces q.w = +-W/2: q.u = (tan(phiV) (z - H) -+ W/2 n_h.w) / n_h.u
  front/back q.u = +-L/2: q.w = (tan(phiV) (z - H) -+ L/2 n_h.u) / n_h.w

Limits (computed in a2_limits):
  1. top face crossed iff |shift| < L/2 |n_h.u| + W/2 |n_h.w|. This is
     symmetric in the sign of shift. At phiH = 45, theta = 0 it is 2.121 m,
     phiV < 64.76 deg for both sides at H = 2.5 m (test b2).
  2. measured edge crossed: simulate() measures the top-face long edge
     q.w = +W/2. The top-face line meets it at q.u = (shift - W/2 n_h.w) / n_h.u,
     which must lie within +-L/2:
         W/2 n_h.w - L/2 |n_h.u|  <=  shift  <=  W/2 n_h.w + L/2 |n_h.u|
     For phiV >= 0, shift <= 0 < the upper bound, so the LOWER bound binds:
         tan(phiV) (H - HGT) <= L/2 |n_h.u| - W/2 n_h.w
     n_h.w = +sin phiH for the right scanner and -sin phiH for the left, so
       right: 0.707 m -> phiV <= 35.26 deg;  left: 2.121 m -> phiV <= 64.76 deg
     (H = 2.5 m). The left limit equals limit 1, so no tested phiV lies
     between the two for the left scanner. With the previous sign the upper
     bound bound instead, and the two sides were swapped (R 64.76, L 35.26).
     Above limit 2 the edge has no points and the length falls back to the
     extent of the whole top-face cloud, which adds the slice's own length
     along u (test b3).
  3. faces with points (test b4, phiV = 30 deg): (*) crosses a face iff
     f = n_h . q - tan(phiV) (z - H) takes both signs over the face's corners.
     The scanner sits at s = -c0 + H z relative to the box (constant in A2;
     c0 = d * 7 / d_y with d the 2D ground-line direction), and a face has
     points only if s is on its outer side. Predicted at H = 2.5 m:
       right (c0 = (-7, 7)): top and near side (q.w = -W/2); not the front
       left  (c0 = (+7, 7)): top, near side (only z >= 1.27 m) and the back
(b) runs A2 only at phiV below limit 2 for its side (limit 2 <= limit 1); all
other presets keep the full 0-70 deg range. b2, b3 and b4 predict and assert
the behaviour above the limits and the faces hit.

(f) Orientation, with expected values written from the geometric statement
above (not from the code): at phiH = 45, phiV = 30 the normals are
left (+0.612, -0.612, -0.500) and right (+0.612, +0.612, -0.500); the in-plane
UP direction leans forward (+x) with x/z = +0.408; the lower half leans
backward; the ground trace runs forward-left (left) and forward-right (right).
"""
import math
import re
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSC = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
TOL_LEN = 0.10      # m
TOL_GEOM = 1e-6     # m, point-on-plane / point-on-surface
TOL_PLANE = 1e-9    # m, point vs the drawn plane (mlsScanPlane), test (e)


def run():
    node = shutil.which("node")
    cmd = [node, "tests/harness3d.js"] if node else [JSC, "tests/harness3d.js"]
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit("Harness failed:\n" + res.stderr + res.stdout)
    return json.loads(res.stdout.strip().splitlines()[-1])


def h_scanner():
    """H_SCANNER as defined in static/js/simulate3d.js (read, not duplicated)."""
    src = open(os.path.join(ROOT, "static", "js", "simulate3d.js")).read()
    return float(re.search(r"var H_SCANNER = ([0-9.]+);", src).group(1))


LEN, WID, HGT = 4.0, 2.0, 1.5      # thesis box, m
PHI_H = 45.0                       # thesis Table 5.2
A2_THETA = 0.0                     # preset A2


def a2_geom(side):
    """Unit horizontal plane normal n_h and the box axes for preset A2."""
    ph, th = math.radians(PHI_H), math.radians(A2_THETA)
    sg = 1 if side == "R" else -1                      # left scanner: phiH -> -phiH
    n = (math.cos(ph), sg * math.sin(ph))
    u, w = (math.cos(th), math.sin(th)), (-math.sin(th), math.cos(th))
    return n[0] * u[0] + n[1] * u[1], n[0] * w[0] + n[1] * w[1]   # n.u, n.w


def phiv_of_depth(depth, H):
    """phiV at which the top-face line sits `depth` metres from the box centre (|shift| = depth)."""
    return math.degrees(math.atan(depth / (H - HGT))) if depth > 0 else 0.0


def a2_limits(side, H):
    """Both A2 limits (see module docstring): shifts in m and the phiV they correspond to.
    shift = -tan(phiV) (H - HGT) <= 0, so the measured-edge limit is set by the lower bound edge_lo."""
    nu, nw = a2_geom(side)
    top = LEN / 2 * abs(nu) + WID / 2 * abs(nw)
    edge_lo, edge_hi = WID / 2 * nw - LEN / 2 * abs(nu), WID / 2 * nw + LEN / 2 * abs(nu)
    return dict(top_shift=top, top_phiv=phiv_of_depth(top, H),
                edge_lo=edge_lo, edge_hi=edge_hi, edge_phiv=phiv_of_depth(-edge_lo, H))


def a2_faces(side, phiv, H):
    """Faces of the A2 frozen slice that have points (module docstring, limit 3), from the geometry."""
    ph = math.radians(PHI_H)
    sg = 1 if side == "R" else -1
    n = (math.cos(ph), sg * math.sin(ph))
    d = (-n[1], n[0])
    if d[1] < 0:
        d = (-d[0], -d[1])
    c0 = (d[0] * 7 / d[1], d[1] * 7 / d[1])                 # start: 2D ground line, 7 m to the side
    s = (-c0[0], -c0[1], H)                                  # scanner relative to the box centre (theta = 0)
    tv = math.tan(math.radians(phiv))
    def fval(qu, qw, z):
        return n[0] * qu + n[1] * qw - tv * (z - H)          # (*) with u = x, w = y at theta = 0
    L2, W2 = LEN / 2, WID / 2
    faces = {   # outward normal (u, w, z), corners (qu, qw, z)
        "front": ((1, 0, 0), [(L2, a, z) for a in (-W2, W2) for z in (0, HGT)]),
        "back": ((-1, 0, 0), [(-L2, a, z) for a in (-W2, W2) for z in (0, HGT)]),
        "side+": ((0, 1, 0), [(a, W2, z) for a in (-L2, L2) for z in (0, HGT)]),
        "side-": ((0, -1, 0), [(a, -W2, z) for a in (-L2, L2) for z in (0, HGT)]),
        "top": ((0, 0, 1), [(a, b, HGT) for a in (-L2, L2) for b in (-W2, W2)]),
    }
    hit = set()
    for name, (nf, corners) in faces.items():
        vals = [fval(*c) for c in corners]
        crossed = min(vals) < 0 < max(vals)
        cen = [sum(c[k] for c in corners) / 4 for k in range(3)]
        seen = sum((s[k] - cen[k]) * nf[k] for k in range(3)) > 0
        if crossed and seen:
            hit.add("side" if name.startswith("side") else name)
    return hit


def a2_slice_u_extent(side, shift):
    """Length along u of the top-face chord n_h.q = shift (|q.u| <= L/2, |q.w| <= W/2)."""
    nu, nw = a2_geom(side)
    lo, hi = -LEN / 2, LEN / 2
    if abs(nu) > 1e-12:
        a1, a2 = (shift - WID / 2 * nw) / nu, (shift + WID / 2 * nw) / nu
        lo, hi = max(lo, min(a1, a2)), min(hi, max(a1, a2))
    return max(0.0, hi - lo)


def a2_top_points(side, phiv):
    """Raw top-face points of A2 from simulate3D (simulate3d.js loaded unchanged)."""
    import tempfile
    js = (
        "var G = typeof globalThis !== 'undefined' ? globalThis : this; G.window = G;\n"
        "var path = %r;\n"
        "var src = typeof require === 'function' ? require('fs').readFileSync(path, 'utf8') : read(path);\n"
        "(0, eval)(src);\n"
        "var r = G.mlsSimulate3D({ vm: 40, vo: 40, theta: 0, side: %r, phiH: 45, phiV: %r });\n"
        "var top = r.pts.filter(function (p) { return p.face === 'top'; }).map(function (p) { return [p.x, p.y, p.t]; });\n"
        "var out = JSON.stringify({ top: top, u: r.u, w: r.w, c0: r.c0, vo: r.vo, t0: r.t0, t1: r.t1 });\n"
        "if (typeof console !== 'undefined' && console.log) console.log(out); else print(out);\n"
    ) % (os.path.join(ROOT, "static", "js", "simulate3d.js"), side, phiv)
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
        fh.write(js)
        tmp = fh.name
    try:
        node = shutil.which("node")
        res = subprocess.run([node or JSC, tmp], capture_output=True, text=True)
        if res.returncode != 0:
            sys.exit("simulate3D run failed:\n" + res.stderr + res.stdout)
        return json.loads(res.stdout.strip().splitlines()[-1])
    finally:
        os.unlink(tmp)


def a2_shift(phiv, H):
    """Signed top-face shift of (*): n_h . q = -tan(phiV) (H - HGT)."""
    return -math.tan(math.radians(phiv)) * (H - HGT)


def f(x, w=7, p=3):
    return "—".rjust(w) if x is None else f"{x:{w}.{p}f}"


def main():
    r = run()
    fails = []

    print("(a) Top face vs simulate(): edge length (m) and front/back order, tolerance ±%.2f m" % TOL_LEN)
    print(f"{'case':7} {'2D ls':>8} {'3D ls':>8} {'diff':>8}  {'2D inv':>6} {'3D inv':>6}  top pts")
    for c in r["a"]:
        d = None if c["ls3"] is None else c["ls3"] - c["ls2"]
        ok = d is not None and abs(d) <= TOL_LEN and c["inv2"] == c["inv3"]
        if not ok:
            fails.append(f"(a) {c['id']}: 2D {c['ls2']:.3f}/{c['inv2']} vs 3D {c['ls3']}/{c['inv3']}")
        print(f"{c['id']:7} {f(c['ls2'],8)} {f(c['ls3'],8)} {f(d,8)}  {str(c['inv2']):>6} {str(c['inv3']):>6}  {c['nTop']:6d}"
              + ("" if ok else "   <-- DIFFERS") + ("   (capped scan)" if c["cap2"] else ""))

    H = h_scanner()
    LIM = {side: a2_limits(side, H) for side in ("L", "R")}
    print(f"\nA2 limits from the geometry (H_SCANNER = {H} m, illustrative; phiH = {PHI_H}°, theta = {A2_THETA}°):")
    print(f"{'side':5} {'top-face shift':>15} {'-> phiV':>8}   {'edge shift range':>20} {'-> phiV':>8}")
    for side, L_ in LIM.items():
        print(f"{side:5} {L_['top_shift']:13.4f} m {L_['top_phiv']:7.2f}°   "
              f"[{L_['edge_lo']:7.4f}, {L_['edge_hi']:6.4f}] m {L_['edge_phiv']:7.2f}°")

    print("\n(b) phiV sweep (0, 10, 30, 60, 70°; A2 only below its measured-edge limit): spread of 3D top-face edge length, order")
    by = {}
    for c in r["b"]:
        if c["id"].startswith("A2-") and c["phiV"] >= LIM[c["id"][-1]]["edge_phiv"]:
            continue
        by.setdefault(c["id"], []).append(c)
    for cid in ("A2-L", "A2-R"):
        print(f"  {cid} tested at phiV = {[c['phiV'] for c in by[cid]]}")
    print(f"{'case':7} {'min ls':>8} {'max ls':>8} {'spread':>8}  orders")
    for cid, cs in by.items():
        missing = [c["phiV"] for c in cs if c["ls3"] is None]
        ls = [c["ls3"] for c in cs if c["ls3"] is not None]
        invs = sorted({c["inv3"] for c in cs if c["inv3"] is not None})
        spread = max(ls) - min(ls) if ls else None
        ok = not missing and spread <= TOL_LEN and len(invs) == 1
        if not ok:
            fails.append(f"(b) {cid}: lengths {['%.3f' % x for x in ls]}, orders {invs}"
                         + (f", NO top-face points at phiV = {missing}" if missing else ""))
        print(f"{cid:7} {f(min(ls) if ls else None,8)} {f(max(ls) if ls else None,8)} {f(spread,8)}  {invs}"
              + (f"  no top points at phiV={missing}" if missing else "") + ("" if ok else "   <-- DIFFERS"))

    print(f"\n(b2) A2 top face crossed? predicted vs observed top-face points")
    print(f"{'case':6} {'phiV':>5} {'shift m':>8} {'limit m':>8} {'limit °':>8}  {'predicted':>13}  {'observed':>13}")
    for c in r["b"]:
        if not c["id"].startswith("A2-") or c["phiV"] not in (60, 70):
            continue
        L_ = LIM[c["id"][-1]]
        shift = a2_shift(c["phiV"], H)
        pred_top = abs(shift) < L_["top_shift"]
        obs_top = c["ls3"] is not None
        ok = pred_top == obs_top
        if not ok:
            fails.append(f"(b2) {c['id']} phiV={c['phiV']}: predicted top points {pred_top}, observed {obs_top}")
        print(f"{c['id']:6} {c['phiV']:5d} {shift:8.3f} {L_['top_shift']:8.3f} {L_['top_phiv']:8.2f}  "
              f"{('top points' if pred_top else 'NO top points'):>13}  {('top points' if obs_top else 'NO top points'):>13}"
              + ("" if ok else "   <-- DIFFERS"))

    print(f"\n(b3) A2 measured edge crossed? first tested phiV above the edge limit but below the top-face limit")
    print(f"{'case':6} {'phiV':>5} {'shift m':>8} {'edge lim':>8}  {'pred. edge pts':>14} {'obs. edge pts':>13}  "
          f"{'length':>8} {'whole ext':>9}  {'offset':>7} {'slice u':>8}")
    tested = sorted({c["phiV"] for c in r["b"]})
    for side in ("L", "R"):
        L_ = LIM[side]
        above = [p for p in tested if p >= L_["edge_phiv"] and abs(a2_shift(p, H)) < L_["top_shift"]]
        if not above:
            print(f"A2-{side:3} none: no tested phiV lies between the edge limit ({L_['edge_phiv']:.2f}°) "
                  f"and the top-face limit ({L_['top_phiv']:.2f}°)")
            continue
        pv = above[0]
        shift = a2_shift(pv, H)
        pred_edge = L_["edge_lo"] <= shift <= L_["edge_hi"]
        d = a2_top_points(side, pv)
        u, w, c0, vo = d["u"], d["w"], d["c0"], d["vo"]
        edge_n, proj = 0, []
        for x, y, t in d["top"]:
            qx, qy = x - (c0[0] + vo * t * u[0]), y - (c0[1] + vo * t * u[1])
            if abs(qx * w[0] + qy * w[1] - WID / 2) < 1e-6:
                edge_n += 1
            proj.append(x * u[0] + y * u[1])
        whole = max(proj) - min(proj)
        bcase = next(c for c in r["b"] if c["id"] == f"A2-{side}" and c["phiV"] == pv)
        length = bcase["ls3"]
        streak = vo * (d["t1"] - d["t0"])                  # what the edge would give: vo x scan time
        offset = length - streak
        slice_u = a2_slice_u_extent(side, shift)
        obs_edge = edge_n > 1                              # simulate()'s rule: >1 edge point, else fall back
        ok = (pred_edge == obs_edge) and (not obs_edge) and abs(length - whole) < 1e-9 and abs(offset - slice_u) <= TOL_LEN
        if not ok:
            fails.append(f"(b3) A2-{side} phiV={pv}: predicted edge points {pred_edge}, observed {edge_n}; "
                         f"length {length:.3f} vs whole {whole:.3f}; offset {offset:.3f} vs slice {slice_u:.3f}")
        print(f"A2-{side:3} {pv:5d} {shift:8.3f} {L_['edge_lo']:8.3f}  {('some' if pred_edge else 'none'):>14} {edge_n:13d}  "
              f"{length:8.3f} {whole:9.3f}  {offset:7.3f} {slice_u:8.3f}" + ("" if ok else "   <-- DIFFERS"))
    print("  length = reported top-face length; whole ext = extent of all top-face points along u;")
    print("  offset = length - vo x scan time (the streak the edge would give); slice u = chord of the frozen slice along u")
    print("  edge lim = the binding (lower) bound of the measured-edge range, in m")

    print(f"\n(b4) A2 faces with points at phiV = 30° (default H_SCANNER): predicted from the geometry vs observed")
    for side in ("L", "R"):
        pred = a2_faces(side, 30, H)
        obs = {k for k, v in next(s for s in r["sanity"] if s["id"] == f"A2-{side}")["faces"].items() if v > 0}
        ok = pred == obs
        if not ok:
            fails.append(f"(b4) A2-{side}: predicted faces {sorted(pred)}, observed {sorted(obs)}")
        print(f"A2-{side:3} predicted {sorted(pred)}  observed {sorted(obs)}" + ("" if ok else "   <-- DIFFERS"))

    print("\n(c) Static object (vo = 0): top-face edge length and footprint should be 4 m x 2 m")
    print(f"{'case':7} {'edge':>8} {'ext u':>8} {'ext w':>8}  inverted")
    for c in r["c"]:
        ok = abs(c["lsEdge"] - 4) <= TOL_LEN and abs(c["extU"] - 4) <= TOL_LEN and abs(c["extW"] - 2) <= TOL_LEN and not c["inv"]
        if not ok:
            fails.append(f"(c) {c['id']}: edge {c['lsEdge']:.3f}, ext {c['extU']:.3f} x {c['extW']:.3f}, inv {c['inv']}")
        print(f"{c['id']:7} {f(c['lsEdge'],8)} {f(c['extU'],8)} {f(c['extW'],8)}  {c['inv']}" + ("" if ok else "   <-- DIFFERS"))

    print("\n(d) Scanner height H_SCANNER = 1.8 / 2.0 / 2.5 m (illustrative): top-face edge length and order")
    byh = {}
    for c in r["d"]:
        byh.setdefault(c["id"], {})[c["h"]] = c
    two = {c["id"]: c for c in r["a"]}
    print(f"{'case':7} {'2D ls':>8} {'h=1.8':>8} {'h=2.0':>8} {'h=2.5':>8} {'spread':>8}  order (2D | 1.8 2.0 2.5)")
    for cid, hs in byh.items():
        ls = [hs[h]["ls3"] for h in (1.8, 2.0, 2.5)]
        inv = [hs[h]["inv3"] for h in (1.8, 2.0, 2.5)]
        if None in ls:
            fails.append(f"(d) {cid}: no top-face points at some height {ls}")
            print(f"{cid:7} no top-face points at some height: {ls}   <-- DIFFERS")
            continue
        spread = max(ls) - min(ls)
        ok = spread <= TOL_LEN and len(set(inv)) == 1 and inv[0] == two[cid]["inv2"] and all(abs(x - two[cid]["ls2"]) <= TOL_LEN for x in ls)
        if not ok:
            fails.append(f"(d) {cid}: {['%.3f' % x for x in ls]} {inv}")
        print(f"{cid:7} {f(two[cid]['ls2'],8)} " + " ".join(f(x, 8) for x in ls) + f" {f(spread,8)}  "
              + f"{'swap' if two[cid]['inv2'] else 'ok':4} | " + " ".join('swap' if x else 'ok' for x in inv)
              + ("" if ok else "   <-- DIFFERS"))

    print("\nSanity: points on the scan plane / box surface / visible faces (default H_SCANNER)")
    for s in r["sanity"]:
        ok = s["worstPlane"] < TOL_GEOM and s["worstSurf"] < TOL_GEOM and s["hidden"] == 0
        if not ok:
            fails.append(f"sanity {s['id']}: plane {s['worstPlane']:.2e}, surface {s['worstSurf']:.2e}, hidden {s['hidden']}")
        faces = ", ".join(f"{k} {v}" for k, v in sorted(s["faces"].items()))
        print(f"{s['id']:7} plane {s['worstPlane']:.1e}  surface {s['worstSurf']:.1e}  hidden {s['hidden']}  [{faces}]"
              + ("" if ok else "   <-- FAILS"))

    print(f"\n(e) Points on the drawn plane mlsScanPlane(state, side, t): max |(p - origin(t)) . normal|, tolerance {TOL_PLANE:.0e} m")
    print(f"{'case':7} {'phiV':>5} {'H m':>5} {'points':>7} {'worst':>9}")
    for c in r["plane"]:
        ok = c["n"] > 0 and c["worst"] <= TOL_PLANE
        if not ok:
            fails.append(f"(e) {c['id']} phiV={c['phiV']} H={c['h']}: {c['n']} points, worst {c['worst']:.2e}")
        print(f"{c['id']:7} {c['phiV']:5d} {c['h']:5.1f} {c['n']:7d} {c['worst']:9.1e}" + ("" if ok else "   <-- FAILS"))

    print("\n(f) Orientation at phiH = 45°, phiV = 30° (expected values from the geometric statement, not the code)")
    EXP_N = {"L": (0.612, -0.612, -0.500), "R": (0.612, 0.612, -0.500)}     # listed to 3 decimals
    EXP_UP_XZ = 0.408                                                      # tan(phiV) cos(phiH), 3 decimals
    EXP_TRACE_Y = {"L": +1, "R": -1}                                       # forward (+x) trace goes left (+y) / right (-y)
    for side in ("L", "R"):
        nrm = r["orient"][side]["normal"]
        up = [-nrm[2] * nrm[0], -nrm[2] * nrm[1], 1 - nrm[2] ** 2]          # vertical projected onto the plane
        down = [-c for c in up]
        tr = [-nrm[1], nrm[0]]                                              # horizontal line in the plane
        if tr[0] < 0:
            tr = [-tr[0], -tr[1]]                                           # its forward-pointing direction
        checks = [
            ("normal", all(abs(a - b) <= 5e-4 for a, b in zip(nrm, EXP_N[side])), "(" + ", ".join(f"{c:+.3f}" for c in nrm) + ")"),
            ("upper half forward, x/z", up[0] > 0 and abs(up[0] / up[2] - EXP_UP_XZ) <= 5e-4, f"{up[0] / up[2]:+.4f}"),
            ("lower half backward", down[0] < 0 and down[2] < 0, f"down x {down[0]:+.3f}"),
            ("ground trace forward-" + ("left" if side == "L" else "right"),
             tr[0] > 0 and (tr[1] > 0) == (EXP_TRACE_Y[side] > 0) and abs(tr[1]) > 1e-9, f"({tr[0]:+.3f}, {tr[1]:+.3f})"),
        ]
        for name, ok, got in checks:
            if not ok:
                fails.append(f"(f) {side} {name}: {got}")
            print(f"  {side} {name:32} {got:>26}  " + ("ok" if ok else "<-- FAILS"))

    print()
    if fails:
        print(f"FAIL: {len(fails)} check(s) differ")
        for x in fails:
            print("  " + x)
        return 1
    print("PASS: all 3D checks agree (a, b, b2, b3, b4, c, d, sanity, e, f)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
