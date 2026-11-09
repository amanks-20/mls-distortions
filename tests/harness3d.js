/* Dev-only harness for simulate3D (not used by the site). Run via tests/check3d.py.
   Loads static/js/explorer.js and static/js/simulate3d.js unchanged with a
   minimal browser stub and prints the comparison numbers as JSON. */
(function (G) {
    'use strict';

    function noop() {}
    function el() {
        return {
            textContent: '', value: '', dataset: {}, clientWidth: 800, clientHeight: 450, width: 0, height: 0,
            addEventListener: noop, setAttribute: noop,
            classList: { toggle: noop, add: noop, remove: noop },
            querySelector: function () { return el(); },
            querySelectorAll: function () { return []; },
            getContext: function () { return new Proxy({}, { get: function () { return noop; }, set: function () { return true; } }); }
        };
    }
    G.window = G;
    G.document = { documentElement: {}, getElementById: function (id) { return id === 'explorer' ? el() : null; } };
    G.getComputedStyle = function () { return { getPropertyValue: function () { return ''; } }; };
    G.matchMedia = function () { return { matches: false, addEventListener: noop }; };
    G.requestAnimationFrame = function () { return 0; };
    G.cancelAnimationFrame = noop;
    G.addEventListener = noop;
    G.devicePixelRatio = 1;
    G.location = { search: '' };
    if (typeof G.URLSearchParams === 'undefined') {
        G.URLSearchParams = function () { this.get = function () { return null; }; this.has = function () { return false; }; };
    }
    function load(path) {
        var src = typeof require === 'function' ? require('fs').readFileSync(path, 'utf8') : read(path);
        (0, eval)(src);
    }
    load('static/js/explorer.js');
    load('static/js/simulate3d.js');
    var sim2 = G.mlsSimulate, sim3 = G.mlsSimulate3D, plane = G.mlsScanPlane;

    var PRESETS = {
        A1: { vm: 40, vo: 20, theta: 0 }, A3: { vm: 40, vo: 100, theta: 0 }, A2: { vm: 40, vo: 40, theta: 0 },
        B1: { vm: 40, vo: 20, theta: 180 }, C1: { vm: 40, vo: 20, theta: 90 }, D2: { vm: 40, vo: 40, theta: 40 }
    };
    var LEN = 4, WID = 2, HGT = 1.5;

    // Top-view metrics of the TOP-face points, measured exactly as simulate() measures its cloud
    function topMetrics(r) {
        var u = r.u, w = r.w, c0 = r.c0, vo = r.vo;
        var top = r.pts.filter(function (p) { return p.face === 'top'; });
        if (!top.length) return { n: 0, lsEdge: null, inverted: null };
        var proj = top.map(function (p) { return p.x * u[0] + p.y * u[1]; });
        var lu = [], edge = [];
        top.forEach(function (p, k) {
            var q = [p.x - (c0[0] + vo * p.t * u[0]), p.y - (c0[1] + vo * p.t * u[1])];
            lu.push(q[0] * u[0] + q[1] * u[1]);
            if (Math.abs(q[0] * w[0] + q[1] * w[1] - WID / 2) < 1e-6) edge.push(proj[k]);
        });
        var lsAbs = Math.max.apply(null, proj) - Math.min.apply(null, proj);
        var lsEdge = edge.length > 1 ? Math.max.apply(null, edge) - Math.min.apply(null, edge) : lsAbs;
        var mu = 0, ml = 0, cov = 0;
        proj.forEach(function (v, k) { mu += v; ml += lu[k]; });
        mu /= proj.length; ml /= proj.length;
        proj.forEach(function (v, k) { cov += (v - mu) * (lu[k] - ml); });
        // top-view footprint of the cloud, in the object frame axes (u, w)
        var pw = top.map(function (p) { return p.x * w[0] + p.y * w[1]; });
        return { n: top.length, lsEdge: lsEdge, inverted: cov < 0, extU: lsAbs, extW: Math.max.apply(null, pw) - Math.min.apply(null, pw) };
    }

    // Every point must lie on the scan plane, on the box surface at its own time, and on a visible face
    function sanity(r) {
        var N = r.N, H = r.hScanner, u = r.u, w = r.w, c0 = r.c0, vo = r.vo, vm = r.vm;
        var worstPlane = 0, worstSurf = 0, hidden = 0, faces = {};
        r.pts.forEach(function (p) {
            faces[p.face] = (faces[p.face] || 0) + 1;
            var S = [vm * p.t, 0, H];
            worstPlane = Math.max(worstPlane, Math.abs(N[0] * (p.x - S[0]) + N[1] * (p.y - S[1]) + N[2] * (p.z - S[2])));
            var qx = p.x - (c0[0] + vo * p.t * u[0]), qy = p.y - (c0[1] + vo * p.t * u[1]);
            var lu = qx * u[0] + qy * u[1], lw = qx * w[0] + qy * w[1];
            var out = Math.max(Math.abs(lu) - LEN / 2, Math.abs(lw) - WID / 2, -p.z, p.z - HGT);
            var onSurf = Math.min(Math.abs(Math.abs(lu) - LEN / 2), Math.abs(Math.abs(lw) - WID / 2), Math.abs(p.z - HGT));
            worstSurf = Math.max(worstSurf, Math.max(out, 0), onSurf);
            // visibility: scanner must be on the outer side of the tagged face
            var n = p.face === 'top' ? [0, 0, 1] : p.face === 'front' ? [u[0], u[1], 0] : p.face === 'back' ? [-u[0], -u[1], 0]
                : (lw > 0 ? [w[0], w[1], 0] : [-w[0], -w[1], 0]);
            if (n[0] * (S[0] - p.x) + n[1] * (S[1] - p.y) + n[2] * (S[2] - p.z) <= 0) hidden++;
        });
        return { worstPlane: worstPlane, worstSurf: worstSurf, hidden: hidden, faces: faces };
    }

    function state(id, side, extra) {
        var p = PRESETS[id], s = { vm: p.vm, vo: p.vo, theta: p.theta, side: side, phiH: 45, phiV: 30 };
        Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
        return s;
    }

    // Every point against mlsScanPlane (the helper view3d.js draws): |(p - origin(t)) . normal|
    function onDrawnPlane(s, r, opts) {
        var worst = 0;
        r.pts.forEach(function (p) {
            var pl = plane(s, s.side, p.t, opts), o = pl.origin, n = pl.normal;
            worst = Math.max(worst, Math.abs((p.x - o[0]) * n[0] + (p.y - o[1]) * n[1] + (p.z - o[2]) * n[2]));
        });
        return worst;
    }

    var out = { a: [], b: [], c: [], d: [], sanity: [], plane: [], orient: {} };
    ['L', 'R'].forEach(function (side) {
        out.orient[side] = plane({ vm: 40, vo: 20, theta: 0, side: side, phiH: 45, phiV: 30 }, side, 0);
    });
    Object.keys(PRESETS).forEach(function (id) {
        ['L', 'R'].forEach(function (side) {
            var s = state(id, side);
            var r2 = sim2(s), r3 = sim3(s), m3 = topMetrics(r3);
            out.a.push({ id: id + '-' + side, ls2: r2.lsEdge, inv2: r2.inverted, cap2: r2.capped,
                         ls3: m3.lsEdge, inv3: m3.inverted, cap3: r3.capped, nTop: m3.n });
            var sn = sanity(r3); sn.id = id + '-' + side; out.sanity.push(sn);

            [0, 10, 30, 60, 70].forEach(function (pv) {
                var m = topMetrics(sim3(state(id, side, { phiV: pv })));
                out.b.push({ id: id + '-' + side, phiV: pv, ls3: m.lsEdge, inv3: m.inverted });
            });

            var st = topMetrics(sim3(state(id, side, { vo: 0 })));
            out.c.push({ id: id + '-' + side, lsEdge: st.lsEdge, inv: st.inverted, extU: st.extU, extW: st.extW });

            [1.8, 2.0, 2.5].forEach(function (h) {
                var m = topMetrics(sim3(s, { hScanner: h }));
                out.d.push({ id: id + '-' + side, h: h, ls3: m.lsEdge, inv3: m.inverted });
            });

            [[0, undefined], [30, undefined], [60, undefined], [30, 1.8]].forEach(function (c) {
                var st2 = state(id, side, { phiV: c[0] }), opts = c[1] ? { hScanner: c[1] } : undefined;
                var r = sim3(st2, opts);
                out.plane.push({ id: id + '-' + side, phiV: c[0], h: r.hScanner, n: r.pts.length, worst: onDrawnPlane(st2, r, opts) });
            });
        });
    });
    var json = JSON.stringify(out);
    if (typeof console !== 'undefined' && console.log) console.log(json); else print(json);
})(typeof globalThis !== 'undefined' ? globalThis : this);
