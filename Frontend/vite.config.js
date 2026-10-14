import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import basicssl from '@vitejs/plugin-basic-ssl'
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react(), tailwindcss(), basicssl()],
    server: {
      host: '0.0.0.0',
      proxy: {
        '/socket.io': {
          target: env.VITE_SERVER_LOCAL || 'http://127.0.0.1:5000',
          ws: true,
        },
      },
    },
  }
})
