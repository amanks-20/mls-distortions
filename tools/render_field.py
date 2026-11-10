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

Showing only one vehicle (--lane): points are kept only if they lie in a band
LO..HI m to the left of the mapper's path (negative = right), between --hmin and
--hmax above the road, and in an 8-connected streak (0.25 m cells, along-track x
by lateral offset) at least --min-streak m long. The road level is taken along
the track from the mapper's own lane (5th percentile of height in 2 m bins,
|offset| < 1 m). Everything else is left out of the image. F38 was made with

    tools/.venv/bin/python tools/render_field.py --ids F38 --no-title --size 76 --shift -3.75 \
        --lane 0.5 3.5 --hmin 0.3 --hmax 2.0 --min-streak 8 --dot 3.5 --out-dir static/images/field
    (and the same with --theme dark)

F36 is drawn rotated by 180 degrees, with the crop moved 0.6 m to the mapper's left so
the mapper's path sits inside the frame (about 40 px from the edge), between the north
arrow and the legend:

    tools/.venv/bin/python tools/render_field.py --ids F36 --no-title --rotate 180 --shift-left 0.6 \
        --out-dir static/images/field      (and the same with --theme dark)
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
COLORS = {"light": {0: "#d93636", 1: "#2f5bd3"},   # explorer --left / --right, light theme
          "dark": {0: "#ff6b6b", 1: "#6e9bff"}}    # and dark theme
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


def render(scanners, traj, cx, cy, t, size, color, title, path, fmt, max_kb, hmin, hmax, stride, theme,
           lane=None, min_streak=8.0, dot=1.6, rotate=0):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from PIL import Image

    half = size / 2
    mx, my, course = mapper_at(traj, t)
    fwd = np.array([math.sin(course), math.cos(course)])
    left = np.array([-math.cos(course), math.sin(course)])
    ox, oy = cx, cy                                             # crop centre -> origin of the local frame
    # rotate=180 turns the map half a turn in the image plane (both image axes negated:
    # a rotation, determinant +1, never a mirror). Only the data layer turns; the text,
    # arrows and legend are drawn upright, in the opposite corners.
    rs = -1.0 if rotate == 180 else 1.0

    def to_local(x, y):
        dx, dy = x - ox, y - oy
        return rs * (dx * fwd[0] + dy * fwd[1]), rs * (dx * left[0] + dy * left[1])

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
    if lane is None:
        layers = crop_cache(scanners, cx, cy, half, hmin, hmax)
    else:
        layers, stats = segment_streaks(scanners, traj, cx, cy, half, t, lane, hmin, hmax, min_streak, fwd, left)
        for k, st in stats.items():
            span = f" (x {st['x_from']:+.1f}..{st['x_to']:+.1f} m)" if st["streak"] else ""
            print(f"  scanner {k}: {st['frame']} points in the frame, {st['lane']} in the lane band, {st['height']} in the height window,"
                  f" {st['streak']} in streaks >= {min_streak:g} m{span}")
    for k, x, y, tt in layers:
        lx, ly = to_local(x[::stride], y[::stride])
        c = COLORS[theme][k] if color == "scanner" else cmap((tt[::stride] - tmin) / max(tmax - tmin, 1e-6))
        ax.scatter(lx, ly, s=dot, c=c, lw=0, alpha=0.85, zorder=2, label=LABELS[k] if color == "scanner" else None)

    ax.set_xlim(-hx, hx); ax.set_ylim(-hy, hy); ax.set_aspect("equal"); ax.axis("off")
    sb = step * (2 if size > 16 else 1)
    north = np.array([0.0, 1.0])
    nl = rs * np.array([north @ fwd, north @ left]) * 0.06 * size
    if rotate != 180:
        # scale bar bottom-right, mapper arrow bottom-left pointing right, north arrow top-right
        x0, y0 = hx - sb - 0.04 * size, -hy + 0.05 * size
        ax.plot([x0, x0 + sb], [y0, y0], color=fg, lw=2, solid_capstyle="butt")
        ax.text(x0 + sb / 2, y0 + 0.02 * size, f"{sb:g} m", color=fg, ha="center", va="bottom", fontsize=8)
        ax.annotate("", xy=(-hx + 0.12 * size, -hy + 0.05 * size), xytext=(-hx + 0.03 * size, -hy + 0.05 * size),
                    arrowprops=dict(arrowstyle="->", color=fg, lw=1.2))
        ax.text(-hx + 0.13 * size, -hy + 0.05 * size, "mapper", color=fg, va="center", fontsize=8)
        nc = np.array([hx - 0.06 * size, hy - 0.08 * size])
    else:
        # rotated: scale bar top-left, mapper arrow top-right pointing left, north arrow bottom-left
        x0, y0 = -hx + 0.04 * size, hy - 0.05 * size
        ax.plot([x0, x0 + sb], [y0, y0], color=fg, lw=2, solid_capstyle="butt")
        ax.text(x0 + sb / 2, y0 - 0.02 * size, f"{sb:g} m", color=fg, ha="center", va="top", fontsize=8)
        ax.annotate("", xy=(hx - 0.12 * size, hy - 0.05 * size), xytext=(hx - 0.03 * size, hy - 0.05 * size),
                    arrowprops=dict(arrowstyle="->", color=fg, lw=1.2))
        ax.text(hx - 0.13 * size, hy - 0.05 * size, "mapper", color=fg, ha="right", va="center", fontsize=8)
        nc = np.array([-hx + 0.06 * size, -hy + 0.08 * size])
    ax.annotate("", xy=tuple(nc + nl / 2), xytext=tuple(nc - nl / 2), arrowprops=dict(arrowstyle="->", color=fg, lw=1.2))
    ax.text(*(nc + nl / 2 * 1.6), "N", color=fg, ha="center", va="center", fontsize=8)
    if title:
        ax.text(-hx + 0.02 * size, hy - 0.03 * size, title, color=fg, va="top", fontsize=8)
    if color == "scanner":
        ax.legend(loc="lower center" if rotate == 180 else "upper center", fontsize=7, frameon=True, facecolor=bg, edgecolor="none", framealpha=0.9, labelcolor=fg, markerscale=5 * math.sqrt(1.6 / dot), ncol=2)

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


def segment_streaks(scanners, traj, cx, cy, half, t, lane, hmin, hmax, min_len, fwd, left):
    """Points of one vehicle: lane band, height window above the road, long connected streaks.

    Returns [(scanner, x, y, t)] and per-scanner counts for each stage."""
    from scipy import ndimage
    sel = np.abs(traj["T"] - t) < 30
    px = (traj["X"][sel] - cx) * fwd[0] + (traj["Y"][sel] - cy) * fwd[1]
    py = (traj["X"][sel] - cx) * left[0] + (traj["Y"][sel] - cy) * left[1]
    o = np.argsort(px); px, py = px[o], py[o]
    hy = half / 1.6
    out, stats = [], {}
    for k, s in enumerate(scanners):
        m = (np.abs(s["x"] - cx) < half * 1.5) & (np.abs(s["y"] - cy) < half * 1.5)
        x, y, z, tt = s["x"][m], s["y"][m], s["z"][m], s["t"][m]
        lx = (x - cx) * fwd[0] + (y - cy) * fwd[1]; ly = (x - cx) * left[0] + (y - cy) * left[1]
        inf = (np.abs(lx) < half) & (np.abs(ly) < hy)
        off = ly - np.interp(lx, px, py)                          # lateral offset from the mapper's path, + = left
        own = inf & (np.abs(off) < 1.0)                           # the mapper's own lane: road surface
        bins = np.arange(-half, half + 2, 2.0); idx = np.digitize(lx, bins)
        road = np.array([np.percentile(z[own & (idx == i)], 5) if (own & (idx == i)).sum() > 20 else np.nan
                         for i in range(len(bins) + 1)])
        ok = ~np.isnan(road); bc = np.r_[bins[0] - 1, (bins[:-1] + bins[1:]) / 2, bins[-1] + 1]
        hz = z - np.interp(lx, bc[ok], road[ok])
        a = inf & (off > lane[0]) & (off < lane[1])
        b = a & (hz > hmin) & (hz < hmax)
        keep = np.zeros(len(x), bool)
        if b.any():
            gx = np.floor((lx[b] + half) / 0.25).astype(int); gy = np.floor((off[b] - lane[0]) / 0.25).astype(int)
            grid = np.zeros((gx.max() + 2, gy.max() + 2), bool); grid[gx, gy] = True
            lab, n = ndimage.label(grid, structure=np.ones((3, 3)))
            pl = lab[gx, gy]
            good = [c for c in range(1, n + 1) if np.ptp(lx[b][pl == c]) >= min_len]
            keep[np.nonzero(b)[0][np.isin(pl, good)]] = True
        stats[k] = dict(frame=int(inf.sum()), lane=int(a.sum()), height=int(b.sum()), streak=int(keep.sum()),
                        x_from=float(lx[keep].min()) if keep.any() else None, x_to=float(lx[keep].max()) if keep.any() else None)
        out.append((k, x[keep], y[keep], tt[keep]))
    return out, stats


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
    ap.add_argument("--shift", type=float, default=0.0, help="move the crop centre this many metres along the mapper's heading")
    ap.add_argument("--lane", nargs=2, type=float, metavar=("LO", "HI"),
                    help="show only one vehicle: points LO..HI m left of the mapper's path (see the module docstring)")
    ap.add_argument("--min-streak", type=float, default=8.0, help="with --lane: minimum length (m) of a connected streak")
    ap.add_argument("--dot", type=float, default=1.6, help="point size (matplotlib s)")
    ap.add_argument("--shift-left", type=float, default=0.0, help="move the crop centre this many metres to the mapper's left")
    ap.add_argument("--rotate", type=int, choices=[0, 180], default=0,
                    help="180: turn the map half a turn in the image plane (a rotation, not a mirror); text stays upright")
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
        if a.shift or a.shift_left:
            _, _, crs = mapper_at(traj, t)
            cx, cy = cx + a.shift * math.sin(crs), cy + a.shift * math.cos(crs)
            cx, cy = cx - a.shift_left * math.cos(crs), cy + a.shift_left * math.sin(crs)
        if a.no_title:
            title = ""
        suffix = "-dark" if a.theme == "dark" else ""
        path = os.path.join(a.out_dir, f"{name}{suffix}.{a.format}")
        n = render(scanners, traj, cx, cy, t, size, a.color, title, path, a.format, a.max_kb, a.hmin, a.hmax, a.stride, a.theme,
                   lane=a.lane, min_streak=a.min_streak, dot=a.dot, rotate=a.rotate)
        print(f"{path}  {n / 1024:.0f} KB")


if __name__ == "__main__":
    main()
