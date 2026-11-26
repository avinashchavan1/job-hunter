import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The website reuses the desktop app's screens (src/renderer) and shared types (src/shared).
export default defineConfig({
  root: import.meta.dirname,
  publicDir: resolve(import.meta.dirname, 'public'),
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, '../src/renderer/src'),
      '@shared': resolve(import.meta.dirname, '../src/shared'),
      '@web': resolve(import.meta.dirname, 'src')
    }
  },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    // public landing page at /, the private app at /app
    rollupOptions: { input: { home: resolve(import.meta.dirname, 'index.html'), app: resolve(import.meta.dirname, 'app/index.html') } }
  },
  server: { port: 5199 }
})
