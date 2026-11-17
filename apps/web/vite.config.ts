import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    basicSsl(),
  ],
  server: {
    host: true, // Libera acesso por 0.0.0.0 (rede local / celular)
    port: 5173,
    watch: {
      ignored: [
        '**/data/**',
        '**/*.sqlite*',
        '**/*.sqlite-wal',
        '**/*.sqlite-shm',
        '**/*.sqlite-journal',
        '**/apps/agent/**',
        '**/.git/**',
        '**/*.log',
      ],
    },
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
