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
    if (!root || !canvas || !window.mlsSimulate3D) return;

    var D2R = Math.PI / 180;
    var DEFAULT = { yaw: -60, pitch: 30, zoom: 1 };     // about 30° elevation
    var PT_RADIUS = 1.6;                               // CSS px, same dot size as the 2D view
    // Cap on drawn dots per frame. Each dot is a canvas arc plus a depth sort;
    // ~6000 keeps rotation smooth on a mid-range phone while still showing
    // every face as discrete points. Above it the display thinning is coarsened.
    var MAX_POINTS = 6000;
    var FACE_SHADE = { top: 1.0, side: 0.82, front: 0.68, back: 0.56 };
    var MAPPER = { len: 4.5, wid: 1.8 };               // same footprint as the 2D drawing

    var mode = '2d';
    var cam = { yaw: DEFAULT.yaw, pitch: DEFAULT.pitch, zoom: DEFAULT.zoom };
    var simCache = { key: null, sim: null, spacing: null };
    var maskCache = null;

    var viewBtns = root.querySelectorAll('[data-view]');
    var resetBtn = root.querySelector('#ex-3d-reset');
    var notes = root.querySelector('#ex-3d-notes');
    var noteTop = root.querySelector('#ex-3d-notop');
    var noteH = root.querySelector('#ex-3d-hs');
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
    var BOX_EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

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
        // Fit: scene seen from the DEFAULT camera, centred on the cloud. Using
        // the default (not the current) camera keeps the scale steady while rotating.
        var B0 = basis(DEFAULT.yaw, DEFAULT.pitch), mxp = 1e-6, myp = 1e-6;
        ext.forEach(function (p) {
            var dx = p[0] - T[0], dy = p[1] - T[1], dz = p[2] - T[2];
            mxp = Math.max(mxp, Math.abs(dx * B0.r[0] + dy * B0.r[1] + dz * B0.r[2]));
            myp = Math.max(myp, Math.abs(dx * B0.u[0] + dy * B0.u[1] + dz * B0.u[2]));
        });
        var scale = Math.min((W / 2 - 24) / mxp, (H / 2 - 28) / myp) * cam.zoom;

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
        for (var gx = gx0; gx <= gx1 + 1e-9; gx += step) seg([gx, gy0, 0], [gx, gy1, 0]);
        for (var gy = gy0; gy <= gy1 + 1e-9; gy += step) seg([gx0, gy, 0], [gx1, gy, 0]);
        ctx.stroke(); ctx.globalAlpha = 1;

        function wire(c, stroke, dash, width) {
            ctx.beginPath();
            BOX_EDGES.forEach(function (e) { seg(c[e[0]], c[e[1]]); });
            ctx.setLineDash(dash || []); ctx.strokeStyle = stroke; ctx.lineWidth = width || 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
        // True box at first and last contact (dashed, muted)
        wire(first, muted, [5, 4]);
        wire(last, muted, [5, 4]);

        // Mapper footprint on the ground and the scanner on its mast
        var mx = sim.vm * tNow, Lm = MAPPER.len / 2, Wm = MAPPER.wid / 2;
        var foot = [[mx - Lm, Wm], [mx + 1.6, Wm], [mx + Lm, 0], [mx + 1.6, -Wm], [mx - Lm, -Wm]];
        ctx.beginPath();
        foot.forEach(function (q, k) { var p = P(q[0], q[1], 0); if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.closePath(); ctx.fillStyle = mapCol; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = muted; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); seg([mx, 0, 0], [mx, 0, sim.hScanner]); ctx.strokeStyle = muted; ctx.lineWidth = 1.5; ctx.stroke();
        var sp = P(mx, 0, sim.hScanner);
        ctx.beginPath(); ctx.arc(sp[0], sp[1], 3.5, 0, 2 * Math.PI); ctx.fillStyle = shade(ptBase, 1); ctx.fill();

        // Points captured so far: thinned, depth-sorted (far first), shaded by face
        var mask = displayMask(sim, scale, targetPx);
        var vis = [];
        for (var k = 0; k < sim.pts.length; k++) {
            if (!mask.keep[k]) continue;
            var p = sim.pts[k];
            if (p.t > tNow + 1e-9) continue;
            var q = P(p.x, p.y, p.z);
            vis.push([q[2], q[0], q[1], p.face]);
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
        if (progress < 1) wire(boxCorners(sim, tNow), objCol, null, 1.2);

        // Axis hint
        ctx.fillStyle = muted; ctx.font = '12px ' + css('--font');
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText('3D · drag to rotate, wheel or pinch to zoom', 12, H - 12);

        updateNotes(sim);
    }

    function updateNotes(sim) {
        if (!notes) return;
        var hasTop = sim.pts.some(function (p) { return p.face === 'top'; });
        if (noteTop) noteTop.hidden = hasTop;
        if (noteH) {
            var t = 'Scanner height ' + sim.hScanner + ' m (illustrative, not from the thesis). It shifts where the plane cuts the box but not its length or order.';
            if (noteH.textContent !== t) noteH.textContent = t;
        }
    }

    // ---------- mode toggle ----------
    function setMode(m) {
        mode = m;
        var on = m === '3d';
        viewBtns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.view === m)); });
        if (resetBtn) resetBtn.hidden = !on;
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
        camera: cam
    };

    // ?view=3d opens the 3D view directly (no effect otherwise)
    var q = new URLSearchParams(window.location.search);
    if (q.get('view') === '3d') setMode('3d');
})();
