#!/usr/bin/env python3
"""Dev-only: render a top-view crop of the Guwahati MLS data as discrete points.

Not part of the served site. The crop is drawn in the explorer's frame:
x = mapper direction of travel (at the chosen time), y = mapper's left,
metres, with a metre grid, a scale bar, a mapper-heading arrow and a north
arrow. Points are coloured by scanner (red = left scanner / scanner 0,
blue = right scanner / scanner 1, as in the thesis figures and the explorer)
or by GPS time.

    # preview candidates from tools/field_candidates.py
    tools/.venv/bin/python tools/render_field.py --ids F10 F38 --out-dir tools/out/preview

    # explicit crop
    tools/.venv/bin/python tools/render_field.py --center 374012.3 2896831.7 --time 535412.6 --size 24 \
        --name F32 --out-dir static/images/field --format webp --max-kb 300

Height filter defaults to 0.5-3.0 m above local ground (vehicles), so the road
surface does not swamp the object.
"""
import argparse
import io
import json
import math
import os

import laspy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA = os.path.expanduser("~/Documents/GitHub/Distortions/Data/Real/MLS Traffic Data")
COLORS = {0: "#d93636", 1: "#2f5bd3"}          # explorer --left / --right (light theme)
LABELS = {0: "left scanner", 1: "right scanner"}


def load_scanners(data):
    out = []
    for k in (0, 1):
        las = laspy.read(os.path.join(data, "Pointcloud", "Scannerwise", f"Laser(Traffic area)-Scanner-{k}.laz"))
        out.append(dict(x=np.asarray(las.x), y=np.asarray(las.y), z=np.asarray(las.z), t=np.asarray(las.gps_time)))
    return out


def load_traj(data):
    tr = np.loadtxt(os.path.join(data, "Trajectory", "534718_535568_TXYZHRP.txt"))
    T, X, Y = tr[:, 0], tr[:, 1], tr[:, 2]
    return dict(T=T, X=X, Y=Y, VX=np.gradient(X, T), VY=np.gradient(Y, T))


def mapper_at(traj, t):
    T = traj["T"]
    vx, vy = np.interp(t, T, traj["VX"]), np.interp(t, T, traj["VY"])
    return np.interp(t, T, traj["X"]), np.interp(t, T, traj["Y"]), math.atan2(vx, vy)   # course, rad from north (cw)


def crop(scanners, cx, cy, half, hmin, hmax):
    """Points within the square crop, with height above local ground."""
    pts = []
    for k, s in enumerate(scanners):
        m = (np.abs(s["x"] - cx) < half * 1.5) & (np.abs(s["y"] - cy) < half * 1.5)
        pts.append((k, s["x"][m], s["y"][m], s["z"][m], s["t"][m]))
    allx = np.concatenate([p[1] for p in pts]); ally = np.concatenate([p[2] for p in pts]); allz = np.concatenate([p[3] for p in pts])
    gx = ((allx - (cx - 2 * half)) // 1).astype(int); gy = ((ally - (cy - 2 * half)) // 1).astype(int)
    key = gx * 10000 + gy
    uk = np.unique(key)
    ground = {u: np.percentile(allz[key == u], 5) for u in uk}
    out = []
    for k, x, y, z, t in pts:
        kk = ((x - (cx - 2 * half)) // 1).astype(int) * 10000 + ((y - (cy - 2 * half)) // 1).astype(int)
        hz = z - np.array([ground[q] for q in kk])
        m = (hz > hmin) & (hz < hmax)
        out.append((k, x[m], y[m], t[m]))
    return out


def render(scanners, traj, cx, cy, t, size, color, title, path, fmt, max_kb, hmin, hmax, stride, theme):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    half = size / 2
    mx, my, course = mapper_at(traj, t)
    fwd = np.array([math.sin(course), math.cos(course)])
    left = np.array([-math.cos(course), math.sin(course)])
    ox, oy = cx, cy                                             # crop centre -> origin of the local frame

    def to_local(x, y):
        dx, dy = x - ox, y - oy
        return dx * fwd[0] + dy * fwd[1], dx * left[0] + dy * left[1]

    dark = theme == "dark"
    bg, fg, grid = ("#111111", "#e6e6e6", "#333333") if dark else ("#ffffff", "#1a1a1a", "#e3e3e3")
    fig = plt.figure(figsize=(6.4, 4.0), dpi=150)
    ax = fig.add_axes([0, 0, 1, 1]); ax.set_facecolor(bg); fig.patch.set_facecolor(bg)
    aspect = 6.4 / 4.0
    hx, hy = half, half / aspect
    step = 1 if size <= 16 else 2 if size <= 30 else 5
    for g in np.arange(math.floor(-hx / step) * step, hx + step, step):
        ax.axvline(g, color=grid, lw=0.6, zorder=0)
    for g in np.arange(math.floor(-hy / step) * step, hy + step, step):
        ax.axhline(g, color=grid, lw=0.6, zorder=0)

    # mapper path through the crop
    sel = np.abs(traj["T"] - t) < 30
    px, py = to_local(traj["X"][sel], traj["Y"][sel])
    ax.plot(px, py, color=fg, lw=0.8, alpha=0.5, ls="--", zorder=1)

    cmap = plt.get_cmap("viridis")
    tmin = min((p[3].min() for p in crop_cache(scanners, cx, cy, half, hmin, hmax) if len(p[3])), default=t)
    tmax = max((p[3].max() for p in crop_cache(scanners, cx, cy, half, hmin, hmax) if len(p[3])), default=t + 1)
    for k, x, y, tt in crop_cache(scanners, cx, cy, half, hmin, hmax):
        lx, ly = to_local(x[::stride], y[::stride])
        c = COLORS[k] if color == "scanner" else cmap((tt[::stride] - tmin) / max(tmax - tmin, 1e-6))
        ax.scatter(lx, ly, s=1.6, c=c, lw=0, alpha=0.85, zorder=2, label=LABELS[k] if color == "scanner" else None)

    ax.set_xlim(-hx, hx); ax.set_ylim(-hy, hy); ax.set_aspect("equal"); ax.axis("off")
    # scale bar
    sb = step * (2 if size > 16 else 1)
    x0, y0 = hx - sb - 0.04 * size, -hy + 0.05 * size
    ax.plot([x0, x0 + sb], [y0, y0], color=fg, lw=2, solid_capstyle="butt")
    ax.text(x0 + sb / 2, y0 + 0.02 * size, f"{sb:g} m", color=fg, ha="center", va="bottom", fontsize=8)
    # mapper heading (+x) and north arrows
    ax.annotate("", xy=(-hx + 0.12 * size, -hy + 0.05 * size), xytext=(-hx + 0.03 * size, -hy + 0.05 * size),
                arrowprops=dict(arrowstyle="->", color=fg, lw=1.2))
    ax.text(-hx + 0.13 * size, -hy + 0.05 * size, "mapper", color=fg, va="center", fontsize=8)
    north = np.array([0.0, 1.0])
    nl = np.array([north @ fwd, north @ left]) * 0.06 * size
    nc = np.array([hx - 0.06 * size, hy - 0.08 * size])
    ax.annotate("", xy=tuple(nc + nl / 2), xytext=tuple(nc - nl / 2), arrowprops=dict(arrowstyle="->", color=fg, lw=1.2))
    ax.text(*(nc + nl / 2 * 1.6), "N", color=fg, ha="center", va="center", fontsize=8)
    if title:
        ax.text(-hx + 0.02 * size, hy - 0.03 * size, title, color=fg, va="top", fontsize=8)
    if color == "scanner":
        ax.legend(loc="upper center", fontsize=7, frameon=True, facecolor=bg, edgecolor="none", framealpha=0.9, labelcolor=fg, markerscale=5, ncol=2)

    buf = io.BytesIO(); fig.savefig(buf, format="png", facecolor=bg); plt.close(fig)
    im = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    for q in (82, 75, 68, 60, 50, 40):
        if fmt == "webp":
            im.save(path, "WEBP", quality=q, method=6)
        else:
            im.quantize(colors=64 if q < 70 else 128).save(path, "PNG", optimize=True)
        if os.path.getsize(path) <= max_kb * 1024:
            break
    return os.path.getsize(path)


_cache = {}


def crop_cache(scanners, cx, cy, half, hmin, hmax):
    key = (round(cx, 2), round(cy, 2), half, hmin, hmax)
    if key not in _cache:
        _cache[key] = crop(scanners, cx, cy, half, hmin, hmax)
    return _cache[key]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=DEFAULT_DATA)
    ap.add_argument("--ids", nargs="*", help="candidate IDs from tools/out/candidates.json")
    ap.add_argument("--center", nargs=2, type=float, metavar=("X", "Y"))
    ap.add_argument("--time", type=float, help="GPS time that sets the mapper heading (required with --center)")
    ap.add_argument("--name", default="crop")
    ap.add_argument("--size", type=float, default=None, help="crop width in metres")
    ap.add_argument("--color", choices=["scanner", "time"], default="scanner")
    ap.add_argument("--format", choices=["webp", "png"], default="webp")
    ap.add_argument("--max-kb", type=int, default=300)
    ap.add_argument("--hmin", type=float, default=0.5)
    ap.add_argument("--hmax", type=float, default=3.0)
    ap.add_argument("--stride", type=int, default=1, help="draw every n-th point")
    ap.add_argument("--theme", choices=["light", "dark"], default="light")
    ap.add_argument("--out-dir", default=os.path.join(HERE, "out", "preview"))
    ap.add_argument("--no-title", action="store_true", help="omit the text label inside the image")
    a = ap.parse_args()

    jobs = []
    if a.ids:
        cand = {r["id"]: r for r in json.load(open(os.path.join(HERE, "out", "candidates.json")))}
        for i in a.ids:
            r = cand[i]
            size = a.size or max(16.0, min(48.0, max(r["len_L"], r["len_R"]) + 10))
            title = f"{i}  v_m≈{r['vm_kmh']:.0f} km/h  v_o≈{r['vo_kmh']:.0f}±{r['vo_err_kmh']:.0f} km/h  θ≈{r['theta']:+.0f}°"
            jobs.append((r["cx"], r["cy"], r["t"], size, i, title))
    elif a.center:
        if a.time is None:
            ap.error("--time is required with --center")
        jobs.append((a.center[0], a.center[1], a.time, a.size or 24.0, a.name, ""))
    else:
        ap.error("give --ids or --center")

    scanners, traj = load_scanners(a.data), load_traj(a.data)
    for cx, cy, t, size, name, title in jobs:
        if a.no_title:
            title = ""
        suffix = "-dark" if a.theme == "dark" else ""
        path = os.path.join(a.out_dir, f"{name}{suffix}.{a.format}")
        n = render(scanners, traj, cx, cy, t, size, a.color, title, path, a.format, a.max_kb, a.hmin, a.hmax, a.stride, a.theme)
        print(f"{path}  {n / 1024:.0f} KB")


if __name__ == "__main__":
    main()
