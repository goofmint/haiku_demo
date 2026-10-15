import { defineConfig, loadEnv } from 'vite';

const WS_PROXY_ENV_KEY = 'VITE_WS_PROXY_TARGET';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const wsProxyTarget = env[WS_PROXY_ENV_KEY];

  if (command === 'serve' && !wsProxyTarget) {
    throw new Error(
      `${WS_PROXY_ENV_KEY} が設定されていません。.env.example を参考に .env に ${WS_PROXY_ENV_KEY}(例: ws://localhost:3001)を設定してください。`,
    );
  }

  return {
    server: {
      host: true,
      proxy: wsProxyTarget
        ? {
            '/ws': {
              target: wsProxyTarget,
              ws: true,
            },
          }
        : undefined,
    },
    build: {
      outDir: 'dist',
    },
  };
});
