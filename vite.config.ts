import { defineConfig } from 'vite';

// Relative base so the build works from any sub-path (e.g. GitHub Pages).
export default defineConfig({
  base: "./",
  // The 3D viewer (Three.js) and the splat renderer (Spark) are separate chunks, loaded only when needed.
  build: { chunkSizeWarningLimit: 3000 },
});
