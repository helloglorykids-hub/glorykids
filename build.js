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

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function managedBlock(cfg, page, canonical) {
  const title = (page && page.seoTitle) || '';
  const desc = (page && page.seoDescription) || cfg.defaultMetaDescription || '';
  const og = (page && page.ogImageUrl) || cfg.defaultOgImageUrl || '';
  const L = [START];
  if (cfg.faviconUrl) L.push(`<link rel="icon" href="${esc(cfg.faviconUrl)}">`);
  if (cfg.appleTouchIconUrl) L.push(`<link rel="apple-touch-icon" href="${esc(cfg.appleTouchIconUrl)}">`);
  L.push(`<link rel="canonical" href="${esc(canonical)}">`);
  if (page && page.noindex) L.push(`<meta name="robots" content="noindex, nofollow">`);
  if (cfg.gscVerification) L.push(`<meta name="google-site-verification" content="${esc(cfg.gscVerification)}">`);
  const ogTitle = title || cfg.siteName || '';
  if (ogTitle) L.push(`<meta property="og:title" content="${esc(ogTitle)}">`);
  L.push(`<meta property="og:type" content="website">`);
  L.push(`<meta property="og:url" content="${esc(canonical)}">`);
  if (desc) L.push(`<meta property="og:description" content="${esc(desc)}">`);
  if (og) L.push(`<meta property="og:image" content="${esc(og)}">`);
  if (cfg.siteName) L.push(`<meta property="og:site_name" content="${esc(cfg.siteName)}">`);
  L.push(`<meta name="twitter:card" content="${og ? 'summary_large_image' : 'summary'}">`);
  if (cfg.twitterHandle) L.push(`<meta name="twitter:site" content="${esc(cfg.twitterHandle)}">`);
  if (desc) L.push(`<meta name="twitter:description" content="${esc(desc)}">`);
  if (og) L.push(`<meta name="twitter:image" content="${esc(og)}">`);
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
  // per-page title / description overrides, in place
  if (page && page.seoTitle) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(page.seoTitle)}</title>`);
  }
  if (page && page.seoDescription) {
    if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
      html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${esc(page.seoDescription)}">`);
    } else {
      html = html.replace(/<\/title>/i, `</title>\n  <meta name="description" content="${esc(page.seoDescription)}">`);
    }
  }
  const block = managedBlock(cfg, page, canonical);
  const re = new RegExp(START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?' + END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (re.test(html)) html = html.replace(re, block);
  else html = html.replace(/<\/head>/i, `  ${block}\n</head>`);

  html = applyCodeInjection(html, cfg);
  return html;
}

const CONTENT_PAGE_IDS = {
  'index.html': 'home',
  'glory-kids-curriculum.html': 'curriculum',
  'glory-kids-membership.html': 'membership',
  'church-pricing.html': 'church-pricing'
};

(async function main() {
  let [cfg, pages, redirects, posts] = await Promise.all([
    getDoc('site/config'), getCol('pages'), getCol('redirects'),
    getCol('posts').catch(() => [])
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

  const htmlFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.html') && !f.startsWith('admin'));
  let changed = 0;
  for (const f of htmlFiles) {
    const full = path.join(DIR, f);
    const before = fs.readFileSync(full, 'utf8');
    const page = pageByPath[f];
    const canonical = (page && page.canonicalUrl) || SITE_ORIGIN + '/' + (f === 'index.html' ? '' : f);
    let after = applyToHtml(before, cfg, page, canonical);
    if (CONTENT_PAGE_IDS[f]) after = applyContent(after, contentDocs[CONTENT_PAGE_IDS[f]]);
    if (after !== before) { fs.writeFileSync(full, after); changed++; }
  }
  console.log(`Baked SEO into ${changed}/${htmlFiles.length} HTML files.`);

  /* robots.txt */
  let robots = cfg.robotsTxt || 'User-agent: *\nAllow: /\n\nDisallow: /admin.html\nDisallow: /admin-login.html\nDisallow: /admin-import.html';
  robots = robots.replace(/\nSitemap:.*$/gm, '').trimEnd() + `\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
  fs.writeFileSync(path.join(DIR, 'robots.txt'), robots);

  /* sitemap.xml */
  const urls = [];
  htmlFiles.forEach(f => {
    const page = pageByPath[f];
    if (page && (page.visible === false || page.noindex)) return;
    if (/template/.test(f)) return;
    urls.push(SITE_ORIGIN + '/' + (f === 'index.html' ? '' : f));
  });
  posts.filter(p => p.published).forEach(p => urls.push(`${SITE_ORIGIN}/blog-post.html?slug=${p.slug}`));
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
