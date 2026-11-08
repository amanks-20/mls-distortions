/* Dev-only regression harness (not used by the site).
   Loads static/js/explorer.js with a minimal browser stub, then runs
   window.mlsModel / window.mlsSimulate on a fixed list of cases and prints
   the results as JSON on stdout. Run from the repo root via tests/check.py.
   Works in Node or in macOS JavaScriptCore (jsc). */
(function (G) {
    'use strict';

    // ---------- Minimal browser stub ----------
    function noop() {}
    function el() {
        return {
            textContent: '', value: '', dataset: {}, clientWidth: 800, clientHeight: 450, width: 0, height: 0,
            addEventListener: noop, setAttribute: noop,
            classList: { toggle: noop, add: noop, remove: noop },
            querySelector: function () { return el(); },
            querySelectorAll: function () { return []; },
            getContext: function () {
                return new Proxy({}, { get: function () { return noop; }, set: function () { return true; } });
            }
        };
    }
    G.window = G;
    G.document = {
        documentElement: {},
        getElementById: function (id) { return id === 'explorer' ? el() : null; }
    };
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

    // ---------- Load the simulator unchanged ----------
    var path = 'static/js/explorer.js';
    var src = typeof require === 'function' ? require('fs').readFileSync(path, 'utf8') : read(path);
    (0, eval)(src);
    var model = G.mlsModel, simulate = G.mlsSimulate;
    if (!model || !simulate) throw new Error('explorer.js did not expose mlsModel / mlsSimulate');

    // ---------- Cases ----------
    // The 6 presets exactly as applyPreset() sets them (phiH = 45, phiV = 30), on both sides.
    var PRESETS = {
        A1: { vm: 40, vo: 20, theta: 0 },
        A3: { vm: 40, vo: 100, theta: 0 },
        A2: { vm: 40, vo: 40, theta: 0 },
        B1: { vm: 40, vo: 20, theta: 180 },
        C1: { vm: 40, vo: 20, theta: 90 },
        D2: { vm: 40, vo: 40, theta: 40 }
    };
    var cases = [];
    Object.keys(PRESETS).forEach(function (id) {
        ['L', 'R'].forEach(function (side) {
            var p = PRESETS[id];
            cases.push({ id: id + '-' + side, s: { vm: p.vm, vo: p.vo, theta: p.theta, side: side, phiH: 45, phiV: 30 } });
        });
    });
    // 10 extra fixed parameter sets (test inputs only, not results).
    var EXTRA = [
        ['X01-theta0',          { vm: 30, vo: 50, theta: 0,   side: 'R', phiH: 45, phiV: 30 }],
        ['X02-theta90',         { vm: 60, vo: 25, theta: 90,  side: 'L', phiH: 45, phiV: 30 }],
        ['X03-theta180',        { vm: 20, vo: 60, theta: 180, side: 'R', phiH: 45, phiV: 30 }],
        ['X04-overelong-L',     { vm: 60, vo: 60, theta: 0,   side: 'L', phiH: 45, phiV: 30 }],
        ['X05-phiV60',          { vm: 40, vo: 20, theta: 40,  side: 'R', phiH: 45, phiV: 60 }],
        ['X06-phiV10',          { vm: 40, vo: 30, theta: 130, side: 'L', phiH: 45, phiV: 10 }],
        ['X07-phiH20',          { vm: 50, vo: 30, theta: 60,  side: 'R', phiH: 20, phiV: 30 }],
        ['X08-static',          { vm: 40, vo: 0,  theta: 0,   side: 'R', phiH: 45, phiV: 30 }],
        ['X09-instant',         { vm: 40, vo: 30, theta: 135, side: 'R', phiH: 45, phiV: 30 }],
        ['X10-layover-retain',  { vm: 30, vo: 60, theta: 0,   side: 'L', phiH: 45, phiV: 30 }]
    ];
    EXTRA.forEach(function (e) { cases.push({ id: e[0], s: e[1] }); });

    // ---------- Helpers ----------
    function num(x) {                       // JSON-safe number
        if (typeof x !== 'number') return x;
        if (isNaN(x)) return 'NaN';
        if (!isFinite(x)) return x > 0 ? 'Infinity' : '-Infinity';
        return x;
    }
    function fix(x) {                       // rounded text for hashing (robust to last-bit libm differences)
        var t = x.toFixed(6);
        return t === '-0.000000' ? '0.000000' : t;
    }
    function fnv(str, seed) {               // FNV-1a 32-bit
        var h = seed >>> 0;
        for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
        return ('0000000' + h.toString(16)).slice(-8);
    }

    // ---------- Run ----------
    var out = { engine: typeof require === 'function' ? 'node' : 'jsc', cases: {} };
    cases.forEach(function (c) {
        var m = model(c.s), r = simulate(c.s);
        var mo = {};
        Object.keys(m).sort().forEach(function (k) { mo[k] = num(m[k]); });
        var parts = r.pts.map(function (p) { return [fix(p.x), fix(p.y), fix(p.t), fix(p.lu), p.i].join(','); });
        var blob = parts.join(';');
        out.cases[c.id] = {
            input: c.s,
            model: mo,
            sim: {
                points: r.pts.length, nProf: r.nProf, t0: num(r.t0), t1: num(r.t1),
                lsEdge: num(r.lsEdge), inverted: r.inverted, capped: r.capped,
                ptsHash: fnv(blob, 2166136261) + fnv(blob, 0x9747b28c)
            }
        };
    });
    var json = JSON.stringify(out);
    if (typeof console !== 'undefined' && console.log) console.log(json); else print(json);
})(typeof globalThis !== 'undefined' ? globalThis : this);
