import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'admin',
  base: '/admin/',
  build: {
    outDir: '../dist/admin',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'admin/index.html'),
    },
  },
  server: {
    port: 5173,
  },
});
