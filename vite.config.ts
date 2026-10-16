import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // ------------------------------------------------------------------
    // vite-plugin-pwa：以 Workbox 產生 Service Worker，達成 100% 離線。
    // 手機 Safari「加入主畫面」後，開飛航模式仍能載入地圖與答題。
    // ------------------------------------------------------------------
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'JpnDuoSRS — JLPT N5',
        short_name: 'JpnDuoSRS',
        description: 'Duolingo 風格的 JLPT N5 間隔重複記憶 App',
        theme_color: '#58cc02',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // 強制把 js / css / html / svg / ts / tsx 全部納入 precache。
        // （ts/tsx 在 dist 內通常不存在，pattern 不匹配時無害。）
        globPatterns: ['**/*.{js,css,html,svg,ts,tsx,ico,png,webmanifest}'],
        // 單頁應用：離線導航一律回 index.html
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
});
