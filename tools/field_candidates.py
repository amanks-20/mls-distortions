#!/usr/bin/env python3
"""Dev-only: list candidate moving vehicles in the Guwahati MLS traffic data.

Not part of the served site. Reads the per-scanner .laz files and the
trajectory, finds objects that the two scanners place differently (a static
object lands in the same place in both clouds, a moving one does not), pairs
the two clouds of each object, and estimates its velocity from

    v_o  ~  (centroid_B - centroid_A) / (mean_time_B - mean_time_A)

Every point lies on the object at its own timestamp, so this is the object's
mean velocity up to the difference in which part of the object each scanner
sampled (bounded by the object size / time gap; reported as uncertainty).

Then it applies the explorer's equations (same formulas as model() in
static/js/explorer.js, phi_h = 45 deg) to say which regime each scanner should
show.

    tools/.venv/bin/python tools/field_candidates.py [--data DIR]

Writes tools/out/candidates.md, candidates.json and candidates.png.
"""
import argparse
import json
import math
import os

import laspy
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
DEFAULT_DATA = os.path.expanduser("~/Documents/GitHub/Distortions/Data/Real/MLS Traffic Data")
OX, OY = 373700.0, 2896400.0           # local origin (m) to keep float32 precise
PHI_H = 45.0                           # thesis Table 5.2 / StreetMapper-V mounting
SIDE = {0: "L", 1: "R"}                # scanner 0's left-side scan line runs ahead -> explorer "L"


# ---------------------------------------------------------------- loading
def load(data):
    sc = []
    for k in (0, 1):
        las = laspy.read(os.path.join(data, "Pointcloud", "Scannerwise", f"Laser(Traffic area)-Scanner-{k}.laz"))
        sc.append(dict(x=(np.asarray(las.x) - OX).astype(np.float32), y=(np.asarray(las.y) - OY).astype(np.float32),
                       z=np.asarray(las.z).astype(np.float32), t=np.asarray(las.gps_time)))
    tr = np.loadtxt(os.path.join(data, "Trajectory", "534718_535568_TXYZHRP.txt"))
    T, X, Y, Z, H = tr[:, 0], tr[:, 1] - OX, tr[:, 2] - OY, tr[:, 3], tr[:, 4]
    tmin = min(s["t"].min() for s in sc) - 5
    tmax = max(s["t"].max() for s in sc) + 5
    m = (T > tmin) & (T < tmax)
    T, X, Y, Z, H = T[m], X[m], Y[m], Z[m], H[m]
    traj = dict(T=T, X=X, Y=Y, Z=Z, H=H, VX=np.gradient(X, T), VY=np.gradient(Y, T))
    return sc, traj


def mapper_at(traj, t):
    T = traj["T"]
    vx, vy = np.interp(t, T, traj["VX"]), np.interp(t, T, traj["VY"])
    return dict(x=np.interp(t, T, traj["X"]), y=np.interp(t, T, traj["Y"]),
                v=math.hypot(vx, vy), course=math.degrees(math.atan2(vx, vy)) % 360)


# ---------------------------------------------------------------- detection
def vehicle_points(sc, traj, max_lat=25.0, hmin=0.5, hmax=3.0):
    x = np.concatenate([s["x"] for s in sc]); y = np.concatenate([s["y"] for s in sc])
    z = np.concatenate([s["z"] for s in sc]); t = np.concatenate([s["t"] for s in sc])
    k = np.concatenate([np.full(len(s["x"]), i, np.int8) for i, s in enumerate(sc)])
    d, _ = cKDTree(np.c_[traj["X"][::20], traj["Y"][::20]]).query(np.c_[x, y], workers=-1)
    m = d < max_lat
    x, y, z, t, k = x[m], y[m], z[m], t[m], k[m]
    # ground = 5th percentile height in 1 m cells
    x0, y0 = float(x.min()), float(y.min())
    key = ((x - x0) // 1).astype(np.int64) * 100000 + ((y - y0) // 1).astype(np.int64)
    o = np.argsort(key, kind="stable"); ks, zs = key[o], z[o]
    uk, st = np.unique(ks, return_index=True); en = np.r_[st[1:], len(ks)]
    g = np.array([np.percentile(zs[a:b], 5) for a, b in zip(st, en)])
    hz = z - g[np.searchsorted(uk, key)]
    m = (hz > hmin) & (hz < hmax)
    return dict(x=x[m], y=y[m], z=z[m], t=t[m], k=k[m], hz=hz[m], x0=x0, y0=y0)


def single_scanner_components(V, res=0.3):
    x, y, k = V["x"], V["y"], V["k"]
    x0, y0 = V["x0"], V["y0"]
    ii = ((x - x0) / res).astype(int); jj = ((y - y0) / res).astype(int)
    shape = (ii.max() + 2, jj.max() + 2)
    occ = [np.zeros(shape, np.int32) for _ in (0, 1)]
    for s in (0, 1):
        np.add.at(occ[s], (ii[k == s], jj[k == s]), 1)
    dil = [ndimage.binary_dilation(o > 0, iterations=2) for o in occ]
    comps = []
    for s in (0, 1):
        only = ndimage.binary_closing((occ[s] >= 2) & ~dil[1 - s], iterations=2)
        lab, n = ndimage.label(only)
        cl = lab[ii, jj]
        mk = (k == s) & (cl > 0)
        idx = np.nonzero(mk)[0]
        order = idx[np.argsort(cl[idx], kind="stable")]
        labs = cl[order]
        bounds = np.r_[0, np.nonzero(np.diff(labs))[0] + 1, len(labs)]
        area = np.bincount(lab.ravel())
        for a, b in zip(bounds[:-1], bounds[1:]):
            sel = order[a:b]; c = int(labs[a])
            if len(sel) < 150 or not (1.5 <= area[c] * res * res <= 80):
                continue
            px, py = x[sel], y[sel]
            cov = np.cov(np.c_[px, py].T)
            w, vec = np.linalg.eigh(cov)
            comps.append(dict(k=s, n=int(len(sel)), cx=float(px.mean()), cy=float(py.mean()),
                              tm=float(V["t"][sel].mean()), t0=float(V["t"][sel].min()), t1=float(V["t"][sel].max()),
                              area=float(area[c] * res * res), h95=float(np.percentile(V["hz"][sel], 95)),
                              major=float(4 * math.sqrt(max(w[1], 0))), minor=float(4 * math.sqrt(max(w[0], 0))),
                              axis=float(math.degrees(math.atan2(vec[0, 1], vec[1, 1])) % 180)))
    return comps


def lateral(traj, t, cx, cy):
    mp = mapper_at(traj, t)
    h = math.radians(mp["course"])
    dx, dy = cx - mp["x"], cy - mp["y"]
    return -dx * math.cos(h) + dy * math.sin(h), dx * math.sin(h) + dy * math.cos(h)


def pair(comps, traj):
    A = [c for c in comps if c["k"] == 0]
    B = [c for c in comps if c["k"] == 1]
    cand = []
    for i, a in enumerate(A):
        la, _ = lateral(traj, a["tm"], a["cx"], a["cy"])
        for j, b in enumerate(B):
            dt = b["tm"] - a["tm"]
            d = math.hypot(b["cx"] - a["cx"], b["cy"] - a["cy"])
            if abs(dt) < 0.15 or abs(dt) > 8 or d < 1.0 or d / abs(dt) > 22:
                continue
            dh = abs(a["h95"] - b["h95"])
            if dh > 0.45:
                continue
            lb, _ = lateral(traj, b["tm"], b["cx"], b["cy"])
            if abs(la - lb) > 3.0 or la * lb < 0:          # same side of the road, same lane-ish
                continue
            streak = max(a["major"], b["major"]) > 8
            shape = abs(math.log(max(a["major"], 1) / max(b["major"], 1))) if streak else abs(math.log(a["area"] / b["area"]))
            cand.append((dh / 0.45 + shape / 1.2 + abs(la - lb) / 3, i, j))
    cand.sort()
    used_a, used_b, out = set(), set(), []
    for s, i, j in cand:
        if i in used_a or j in used_b or s > 1.6:
            continue
        used_a.add(i); used_b.add(j); out.append((s, A[i], B[j]))
    return out


# ---------------------------------------------------------------- explorer formulas (copied from model()/classify())
def regime(vm, vo, theta, side, phi_h=PHI_H):
    t, ph = math.radians(theta), math.radians(phi_h)
    den = math.cos(t - ph) if side == "R" else math.cos(t + ph)
    vl = math.inf if abs(den) < 1e-9 else vm * math.cos(ph) / den
    if vo == 0:
        return "No distortion", vl
    if not math.isfinite(vl):
        return "Instant capture", vl
    if abs(vo - vl) / max(abs(vl), vo) < 0.08:          # field tolerance, not the explorer's 1e-6
        return "≈ Over-elongation", vl
    if vl < 0:
        return "Contraction", vl
    if vl > vo:
        return "Elongation", vl
    return ("Layover contraction" if vl < vo / 2 else "Layover elongation"), vl


PRESET_OF = {"Contraction": "B1", "Elongation": "A1", "≈ Over-elongation": "A2",
             "Layover contraction": "A3", "Layover elongation": "A3"}


def describe(pairs, traj):
    rows = []
    for s, a, b in pairs:
        dt = b["tm"] - a["tm"]
        vx, vy = (b["cx"] - a["cx"]) / dt, (b["cy"] - a["cy"]) / dt
        vo = math.hypot(vx, vy)
        tmid = (a["tm"] + b["tm"]) / 2
        mp = mapper_at(traj, tmid)
        hd = math.degrees(math.atan2(vx, vy)) % 360
        theta = -(((hd - mp["course"]) + 180) % 360 - 180)            # CCW positive, as in the explorer
        lat, fwd = lateral(traj, tmid, (a["cx"] + b["cx"]) / 2, (a["cy"] + b["cy"]) / 2)
        size = max(a["major"], b["major"], 4.0) if max(a["major"], b["major"]) < 8 else 5.0
        err = 0.5 * size / abs(dt)                                      # m/s, see module docstring
        regs = {SIDE[k]: regime(mp["v"], vo, theta, SIDE[k]) for k in (0, 1)}
        rows.append(dict(t=round(tmid, 2), cx=round((a["cx"] + b["cx"]) / 2 + OX, 1), cy=round((a["cy"] + b["cy"]) / 2 + OY, 1),
                         lat=round(lat, 1), vm_kmh=round(mp["v"] * 3.6, 1), vo_kmh=round(vo * 3.6, 1),
                         vo_err_kmh=round(err * 3.6, 1), theta=round(theta, 1), dt=round(dt, 2), score=round(s, 2),
                         h95=round((a["h95"] + b["h95"]) / 2, 2),
                         len_L=round(a["major"], 1), len_R=round(b["major"], 1), n_L=a["n"], n_R=b["n"],
                         regime_L=regs["L"][0], vl_L=round(regs["L"][1] * 3.6, 1) if math.isfinite(regs["L"][1]) else None,
                         regime_R=regs["R"][0], vl_R=round(regs["R"][1] * 3.6, 1) if math.isfinite(regs["R"][1]) else None,
                         a=a, b=b))
    rows.sort(key=lambda r: r["t"])
    for i, r in enumerate(rows, 1):
        r["id"] = f"F{i:02d}"
    return rows


def contact_sheet(rows, V, traj, path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = len(rows); cols = 4; rr = math.ceil(n / cols)
    fig, axs = plt.subplots(rr, cols, figsize=(cols * 4, rr * 4.2))
    for ax, r in zip(np.ravel(axs), rows):
        a, b = r["a"], r["b"]
        cx, cy = (a["cx"] + b["cx"]) / 2, (a["cy"] + b["cy"]) / 2
        R = max(10, abs(a["cx"] - b["cx"]) / 2 + 8, abs(a["cy"] - b["cy"]) / 2 + 8, max(a["major"], b["major"]) / 2 + 4)
        m = (np.abs(V["x"] - cx) < R) & (np.abs(V["y"] - cy) < R)
        for k, col in ((0, "#d93636"), (1, "#2f5bd3")):
            mm = m & (V["k"] == k)
            ax.scatter(V["x"][mm], V["y"][mm], s=0.3, c=col, alpha=0.5, lw=0)
        ax.plot(traj["X"], traj["Y"], "k-", lw=0.6)
        for c, col in ((a, "#d93636"), (b, "#2f5bd3")):
            ax.plot(c["cx"], c["cy"], "o", mfc="none", mec=col, ms=14, mew=1.5)
        ax.set_xlim(cx - R, cx + R); ax.set_ylim(cy - R, cy + R); ax.set_aspect("equal")
        ax.set_xticks([]); ax.set_yticks([])
        ax.set_title(f"{r['id']}  t={r['t']:.1f}  vo≈{r['vo_kmh']:.0f}±{r['vo_err_kmh']:.0f}  θ={r['theta']:+.0f}°", fontsize=9)
    for ax in np.ravel(axs)[n:]:
        ax.axis("off")
    plt.tight_layout(); plt.savefig(path, dpi=70); plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=DEFAULT_DATA)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    sc, traj = load(args.data)
    V = vehicle_points(sc, traj)
    comps = single_scanner_components(V)
    rows = describe(pair(comps, traj), traj)
    contact_sheet(rows, V, traj, os.path.join(OUT, "candidates.png"))
    keep = [{k: v for k, v in r.items() if k not in ("a", "b")} for r in rows]
    json.dump(keep, open(os.path.join(OUT, "candidates.json"), "w"), indent=1, ensure_ascii=False)
    with open(os.path.join(OUT, "candidates.md"), "w") as f:
        f.write("| ID | t (s) | side, lateral | v_m km/h | v_o km/h | θ | L-scanner regime | R-scanner regime | lengths L/R (m) |\n|---|---|---|---|---|---|---|---|---|\n")
        for r in keep:
            f.write(f"| {r['id']} | {r['t']:.1f} | {'left' if r['lat'] > 0 else 'right'} {abs(r['lat']):.1f} m | {r['vm_kmh']:.0f} | "
                    f"{r['vo_kmh']:.0f} ± {r['vo_err_kmh']:.0f} | {r['theta']:+.0f}° | {r['regime_L']} | {r['regime_R']} | {r['len_L']:.1f} / {r['len_R']:.1f} |\n")
    print(open(os.path.join(OUT, "candidates.md")).read())


if __name__ == "__main__":
    main()
