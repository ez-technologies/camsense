import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// The lab: the element on a page with its own controls. Locally it is served over HTTPS (a phone needs
// HTTPS for the camera); built, it is published on GitHub Pages under /camsense/.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: command === 'build' ? '/camsense/' : '/',
  plugins: command === 'serve' ? [basicSsl()] : [],
  server: { host: '0.0.0.0', port: 5444, strictPort: true },
}))
