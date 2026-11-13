/* ==========================================================================
   "Observed in the field" panel for the distortion explorer.
   Reads window.FIELD_DATA (static/js/field-data.js) and shows the example for
   the selected preset. It does not touch the explorer's state or drawing: it
   only watches which preset button is pressed (aria-pressed), which the
   explorer already maintains in applyPreset() and update().
   ========================================================================== */
(function () {
    'use strict';

    var root = document.getElementById('explorer');
    var panel = document.getElementById('ex-field');
    var body = document.getElementById('ex-field-body');
    var data = window.FIELD_DATA;
    if (!root || !panel || !body || !data) return;

    var presetBtns = root.querySelectorAll('[data-preset]');
    var shown;                                   // preset id currently rendered ('' = none)

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    // Hidden when the case has no field example: the CSS keeps its grid column
    // on wide screens (visibility) and removes it on narrow ones (display).
    function setEmpty(empty) {
        if (empty) {
            body.replaceChildren();
            panel.setAttribute('data-empty', '');
            panel.setAttribute('aria-hidden', 'true');
            panel.inert = true;
        } else {
            panel.removeAttribute('data-empty');
            panel.removeAttribute('aria-hidden');
            panel.inert = false;
        }
    }

    function speed(v) {
        return v.kmh + (v.pm ? ' ± ' + v.pm : '') + ' km/h';
    }

    function figure(id, f) {
        var fig = el('figure');

        // Full-size link; <picture> picks the light or dark image from the
        // system theme and switches automatically when the theme changes.
        var link = el('a', 'field-img');
        link.href = f.image;
        link.target = '_blank';
        link.rel = 'noopener';
        link.setAttribute('aria-label', 'Open the field image full size (' + id + '), opens in a new tab');
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
        img.addEventListener('error', function () { body.replaceChildren(el('p', 'field-empty', 'The field image could not be loaded.')); });
        pic.appendChild(img);
        link.appendChild(pic);
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
        if (!f) { setEmpty(true); return; }
        setEmpty(false);
        body.replaceChildren(figure(f.id || id, f));
    }

    // The explorer sets aria-pressed on the preset buttons; follow it.
    var pending = false;
    var obs = new MutationObserver(function () {
        if (pending) return;
        pending = true;
        Promise.resolve().then(function () { pending = false; render(); });
    });
    presetBtns.forEach(function (b) { obs.observe(b, { attributes: true, attributeFilter: ['aria-pressed'] }); });

    render();
})();
