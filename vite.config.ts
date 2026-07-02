import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// dev 代理目标从 .env.local 的 VITE_GLLUE_HOST 读取（公开仓库里是占位符）。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = `http://${env.VITE_GLLUE_HOST || 'your-gllue-host.example.com'}`;
  return {
    plugins: [react()],
    server: {
      port: 5173,
      cors: true,
      proxy: {
        '/rest': { target, changeOrigin: true },
        '/crm': { target, changeOrigin: true },
      },
    },
  };
});
