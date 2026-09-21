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
  if (cfg.ga4MeasurementId) {
    const id = cfg.ga4MeasurementId;
    L.push(`<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}"></script>`);
    L.push(`<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`);
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
function setAttrById(html, id, attr, value) {
  const re = new RegExp(`(<[^>]*\\bid="${id}"[^>]*\\s${attr}=")[^"]*(")`);
  return html.replace(re, (m, pre, post) => pre + esc(value) + post);
}
function setTextById(html, id, tag, text) {
  const re = new RegExp(`(<${tag} id="${id}"[^>]*>)[\\s\\S]*?(</${tag}>)`);
  return html.replace(re, (m, open, close) => open + esc(text) + close);
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

/* Bakes this post's real title/description/canonical/OG/Twitter/JSON-LD into
   a copy of the (already SEO-baked) blog-post.html template, mirroring
   renderPost() in that file exactly. The client-side JS still hydrates the
   article body — only the <head> tags need to exist server-side, since an
   empty canonical in the raw HTML is what let Google pick its own canonical
   across these near-identical URLs (GSC: "Duplicate, Google chose different
   canonical" / "Duplicate without user-selected canonical"). */
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

  const dateP = post.publishAt || post.createdAt || Date.now();
  const dateM = post.updatedAt || post.createdAt || dateP;
  const blogPosting = {
    '@context': 'https://schema.org', '@type': 'BlogPosting',
    headline: post.title, description: desc, image,
    datePublished: new Date(dateP).toISOString(),
    dateModified: new Date(dateM).toISOString(),
    author: { '@type': 'Person', name: post.author || 'Jandre van der Walt', url: SITE_ORIGIN + '/contact.html' },
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
        ? { '@type': 'ListItem', position: 2, name: 'Free Lessons', item: SITE_ORIGIN + '/free-lessons.html' }
        : { '@type': 'ListItem', position: 2, name: CATEGORY_LABELS[post.category] || 'Blog', item: SITE_ORIGIN + '/blog.html' },
      { '@type': 'ListItem', position: 3, name: post.title, item: url }
    ]
  };
  html = html.replace(/(<script id="ldBreadcrumb"[^>]*>)[\s\S]*?(<\/script>)/, (m, open, close) => open + JSON.stringify(breadcrumb) + close);

  return html;
}

/* Same idea as bakePostPage(), mirroring curriculum-pack.html's setMeta(). */
function bakePackPage(template, prod) {
  const url = packUrl(prod);
  const title = prod.title + ' | Glory Kids Ministries';
  const desc = (prod.blurb || '').slice(0, 160) || (`Complete children's ministry resource — ${prod.title}. Instant download, ready to teach.`);
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

function generatePackPages(products, template) {
  const rows = products.filter(p => p.active && p.slug);
  return writeDetailPages('pack', rows, p => `pack/${p.slug}`, bakePackPage, template);
}

// Mirrors free-lessons.html's AGE_LABELS/GRAD_PALETTE/normalizeDynamic/
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
    href: '/free-bible-lessons/' + post.slug,
    isPremiumSample: !!post.isPremiumSample
  };
}

/* Bakes real <div class="lesson-card"> markup into free-lessons.html's empty
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
    // Firestore unreachable (rules not deployed, outage, etc.). Don't fail the
    // whole deploy — carry on with empty settings so robots.txt / sitemap.xml /
    // _redirects still generate and the hand-written <head> tags in each HTML
    // file stay as-is. Fix the rules and redeploy to restore managed SEO.
    console.error('WARNING: could not read site/config from Firestore — building with defaults (managed SEO/favicon skipped).');
    cfg = {};
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
    if (f === 'free-lessons.html') after = bakeFreeLessonsGrid(after, livePosts);
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
  const packPagesWritten = curriculumPackTemplate ? generatePackPages(products, curriculumPackTemplate) : 0;
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
  fs.writeFileSync(path.join(DIR, '_redirects'), rlines.join('\n') + '\n');

  /* _headers (Netlify) — X-Robots-Tag: noindex for hidden/noindex pages.
     netlify.toml is hand-maintained (build/functions/api/404) — never written here. */
  const noindexPages = htmlFiles.filter(f => { const p = pageByPath[f]; return p && (p.noindex || p.visible === false); });
  const headers = noindexPages
    .map(f => `/${f}\n  X-Robots-Tag: noindex, nofollow`).join('\n');
  fs.writeFileSync(path.join(DIR, '_headers'), headers + (headers ? '\n' : ''));

  console.log(`Wrote robots.txt, sitemap.xml (${urls.length} URLs), _redirects (${rlines.length}), _headers (${noindexPages.length}).`);
})().catch(e => { console.error(e); process.exit(1); });
