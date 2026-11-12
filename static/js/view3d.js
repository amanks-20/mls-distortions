/* ==========================================================================
   Optional 3D view of the distortion explorer (drawing only).
   Draws window.mlsSimulate3D(state) (static/js/simulate3d.js) on the
   explorer's canvas when the "3D" view is selected. explorer.js hands each
   frame to view.draw() while 3D is active; in "2D top view" nothing here runs
   and the 2D canvas is unchanged.

   Projection: orthographic (parallel lines stay parallel, so the skewed faces
   read correctly), camera orbiting the centre of the cloud. Frame as in the
   paper: x = mapper direction of travel, y = mapper's left, z up.
   ========================================================================== */
(function () {
    'use strict';

    var root = document.getElementById('explorer');
    var canvas = root && root.querySelector('canvas');
    if (!root || !canvas || !window.mlsSimulate3D || !window.mlsScanPlane) return;

    var D2R = Math.PI / 180;
    var DEFAULT = { yaw: -60, pitch: 30, zoom: 1 };     // about 30° elevation
    var PT_RADIUS = 1.6;                               // CSS px, same dot size as the 2D view
    // Cap on drawn dots per frame. Each dot is a canvas arc plus a depth sort;
    // ~6000 keeps rotation smooth on a mid-range phone while still showing
    // every face as discrete points. Above it the display thinning is coarsened.
    var MAX_POINTS = 6000;
    var FACE_SHADE = { top: 1.0, side: 0.82, front: 0.68, back: 0.56 };
    var MAPPER = { len: 4.5, wid: 1.8 };               // same footprint as the 2D drawing
    // Scan-plane patch: fill alpha, and how far (m) the clip box reaches above the scanner
    var PLANE_ALPHA = 0.25, PLANE_TOP = 0.5;

    var mode = '2d';
    var showPlane = true;
    var drawn = { planes: [] };                        // what the last frame drew (read by dev checks)
    var cam = { yaw: DEFAULT.yaw, pitch: DEFAULT.pitch, zoom: DEFAULT.zoom };
    var simCache = { key: null, sim: null, spacing: null };
    var maskCache = null;

    var viewBtns = root.querySelectorAll('[data-view]');
    var resetBtn = root.querySelector('#ex-3d-reset');
    var planeBtn = root.querySelector('#ex-3d-plane');
    var legendPlane = root.querySelector('#ex-legend-plane');
    var legendPlaneSwatch = legendPlane && legendPlane.querySelector('.l-plane');
    var legendPlaneText = legendPlane && legendPlane.querySelector('.l-plane-text');
    var notes = root.querySelector('#ex-3d-notes');
    var noteTop = root.querySelector('#ex-3d-notop');
    var box = canvas.parentNode;
    var label2d = canvas.getAttribute('aria-label');
    // Legend entry for the scan line: the 3D view does not draw one
    var legendLine = root.querySelector('.legend .l-line');
    legendLine = legendLine && legendLine.parentNode;

    function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

    function rgb(col) {
        var m = /^#([0-9a-f]{6})$/i.exec(col);
        if (!m) return [128, 128, 128];
        var n = parseInt(m[1], 16);
        return [n >> 16, (n >> 8) & 255, n & 255];
    }
    function shade(c, f) { return 'rgb(' + Math.round(c[0] * f) + ',' + Math.round(c[1] * f) + ',' + Math.round(c[2] * f) + ')'; }

    // ---------- simulation (cached per state) ----------
    function stateKey(s) { return [s.vm, s.vo, s.theta, s.side, s.phiH, s.phiV].join('|'); }

    function getSim(s) {
        var k = stateKey(s);
        if (simCache.key === k) return simCache.sim;
        var sim = window.mlsSimulate3D(s);
        simCache = { key: k, sim: sim, spacing: rawSpacing(sim) };
        maskCache = null;
        return sim;
    }

    // ---------- display thinning (same idea as Step 1's 2D thinning) ----------
    // Index each point within its segment (one polygon edge of one profile),
    // measure the raw spacing along a segment (dA) and between profiles (dP),
    // then keep every n-th profile and every m-th point so dots sit about the
    // density control's spacing apart on screen. First/last profile and both
    // ends of every segment are always kept, so outlines stay sharp.
    function rawSpacing(sim) {
        var pts = sim.pts, n = pts.length;
        var j = new Int32Array(n), seg = new Int32Array(n), segLen = [], sid = -1;
        for (var k = 0; k < n; k++) {
            var p = pts[k], q = pts[k - 1];
            if (!q || q.i !== p.i || q.face !== p.face) { sid++; segLen[sid] = 0; }
            seg[k] = sid; j[k] = segLen[sid]++;
        }
        var dA = [], first = {}, last = {};
        for (k = 0; k < n; k++) {
            if (j[k] === 0) first[seg[k]] = k;
            last[seg[k]] = k;
        }
        Object.keys(first).forEach(function (s) {
            var a = pts[first[s]], b = pts[last[s]], c = segLen[s];
            if (c > 1) dA.push(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (c - 1));
        });
        // profile gap measured across the scan line's horizontal trace
        var N = sim.N, h = Math.hypot(N[0], N[1]) || 1, perp = [N[0] / h, N[1] / h];
        var firstOf = {}, ids = [];
        pts.forEach(function (p, k) {
            if (!(p.i in firstOf) || (p.face === 'top' && pts[firstOf[p.i]].face !== 'top')) {
                if (!(p.i in firstOf)) ids.push(p.i);
                firstOf[p.i] = k;
            }
        });
        var dP = [];
        for (var q2 = 1; q2 < ids.length; q2++) {
            var a = pts[firstOf[ids[q2 - 1]]], b = pts[firstOf[ids[q2]]];
            dP.push(Math.abs((b.x - a.x) * perp[0] + (b.y - a.y) * perp[1]) / (ids[q2] - ids[q2 - 1]));
        }
        return { j: j, seg: seg, segLen: segLen, iMin: ids.length ? ids[0] : 0, iMax: ids.length ? ids[ids.length - 1] : 0,
                 dA: median(dA), dP: median(dP) };
    }
    function median(a) { if (!a.length) return 0; a.sort(function (x, y) { return x - y; }); return a[a.length >> 1]; }
    function picked(idx, len, stride) {
        if (len <= 1 || stride <= 1) return true;
        var nk = Math.max(1, Math.round((len - 1) / stride));
        return idx === Math.round(Math.round(idx * nk / (len - 1)) * (len - 1) / nk);
    }
    function displayMask(sim, scale, targetPx) {
        var bucket = Math.round(scale * 10) / 10;
        if (maskCache && maskCache.sim === sim && maskCache.scale === bucket && maskCache.target === targetPx) return maskCache;
        var sp = simCache.spacing, nI = sp.iMax - sp.iMin + 1, target = targetPx;
        var keep, count;
        for (var pass = 0; pass < 6; pass++) {
            var sP = sp.dP > 1e-9 ? Math.max(1, Math.round(target / (sp.dP * scale))) : 1;
            var sA = sp.dA > 1e-9 ? Math.max(1, Math.round(target / (sp.dA * scale))) : 1;
            keep = new Uint8Array(sim.pts.length); count = 0;
            for (var k = 0; k < sim.pts.length; k++) {
                var p = sim.pts[k];
                if (picked(p.i - sp.iMin, nI, sP) && picked(sp.j[k], sp.segLen[sp.seg[k]], sA)) { keep[k] = 1; count++; }
            }
            if (count <= MAX_POINTS) break;
            target *= Math.sqrt(count / MAX_POINTS) * 1.05;            // coarsen and retry
        }
        maskCache = { sim: sim, scale: bucket, target: targetPx, keep: keep, count: count, coarsened: target !== targetPx };
        return maskCache;
    }

    // ---------- camera ----------
    function basis(yawDeg, pitchDeg) {
        var y = yawDeg * D2R, p = pitchDeg * D2R;
        var f = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];   // towards the camera
        var r = [-Math.sin(y), Math.cos(y), 0];
        var u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
        return { f: f, r: r, u: u };
    }

    // ---------- drawing ----------
    function boxCorners(sim, t) {
        var c = [sim.c0[0] + sim.vo * t * sim.u[0], sim.c0[1] + sim.vo * t * sim.u[1]];
        var L = sim.size.length / 2, W = sim.size.width / 2, H = sim.size.height, out = [];
        [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(function (k) {
            out.push([c[0] + k[0] * L * sim.u[0] + k[1] * W * sim.w[0], c[1] + k[0] * L * sim.u[1] + k[1] * W * sim.w[1], 0]);
        });
        return out.concat(out.map(function (p) { return [p[0], p[1], H]; }));
    }
    // Plane (origin o, normal n) clipped to the axis-aligned box [lo, hi]:
    // the convex polygon of its crossings with the 12 box edges, in order.
    function clipPlane(o, n, lo, hi) {
        var c = [];
        for (var k = 0; k < 8; k++) c.push([k & 1 ? hi[0] : lo[0], k & 2 ? hi[1] : lo[1], k & 4 ? hi[2] : lo[2]]);
        var d = c.map(function (p) { return n[0] * (p[0] - o[0]) + n[1] * (p[1] - o[1]) + n[2] * (p[2] - o[2]); });
        var V = [];
        [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(function (e) {
            var a = d[e[0]], b = d[e[1]];
            if ((a > 0 && b > 0) || (a < 0 && b < 0) || a === b) return;
            var f = a / (a - b), A = c[e[0]], B = c[e[1]];
            V.push([A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])]);
        });
        if (V.length < 3) return [];
        var m = [0, 0, 0];
        V.forEach(function (p) { m[0] += p[0] / V.length; m[1] += p[1] / V.length; m[2] += p[2] / V.length; });
        var e1 = Math.abs(n[2]) < 0.9 ? [-n[1], n[0], 0] : [1, 0, 0];
        var e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
        function ang(p) {
            var q = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
            return Math.atan2(q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2], q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2]);
        }
        return V.sort(function (p, q) { return ang(p) - ang(q); });
    }

    // Keep the part of a convex polygon where d·(p − T) ≤ lim (Sutherland–Hodgman, one edge)
    function clipHalf(poly, d, T, lim) {
        var out = [];
        function f(p) { return (p[0] - T[0]) * d[0] + (p[1] - T[1]) * d[1] + (p[2] - T[2]) * d[2] - lim; }
        for (var k = 0; k < poly.length; k++) {
            var A = poly[k], B = poly[(k + 1) % poly.length], fa = f(A), fb = f(B);
            if (fa <= 0) out.push(A);
            if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
                var g = fa / (fa - fb);
                out.push([A[0] + g * (B[0] - A[0]), A[1] + g * (B[1] - A[1]), A[2] + g * (B[2] - A[2])]);
            }
        }
        return out;
    }

    var BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

    // ---------- low-poly mapper car (drawing only) ----------
    // Inside the same 4.5 m x 1.8 m footprint as before (x -2.25..+2.25 m from the
    // mapper centre, y -0.9..+0.9 m including the wheels), nose towards +x,
    // CAR_H = 1.6 m high (below the 2.5 m scanner height). Convex parts, each an
    // extruded side profile (x, z, half-width): a lower body with a sloped hood
    // and a tapered tail (top surface CAR_TOP = 0.95 m, where the scanner stems
    // start), a narrower cabin with a sloped windshield and rear window, and four
    // round wheels. Only faces turned towards the camera are drawn for the body
    // and cabin (convex, so they never overlap within a part).
    // The body is 0.06 m narrower per side at the rear (0.84 m) than the 2D car,
    // so the wheels' outer faces at y = +-0.90 m stand proud of it.
    var CAR_H = 1.6, CAR_TOP = 0.95;
    var CAR_BODY = [[-2.25, 0.30, 0.84], [-2.15, CAR_TOP, 0.83], [1.45, CAR_TOP, 0.82], [2.25, 0.72, 0.76], [2.25, 0.30, 0.78]];
    var CAR_CABIN = [[-1.35, CAR_TOP, 0.70], [-0.95, CAR_H, 0.62], [0.45, CAR_H, 0.62], [1.10, CAR_TOP, 0.72]];
    var CAR_GLASS = { 0: true, 2: true };              // cabin profile edges 0 (rear window) and 2 (windshield)
    // Wheels: cylinders with their axis along y, WHEEL.seg segments, the tyre on
    // the ground (axle height = radius). Each is split at the body side (|y| = 0.84
    // m) into an inner part, painted before the body (the body covers it), and an
    // outer part, painted after the body and cabin when it is on the camera's side.
    var WHEEL = { r: 0.32, w: 0.22, seg: 20, axles: [1.35, -1.35], out: 0.90, split: 0.84, hub: 0.55 };
    var TYRE = [44, 44, 48];                           // tread, both themes
    var HUB = [92, 92, 98];                            // hub disc on the outer face
    function carPart(prof, closeBase) {
        // faces: one quad per profile edge (left-right), plus the two side polygons
        var L = prof.map(function (q) { return [q[0], q[2], q[1]]; }), R = prof.map(function (q) { return [q[0], -q[2], q[1]]; });
        var faces = [], n = prof.length, last = closeBase ? n : n - 1;
        for (var i = 0; i < last; i++) {
            var j = (i + 1) % n;
            faces.push({ v: [L[i], L[j], R[j], R[i]], edge: i });
        }
        faces.push({ v: L.slice(), edge: -1 }, { v: R.slice().reverse(), edge: -2 });
        return faces;
    }
    // One cylinder slice between |y| = y0 and y1 (y1 outer) on side sg (+1 left, -1 right)
    function wheelSlice(ax, sg, y0, y1, withHub) {
        var ring = function (y) {
            var out = [];
            for (var k = 0; k < WHEEL.seg; k++) {
                var a = 2 * Math.PI * k / WHEEL.seg;
                out.push([ax + WHEEL.r * Math.cos(a), sg * y, WHEEL.r + WHEEL.r * Math.sin(a)]);
            }
            return out;
        };
        var A = ring(y0), Bq = ring(y1), faces = [];
        for (var k = 0; k < WHEEL.seg; k++) {
            var k2 = (k + 1) % WHEEL.seg, mid = 2 * Math.PI * (k + 0.5) / WHEEL.seg;
            faces.push({ v: [A[k], A[k2], Bq[k2], Bq[k]], n: [Math.cos(mid), 0, Math.sin(mid)], kind: 'tread' });
        }
        faces.push({ v: A.slice().reverse(), n: [0, -sg, 0], kind: 'disc' }, { v: Bq, n: [0, sg, 0], kind: 'disc' });
        if (withHub) faces.push({ v: Bq.map(function (p) { return [ax + (p[0] - ax) * WHEEL.hub, p[1], WHEEL.r + (p[2] - WHEEL.r) * WHEEL.hub]; }),
                                  n: [0, sg, 0], kind: 'hub' });
        return faces;
    }
    var CAR_PARTS = (function () {
        var wheels = [];
        WHEEL.axles.forEach(function (ax) {
            [1, -1].forEach(function (sg) {
                wheels.push({ side: sg, inner: wheelSlice(ax, sg, WHEEL.out - WHEEL.w, WHEEL.split, false),
                              outer: wheelSlice(ax, sg, WHEEL.split, WHEEL.out, true) });
            });
        });
        return { wheels: wheels, body: carPart(CAR_BODY, true), cabin: carPart(CAR_CABIN, false) };
    })();
    function faceClass(nrm) {
        var len = Math.hypot(nrm[0], nrm[1], nrm[2]), nz = nrm[2] / len, nx = nrm[0] / len, ny = nrm[1] / len;
        return nz >= Math.max(Math.abs(nx), Math.abs(ny)) ? 'top' : Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? 'front' : 'back') : 'side';
    }
    function drawCar3D(ctx, mx, base, edgeCol, B, P, wheelEdge) {
        function path(v) {
            ctx.beginPath();
            v.forEach(function (p, i) { var q = P(mx + p[0], p[1], p[2]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
            ctx.closePath();
        }
        function facing(n) { return n[0] * B.f[0] + n[1] * B.f[1] + n[2] * B.f[2] > 1e-9; }   // the camera-side test
        function paint(faces, isCabin) {
            var c = [0, 0, 0], m = 0;                     // part centroid, to orient normals outwards
            faces.forEach(function (f) { f.v.forEach(function (p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; m++; }); });
            c = [c[0] / m, c[1] / m, c[2] / m];
            faces.forEach(function (f) {
                var a = f.v[0], b = f.v[1], d = f.v[2];
                var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
                var nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
                var fc = [0, 0, 0];
                f.v.forEach(function (p) { fc[0] += p[0] / f.v.length; fc[1] += p[1] / f.v.length; fc[2] += p[2] / f.v.length; });
                if (nrm[0] * (fc[0] - c[0]) + nrm[1] * (fc[1] - c[1]) + nrm[2] * (fc[2] - c[2]) < 0) nrm = [-nrm[0], -nrm[1], -nrm[2]];
                if (!facing(nrm)) return;                                                // turned away
                // the box's face shading: top, side, front (+x), back (-x), by the dominant axis
                var fct = FACE_SHADE[faceClass(nrm)];
                if (isCabin && CAR_GLASS[f.edge]) fct *= 0.62;
                path(f.v);
                ctx.fillStyle = shade(base, fct); ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
                ctx.strokeStyle = edgeCol; ctx.lineWidth = 1; ctx.stroke();
            });
        }
        // A wheel slice, opaque: faces turned away first, then the visible ones,
        // hub last. Tread quads are stroked in their own colour (no seams), the
        // discs' rims in the wheel edge colour.
        function paintWheel(faces) {
            var back = [], front = [], hub = [];
            faces.forEach(function (f) { (f.kind === 'hub' ? hub : facing(f.n) ? front : back).push(f); });
            back.concat(front, hub).forEach(function (f) {
                var col = f.kind === 'hub' ? HUB : TYRE, fct = f.kind === 'tread' ? FACE_SHADE[faceClass(f.n)] : FACE_SHADE.side;
                if (f.kind === 'hub' && !facing(f.n)) return;
                path(f.v);
                ctx.fillStyle = shade(col, fct); ctx.fill();
                ctx.strokeStyle = f.kind === 'tread' ? ctx.fillStyle : wheelEdge; ctx.lineWidth = f.kind === 'tread' ? 0.6 : 1; ctx.stroke();
            });
        }
        var camSide = B.f[1] >= 0 ? 1 : -1;               // the camera is on the car's left (+y) or right
        CAR_PARTS.wheels.forEach(function (w) { paintWheel(w.inner); if (w.side !== camSide) paintWheel(w.outer); });
        paint(CAR_PARTS.body, false);
        paint(CAR_PARTS.cabin, true);
        CAR_PARTS.wheels.forEach(function (w) { if (w.side === camSide) paintWheel(w.outer); });
    }

    function draw(cv, ctx, state, progress, targetPx) {
        var dpr = window.devicePixelRatio || 1;
        var W = cv.clientWidth, H = cv.clientHeight;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
            cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        var sim = getSim(state);
        var tNow = sim.t0 + (sim.t1 - sim.t0) * progress;
        var muted = css('--muted'), line = css('--line'), text = css('--text');
        var ptBase = rgb(state.side === 'R' ? css('--right') : css('--left'));
        var objCol = css('--object'), mapCol = css('--mapper') || '#f4a6c8';

        // Scene extent: cloud, true box at first/last contact, mapper over the scan
        var first = boxCorners(sim, sim.t0), last = boxCorners(sim, sim.t1);
        var ext = first.concat(last), cloud = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        sim.pts.forEach(function (p) {
            cloud[0] = Math.min(cloud[0], p.x); cloud[1] = Math.min(cloud[1], p.y); cloud[2] = Math.min(cloud[2], p.z);
            cloud[3] = Math.max(cloud[3], p.x); cloud[4] = Math.max(cloud[4], p.y); cloud[5] = Math.max(cloud[5], p.z);
        });
        [sim.t0, sim.t1].forEach(function (t) {
            ext.push([sim.vm * t - MAPPER.len / 2, -MAPPER.wid / 2, 0], [sim.vm * t + MAPPER.len / 2, MAPPER.wid / 2, sim.hScanner]);
        });
        if (sim.pts.length) ext.push([cloud[0], cloud[1], cloud[2]], [cloud[3], cloud[4], cloud[5]]);
        var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        ext.forEach(function (p) { for (var a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); } });
        var T = sim.pts.length ? [(cloud[0] + cloud[3]) / 2, (cloud[1] + cloud[4]) / 2, (cloud[2] + cloud[5]) / 2]
                               : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        // Display translation by the selected scanner's mounting offset
        // (window.mlsScannerMount, explorer.js): everything but the mapper body
        // moves with it. The fit below is computed as before and the camera
        // target T moves with the scene.
        var MNT = window.mlsScannerMount || { L: [0, 0], R: [0, 0] };
        var o2 = MNT[state.side], oO = MNT[state.side === 'R' ? 'L' : 'R'];
        var off = [o2[0], o2[1], 0];
        function D(p) { return [p[0] + off[0], p[1] + off[1], p[2] + off[2]]; }
        // Fit: scene seen from the DEFAULT camera, centred on the cloud. Using
        // the default (not the current) camera keeps the scale steady while rotating.
        var B0 = basis(DEFAULT.yaw, DEFAULT.pitch), mxp = 1e-6, myp = 1e-6;
        ext.forEach(function (p) {
            var dx = p[0] - T[0], dy = p[1] - T[1], dz = p[2] - T[2];
            mxp = Math.max(mxp, Math.abs(dx * B0.r[0] + dy * B0.r[1] + dz * B0.r[2]));
            myp = Math.max(myp, Math.abs(dx * B0.u[0] + dy * B0.u[1] + dz * B0.u[2]));
        });
        // Relative to the scene the mapper body sits at -offset. Only if its
        // footprint there (over the scan, up to the scanner height) would leave
        // the fitted window is the window panned by the overflow, and only if it
        // cannot fit at this scale is the view widened (seen from the default
        // camera, like the fit). Otherwise the scene is framed exactly as before.
        var cR = [Infinity, -Infinity], cU = [Infinity, -Infinity], bR = [Infinity, -Infinity], bU = [Infinity, -Infinity];
        function pr(p, R, U) {
            var dx = p[0] - T[0], dy = p[1] - T[1], dz = p[2] - T[2];
            var r = dx * B0.r[0] + dy * B0.r[1] + dz * B0.r[2], u = dx * B0.u[0] + dy * B0.u[1] + dz * B0.u[2];
            R[0] = Math.min(R[0], r); R[1] = Math.max(R[1], r); U[0] = Math.min(U[0], u); U[1] = Math.max(U[1], u);
        }
        ext.forEach(function (p) { pr(p, cR, cU); });
        [sim.t0, sim.t1].forEach(function (t) {     // the same two corners the fit's extent uses, shifted
            pr([sim.vm * t - MAPPER.len / 2 - off[0], -MAPPER.wid / 2 - off[1], 0], bR, bU);
            pr([sim.vm * t + MAPPER.len / 2 - off[0], MAPPER.wid / 2 - off[1], sim.hScanner], bR, bU);
        });
        function fitAxis(half, c, b) {        // window [-half, half] around T must hold c and b
            var lo = Math.min(c[0], b[0]), hi = Math.max(c[1], b[1]);
            if (lo >= -half && hi <= half) return { d: 0, half: half };
            if (hi - lo <= 2 * half) return { d: Math.min(Math.max(0, hi - half), lo + half), half: half };
            return { d: (lo + hi) / 2, half: (hi - lo) / 2 };
        }
        var fR = fitAxis(mxp, cR, bR), fU = fitAxis(myp, cU, bU);
        if (fR.d || fU.d) T = [T[0] + fR.d * B0.r[0] + fU.d * B0.u[0], T[1] + fR.d * B0.r[1] + fU.d * B0.u[1], T[2] + fR.d * B0.r[2] + fU.d * B0.u[2]];
        mxp = fR.half; myp = fU.half;
        var scale = Math.min((W / 2 - 24) / mxp, (H / 2 - 28) / myp) * cam.zoom;

        T = D(T);
        var B = basis(cam.yaw, cam.pitch);
        function P(x, y, z) {
            var dx = x - T[0], dy = y - T[1], dz = z - T[2];
            return [W / 2 + (dx * B.r[0] + dy * B.r[1] + dz * B.r[2]) * scale,
                    H / 2 - (dx * B.u[0] + dy * B.u[1] + dz * B.u[2]) * scale,
                    dx * B.f[0] + dy * B.f[1] + dz * B.f[2]];
        }
        function seg(a, b) { var p = P(a[0], a[1], a[2]), q = P(b[0], b[1], b[2]); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }

        // Ground grid (z = 0)
        var span = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
        var step = span > 60 ? 10 : span > 25 ? 5 : 1;
        var gx0 = Math.floor((lo[0] - 2) / step) * step, gx1 = Math.ceil((hi[0] + 2) / step) * step;
        var gy0 = Math.floor((lo[1] - 2) / step) * step, gy1 = Math.ceil((hi[1] + 2) / step) * step;
        ctx.strokeStyle = line; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.beginPath();
        for (var gx = gx0; gx <= gx1 + 1e-9; gx += step) seg(D([gx, gy0, 0]), D([gx, gy1, 0]));
        for (var gy = gy0; gy <= gy1 + 1e-9; gy += step) seg(D([gx0, gy, 0]), D([gx1, gy, 0]));
        ctx.stroke(); ctx.globalAlpha = 1;

        // Scan plane of the selected scanner through the scanner at tNow, clipped
        // to the scene's bounding box (box over the scan, mapper, cloud) from the
        // ground to just above the scanner, and drawn under everything else.
        drawn.planes = [];
        var rec = window.mlsRecordDraw ? { view: '3d', off: off, offOther: [oO[0], oO[1], 0], T: T, scale: scale, W: W, H: H, pts: [], boxes: {} } : null;
        if (showPlane) {
            var clo = D([lo[0], lo[1], 0]);
            var chi = D([hi[0], hi[1], Math.max(hi[2], sim.hScanner) + PLANE_TOP]);
            [state.side].forEach(function (sd) {
                var pl = window.mlsScanPlane(state, sd, tNow, { hScanner: sim.hScanner });
                var org = D(pl.origin);
                var poly = clipPlane(org, pl.normal, clo, chi);
                // ...and to the window the fit frames from the default camera, so the
                // patch stays inside the scene's framing (steady while rotating)
                [[B0.r, mxp], [B0.u, myp]].forEach(function (c) {
                    poly = clipHalf(poly, c[0], T, c[1]);
                    poly = clipHalf(poly, [-c[0][0], -c[0][1], -c[0][2]], T, c[1]);
                });
                if (poly.length < 3) return;
                ctx.beginPath();
                poly.forEach(function (v, k) { var p = P(v[0], v[1], v[2]); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
                ctx.closePath();
                ctx.fillStyle = sd === 'R' ? css('--right') : css('--left');
                ctx.globalAlpha = PLANE_ALPHA; ctx.fill();
                ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1;
                ctx.globalAlpha = 0.7; ctx.stroke();
                ctx.globalAlpha = 1;
                drawn.planes.push(sd);
                if (rec) rec.plane = { origin: org, normal: pl.normal, poly: poly };
            });
        }

        function wire(c, stroke, dash, width) {
            ctx.beginPath();
            BOX_EDGES.forEach(function (e) { seg(c[e[0]], c[e[1]]); });
            ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
        // True box at first and last contact (dashed, muted)
        var firstD = first.map(D), lastD = last.map(D);
        wire(firstD, muted, [5, 4]);
        wire(lastD, muted, [5, 4]);
        if (rec) { rec.boxes.first = firstD; rec.boxes.last = lastD; }

        // Mapper footprint on the ground and the scanner on its mast
        var mx = sim.vm * tNow, Lm = MAPPER.len / 2, Wm = MAPPER.wid / 2;
        var foot = [[mx - Lm, Wm], [mx + 1.6, Wm], [mx + Lm, 0], [mx + 1.6, -Wm], [mx - Lm, -Wm]];
        drawCar3D(ctx, mx, rgb(mapCol), muted, B, P, shade(rgb(muted), 0.5));
        // Scanners at the body's rear corners, both on masts of height H_SCANNER.
        // The other one: a small solid diamond in its own colour (half-diagonal
        // 3.5 px, half the selected scanner's 7 px diamond) with a thin ring (the
        // text colour on a light page, the background colour on a dark one) so it
        // stands out against the pink body. A path, not an arc, so
        // tests/perf3d.py's dot count is unchanged.
        var hS = sim.hScanner, scO = [mx + oO[0], oO[1], hS], scS = [mx + off[0], off[1], hS];
        var ob = P(scO[0], scO[1], 0), po = P(scO[0], scO[1], scO[2]), dO = 3.5;
        // stems start on the car's top surface (z = CAR_TOP; the markers sit over the trunk)
        ctx.beginPath(); seg([scO[0], scO[1], CAR_TOP], scO); ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(po[0], po[1] - dO); ctx.lineTo(po[0] + dO, po[1]); ctx.lineTo(po[0], po[1] + dO); ctx.lineTo(po[0] - dO, po[1]); ctx.closePath();
        ctx.fillStyle = state.side === 'R' ? css('--left') : css('--right'); ctx.fill();
        var bgc = rgb(css('--bg')), dark = 0.299 * bgc[0] + 0.587 * bgc[1] + 0.114 * bgc[2] < 128;
        ctx.strokeStyle = dark ? css('--bg') : text; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); seg([scS[0], scS[1], CAR_TOP], scS); ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.stroke();
        var sp = P(scS[0], scS[1], scS[2]);
        if (rec) rec.markers = { sel: scS, other: scO, mapper: foot.map(function (q) { return [q[0], q[1], 0]; }),
                                 otherBox: [Math.min(ob[0], po[0]) - dO - 1, Math.min(ob[1], po[1]) - dO - 1, Math.max(ob[0], po[0]) + dO + 1, Math.max(ob[1], po[1]) + dO + 1] };
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 3.5, 0, 2 * Math.PI); ctx.fillStyle = shade(ptBase, 1); ctx.fill();
        if (showPlane) {
            // scanner marker at the plane's origin: an outlined diamond (paths, not arcs,
            // so tests/perf3d.py's dot count stays "arcs minus the scanner dot")
            ctx.beginPath();
            ctx.moveTo(sp[0], sp[1] - 7); ctx.lineTo(sp[0] + 7, sp[1]); ctx.lineTo(sp[0], sp[1] + 7); ctx.lineTo(sp[0] - 7, sp[1]);
            ctx.closePath(); ctx.strokeStyle = text; ctx.lineWidth = 1.2; ctx.stroke();
        }

        // Box now: light fill in the object colour (22%, as in 2D) on the faces
        // turned to the camera only, so the tint stays even. Drawn before the
        // points so the cloud stays at full colour; the outline is drawn after.
        var nowD = progress < 1 ? boxCorners(sim, tNow).map(D) : null;
        if (nowD) {
            var bc = [0, 0, 0];
            nowD.forEach(function (p) { bc[0] += p[0] / 8; bc[1] += p[1] / 8; bc[2] += p[2] / 8; });
            var boxFaces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
            ctx.fillStyle = objCol; ctx.globalAlpha = 0.22;
            ctx.beginPath();
            boxFaces.forEach(function (f) {
                var a = nowD[f[0]], b = nowD[f[1]], d = nowD[f[3]];
                var u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
                var n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
                var fc = [0, 0, 0];
                f.forEach(function (i) { fc[0] += nowD[i][0] / 4; fc[1] += nowD[i][1] / 4; fc[2] += nowD[i][2] / 4; });
                if (n[0] * (fc[0] - bc[0]) + n[1] * (fc[1] - bc[1]) + n[2] * (fc[2] - bc[2]) < 0) n = [-n[0], -n[1], -n[2]];
                if (n[0] * B.f[0] + n[1] * B.f[1] + n[2] * B.f[2] <= 1e-9) return;   // turned away
                f.forEach(function (i, j) {
                    var q = P(nowD[i][0], nowD[i][1], nowD[i][2]);
                    if (j) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
                });
                ctx.closePath();
            });
            ctx.fill(); ctx.globalAlpha = 1;
        }

        // Points captured so far: thinned, depth-sorted (far first), shaded by face
        var mask = displayMask(sim, scale, targetPx);
        var vis = [];
        for (var k = 0; k < sim.pts.length; k++) {
            if (!mask.keep[k]) continue;
            var p = sim.pts[k];
            if (p.t > tNow + 1e-9) continue;
            var q = P(p.x + off[0], p.y + off[1], p.z + off[2]);
            vis.push([q[2], q[0], q[1], p.face]);
            if (rec) rec.pts.push([k, p.x + off[0], p.y + off[1], p.z + off[2]]);
        }
        vis.sort(function (a, b) { return a[0] - b[0]; });
        var cur = null;
        for (k = 0; k < vis.length; k++) {
            var v = vis[k];
            if (v[3] !== cur) {
                if (cur !== null) ctx.fill();
                cur = v[3]; ctx.fillStyle = shade(ptBase, FACE_SHADE[cur] || 1); ctx.beginPath();
            }
            ctx.moveTo(v[1] + PT_RADIUS, v[2]);
            ctx.arc(v[1], v[2], PT_RADIUS, 0, 2 * Math.PI);
        }
        if (cur !== null) ctx.fill();

        // Box now (while scanning)
        if (nowD) {
            wire(nowD, objCol, null, 1.2);
            if (rec) rec.boxes.now = nowD;
        }
        if (rec) { rec.tNow = tNow; rec.progress = progress; rec.cam = { yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom }; window.mlsDrawRecord = rec; }

        // Axis hint
        ctx.fillStyle = muted; ctx.font = '12px ' + css('--font');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('3D · drag to rotate, wheel or pinch to zoom', 12, H - 12);

        updateNotes(sim);
        updateLegend(state.side);
    }

    // Legend entry for the plane: the selected scanner only, 3D only, hidden when off
    function updateLegend(side) {
        if (!legendPlane) return;
        legendPlane.hidden = !(mode === '3d' && showPlane);
        if (legendPlaneSwatch) legendPlaneSwatch.classList.toggle('left', side === 'L');
        var t = side === 'L' ? 'scan plane (left, red)' : 'scan plane (right, blue)';
        if (legendPlaneText && legendPlaneText.textContent !== t) legendPlaneText.textContent = t;
    }

    function updateNotes(sim) {
        if (!notes) return;
        var hasTop = sim.pts.some(function (p) { return p.face === 'top'; });
        if (noteTop) noteTop.hidden = hasTop;
    }

    // ---------- mode toggle ----------
    function setMode(m) {
        mode = m;
        var on = m === '3d';
        viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === m)); });
        if (resetBtn) resetBtn.hidden = !on;
        if (planeBtn) planeBtn.hidden = !on;
        if (legendPlane) legendPlane.hidden = !(on && showPlane);
        if (notes) notes.hidden = !on;
        if (legendLine) legendLine.hidden = on;
        box.classList.toggle('is-3d', on);
        if (on) {
            canvas.setAttribute('tabindex', '0');
            canvas.setAttribute('aria-label', '3D view of the scanned points. Drag or use the arrow keys to rotate; mouse wheel, pinch, or + and − to zoom.');
        } else {
            canvas.removeAttribute('tabindex');
            if (label2d) canvas.setAttribute('aria-label', label2d);
        }
        if (window.mlsRedraw) window.mlsRedraw();
    }
    viewBtns.forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.view); }); });

    var pending = false;
    function redrawSoon() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () { pending = false; if (window.mlsRedraw) window.mlsRedraw(); });
    }
    function resetView() { cam.yaw = DEFAULT.yaw; cam.pitch = DEFAULT.pitch; cam.zoom = DEFAULT.zoom; redrawSoon(); }
    if (resetBtn) resetBtn.addEventListener('click', resetView);
    if (planeBtn) planeBtn.addEventListener('click', function () {
        showPlane = !showPlane;
        planeBtn.setAttribute('aria-pressed', String(showPlane));
        if (legendPlane) legendPlane.hidden = !(mode === '3d' && showPlane);
        redrawSoon();
    });

    function rotate(dYaw, dPitch) {
        cam.yaw = ((cam.yaw + dYaw) % 360 + 360) % 360;
        cam.pitch = Math.max(5, Math.min(89, cam.pitch + dPitch));
        redrawSoon();
    }
    function zoomBy(f) { cam.zoom = Math.max(0.3, Math.min(8, cam.zoom * f)); redrawSoon(); }

    // ---------- pointer, wheel and keyboard controls (3D only) ----------
    var ptrs = {}, pinch0 = null;
    canvas.addEventListener('pointerdown', function (e) {
        if (mode !== '3d') return;
        ptrs[e.pointerId] = [e.clientX, e.clientY];
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
        var ids = Object.keys(ptrs);
        if (ids.length === 2) pinch0 = { d: dist(ptrs[ids[0]], ptrs[ids[1]]), zoom: cam.zoom };
    });
    canvas.addEventListener('pointermove', function (e) {
        if (mode !== '3d' || !ptrs[e.pointerId]) return;
        var prev = ptrs[e.pointerId];
        ptrs[e.pointerId] = [e.clientX, e.clientY];
        var ids = Object.keys(ptrs);
        if (ids.length >= 2 && pinch0) {
            var d = dist(ptrs[ids[0]], ptrs[ids[1]]);
            if (pinch0.d > 0) { cam.zoom = Math.max(0.3, Math.min(8, pinch0.zoom * d / pinch0.d)); redrawSoon(); }
        } else if (ids.length === 1) {
            rotate(-(e.clientX - prev[0]) * 0.4, (e.clientY - prev[1]) * 0.4);
        }
    });
    function lift(e) { delete ptrs[e.pointerId]; if (Object.keys(ptrs).length < 2) pinch0 = null; }
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

    canvas.addEventListener('wheel', function (e) {
        if (mode !== '3d') return;
        e.preventDefault();
        zoomBy(Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });

    canvas.addEventListener('keydown', function (e) {
        if (mode !== '3d') return;
        var k = e.key, used = true;
        if (k === 'ArrowLeft') rotate(-5, 0);
        else if (k === 'ArrowRight') rotate(5, 0);
        else if (k === 'ArrowUp') rotate(0, 5);
        else if (k === 'ArrowDown') rotate(0, -5);
        else if (k === '+' || k === '=') zoomBy(1.15);
        else if (k === '-' || k === '_') zoomBy(1 / 1.15);
        else if (k === 'Home' || k === '0') resetView();
        else used = false;
        if (used) e.preventDefault();
    });

    window.mlsView3D = {
        active: function () { return mode === '3d'; },
        draw: draw,
        setMode: setMode,
        camera: cam,
        drawn: drawn
    };

    // ?view=3d opens the 3D view directly (no effect otherwise)
    var q = new URLSearchParams(window.location.search);
    if (q.get('view') === '3d') setMode('3d');
})();
