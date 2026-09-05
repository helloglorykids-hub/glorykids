/* ============================================================
   content.js — apply admin-editable content at page load
   ============================================================
   Add to a marketing page as:
     <body data-gk-content="home"> … </body>
   and mark editable nodes:
     <h1 data-gk-edit="hero.title">Default heading</h1>
     <img data-gk-edit-src="hero.image" src="default.jpg">
   Values are read from Firestore content/{pageId}. Missing value
   → the hard-coded default stays (safe). build.js bakes the same
   values in for crawlers. Also exposes window.__gkPricing from
   content/pricing for pricing-data.js to merge.
   ============================================================ */
(function () {
  var PROJECT = 'glorykidsministries-3d279';
  var API_KEY = 'AIzaSyBkGSjwewBHTwf1SSNb7hbNkLaD89X-onk';
  var REST = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents';

  function decode(v) {
    if (v == null) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('mapValue' in v) {
      var o = {}, f = (v.mapValue && v.mapValue.fields) || {};
      Object.keys(f).forEach(function (k) { o[k] = decode(f[k]); });
      return o;
    }
    return null;
  }
  function fields(j) {
    var o = {};
    Object.keys(j.fields || {}).forEach(function (k) { o[k] = decode(j.fields[k]); });
    return o;
  }
  function getDoc(pathSeg) {
    if (window.db && window.db.collection) {
      var parts = pathSeg.split('/');
      return window.db.collection(parts[0]).doc(parts[1]).get()
        .then(function (s) { return s.exists ? s.data() : {}; })
        .catch(function () { return restDoc(pathSeg); });
    }
    return restDoc(pathSeg);
  }
  function restDoc(pathSeg) {
    return fetch(REST + '/' + pathSeg + '?key=' + API_KEY)
      .then(function (r) { return r.ok ? r.json().then(fields) : {}; })
      .catch(function () { return {}; });
  }

  function apply(values) {
    document.querySelectorAll('[data-gk-edit]').forEach(function (el) {
      var key = el.getAttribute('data-gk-edit');
      if (values[key] != null && values[key] !== '') el.innerHTML = values[key];
    });
    document.querySelectorAll('[data-gk-edit-src]').forEach(function (el) {
      var key = el.getAttribute('data-gk-edit-src');
      if (values[key]) el.setAttribute('src', values[key]);
    });
  }

  var pageId = document.body && document.body.getAttribute('data-gk-content');
  var jobs = [getDoc('content/pricing').then(function (p) { window.__gkPricing = p || {}; })];
  if (pageId) {
    jobs.push(getDoc('content/' + pageId).then(function (v) {
      var run = function () { apply(v || {}); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
      else run();
    }));
  }
  Promise.all(jobs).then(function () {
    // let pricing-data.js know it can (re-)render with overrides
    if (typeof window.gkApplyPricingOverrides === 'function') window.gkApplyPricingOverrides();
  });
})();
