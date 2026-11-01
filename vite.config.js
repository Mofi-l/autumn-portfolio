import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Relative base so the build works under any deploy path (GitHub Pages
// sub-path, custom domain, or root) without changes.
// Pages: the portfolio, the Knight Lab viewer, and the rig editor.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        lab: fileURLToPath(new URL('./lab/index.html', import.meta.url)),
        editor: fileURLToPath(new URL('./lab/editor/index.html', import.meta.url)),
      },
    },
  },
})
