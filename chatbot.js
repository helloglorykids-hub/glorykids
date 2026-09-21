/* ============================================================
   GLORY KIDS — AI SUPPORT CHATBOT (local, no external API)
   ============================================================
   Self-contained floating widget: injects its own CSS + markup,
   answers common questions from a local knowledge base, and lets
   visitors escalate to a live person (email or a message that
   lands in the admin Support inbox) when it can't help.
   ============================================================ */

(function () {
  const SUPPORT_EMAIL = 'hello.glorykids@gmail.com';
  const HISTORY_KEY = 'gk_chat_history';

  /* ── Knowledge base ───────────────────────────────────────── */
  const KB = [
    {
      keywords: ['free', 'lesson', 'lessons', 'trial'],
      answer: "Head to our <a href=\"free-lessons.html\">Free Lessons</a> page and <a href=\"signup.html\">create a free account</a> — no credit card needed — to unlock all 35 complete, ready-to-teach Bible lessons instantly, plus a free sample from our Premium curriculum."
    },
    {
      keywords: ['curriculum', 'pack', 'packs', 'series'],
      answer: "Our Curriculum Packs are multi-week teaching series for churches and homeschools. Check out <a href=\"curriculum-packs.html\">Curriculum Packs</a> for the full lineup, or <a href=\"glory-kids-curriculum.html\">Glory Kids Curriculum</a> for our premium member-only series."
    },
    {
      keywords: ['price', 'pricing', 'cost', 'how much', 'membership', 'glory kids', 'subscription'],
      answer: "Glory Kids Membership is just <strong>$29.99/month</strong> (or $299/year — save $60) and unlocks our full, growing lesson library, curriculum series, activity sheets, and new lessons every week. You can see everything included on the <a href=\"glory-kids-curriculum.html#pricing\">Membership page</a>."
    },
    {
      keywords: ['church pricing', 'church plan', 'multi campus', 'multi-campus', 'nonprofit pricing', 'church license', 'kidmin team', 'church discount', 'group discount'],
      answer: "Glory Kids for Churches is $79/month (or $799/year — save $149) for one church location with full team access — unlimited leaders and volunteers included. Extra locations are +$49/month each. See <a href=\"glory-kids-curriculum.html#pricing\">Church Pricing</a> for details, or <a href=\"contact.html\">contact our team</a> for multi-site or larger ministry networks."
    },
    {
      keywords: ['cancel', 'pause', 'downgrade', 'unsubscribe'],
      answer: "You can pause or cancel your Glory Kids membership any time from your <a href=\"dashboard.html\">Dashboard → Membership</a> tab, or just ask here and I can connect you with our team to handle it for you — no long-term contracts, ever."
    },
    {
      keywords: ['refund', 'money back', 'guarantee'],
      answer: "Because our digital products and membership give instant access, sales are generally final and non-refundable — this covers change of mind, accidental purchases, or deciding a resource isn't the right fit. If you got the wrong file, hit a technical problem accessing your purchase, or think you were charged incorrectly, we'll always sort it out. Full details are on our <a href=\"refund-policy.html\">Refund Policy</a> page, or use \"Talk to a live agent\" below and our team will help."
    },
    {
      keywords: ['charge', 'billing', 'payment', 'invoice', 'receipt', 'double charged', 'wrong amount'],
      answer: "If something doesn't look right with a charge, we're happy to help — please use the \"Talk to a live agent\" option below and our team will sort it out within 24 hours. You can also see your billing history in your <a href=\"dashboard.html\">Dashboard → Membership</a> tab."
    },
    {
      keywords: ['delivery', 'shipping', 'when will i receive', 'digital delivery'],
      answer: "Digital products (lessons, curriculum packs) are available instantly after purchase — no shipping wait. See our <a href=\"delivery-policy.html\">Delivery Policy</a> for full details."
    },
    {
      keywords: ['blog', 'article', 'articles', 'tips'],
      answer: "Our <a href=\"blog.html\">Blog</a> has articles for parents, pastors, and kidmin leaders — practical tips on everything from prayer to volunteer recruitment."
    },
    {
      keywords: ['shop', 'store', 'buy', 'merch', 'product', 'physical'],
      answer: "Check out our <a href=\"shop.html\">Shop</a> for printed curriculum, books, and ministry resources you can purchase directly."
    },
    {
      keywords: ['account', 'login', 'log in', 'sign in', 'password', 'signup', 'sign up', 'register', 'forgot password'],
      answer: "You can create a free account on our <a href=\"signup.html\">Sign Up</a> page, or sign in at <a href=\"login.html\">Login</a>. Forgot your password? Use the <a href=\"forgot-password.html\">reset link</a> there."
    },
    {
      keywords: ['age', 'ages', 'grade', 'toddler', 'kids', 'children', 'age group'],
      answer: "Our lessons and curriculum are designed for kids roughly ages 3–12, with most series noting a specific age range so you can pick what fits your group."
    },
    {
      keywords: ['church', 'volunteer', 'kidmin', 'sunday school', 'vbs'],
      answer: "We're built for churches and kidmin teams — many of our curriculum packs are Sunday-school-ready, and our blog has articles specifically on recruiting and equipping volunteers. Running a whole team? See <a href=\"glory-kids-curriculum.html#pricing\">Church Pricing</a>."
    },
    {
      keywords: ['compare', 'comparison', 'versus', ' vs ', 'orange curriculum', 'rightnow media', 'go curriculum'],
      answer: "See our full <a href=\"comparison.html\">Comparison page</a> for how Glory Kids stacks up against Orange, RightNow Media, and GO Curriculum on price, content, and free access."
    },
    {
      keywords: ['contact', 'support', 'help', 'reach', 'phone number'],
      answer: "You can reach our team any time at <a href=\"mailto:" + SUPPORT_EMAIL + "\">" + SUPPORT_EMAIL + "</a>, through our <a href=\"contact.html\">Contact page</a>, or just leave a message right here and we'll get back to you within 24 hours."
    },
    {
      keywords: ['delete', 'remove account', 'privacy', 'data', 'gdpr', 'popia'],
      answer: "You can delete your account any time from your <a href=\"dashboard.html\">Dashboard → Profile → Danger Zone</a>. This permanently removes your data. See our <a href=\"privacy-policy.html\">Privacy Policy</a> for more, or let us know below if you need help."
    },
    {
      keywords: ['terms', 'terms of use', 'terms of service', 'legal'],
      answer: "You can read our full <a href=\"terms-of-use.html\">Terms of Use</a> any time — it's also linked in the footer of every page."
    },
    {
      keywords: ['faq', 'frequently asked', 'questions'],
      answer: "Our <a href=\"faq/index.html\">FAQ page</a> covers everything from free lessons and pricing to file formats and lesson structure — worth a look before reaching out!"
    },
    /* ── Member Portfolio / Dashboard navigation ─────────────────── */
    {
      keywords: ['dashboard', 'portfolio', 'my portfolio', 'member portfolio', 'my account page', 'my library'],
      answer: "Your <a href=\"dashboard.html\">Dashboard</a> (your \"member portfolio\") is where everything lives once you're signed in. The left-hand menu has: <strong>Dashboard</strong> (overview), <strong>My Lessons</strong>, <strong>Curriculum</strong>, <strong>Activities</strong>, <strong>Saved</strong>, <strong>My Purchases</strong>, <strong>Profile</strong>, and <strong>Membership</strong>. Ask me about any of those and I'll point you to the right one!"
    },
    {
      keywords: ['where are my lessons', 'find my lessons', 'my lessons tab', 'downloaded lessons', 'where do i download'],
      answer: "Go to <a href=\"dashboard.html#lessons\">Dashboard → My Lessons</a> — that's where all 35 free lessons live, with download links for each."
    },
    {
      keywords: ['where is curriculum', 'my curriculum', 'curriculum tab', 'monthly series'],
      answer: "Your monthly curriculum series are under <a href=\"dashboard.html#curriculum\">Dashboard → Curriculum</a> — available in full to active Glory Kids members."
    },
    {
      keywords: ['saved', 'favourites', 'favorites', 'bookmarks', 'wishlist'],
      answer: "Anything you've bookmarked while browsing shows up under <a href=\"dashboard.html#saved\">Dashboard → Saved</a>."
    },
    {
      keywords: ['my purchases', 'order history', 'past orders', 'what did i buy', 'my orders'],
      answer: "Your order history for anything bought from the Shop is under <a href=\"dashboard.html#purchases\">Dashboard → My Purchases</a>."
    },
    {
      keywords: ['profile', 'my details', 'change name', 'change email', 'update profile'],
      answer: "You can update your name, email, and account details under <a href=\"dashboard.html#profile\">Dashboard → Profile</a> — that's also where account deletion lives, under Danger Zone."
    },
    {
      keywords: ['manage membership', 'my membership', 'membership tab', 'billing history'],
      answer: "Your plan, billing history, and cancel/pause options are all under <a href=\"dashboard.html#membership\">Dashboard → Membership</a>."
    },
    {
      keywords: ['find a lesson', 'search lesson', 'looking for a lesson', 'do you have a lesson on', 'lesson about', 'lesson on'],
      answer: "Tell me the Bible story, character, or topic you're after and I'll search our lesson library for you — or browse everything yourself on the <a href=\"free-lessons.html\">Free Lessons</a> page."
    }
  ];

  const ESCALATE_KEYWORDS = ['agent', 'human', 'person', 'someone', 'representative', 'talk to you', 'jandre', 'real person', 'live chat', 'speak to'];

  // Scores an entry by its matched keywords, weighting multi-word phrases
  // higher (they're more specific) and de-duping overlaps like 'lesson' vs
  // 'lessons' so a plural doesn't silently count twice for the same idea.
  function bestKbMatch(text) {
    const t = text.toLowerCase();
    let best = null, bestScore = 0;
    KB.forEach(entry => {
      let matched = [];
      entry.keywords.forEach(k => {
        if (!t.includes(k)) return;
        if (matched.some(m => m.indexOf(k) !== -1)) return; // subsumed by an already-matched keyword
        matched = matched.filter(m => k.indexOf(m) === -1); // this one subsumes a shorter match
        matched.push(k);
      });
      const score = matched.reduce((s, k) => s + k.trim().split(/\s+/).length, 0);
      if (score >= bestScore && score > 0) { bestScore = score; best = entry; }
    });
    return { entry: best, score: bestScore };
  }

  /* ── Live site search — searches every published lesson/blog post ──
     Used as a fallback when nothing in the static KB matches, so a
     question like "do you have a lesson on Noah's Ark?" finds the real
     post instead of going straight to "talk to a live agent". */
  const STOPWORDS = [
    'the', 'a', 'an', 'is', 'are', 'do', 'you', 'have', 'has', 'for', 'on', 'about', 'any',
    'lesson', 'lessons', 'bible', 'story', 'kids', 'child', 'children', 'and', 'with', 'that',
    'this', 'can', 'find', 'looking', 'search', 'where', 'get', 'got', 'want', 'need', 'know',
    'tell', 'let', 'let\'s', 'how', 'what', 'why', 'when', 'who', 'will', 'would', 'could',
    'should', 'please', 'thanks', 'thank', 'your', 'yours', 'from', 'into', 'out', 'not', 'just',
    'like', 'some', 'all', 'one', 'our', 'ours', 'her', 'his', 'its', 'their', 'them', 'there',
    'here', 'give', 'giving', 'make', 'made', 'does', 'did', 'be', 'was', 'were', 'been', 'being'
  ];
  const BLOG_CATEGORIES = ['parents', 'pastors', 'kidmin'];
  let postsCache = null;

  function postUrl(post) {
    const slug = encodeURIComponent(post.slug);
    if (post.category === 'free_lessons') return 'free-bible-lessons/' + slug;
    const cat = BLOG_CATEGORIES.indexOf(post.category) !== -1 ? post.category : 'parents';
    return 'blog/' + cat + '/' + slug;
  }

  async function loadPostsCache() {
    if (postsCache) return postsCache;
    if (typeof GK === 'undefined' || !GK.listPublishedPosts) return [];
    try {
      postsCache = await GK.listPublishedPosts();
    } catch (e) {
      postsCache = [];
    }
    return postsCache;
  }

  // Returns { posts: [...], topScore } — topScore lets the caller weigh a
  // strong content match (e.g. "Noah's Ark") against a generic KB answer.
  async function searchSite(text) {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && STOPWORDS.indexOf(w) === -1);
    if (!words.length) return { posts: [], topScore: 0 };
    const posts = await loadPostsCache();
    const scored = posts.map(function (p) {
      const hay = [p.title, p.excerpt, p.scripture, (p.tags || []).join(' ')].join(' ').toLowerCase();
      const score = words.reduce(function (s, w) { return s + (hay.indexOf(w) !== -1 ? 1 : 0); }, 0);
      return { post: p, score: score };
    }).filter(function (x) { return x.score > 0; })
      .sort(function (a, b) { return b.score - a.score; });
    return {
      posts: scored.slice(0, 4).map(function (x) { return x.post; }),
      topScore: scored.length ? scored[0].score : 0
    };
  }

  /* ── Persisted history ────────────────────────────────────── */
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-30))); }

  /* ── Styles ───────────────────────────────────────────────── */
  const css = `
    #gk-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, var(--cta, #22c55e), var(--cta-dark, #16a34a));
      color: white; font-size: 1.6rem; border: none; cursor: pointer;
      box-shadow: 0 8px 24px rgba(34,197,94,0.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s ease;
    }
    #gk-chat-btn:hover { transform: scale(1.08); }
    #gk-chat-btn .gk-chat-badge {
      position: absolute; top: -4px; right: -4px;
      background: var(--coral, #ec4899); color: white;
      font-size: 0.65rem; font-weight: 700; border-radius: 999px;
      width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      border: 2px solid var(--color-bg, #0f172a);
    }
    #gk-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 140px);
      background: var(--color-card, #1a1f3a); border-radius: 20px; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: none; flex-direction: column;
      font-family: 'Inter', sans-serif;
    }
    #gk-chat-panel.open { display: flex; }
    .gk-chat-header {
      background: linear-gradient(135deg, var(--color-darkest, #0a0e27), var(--primary-dark, #1e40af));
      color: white; padding: 1rem 1.15rem;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .gk-chat-header__title { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 0.95rem; }
    .gk-chat-header__sub { font-size: 0.72rem; color: rgba(255,255,255,0.75); margin-top: 0.15rem; }
    .gk-chat-header__close { background: rgba(255,255,255,0.15); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 0.9rem; }
    .gk-chat-body { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem; background: var(--color-bg, #0f172a); }
    .gk-msg { max-width: 82%; padding: 0.6rem 0.85rem; border-radius: 14px; font-size: 0.85rem; line-height: 1.45; }
    .gk-msg a { color: inherit; text-decoration: underline; }
    .gk-msg--bot { align-self: flex-start; background: var(--color-card, #1a1f3a); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.12); border-bottom-left-radius: 4px; }
    .gk-msg--user { align-self: flex-end; background: var(--cta, #22c55e); color: white; border-bottom-right-radius: 4px; }
    .gk-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.15rem; }
    .gk-chip {
      background: var(--color-card, #1a1f3a); border: 1px solid rgba(255,255,255,0.15); color: #cbd5e1;
      font-size: 0.75rem; font-weight: 600; padding: 0.4rem 0.7rem;
      border-radius: 999px; cursor: pointer;
    }
    .gk-chip:hover { background: var(--color-card-hover, #252d4a); }
    .gk-chip--escalate { border-color: var(--coral, #ec4899); color: var(--coral, #ec4899); }
    .gk-typing { align-self: flex-start; display: flex; gap: 3px; padding: 0.7rem 0.9rem; }
    .gk-typing span { width: 6px; height: 6px; border-radius: 50%; background: #64748b; animation: gkTypingBounce 1.2s infinite ease-in-out; }
    .gk-typing span:nth-child(2) { animation-delay: 0.15s; }
    .gk-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes gkTypingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
    .gk-chat-form { padding: 0.85rem; border-top: 1px solid rgba(255,255,255,0.12); background: var(--color-card, #1a1f3a); }
    .gk-chat-form input, .gk-chat-form textarea {
      width: 100%; padding: 0.6rem 0.75rem; border-radius: 10px; border: 1.5px solid rgba(255,255,255,0.15);
      font-size: 0.85rem; font-family: inherit; margin-bottom: 0.5rem;
      background: var(--color-bg, #0f172a); color: #e2e8f0;
    }
    .gk-chat-inputrow { display: flex; gap: 0.5rem; padding: 0.85rem; border-top: 1px solid rgba(255,255,255,0.12); background: var(--color-card, #1a1f3a); flex-shrink: 0; }
    .gk-chat-inputrow input { flex: 1; padding: 0.65rem 0.9rem; border-radius: 999px; border: 1.5px solid rgba(255,255,255,0.15); font-size: 0.85rem; font-family: inherit; background: var(--color-bg, #0f172a); color: #e2e8f0; }
    .gk-chat-inputrow button {
      background: var(--cta, #22c55e); color: white; border: none; border-radius: 50%;
      width: 38px; height: 38px; flex-shrink: 0; cursor: pointer; font-size: 1rem;
    }
    .gk-escalate-btn { width: 100%; background: rgba(249,115,22,0.15); color: #fb923c; border: 1px solid rgba(249,115,22,0.4); font-weight: 700; font-size: 0.78rem; padding: 0.55rem; border-radius: 10px; cursor: pointer; margin-bottom: 0.5rem; }
    .gk-form-actions { display: flex; gap: 0.5rem; }
    .gk-form-actions button { flex: 1; padding: 0.6rem; border-radius: 10px; font-size: 0.82rem; font-weight: 700; border: none; cursor: pointer; }
    .gk-form-actions .gk-submit { background: var(--cta, #22c55e); color: white; }
    .gk-form-actions .gk-cancel { background: var(--color-card-hover, #252d4a); color: #e2e8f0; }
    @media (max-width: 480px) {
      #gk-chat-panel { right: 16px; left: 16px; width: auto; bottom: 88px; }
      #gk-chat-btn { right: 16px; bottom: 16px; }
    }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ── Markup ───────────────────────────────────────────────── */
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <button id="gk-chat-btn" aria-label="Ask Glory Kids">💬<span class="gk-chat-badge" id="gk-chat-badge">1</span></button>
    <div id="gk-chat-panel">
      <div class="gk-chat-header">
        <div>
          <div class="gk-chat-header__title">Ask Glory Kids 👋</div>
          <div class="gk-chat-header__sub">Ask a question or talk to a live agent</div>
        </div>
        <button class="gk-chat-header__close" id="gk-chat-close">✕</button>
      </div>
      <div class="gk-chat-body" id="gk-chat-body"></div>
      <div id="gk-chat-form-slot"></div>
      <div class="gk-chat-inputrow" id="gk-chat-inputrow">
        <input type="text" id="gk-chat-input" placeholder="Type your question..." />
        <button id="gk-chat-send" aria-label="Send">➤</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);

  const panel = document.getElementById('gk-chat-panel');
  const body = document.getElementById('gk-chat-body');
  const input = document.getElementById('gk-chat-input');
  const formSlot = document.getElementById('gk-chat-form-slot');
  const inputRow = document.getElementById('gk-chat-inputrow');
  const badge = document.getElementById('gk-chat-badge');

  function addMessage(role, html, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'gk-msg gk-msg--' + role;
    el.innerHTML = html;
    body.appendChild(el);
    if (opts.chips) {
      const chipsEl = document.createElement('div');
      chipsEl.className = 'gk-chips';
      opts.chips.forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'gk-chip' + (c.escalate ? ' gk-chip--escalate' : '');
        btn.textContent = c.label;
        btn.onclick = () => c.onClick();
        chipsEl.appendChild(btn);
      });
      body.appendChild(chipsEl);
    }
    body.scrollTop = body.scrollHeight;
    if (!opts.skipSave) {
      const history = loadHistory();
      history.push({ role, text: html, time: Date.now() });
      saveHistory(history);
    }
    return el;
  }

  function showTyping(cb) {
    const el = document.createElement('div');
    el.className = 'gk-typing';
    el.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => { el.remove(); cb(); }, 550 + Math.random() * 400);
  }

  function offerEscalation(reason) {
    addMessage('bot', reason, {
      chips: [
        { label: '📧 Email us directly', onClick: () => { window.location.href = 'mailto:' + SUPPORT_EMAIL; } },
        { label: '📝 Leave a message for our team', escalate: true, onClick: showEscalationForm }
      ]
    });
  }

  function showEscalationForm() {
    inputRow.style.display = 'none';
    formSlot.innerHTML = `
      <div class="gk-chat-form">
        <input type="text" id="gk-form-name" placeholder="Your name" />
        <input type="email" id="gk-form-email" placeholder="Your email address" />
        <textarea id="gk-form-message" rows="3" placeholder="What can we help with?"></textarea>
        <div class="gk-form-actions">
          <button class="gk-submit" id="gk-form-submit">Send Message</button>
          <button class="gk-cancel" id="gk-form-cancel">Cancel</button>
        </div>
      </div>
    `;
    document.getElementById('gk-form-cancel').onclick = closeEscalationForm;
    document.getElementById('gk-form-submit').onclick = submitEscalationForm;
  }

  function closeEscalationForm() {
    formSlot.innerHTML = '';
    inputRow.style.display = 'flex';
  }

  function submitEscalationForm() {
    const name = document.getElementById('gk-form-name').value.trim();
    const email = document.getElementById('gk-form-email').value.trim();
    const message = document.getElementById('gk-form-message').value.trim();
    if (!name || !email || !message) {
      alert('Please fill in your name, email, and message so we can get back to you.');
      return;
    }
    const transcript = loadHistory().map(m => ({ role: m.role, text: m.text }));
    if (typeof GK !== 'undefined') {
      GK.addTicket({ name, email, message, transcript });
    }
    closeEscalationForm();
    addMessage('bot', `Thanks, ${name}! 🙏 Your message has been sent to our team — we'll reply to <strong>${email}</strong> within 24 hours.`);
  }

  function respondTo(text) {
    addMessage('user', escapeHtml(text));
    const t = text.toLowerCase();
    if (ESCALATE_KEYWORDS.some(k => t.includes(k))) {
      showTyping(function () { offerEscalation("Sure thing — here's the fastest way to reach our team:"); });
      return;
    }
    const kb = bestKbMatch(text);
    showTyping(function () {
      searchSite(text).then(function (result) {
        // A strong, specific content match (e.g. "Noah's Ark") should win
        // over a generic KB answer like the one for the word "lesson".
        if (result.posts.length && (kb.score === 0 || (result.topScore >= kb.score && result.topScore >= 2))) {
          const list = result.posts.map(function (p) {
            return '<li><a href="' + postUrl(p) + '">' + escapeHtml(p.title) + '</a></li>';
          }).join('');
          addMessage('bot', "Here's what I found in our library:<ul style=\"margin:0.4rem 0 0;padding-left:1.1rem;\">" + list + "</ul>");
        } else if (kb.score > 0) {
          addMessage('bot', kb.entry.answer);
        } else {
          offerEscalation("I couldn't quite find an answer to that in what I know. Want to reach a real person?");
        }
      }).catch(function () {
        if (kb.score > 0) addMessage('bot', kb.entry.answer);
        else offerEscalation("I couldn't quite find an answer to that in what I know. Want to reach a real person?");
      });
    });
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function sendFromInput() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    respondTo(text);
  }

  document.getElementById('gk-chat-send').onclick = sendFromInput;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendFromInput(); });

  let greeted = false;
  function openPanel() {
    panel.classList.add('open');
    badge.style.display = 'none';
    if (!greeted) {
      greeted = true;
      addMessage('bot', "Hi! 👋 I'm Ask Glory Kids. Ask me about free lessons, curriculum, membership pricing, your dashboard, or anything else — and if I can't help, I'll connect you straight to our team.", {
        chips: [
          { label: '💰 Membership pricing', onClick: () => respondTo('membership pricing') },
          { label: '📖 Free lessons', onClick: () => respondTo('free lessons') },
          { label: '🧭 My Dashboard', onClick: () => respondTo('how do I navigate my dashboard') },
          { label: '🔎 Find a lesson', onClick: () => { input.value = ''; input.placeholder = 'e.g. Noah\'s Ark, prayer, forgiveness…'; input.focus(); } },
          { label: '🙋 Talk to a live agent', escalate: true, onClick: () => offerEscalation("Of course! Here's the fastest way to reach our team:") }
        ],
        skipSave: true
      });
    }
  }

  document.getElementById('gk-chat-btn').onclick = openPanel;
  document.getElementById('gk-chat-close').onclick = () => panel.classList.remove('open');
})();
