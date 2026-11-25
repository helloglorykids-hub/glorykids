#!/usr/bin/env node
/* ============================================================
   build.js — bake admin settings into the static site
   ============================================================
   Pulls Site Settings / Pages / Redirects from Firestore (public
   reads) and writes them into every *.html <head>, plus generates
   robots.txt, sitemap.xml, _redirects and netlify.toml.

   This is the layer that makes SEO work for crawlers and social
   link-preview scrapers that don't run JavaScript. site-settings.js
   is the live fallback; whatever this bakes in always wins.

   Run before every deploy:   node build.js       (or: npm run build)
   Requires Node 18+ (global fetch). No dependencies.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const PROJECT = 'glorykidsministries-3d279';
const API_KEY = 'AIzaSyBkGSjwewBHTwf1SSNb7hbNkLaD89X-onk';
const REST = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.glorykidsministry.com';
const DIR = __dirname;
const START = '<!-- gk:managed:start -->';
const END = '<!-- gk:managed:end -->';

/* Pages kept out of sitemap.xml — auth flows, account/utility pages, thank-you
   and preview pages, and the 404. These have no SEO value and shouldn't be
   surfaced in search. Matched against the bare filename. */
const SITEMAP_EXCLUDE = new Set([
  '404.html',
  'activities.html',
  'login.html',
  'signup.html',
  'forgot-password.html',
  'dashboard.html',
  'shop-thankyou.html',
  'glory-kids-membership-preview.html',
  'admin.html',
  'admin-login.html',
  'admin-data.html',
  'lesson-gate.html',
  'checkout.html',
  // permanently redirected (see netlify.toml) — listing a page in the
  // sitemap tells Google "index this" while the server says "actually, go
  // here instead", which Search Console flags as a coverage issue
  'glory-kids-membership.html',
  'church-pricing.html',
  // template, not a real page — individual posts are added from `posts` below
  'blog-post.html',
  // template, not a real page — individual packs are added from `products` below
  'curriculum-pack.html',
]);

/* Static per-post / per-pack pages generated below (free-bible-lessons/<slug>/,
   blog/<category>/<slug>/, pack/<slug>/) — excluded from the general HTML walk
   so a second build doesn't re-bake or double-list them; they're handled by
   generatePostPages()/generatePackPages() and added to the sitemap explicitly. */
const GENERATED_DETAIL_PAGE = /^(free-bible-lessons|blog\/(parents|pastors|kidmin)|pack)\/[^/]+\/index\.html$/;

/* Directories never walked for HTML files (build tooling, VCS, dependencies). */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.netlify', 'functions', '.claude']);

/* Recursively collect every *.html file under `dir`, returning paths relative
   to the project root with forward slashes (e.g. "faq/index.html"). Runs at
   any depth so pages that live in subfolders (free-bible-lessons/<slug>/,
   faq/) get the same baked-in SEO as the top-level pages. */
function listHtmlFiles(dir, base) {
  base = base || '';
  let out = [];
  for (const entry of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out = out.concat(listHtmlFiles(dir, rel));
    } else if (entry.name.endsWith('.html') && !entry.name.startsWith('admin')) {
      out.push(rel);
    }
  }
  return out;
}

/* Clean, extensionless URL path for a page file: "index.html" -> "",
   "faq/index.html" -> "faq/", "blog.html" -> "blog.html". */
function urlPathFor(f) {
  if (f === 'index.html') return '';
  if (f.endsWith('/index.html')) return f.slice(0, -'index.html'.length);
  return f;
}

/* ---- Firestore REST value decoding ---- */
function dec(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}
function decFields(f) { const o = {}; for (const k in f) o[k] = dec(f[k]); return o; }

async function getDoc(p) {
  const r = await fetch(`${REST}/${p}?key=${API_KEY}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.fields ? decFields(j.fields) : null;
}
async function getCol(name) {
  const r = await fetch(`${REST}/${name}?pageSize=300&key=${API_KEY}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.documents || []).map(d => {
    const o = decFields(d.fields || {});
    o.id = d.name.split('/').pop();
    return o;
  });
}

/* A plain list request (getCol) on `posts`/`products` is denied outright —
   their Firestore rules gate reads on resource.data (published/active), and
   Firestore refuses to filter a list query server-side unless the query
   itself already constrains that same field. Without this, this function
   silently returned [] on every build (via the .catch(() => []) call sites),
   so no free lesson, blog post, or curriculum pack ever made it into
   sitemap.xml. Run a structured query with an explicit `where` matching the
   rule instead, so Firestore can prove every result is allowed. */
async function getColWhere(name, field, value) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: name }],
      where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { booleanValue: value } } },
      limit: 300
    }
  };
  const r = await fetch(`${REST}:runQuery?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) return [];
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : [])
    .filter(row => row.document)
    .map(row => {
      const o = decFields(row.document.fields || {});
      o.id = row.document.name.split('/').pop();
      return o;
    });
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => String(s == null ? '' : s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Pages that manage their own per-record title/description/canonical/OG/Twitter
// tags via JS (e.g. blog-post.html renders per-post values via #metaOgTitle etc).
// For those, injecting the generic site-wide versions of the same tags would
// create duplicate <meta property="og:title"> / <link rel="canonical"> tags —
// invalid HTML, and an ambiguous signal for crawlers and social scrapers.
function isSelfManagedSeo(html) {
  return /id=["']metaOgTitle["']/.test(html);
}

function managedBlock(cfg, page, canonical, selfManaged, pageTitleFallback, pageDescFallback) {
  const title = (page && page.seoTitle) || '';
  // Prefer this page's own hand-written <title>/description over the
  // generic site-wide defaults, so every page's social card is actually
  // about that page instead of all pages showing the same homepage blurb.
  const desc = (page && page.seoDescription) || pageDescFallback || cfg.defaultMetaDescription || '';
  const og = (page && page.ogImageUrl) || cfg.defaultOgImageUrl || '';
  const L = [START];
  if (cfg.faviconUrl) L.push(`<link rel="icon" href="${esc(cfg.faviconUrl)}">`);
  if (cfg.appleTouchIconUrl) L.push(`<link rel="apple-touch-icon" href="${esc(cfg.appleTouchIconUrl)}">`);
  if (!selfManaged) L.push(`<link rel="canonical" href="${esc(canonical)}">`);
  if (page && page.noindex) L.push(`<meta name="robots" content="noindex, nofollow">`);
  if (cfg.gscVerification) L.push(`<meta name="google-site-verification" content="${esc(cfg.gscVerification)}">`);
  if (!selfManaged) {
    const ogTitle = title || pageTitleFallback || cfg.siteName || '';
    if (ogTitle) L.push(`<meta property="og:title" content="${esc(ogTitle)}">`);
    L.push(`<meta property="og:type" content="website">`);
    L.push(`<meta property="og:url" content="${esc(canonical)}">`);
    if (desc) L.push(`<meta property="og:description" content="${esc(desc)}">`);
    if (og) L.push(`<meta property="og:image" content="${esc(og)}">`);
  }
  if (cfg.siteName) L.push(`<meta property="og:site_name" content="${esc(cfg.siteName)}">`);
  if (!selfManaged) {
    L.push(`<meta name="twitter:card" content="${og ? 'summary_large_image' : 'summary'}">`);
    if (desc) L.push(`<meta name="twitter:description" content="${esc(desc)}">`);
    if (og) L.push(`<meta name="twitter:image" content="${esc(og)}">`);
  }
  if (cfg.twitterHandle) L.push(`<meta name="twitter:site" content="${esc(cfg.twitterHandle)}">`);
  // GA4/Meta Pixel are gated behind cookie consent (see site-settings.js's
  // applyConsent/applyGA4/applyMetaPixel, which handle the banner and the
  // not-yet-decided case). This baked copy only fires early when consent
  // was already granted on a prior visit, as a faster-than-site-settings.js
  // head start; it sets the same window.__gkGA4/__gkPixel flags so
  // site-settings.js doesn't load either one a second time.
  if (cfg.ga4MeasurementId) {
    const id = cfg.ga4MeasurementId;
    L.push(`<script>try{if(localStorage.getItem('gk_consent_v1')==='granted'){window.__gkGA4=true;var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}';document.head.appendChild(s);window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());window.gtag('config','${id}');}}catch(e){}</script>`);
  }
  if (cfg.metaPixelId) {
    const pid = cfg.metaPixelId;
    L.push(`<script>try{if(localStorage.getItem('gk_consent_v1')==='granted'){window.__gkPixel=true;!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');window.fbq('init','${pid}');window.fbq('track','PageView');}}catch(e){}</script>`);
  }
  const org = cfg.organization || {};
  if (org.name || cfg.siteName) {
    const ld = { '@context': 'https://schema.org', '@type': 'Organization', name: org.name || cfg.siteName, url: org.url || SITE_ORIGIN };
    if (org.logoUrl) ld.logo = org.logoUrl;
    const same = (org.sameAs || []).filter(Boolean);
    if (same.length) ld.sameAs = same;
    if (cfg.contactEmail) ld.email = cfg.contactEmail;
    if (cfg.contactPhone) ld.telephone = cfg.contactPhone;
    L.push(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  }
  L.push(END);
  return L.join('\n  ');
}

function replaceBetween(html, startMark, endMark, inner) {
  const s = startMark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const e = endMark.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(s + '[\\s\\S]*?' + e);
  const block = `${startMark}\n${inner}\n${endMark}`;
  if (re.test(html)) return html.replace(re, block);
  return html;
}

function applyContent(html, values) {
  // <tag data-gk-edit="key">…</tag>  and  data-gk-edit-src="key"
  Object.entries(values || {}).forEach(([key, val]) => {
    if (val == null || val === '' || key === 'updatedAt') return;
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(
      new RegExp(`(<([a-zA-Z0-9]+)([^>]*\\sdata-gk-edit="${k}"[^>]*)>)([\\s\\S]*?)(</\\2>)`),
      (m, open, tag, attrs, _body, close) => `${open}${val}${close}`
    );
    html = html.replace(
      new RegExp(`(<[^>]*\\sdata-gk-edit-src="${k}"[^>]*\\ssrc=")[^"]*(")`),
      `$1${String(val).replace(/"/g, '&quot;')}$2`
    );
  });
  return html;
}

function applyCodeInjection(html, cfg) {
  if (cfg.headCode) {
    if (html.includes('<!-- gk:head-code -->')) {
      html = replaceBetween(html, '<!-- gk:head-code -->', '<!-- /gk:head-code -->', cfg.headCode);
    } else {
      html = html.replace(/<\/head>/i, `  <!-- gk:head-code -->\n${cfg.headCode}\n  <!-- /gk:head-code -->\n</head>`);
    }
  }
  if (cfg.bodyEndCode) {
    if (html.includes('<!-- gk:body-code -->')) {
      html = replaceBetween(html, '<!-- gk:body-code -->', '<!-- /gk:body-code -->', cfg.bodyEndCode);
    } else {
      html = html.replace(/<\/body>/i, `  <!-- gk:body-code -->\n${cfg.bodyEndCode}\n  <!-- /gk:body-code -->\n</body>`);
    }
  }
  return html;
}

function applyToHtml(html, cfg, page, canonical) {
  const selfManaged = isSelfManagedSeo(html);
  // per-page title / description overrides, in place — skipped for pages that
  // render their own <title>/description per-record via JS (see isSelfManagedSeo).
  if (!selfManaged && page && page.seoTitle) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(page.seoTitle)}</title>`);
  }
  if (!selfManaged && page && page.seoDescription) {
    if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${esc(page.seoDescription)}">`);
    } else {
      html = html.replace(/<\/title>/i, `</title>\n  <meta name="description" content="${esc(page.seoDescription)}">`);
    }
  }
  // Fall back to this page's own hand-written <title>/description (read after
  // any admin override above) rather than the generic site-wide defaults.
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const pageTitleFallback = titleMatch ? unesc(titleMatch[1]).trim() : '';
  const descMatch = html.match(/<meta\s+name=["']description["'][^>]*\scontent=(["'])([\s\S]*?)\1[^>]*>/i);
  const pageDescFallback = descMatch ? unesc(descMatch[2]).trim() : '';

  // managedBlock() below adds its own canonical tag for pages that aren't
  // self-managed. A hand-written <link rel="canonical"> left elsewhere in
  // <head> (e.g. added by hand before this page had a managed block) would
  // then duplicate it — invalid HTML and an ambiguous signal for crawlers —
  // so strip any such tag outside the managed block first.
  if (!selfManaged) {
    const blockStart = html.indexOf(START);
    const headEnd = blockStart === -1 ? html.search(/<\/head>/i) : blockStart;
    if (headEnd !== -1) {
      html = html.slice(0, headEnd).replace(/[ \t]*<link rel="canonical"[^>]*>\n?/gi, '') + html.slice(headEnd);
    }
  }

  const block = managedBlock(cfg, page, canonical, selfManaged, pageTitleFallback, pageDescFallback);
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(html)) html = html.replace(re, block);
  else html = html.replace(/<\/head>/i, `  ${block}\n</head>`);

  html = applyCodeInjection(html, cfg);
  return html;
}

const CONTENT_PAGE_IDS = {
  'index.html': 'home',
  'glory-kids-curriculum.html': 'curriculum'
};

/* ---- helpers for baking per-record meta into a self-managed template ---- */
// Order-independent: finds the tag by id regardless of where id sits among
// its attributes, then sets `attr` within just that tag (also regardless of
// position) — a fixed "id first, then attr" order silently fails to match
// (and so silently no-ops) on a tag like <a href="…" class="…" id="…">.
function setAttrById(html, id, attr, value) {
  const tagRe = new RegExp(`<[a-zA-Z0-9]+\\b[^>]*\\bid="${id}"[^>]*>`);
  return html.replace(tagRe, tag => {
    const attrRe = new RegExp(`(\\b${attr}=")[^"]*(")`);
    if (attrRe.test(tag)) return tag.replace(attrRe, (m, pre, post) => pre + esc(value) + post);
    return tag.replace(/^<([a-zA-Z0-9]+)/, (m, t) => `<${t} ${attr}="${esc(value)}"`);
  });
}
// id="..." may appear anywhere in the opening tag (most of these elements
// have class/style before id, not after) — \b...\bid= rather than a fixed
// "<tag id=" position, or this silently fails to match and leaves the
// element empty, exactly the bug this exists to fix.
function setTextById(html, id, tag, text) {
  const re = new RegExp(`(<${tag}\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</${tag}>)`);
  return html.replace(re, (m, open, close) => open + esc(text) + close);
}
// Same as setTextById, but for fields that are themselves markup (post body,
// badge/image fragments) — inserted raw, not HTML-escaped.
function setHtmlById(html, id, tag, innerHtml) {
  const re = new RegExp(`(<${tag}\\b[^>]*\\bid="${id}"[^>]*>)[\\s\\S]*?(</${tag}>)`);
  return html.replace(re, (m, open, close) => open + (innerHtml || '') + close);
}
// Forces an element's inline style to a given display value, regardless of
// whatever display:none/display:block it currently has (or lacks).
function setDisplayById(html, id, value) {
  const withStyle = new RegExp(`(<[^>]*\\bid="${id}"[^>]*\\bstyle=")[^"]*(")`);
  if (withStyle.test(html)) {
    return html.replace(withStyle, (m, pre, post) => `${pre}display:${value};${post}`);
  }
  const noStyle = new RegExp(`(<[^>]*\\bid="${id}")([^>]*>)`);
  return html.replace(noStyle, (m, pre, rest) => `${pre} style="display:${value};"${rest}`);
}
function estimateReadTime(bodyHtml) {
  const words = stripHtml(bodyHtml).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
function stripHtml(html) { return String(html || '').replace(/<[^>]+>/g, ' ').trim(); }

const BLOG_CATEGORIES = ['parents', 'pastors', 'kidmin'];
const CATEGORY_LABELS = { parents: 'For Parents', pastors: 'For Pastors', kidmin: 'For Kidmin Leaders', free_lessons: 'Free Bible Lesson' };

// Matches blog-post.html's canonicalPathFor(): free lessons get their own
// section, everything else is grouped under /blog/<category>/.
function postPath(p) {
  if (p.category === 'free_lessons') return `/free-bible-lessons/${p.slug}`;
  const cat = BLOG_CATEGORIES.includes(p.category) ? p.category : 'parents';
  return `/blog/${cat}/${p.slug}`;
}

// The *public* URL for a generated detail page — these are physically
// `<path>/index.html` files, and Netlify serves a directory's index at the
// trailing-slash form, 301ing the bare path to it. A canonical/OG/sitemap
// URL without the slash would itself redirect, undermining the very fix
// this file exists to make — so every public-facing URL gets the slash;
// postPath()/the pack slug stay bare for internal path building.
function postUrl(p) { return SITE_ORIGIN + postPath(p) + '/'; }
function packUrl(prod) { return SITE_ORIGIN + '/pack/' + encodeURIComponent(prod.slug) + '/'; }

/* Google Merchant Center product feed (RSS 2.0 + g: namespace) for the
   curriculum packs/bundles in the `products` collection. These are
   digital downloads, not shipped goods — g:shipping is declared at
   $0 (instant delivery, no physical shipment) rather than omitted,
   since Merchant Center requires an explicit shipping declaration.
   No GTIN/MPN exists for these (self-published digital curriculum),
   so g:identifier_exists is "no" per Google's rules for that case —
   brand + product_type substitute for a manufacturer identifier.
   Submit this file's URL directly in Merchant Center > Products >
   Feeds > add a "Scheduled fetch" pointing at /shopping-feed.xml. */
function buildShoppingFeed(products) {
  const items = products.filter(p => p.active && p.slug).map(p => {
    const price = Number(p.priceUSD != null ? p.priceUSD : p.priceZAR || 0);
    const desc = p.blurb || `Complete children's ministry resource — ${p.title}. Instant download, ready to teach.`;
    const images = (p.images && p.images.length) ? p.images : [SITE_ORIGIN + '/images/glory-kids-logo.png'];
    const productType = p.category === 'curriculum' ? 'Curriculum Packs' : (p.category === 'bundle' ? 'Bundles' : 'Shop');
    return '  <item>\n' +
      `    <g:id>${esc(p.slug)}</g:id>\n` +
      `    <title>${esc(p.title)}</title>\n` +
      `    <description>${esc(desc)}</description>\n` +
      `    <link>${esc(packUrl(p))}</link>\n` +
      `    <g:image_link>${esc(images[0])}</g:image_link>\n` +
      images.slice(1, 11).map(img => `    <g:additional_image_link>${esc(img)}</g:additional_image_link>`).join('\n') +
      (images.length > 1 ? '\n' : '') +
      `    <g:condition>new</g:condition>\n` +
      `    <g:availability>in_stock</g:availability>\n` +
      `    <g:price>${price.toFixed(2)} USD</g:price>\n` +
      `    <g:brand>Glory Kids Ministries</g:brand>\n` +
      `    <g:product_type>${esc(productType)}</g:product_type>\n` +
      `    <g:google_product_category>Media &gt; Books</g:google_product_category>\n` +
      `    <g:identifier_exists>no</g:identifier_exists>\n` +
      `    <g:shipping>\n      <g:country>US</g:country>\n      <g:service>Instant Digital Delivery</g:service>\n      <g:price>0.00 USD</g:price>\n    </g:shipping>\n` +
      '  </item>';
  });
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n' +
    '<channel>\n' +
    `  <title>Glory Kids Ministries — Curriculum Packs</title>\n` +
    `  <link>${SITE_ORIGIN}/curriculum-packs.html</link>\n` +
    `  <description>Downloadable children's ministry curriculum and Bible lesson packs.</description>\n` +
    items.join('\n') + '\n' +
    '</channel>\n</rss>\n';
}

/* Bakes this post's real title/description/canonical/OG/Twitter/JSON-LD, AND
   the actual visible article (H1, author/date, badges, featured image, body)
   into a copy of the (already SEO-baked) blog-post.html template, mirroring
   renderPost() in that file exactly. The body used to be filled in only by
   client-side JS after an async Firestore fetch, so a crawler reading the
   raw HTML saw an empty #postContent and an empty <h1> — "Loading article…"
   with no indexable text (GSC: "Crawled - currently not indexed"; also the
   cause of an empty canonical letting Google pick its own, across these
   near-identical URLs — "Duplicate, Google chose different canonical" /
   "Duplicate without user-selected canonical"). The client's loadPost() still
   runs on visit and re-renders the same markup — this only changes what a
   non-JS fetch (or a crawler that times out before hydration) sees. */
function bakePostPage(template, post) {
  const url = postUrl(post);
  const seoTitle = (post.seoTitle || post.title) + ' | Glory Kids Ministries';
  const desc = post.seoDescription || post.excerpt || '';
  const image = post.featuredImage || '';

  let html = template;
  html = setTextById(html, 'metaTitleTag', 'title', seoTitle);
  html = setAttrById(html, 'metaDescriptionTag', 'content', desc);
  html = setAttrById(html, 'metaKeywordsTag', 'content', post.seoKeywords || '');
  html = setAttrById(html, 'metaCanonicalTag', 'href', url);
  html = setAttrById(html, 'metaOgTitle', 'content', post.title);
  html = setAttrById(html, 'metaOgDescription', 'content', desc);
  html = setAttrById(html, 'metaOgImage', 'content', image);
  html = setAttrById(html, 'metaOgUrl', 'content', url);
  html = setAttrById(html, 'metaTwitterCard', 'content', image ? 'summary_large_image' : 'summary');
  html = setAttrById(html, 'metaTwitterTitle', 'content', post.title);
  html = setAttrById(html, 'metaTwitterDescription', 'content', desc);
  html = setAttrById(html, 'metaTwitterImage', 'content', image);

  // ---- the visible article itself (mirrors renderPost()'s DOM writes) ----
  const dateStr = new Date(post.publishAt || post.createdAt || Date.now())
    .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const isFreeLesson = post.category === 'free_lessons';
  const sectionLabel = isFreeLesson ? 'Free Lessons' : (CATEGORY_LABELS[post.category] || 'Blog');
  const sectionHref = isFreeLesson ? '/free-bible-lessons.html' : ('/blog.html#' + (BLOG_CATEGORIES.includes(post.category) ? post.category : 'parents'));
  const badgesHtml = [`<span class="post-cat-badge">${esc(CATEGORY_LABELS[post.category] || post.category || '')}</span>`]
    .concat((post.tags || []).slice(0, 3).map(t => `<span class="post-cat-badge post-cat-badge--secondary">${esc(t)}</span>`))
    .join('');
  const featuredImageHtml = image
    ? `<img src="${esc(image)}" alt="${esc(post.title)}" class="w-full h-full object-cover" decoding="async" fetchpriority="high" />`
    : esc(post.icon || '📖');

  html = setTextById(html, 'postBreadcrumbTitle', 'span', post.title);
  html = setAttrById(html, 'postSectionLink', 'href', sectionHref);
  html = setTextById(html, 'postSectionLink', 'a', sectionLabel);
  html = setTextById(html, 'postTitle', 'h1', post.title);
  html = setTextById(html, 'postAuthor', 'strong', post.author || 'Jandré van der Walt');
  html = setTextById(html, 'postAuthorInitials', 'span', (post.author || 'Glory Kids').trim().split(/\s+/).map(p => p[0]).join('').toUpperCase().slice(0, 2));
  html = setTextById(html, 'postDate', 'span', '📅 ' + dateStr);
  html = setTextById(html, 'postReadTime', 'span', '⏱ ' + estimateReadTime(post.bodyHtml) + ' min read');
  html = setHtmlById(html, 'postBadges', 'div', badgesHtml);
  html = setHtmlById(html, 'postFeaturedImage', 'div', featuredImageHtml);
  html = setHtmlById(html, 'postContent', 'div', post.bodyHtml || '');
  if (isFreeLesson && post.excerpt) {
    html = setTextById(html, 'postDescription', 'p', post.excerpt);
    html = setDisplayById(html, 'postDescription', 'block');
  }
  // Reveal the real article by default; loadPost() still re-renders the same
  // content on visit (needed for interactivity: TOC, gallery, unlock state).
  // The loading/not-found placeholder TEXT is cleared (not just hidden) on a
  // page that demonstrably exists — a crawler that reads raw HTML text
  // should never see "Loading article…" or "We couldn't find that post" for
  // a real, published post.
  html = setDisplayById(html, 'postLoading', 'none');
  html = setHtmlById(html, 'postLoading', 'div', '');
  html = setHtmlById(html, 'postNotFound', 'div', '');
  html = setDisplayById(html, 'postWrap', 'block');

  const dateP = post.publishAt || post.createdAt || Date.now();
  const dateM = post.updatedAt || post.createdAt || dateP;
  const blogPosting = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: desc, image,
    datePublished: new Date(dateP).toISOString(),
    dateModified: new Date(dateM).toISOString(),
    author: { '@type': 'Person', name: post.author || 'Jandré van der Walt', url: SITE_ORIGIN + '/contact.html' },
    publisher: { '@type': 'Organization', name: 'Glory Kids Ministries', logo: { '@type': 'ImageObject', url: SITE_ORIGIN + '/images/glory-kids-logo.png' } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    articleBody: stripHtml(post.bodyHtml).slice(0, 5000)
  };
  html = html.replace(/(<script id="ldBlogPosting"[^>]*>)[\s\S]*?(<\/script>)/, (m, open, close) => open + JSON.stringify(blogPosting) + close);

  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN + '/index.html' },
      post.category === 'free_lessons'
        ? { '@type': 'ListItem', position: 2, name: 'Free Lessons', item: SITE_ORIGIN + '/free-bible-lessons.html' }
        : { '@type': 'ListItem', position: 2, name: CATEGORY_LABELS[post.category] || 'Blog', item: SITE_ORIGIN + '/blog.html' },
      { '@type': 'ListItem', position: 3, name: post.title, item: url }
    ]
  };
  html = html.replace(/(<script id="ldBreadcrumb"[^>]*>)[\s\S]*?(<\/script>)/, (m, open, close) => open + JSON.stringify(breadcrumb) + close);

  return html;
}

/* Firestore's ageRange field on a few products still says "3-12"/"3–12" —
   the sitewide decision is 3-13 (Preschool/Elementary/Preteen), except the
   preschool pack which is genuinely scoped to ages 3-5. This is a display-
   time fix only (no Firestore write path from build.js); the stored field
   itself should still be corrected in admin for full consistency. */
function normalizeAgeRange(raw, fallback) {
  const s = (raw || '').trim();
  if (/3[–-]12/.test(s)) return s.replace(/3[–-]12/, '3-13');
  if (s) return s;
  return fallback || 'Ages 3-13';
}

function findBySlug(rows, slug) { return (rows || []).find(r => r.slug === slug); }
function lessonLink(post) { return post ? { title: post.title, href: postUrl(post) } : null; }
function packLink(prod) { return prod ? { title: prod.title, href: packUrl(prod) } : null; }

/* Side channel for bakePackPage(): writeDetailPages() writes bake()'s
   return value directly to disk, so bakePackPage must keep returning a
   plain HTML string (matching bakePostPage's contract) - this is where it
   also records word counts for the fail-safe check and duplicate-content
   check below, keyed by slug, without changing that return type. */
const PACK_LANDING_STATS = {};

/* PHASE 5 hand-authored copy for the 9 real shop packs — the facts (price,
   weeks, features, files) all come from Firestore; this is only the
   marketing layer built on top of those facts; nothing here invents a
   price, lesson count or feature the product doesn't actually have. */
const PACK_COPY = {
  '6-week-encounter-series': {
    h1: '6-Week Encounter Series: Holy Spirit Curriculum for Kids Church',
    cardTitle: '6-Week Encounter Series — Holy Spirit Curriculum',
    cardBlurb: 'A Holy Spirit curriculum for kids church — 6 weeks of worship, activations and crafts.',
    metaTitle: '6 Week Kids Church Curriculum | Encounter Series',
    metaDesc: 'A 6-week Holy Spirit curriculum for kids church: worship, activations, crafts and parent take-home pages. Weeks 1-4 ready now.',
    desc: [
      "The 6-Week Encounter Series is a kids encounter series built around one goal: helping children ages 3-13 recognize God's voice and encounter Jesus for themselves, not just hear about Him secondhand. Each week pairs a Holy Spirit activation with games, crafts and a parent take-home page, so what happens in kids church keeps going at home.",
      "This is a Holy Spirit curriculum for kids in the fullest sense — every week is built around giving children a real, guided encounter, not just a Bible story with an activity bolted on. Leaders get everything scripted: teaching notes, age adaptations, and activities that work whether you're running a 30-minute kids church slot or a longer midweek program."
    ],
    gapNote: "Weeks 1-4 are available for instant download now. Weeks 5-6 are being finished and will be added to the same download — no repurchase needed once they're ready.",
    howTo: [
      'Download all 4 available weekly guides right after purchase (weeks 5-6 arrive in the same download once finished).',
      'Read through one week at a time — each guide includes teaching notes, so about 15-20 minutes of prep covers a full session.',
      'Works for a group of 5 or 50: the games and activations scale to your room size and volunteer count.',
      'Use it in kids church, a midweek program, or a homeschool co-op — nothing here assumes a Sunday-only schedule.',
      'Send the parent take-home page home each week so families can keep the conversation going.',
      "Mix and match ages: the included age adaptations flex each week's Holy Spirit activation for preschool through preteen."
    ],
    faqExtra: [
      ['Are all 6 weeks included right now?', "Weeks 1-4 are ready to download the moment you purchase. Weeks 5-6 are still being finished and will be added to the same product — your original download link will include them automatically, at no extra cost."],
    ],
    freePreview: 'pentecost-bible-lesson-for-kids-holy-spirit-activity-crafts',
    relatedPacks: ['armor-of-god-kids-bible-curriculum', 'heroes-of-faith-8-week-kids-church-bible-curriculum', 'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids'],
    relatedLessons: ['the-lords-prayer-learning-how-to-pray-kids-bible-lesson', 'jesus-calms-the-storm-teaching-kids-gods-peace-kids-bible-lesson']
  },

  'armor-of-god-kids-bible-curriculum': {
    h1: 'Armor of God Kids Curriculum: 6 Sunday School Lessons on Ephesians 6',
    cardTitle: 'Armor of God Kids Curriculum',
    cardBlurb: 'Armor of God Sunday school lessons — 6 lessons on truth, faith and standing strong in Jesus.',
    metaTitle: 'Armor of God Kids Curriculum | 6 Lessons',
    metaDesc: 'Armor of God kids curriculum: 6 ready-to-teach Sunday school lessons on Ephesians 6, with games, crafts and instant digital download.',
    desc: [
      "This armor of god kids curriculum walks children through Ephesians 6 one piece of armor at a time — truth, righteousness, peace, faith, salvation and the Word of God — across 6 complete, ready-to-teach lessons. Each one pairs straightforward teaching with hands-on games and a craft, so kids don't just hear about spiritual armor, they act it out and take something home that reminds them of it.",
      "These armor of god Sunday school lessons were written so a volunteer with little prep time can still teach with confidence: the teaching script, game and craft for each lesson are already laid out, and the whole 6-lesson set downloads as one ZIP file right after purchase."
    ],
    howTo: [
      'Download the ZIP (253 MB) right after checkout — it contains all 6 lessons.',
      'Teach one piece of armor per session; each lesson stands on its own, so you can spread them across 6 weeks or run them back to back.',
      'Budget about 20-30 minutes of prep per lesson — the teaching script and craft instructions are already written out.',
      'Works for a Sunday school class, a midweek kids program, or a homeschool unit on Ephesians.',
      'Adapt the craft and game pacing for your room — the lessons are written broadly enough to flex from preschool helpers up to preteens.'
    ],
    freePreview: 'armor-of-god-teaching-kids-spiritual-strength-kids-bible-lesson',
    relatedPacks: ['heroes-of-faith-8-week-kids-church-bible-curriculum', '6-week-encounter-series', 'miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities'],
    relatedLessons: ['david-goliath-teaching-kids-courage-and-faith-kids-bible-lesson', 'daniel-in-the-lions-den-teaching-kids-gods-protection-kids-bible-lesson']
  },

  'preschool-bible-curriculum-15-complete-lessons-ages-3-5': {
    h1: 'Preschool Bible Curriculum: 15 Sunday School Lessons for Ages 3-5',
    cardTitle: 'Preschool Bible Curriculum (Ages 3-5)',
    cardBlurb: 'Preschool Sunday school lessons, ages 3-5 — 15 complete, ready-to-print lessons.',
    metaTitle: 'Preschool Bible Curriculum Ages 3-5 | 15 Lessons',
    metaDesc: 'Preschool Bible curriculum for ages 3-5: 15 complete, ready-to-teach Sunday school lessons with crafts, songs and a coloring page for each one.',
    desc: [
      "This preschool Bible curriculum was written specifically for ages 3-5, not scaled down from an older-kids lesson. All 15 complete lessons follow the same simple structure — Bible story, key verse, discussion questions, a hands-on activity with its own supplies list, memory verse practice with movement and songs, and a matching coloring page — so a busy Sunday school teacher, homeschool parent or VBS leader can open the PDF and teach, not plan.",
      "The 15 preschool Sunday school lessons move through Creation, Noah, Abraham, Moses, David and Goliath, Jonah, and the birth, miracles, cross and resurrection of Jesus — a real arc through the Bible's major stories, scaled to a 3-5 year old's attention span. A blank lesson template is also included so a leader can keep writing new lessons in the same format once they've worked through all 15."
    ],
    howTo: [
      'Download the single PDF (100+ pages) right after checkout — all 15 lessons and the coloring pages are inside it.',
      'Print each lesson and its supplies list ahead of time; most activities use things already in a typical classroom or kitchen drawer.',
      'Teach one lesson per week for a straightforward 15-week run, or pick whichever Bible story fits your current series.',
      "Keep sessions short and moving — each lesson is built around a preschooler's attention span, not a full-length children's church slot.",
      'Send the coloring page home after each lesson as a simple, low-effort take-home reminder.',
      'Use the blank lesson template at the back once you need lesson 16 and beyond, in the same format as the first 15.'
    ],
    freePreview: 'creation-bible-lesson-for-kids-god-made-everything',
    relatedPacks: ['6-week-encounter-series', 'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids', 'miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities'],
    relatedLessons: ['noahs-ark-trusting-gods-plan-kids-bible-lesson', 'david-goliath-teaching-kids-courage-and-faith-kids-bible-lesson']
  },

  'heroes-of-faith-8-week-kids-church-bible-curriculum': {
    h1: 'Heroes of Faith: 8-Week Kids Church Bible Curriculum on Courage & Faith',
    cardTitle: 'Heroes of Faith — 8-Week Kids Church Curriculum',
    cardBlurb: 'Heroes of faith Bible lessons for kids — 8 weeks on courage, trust and unshakable faith.',
    metaTitle: 'Heroes of Faith Kids Curriculum | 8-Week Series',
    metaDesc: 'Heroes of faith kids curriculum: 8 complete lessons on Old Testament heroes, with 24 crafts, parent take-homes and Preschool-Preteen versions.',
    desc: [
      "Heroes of Faith is an 8-week journey through eight heroes of the Old Testament, built to help kids build courage, trust and unshakable faith by watching how real people in Scripture trusted God under real pressure. Each of the 8 complete lessons comes with its own teaching, games and activities, plus 24 hands-on crafts across the series — three per lesson on average — so the Bible story turns into something kids make with their hands, not just hear.",
      "This heroes of faith kids curriculum ships with Preschool, Elementary and Preteen versions of the material, so one purchase covers a kids church program spanning multiple age groups, plus a parent take-home sheet for every week so the story keeps being talked about after kids leave the room."
    ],
    howTo: [
      'Download the ZIP (46 MB) after checkout — it contains all 8 weeks plus the Preschool, Elementary and Preteen versions.',
      'Pick the age version that matches your room, or run two age tracks side by side from the same download.',
      'Plan on 2-3 crafts per week — supplies lists are included so you can shop once for the whole series.',
      'Teach the 8 heroes in order for one connected discipleship arc, or pull a single week to match a sermon series.',
      'Send the parent take-home sheet home each week to extend the lesson into family conversation.'
    ],
    freePreview: 'david-goliath-teaching-kids-courage-and-faith-kids-bible-lesson',
    relatedPacks: ['armor-of-god-kids-bible-curriculum', '6-week-encounter-series', 'miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities'],
    relatedLessons: ['daniel-in-the-lions-den-teaching-kids-gods-protection-kids-bible-lesson', 'jonah-and-the-whale-teaching-kids-obedience-and-gods-mercy-kids-bible-lesson']
  },

  'miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities': {
    h1: 'Miracles of Jesus: 4-Week Kids Curriculum on Jesus’s Miracles',
    cardTitle: 'Miracles of Jesus — 4-Week Curriculum',
    cardBlurb: 'Jesus miracles Sunday school lessons — 4 weeks of object lessons, crafts and worship.',
    metaTitle: 'Miracles of Jesus Kids Curriculum | 4-Week Series',
    metaDesc: "Miracles of Jesus kids curriculum: 4 weekly Bible stories on Jesus's miracles, with object lessons, crafts, a worship album and parent handouts.",
    desc: [
      "This miracles of Jesus kids curriculum walks children ages 3-13 through 4 weekly Bible stories centered on Jesus's miracles, each paired with an object lesson and a hands-on activity so the miracle isn't just retold, it's felt. A included worship album reinforces the week's theme in song, and Holy Spirit activation exercises give kids a moment to respond, not just listen.",
      "These Jesus miracles Sunday school lessons were designed by children's ministry curriculum specialists for Sunday school, children's church, homeschool Bible study or a weekday program, with a leader's guide (discussion questions and teaching tips) and a parent handout for every week so the miracle gets talked about again at home."
    ],
    howTo: [
      'Download all 4 weekly PDFs (72+ pages total) right after checkout.',
      "Teach the miracles in order for a connected 4-week series, or pull a single week to match a sermon on Jesus's power.",
      "Pair each week's object lesson with the worship album track — both are built around the same theme.",
      'Use the leader\'s guide discussion questions to adapt the depth of conversation for preschool through preteen.',
      'Send the parent handout home each week to extend the conversation past Sunday.'
    ],
    freePreview: 'jesus-feeds-the-5000-a-miracle-of-gods-provision-kids-bible-lesson',
    relatedPacks: ['heroes-of-faith-8-week-kids-church-bible-curriculum', 'armor-of-god-kids-bible-curriculum', '6-week-encounter-series'],
    relatedLessons: ['jesus-calms-the-storm-teaching-kids-gods-peace-kids-bible-lesson', 'resurrection-jesus-is-alive-kids-bible-lesson']
  },

  '100-page-coloring-book-journey-through-the-bible': {
    h1: 'Bible Coloring Book for Kids: 100+ Page Journey Through the Bible',
    cardTitle: 'Bible Coloring Book — Journey Through the Bible',
    cardBlurb: 'A Bible coloring book for kids — 100+ pages covering the Bible’s major stories.',
    metaTitle: 'Bible Coloring Book for Kids | 100+ Pages',
    metaDesc: "A journey through the Bible coloring pages collection: 100+ Bible-based coloring pages for church, home or classroom, instant digital download, $5.",
    desc: [
      "This Bible coloring book for kids is a 100+ page collection of Bible-based coloring pages, built to reinforce key Bible stories while kids are simply coloring — no lesson prep required. It's suitable for all ages, from a toddler scribbling with a crayon to a preteen who still likes a good coloring page during a sermon.",
      "Journey through the Bible coloring pages like this one are a low-cost, zero-prep way to keep kids engaged during a service, send something home after a lesson, or round out a classroom's craft supplies — at $5, it's an easy add-on to any children's ministry budget."
    ],
    howTo: [
      'Download the PDF instantly after checkout — 100+ pages are included in one file.',
      'Print pages as needed rather than all at once; the PDF stays on your device for repeat printing.',
      'Hand pages out during service, Sunday school, or as a quiet-time activity at home.',
      'Pair a page with whichever Bible story it depicts to reinforce a lesson you just taught.',
      'Keep a few printed pages and crayons in a bag for car rides, waiting rooms, or any moment that calls for something quiet.',
      'Suitable for any age — no reading level or classroom setup required.'
    ],
    faqOverrides: { ageQ: 'What age range is this coloring book for?', ageA: 'All ages — it’s suitable for toddlers through preteens, with no reading or writing required.' },
    freePreview: 'noahs-ark-trusting-gods-plan-kids-bible-lesson',
    relatedPacks: ['complete-easter-bundle-for-kids', 'the-story-of-easter-4-week-series', 'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids'],
    relatedLessons: ['creation-bible-lesson-for-kids-god-made-everything', 'david-goliath-teaching-kids-courage-and-faith-kids-bible-lesson']
  },

  'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids': {
    h1: 'Thanksgiving Bible Lessons for Kids: Generous Hearts 4-Week Curriculum',
    cardTitle: 'Generous Hearts — Thanksgiving Curriculum',
    cardBlurb: 'Thanksgiving Bible lessons for kids — 4 weeks building a generosity and gratitude kids curriculum.',
    metaTitle: 'Thanksgiving Bible Lessons for Kids | 4-Week Curriculum',
    metaDesc: 'Generous Hearts: 4 Thanksgiving Bible lessons for kids with 12 crafts, 12 games, worship and parent handouts on gratitude and generosity.',
    desc: [
      "Generous Hearts is a complete 4-week Thanksgiving Bible curriculum for kids ages 3-13, built around one idea: gratitude isn't just saying thank you, it's a way of life kids can learn. Across 4 Bible lessons, 12 hands-on crafts and 12 interactive games (three of each per week), children explore God's kindness, provision and transforming love through four real Bible stories.",
      "This generosity and gratitude kids curriculum gives Sunday school and children's church leaders object lessons, worship resources, discussion questions and a parent handout for every week, so Thanksgiving becomes a four-week discipleship series instead of a single one-off lesson."
    ],
    included: [
      { title: 'Week 1: A Place at the Table', story: 'David and Mephibosheth (2 Samuel 9)', idea: "Discover the extraordinary kindness of King David as he welcomes Mephibosheth to his table — God's kindness invites us into belonging." },
      { title: 'Week 2: Trusting God With What I Have', story: 'Elijah and the Widow (1 Kings 17:8-16)', idea: "Through Elijah and the widow, kids learn to trust God even when they feel they don't have enough." },
      { title: 'Week 3: Gratitude Remembers and Returns to Jesus', story: 'The Ten Men with Leprosy (Luke 17:11-19)', idea: 'Ten men were healed, but only one returned to thank Jesus — true gratitude remembers the One who gave the blessing.' },
      { title: 'Week 4: Jesus Came to Me. He Is Changing My Heart.', story: 'Jesus and Zacchaeus (Luke 19:1-10)', idea: 'When Jesus encountered Zacchaeus, everything changed — genuine encounters with Jesus inspire generosity and a new way of living.' }
    ],
    howTo: [
      'Download all 5 files (4 weekly PDFs plus a bonus craft image) right after checkout.',
      'Teach the 4 weeks in order through November for a complete Thanksgiving series, or any time gratitude fits your calendar.',
      'Budget 2-3 crafts and games per week — supplies lists are included for each.',
      "Use the object lessons and discussion questions to adapt depth for preschool through preteen in the same room.",
      'Send the parent handout home each week to keep the gratitude conversation going at the dinner table.'
    ],
    freePreview: 'thanks-giving-bible-lesson-on-gratitude-and-generosity-for-kids',
    relatedPacks: ['miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities', '6-week-encounter-series', 'preschool-bible-curriculum-15-complete-lessons-ages-3-5'],
    relatedLessons: ['celebrating-harvest-blessings-thankful-hearts-kids-bible-lesson-psalm-96', 'zacchaeus-jesus-welcomes-everyone-kids-bible-lesson-luke-19110']
  },

  'complete-easter-bundle-for-kids': {
    h1: 'Easter Sunday School Curriculum Bundle for Kids Ministry',
    cardTitle: 'Complete Easter Bundle for Kids',
    cardBlurb: 'An Easter Sunday school curriculum bundle — full curriculum, crafts and printables in one download.',
    metaTitle: 'Easter Curriculum Bundle for Kids Ministry',
    metaDesc: 'Easter lessons for kids, bundled: a complete 4-week Easter curriculum plus a Bible activity pack, crafts and coloring pages — one download, $40.',
    desc: [
      "This Easter Sunday school curriculum bundle brings together everything a kids ministry needs for the season in one download: a complete 4-week Easter curriculum plus a standalone Bible activity pack with worksheets, coloring pages and crafts. Rather than piecing together separate Easter resources from different places, a leader gets one coordinated bundle covering the full Easter story in a single purchase.",
      "These Easter lessons for kids work equally well in a church classroom or at home, and because it's a bundle rather than a single lesson, there's enough material here to run Holy Week programming, a one-off Easter Sunday class, or a multi-week lead-up to Resurrection Sunday from the same purchase. The standalone activity pack also travels well on its own — print it for a family gathering, a homeschool co-op, or a quiet Easter afternoon activity."
    ],
    howTo: [
      'Download all 5 PDFs right after checkout — the 4-week curriculum plus the standalone activity pack.',
      'Run the 4-week curriculum across the weeks leading up to Easter, or pull individual weeks for a shorter program.',
      'Use the standalone Bible Activity Pack on its own for a one-off Easter Sunday class or a VBS-style event.',
      'Print the coloring pages and crafts ahead of time — supplies for each are kept simple and classroom-friendly.',
      'Combine with a children’s church service for Palm Sunday through Resurrection Sunday, or compress into a single Holy Week session.'
    ],
    freePreview: 'resurrection-jesus-is-alive-kids-bible-lesson',
    relatedPacks: ['the-story-of-easter-4-week-series', 'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids', '100-page-coloring-book-journey-through-the-bible'],
    relatedLessons: ['jesus-is-born-god-with-us-christmas-bible-lesson-for-kids', 'the-good-shepherd-bible-lesson-on-jesus-love-for-kids']
  },

  'the-story-of-easter-4-week-series': {
    h1: 'The Story of Easter: 4-Week Bible Lessons for Kids',
    cardTitle: 'The Story of Easter — 4-Week Series',
    cardBlurb: 'Easter Bible lessons for kids, 4 week series — from Palm Sunday to the resurrection.',
    metaTitle: 'Story of Easter Kids Curriculum | 4-Week Series',
    metaDesc: 'Story of Easter kids curriculum: 4 complete lessons from Palm Sunday to the resurrection, with storytelling, games and crafts — teach any time of year.',
    desc: [
      "The Story of Easter is a 4-week series that walks kids from Palm Sunday through to the resurrection of Jesus, told as one connected story rather than four disconnected lessons. Each of the 4 complete lessons pairs engaging Bible storytelling with games, crafts and activities, built so a volunteer leader can teach with minimal prep and still cover the full arc of the Easter story in order.",
      "These Easter Bible lessons for kids aren't locked to the week before Easter Sunday — because it's a standalone 4-week story arc, a children's ministry can run it any time of year it fits the calendar, not only during Holy Week. A homeschool family or small group can work through it just as easily as a Sunday school class."
    ],
    howTo: [
      'Download all 4 weekly PDFs right after checkout.',
      'Teach the 4 weeks in order, Palm Sunday through the resurrection, as one connected story.',
      'Run it during Lent and Holy Week, or at any other point in the year the story fits your series calendar.',
      'Budget light prep time per lesson — the storytelling script and activities are already written out.',
      'Pair with a craft table or small-group discussion time to extend each week’s lesson.',
      'Close the series on the resurrection lesson even if you spread the other three weeks out differently, so the story still lands on its intended ending.'
    ],
    freePreview: 'resurrection-jesus-is-alive-kids-bible-lesson',
    relatedPacks: ['complete-easter-bundle-for-kids', 'generous-hearts-4-week-thanksgiving-bible-curriculum-for-kids', 'miracles-of-jesus-4-week-bible-curriculum-for-kids-ages-3-13-sunday-school-lessons-crafts-activities'],
    relatedLessons: ['jesus-is-born-god-with-us-christmas-bible-lesson-for-kids', 'the-good-shepherd-bible-lesson-on-jesus-love-for-kids']
  }
};

/* Builds the PHASE 5 landing-page content block (summary, description,
   what's included, how to use, free preview, FAQ, related) for one pack,
   from real product data plus the PACK_COPY marketing layer above. Returns
   both the HTML to insert and the plain text (for the word-count/duplicate
   checks) so neither has to re-derive the other. */
function buildPackLandingContent(prod, copy, allPosts, allProducts) {
  if (!copy) return { html: '', text: '' };
  const money = n => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
  const price = Number(prod.priceUSD != null ? prod.priceUSD : prod.priceZAR || 0);
  const ageRange = normalizeAgeRange(prod.ageRange);
  const weeksLabel = prod.weeks || null;

  const descHtml = copy.desc.map(p => `<p>${esc(p)}</p>`).join('');
  const gapHtml = copy.gapNote ? `<p class="pack-gap-note" style="background:#FFF7E6;border:1px solid #FFD98E;border-radius:8px;padding:0.75rem 1rem;color:#7A5200;"><strong>Right now:</strong> ${esc(copy.gapNote)}</p>` : '';

  const hasFiles = Array.isArray(prod.files) && prod.files.some(f => f && f.path);
  const summaryBits = [
    `${money(price)}`,
    ageRange,
    weeksLabel ? weeksLabel : null,
    'Digital download (PDF/ZIP)'
  ].filter(Boolean);
  const buyBtnHtml = hasFiles
    ? `<a href="/shop.html?add=${encodeURIComponent(prod.id || '')}" class="btn btn--primary btn--lg">Get ${esc(prod.title)} →</a>`
    : `<a href="#" class="btn btn--primary btn--lg" style="pointer-events:none;opacity:0.6;cursor:default;">Coming Soon</a>`;
  const summaryHtml = `<ul class="pack-landing-summary">${summaryBits.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` + buyBtnHtml;

  let includedHtml = '';
  if (copy.included && copy.included.length) {
    includedHtml = '<ol class="pack-landing-weeks">' + copy.included.map(w =>
      `<li><strong>${esc(w.title)}</strong><br><em>${esc(w.story)}</em><p>${esc(w.idea)}</p></li>`
    ).join('') + '</ol>';
  } else {
    const feats = (prod.features || []).filter(f => f && !/features:\s*$/i.test(f));
    includedHtml = feats.length ? `<ul class="pack-landing-included">${feats.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  }

  const howToHtml = copy.howTo && copy.howTo.length
    ? `<ol class="pack-landing-howto">${copy.howTo.map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
    : '';

  const previewPost = findBySlug(allPosts, copy.freePreview);
  const previewLink = lessonLink(previewPost);
  const previewHtml = previewLink
    ? `<p>Want to try a lesson first? <a href="${esc(previewLink.href)}">${esc(previewLink.title)}</a> is a free lesson in the same spirit as this pack — no purchase required.</p>`
    : '';

  // FAQ: grounded in real, known facts (price, age range, license, format,
  // delivery) plus any pack-specific question/answer pairs above.
  const multiCampusAnswer = 'This purchase is licensed for one teacher or classroom. For multiple classrooms or campuses, buy one license per classroom, or see Glory Kids Membership for a church license covering unlimited leaders and volunteers at one location.';
  const faq = [
    [copy.faqOverrides && copy.faqOverrides.ageQ || 'What age range is this for?', copy.faqOverrides && copy.faqOverrides.ageA || `Written for ${esc(ageRange)}, with notes to adapt activities up or down in age where needed.`],
    ['How is it delivered?', 'Instantly — after checkout you get a receipt email with secure download links, and it stays available from your account dashboard.'],
    ['What format is the download?', /zip/i.test(prod.fileNote || '') ? 'A ZIP file containing the full curriculum as printable PDFs.' : 'One or more printable PDF files.'],
    ['Can I use it for more than one classroom or campus?', multiCampusAnswer],
    ['How much prep time does it take?', 'Each lesson includes the teaching script, so most leaders spend 15-30 minutes reading through a session rather than writing one from scratch.'],
  ];
  if (copy.faqExtra) faq.push(...copy.faqExtra);
  faq.push(['Can I get a refund after purchase?', 'Digital downloads are generally non-refundable once delivered, since the files are instantly accessible. If something is genuinely wrong with your download, contact us and we’ll make it right.']);
  const faqHtml = `<div class="pack-landing-faq">${faq.map(([q, a]) => `<div class="faq-item"><button type="button" class="faq-question">${esc(q)}<span>+</span></button><div class="faq-answer"><p>${esc(a)}</p></div></div>`).join('')}</div>`;

  const relatedPackLinks = (copy.relatedPacks || []).map(s => packLink(findBySlug(allProducts, s))).filter(Boolean);
  const relatedLessonLinks = (copy.relatedLessons || []).map(s => lessonLink(findBySlug(allPosts, s))).filter(Boolean);
  const relatedHtml = (relatedPackLinks.length || relatedLessonLinks.length)
    ? '<div class="pack-landing-related">' +
        (relatedPackLinks.length ? `<h3>Related Packs</h3><ul>${relatedPackLinks.map(l => `<li><a href="${esc(l.href)}">${esc(l.title)}</a></li>`).join('')}</ul>` : '') +
        (relatedLessonLinks.length ? `<h3>Related Free Lessons</h3><ul>${relatedLessonLinks.map(l => `<li><a href="${esc(l.href)}">${esc(l.title)}</a></li>`).join('')}</ul>` : '') +
      '</div>'
    : '';

  // No heading here repeating copy.h1 - the real <h1> (pd-title, set in
  // bakePackPage) already carries that exact text; a second heading with
  // the same string right below it would be a redundant, confusing h1/h2
  // pair rather than a real second-level heading.
  const html =
    '<section class="section--light pack-landing">' +
      '<div class="container" style="max-width:860px;">' +
        summaryHtml + gapHtml +
        descHtml +
        (includedHtml ? `<h3>What's Included</h3>${includedHtml}` : '') +
        (howToHtml ? `<h3>How to Use This Curriculum</h3>${howToHtml}` : '') +
        previewHtml +
        `<h3>Frequently Asked Questions</h3>${faqHtml}` +
        relatedHtml +
      '</div>' +
    '</section>';

  const plainText = stripHtml(
    copy.h1 + ' ' + copy.desc.join(' ') + ' ' + (copy.gapNote || '') + ' ' +
    includedHtml + ' ' + howToHtml + ' ' + faq.map(([q, a]) => q + ' ' + a).join(' ')
  );

  return { html, text: plainText, faq };
}

/* Same idea as bakePostPage(), mirroring curriculum-pack.html's setMeta(). */
function bakePackPage(template, prod, allProducts, allPosts) {
  const url = packUrl(prod);
  const copy = PACK_COPY[prod.slug];
  // copy.metaTitle is already a complete, under-60-char title on its own
  // (keyword first) - appending " | Glory Kids Ministries" would blow past
  // 60 chars, so that suffix is only for packs with no PACK_COPY entry yet.
  const title = copy ? copy.metaTitle : (prod.title + ' | Glory Kids Ministries');
  const desc = (copy ? copy.metaDesc : null) || (prod.blurb || '').slice(0, 160) || (`Complete children's ministry resource — ${prod.title}. Instant download, ready to teach.`);
  const image = (prod.images && prod.images[0]) || (SITE_ORIGIN + '/images/glory-kids-logo.png');
  const parent = (prod.category === 'curriculum' || prod.category === 'bundle')
    ? { label: 'Curriculum Packs', href: 'curriculum-packs.html' }
    : { label: 'Shop', href: 'shop.html' };

  let html = template;
  html = setTextById(html, 'metaTitleTag', 'title', title);
  html = setAttrById(html, 'metaDescriptionTag', 'content', desc);
  html = setAttrById(html, 'metaCanonicalTag', 'href', url);
  html = setAttrById(html, 'metaOgTitle', 'content', title);
  html = setAttrById(html, 'metaOgDescription', 'content', desc);
  html = setAttrById(html, 'metaOgImage', 'content', image);
  html = setAttrById(html, 'metaOgUrl', 'content', url);
  html = setAttrById(html, 'metaTwitterTitle', 'content', title);
  html = setAttrById(html, 'metaTwitterDescription', 'content', desc);
  html = setAttrById(html, 'metaTwitterImage', 'content', image);

  // ---- the visible product page itself (mirrors renderProduct()'s DOM writes) ----
  const feats = (prod.features || []).filter(Boolean);
  const price = Number(prod.priceUSD != null ? prod.priceUSD : prod.priceZAR || 0);
  const money = n => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
  let badgesHtml = prod.weeks ? `<span class="pd-weeks-badge">${esc(prod.weeks)}</span>` : '<span></span>';
  if (prod.featured) badgesHtml += '<span class="pd-bestseller-badge">⭐ Bestseller</span>';
  const galleryImg = (prod.images && prod.images[0]) || '';
  const galleryHtml = galleryImg
    ? `<img src="${esc(galleryImg)}" alt="" />`
    : `<div class="pack-ph"><span>${esc(prod.title || '')}</span></div>`;

  const ageRangeDisplay = normalizeAgeRange(prod.ageRange, prod.slug === 'preschool-bible-curriculum-15-complete-lessons-ages-3-5' ? 'Ages 3-5' : null);

  html = setAttrById(html, 'pd-breadcrumb-parent-link', 'href', '/' + parent.href);
  html = setTextById(html, 'pd-breadcrumb-parent-link', 'a', parent.label);
  html = setTextById(html, 'pd-breadcrumb-title', 'span', prod.title);
  // The on-page H1 is the keyword-rich landing-page title (PHASE 5), not the
  // bare product name — falls back to the real title if a pack has no
  // PACK_COPY entry yet.
  html = setTextById(html, 'pd-title', 'h1', (copy && copy.h1) || prod.title);
  html = setTextById(html, 'pd-blurb', 'p', prod.blurb || '');
  html = setHtmlById(html, 'pd-gallery-content', 'div', galleryHtml);
  html = setHtmlById(html, 'pd-badge-row', 'div', badgesHtml);
  html = setHtmlById(html, 'pd-age-row', 'div', `<span class="pd-age-badge">${esc(ageRangeDisplay)}</span>`);
  if (feats.length) {
    html = setHtmlById(html, 'pd-included-list', 'div', feats.map(f => `<div class="pd-included-item">${esc(f)}</div>`).join(''));
  } else {
    html = setDisplayById(html, 'pd-included-wrap', 'none');
  }
  html = setTextById(html, 'pd-price', 'span', money(price));
  if (prod.compareAtUSD && prod.compareAtUSD > price) html = setTextById(html, 'pd-price-was', 'span', money(prod.compareAtUSD));
  // The button is live only if the product actually has files to deliver -
  // a purchase of a pack with nothing attached would charge the buyer and
  // then 404 on download. hasFiles is also used by buildPackLandingContent's
  // own buy button, below.
  const hasFiles = Array.isArray(prod.files) && prod.files.some(f => f && f.path);
  if (hasFiles) {
    html = setAttrById(html, 'pd-buy-btn', 'href', '/shop.html?add=' + encodeURIComponent(prod.id || ''));
  } else {
    html = setAttrById(html, 'pd-buy-btn', 'href', '#');
    html = setAttrById(html, 'pd-buy-btn', 'style', 'pointer-events:none;opacity:0.6;cursor:default;');
    html = setTextById(html, 'pd-buy-btn', 'a', 'Coming Soon');
  }
  // Same cleanup as bakePostPage: clear (not just hide) the loading text, and
  // the not-found state's own hardcoded <h1> — left in place, every pack page
  // would carry two H1s ("We couldn't find that pack." plus the real title).
  html = setDisplayById(html, 'pd-loading', 'none');
  html = setHtmlById(html, 'pd-loading', 'div', '');
  html = setHtmlById(html, 'pd-notfound', 'div', '');
  html = setDisplayById(html, 'pd-content', 'block');

  const product = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: prod.title, description: desc,
    image: (prod.images && prod.images.length) ? prod.images : [image],
    brand: { '@type': 'Brand', name: 'Glory Kids Ministries' },
    offers: {
      '@type': 'Offer', url, priceCurrency: 'USD',
      price: Number(prod.priceUSD != null ? prod.priceUSD : prod.priceZAR || 0),
      availability: 'https://schema.org/InStock'
    }
    // No aggregateRating/review here — none of these products have real,
    // attributable review data (see Item 3's testimonials findings), and
    // fabricating one is exactly the kind of unverifiable claim being
    // removed elsewhere, not something to add fresh on a product's own
    // structured data.
  };
  html = html.replace(/(<script id="ldProduct"[^>]*>)[\s\S]*?(<\/script>)/, (m, open, close) => open + JSON.stringify(product) + close);

  const breadcrumb = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_ORIGIN + '/index.html' },
      { '@type': 'ListItem', position: 2, name: parent.label, item: SITE_ORIGIN + '/' + parent.href },
      { '@type': 'ListItem', position: 3, name: prod.title, item: url }
    ]
  };
  html = html.replace(/(<script id="ldBreadcrumb"[^>]*>)[\s\S]*?(<\/script>)/, (m, open, close) => open + JSON.stringify(breadcrumb) + close);

  // PHASE 5: the real landing-page content (summary, description, what's
  // included, how to use, free preview, FAQ, related) — see
  // buildPackLandingContent(). Falls back to nothing (just the existing
  // product page above) for any pack with no PACK_COPY entry.
  const landing = buildPackLandingContent(prod, copy, allPosts, allProducts);
  html = html.replace(
    /<!-- gk:pack-landing-content -->[\s\S]*?<!-- \/gk:pack-landing-content -->/,
    landing.html
  );
  if (landing.faq && landing.faq.length) {
    const faqJsonLd = {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      // Matches the visible FAQ text exactly - built from the same `faq`
      // array buildPackLandingContent() rendered into the page, not
      // re-authored separately.
      mainEntity: landing.faq.map(([q, a]) => ({
        '@type': 'Question', name: q,
        acceptedAnswer: { '@type': 'Answer', text: a }
      }))
    };
    html = html.replace('</head>', `  <script type="application/ld+json">${JSON.stringify(faqJsonLd)}</script>\n</head>`);
  }

  PACK_LANDING_STATS[prod.slug] = {
    words: landing.text ? landing.text.split(/\s+/).filter(Boolean).length : 0,
    text: landing.text || ''
  };

  return html;
}

/* Writes one static index.html per row at `${DIR}/<relDir>/index.html`, and
   removes any previously-generated sibling directory that no longer matches
   a current row (renamed/unpublished/deleted post or product) — since this
   can run repeatedly against the same checkout, stale output must not
   linger the way it would on a one-shot CI build. */
function writeDetailPages(root, rows, relDirFor, bake, template) {
  const rootDir = path.join(DIR, root);
  const keep = new Set(rows.map(r => relDirFor(r)));
  if (fs.existsSync(rootDir)) {
    for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const rel = `${root}/${entry.name}`;
      if (!keep.has(rel)) fs.rmSync(path.join(DIR, rel), { recursive: true, force: true });
    }
  }
  let n = 0;
  for (const row of rows) {
    const rel = relDirFor(row);
    if (!rel) continue;
    const dir = path.join(DIR, rel);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), bake(template, row));
    n++;
  }
  return n;
}

function generatePostPages(posts, template) {
  let total = 0;
  for (const cat of ['free-bible-lessons', 'blog/parents', 'blog/pastors', 'blog/kidmin']) {
    const rows = posts.filter(p => p.slug && postPath(p) === `/${cat}/${p.slug}`);
    total += writeDetailPages(cat, rows, p => `${cat}/${p.slug}`, bakePostPage, template);
  }
  return total;
}

function generatePackPages(products, template, posts) {
  const rows = products.filter(p => p.active && p.slug);
  const bake = (tmpl, row) => bakePackPage(tmpl, row, products, posts);
  return writeDetailPages('pack', rows, p => `pack/${p.slug}`, bake, template);
}

// Mirrors free-bible-lessons.html's AGE_LABELS/GRAD_PALETTE/normalizeDynamic/
// cardHtml() exactly, so the grid it bakes in matches what the client's own
// JS would render for the same post.
const FREE_LESSON_AGE_LABELS = { preschool: 'Preschool (2-5)', k2: 'K-2nd', upper35: '3rd-5th', sixplus: '6th+' };
const FREE_LESSON_GRAD_PALETTE = ['#66249A,#00BFC4', '#FF4B32,#FFB000', '#0B2E67,#00BFC4', '#FFB000,#66249A', '#009BA0,#66249A', '#D45D9C,#FFB000'];

function freeLessonCardData(post, index) {
  const ageGroups = post.ageGroups && post.ageGroups.length ? post.ageGroups : ['sixplus'];
  const ageLabel = ageGroups.map(a => FREE_LESSON_AGE_LABELS[a] || a).join(' / ');
  return {
    title: post.title || '', story: post.scripture || '', desc: post.excerpt || '',
    ageGroups, ageLabel,
    topicIds: post.lessonTopics && post.lessonTopics.length ? post.lessonTopics : [],
    type: post.lessonType || 'lesson', season: post.season || 'general',
    emoji: post.icon || '📖', image: post.featuredImage || null,
    grad: FREE_LESSON_GRAD_PALETTE[index % FREE_LESSON_GRAD_PALETTE.length],
    href: '/free-bible-lessons/' + post.slug + '/',
    isPremiumSample: !!post.isPremiumSample
  };
}

/* Bakes real <div class="lesson-card"> markup into free-bible-lessons.html's empty
   #cardGrid shell — that div is normally filled in entirely by client-side
   JS after an async Firestore fetch, so Google's crawl of the raw page (or a
   render pass that times out before that fetch resolves) can see the grid
   as near-empty relative to what the page's own title/meta promise ("35
   free lessons"). GSC flagged this page "Crawled - currently not indexed" —
   the same thin-content-on-first-paint issue as the per-post canonical bug
   above, just showing up as a quality signal instead of a duplicate one.
   The client's own renderGrid() overwrites this on load, so real visitors
   never notice — this only changes what a non-JS fetch sees. Values are
   HTML-escaped here (the client version isn't) since this baked copy is
   what a crawler actually indexes; it's overwritten client-side either way. */
function freeLessonCardHtml(lesson, index) {
  return (
    `<div class="lesson-card" data-index="${index}" data-title="${esc(lesson.title.toLowerCase())}" data-story="${esc(lesson.story.toLowerCase())}"` +
    ` data-age="${esc(lesson.ageGroups.join(' '))}" data-topic="${esc(lesson.topicIds.join(' '))}" data-type="${esc(lesson.type)}" data-season="${esc(lesson.season)}">` +
      `<div class="lesson-card__thumb" style="background:linear-gradient(135deg,${lesson.grad});">` +
        (lesson.image ? `<img src="${esc(lesson.image)}" alt="${esc(lesson.title)}" class="lesson-card__img" />` : lesson.emoji) +
        `<span class="lesson-card__age">${esc(lesson.ageLabel)}</span>` +
        (lesson.isPremiumSample ? '<span class="lesson-card__premium" title="A free sample from our paid Membership curriculum">⭐ Premium Sample</span>' : '') +
      '</div>' +
      '<div class="lesson-card__body">' +
        `<div class="lesson-card__title">${esc(lesson.title)}</div>` +
        (lesson.story ? `<div class="lesson-card__story">📜 ${esc(lesson.story)}</div>` : '') +
        `<div class="lesson-card__desc">${esc(lesson.desc)}</div>` +
        '<div class="lesson-card__footer">' +
          `<a href="${esc(lesson.href)}" class="lesson-card__view">View Free Lesson →</a>` +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

// Mirrors curriculum-packs.html's gradFor()/money()/packCard() exactly — the
// #packs grid there was 100% client-rendered (GK.listActiveProducts().then()
// after up to ~4s of polling for GK to exist, THEN a static-fallback array if
// that never resolves) with a literal "Loading packs…" placeholder as the
// only raw-HTML content. Same bug class as the free-lessons grid above, just
// never given the same fix: a crawler reading raw HTML saw zero pack links
// out of this page, and zero pack-page inbound links from here.
const PACK_GRID_GRADS = [['#66249A', '#00BFC4'], ['#FF4B32', '#FFB000'], ['#0B2E67', '#00BFC4'], ['#FFB000', '#66249A'], ['#00BFC4', '#7ED6A5'], ['#E13C24', '#009BA0']];
function gradFor(s) { let h = 0; for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return PACK_GRID_GRADS[h % PACK_GRID_GRADS.length]; }
function packCardHtml(p) {
  const price = Number(p.priceUSD != null ? p.priceUSD : p.priceZAR || 0);
  const money = n => '$' + Number(n || 0).toFixed(2).replace(/\.00$/, '');
  const was = (p.compareAtUSD && p.compareAtUSD > price) ? `<span class="pack-price-was">${esc(money(p.compareAtUSD))}</span>` : '';
  const g = gradFor(p.title || p.id || '');
  const cover = (p.images && p.images[0])
    ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">`
    : `<div class="pack-ph"><span>${esc(p.title || '')}</span></div>`;
  let badges = '';
  if (p.weeks) badges += `<span class="pack-weeks-badge">${esc(p.weeks)}</span>`;
  if (p.featured) badges += '<span class="pack-new-badge">⭐ Bestseller</span>';
  const ageDisplay = normalizeAgeRange(p.ageRange, p.slug === 'preschool-bible-curriculum-15-complete-lessons-ages-3-5' ? 'Ages 3-5' : null);
  const ages = `<span class="age-badge">${esc(ageDisplay)}</span>`;
  const flist = p.features || [];
  let feats = flist.slice(0, 4).map(f => `<div class="pack-what-item">${esc(f)}</div>`).join('');
  if (flist.length > 4) feats += `<div class="pack-what-item" style="color:var(--gray-400);">+ ${flist.length - 4} more</div>`;
  const detailHref = '/pack/' + encodeURIComponent(p.slug || p.id);
  const copy = PACK_COPY[p.slug];
  return (
    `<a href="${esc(detailHref)}" class="pack-card-full reveal" style="text-decoration:none;">` +
      `<div class="pack-header-img" style="background:linear-gradient(140deg,${g[0]},${g[1]});">${cover}${badges}</div>` +
      '<div class="pack-body">' +
        (ages ? `<div class="pack-age-row">${ages}</div>` : '') +
        `<h3>${esc((copy && copy.cardTitle) || p.title || '')}</h3>` +
        `<p>${esc((copy && copy.cardBlurb) || p.blurb || '')}</p>` +
        (feats ? `<div class="pack-what"><div class="pack-what-title">What's included</div><div class="pack-what-list">${feats}</div></div>` : '<div class="pack-what"></div>') +
        '<div class="pack-price-row">' +
          `<div><span class="pack-price">${esc(money(price))}</span>${was}<div class="pack-price-note">Instant download</div></div>` +
          '<span class="btn btn--primary">View Curriculum →</span>' +
        '</div>' +
      '</div>' +
    '</a>'
  );
}
/* Finds the <tag ...> immediately preceding `fromIdx` and returns the full
   balanced inner content up to its matching close tag (handling nested
   tags of the SAME name) — same technique as the content-audit script
   used to verify this, just needed here to EXTRACT real FAQ answer text
   rather than just measure it. */
function extractBalanced(html, startIdx, tag) {
  let depth = 1, pos = startIdx;
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const closeRe = new RegExp(`</${tag}>`, 'gi');
  while (depth > 0) {
    openRe.lastIndex = pos; closeRe.lastIndex = pos;
    const om = openRe.exec(html);
    const cm = closeRe.exec(html);
    if (!cm) return null;
    if (om && om.index < cm.index) { depth++; pos = om.index + om[0].length; }
    else { depth--; pos = cm.index + cm[0].length; if (depth === 0) return { text: html.slice(startIdx, cm.index), endIdx: pos }; }
  }
}

/* Pulls real question/answer pairs straight out of a page's own visible FAQ
   markup, so the FAQPage JSON-LD this generates can only ever match the
   visible text exactly — there is no separately hand-typed copy of the FAQ
   content that could drift from what's actually on the page. */
function extractFaqPairs(html, qPattern, answerOpenPattern, answerTag) {
  const pairs = [];
  const qRe = new RegExp(qPattern, 'g');
  let m;
  while ((m = qRe.exec(html))) {
    const q = unesc(m[1]).trim();
    const aRe = new RegExp(answerOpenPattern);
    const rest = html.slice(m.index);
    const aMatch = aRe.exec(rest);
    if (!aMatch) continue;
    const start = m.index + aMatch.index + aMatch[0].length;
    const result = extractBalanced(html, start, answerTag);
    if (!result) continue;
    const text = stripHtml(result.text).replace(/\s+/g, ' ').trim();
    if (q && text) pairs.push([q, text]);
  }
  return pairs;
}

function faqPageJsonLd(pairs) {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: pairs.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } }))
  };
}
// Idempotent: this runs on every build (every Netlify deploy), so it must
// first remove any instance IT already inserted of the same @type, or
// re-running it would stack a fresh duplicate on top every single time.
function injectJsonLd(html, obj) {
  const type = obj['@type'];
  const stripRe = new RegExp(`\\s*<script type="application/ld\\+json">\\{"@context":"https://schema\\.org","@type":"${type}"[\\s\\S]*?</script>\\n?`, 'g');
  html = html.replace(stripRe, '');
  return html.replace(/<\/head>/i, `  <script type="application/ld+json">${JSON.stringify(obj)}</script>\n</head>`);
}

/* Homepage: adds FAQPage schema extracted from the page's own visible FAQ
   section - WebSite schema already existed by hand (a plain, spaced-JSON
   block right before the managed block) and is left alone rather than
   duplicated. */
function bakeHomepageSchema(html) {
  const pairs = extractFaqPairs(html, '<button class="faq-question">([^<]*)<span>\\+</span></button>', '<div class="faq-answer">', 'div');
  if (pairs.length) html = injectJsonLd(html, faqPageJsonLd(pairs));
  return html;
}

/* The dedicated FAQ page already had a hand-written FAQPage block - but it
   was a paraphrase, not the real visible text (and had drifted: it still
   said "ages 3-12" after the sitewide 3-13 fix). Strip that one out first,
   then inject one extracted straight from the current visible
   faq-item__q / faq-item__answer markup, which can't drift out of sync
   since there's no second copy to maintain. */
function bakeFaqPageSchema(html) {
  html = html.replace(/<!-- FAQPage structured data for SEO -->\n<script type="application\/ld\+json">\n[\s\S]*?\n<\/script>\n/, '');
  const pairs = extractFaqPairs(html, '<span class="faq-item__q">([^<]*)</span>', 'class="faq-item__answer">', 'div');
  if (pairs.length) html = injectJsonLd(html, faqPageJsonLd(pairs));
  return html;
}

function bakePacksGrid(html, products) {
  const rows = products.filter(p => p.active && p.slug && (p.category === 'curriculum' || p.category === 'bundle'));
  const cardsHtml = rows.map(packCardHtml).join('');
  return html.replace(
    /(<div class="pack-grid-full" id="packs">)[\s\S]*?(<!-- CUSTOM CURRICULUM -->)/,
    (m, open, marker) => `${open}${cardsHtml}</div>\n  </div>\n</section>\n\n${marker}`
  );
}

function bakeFreeLessonsGrid(html, posts) {
  const rows = posts.filter(p => p.category === 'free_lessons' && p.slug);
  const cardsHtml = rows.map((p, i) => freeLessonCardHtml(freeLessonCardData(p, i), i)).join('');
  // Matches the div's opening tag through to the next known sibling
  // (#noResults) rather than an empty-div shell — a previous bake already
  // fills this div with card markup, so an "opening tag immediately
  // followed by </div>" pattern would only ever match once, on a pristine
  // source file, and silently no-op on every rebuild after that.
  return html.replace(
    /(<div id="cardGrid"[^>]*>)[\s\S]*?(\n\s*<p id="noResults")/,
    (m, open, closeMarker) => `${open}${cardsHtml}</div>${closeMarker}`
  );
}

(async function main() {
  let [cfg, pages, redirects, posts, products] = await Promise.all([
    getDoc('site/config'), getCol('pages'), getCol('redirects'),
    getColWhere('posts', 'published', true).catch(() => []),
    getColWhere('products', 'active', true).catch(() => [])
  ]);
  if (!cfg) {
    // Firestore unreachable (rules not deployed, outage, etc.). Previously
    // this fell back to building with empty settings so a Firestore outage
    // never blocked a deploy — deliberately changed: a build that silently
    // produces a site with no baked SEO/content is worse than Netlify just
    // keeping the previous (good) deploy, so this now fails loud instead.
    console.error('BUILD FAILED: could not read site/config from Firestore.');
    process.exit(1);
  }

  // Editable-content docs for the marketing pages (+ pricing overrides).
  const contentDocs = {};
  await Promise.all(
    [...new Set(Object.values(CONTENT_PAGE_IDS)), 'pricing'].map(async id => {
      contentDocs[id] = await getDoc('content/' + id).catch(() => ({}));
    })
  );

  const pageByPath = {};
  pages.forEach(p => { pageByPath[p.path] = p; });

  // published==true is already guaranteed by the query; publishAt (scheduled
  // future posts, e.g. the monthly curriculum drop) still needs a client-side
  // check since Firestore can't express that OR-condition in the query filter.
  const livePosts = posts.filter(p => !p.publishAt || p.publishAt <= Date.now());

  const htmlFiles = listHtmlFiles(DIR).filter(f => !GENERATED_DETAIL_PAGE.test(f));
  let changed = 0;
  let blogPostTemplate = null;
  let curriculumPackTemplate = null;
  for (const f of htmlFiles) {
    const full = path.join(DIR, f);
    const before = fs.readFileSync(full, 'utf8');
    const page = pageByPath[f];
    const canonical = (page && page.canonicalUrl) || SITE_ORIGIN + '/' + urlPathFor(f);
    let after = applyToHtml(before, cfg, page, canonical);
    if (CONTENT_PAGE_IDS[f]) after = applyContent(after, contentDocs[CONTENT_PAGE_IDS[f]]);
    if (f === 'free-bible-lessons.html') after = bakeFreeLessonsGrid(after, livePosts);
    if (f === 'curriculum-packs.html') after = bakePacksGrid(after, products);
    if (f === 'index.html') after = bakeHomepageSchema(after);
    if (f === 'faq/index.html') after = bakeFaqPageSchema(after);
    if (after !== before) { fs.writeFileSync(full, after); changed++; }
    // Captured post-bake (so generated pages inherit the same favicon/GA4/org
    // JSON-LD as every other page) for use as the per-record template below.
    if (f === 'blog-post.html') blogPostTemplate = after;
    if (f === 'curriculum-pack.html') curriculumPackTemplate = after;
  }
  console.log(`Baked SEO into ${changed}/${htmlFiles.length} HTML files.`);

  /* Static per-post / per-pack pages with a real, server-side canonical tag
     baked in — fixes GSC "Duplicate without user-selected canonical" and
     "Duplicate, Google chose different canonical": every free-bible-lessons,
     blog and pack detail URL used to rewrite to the same template with an
     empty canonical link, filled in only by client-side JS. */
  const postPagesWritten = blogPostTemplate ? generatePostPages(livePosts, blogPostTemplate) : 0;
  const packPagesWritten = curriculumPackTemplate ? generatePackPages(products, curriculumPackTemplate, livePosts) : 0;
  console.log(`Generated ${postPagesWritten} post page(s) and ${packPagesWritten} pack page(s) with baked-in canonical tags.`);

  /* robots.txt */
  let robots = cfg.robotsTxt || 'User-agent: *\nAllow: /\n\nDisallow: /admin.html\nDisallow: /admin-login.html';
  robots = robots.replace(/\nSitemap:.*$/gm, '').trimEnd() + `\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
  fs.writeFileSync(path.join(DIR, 'robots.txt'), robots);

  /* sitemap.xml */
  const urls = [];
  htmlFiles.forEach(f => {
    const page = pageByPath[f];
    if (page && (page.visible === false || page.noindex)) return;
    if (/template/.test(f)) return;
    if (SITEMAP_EXCLUDE.has(f)) return;
    urls.push(SITE_ORIGIN + '/' + urlPathFor(f));
  });
  livePosts.forEach(p => urls.push(postUrl(p)));
  products.filter(p => p.active && p.slug).forEach(p => urls.push(packUrl(p)));
  fs.writeFileSync(path.join(DIR, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${esc(u)}</loc></url>`).join('\n') + `\n</urlset>\n`);

  /* _redirects (Netlify) */
  const rlines = [];
  redirects.filter(r => r.enabled !== false && r.from && r.to)
    .forEach(r => rlines.push(`${r.from}  ${r.to}  ${r.code || 301}`));
  htmlFiles.forEach(f => {
    const page = pageByPath[f];
    if (page && page.visible === false) rlines.push(`/${f}  /  302`);
  });
  /* Collapse Netlify's automatic extensionless duplicate: every top-level
     *.html file is ALSO served at its extension-less path with its own 200
     and no redirect (confirmed live: /about.html and /about both 200,
     identical content, zero hops) — that's an uncontrolled duplicate URL for
     every sitemap page, which is exactly the shape of GSC's "Duplicate,
     Google chose different canonical" complaint. Every internal link and the
     sitemap already point at the .html form, so that stays canonical; this
     just 301s the extensionless shadow into it instead of leaving it as a
     second live 200. Same eligibility filter as the sitemap loop below, so
     this list can never drift from what's actually indexable. */
  htmlFiles.forEach(f => {
    const page = pageByPath[f];
    if (page && (page.visible === false || page.noindex)) return;
    if (f.includes('/') || f === 'index.html' || /template/.test(f) || SITEMAP_EXCLUDE.has(f)) return;
    rlines.push(`/${f.slice(0, -'.html'.length)}  /${f}  301`);
  });
  fs.writeFileSync(path.join(DIR, '_redirects'), rlines.join('\n') + '\n');

  /* _headers (Netlify) — X-Robots-Tag: noindex for hidden/noindex pages.
     netlify.toml is hand-maintained (build/functions/api/404) — never written here. */
  const noindexPages = htmlFiles.filter(f => { const p = pageByPath[f]; return p && (p.noindex || p.visible === false); });
  const headers = noindexPages
    .map(f => `/${f}\n  X-Robots-Tag: noindex, nofollow`).join('\n');
  fs.writeFileSync(path.join(DIR, '_headers'), headers + (headers ? '\n' : ''));

  /* shopping-feed.xml — Google Merchant Center product feed */
  const activeProducts = products.filter(p => p.active && p.slug);
  fs.writeFileSync(path.join(DIR, 'shopping-feed.xml'), buildShoppingFeed(products));

  console.log(`Wrote robots.txt, sitemap.xml (${urls.length} URLs), _redirects (${rlines.length}), _headers (${noindexPages.length}), shopping-feed.xml (${activeProducts.length} products).`);

  /* ---- Fail-safe content check ----
     A build that silently ships near-empty or missing content (a Firestore
     read that quietly returned 0 rows, a bodyHtml field that lost its
     content) is worse than no build at all: Netlify keeps the PREVIOUS good
     deploy live if this script exits non-zero, so a bad read here must
     never produce a "successful" deploy. Always print the counts, pass or
     fail, so a healthy build's own log is a visible record of what shipped. */
  const freeLessonCount = livePosts.filter(p => p.category === 'free_lessons').length;
  const wc = html => stripHtml(html).split(/\s+/).filter(Boolean).length;
  const thinLessons = livePosts
    .map(p => ({ slug: p.slug, category: p.category, words: wc(p.bodyHtml) }))
    .filter(p => p.words < 300);
  // PHASE 5: real baked landing-page word count (PACK_LANDING_STATS, filled
  // in by bakePackPage/buildPackLandingContent above) — not just blurb +
  // features, now that each pack has a full landing page. 400-word floor
  // per Item 2 (up from the earlier 30-word placeholder).
  const thinPacks = activeProducts
    .map(p => ({ slug: p.slug, words: (PACK_LANDING_STATS[p.slug] && PACK_LANDING_STATS[p.slug].words) || 0 }))
    .filter(p => p.words < 400);

  // Duplicate-content check: hash each pack's landing text and flag any
  // two packs that ended up with the same (or near-identical) content -
  // catches a copy-paste mistake between PACK_COPY entries before it ships.
  const crypto = require('crypto');
  const hashOf = s => crypto.createHash('sha1').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');
  const seenHashes = {};
  const duplicatePacks = [];
  for (const p of activeProducts) {
    const text = (PACK_LANDING_STATS[p.slug] && PACK_LANDING_STATS[p.slug].text) || '';
    if (!text) continue;
    const h = hashOf(text);
    if (seenHashes[h]) duplicatePacks.push(`${p.slug} duplicates ${seenHashes[h]}`);
    else seenHashes[h] = p.slug;
  }

  // Warn, don't fail: an empty files array is a real content gap (the buy
  // button is already disabled for these in bakePackPage/
  // buildPackLandingContent above), but it's a data-completeness issue for
  // one product, not a reason to block the whole deploy.
  const noFilesPacks = activeProducts.filter(p => !Array.isArray(p.files) || !p.files.some(f => f && f.path));
  if (noFilesPacks.length) {
    console.warn(`WARNING: ${noFilesPacks.length} active pack(s) have no files attached - rendered as "Coming soon" with no buy button: ${noFilesPacks.map(p => p.slug).join(', ')}`);
  }

  console.log(`Content check: ${freeLessonCount} published free lessons, ${livePosts.length} total posts, ${activeProducts.length} active packs.`);
  console.log(`  thin lesson/blog pages (<300 words): ${thinLessons.length}${thinLessons.length ? ' — ' + thinLessons.map(l => l.slug).join(', ') : ''}`);
  console.log(`  thin pack pages (<400 words): ${thinPacks.length}${thinPacks.length ? ' — ' + thinPacks.map(l => l.slug + ' (' + l.words + ')').join(', ') : ''}`);
  console.log(`  duplicate-content pack pages: ${duplicatePacks.length}${duplicatePacks.length ? ' — ' + duplicatePacks.join(', ') : ''}`);

  const failures = [];
  if (!posts.length) failures.push('0 posts read from Firestore (fetch likely failed)');
  if (!products.length) failures.push('0 products read from Firestore (fetch likely failed)');
  if (freeLessonCount < 30) failures.push(`only ${freeLessonCount} published free lessons (need >= 30)`);
  if (activeProducts.length < 9) failures.push(`only ${activeProducts.length} active packs (need >= 9)`);
  if (thinLessons.length) failures.push(`${thinLessons.length} lesson/blog page(s) under 300 words`);
  if (thinPacks.length) failures.push(`${thinPacks.length} pack page(s) under 400 words: ${thinPacks.map(l => l.slug).join(', ')}`);
  if (duplicatePacks.length) failures.push(`duplicate pack content: ${duplicatePacks.join(', ')}`);

  if (failures.length) {
    console.error('BUILD FAILED — content safety check:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
})().catch(e => { console.error(e); process.exit(1); });
