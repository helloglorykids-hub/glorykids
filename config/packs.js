/* ============================================================
   config/packs.js — SINGLE SOURCE OF TRUTH for monthly curriculum
   packs shown on the homepage, /this-month, /church and
   /curriculum-packs. Add a new entry here when a new pack ships;
   pages should render from this list rather than hardcoding pack
   copy.

   Fields:
     slug          — used for pack URLs / data-pack attributes
     title         — e.g. "Generous Hearts"
     theme         — short tagline
     releaseDate   — ISO date the pack drops (packs ship the 15th)
     status        — "released" | "upcoming"
     coverImage    — path under /images
     samplePdfUrl  — Week 1 sample PDF; leave null to hide that CTA
     audioPreviewUrl — worship audio preview; leave null/undefined
                       to fall back to the generic worship copy
     shopProductId — Firestore products/{id} for the $59 single-pack
                     purchase (shop.html?add=<id>); leave null until
                     the pack exists as its own shop product
     weeks[]       — { n, title, story, bigIdea, pillar, teachOn }
       pillar  — "Voice" | "Power" | "Presence" (Glory Kids' three
                 teaching pillars — shown as a badge on the week card)
       teachOn — ISO date suggesting which Sunday to teach that week
     activitiesCount — leave null/0 to render nothing (per spec)
   ============================================================ */
(function () {
  window.GK_PACKS = [
    {
      slug: 'november-generous-hearts',
      title: 'Generous Hearts',
      theme: 'Living Thankful',
      releaseDate: '2026-11-15',
      status: 'released',
      coverImage: 'images/November.jpeg',
      samplePdfUrl: null, // TODO Jandré: add the Week 1 sample PDF URL
      audioPreviewUrl: null,
      shopProductId: null, // TODO Jandré: link to the matching shop product once published there
      weeks: [
        { n: 1, title: 'David & Mephibosheth', story: 'A Place at the Table', bigIdea: "God's kindness welcomes us in, even when we feel like we don't belong." },
        { n: 2, title: 'Elijah & the Widow', story: 'Trusting God With What I Have', bigIdea: 'God can take the little we give Him and make it enough — even more than enough.' },
        { n: 3, title: 'The Ten Men with Leprosy', story: 'Gratitude That Returns to Jesus', bigIdea: "Gratitude grows when we notice and remember God's goodness, and bring our thanks back to Him." },
        { n: 4, title: 'Jesus & Zacchaeus', story: 'A Heart Transformed by Jesus', bigIdea: 'Meeting Jesus changes how we live and what we value.' }
      ],
      activitiesCount: 40
    },
    {
      slug: 'christmas-birth-of-jesus',
      title: 'Christmas',
      theme: 'A 4-week series on the birth of Jesus',
      releaseDate: '2026-12-01',
      status: 'upcoming',
      coverImage: 'images/packs/christmas-cover.jpg',
      samplePdfUrl: null,
      audioPreviewUrl: null,
      shopProductId: null,
      weeks: [
        { n: 1, title: 'The Promise', story: 'Isaiah 9:6-7; Micah 5:2', bigIdea: 'God always keeps His promises, and His biggest promise was Jesus.', pillar: 'Voice', teachOn: '2026-12-06' },
        { n: 2, title: 'Nothing Is Impossible', story: 'Luke 1:26-38; Matthew 1:18-25', bigIdea: 'Nothing is impossible with God, so we can trust Him and say yes.', pillar: 'Power', teachOn: '2026-12-13' },
        { n: 3, title: 'Good News for Everyone', story: 'Luke 2:1-20', bigIdea: 'Jesus came for everyone, and we get to share the good news.', pillar: 'Power', teachOn: '2026-12-20' },
        { n: 4, title: 'Worship the King', story: 'Matthew 2:1-12', bigIdea: 'Jesus is the King worth worshiping with our best.', pillar: 'Presence', teachOn: '2026-12-27' }
      ],
      // Not produced yet — leave null (renders nothing) until activities are built.
      activitiesCount: null
    }
  ];

  window.GK_PACKS.featured = function () {
    var upcoming = window.GK_PACKS.find(function (p) { return p.status === 'upcoming'; });
    if (upcoming) return upcoming;
    var released = window.GK_PACKS.filter(function (p) { return p.status === 'released'; });
    return released[released.length - 1] || null;
  };
})();
