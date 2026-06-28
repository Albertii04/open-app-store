import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base: './' so the built deck loads over file:// inside the shell's
// WebContentsView (assets resolved relative to index.html, not site root).
// https://vite.dev/config/
// Reference material the AI editor reads in place lives outside the project
// tree (userData/imports). But if a stray copy ever lands inside a deck (e.g.
// `presentations/<id>/source/`), keep Vite from watching/scanning it — those
// trees carry node_modules, .git and build output and would tank dev/HMR.
// Deck discovery globs only `presentations/*/index.ts` (direct children), so
// ignoring nested folders here never hides a real slide.
const REFERENCE_IGNORE = '**/src/presentations/**/source/**'

export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    watch: { ignored: [REFERENCE_IGNORE] },
  },
})
