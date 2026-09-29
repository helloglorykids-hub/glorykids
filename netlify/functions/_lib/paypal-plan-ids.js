/* PayPal Billing Plan IDs — not secret (they're already public in every
   checkout button's page source), so hardcoded here rather than stored as
   env vars, which count toward AWS Lambda's 4KB-per-function limit.
   Used by both paypal-subscription-start.js (renders the button) and
   paypal-subscription-confirm.js (verifies the approved subscription
   actually belongs to the plan the user started checkout for). */
'use strict';

module.exports = {
  monthly: 'P-5HJ38241B3561884DNKUWMCA',
  // Replaced 2026-09-29 — the original annual plan (P-55X27452X1404451SNKUWPJA)
  // was misconfigured with a fixed 1 billing cycle, so it silently EXPIRED
  // after each member's first payment instead of recurring annually. PayPal
  // doesn't allow editing a plan's cycle count after creation, so this is a
  // new plan created with unlimited cycles instead.
  annual: 'P-06000649J1343362BNK6BD7A',
  church: 'P-0PK840601V2046942NKUWQKQ',
  'church-annual': 'P-74Y03914SL211573ENKUZCJQ'
};
