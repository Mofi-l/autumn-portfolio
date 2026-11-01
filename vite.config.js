import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Relative base so the build works under any deploy path (GitHub Pages
// sub-path, custom domain, or root) without changes.
export default defineConfig({
  base: './',
  plugins: [react()],
})
