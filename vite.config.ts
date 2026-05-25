import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const TUNNEL_ALLOWED_HOSTS = ['.loca.lt', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'] as const;

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
  },
} as const;

export default defineConfig(() => ({
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: [...TUNNEL_ALLOWED_HOSTS],
    proxy: apiProxy,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: [...TUNNEL_ALLOWED_HOSTS],
    proxy: apiProxy,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) {
            return 'recharts';
          }
          if (
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react/') ||
            id.includes('node_modules/scheduler')
          ) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/papaparse')) {
            return 'papaparse';
          }
        },
      },
    },
  },
}));
