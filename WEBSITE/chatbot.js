/* ============================================================
   GLORY KIDS — AI SUPPORT CHATBOT (local, no external API)
   ============================================================
   Self-contained floating widget: injects its own CSS + markup,
   answers common questions from a local knowledge base, and lets
   visitors escalate to a live person (email or a message that
   lands in the admin Support inbox) when it can't help.
   ============================================================ */

(function () {
  const SUPPORT_EMAIL = 'hello@childrensministrylessons.com';
  const HISTORY_KEY = 'gk_chat_history';

  /* ── Knowledge base ───────────────────────────────────────── */
  const KB = [
    {
      keywords: ['free', 'lesson', 'lessons', 'trial'],
      answer: "We have 50+ free Bible lessons available right now — no credit card needed! Head to the <a href=\"free-lessons.html\">Free Lessons</a> page to browse them by age group and topic."
    },
    {
      keywords: ['curriculum', 'pack', 'packs', 'series'],
      answer: "Our Curriculum Packs are multi-week teaching series for churches and homeschools. Check out <a href=\"curriculum-packs.html\">Curriculum Packs</a> for the full lineup, or <a href=\"glory-kids-curriculum.html\">Glory Kids Curriculum</a> for our premium member-only series."
    },
    {
      keywords: ['price', 'pricing', 'cost', 'how much', 'membership', 'glory kids', 'subscription'],
      answer: "Glory Kids Membership is just <strong>$29.99/month</strong> and unlocks 500+ lessons, 10+ curriculum series, 300+ activity sheets, and new content every week. You can see everything included on the <a href=\"glory-kids-membership.html\">Membership page</a>."
    },
    {
      keywords: ['cancel', 'pause', 'downgrade', 'unsubscribe'],
      answer: "You can pause or cancel your Glory Kids membership any time from your <a href=\"dashboard.html\">Dashboard → Profile</a>, or just ask here and I can connect you with our team to handle it for you — no long-term contracts, ever."
    },
    {
      keywords: ['refund', 'money back', 'charge', 'billing'],
      answer: "If something doesn't look right with a charge, we're happy to help — please use the \"Talk to a live agent\" option below and our team will sort it out within 24 hours."
    },
    {
      keywords: ['activity', 'activities', 'craft', 'coloring', 'printable', 'worksheet'],
      answer: "You'll find printable crafts, coloring pages, and games on our <a href=\"activities.html\">Activities & Resources</a> page — 30+ are free, with 300+ available to Glory Kids members."
    },
    {
      keywords: ['blog', 'article', 'articles', 'tips'],
      answer: "Our <a href=\"blog.html\">Blog</a> has articles for parents, pastors, and kidmin leaders — practical tips on everything from prayer to volunteer recruitment."
    },
    {
      keywords: ['shop', 'store', 'buy', 'merch', 'product'],
      answer: "Check out our <a href=\"shop.html\">Shop</a> for printed curriculum, books, and ministry resources you can purchase directly."
    },
    {
      keywords: ['account', 'login', 'log in', 'sign in', 'password', 'signup', 'sign up', 'register'],
      answer: "You can create a free account on our <a href=\"signup.html\">Sign Up</a> page, or sign in at <a href=\"login.html\">Login</a>. Forgot your password? Use the <a href=\"forgot-password.html\">reset link</a> there."
    },
    {
      keywords: ['age', 'ages', 'grade', 'toddler', 'kids', 'children', 'age group'],
      answer: "Our lessons and curriculum are designed for kids roughly ages 4–12, with most series noting a specific age range so you can pick what fits your group."
    },
    {
      keywords: ['church', 'volunteer', 'kidmin', 'sunday school', 'vbs'],
      answer: "We're built for churches and kidmin teams — many of our curriculum packs are VBS- and Sunday-school-ready, and our blog has articles specifically on recruiting and equipping volunteers."
    },
    {
      keywords: ['contact', 'support', 'help', 'reach', 'email', 'phone'],
      answer: "You can reach our team any time at <a href=\"mailto:" + SUPPORT_EMAIL + "\">" + SUPPORT_EMAIL + "</a>, through our <a href=\"contact.html\">Contact page</a>, or just leave a message right here and we'll get back to you within 24 hours."
    },
    {
      keywords: ['delete', 'remove account', 'privacy', 'data'],
      answer: "You can delete your account any time from your <a href=\"dashboard.html\">Dashboard → Profile → Danger Zone</a>. This permanently removes your data. Need help with anything privacy-related? Let us know below."
    }
  ];

  const ESCALATE_KEYWORDS = ['agent', 'human', 'person', 'someone', 'representative', 'talk to you', 'jandre', 'real person', 'live chat', 'speak to'];

  function findAnswer(text) {
    const t = text.toLowerCase();
    if (ESCALATE_KEYWORDS.some(k => t.includes(k))) return null;
    let best = null, bestScore = 0;
    KB.forEach(entry => {
      const score = entry.keywords.reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = entry; }
    });
    return bestScore > 0 ? best.answer : undefined; // undefined = no match, null = explicit escalate
  }

  /* ── Persisted history ────────────────────────────────────── */
  function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; } }
  function saveHistory(list) { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-30))); }

  /* ── Styles ───────────────────────────────────────────────── */
  const css = `
    #gk-chat-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, var(--primary, #1A7FBF), var(--primary-dark, #0F5A8A));
      color: white; font-size: 1.6rem; border: none; cursor: pointer;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.2s ease;
    }
    #gk-chat-btn:hover { transform: scale(1.08); }
    #gk-chat-btn .gk-chat-badge {
      position: absolute; top: -4px; right: -4px;
      background: var(--coral, #F26522); color: white;
      font-size: 0.65rem; font-weight: 700; border-radius: 999px;
      width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      border: 2px solid white;
    }
    #gk-chat-panel {
      position: fixed; bottom: 96px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 140px);
      background: white; border-radius: 20px; overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25);
      display: none; flex-direction: column;
      font-family: 'Inter', sans-serif;
    }
    #gk-chat-panel.open { display: flex; }
    .gk-chat-header {
      background: linear-gradient(135deg, var(--primary-dark, #0F5A8A), var(--primary, #1A7FBF));
      color: white; padding: 1rem 1.15rem;
      display: flex; align-items: center; justify-content: space-between;
      flex-shrink: 0;
    }
    .gk-chat-header__title { font-family: 'Poppins', sans-serif; font-weight: 800; font-size: 0.95rem; }
    .gk-chat-header__sub { font-size: 0.72rem; color: rgba(255,255,255,0.75); margin-top: 0.15rem; }
    .gk-chat-header__close { background: rgba(255,255,255,0.15); border: none; color: white; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 0.9rem; }
    .gk-chat-body { flex: 1; overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem; background: #F9FAFB; }
    .gk-msg { max-width: 82%; padding: 0.6rem 0.85rem; border-radius: 14px; font-size: 0.85rem; line-height: 1.45; }
    .gk-msg a { color: inherit; text-decoration: underline; }
    .gk-msg--bot { align-self: flex-start; background: white; color: #1E1B4B; border: 1px solid #E5E7EB; border-bottom-left-radius: 4px; }
    .gk-msg--user { align-self: flex-end; background: var(--primary, #1A7FBF); color: white; border-bottom-right-radius: 4px; }
    .gk-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.15rem; }
    .gk-chip {
      background: white; border: 1px solid #D1D5DB; color: #374151;
      font-size: 0.75rem; font-weight: 600; padding: 0.4rem 0.7rem;
      border-radius: 999px; cursor: pointer;
    }
    .gk-chip:hover { background: #F3F4F6; }
    .gk-chip--escalate { border-color: var(--coral, #F26522); color: var(--coral, #F26522); }
    .gk-typing { align-self: flex-start; display: flex; gap: 3px; padding: 0.7rem 0.9rem; }
    .gk-typing span { width: 6px; height: 6px; border-radius: 50%; background: #9CA3AF; animation: gkTypingBounce 1.2s infinite ease-in-out; }
    .gk-typing span:nth-child(2) { animation-delay: 0.15s; }
    .gk-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes gkTypingBounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-4px); opacity: 1; } }
    .gk-chat-form { padding: 0.85rem; border-top: 1px solid #E5E7EB; background: white; }
    .gk-chat-form input, .gk-chat-form textarea {
      width: 100%; padding: 0.6rem 0.75rem; border-radius: 10px; border: 1.5px solid #E5E7EB;
      font-size: 0.85rem; font-family: inherit; margin-bottom: 0.5rem;
    }
    .gk-chat-inputrow { display: flex; gap: 0.5rem; padding: 0.85rem; border-top: 1px solid #E5E7EB; background: white; flex-shrink: 0; }
    .gk-chat-inputrow input { flex: 1; padding: 0.65rem 0.9rem; border-radius: 999px; border: 1.5px solid #E5E7EB; font-size: 0.85rem; font-family: inherit; }
    .gk-chat-inputrow button {
      background: var(--primary, #1A7FBF); color: white; border: none; border-radius: 50%;
      width: 38px; height: 38px; flex-shrink: 0; cursor: pointer; font-size: 1rem;
    }
    .gk-escalate-btn { width: 100%; background: #FFF7ED; color: var(--coral-dark, #C4441A); border: 1px solid #FED7AA; font-weight: 700; font-size: 0.78rem; padding: 0.55rem; border-radius: 10px; cursor: pointer; margin-bottom: 0.5rem; }
    .gk-form-actions { display: flex; gap: 0.5rem; }
    .gk-form-actions button { flex: 1; padding: 0.6rem; border-radius: 10px; font-size: 0.82rem; font-weight: 700; border: none; cursor: pointer; }
    .gk-form-actions .gk-submit { background: var(--primary, #1A7FBF); color: white; }
    .gk-form-actions .gk-cancel { background: #F3F4F6; color: #374151; }
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
    <button id="gk-chat-btn" aria-label="Chat with us">💬<span class="gk-chat-badge" id="gk-chat-badge">1</span></button>
    <div id="gk-chat-panel">
      <div class="gk-chat-header">
        <div>
          <div class="gk-chat-header__title">✝️ Ministry Support</div>
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
    showTyping(() => {
      const answer = findAnswer(text);
      if (answer === undefined) {
        offerEscalation("I couldn't quite find an answer to that in what I know. Want to reach a real person?");
      } else if (answer === null) {
        offerEscalation("Sure thing — here's the fastest way to reach our team:");
      } else {
        addMessage('bot', answer);
      }
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
      addMessage('bot', "Hi! 👋 I'm the Children's Ministry Lessons assistant. Ask me about free lessons, curriculum, membership pricing, or anything else — and if I can't help, I'll connect you straight to our team.", {
        chips: [
          { label: '💰 Membership pricing', onClick: () => respondTo('membership pricing') },
          { label: '📖 Free lessons', onClick: () => respondTo('free lessons') },
          { label: '🙋 Talk to a live agent', escalate: true, onClick: () => offerEscalation("Of course! Here's the fastest way to reach our team:") }
        ],
        skipSave: true
      });
    }
  }

  document.getElementById('gk-chat-btn').onclick = openPanel;
  document.getElementById('gk-chat-close').onclick = () => panel.classList.remove('open');
})();
