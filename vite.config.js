import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Pages: the story site (index.html), v2 (the Blender PPF film played by scrolling) and v3 (laptop → plotter → car).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        v2: fileURLToPath(new URL('./v2.html', import.meta.url)),
        v3: fileURLToPath(new URL('./v3.html', import.meta.url)),
      },
    },
  },
});
