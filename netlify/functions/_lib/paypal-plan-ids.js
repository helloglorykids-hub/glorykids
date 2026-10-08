/* PayPal Billing Plan IDs — not secret (they're already public in every
   checkout button's page source), so hardcoded here rather than stored as
   env vars, which count toward AWS Lambda's 4KB-per-function limit.
   Used by both paypal-subscription-start.js (renders the button) and
   paypal-subscription-confirm.js (verifies the approved subscription
   actually belongs to the plan the user started checkout for). */
'use strict';

// Individual Annual plan removed 2026-09-29 — the business wants monthly
// income, not an annual lump sum (also, the original annual plan was
// separately found to be misconfigured with a fixed 1 billing cycle,
// silently EXPIRING after each member's first payment instead of
// recurring — that would have needed its own new plan either way).
// Church Annual plan removed 2026-10-08, same reasoning.
//
// Church pricing changed 2026-10-08 to $59/mo base + $20/mo per extra
// location (was $79 + $49) — new plan created on PayPal with tiered
// pricing (tier 1: qty 1 @ $59; tier 2: qty 2+ @ $20/unit) so the total
// comes out to $59/$79/$99/$119/$139 for 1-5 locations, scaling the same
// way beyond that. Old $79-tier plan ID retired 2026-10-08.
module.exports = {
  monthly: 'P-5HJ38241B3561884DNKUWMCA',
  church: 'P-1SD13426PP891502SNLD2S3Q'
};
