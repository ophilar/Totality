/* eslint-disable no-undef */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
    ...(typeof process !== 'undefined' && process.env.NODE_ENV === 'production' ? { cssnano: { preset: 'default' } } : {}),
  },
}
