import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Two pages: the story site (index.html) and v2, the PPF film played by scrolling (v2.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        v2: fileURLToPath(new URL('./v2.html', import.meta.url)),
      },
    },
  },
});
