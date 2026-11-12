/* ==========================================================================
   Distortion explorer
   Two things run side by side:
   1. model(): the closed-form equations from the paper (length, γ, β, α).
   2. simulate(): a top-view scan of a moving box by a tilted 2D profile
      scanner, built from first principles. Nothing in it uses the equations,
      so the drawing is an independent check of them.
   Speeds are entered in km/h. Only ratios matter for the distortion.
   ========================================================================== */
(function () {
    'use strict';

    var root = document.getElementById('explorer');
    if (!root) return;

    var D2R = Math.PI / 180;
    var R2D = 180 / Math.PI;

    // Object (thesis simulation): 4 m long, 2 m wide, 1.5 m high
    var LEN = 4, WID = 2;
    var PROFILE_STEP = 0.05;    // max step of the scan line between profiles (m)
    var MAX_PROFILES = 2000;
    var SAMPLE = 0.1;           // point spacing along a profile (m)
    var OVER_SCAN_TIME = 2.5;   // scan time shown for exact over-elongation (s)
    var MAX_SCAN_TIME = 30;     // cap for near over-elongation (s)

    // Scanner mounting positions on the drawn mapper, relative to the centre of
    // its 4.5 m x 1.8 m body (x forward, y left), in metres. DISPLAY ONLY and
    // ILLUSTRATIVE: the thesis and paper figures show the scanners at the rear
    // of the roof, left and right, but give no dimensions. Rear-left and
    // rear-right corners, inset 0.55 m from the rear and 0.25 m from the sides.
    // The simulation keeps the selected scanner at the origin; at draw time
    // every scene element (cloud, boxes, scan line or plane, scanner marker) is
    // translated by the selected scanner's offset while the mapper body stays
    // put, so the point cloud itself is unchanged. Shared with view3d.js.
    var MOUNT = { L: [-1.7, 0.65], R: [-1.7, -0.65] };
    window.mlsScannerMount = MOUNT;

    var state = { vm: 40, vo: 20, theta: 0, side: 'R', phiH: 45, phiV: 30 };

    // ---------- Closed-form model (paper, Section "Derivation") ----------
    function model(s) {
        var t = s.theta * D2R, ph = s.phiH * D2R, pv = s.phiV * D2R;
        var vm = s.vm, vo = s.vo;

        // Speed of the scan line along the object's path (signed:
        // positive = same direction as the object).
        var den = s.side === 'R' ? Math.cos(t - ph) : Math.cos(t + ph);
        var vl = Math.abs(den) < 1e-9 ? Infinity : vm * Math.cos(ph) / den;

        var rel = vo - vl;                       // v_o,l, signed
        var scale = Math.max(Math.abs(vl), vo, 1e-9);
        var together = isFinite(vl) && Math.abs(rel) / scale < 1e-6;

        var ratio = !isFinite(vl) ? 1 : (together ? NaN : vl / (vl - vo));

        // Intersection angles
        var pg = s.side === 'R' ? t - ph : t + ph;
        var Pb = function (h) {
            var c = Math.cos(h - t);
            return Math.acos(-c / Math.sqrt(Math.pow(Math.tan(pv), 2) + c * c));
        };
        var pb;
        if (s.side === 'R') pb = s.theta < 180 - s.phiH ? Math.PI - Pb(ph) : -Pb(ph);
        else pb = s.theta < s.phiH ? Math.PI - Pb(-ph) : -Pb(-ph);

        var g, b;
        if (vo === 0 || !isFinite(vl)) { g = 0; b = 0; }
        else if (together) { g = pg; b = pb; }
        else { g = Math.atan(vo * Math.tan(pg) / rel); b = Math.atan(vo * Math.tan(pb) / rel); }

        var sg = s.theta < 180 - s.phiH ? 1 : -1;
        var a = Math.PI / 2 - Math.acos(sg * Math.sin(g) * Math.sin(b));

        return {
            vl: vl, ratio: ratio, ls: ratio * LEN, together: together,
            gamma: wrap90(g * R2D), beta: wrap90(b * R2D), alpha: a * R2D
        };
    }

    function wrap90(d) {          // keep tilt angles in (-90°, 90°]
        while (d > 90) d -= 180;
        while (d <= -90) d += 180;
        return d;
    }

    function classify(s, m) {
        if (s.vo === 0) return { name: 'No distortion', text: 'The object is static, so ego-motion compensation alone gives the true shape.' };
        if (!isFinite(m.vl)) return { name: 'Instant capture', text: 'The scan line lies along the object’s path, so the whole length is captured at once.' };
        if (m.together) return { name: 'Over-elongation', text: 'The scan line moves with the object, so it keeps sampling the same slice. The cloud becomes a streak whose length depends only on scan time.' };
        if (m.vl < 0) return { name: 'Contraction', text: 'Scanner and object meet head-on (vₗ opposes vₒ). The scan runs front → back, so the object looks shorter and the points are denser.' };
        if (m.vl > s.vo) return { name: 'Elongation', text: 'The scan line overtakes the object from behind (vₗ > vₒ). The scan runs back → front, so the object looks longer and the points are sparser.' };
        var half = s.vo / 2, eps = 1e-6 * s.vo;
        var kind = Math.abs(m.vl - half) < eps ? 'retention' : (m.vl < half ? 'contraction' : 'elongation');
        var detail = kind === 'retention' ? 'the length happens to come out right'
            : kind === 'contraction' ? 'the length also shrinks (0 < vₗ < vₒ/2)'
            : 'the length also stretches (vₒ/2 < vₗ < vₒ)';
        return { name: 'Layover ' + kind, text: 'The object outruns the scan line (0 < vₗ < vₒ), so its front and back swap places in the cloud; ' + detail + '.' };
    }

    // ---------- Independent top-view simulation ----------
    function simulate(s) {
        var kmh = 1 / 3.6;
        var vm = s.vm * kmh, vo = s.vo * kmh;
        var th = s.theta * D2R, ph = s.phiH * D2R;

        var u = [Math.cos(th), Math.sin(th)];          // object heading
        var w = [-u[1], u[0]];                        // object left
        // Ground trace of the scan plane: normal n, direction d (x forward, y left)
        var n = s.side === 'R' ? [Math.cos(ph), Math.sin(ph)] : [Math.cos(ph), -Math.sin(ph)];
        var d = [-n[1], n[0]];
        if (d[1] < 0) d = [-d[0], -d[1]];             // point the line toward +y

        // Start with the object centred on the scan line, 7 m to the side
        var c0 = [d[0] * (7 / d[1]), 7];

        var dot = function (a, b) { return a[0] * b[0] + a[1] * b[1]; };
        var corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(function (k) {
            return [k[0] * LEN / 2 * u[0] + k[1] * WID / 2 * w[0], k[0] * LEN / 2 * u[1] + k[1] * WID / 2 * w[1]];
        });

        // Signed distance of a corner from the scan line is a_i + k t (same k for all)
        var k = vo * dot(n, u) - vm * n[0];
        var a = corners.map(function (o) { return dot(n, [c0[0] + o[0], c0[1] + o[1]]); });
        var amin = Math.min.apply(null, a), amax = Math.max.apply(null, a);

        var t0, t1, capped = false;
        if (Math.abs(k) < 1e-9) { t0 = 0; t1 = OVER_SCAN_TIME; capped = true; }
        else {
            t0 = Math.min(-amax / k, -amin / k);
            t1 = Math.max(-amax / k, -amin / k);
            if (t1 - t0 > MAX_SCAN_TIME) { t1 = t0 + MAX_SCAN_TIME; capped = true; }
        }
        // Enough profiles that the line steps at most PROFILE_STEP across the
        // box and along its path. Real scanners sample more coarsely; this
        // keeps the drawn shape faithful at any speed.
        var vl = Math.abs(k) < 1e-9 ? vo : vm * n[0] / dot(n, u);
        var dur = t1 - t0;
        var nProf = Math.ceil(Math.max(Math.abs(k) * dur, Math.abs(vl) * dur, vo * dur) / PROFILE_STEP);
        nProf = Math.max(2, Math.min(MAX_PROFILES, nProf));
        var sample = SAMPLE * Math.max(1, nProf / 400);
        var pts = [];
        for (var i = 0; i <= nProf; i++) {
            var t = t0 + (t1 - t0) * i / nProf;
            var sc = [vm * t, 0];
            var c = [c0[0] + vo * t * u[0], c0[1] + vo * t * u[1]];
            // Clip the line sc + λ d against the box in its local frame
            var rel = [sc[0] - c[0], sc[1] - c[1]];
            var lo = -Infinity, hi = Infinity;
            [[u, LEN / 2], [w, WID / 2]].forEach(function (ax) {
                var p0 = dot(rel, ax[0]), dp = dot(d, ax[0]);
                if (Math.abs(dp) < 1e-12) { if (Math.abs(p0) > ax[1]) { lo = Infinity; } return; }
                var l1 = (-ax[1] - p0) / dp, l2 = (ax[1] - p0) / dp;
                lo = Math.max(lo, Math.min(l1, l2)); hi = Math.min(hi, Math.max(l1, l2));
            });
            if (!(hi >= lo)) continue;
            var m = Math.max(1, Math.round((hi - lo) / sample));
            for (var j = 0; j <= m; j++) {
                var lam = lo + (hi - lo) * j / m;
                var p = [sc[0] + lam * d[0], sc[1] + lam * d[1]];
                var q = [p[0] - c[0], p[1] - c[1]];
                pts.push({ x: p[0], y: p[1], t: t, lu: dot(q, u), i: i });
            }
        }

        // Scanned length as the thesis measures it: front-to-back along one
        // long side, i.e. the extent along the heading of the points that
        // were captured on that side.
        var proj = pts.map(function (p) { return p.x * u[0] + p.y * u[1]; });
        var lsAbs = proj.length ? Math.max.apply(null, proj) - Math.min.apply(null, proj) : 0;
        var edge = pts.filter(function (p) {
            var q = [p.x - (c0[0] + vo * p.t * u[0]), p.y - (c0[1] + vo * p.t * u[1])];
            return Math.abs(dot(q, w) - WID / 2) < 1e-6;
        }).map(function (p) { return p.x * u[0] + p.y * u[1]; });
        var lsEdge = edge.length > 1 ? Math.max.apply(null, edge) - Math.min.apply(null, edge) : lsAbs;

        // Layover check: does the object's front still end up in front?
        var cov = 0, mu = 0, ml = 0;
        pts.forEach(function (p, i2) { mu += proj[i2]; ml += p.lu; });
        mu /= pts.length || 1; ml /= pts.length || 1;
        pts.forEach(function (p, i2) { cov += (proj[i2] - mu) * (p.lu - ml); });

        return {
            pts: pts, nProf: nProf, t0: t0, t1: t1, capped: capped, u: u, w: w, d: d, c0: c0, vm: vm, vo: vo,
            corners: corners, lsEdge: lsEdge, inverted: cov < 0
        };
    }

    // ---------- Drawing ----------
    var canvas = root.querySelector('canvas');
    var ctx = canvas.getContext('2d');
    var sim = null, anim = null;

    function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

    // ---------- Display-only point thinning ----------
    // The simulation samples very finely (profiles ≤ 0.05 m apart, points
    // ≤ 0.1 m along a profile), which draws as a solid fill. For display we
    // keep every n-th profile and every m-th point along a profile so that
    // neighbouring dots sit about DENSITY[density] CSS px apart on screen.
    // The first/last profile and both ends of every profile are always kept,
    // so the outline of the cloud (front, back, layover) stays sharp.
    var PT_RADIUS = 1.6;                                     // CSS px; the canvas is already scaled by devicePixelRatio
    var DENSITY = { dense: 4, medium: 7, sparse: 11 };       // target on-screen spacing (CSS px)
    var density = 'medium';
    var spacing = null, mask = null;                         // caches

    function median(a) {
        if (!a.length) return 0;
        a.sort(function (x, y) { return x - y; });
        return a[a.length >> 1];
    }

    // World spacing of the raw samples: along a profile (dA) and between
    // consecutive profiles, measured across the scan line (dP).
    function rawSpacing() {
        if (spacing && spacing.sim === sim) return spacing;
        var pts = sim.pts, n = pts.length;
        var j = new Int32Array(n), count = {}, first = {}, last = {};
        for (var k = 0; k < n; k++) {
            var i = pts[k].i;
            if (!(i in count)) { count[i] = 0; first[i] = k; }
            j[k] = count[i]++;
            last[i] = k;
        }
        var ids = Object.keys(count).map(Number).sort(function (x, y) { return x - y; });
        var perp = [-sim.d[1], sim.d[0]], dA = [], dP = [];
        ids.forEach(function (i, q) {
            var a = pts[first[i]], b = pts[last[i]];
            if (count[i] > 1) dA.push(Math.hypot(b.x - a.x, b.y - a.y) / (count[i] - 1));
            if (q) {
                var i0 = ids[q - 1], c = pts[first[i0]];
                dP.push(Math.abs((a.x - c.x) * perp[0] + (a.y - c.y) * perp[1]) / (i - i0));
            }
        });
        spacing = { sim: sim, j: j, count: count, iMin: ids[0], iMax: ids[ids.length - 1], dA: median(dA), dP: median(dP) };
        return spacing;
    }

    // Evenly spaced picks from 0..len-1 that always include both ends
    function picked(idx, len, stride) {
        if (len <= 1 || stride <= 1) return true;
        var nk = Math.max(1, Math.round((len - 1) / stride));
        return idx === Math.round(Math.round(idx * nk / (len - 1)) * (len - 1) / nk);
    }

    function displayMask(scale) {
        if (mask && mask.sim === sim && mask.scale === scale && mask.density === density) return mask.keep;
        var sp = rawSpacing(), target = DENSITY[density];
        var sP = sp.dP > 1e-9 ? Math.max(1, Math.round(target / (sp.dP * scale))) : 1;
        var sA = sp.dA > 1e-9 ? Math.max(1, Math.round(target / (sp.dA * scale))) : 1;
        var keep = new Uint8Array(sim.pts.length), nI = sp.iMax - sp.iMin + 1;
        sim.pts.forEach(function (p, k) {
            keep[k] = picked(p.i - sp.iMin, nI, sP) && picked(sp.j[k], sp.count[p.i], sA) ? 1 : 0;
        });
        mask = { sim: sim, scale: scale, density: density, keep: keep };
        return keep;
    }

    var lastProgress = 1;

    function draw(progress) {
        lastProgress = progress;
        // Optional 3D view (static/js/view3d.js): when active it draws this frame instead
        var v3 = window.mlsView3D;
        if (v3 && v3.active()) { v3.draw(canvas, ctx, state, progress, DENSITY[density]); return; }
        var dpr = window.devicePixelRatio || 1;
        var W = canvas.clientWidth, H = canvas.clientHeight;
        if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
            canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (!sim) return;

        var tNow = sim.t0 + (sim.t1 - sim.t0) * progress;
        var objAt = function (t) {
            var c = [sim.c0[0] + sim.vo * t * sim.u[0], sim.c0[1] + sim.vo * t * sim.u[1]];
            return sim.corners.map(function (o) { return [c[0] + o[0], c[1] + o[1]]; });
        };
        var first = objAt(sim.t0), last = objAt(sim.t1);

        // Fit view to the cloud and the box at first and last contact
        var xs = [], ys = [];
        sim.pts.forEach(function (p) { xs.push(p.x); ys.push(p.y); });
        first.concat(last).forEach(function (p) { xs.push(p[0]); ys.push(p[1]); });
        [sim.t0, sim.t1].forEach(function (t) { xs.push(sim.vm * t - 2.5, sim.vm * t + 2.5); ys.push(-1.2, 1.2); });
        var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
        var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
        var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        var span = Math.max(maxX - minX, (maxY - minY) * W / H, 8);
        // Display translation: the scene moves with the selected scanner's
        // mounting offset, the mapper body does not. The fit above is computed
        // as before, in the scene's frame. Relative to the scene the body sits
        // at -offset; only if its footprint there would leave the fitted window
        // is the window panned by the overflow, and only if it cannot fit at this
        // scale is the view widened. Otherwise the scene is framed exactly as before.
        var off = MOUNT[state.side], offO = MOUNT[state.side === 'R' ? 'L' : 'R'];
        var S = function (p) { return [p[0] + off[0], p[1] + off[1]]; };
        var bx = [sim.vm * sim.t0 - 2.5 - off[0], sim.vm * sim.t1 + 2.5 - off[0]], by = [-1.2 - off[1], 1.2 - off[1]];
        var fitAxis = function (c, half, lo, hi, blo, bhi) {      // window [c - half, c + half] must hold [lo, hi] and [blo, bhi]
            var a = Math.min(lo, blo), b = Math.max(hi, bhi);
            if (a >= c - half && b <= c + half) return { c: c, half: half };
            if (b - a <= 2 * half) return { c: Math.min(Math.max(c, b - half), a + half), half: half };
            return { c: (a + b) / 2, half: (b - a) / 2 };
        };
        var fx = fitAxis(cx, span / 2, minX, maxX, bx[0], bx[1]);
        var fy = fitAxis(cy, span * H / W / 2, minY, maxY, by[0], by[1]);
        span = Math.max(2 * fx.half, 2 * fy.half * W / H);
        cx = fx.c + off[0]; cy = fy.c + off[1];
        var scale = (W - 60) / span;
        var X = function (x) { return W / 2 + (x - cx) * scale; };
        var Y = function (y) { return H / 2 - (y - cy) * scale; };

        var muted = css('--muted'), line = css('--line'), text = css('--text');
        var ptCol = state.side === 'R' ? css('--right') : css('--left');
        var objCol = css('--object');
        // Dev-only draw record (window.mlsRecordDraw = true): display coordinates of what is drawn
        var rec = window.mlsRecordDraw ? { view: '2d', off: off, offOther: offO, fit: { cx: cx, cy: cy, scale: scale, W: W, H: H }, pts: [], boxes: {} } : null;

        // Metre grid
        var step = span > 60 ? 10 : span > 25 ? 5 : 1;
        ctx.strokeStyle = line; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var gx = Math.floor((cx - W / 2 / scale) / step) * step; gx < cx + W / 2 / scale; gx += step) { ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), H); }
        for (var gy = Math.floor((cy - H / 2 / scale) / step) * step; gy < cy + H / 2 / scale; gy += step) { ctx.moveTo(0, Y(gy)); ctx.lineTo(W, Y(gy)); }
        ctx.stroke(); ctx.globalAlpha = 1;

        function poly(c, stroke, fill, dash) {
            ctx.beginPath();
            c.forEach(function (p, i) { if (i) ctx.lineTo(X(p[0]), Y(p[1])); else ctx.moveTo(X(p[0]), Y(p[1])); });
            ctx.closePath();
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }

        // True box at first and last contact
        var firstD = first.map(S), lastD = last.map(S);
        poly(firstD, muted, null, [5, 4]);
        poly(lastD, muted, null, [5, 4]);
        if (rec) { rec.boxes.first = firstD; rec.boxes.last = lastD; }

        // Points captured so far: round dots of fixed on-screen size,
        // thinned for display only (sim.pts itself is never changed)
        var keep = displayMask(scale);
        ctx.fillStyle = ptCol;
        ctx.beginPath();
        sim.pts.forEach(function (p, k) {
            if (!keep[k] || p.t > tNow + 1e-9) return;
            var px = X(p.x + off[0]), py = Y(p.y + off[1]);
            if (rec) rec.pts.push([k, p.x + off[0], p.y + off[1]]);
            ctx.moveTo(px + PT_RADIUS, py);
            ctx.arc(px, py, PT_RADIUS, 0, 2 * Math.PI);
        });
        ctx.fill();

        // Box now, with front marker
        if (progress < 1) {
            var now = objAt(tNow).map(S);
            poly(now, objCol, hexA(objCol, 0.22));
            if (rec) rec.boxes.now = now;
            var fx = (now[0][0] + now[1][0]) / 2, fy = (now[0][1] + now[1][1]) / 2;
            ctx.fillStyle = text; ctx.font = '600 11px ' + css('--font');
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('F', X(fx + sim.u[0] * 0.6), Y(fy + sim.u[1] * 0.6));

            // Scan line through the selected scanner, clipped to the view
            var sx = sim.vm * tNow + off[0], sy = off[1], L = span * 3;
            ctx.strokeStyle = ptCol; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(X(sx - sim.d[0] * L), Y(sy - sim.d[1] * L));
            ctx.lineTo(X(sx + sim.d[0] * L), Y(sy + sim.d[1] * L));
            ctx.stroke(); ctx.globalAlpha = 1;
            if (rec) rec.line = { anchor: [sx, sy], dir: [sim.d[0], sim.d[1]] };
        }

        // Mobile mapper (4.5 m x 1.8 m), pointing along +x
        var mx = sim.vm * tNow;
        drawCar(mx);
        // Scanners at the body's rear corners, each filled in its own colour
        // (red left, blue right): the selected one at full size, the other one
        // solid at 60% of that size with a thin ring (the text colour on a light
        // page, the background colour on a dark one) so it stands out against
        // the pink body in both themes.
        var rM = Math.max(2.5, scale * 0.2), rO = rM * 0.6;
        var oxy = [X(mx + offO[0]), Y(offO[1])];
        ctx.beginPath(); ctx.arc(oxy[0], oxy[1], rO, 0, 2 * Math.PI);
        ctx.fillStyle = state.side === 'R' ? css('--left') : css('--right'); ctx.fill();
        ctx.strokeStyle = ringColour(); ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = ptCol;
        ctx.beginPath(); ctx.arc(X(mx + off[0]), Y(off[1]), rM, 0, 2 * Math.PI); ctx.fill();
        if (rec) {
            rec.markers = { sel: [mx + off[0], off[1]], other: [mx + offO[0], offO[1]], r: rM, rOther: rO,
                            otherBox: [oxy[0] - rO - 1, oxy[1] - rO - 1, oxy[0] + rO + 1, oxy[1] + rO + 1] };
            rec.mapper = [[mx - 2.25, 0.9], [mx + 1.6, 0.9], [mx + 2.25, 0], [mx + 1.6, -0.9], [mx - 2.25, -0.9]];
            rec.tNow = tNow; rec.progress = progress;
            window.mlsDrawRecord = rec;
        }

        // Heading arrows
        arrow(18, H - 18, [1, 0], 'mapper', muted);
        arrow(sim.u[0] < 0 ? 40 : 18, H - 40, sim.u, 'object', objCol);

        // Schematic top-view car inside the same 4.5 m x 1.8 m footprint as before
        // (x -2.25..+2.25 m from the centre, y -0.9..+0.9 m), nose towards +x.
        // Body: rear corners radius 0.18 m, nose corners 0.45 m, the nose 0.08 m
        // narrower per side than the rear. Windshield (front, larger) and rear
        // window are darker quadrilaterals, the roof a lighter panel
        // between them; the trunk behind the rear window (x < -1.35 m) stays plain
        // body colour, so the scanner markers at x = -1.7 m sit on it.
        function drawCar(cxm) {
            var base = css('--mapper') || '#f4a6c8';
            function P(pts) {
                ctx.beginPath(); ctx.moveTo(X(cxm + pts[0][0]), Y(pts[0][1]));
                for (var i = 1; i < pts.length; i++) ctx.lineTo(X(cxm + pts[i][0]), Y(pts[i][1]));
                ctx.closePath();
            }
            function Q(cx1, cy1, x1, y1) { ctx.quadraticCurveTo(X(cxm + cx1), Y(cy1), X(cxm + x1), Y(y1)); }
            function C(ax, ay, bx, by, x1, y1) { ctx.bezierCurveTo(X(cxm + ax), Y(ay), X(cxm + bx), Y(by), X(cxm + x1), Y(y1)); }
            ctx.beginPath();
            ctx.moveTo(X(cxm - 2.25), Y(0.72));
            Q(-2.25, 0.9, -2.07, 0.9);
            // flank to nose: a cubic that leaves the full-width flank and enters the
            // nose corner horizontally, so the outline has no kink
            ctx.lineTo(X(cxm + 0.6), Y(0.9)); C(1.2, 0.9, 1.5, 0.82, 1.8, 0.82);
            Q(2.25, 0.82, 2.25, 0.37);
            ctx.lineTo(X(cxm + 2.25), Y(-0.37));
            Q(2.25, -0.82, 1.8, -0.82);
            C(1.5, -0.82, 1.2, -0.9, 0.6, -0.9); ctx.lineTo(X(cxm - 2.07), Y(-0.9));
            Q(-2.25, -0.9, -2.25, -0.72);
            ctx.closePath();
            ctx.fillStyle = hexA(base, 0.9); ctx.fill();
            ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.stroke();
            // roof: a lighter pink, clearly lighter on the light page (0.45 towards
            // white), less so on the dark page, where 0.18 already reads well
            ctx.fillStyle = mix(base, 255, ringColour() === css('--bg') ? 0.18 : 0.45, 0.9);
            P([[-0.95, 0.62], [0.45, 0.62], [0.45, -0.62], [-0.95, -0.62]]); ctx.fill();
            ctx.fillStyle = mix(base, 0, 0.32, 0.9);                         // glass
            P([[0.45, 0.62], [1.1, 0.72], [1.1, -0.72], [0.45, -0.62]]); ctx.fill();       // windshield
            P([[-1.35, 0.68], [-0.95, 0.62], [-0.95, -0.62], [-1.35, -0.68]]); ctx.fill(); // rear window
        }
        // col mixed towards grey level g (0 black, 255 white) by f, with alpha a
        function mix(col, g, f, a) {
            var m = /^#([0-9a-f]{6})$/i.exec(col);
            if (!m) return col;
            var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { return Math.round(v + (g - v) * f); });
            return 'rgba(' + c.join(',') + ',' + a + ')';
        }

        function arrow(x, y, v, label, col) {
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5;
            var ex = x + v[0] * 22, ey = y - v[1] * 22;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
            var a = Math.atan2(ey - y, ex - x);
            ctx.beginPath(); ctx.moveTo(ex, ey);
            ctx.lineTo(ex - 6 * Math.cos(a - 0.45), ey - 6 * Math.sin(a - 0.45));
            ctx.lineTo(ex - 6 * Math.cos(a + 0.45), ey - 6 * Math.sin(a + 0.45));
            ctx.closePath(); ctx.fill();
            ctx.font = '11px ' + css('--font'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillStyle = muted; ctx.fillText(label, Math.max(x, x + v[0] * 22) + 8, y - v[1] * 10);
        }

        // Scale bar
        ctx.fillStyle = muted; ctx.strokeStyle = muted; ctx.lineWidth = 1.5;
        var bar = step * scale;
        ctx.beginPath(); ctx.moveTo(W - 18 - bar, H - 18); ctx.lineTo(W - 18, H - 18); ctx.stroke();
        ctx.font = '11px ' + css('--font'); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(step + ' m', W - 18, H - 22);
    }

    // Outline for the non-selected scanner marker: the theme's text colour on a
    // light page, its background colour on a dark one (whichever separates the
    // marker from the pink body better in that theme)
    function ringColour() {
        var m = /^#([0-9a-f]{6})$/i.exec(css('--bg')), n = m ? parseInt(m[1], 16) : 0xffffff;
        var y = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
        return y < 128 ? css('--bg') : css('--text');
    }

    function hexA(col, a) {
        var m = /^#([0-9a-f]{6})$/i.exec(col);
        if (!m) return col;
        var n = parseInt(m[1], 16);
        return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
    }

    // ---------- UI ----------
    var $ = function (sel) { return root.querySelector(sel); };
    var inputs = {
        vm: $('#ex-vm'), vo: $('#ex-vo'), theta: $('#ex-theta'), phiH: $('#ex-phih'), phiV: $('#ex-phiv')
    };
    var sideBtns = root.querySelectorAll('[data-side]');
    var presetBtns = root.querySelectorAll('[data-preset]');
    var playBtn = $('#ex-play');

    function fmt(x, dp, unit) {
        if (x === null || x === undefined || isNaN(x)) return '—';
        if (!isFinite(x)) return '∞';
        return (Math.abs(x) < 0.005 ? 0 : x).toFixed(dp) + (unit || '');
    }

    function update(fromPreset) {
        Object.keys(inputs).forEach(function (k) {
            var out = root.querySelector('output[for="' + inputs[k].id + '"]');
            if (out) out.textContent = state[k] + (k === 'vm' || k === 'vo' ? ' km/h' : '°');
        });
        sideBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.side === state.side)); });
        var swatch = root.querySelector('#ex-pts-swatch');
        if (swatch) swatch.classList.toggle('left', state.side === 'L');
        var lineSwatch = root.querySelector('#ex-line-swatch');
        if (lineSwatch) lineSwatch.classList.toggle('left', state.side === 'L');
        if (!fromPreset) presetBtns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });

        var m = model(state);
        var c = classify(state, m);
        $('#ex-regime .name').textContent = c.name;
        $('#ex-regime p').textContent = c.text;

        $('#ex-vl').textContent = fmt(m.vl, 1);
        $('#ex-ls').textContent = m.together ? '∞' : fmt(m.ls, 2, ' m');
        $('#ex-gamma').textContent = fmt(m.gamma, 1, '°');
        $('#ex-beta').textContent = fmt(m.beta, 1, '°');
        $('#ex-alpha').textContent = fmt(m.alpha, 1, '°');
        $('#ex-ratio').textContent = m.together ? 'grows with scan time' : '×' + fmt(Math.abs(m.ratio), 2) + ' of 4 m' + (m.ls < 0 ? ', inverted' : '');

        sim = simulate(state);
        var chk = $('#ex-check');
        if (sim.capped) chk.textContent = 'Simulation: scan cut off after ' + (sim.t1 - sim.t0).toFixed(1) + ' s. The streak keeps growing for as long as the scan line keeps pace with the object.';
        else chk.textContent = 'Simulation (independent of the equations): edge length ≈ ' + sim.lsEdge.toFixed(2) + ' m, front and back ' + (sim.inverted ? 'swapped' : 'in order') + '.';

        stop();
        draw(1);
    }

    function stop() { if (anim) cancelAnimationFrame(anim); anim = null; playBtn.textContent = 'Play scan'; }

    function play() {
        if (anim) { stop(); draw(1); return; }
        var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) { draw(1); return; }
        var start = null, dur = 2600;
        playBtn.textContent = 'Stop';
        var frame = function (ts) {
            if (start === null) start = ts;
            var p = Math.min(1, (ts - start) / dur);
            draw(p);
            if (p < 1) anim = requestAnimationFrame(frame);
            else { anim = null; playBtn.textContent = 'Play scan'; }
        };
        anim = requestAnimationFrame(frame);
    }

    Object.keys(inputs).forEach(function (k) {
        inputs[k].addEventListener('input', function () { state[k] = Number(inputs[k].value); update(); });
    });
    sideBtns.forEach(function (b) { b.addEventListener('click', function () { state.side = b.dataset.side; update(); }); });
    playBtn.addEventListener('click', play);

    // Point density (display only)
    var densityBtns = root.querySelectorAll('[data-density]');
    densityBtns.forEach(function (b) {
        b.addEventListener('click', function () {
            density = b.dataset.density;
            densityBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
            if (!anim) draw(lastProgress);
        });
    });

    // Presets: test cases from the thesis (speeds there are in cm/s; only ratios matter)
    var PRESETS = {
        A1: { vm: 40, vo: 20, theta: 0 },     // elongation
        A3: { vm: 40, vo: 100, theta: 0 },    // layover
        A2: { vm: 40, vo: 40, theta: 0 },     // over-elongation
        B1: { vm: 40, vo: 20, theta: 180 },   // contraction
        C1: { vm: 40, vo: 20, theta: 90 },    // perpendicular
        D2: { vm: 40, vo: 40, theta: 40 }     // oblique, layover on the right
    };
    function applyPreset(id) {
        var p = PRESETS[id];
        if (!p) return false;
        Object.keys(p).forEach(function (k) { state[k] = p[k]; inputs[k].value = p[k]; });
        state.phiH = 45; state.phiV = 30; inputs.phiH.value = 45; inputs.phiV.value = 30;
        presetBtns.forEach(function (x) { x.setAttribute('aria-pressed', String(x.dataset.preset === id)); });
        update(true);
        return true;
    }
    presetBtns.forEach(function (b) {
        b.addEventListener('click', function () { if (applyPreset(b.dataset.preset)) play(); });
    });

    window.addEventListener('resize', function () { if (!anim) draw(1); });
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { if (!anim) draw(1); });

    // Shareable links: ?case=A3 opens a preset, &side=L picks the scanner
    var q = new URLSearchParams(window.location.search);
    if (q.get('side') === 'L' || q.get('side') === 'R') state.side = q.get('side');
    if (!applyPreset((q.get('case') || '').toUpperCase())) update();
    if (q.has('t')) { stop(); draw(Math.max(0, Math.min(1, Number(q.get('t'))))); }

    // Exposed for testing in the console
    window.mlsModel = model;
    window.mlsSimulate = simulate;
    // Redraw the current frame (used by the 3D view after rotate/zoom/toggle)
    window.mlsRedraw = function () { if (!anim) draw(lastProgress); };
})();
