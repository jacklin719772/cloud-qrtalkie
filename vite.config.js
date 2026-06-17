import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        timeout: 120000,
      },
      '/payment-method-icons': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ecard-images': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/callcenter': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/call-center-images': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/payment-proofs': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      }
    }
  }
});
