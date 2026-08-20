import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const processEnvDefines = {};
  Object.keys(env).forEach((key) => {
    if (key.startsWith('REACT_APP_')) {
      processEnvDefines[`process.env.${key}`] = JSON.stringify(env[key]);
    }
  });
  processEnvDefines['process.env.NODE_ENV'] = JSON.stringify(mode);

  return {
    plugins: [react()],
    esbuild: {
      loader: 'jsx',
      include: /src\/.*\.js$/,
      exclude: [],
    },
    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },
    define: processEnvDefines,
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:3002',
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              // 确保 Cookie 被正确转发
              if (req.headers.cookie) {
                proxyReq.setHeader('Cookie', req.headers.cookie);
              }
            });
          },
        },
      },
    },
    build: {
      outDir: 'build',
    },
  };
});
