/* ==========================================================================
   "Observed in the field" panel for the distortion explorer.
   Reads window.FIELD_DATA (static/js/field-data.js) and shows the example for
   the selected preset (A2, B1). For any other preset, or none, it shows a
   picker with the two examples; a picker button just clicks the matching
   preset button, so loading is the explorer's own applyPreset() + play().
   The panel otherwise does not touch the explorer's state or drawing: it
   only watches which preset button is pressed (aria-pressed), which the
   explorer already maintains in applyPreset() and update().

   Fixed size: the live body and an invisible, inert copy of every state
   (picker, A2, B1; without images, whose boxes have a fixed aspect ratio)
   share one grid cell, so the panel is always as tall as its tallest state
   at the current width and does not change size when the preset changes.
   ========================================================================== */
(function () {
    'use strict';

    var root = document.getElementById('explorer');
    var body = document.getElementById('ex-field-body');
    var data = window.FIELD_DATA;
    if (!root || !body || !data) return;

    var presetBtns = root.querySelectorAll('[data-preset]');
    var PICKS = [                                // picker entries, in order
        { id: 'A2', label: 'A2 · over-elongation', name: 'Load thesis case A2, over-elongation' },
        { id: 'B1', label: 'B1 · contraction', name: 'Load thesis case B1, contraction' }
    ].filter(function (p) { return data[p.id]; });
    var shown;                                   // preset id currently rendered ('' = none)

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function message(text) {
        body.replaceChildren(el('p', 'field-empty', text));
    }

    function speed(v) {
        return v.kmh + (v.pm ? ' ± ' + v.pm : '') + ' km/h';
    }

    // <picture> picks the light or dark image from the system theme and
    // switches automatically when the theme changes.
    function picture(f) {
        var pic = el('picture');
        if (f.imageDark) {
            var src = el('source');
            src.media = '(prefers-color-scheme: dark)';
            src.srcset = f.imageDark;
            pic.appendChild(src);
        }
        var img = el('img');
        img.src = f.image;
        img.alt = f.alt || '';
        img.width = f.width || 960;
        img.height = f.height || 600;
        img.loading = 'lazy';
        img.decoding = 'async';
        img.addEventListener('error', function () { message('The field image could not be loaded.'); });
        pic.appendChild(img);
        return pic;
    }

    function figure(id, f) {
        var fig = el('figure');

        // Full-size link to the image
        var link = el('a', 'field-img');
        link.href = f.image;
        link.target = '_blank';
        link.rel = 'noopener';
        link.setAttribute('aria-label', 'Open the field image full size (' + id + '), opens in a new tab');
        link.appendChild(picture(f));
        fig.appendChild(link);

        var cap = el('figcaption');
        cap.appendChild(el('p', null, f.caption));

        var meta = el('p', 'field-meta');
        var parts = [
            f.regime,
            'mapper ' + speed(f.vm),
            'object ' + speed(f.vo),
            'θ ≈ ' + Math.abs(f.theta) + '°',
            f.location
        ];
        if (f.date) parts.push(f.date);
        meta.appendChild(el('strong', null, id + ' · '));
        meta.appendChild(document.createTextNode(parts.filter(Boolean).join(' · ')));
        cap.appendChild(meta);

        if (f.scale) cap.appendChild(el('p', 'field-scale', f.scale));
        if (f.credit) cap.appendChild(el('p', 'field-credit', f.credit));
        fig.appendChild(cap);
        return fig;
    }

    // Shown when the selected case has no field example (or no case is selected)
    function picker() {
        var wrap = el('div', 'field-pick');
        wrap.appendChild(el('h4', 'field-pick-title', 'Real MLS examples'));
        var list = el('div', 'field-pick-list');
        PICKS.forEach(function (p) {
            var b = el('button', 'field-thumb');
            b.type = 'button';
            b.dataset.load = p.id;
            b.setAttribute('aria-label', p.name);
            var box = el('span', 'field-thumb-img');
            box.appendChild(picture(data[p.id]));
            b.appendChild(box);
            b.appendChild(el('span', 'field-thumb-label', p.label));
            b.addEventListener('click', function () { load(p.id); });
            list.appendChild(b);
        });
        wrap.appendChild(list);
        wrap.appendChild(el('p', 'field-empty', 'Field data are available for thesis cases ' +
            PICKS.map(function (p) { return p.id; }).join(' and ') + '.'));
        var credit = PICKS.length && data[PICKS[0].id].credit;
        if (credit) wrap.appendChild(el('p', 'field-credit', credit));
        return wrap;
    }

    // Exactly what clicking the preset button does (the explorer's own handler)
    function load(id) {
        for (var i = 0; i < presetBtns.length; i++) {
            if (presetBtns[i].dataset.preset === id) { presetBtns[i].click(); break; }
        }
        render();                                // now, not after the observer, so focus can follow
        var target = body.querySelector('.field-img');
        if (target) target.focus({ preventScroll: true });
    }

    function currentPreset() {
        for (var i = 0; i < presetBtns.length; i++) {
            if (presetBtns[i].getAttribute('aria-pressed') === 'true') return presetBtns[i].dataset.preset;
        }
        return '';
    }

    function render() {
        var id = currentPreset();
        if (id === shown) return;                // nothing changed: don't re-announce
        shown = id;
        var f = id && data[id];
        body.replaceChildren(f ? figure(f.id || id, f) : picker());
    }

    // Invisible copies of every state, in the same grid cell as the body
    function reserve() {
        var stack = el('div', 'field-stack');
        body.parentNode.insertBefore(stack, body);
        stack.appendChild(body);
        var states = [picker()].concat(PICKS.map(function (p) { return figure(data[p.id].id || p.id, data[p.id]); }));
        states.forEach(function (node) {
            node.querySelectorAll('picture').forEach(function (pic) { pic.remove(); });
            var s = el('div', 'field-sizer');
            s.setAttribute('aria-hidden', 'true');
            s.inert = true;
            s.appendChild(node);
            stack.appendChild(s);
        });
    }

    // The explorer sets aria-pressed on the preset buttons; follow it.
    var pending = false;
    var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        Promise.resolve().then(function () { pending = false; render(); });
    });
    presetBtns.forEach(function (b) { obs.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); });

    reserve();
    render();
})();
