import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Windows 8.3 短路徑（如 SIDERE~1）會被 fs allow list 誤判為外部路徑，
    // 僅本機開發用，關閉嚴格檢查。
    fs: { strict: false },
  },
});
