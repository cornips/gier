import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Relative URLs: one build works at the site root or below any path. The server adds <base href>.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Send cookies with the manifest request, so it also loads behind an authenticating proxy.
      useCredentials: true,
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // Precache the app shell and Latin fonts only; other scripts load on demand via unicode-range.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png}', '**/*-latin-wght-normal-*.woff2'],
      },
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Gier',
        short_name: 'Gier',
        description: 'Circles over your prices until they drop.',
        lang: 'en',
        // Relative to the manifest URL, so they follow wherever Gier is served.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#F5F2EA',
        theme_color: '#F5F2EA',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        share_target: {
          action: 'track',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  test: { environment: 'jsdom' },
});
