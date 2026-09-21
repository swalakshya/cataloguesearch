/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // Tailwind's default `font-sans` is the system stack, which was masking the
      // Noto Sans set on <body> (the app root uses `font-sans`). Point it at Noto
      // so every `font-sans` element gets the intended face.
      fontFamily: {
        sans: ["'Noto Sans'", "'Noto Sans Devanagari'", "'Noto Sans Gujarati'", 'sans-serif'],
      },
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
        ink: {
          DEFAULT: 'var(--color-ink)',
          muted: 'var(--color-ink-muted)',
        },
        brand: {
          DEFAULT: 'var(--color-brand)',
          hover: 'var(--color-brand-hover)',
        },
        'on-brand': 'var(--color-on-brand)',
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        danger: 'var(--color-danger)',
        info: 'var(--color-info)',
      },
    },
  },
  plugins: [],
}
