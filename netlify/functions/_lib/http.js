/* Small shared helpers for Netlify function responses + body parsing. */
'use strict';

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(obj)
});

const text = (statusCode, str) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain' },
  body: str
});

function parseBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : (event.body || '');
  const ctype = (event.headers['content-type'] || event.headers['Content-Type'] || '').toLowerCase();
  if (ctype.includes('application/json')) {
    try { return { json: JSON.parse(raw || '{}'), raw }; } catch (e) { return { json: {}, raw }; }
  }
  // form-urlencoded — keep field order for signature checks
  const pairs = [];
  const obj = {};
  raw.split('&').forEach(kv => {
    if (!kv) return;
    const i = kv.indexOf('=');
    const k = decodeURIComponent(kv.slice(0, i).replace(/\+/g, ' '));
    const v = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    pairs.push([k, v]);
    obj[k] = v;
  });
  return { json: obj, form: obj, pairs, raw };
}

module.exports = { json, text, parseBody };
