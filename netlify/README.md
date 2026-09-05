# Netlify Functions — Glory Kids shop / forms / email

Serverless endpoints behind `/api/*` (see `../netlify.toml`).

| Route | File | Purpose |
|---|---|---|
| `/api/payfast-checkout` | `functions/payfast-checkout.js` | Build a signed PayFast payment from a cart; creates a `pending` order |
| `/api/payfast-notify` | `functions/payfast-notify.js` | PayFast ITN webhook — verifies + fulfils the order |
| `/api/download` | `functions/download.js` | Token-gated redirect to a 10-min signed Storage URL |
| `/api/order-status` | `functions/order-status.js` | Thank-you page order lookup |
| `/api/mailerlite` | `functions/mailerlite.js` | Subscribe / upsert a MailerLite contact |
| `/api/form-submit` | `functions/form-submit.js` | Generic form endpoint → `formSubmissions` (+ ticket for contact) |

## Required environment variables (Netlify → Site settings → Environment variables)

| Var | Notes |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Full service-account JSON on one line. Firebase console → Project settings → Service accounts → Generate new private key |
| `FIREBASE_STORAGE_BUCKET` | `glorykidsministries-3d279.firebasestorage.app` (default, optional) |
| `PAYFAST_MERCHANT_ID` | From the PayFast dashboard |
| `PAYFAST_MERCHANT_KEY` | From the PayFast dashboard |
| `PAYFAST_PASSPHRASE` | Set the same value in PayFast → Settings → Security passphrase |
| `PAYFAST_MODE` | `sandbox` while testing, `live` for production |
| `MAILERLITE_API_KEY` | MailerLite → Integrations → API. Uses the new API (`connect.mailerlite.com`) |
| `MAILERLITE_GROUP_NEWSLETTER` | Group ID for newsletter sign-ups |
| `MAILERLITE_GROUP_CUSTOMERS` | Group ID buyers are added to |
| `SITE_ORIGIN` | `https://www.childrensministrylessons.com` |
| `TOKEN_SECRET` | Any long random string (download-link signing). Optional — falls back to the SA key |

## Local development

```bash
npm i -g netlify-cli
cd /Users/Jandre_1/Desktop/WEBSITE
netlify dev        # serves site + functions on http://localhost:8888
```

Create `netlify/functions/.env` (git-ignored) with the vars above for local runs, or use
`netlify env:set`.

## PayFast sandbox testing

1. Set `PAYFAST_MODE=sandbox`, use the sandbox merchant ID/key `10000100` / `46f0cd694581a`
   (or your own sandbox credentials), passphrase blank or matching.
2. Sandbox card: any details on the PayFast sandbox screen — it always succeeds.
3. ITN needs a public URL. Use `netlify deploy` to a draft URL, or `ngrok http 8888` and set
   `SITE_ORIGIN` to the tunnel so `notify_url` is reachable.
