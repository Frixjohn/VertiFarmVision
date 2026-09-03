import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // All /api/* requests → Express on port 3001
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // WebSocket upgrade
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
})
