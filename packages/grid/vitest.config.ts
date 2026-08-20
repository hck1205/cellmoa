import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The grid is a DOM component, so the tests run against a real DOM rather
    // than a mock of one: a renderer that only works against a fake is not a
    // renderer.
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
