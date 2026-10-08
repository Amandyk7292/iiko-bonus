import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
  base: '/admin/',
  build: {
    minify: 'terser',
    terserOptions: { compress: { passes: 2 } },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('/src/pages/KitchenPage.tsx') ||
            id.includes('/src/pages/OrdersPage.tsx')
          ) {
            return 'staff-orders';
          }
          if (id.includes('/src/lib/i18n')) return 'i18n';
          if (id.includes('/components/BulkaIcons.tsx')) return 'icons';
        },
      },
    },
  },
  plugins: [tailwindcss(), react()],
});
