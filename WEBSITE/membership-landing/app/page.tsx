"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------------------------------------------------------------------------
// CUSTOMIZE HERE: swap copy, prices, spot counts, and links in these consts.
// ---------------------------------------------------------------------------
const BRAND = {
  name: "Glory Kids Ministries",
  price: "$19.99",
  priceAfter: "$29.99",
  spots: 50,
  ctaLabel: "Join the Membership",
};

const FEATURES = [
  {
    icon: "📚",
    title: "New Premium Lessons Every Month",
    body: "Complete Bible lessons with teaching, object lessons, games, crafts, small group questions, prayer ministry, and worship suggestions. Everything you need—zero prep time.",
  },
  {
    icon: "👨‍👩‍👧‍👦",
    title: "Parent & Family Resources",
    body: "Family devotionals, parent handouts, prayer guides, and conversation starters. Disciple kids at home, not just at church or school.",
  },
  {
    icon: "🎥",
    title: "Training Library",
    body: "Expert training for leaders covering teaching effectively, classroom management, discipleship, and Holy Spirit ministry with children.",
  },
  {
    icon: "💬",
    title: "Members-Only Community",
    body: "Connect with other leaders, parents, and families. Share ideas, ask questions, and build together.",
  },
  {
    icon: "🎁",
    title: "200+ Resource Vault",
    body: "Instant access to curriculum, games, crafts, coloring pages, seasonal resources, and everything we've built. Growing every month.",
  },
  {
    icon: "🚀",
    title: "Early Access",
    body: "Members receive new curriculum and products before everyone else. Be first to launch new series in your church or classroom.",
  },
];

const ROADMAP = [
  {
    quarter: "Q1",
    series: [
      { name: "Fruits of the Spirit", weeks: 9 },
      { name: "Made for More", weeks: 5 },
    ],
  },
  {
    quarter: "Q2",
    series: [
      { name: "The Life of Jesus", weeks: 8 },
      { name: "Encounters with Jesus", weeks: 5 },
    ],
  },
  {
    quarter: "Q3",
    series: [
      { name: "Character Builders", weeks: 5 },
      { name: "Heroes of Faith", weeks: 8 },
      { name: "Brave & Unshakeable", weeks: 4 },
    ],
  },
  {
    quarter: "Q4",
    series: [
      { name: "Kids Who Pray", weeks: 3 },
      { name: "A Grateful Heart", weeks: 4 },
      { name: "Wildly Loved", weeks: 4 },
    ],
  },
  {
    quarter: "Bonus",
    series: [
      { name: "Unshakeable Faith Heroes", weeks: 5 },
      { name: "Grow in the Spirit", weeks: 3 },
    ],
  },
];

const TESTIMONIALS = [
  {
    quote:
      "I used to spend 6–7 hours every week planning lessons from scratch. Now I grab what I need from the Glory Kids vault and spend that time actually discipling kids instead of searching Pinterest. Worth every penny.",
    name: "Sarah M.",
    role: "Children's Ministry Director, Texas",
  },
  {
    quote:
      "The lessons are biblically rich AND age-appropriate. My kids actually engage with the crafts and discussion questions. For $30/month, I have a complete faith-building curriculum I don't have to create myself.",
    name: "Jennifer K.",
    role: "Homeschool Mom, Florida",
  },
  {
    quote:
      "I volunteer on Sundays and wasn't trained as a teacher. The training library and ready-to-go lessons gave me the confidence to lead well. Plus, the community helped me realize I'm not alone in this.",
    name: "Marcus T.",
    role: "Volunteer Leader, Georgia",
  },
];

const PRICING_ITEMS = [
  "New premium lessons every month",
  "200+ resource vault",
  "Parent & family resources",
  "Training library for leaders",
  "Members-only community",
  "Live webinars & Q&A",
  "Monthly bonus resources",
  "Early access to new products",
  "10% member discounts",
  "Cancel anytime",
];

const FAQS = [
  {
    q: "Who is this membership for?",
    a: "It's built for children's ministry leaders, Sunday school teachers, volunteers, and parents who want biblically rich, age-appropriate resources without spending hours creating lessons from scratch.",
  },
  {
    q: "Do I get new content every month?",
    a: "Yes. Every month you'll receive a new, complete Bible lesson series, plus fresh parent resources, training material, and bonus content added to your vault.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Absolutely. No contracts, no hidden fees. Cancel your membership whenever you'd like, right from your account.",
  },
  {
    q: "What if I don't love it?",
    a: "We offer a 30-day money-back guarantee. If it's not the right fit, just reach out and we'll refund you, no questions asked.",
  },
  {
    q: "Is this just curriculum or is there community?",
    a: "It's both. You get complete lessons plus access to a private community of leaders and families to share ideas, ask questions, and grow together.",
  },
];

// ---------------------------------------------------------------------------

function CTAButton({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "px-5 py-2.5 text-sm",
    md: "px-7 py-3.5 text-base",
    lg: "px-10 py-5 text-lg md:text-xl",
  }[size];

  return (
    <motion.a
      href="#pricing"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      className={`inline-block rounded-lg bg-[#F5A623] font-oswald font-semibold uppercase tracking-wide text-white shadow-md transition-shadow hover:shadow-lg ${sizeClasses} ${className}`}
    >
      {BRAND.ctaLabel}
    </motion.a>
  );
}

function SectionHeading({
  eyebrow,
  title,
  className = "",
}: {
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={`mx-auto max-w-2xl text-center ${className}`}>
      {eyebrow && (
        <p className="mb-2 font-nunito text-sm font-bold uppercase tracking-widest text-[#F26522]">
          {eyebrow}
        </p>
      )}
      <h2 className="font-oswald text-3xl font-bold text-[#1A2B3C] sm:text-4xl">
        {title}
      </h2>
    </div>
  );
}

export default function MembershipLandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <main className="min-h-screen bg-white font-nunito text-[#1A2B3C] antialiased">
      {/* ------------------------------------------------------------------ */}
      {/* HEADER — logo + single CTA, no navigation */}
      {/* ------------------------------------------------------------------ */}
      <header className="fixed top-0 z-50 w-full border-b border-black/5 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="font-oswald text-xl font-bold tracking-wide text-[#1A7FBF]">
            {BRAND.name}
          </span>
          <CTAButton size="sm" />
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* HERO */}
      {/* ------------------------------------------------------------------ */}
      <section
        className="relative flex min-h-screen items-center justify-center overflow-hidden pt-24"
        style={{
          background:
            "linear-gradient(160deg, #1A7FBF 0%, #175f91 45%, #F5A623 130%)",
        }}
      >
        <div className="absolute inset-0 bg-black/25" aria-hidden="true" />
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="relative z-10 mx-auto max-w-3xl px-6 text-center"
        >
          <h1 className="font-oswald text-4xl font-bold leading-tight text-white sm:text-5xl md:text-6xl">
            Never plan another children&apos;s Bible lesson from scratch.
          </h1>
          <p className="mx-auto mt-6 max-w-xl font-nunito text-lg text-white/90 sm:text-xl">
            Access 200+ done-for-you lessons, trainings, and resources—all in
            one growing vault. New curriculum every month. Cancel anytime.
          </p>
          <div className="mt-10 flex justify-center">
            <CTAButton size="lg" />
          </div>
          <p className="mt-5 font-nunito text-sm font-semibold text-[#F5A623]">
            Founding members lock in {BRAND.price}/month for life. Only{" "}
            {BRAND.spots} spots.
          </p>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* WHAT'S INCLUDED */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeading
          eyebrow="Everything Included"
          title="One membership. Everything you need."
          className="mb-14"
        />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.5, delay: i * 0.08 }}
              className="rounded-xl border border-[#1A7FBF]/10 bg-[#1A7FBF]/5 p-6"
            >
              <div className="text-3xl">{feature.icon}</div>
              <h3 className="mt-4 font-oswald text-lg font-bold text-[#1A2B3C]">
                {feature.title}
              </h3>
              <p className="mt-2 font-nunito text-sm leading-relaxed text-[#1A2B3C]/75">
                {feature.body}
              </p>
              <div className="mt-4 h-1 w-10 rounded-full bg-[#F26522]" />
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CURRICULUM ROADMAP */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-[#F7F9FB] py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            eyebrow="The Vault"
            title="Your first year: A journey through Scripture"
            className="mb-14"
          />
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {ROADMAP.map((block, i) => (
              <motion.div
                key={block.quarter}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-xl border border-[#1A7FBF]/10 bg-[#1A7FBF]/5 p-6"
              >
                <span className="font-oswald text-xs font-bold uppercase tracking-widest text-[#F26522]">
                  {block.quarter}
                </span>
                <ul className="mt-3 space-y-3">
                  {block.series.map((s) => (
                    <li key={s.name} className="flex items-baseline justify-between gap-3">
                      <span className="font-oswald text-base font-semibold text-[#1A2B3C]">
                        {s.name}
                      </span>
                      <span className="whitespace-nowrap font-nunito text-xs font-bold text-[#1A7FBF]">
                        {s.weeks} weeks
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5 }}
            className="mt-8 rounded-xl bg-[#F5A623] p-8 text-center"
          >
            <p className="font-oswald text-xl font-bold text-white">
              12 complete curriculum series — 60+ lessons
            </p>
            <p className="mx-auto mt-2 max-w-2xl font-nunito text-white/95">
              Covering Spirit-led discipleship, Bible stories, character
              building, and faith encounters. All included in your monthly
              membership from day one.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* TESTIMONIALS */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <SectionHeading
          eyebrow="Real Ministry Leaders"
          title="Here's what ministry leaders say"
          className="mb-14"
        />
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t, i) => (
            <motion.div
              key={t.name}
              initial={{ opacity: 0, x: i % 2 === 0 ? -24 : 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="rounded-xl border-l-4 border-[#F5A623] bg-white p-6 shadow-sm"
            >
              <div className="mb-3 text-[#F5A623]" aria-label="5 out of 5 stars">
                {"★★★★★"}
              </div>
              <p className="font-lora text-base italic leading-relaxed text-[#1A2B3C]/85">
                &ldquo;{t.quote}&rdquo;
              </p>
              <p className="mt-4 font-oswald text-sm font-bold text-[#1A2B3C]">
                {t.name}
              </p>
              <p className="font-nunito text-xs text-[#1A2B3C]/60">{t.role}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* PRICING */}
      {/* ------------------------------------------------------------------ */}
      <section id="pricing" className="bg-[#F7F9FB] py-24">
        <div className="mx-auto max-w-3xl px-6">
          <SectionHeading eyebrow="Limited Founding Spots" title="Founding Member Pricing" />

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.6 }}
            className="mt-12 rounded-2xl bg-[#1A7FBF] p-8 text-center shadow-lg sm:p-12"
          >
            <p className="font-oswald text-6xl font-bold text-[#F5A623] sm:text-7xl">
              {BRAND.price}
              <span className="text-2xl font-semibold text-white/80 sm:text-3xl">
                /month
              </span>
            </p>
            <p className="mt-3 font-nunito text-lg font-semibold text-white">
              Lock in lifetime pricing—only {BRAND.spots} spots available
            </p>
            <p className="mt-1 font-nunito text-sm text-white/75">
              Price increases to {BRAND.priceAfter}/month after founding
              member spots fill
            </p>

            <ul className="mx-auto mt-8 grid max-w-md grid-cols-1 gap-3 text-left sm:grid-cols-2">
              {PRICING_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2 font-nunito text-sm text-white">
                  <span className="mt-0.5 text-[#F5A623]">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex justify-center">
              <motion.a
                href="#join"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="inline-block rounded-lg bg-[#F5A623] px-10 py-5 font-oswald text-lg font-bold uppercase tracking-wide text-white shadow-md hover:shadow-lg sm:text-xl"
              >
                {BRAND.ctaLabel} — {BRAND.price}/month
              </motion.a>
            </div>
            <p className="mt-4 font-nunito text-xs text-white/70">
              Cancel anytime. No contracts. 30-day money-back guarantee.
            </p>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* FAQ */}
      {/* ------------------------------------------------------------------ */}
      <section className="mx-auto max-w-3xl px-6 py-24">
        <SectionHeading eyebrow="Questions" title="Common Questions" className="mb-12" />
        <div className="space-y-3">
          {FAQS.map((faq, i) => {
            const isOpen = openFaq === i;
            return (
              <div
                key={faq.q}
                className={`overflow-hidden rounded-lg border transition-colors ${
                  isOpen ? "border-[#1A7FBF]" : "border-black/10"
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${i}`}
                  onClick={() => setOpenFaq(isOpen ? null : i)}
                  className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-oswald font-semibold transition-colors ${
                    isOpen ? "bg-[#1A7FBF]/10 text-[#1A7FBF]" : "text-[#1A2B3C]"
                  }`}
                >
                  <span>{faq.q}</span>
                  <motion.span
                    animate={{ rotate: isOpen ? 45 : 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-xl leading-none"
                    aria-hidden="true"
                  >
                    +
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-panel-${i}`}
                      role="region"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <p className="px-5 pb-5 font-nunito text-sm leading-relaxed text-[#1A2B3C]/75">
                        {faq.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* CLOSING CTA */}
      {/* ------------------------------------------------------------------ */}
      <section
        id="join"
        className="bg-[#F26522] py-24 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6 }}
          className="mx-auto max-w-2xl px-6"
        >
          <h2 className="font-oswald text-3xl font-bold text-white sm:text-4xl">
            Start your membership today
          </h2>
          <p className="mt-4 font-nunito text-lg text-white/90">
            Join {BRAND.spots} founding members. Lock in {BRAND.price}/month
            for life. New content every month. Cancel anytime.
          </p>
          <div className="mt-8 flex justify-center">
            <motion.a
              href="#pricing"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-block rounded-lg bg-white px-10 py-5 font-oswald text-lg font-bold uppercase tracking-wide text-[#F26522] shadow-md hover:shadow-lg sm:text-xl"
            >
              {BRAND.ctaLabel}
            </motion.a>
          </div>
          <p className="mt-5 font-nunito text-sm text-white/80">
            30-day money-back guarantee. Founding member pricing closes when{" "}
            {BRAND.spots} spots fill.
          </p>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* FOOTER — minimal, no navigation */}
      {/* ------------------------------------------------------------------ */}
      <footer className="bg-[#1A2B3C] py-8 text-center">
        <p className="font-nunito text-sm text-white/70">
          © {new Date().getFullYear()} {BRAND.name}
        </p>
      </footer>
    </main>
  );
}
