import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  if (process.env.VERCEL_ENV === 'production') {
    const { VITE_API_URL } = loadEnv(mode, process.cwd(), 'VITE_')
    const url = URL.canParse(VITE_API_URL) ? new URL(VITE_API_URL) : null
    if (!url || url.protocol !== 'https:' || !['/api', '/api/'].includes(url.pathname)
        || url.username || url.password || url.search || url.hash) {
      throw new Error('Set VITE_API_URL to your HTTPS backend URL ending in /api in Vercel.')
    }
  }

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
