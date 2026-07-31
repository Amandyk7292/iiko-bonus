import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  base: '/admin/',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/lib/i18n')) return 'i18n';
          if (id.includes('/lucide-react/')) return 'icons';
        },
      },
    },
  },
  plugins: [tailwindcss(), react()],
});
