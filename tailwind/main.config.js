/* Tailwind build for the standard site pages.
   Replaces the old <script src="https://cdn.tailwindcss.com"> play CDN.
   Mirrors the inline config those pages used: preflight + container OFF,
   typography plugin ON (blog pages use `prose`). Default theme otherwise. */
module.exports = {
  content: [
    './index.html',
    './free-lessons.html',
    './comparison.html',
    './church-pricing.html',
    './glory-kids-curriculum.html',
    './blog-post.html',
    './blog-post-template.html',
    './blog-family-devotions.html',
    './blog-kids-engagement.html',
    './blog-kids-ministry-budget.html',
  ],
  corePlugins: { preflight: false, container: false },
  theme: { extend: {} },
  plugins: [require('@tailwindcss/typography')],
};
