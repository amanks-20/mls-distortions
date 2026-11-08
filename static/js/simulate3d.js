/* ==========================================================================
   3D scan of the moving box (computation only, nothing is drawn).
   window.mlsSimulate3D(state[, opts]) -> { pts: [{x, y, z, t, i, face}], ... }

   Same state object, motion model and sampling rules as simulate() in
   explorer.js (which is not modified):
   - frame: x = mapper direction of travel, y = mapper's left, z up (paper/thesis Ch. 5)
   - mapper/scanner at (vm·t, 0, H_SCANNER); object of 4 x 2 x 1.5 m on flat
     ground (z = 0), heading θ, starting at the same position c0 as simulate()
   - scan plane normal N = (cos φh cos φv, ±sin φh cos φv, sin φv),
     + for the right scanner, − for the left (φh -> −φh), thesis p.60–61
   - profiles are instantaneous; profile step ≤ 0.05 m, point step ≤ 0.1 m,
     scan-time caps as in simulate(). The contact window [t0, t1] is computed
     for the 3D plane and the 3D box, because the tilted plane meets the box
     at slightly different times than the explorer's 2D line.
   - only surfaces visible from the scanner are recorded (line of sight; the
     box is convex, so a face is visible when the scanner is on its outer
     side). Faces: 'top', 'side', 'front', 'back'. No ground points.
   ========================================================================== */
(function () {
    'use strict';

    // ILLUSTRATIVE scanner height (m), NOT from the thesis or paper, which
    // state no mounting height. Box height 1.5 m + 1.0 m buffer, so the top
    // face is visible from above. Only positions and times depend on it; the
    // distortion (length, order, angles) does not.
    var H_SCANNER = 2.5;

    // Same constants as explorer.js (thesis object: 4 m x 2 m x 1.5 m)
    var LEN = 4, WID = 2, HGT = 1.5;
    var PROFILE_STEP = 0.05, MAX_PROFILES = 2000, SAMPLE = 0.1;
    var OVER_SCAN_TIME = 2.5, MAX_SCAN_TIME = 30;
    var D2R = Math.PI / 180;
    var EPS = 1e-7;

    function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

    function simulate3D(s, opts) {
        var H = opts && typeof opts.hScanner === 'number' ? opts.hScanner : H_SCANNER;
        var kmh = 1 / 3.6;
        var vm = s.vm * kmh, vo = s.vo * kmh;
        var th = s.theta * D2R, ph = s.phiH * D2R, pv = s.phiV * D2R;
        var sg = s.side === 'R' ? 1 : -1;

        var u = [Math.cos(th), Math.sin(th), 0];                 // object heading
        var w = [-u[1], u[0], 0];                                 // object left
        var z = [0, 0, 1];
        var N = [Math.cos(ph) * Math.cos(pv), sg * Math.sin(ph) * Math.cos(pv), Math.sin(pv)];

        // Start position: identical to simulate() (object centred on the
        // explorer's 2D scan line, 7 m to the side)
        var n2 = [Math.cos(ph), sg * Math.sin(ph)];
        var d2 = [-n2[1], n2[0]];
        if (d2[1] < 0) d2 = [-d2[0], -d2[1]];
        var c0 = [d2[0] * (7 / d2[1]), 7];

        // Box corners relative to its ground-centre
        var corners = [];
        [-1, 1].forEach(function (a) {
            [-1, 1].forEach(function (b) {
                [0, 1].forEach(function (c) {
                    corners.push([a * LEN / 2 * u[0] + b * WID / 2 * w[0], a * LEN / 2 * u[1] + b * WID / 2 * w[1], c * HGT]);
                });
            });
        });

        // Signed distance of corner from the plane: N·(c0 + o + vo t u − (vm t, 0, H)) = a_i + k t
        var k = vo * dot3(N, u) - vm * N[0];
        var a = corners.map(function (o) { return dot3(N, [c0[0] + o[0], c0[1] + o[1], o[2] - H]); });
        var amin = Math.min.apply(null, a), amax = Math.max.apply(null, a);
        var t0, t1, capped = false;
        if (Math.abs(k) < 1e-9) { t0 = 0; t1 = OVER_SCAN_TIME; capped = true; }
        else {
            t0 = Math.min(-amax / k, -amin / k);
            t1 = Math.max(-amax / k, -amin / k);
            if (t1 - t0 > MAX_SCAN_TIME) { t1 = t0 + MAX_SCAN_TIME; capped = true; }
        }

        // Profile count and point spacing: same rules as simulate(), using the
        // horizontal (unit) normal so the steps mean the same distances
        var ch = Math.cos(pv) || 1e-12;
        var k2 = k / ch;
        var vl = Math.abs(k) < 1e-9 ? vo : vm * n2[0] / (n2[0] * u[0] + n2[1] * u[1]);
        var dur = t1 - t0;
        var nProf = Math.ceil(Math.max(Math.abs(k2) * dur, Math.abs(vl) * dur, vo * dur) / PROFILE_STEP);
        nProf = Math.max(2, Math.min(MAX_PROFILES, nProf));
        var sample = SAMPLE * Math.max(1, nProf / 400);

        // Box faces: outward normal, offset of the face plane from the centre, tag
        var faces = [
            { n: u, off: LEN / 2, tag: 'front' },
            { n: [-u[0], -u[1], 0], off: LEN / 2, tag: 'back' },
            { n: w, off: WID / 2, tag: 'side' },
            { n: [-w[0], -w[1], 0], off: WID / 2, tag: 'side' },
            { n: z, off: HGT, tag: 'top', zface: true },
            { n: [0, 0, -1], off: 0, tag: 'bottom', zface: true }
        ];
        // The 12 box edges as corner index pairs (corners differ in exactly one coordinate)
        var edges = [];
        for (var p = 0; p < 8; p++) for (var q = p + 1; q < 8; q++) {
            var diff = 0;
            for (var r = 0; r < 3; r++) if (Math.abs(corners[p][r] - corners[q][r]) > 1e-9) diff++;
            // corners differing along one box axis only
            var dpq = sub3(corners[p], corners[q]);
            var along = [Math.abs(dot3(dpq, u)) > 1e-9, Math.abs(dot3(dpq, w)) > 1e-9, Math.abs(dpq[2]) > 1e-9];
            if (along.filter(Boolean).length === 1) edges.push([p, q]);
        }

        // In-plane basis for ordering the cross-section polygon
        var e1 = [-N[1], N[0], 0];
        var e1n = Math.hypot(e1[0], e1[1]) || 1;
        e1 = [e1[0] / e1n, e1[1] / e1n, 0];
        var e2 = cross3(N, e1);

        var pts = [];
        for (var i = 0; i <= nProf; i++) {
            var t = t0 + (t1 - t0) * i / nProf;
            var S = [vm * t, 0, H];
            var C = [c0[0] + vo * t * u[0], c0[1] + vo * t * u[1], 0];   // box ground-centre at t
            var P = corners.map(function (o) { return [C[0] + o[0], C[1] + o[1], o[2]]; });
            var dist = P.map(function (x) { return dot3(N, sub3(x, S)); });

            // Plane ∩ box edges -> cross-section polygon vertices
            var V = [];
            edges.forEach(function (e) {
                var da = dist[e[0]], db = dist[e[1]];
                if ((da > 0 && db > 0) || (da < 0 && db < 0)) return;
                if (da === db) return;
                var f = da / (da - db);
                var A = P[e[0]], B = P[e[1]];
                var X = [A[0] + f * (B[0] - A[0]), A[1] + f * (B[1] - A[1]), A[2] + f * (B[2] - A[2])];
                for (var m = 0; m < V.length; m++) if (Math.abs(V[m][0] - X[0]) + Math.abs(V[m][1] - X[1]) + Math.abs(V[m][2] - X[2]) < 1e-9) return;
                V.push(X);
            });
            if (V.length < 3) continue;
            var cen = [0, 0, 0];
            V.forEach(function (x) { cen[0] += x[0] / V.length; cen[1] += x[1] / V.length; cen[2] += x[2] / V.length; });
            V.sort(function (x, y) {
                var dx = sub3(x, cen), dy = sub3(y, cen);
                return Math.atan2(dot3(dx, e2), dot3(dx, e1)) - Math.atan2(dot3(dy, e2), dot3(dy, e1));
            });

            // Each polygon edge lies on one box face; keep it if that face is visible
            for (var v = 0; v < V.length; v++) {
                var A2 = V[v], B2 = V[(v + 1) % V.length];
                var face = null;
                for (var fi = 0; fi < faces.length; fi++) {
                    var F = faces[fi];
                    var ha = F.zface ? dot3(sub3(A2, C), F.n) : dot3(sub3(A2, C), F.n);
                    var hb = dot3(sub3(B2, C), F.n);
                    var lim = F.zface ? (F.tag === 'top' ? HGT : 0) : F.off;
                    if (Math.abs(ha - lim) < EPS && Math.abs(hb - lim) < EPS) { face = F; break; }
                }
                if (!face || face.tag === 'bottom') continue;
                var mid = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2, (A2[2] + B2[2]) / 2];
                if (dot3(sub3(S, mid), face.n) <= 1e-12) continue;     // back-facing: hidden

                var len = Math.hypot(B2[0] - A2[0], B2[1] - A2[1], B2[2] - A2[2]);
                var nseg = Math.max(1, Math.round(len / sample));
                for (var j = 0; j <= nseg; j++) {
                    var g = j / nseg;
                    pts.push({
                        x: A2[0] + g * (B2[0] - A2[0]),
                        y: A2[1] + g * (B2[1] - A2[1]),
                        z: A2[2] + g * (B2[2] - A2[2]),
                        t: t, i: i, face: face.tag
                    });
                }
            }
        }

        return {
            pts: pts, nProf: nProf, t0: t0, t1: t1, capped: capped,
            u: [u[0], u[1]], w: [w[0], w[1]], N: N, c0: c0, vm: vm, vo: vo,
            hScanner: H, size: { length: LEN, width: WID, height: HGT }
        };
    }

    window.mlsSimulate3D = simulate3D;
})();
