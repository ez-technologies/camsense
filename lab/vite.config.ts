import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// The lab: the element on a page with its own controls, served over HTTPS so a phone can open the camera.
export default defineConfig({
  root: __dirname,
  plugins: [basicSsl()],
  server: { host: '0.0.0.0', port: 5444, strictPort: true },
})
