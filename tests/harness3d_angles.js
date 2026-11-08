/* Dev-only harness for tests/check3d_angles.py (not used by the site).
   Loads static/js/explorer.js and static/js/simulate3d.js unchanged, then for
   each case estimates gamma, beta, alpha from the simulate3D cloud and prints
   them next to model(). Method and conventions: see tests/check3d_angles.py.
   Usage: node|jsc tests/harness3d_angles.js [-- extra-cases.json] */
(function (G) {
    'use strict';
    function noop() {}
    function el() {
        return {
            textContent: '', value: '', dataset: {}, clientWidth: 800, clientHeight: 450, width: 0, height: 0,
            addEventListener: noop, setAttribute: noop, classList: { toggle: noop, add: noop, remove: noop },
            querySelector: function () { return el(); }, querySelectorAll: function () { return []; },
            getContext: function () { return new Proxy({}, { get: function () { return noop; }, set: function () { return true; } }); }
        };
    }
    G.window = G;
    G.document = { documentElement: {}, getElementById: function (id) { return id === 'explorer' ? el() : null; } };
    G.getComputedStyle = function () { return { getPropertyValue: function () { return ''; } }; };
    G.matchMedia = function () { return { matches: false, addEventListener: noop }; };
    G.requestAnimationFrame = function () { return 0; };
    G.cancelAnimationFrame = noop; G.addEventListener = noop; G.devicePixelRatio = 1; G.location = { search: '' };
    if (typeof G.URLSearchParams === 'undefined') G.URLSearchParams = function () { this.get = function () { return null; }; this.has = function () { return false; }; };
    function load(path) { (0, eval)(typeof require === 'function' ? require('fs').readFileSync(path, 'utf8') : read(path)); }
    load('static/js/explorer.js');
    load('static/js/simulate3d.js');
    var model = G.mlsModel, sim3 = G.mlsSimulate3D;

    var R2D = 180 / Math.PI, EPS = 1e-6;

    // principal direction of a point set (3D), by power iteration on the covariance
    function principal(P) {
        var m = [0, 0, 0];
        P.forEach(function (p) { m[0] += p[0]; m[1] += p[1]; m[2] += p[2]; });
        m = m.map(function (v) { return v / P.length; });
        var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        P.forEach(function (p) {
            var d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]];
            for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) C[i][j] += d[i] * d[j];
        });
        var v = [1, 0.7, 0.3];
        for (var it = 0; it < 200; it++) {
            var nv = [0, 1, 2].map(function (i) { return C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]; });
            var n = Math.hypot(nv[0], nv[1], nv[2]) || 1;
            v = nv.map(function (x) { return x / n; });
        }
        // straightness: rms distance of points from the fitted line
        var r = 0;
        P.forEach(function (p) {
            var d = [p[0] - m[0], p[1] - m[1], p[2] - m[2]], a = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
            r += (d[0] - a * v[0]) ** 2 + (d[1] - a * v[1]) ** 2 + (d[2] - a * v[2]) ** 2;
        });
        var ext = 0;
        P.forEach(function (p) { ext = Math.max(ext, Math.abs((p[0] - m[0]) * v[0] + (p[1] - m[1]) * v[1] + (p[2] - m[2]) * v[2])); });
        return { dir: v, rms: Math.sqrt(r / P.length), extent: 2 * ext };
    }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

    function estimate(s) {
        var r = sim3(s), L = r.size.length, W = r.size.width, H = r.size.height;
        var u = [r.u[0], r.u[1], 0], w = [r.w[0], r.w[1], 0], z = [0, 0, 1];
        // classify points by their position on the moving box at their own time
        var P = r.pts.map(function (p) {
            var qx = p.x - (r.c0[0] + r.vo * p.t * r.u[0]), qy = p.y - (r.c0[1] + r.vo * p.t * r.u[1]);
            return { p: [p.x, p.y, p.z], face: p.face, lu: qx * r.u[0] + qy * r.u[1], lw: qx * r.w[0] + qy * r.w[1], z: p.z };
        });
        var sideSign = 0;
        P.forEach(function (q) { if (q.face === 'side') sideSign = q.lw > 0 ? 1 : -1; });
        var visFront = P.some(function (q) { return q.face === 'front'; });
        var visBack = P.some(function (q) { return q.face === 'back'; });

        function edge(filter) { return P.filter(filter).map(function (q) { return q.p; }); }
        function pick(front, back) { return front.length >= 3 ? { pts: front, which: 'front' } : back.length >= 3 ? { pts: back, which: 'back' } : null; }

        // gamma: scanned front-top edge (top-face points at lu = +L/2), angle from w, CCW seen from above (+z)
        var gE = pick(edge(function (q) { return q.face === 'top' && Math.abs(q.lu - L / 2) < EPS; }),
                      edge(function (q) { return q.face === 'top' && Math.abs(q.lu + L / 2) < EPS; }));
        var gamma = null, e1 = null, gInfo = null;
        if (gE) {
            var f = principal(gE.pts); e1 = f.dir;
            if (dot(e1, w) < 0) e1 = e1.map(function (x) { return -x; });
            gamma = Math.atan2(-dot(e1, u), dot(e1, w)) * R2D;              // e1 = cos(g) w - sin(g) u
            gInfo = { edge: gE.which, n: gE.pts.length, rms: f.rms, extent: f.extent };
        }
        // beta: scanned vertical front edge of the visible side face, angle from z, CCW seen from outside that face
        var bE = sideSign === 0 ? null : pick(
            edge(function (q) { return q.face === 'side' && Math.abs(q.lu - L / 2) < EPS && Math.abs(q.lw - sideSign * W / 2) < EPS; }),
            edge(function (q) { return q.face === 'side' && Math.abs(q.lu + L / 2) < EPS && Math.abs(q.lw - sideSign * W / 2) < EPS; }));
        var beta = null, e2 = null, bInfo = null;
        if (bE) {
            var f2 = principal(bE.pts); e2 = f2.dir;
            if (dot(e2, z) < 0) e2 = e2.map(function (x) { return -x; });
            beta = Math.atan2(sideSign * dot(e2, u), dot(e2, z)) * R2D;     // e2 = cos(b) z + s sin(b) u
            bInfo = { edge: bE.which, n: bE.pts.length, rms: f2.rms, extent: f2.extent, side: sideSign > 0 ? '+w' : '-w' };
        }
        // alpha: direct from the visible front/back face's own boundary edges, else the paper's formula with the estimates
        var alpha = null, aMethod = null;
        var faceTag = visFront ? 'front' : visBack ? 'back' : null;
        if (faceTag) {
            var topE = edge(function (q) { return q.face === faceTag && Math.abs(q.z - H) < EPS; });
            var verE = edge(function (q) { return q.face === faceTag && sideSign !== 0 && Math.abs(q.lw - sideSign * W / 2) < EPS; });
            if (topE.length >= 3 && verE.length >= 3) {
                var a1 = principal(topE).dir, a2 = principal(verE).dir;
                if (dot(a1, w) < 0) a1 = a1.map(function (x) { return -x; });
                if (dot(a2, z) < 0) a2 = a2.map(function (x) { return -x; });
                alpha = 90 - Math.acos(Math.max(-1, Math.min(1, dot(a1, a2)))) * R2D;
                aMethod = 'direct (' + faceTag + ' face)';
            }
        }
        if (alpha === null && gamma !== null && beta !== null) {
            var sg = s.theta < 180 - s.phiH ? 1 : -1;                      // paper's case split for alpha
            alpha = 90 - Math.acos(sg * Math.sin(gamma / R2D) * Math.sin(beta / R2D)) * R2D;
            aMethod = 'formula (paper, with estimated gamma and beta)';
        }
        return { gamma: gamma, beta: beta, alpha: alpha, aMethod: aMethod, gInfo: gInfo, bInfo: bInfo,
                 capped: r.capped, faces: { front: visFront, back: visBack, side: sideSign } };
    }

    var PRESETS = {
        A1: { vm: 40, vo: 20, theta: 0 }, B1: { vm: 40, vo: 20, theta: 180 }, A3: { vm: 40, vo: 100, theta: 0 },
        A2: { vm: 40, vo: 40, theta: 0 }, C1: { vm: 40, vo: 20, theta: 90 }, D2: { vm: 40, vo: 40, theta: 40 }
    };
    var cases = [];
    Object.keys(PRESETS).forEach(function (id) {
        ['L', 'R'].forEach(function (side) {
            var p = PRESETS[id];
            cases.push({ id: id + '-' + side, group: 'preset', s: { vm: p.vm, vo: p.vo, theta: p.theta, side: side, phiH: 45, phiV: 30 } });
        });
    });
    [0, 40, 90, 135, 180].forEach(function (th) {
        [10, 20, 40].forEach(function (vo) {
            [10, 30, 50].forEach(function (pv) {
                ['L', 'R'].forEach(function (side) {
                    cases.push({ id: 'th' + th + '-vo' + vo + '-pv' + pv + '-' + side, group: 'grid',
                                 s: { vm: 40, vo: vo, theta: th, side: side, phiH: 45, phiV: pv } });
                });
            });
        });
    });

    // optional extra cases (JSON file path as first script argument), e.g. the
    // Results.xlsx cases built by tests/check3d_angles.py
    var argv = typeof process !== 'undefined' && process.argv ? process.argv.slice(2) : (G.arguments && G.arguments.length !== undefined && G.arguments !== G ? Array.prototype.slice.call(G.arguments) : []);
    if (argv.length) {
        var extra = JSON.parse(typeof require === 'function' ? require('fs').readFileSync(argv[0], 'utf8') : read(argv[0]));
        extra.forEach(function (c) { cases.push({ id: c.id, group: c.group || 'xlsx', s: c.s }); });
    }

    var out = cases.map(function (c) {
        var m = model(c.s), e = estimate(c.s);
        var undefinedWhy = !isFinite(m.vl) ? 'instant capture' : m.together ? 'over-elongation' : null;
        return { id: c.id, group: c.group, s: c.s,
                 model: { gamma: m.gamma, beta: m.beta, alpha: m.alpha, vl: isFinite(m.vl) ? m.vl : null },
                 undefinedWhy: undefinedWhy, est: e };
    });
    var json = JSON.stringify(out);
    if (typeof console !== 'undefined' && console.log) console.log(json); else print(json);
})(typeof globalThis !== 'undefined' ? globalThis : this);
