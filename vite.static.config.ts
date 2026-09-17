import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';

// Browser-only entry avoids the Vinext prerender shutdown crash on Windows.
// The same application and model code is used for development and deployment.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: {
    port: 5180,
    open: true,
  },
  build: { outDir: 'dist/client' },
});

