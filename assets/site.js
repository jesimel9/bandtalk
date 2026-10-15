// Remplit la page à partir de assets/config.js. La page reste lisible même sans JavaScript.
(function () {
  var c = window.BANDTALK || {};
  var fcfa = function (v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); };
  var phone = function (n) {
    var m = /^\+(\d{3})(\d{10})$/.exec(String(n).replace(/\s/g, ''));
    if (!m) return n;
    var d = m[2];
    return '+' + m[1] + ' ' + d.slice(0, 2) + ' ' + d.slice(2, 4) + ' ' + d.slice(4, 6) + ' ' + d.slice(6, 8) + ' ' + d.slice(8);
  };
  var values = {
    version: c.version,
    taille: c.apkSizeMo,
    sha256: c.sha256,
    'android-min': c.androidMin ? c.androidMin + ' ou plus' : null,
    prix: c.prixFcfa != null ? fcfa(c.prixFcfa) : null,
    duree: c.dureeJours,
    essais: c.essaisGratuits,
    'essais-texte': c.essaisGratuits != null
      ? c.essaisGratuits + ' session' + (c.essaisGratuits > 1 ? 's' : '') + ' gratuite' + (c.essaisGratuits > 1 ? 's' : '')
      : null,
    wave: c.numeroWave ? phone(c.numeroWave) : null,
  };
  document.querySelectorAll('[data-bt]').forEach(function (el) {
    var v = values[el.getAttribute('data-bt')];
    if (v != null && v !== '') el.textContent = v;
  });

  // Empreinte SHA-256 : masquée si absente.
  if (!c.sha256) {
    ['hash-dt', 'hash-dd'].forEach(function (id) { var e = document.getElementById(id); if (e) e.hidden = true; });
  }

  // Bouton de téléchargement.
  var dl = document.getElementById('dl-btn');
  var configured = c.apkUrl && c.apkUrl.indexOf('VOTRE-COMPTE') < 0;
  if (dl) {
    if (configured) {
      dl.href = c.apkUrl;
      dl.setAttribute('download', 'BandTalk.apk');
    } else {
      dl.addEventListener('click', function (e) { e.preventDefault(); });
      dl.setAttribute('aria-disabled', 'true');
      dl.style.opacity = '0.55';
      var w = document.getElementById('dl-warn');
      if (w) w.hidden = false;
    }
  }

  // Copier le numéro Wave.
  var copy = document.getElementById('copy-wave');
  if (copy && c.numeroWave) {
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Copié ✓'; setTimeout(function () { copy.textContent = 'Copier'; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(c.numeroWave).then(done, done);
      } else {
        var t = document.createElement('textarea');
        t.value = c.numeroWave; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (e) { /* ignoré */ }
        document.body.removeChild(t); done();
      }
    });
  }

  // Contact (masqué si non renseigné).
  var mail = document.getElementById('contact-mail');
  if (mail && c.contactEmail) { mail.href = 'mailto:' + c.contactEmail; mail.hidden = false; }
  var wa = document.getElementById('contact-wa');
  if (wa && c.contactWhatsapp) { wa.href = 'https://wa.me/' + c.contactWhatsapp.replace(/\D/g, ''); wa.hidden = false; }

  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // Mode jour / nuit (mémorisé sur cet appareil seulement ; appliqué dès le <head>).
  var root = document.documentElement;
  var tg = document.getElementById('theme');
  if (tg) {
    tg.addEventListener('click', function () {
      var cur = root.getAttribute('data-theme') ||
        (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      var next = cur === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('bt-theme', next); } catch (e) { /* ignoré */ }
    });
  }

  // Tutoriel : onglets accessibles (clic, flèches, Début, Fin).
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  var select = function (tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  };
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { select(t, false); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, n = tabs.length, j = -1;
      if (k === 'ArrowRight') j = (i + 1) % n;
      else if (k === 'ArrowLeft') j = (i - 1 + n) % n;
      else if (k === 'Home') j = 0;
      else if (k === 'End') j = n - 1;
      if (j >= 0) { e.preventDefault(); select(tabs[j], true); }
    });
  });
  // Lien direct vers un onglet : …#tutoriel-wifi ou …#tutoriel-4g
  var h = location.hash.replace('#tutoriel-', '');
  var direct = document.getElementById('tab-' + h);
  if (direct && location.hash.indexOf('#tutoriel-') === 0) {
    select(direct, false);
    var sec = document.getElementById('tutoriel');
    if (sec) sec.scrollIntoView();
  }

  // Apparition douce des blocs au défilement (désactivée si « réduire les animations »).
  var items = document.querySelectorAll('.reveal');
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || still) {
    items.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }
})();
