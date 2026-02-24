import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const useHttps = process.env.VITE_HTTPS === 'true'

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  server: {
    host: '0.0.0.0',
    port: 1173,
    ...(useHttps ? { https: true } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:1273',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:1273',
        ws: true,
      },
    },
  },
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
  },
})
