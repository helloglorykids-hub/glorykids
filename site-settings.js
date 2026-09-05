/* ============================================================
   SITE SETTINGS — shared runtime for every public page
   ============================================================
   Applies the settings managed in admin.html (Site Settings,
   Pages, SEO & Redirects, Navigation, Analytics tabs) to the
   live site: favicon, meta/SEO tags, canonical, GA4, the
   announcement bar, page visibility guard, redirect map, nav
   sync, and a cookie-free first-party pageview counter.

   Backed by Firestore. Reads are public (see firestore.rules).
   Works with or without the Firebase compat SDK on the page —
   falls back to the Firestore REST API. Settings are cached in
   localStorage for 5 minutes so we don't read on every hit.

   NOTE: this is the runtime fallback layer. build.js bakes the
   same SEO values straight into each page's <head> for crawlers
   and social scrapers that don't run JS — that always wins.
   ============================================================ */
(function () {
  var PROJECT = 'glorykidsministries-3d279';
  var API_KEY = 'AIzaSyBkGSjwewBHTwf1SSNb7hbNkLaD89X-onk';
  var REST = 'https://firestore.googleapis.com/v1/projects/' + PROJECT +
             '/databases/(default)/documents';
  var CACHE_KEY = 'gk_site_settings_v1';
  var CACHE_MS = 5 * 60 * 1000;

  /* ---------- tiny Firestore REST value decoder ---------- */
  function decode(v) {
    if (v == null) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('nullValue' in v) return null;
    if ('mapValue' in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
    if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decode);
    if ('timestampValue' in v) return v.timestampValue;
    return null;
  }
  function decodeFields(fields) {
    var out = {};
    Object.keys(fields || {}).forEach(function (k) { out[k] = decode(fields[k]); });
    return out;
  }

  /* ---------- data access (SDK if present, else REST) ---------- */
  function getDocSDK(path) {
    var parts = path.split('/');
    var ref = window.db.collection(parts[0]).doc(parts[1]);
    return ref.get().then(function (s) { return s.exists ? s.data() : null; });
  }
  function getColSDK(name) {
    return window.db.collection(name).get().then(function (snap) {
      return snap.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
    });
  }
  function getDocREST(path) {
    return fetch(REST + '/' + path + '?key=' + API_KEY).then(function (r) {
      if (!r.ok) return null;
      return r.json().then(function (j) { return j.fields ? decodeFields(j.fields) : null; });
    }).catch(function () { return null; });
  }
  function getColREST(name) {
    return fetch(REST + '/' + name + '?pageSize=300&key=' + API_KEY).then(function (r) {
      if (!r.ok) return [];
      return r.json().then(function (j) {
        return (j.documents || []).map(function (d) {
          var o = decodeFields(d.fields || {});
          o.id = d.name.split('/').pop();
          return o;
        });
      });
    }).catch(function () { return []; });
  }
  var hasSDK = !!(window.db && window.db.collection);
  function getDoc(path) { return hasSDK ? getDocSDK(path).catch(function () { return getDocREST(path); }) : getDocREST(path); }
  function getCol(name) { return hasSDK ? getColSDK(name).catch(function () { return getColREST(name); }) : getColREST(name); }

  /* ---------- load settings (cached) ---------- */
  function loadSettings() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (c && (Date.now() - c._t) < CACHE_MS) return Promise.resolve(c.data);
    } catch (e) {}
    return Promise.all([getDoc('site/config'), getCol('pages'), getCol('redirects')])
      .then(function (res) {
        var data = { config: res[0] || {}, pages: res[1] || [], redirects: res[2] || [] };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ _t: Date.now(), data: data })); } catch (e) {}
        return data;
      });
  }

  /* ---------- DOM helpers ---------- */
  function currentPath() {
    var p = location.pathname;
    if (p === '/' || p === '') return 'index.html';
    return p.replace(/^\//, '');
  }
  function upsertMeta(sel, attrs) {
    var el = document.head.querySelector(sel);
    if (!el) {
      el = document.createElement('meta');
      Object.keys(attrs).forEach(function (k) { if (k !== 'content') el.setAttribute(k, attrs[k]); });
      document.head.appendChild(el);
    }
    el.setAttribute('content', attrs.content || '');
  }
  function upsertLink(rel, href, extra) {
    if (!href) return;
    var el = document.head.querySelector('link[rel="' + rel + '"]');
    if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
    el.setAttribute('href', href);
    if (extra) Object.keys(extra).forEach(function (k) { el.setAttribute(k, extra[k]); });
  }

  /* ---------- feature: favicon + icons ---------- */
  function applyIcons(cfg) {
    if (cfg.faviconUrl) {
      document.head.querySelectorAll('link[rel="icon"],link[rel="shortcut icon"]').forEach(function (n) { n.remove(); });
      upsertLink('icon', cfg.faviconUrl);
    }
    if (cfg.appleTouchIconUrl) upsertLink('apple-touch-icon', cfg.appleTouchIconUrl);
  }

  /* ---------- feature: SEO / meta ---------- */
  function applySeo(cfg, page) {
    var title = (page && page.seoTitle) || '';
    var desc  = (page && page.seoDescription) || cfg.defaultMetaDescription || '';
    var og    = (page && page.ogImageUrl) || cfg.defaultOgImageUrl || '';
    var canon = (page && page.canonicalUrl) || (location.origin + location.pathname);

    // Only override the on-page <title> when the admin set an explicit one.
    if (title) document.title = title;
    var effTitle = document.title;

    if (desc) upsertMeta('meta[name="description"]', { name: 'description', content: desc });
    if (cfg.keywords) upsertMeta('meta[name="keywords"]', { name: 'keywords', content: cfg.keywords });

    upsertLink('canonical', canon);

    upsertMeta('meta[property="og:title"]',       { property: 'og:title', content: effTitle });
    upsertMeta('meta[property="og:type"]',        { property: 'og:type', content: 'website' });
    upsertMeta('meta[property="og:url"]',         { property: 'og:url', content: canon });
    if (desc) upsertMeta('meta[property="og:description"]', { property: 'og:description', content: desc });
    if (og)   upsertMeta('meta[property="og:image"]',       { property: 'og:image', content: og });
    if (cfg.siteName) upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: cfg.siteName });

    upsertMeta('meta[name="twitter:card"]',  { name: 'twitter:card', content: og ? 'summary_large_image' : 'summary' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: effTitle });
    if (desc) upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: desc });
    if (og)   upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: og });
    if (cfg.twitterHandle) upsertMeta('meta[name="twitter:site"]', { name: 'twitter:site', content: cfg.twitterHandle });

    if (page && page.noindex) upsertMeta('meta[name="robots"]', { name: 'robots', content: 'noindex, nofollow' });

    if (cfg.gscVerification && !document.head.querySelector('meta[name="google-site-verification"]')) {
      upsertMeta('meta[name="google-site-verification"]', { name: 'google-site-verification', content: cfg.gscVerification });
    }
  }

  /* ---------- feature: Organization JSON-LD ---------- */
  function applySchema(cfg) {
    var org = cfg.organization || {};
    if (!org.name && !cfg.siteName) return;
    var data = {
      '@context': 'https://schema.org', '@type': 'Organization',
      name: org.name || cfg.siteName,
      url: org.url || location.origin
    };
    if (org.logoUrl) data.logo = org.logoUrl;
    if (Array.isArray(org.sameAs) && org.sameAs.filter(Boolean).length) data.sameAs = org.sameAs.filter(Boolean);
    if (cfg.contactEmail) data.email = cfg.contactEmail;
    if (cfg.contactPhone) data.telephone = cfg.contactPhone;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.setAttribute('data-gk-schema', '1');
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  /* ---------- feature: custom header / footer code injection ---------- */
  function runInjected(html, where) {
    if (!html) return;
    var tpl = document.createElement('template');
    tpl.innerHTML = html;
    var frag = tpl.content;
    // <script> from innerHTML won't execute — rebuild each one.
    frag.querySelectorAll('script').forEach(function (old) {
      var s = document.createElement('script');
      for (var i = 0; i < old.attributes.length; i++) {
        s.setAttribute(old.attributes[i].name, old.attributes[i].value);
      }
      s.text = old.textContent;
      old.replaceWith(s);
    });
    (where === 'head' ? document.head : document.body).appendChild(frag);
  }
  function applyCodeInjection(cfg) {
    if (window.__gkCodeInjected) return;
    window.__gkCodeInjected = true;
    if (cfg.headCode) runInjected(cfg.headCode, 'head');
    if (cfg.bodyEndCode) {
      var run = function () { runInjected(cfg.bodyEndCode, 'body'); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
      else run();
    }
  }

  /* ---------- feature: Google Analytics 4 ---------- */
  function applyGA4(cfg) {
    var id = cfg.ga4MeasurementId;
    if (!id || window.__gkGA4) return;
    window.__gkGA4 = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', id);
  }

  /* ---------- feature: announcement bar ---------- */
  function applyAnnouncement(cfg) {
    var a = cfg.announcement || {};
    if (!a.enabled || !a.text) return;
    if (document.getElementById('gk-announce-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'gk-announce-bar';
    bar.style.cssText = 'position:relative;z-index:1200;background:' + (a.bg || '#1f2937') +
      ';color:' + (a.fg || '#fff') + ';font:600 14px/1.4 Inter,system-ui,sans-serif;' +
      'text-align:center;padding:10px 40px;';
    var inner = a.text;
    if (a.linkUrl) {
      inner = '<a href="' + a.linkUrl + '" style="color:inherit;text-decoration:underline;">' +
        a.text + (a.linkLabel ? ' — ' + a.linkLabel : '') + '</a>';
    }
    bar.innerHTML = inner +
      '<button aria-label="Dismiss" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);' +
      'background:none;border:0;color:inherit;font-size:18px;cursor:pointer;line-height:1;">&times;</button>';
    bar.querySelector('button').onclick = function () {
      bar.remove();
      try { sessionStorage.setItem('gk_announce_dismissed', a.text); } catch (e) {}
    };
    try { if (sessionStorage.getItem('gk_announce_dismissed') === a.text) return; } catch (e) {}
    document.body.insertBefore(bar, document.body.firstChild);
  }

  /* ---------- feature: redirect map ---------- */
  function applyRedirects(redirects) {
    var here = location.pathname.replace(/\/index\.html$/, '/');
    for (var i = 0; i < redirects.length; i++) {
      var r = redirects[i];
      if (r.enabled === false || !r.from || !r.to) continue;
      var from = String(r.from).replace(/\/index\.html$/, '/');
      if (from === here || from === location.pathname) {
        location.replace(r.to);
        return true;
      }
    }
    return false;
  }

  /* ---------- feature: page visibility guard ---------- */
  function applyVisibilityGuard(page) {
    if (!page || page.visible !== false) return;
    // Admins keep access + see a banner; everyone else is bounced.
    var isAdmin = false;
    try { isAdmin = localStorage.getItem('gk_is_admin') === '1'; } catch (e) {}
    if (!isAdmin) { location.replace('/'); return true; }
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:2000;background:#b91c1c;color:#fff;' +
      'padding:10px 16px;border-radius:8px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);';
    b.textContent = '👁️ This page is hidden from visitors (admin preview)';
    document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
    return false;
  }

  /* ---------- feature: nav sync ---------- */
  function applyNavSync(pages) {
    var hidden = {};
    pages.forEach(function (p) {
      if (p.visible === false || p.inHeaderNav === false) hidden[p.path] = true;
    });
    function hideMatching(sel) {
      document.querySelectorAll(sel).forEach(function (a) {
        var href = (a.getAttribute('href') || '').replace(/^\.?\//, '').split('#')[0].split('?')[0];
        if (href && hidden[href]) a.style.display = 'none';
      });
    }
    hideMatching('.nav__link, .nav__mobile-link, .footer a, .site-footer a');
  }

  /* ---------- feature: pageview counter ---------- */
  function recordView() {
    var refHost = '';
    try { refHost = document.referrer ? new URL(document.referrer).host : ''; } catch (e) {}
    if (window.GK && window.GK.bumpAnalytics) { window.GK.bumpAnalytics(currentPath(), refHost); return; }
    // REST fallback: commit an upsert with an increment transform.
    var day = new Date();
    var stamp = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') +
                '-' + String(day.getDate()).padStart(2, '0');
    var pathKey = currentPath().replace(/[^\w.-]+/g, '_').slice(0, 120) || 'root';
    var docName = 'projects/' + PROJECT + '/databases/(default)/documents/analyticsDaily/' + stamp;
    var transforms = [
      { fieldPath: 'views', increment: { integerValue: '1' } },
      { fieldPath: '`byPath`.`' + pathKey + '`', increment: { integerValue: '1' } }
    ];
    if (refHost) {
      var rk = refHost.replace(/[^\w.-]+/g, '_').slice(0, 120);
      if (rk && rk !== location.host.replace(/[^\w.-]+/g, '_')) {
        transforms.push({ fieldPath: '`byReferrerHost`.`' + rk + '`', increment: { integerValue: '1' } });
      }
    }
    var body = { writes: [{
      update: { name: docName, fields: { updatedAt: { integerValue: String(Date.now()) } } },
      updateMask: { fieldPaths: ['updatedAt'] },
      updateTransforms: transforms
    }] };
    fetch('https://firestore.googleapis.com/v1/projects/' + PROJECT +
          '/databases/(default)/documents:commit?key=' + API_KEY, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).catch(function () {});
  }

  /* ---------- boot ---------- */
  loadSettings().then(function (s) {
    var cfg = s.config || {};
    var path = currentPath();
    var page = (s.pages || []).filter(function (p) { return p.path === path; })[0];

    if (applyRedirects(s.redirects || [])) return;
    if (applyVisibilityGuard(page)) return;

    applyIcons(cfg);
    applyGA4(cfg);
    applyCodeInjection(cfg);
    applySeo(cfg, page);
    applySchema(cfg);
    applyNavSync(s.pages || []);

    function onReady(fn) {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
      else fn();
    }
    onReady(function () { applyAnnouncement(cfg); });

    recordView();
  }).catch(function (e) { if (window.console) console.warn('site-settings:', e); });
})();
