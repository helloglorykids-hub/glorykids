/* Tailwind build for glory-kids-membership-preview.html only.
   That page shipped its own extended theme (custom fonts + colours) and,
   unlike the other pages, did NOT disable preflight — so we keep preflight
   here to preserve the exact rendering it was authored against. */
module.exports = {
  content: ['./glory-kids-membership-preview.html'],
  corePlugins: { container: false },
  theme: {
    extend: {
      fontFamily: {
        oswald: ['Oswald', 'sans-serif'],
        nunito: ['Nunito', 'sans-serif'],
        lora: ['Lora', 'serif'],
      },
      colors: {
        heaven: '#1A7FBF',
        gold: '#FFB000',
        coral: '#FF4B32',
        ink: '#1A2B3C',
      },
    },
  },
  plugins: [],
};
