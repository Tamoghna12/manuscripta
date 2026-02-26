import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@codemirror') || id.includes('codemirror') || id.includes('@lezer')) return 'vendor-codemirror';
            if (id.includes('pdfjs-dist')) return 'vendor-pdf';
            if (id.includes('yjs') || id.includes('y-protocols') || id.includes('y-codemirror')) return 'vendor-yjs';
            if (id.includes('react-dom')) return 'vendor-react';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
        xfwd: true
      },
      '/texlive': {
        target: 'https://texlive.swiftlatex.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/texlive/, '')
      }
    }
  }
});
