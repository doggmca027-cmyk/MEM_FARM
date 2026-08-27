import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          tonconnect: ['@tonconnect/ui-react'],
          motion: ['framer-motion'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
