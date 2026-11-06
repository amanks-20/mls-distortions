/* Phone nav: adds a menu button that opens the links as a full-screen panel.
   Without JS (or on wider screens) the nav keeps its normal link row. */
(function () {
    var nav = document.querySelector('.nav');
    var links = nav && nav.querySelector('.nav-links');
    if (!links) return;

    links.id = links.id || 'nav-links';

    var btn = document.createElement('button');
    btn.className = 'nav-toggle';
    btn.type = 'button';
    btn.setAttribute('aria-controls', links.id);
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Open menu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    links.parentNode.insertBefore(btn, links);

    // Stagger the links as they fade in
    Array.prototype.forEach.call(links.children, function (a, i) {
        a.style.setProperty('--i', i);
    });

    nav.classList.add('has-toggle');

    function setOpen(open) {
        nav.classList.toggle('is-open', open);
        document.documentElement.classList.toggle('nav-locked', open);
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }

    btn.addEventListener('click', function () {
        setOpen(!nav.classList.contains('is-open'));
    });

    links.addEventListener('click', function (e) {
        if (e.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('is-open')) {
            setOpen(false);
            btn.focus();
        }
    });

    var mq = window.matchMedia('(min-width: 721px)');
    var onChange = function (e) { if (e.matches) setOpen(false); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
})();
