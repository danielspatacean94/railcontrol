/** @type {import('tailwindcss').Config} */
module.exports = {
  // Absolute paths (not relative './...' globs): Tailwind resolves `content`
  // relative to process.cwd(), but this build runs via
  // `vite build --config ui/vite.config.ts` from the repo root, so relative
  // globs would silently match nothing and ship only the base reset.
  content: [
    `${__dirname}/index.html`.replace(/\\/g, '/'),
    `${__dirname}/src/**/*.{js,ts,jsx,tsx}`.replace(/\\/g, '/'),
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          900: '#091e3a',
          800: '#0d2b4e',
          700: '#163d6a',
          600: '#1e5080',
          500: '#2563a8',
        },
        accent: {
          600: '#a87a10',
          500: '#c8981a',
          400: '#e0ad2a',
          300: '#f0c252',
        },
      },
      keyframes: {
        'banner-shimmer': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
      },
      animation: {
        'banner-shimmer': 'banner-shimmer 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
