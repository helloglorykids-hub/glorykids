/* ============================================================
   GLORY KIDS — PRICING CONFIGURATION
   Edit plan names, prices, features, and CTA links here.
   Rendered into #gkPricingMain (homepage) and #gkPricingChurch
   (church-pricing.html) by renderPricingCards() below.
   ============================================================ */

var GK_MAIN_PLANS = [
  {
    id: 'free',
    name: 'Explore Glory Kids',
    price: '$0',
    sub: 'Start with some of our free resources.',
    features: [
      'Free Bible lessons &amp; resources',
      'Free activities and coloring pages',
      'Sample curriculum',
      'Selected parent resources',
      'No credit card required'
    ],
    ctaText: 'Browse Free Resources',
    ctaHref: 'free-lessons.html',
    note: "Start free. Upgrade whenever you're ready."
  },
  {
    id: 'membership',
    featured: true,
    badge: '★ Most Popular',
    name: 'Glory Kids Membership',
    price: '$29.99<span>/month</span>',
    or: 'OR',
    priceSub: '$249<span>/year</span>',
    save: 'Save $111',
    features: [
      'Full, growing library of Bible lessons &amp; resources',
      'Full curriculum library',
      'New content added weekly',
      'Preschool + Elementary resources',
      'Crafts, games &amp; activities',
      'Coloring &amp; printable resources',
      'Family discipleship resources',
      'Parent devotionals',
      'Video teaching &amp; training',
      'Community access',
      'Member-only resources',
      'Cancel anytime'
    ],
    ctaText: 'Join the Waitlist',
    ctaHref: 'glory-kids-membership.html',
    note: 'Launching September 15, 2026. 14-day money-back guarantee. No questions asked.'
  },
  {
    id: 'church',
    name: 'Glory Kids for Churches',
    price: 'From $499<span>/year</span>',
    sub: 'Built for churches, kids ministries and ministry teams.',
    features: [
      'Everything in Glory Kids Membership',
      'Church-wide curriculum license',
      'Use across your kids ministry',
      'Multiple leaders and volunteers',
      'Volunteer teaching resources',
      'Ministry planning resources',
      'Leader training',
      'Church implementation resources',
      'Priority support'
    ],
    ctaText: 'View Church Plans',
    ctaHref: 'church-pricing.html',
    note: 'Launching September 15, 2026. Flexible options for ministries of different sizes.'
  }
];

var GK_CHURCH_PLANS = [
  {
    id: 'small-church',
    name: 'Small Church',
    price: '$499<span>/year</span>',
    sub: 'For smaller churches and growing kids ministries.',
    features: [
      'Full Glory Kids curriculum library',
      'Church-wide ministry license',
      'Multiple leaders and volunteers',
      'Print and use resources for your ministry',
      'Leader training',
      'Family discipleship resources',
      'New resources added regularly'
    ],
    ctaText: 'Join the Waitlist',
    /* TODO: replace with real Stripe checkout link/route once created */
    ctaHref: 'contact.html?plan=small-church'
  },
  {
    id: 'growing-church',
    featured: true,
    badge: 'Most Popular for Churches',
    name: 'Growing Church',
    price: '$899<span>/year</span>',
    sub: 'For established or growing kids ministries.',
    featuresIntro: 'Everything in Small Church, plus:',
    features: [
      'Expanded ministry usage',
      'Multiple classrooms / ministry environments',
      'Premium leader training',
      'Priority support',
      'Early access to selected new resources',
      'Premium video / animation resources as they become available',
      'Seasonal and special-event resources'
    ],
    ctaText: 'Join the Waitlist',
    /* TODO: replace with real Stripe checkout link/route once created */
    ctaHref: 'contact.html?plan=growing-church'
  },
  {
    id: 'multi-site',
    name: 'Large / Multi-Site',
    price: 'Custom',
    sub: 'For large churches, multi-site churches and larger ministry networks.',
    features: [
      'Multi-campus licensing',
      'Larger ministry teams',
      'Custom implementation support',
      'Flexible licensing',
      'Premium training',
      'Priority support',
      'Custom ministry needs'
    ],
    ctaText: 'Contact Us',
    ctaHref: 'contact.html?plan=multi-site'
  }
];

function renderPricingCards(containerId, plans) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = plans.map(function (plan, i) {
    var featured = plan.featured ? ' gk-pricing3__card--featured' : '';
    var badge = plan.badge ? '<div class="gk-badge gk-badge--popular gk-pricing3__badge">' + plan.badge + '</div>' : '';
    var price = '<div class="gk-pricing3__price">' + plan.price + '</div>';
    var or = plan.or ? '<div class="gk-pricing3__or">' + plan.or + '</div>' : '';
    var priceSub = plan.priceSub ? '<div class="gk-pricing3__price gk-pricing3__price--sub">' + plan.priceSub + '</div>' : '';
    var save = plan.save ? '<div class="gk-pricing3__save">' + plan.save + '</div>' : '';
    var sub = plan.sub ? '<p class="gk-pricing3__sub">' + plan.sub + '</p>' : '';
    var featuresIntro = plan.featuresIntro ? '<p class="gk-pricing3__sub" style="margin-bottom:.75rem;">' + plan.featuresIntro + '</p>' : '';
    var features = '<ul class="gk-pricing3__list">' + plan.features.map(function (f) {
      return '<li><span class="gk-pricing3__check">✓</span> ' + f + '</li>';
    }).join('') + '</ul>';
    var ctaClass = plan.featured ? 'gk-btn gk-btn--cta gk-btn--block gk-btn--lg' : 'gk-btn gk-btn--outline-ink gk-btn--block gk-btn--lg';
    var cta = '<a href="' + plan.ctaHref + '" class="' + ctaClass + '">' + plan.ctaText + '</a>';
    var note = plan.note ? '<p class="gk-pricing3__note">' + plan.note + '</p>' : '';

    /* No .reveal scroll-fade class here on purpose: these cards are injected
       by JS after the page's IntersectionObserver (app.js) is already set
       up, so they'd never get observed and would stay stuck at opacity:0.
       Render them fully visible immediately instead. */
    return (
      '<div class="gk-pricing3__card' + featured + '" data-plan="' + plan.id + '">' +
        badge +
        '<div class="gk-pricing3__name">' + plan.name + '</div>' +
        price + or + priceSub + save + sub + featuresIntro + features + cta + note +
      '</div>'
    );
  }).join('');
}

/* Admin overrides — content.js sets window.__gkPricing from Firestore
   content/pricing. Keys: "<planId>.<field>" e.g. "membership.price".
   Re-render is idempotent, so content.js can call this again once the
   Firestore read resolves. */
function gkApplyPricingOverrides() {
  var o = window.__gkPricing || {};
  function patch(plans) {
    plans.forEach(function (p) {
      ['price', 'priceSub', 'save', 'sub', 'ctaHref', 'ctaText', 'name'].forEach(function (f) {
        var v = o[p.id + '.' + f];
        if (v != null && v !== '') p[f] = v;
      });
    });
  }
  patch(GK_MAIN_PLANS);
  patch(GK_CHURCH_PLANS);
  renderPricingCards('gkPricingMain', GK_MAIN_PLANS);
  renderPricingCards('gkPricingChurch', GK_CHURCH_PLANS);
}
window.gkApplyPricingOverrides = gkApplyPricingOverrides;

gkApplyPricingOverrides();
