import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('jssip')) return 'vendor-jssip';
          if (id.includes('axios')) return 'vendor-axios';
          return 'vendor';
        },
      },
    },
  },
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
      '/access': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/visitor-assets': {
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
