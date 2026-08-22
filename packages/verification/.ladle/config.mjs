/** Ladle's own settings. The story tree comes from the paths under `src/`. */
export default {
  stories: 'src/**/*.stories.{ts,tsx}',
  defaultStory: 'verification--cell-types--text',
  addons: {
    a11y: { enabled: true },
    theme: { enabled: true, defaultState: 'light' },
    rtl: { enabled: true },
    width: { enabled: true },
  },
};
