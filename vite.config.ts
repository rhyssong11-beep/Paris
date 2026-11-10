import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: "./",
  // The 3D viewer (Three.js) is a separate chunk loaded only when a landmark is opened.
  build: { chunkSizeWarningLimit: 900 },
});
