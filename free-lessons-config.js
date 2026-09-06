/* ═══════════════════════════════════════════════════════════════
   GLORY KIDS — FREE LESSON ACCESS LIST
   ═══════════════════════════════════════════════════════════════
   The real source of truth is the "Include in the 10 Free Lessons"
   checkbox on each post in the admin panel (post.isFreeLesson).
   free-lessons.html and blog-post.html both read that flag directly
   and update live — you do NOT need to touch this file when you
   change the free 10.

   This list is only a fallback for the legacy static lesson pages
   under free-bible-lessons/[slug]/ (via lesson-gate.js). Keep it in
   rough sync if you still use those pages.
   ═══════════════════════════════════════════════════════════════ */
window.GK_FREE_LESSON_SLUGS = [
  "the-prodigal-son-teaching-kids-forgiveness-homecoming-kids-bible-lesson",
  "armor-of-god-teaching-kids-spiritual-strength-kids-bible-lesson",
  "free-paul-and-silas-in-prison-bible-lesson-for-kids-acts",
  "jonah-and-the-whale-teaching-kids-obedience-and-gods-mercy-kids-bible-lesson",
  "jesus-feeds-the-5000-a-miracle-of-gods-provision-kids-bible-lesson",
  "jesus-calms-the-storm-teaching-kids-gods-peace-kids-bible-lesson",
  "the-fruit-of-the-spirit-bible-lesson-for-kids",
  "you-are-gods-masterpiece-identity-purpose-kids-bible-lesson-ephesians-210",
  "david-goliath-teaching-kids-courage-and-faith-kids-bible-lesson",
  "resurrection-jesus-is-alive-kids-bible-lesson"
];
