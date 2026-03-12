import { defineConfig } from 'vite'

export default defineConfig({
  base: '/unitcircle/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: true,
  },
})
