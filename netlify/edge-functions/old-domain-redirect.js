/* ============================================================
   old-domain-redirect.js — Netlify Edge Function

   Forces every childrensministrylessons.com (apex or www, http or
   https) request to a single 301 straight to its final URL on
   https://www.glorykidsministry.com.

   WHY an edge function and not just _redirects/netlify.toml: Netlify's
   own clean-URL file resolution (try "<path>.html", "<path>/index.html")
   runs ahead of the redirects engine for ANY extensionless path that
   resolves to a real file — confirmed live, this bypasses even a
   force=true wildcard rule. A bare old-domain hit like /blog or
   /free-bible-lessons was coming back 200 (served directly) instead of
   redirecting, because this site's own blog.html / free-bible-lessons.html
   happen to also "exist" at that resolved path. Edge Functions run
   earlier in the request pipeline than that file-resolution step, so
   this is not subject to the same precedence bug.

   This function owns its own copy of the old-domain mapping
   (old-domain-map.js) rather than reading netlify.toml/_redirects at
   request time — regenerate it with `node scripts/generate-old-domain-map.js`
   whenever an old-domain rule changes; old-domain-map.js's own header
   says so too.
   ============================================================ */
import oldDomainMap from './old-domain-map.js';

const NEW_ORIGIN = 'https://www.glorykidsministry.com';
const OLD_HOSTS = new Set([
  'childrensministrylessons.com',
  'www.childrensministrylessons.com',
]);

export default async (request, context) => {
  const url = new URL(request.url);

  // Never touches glorykidsministry.com (or anything else) — the only
  // domains this ever acts on are the two old-domain hosts above.
  if (!OLD_HOSTS.has(url.hostname)) {
    return context.next();
  }

  const mapped = oldDomainMap[url.pathname];
  const target = mapped || (NEW_ORIGIN + url.pathname + url.search);

  return new Response(null, {
    status: 301,
    headers: { Location: target },
  });
};

export const config = { path: '/*' };
