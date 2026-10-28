import { defineConfig, type Plugin } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Samples sent from the phone's test screens are saved here (lab only, not on GitHub Pages).
function samples(): Plugin {
  const root = resolve(__dirname, '..', 'data', 'samples')
  return {
    name: 'samples',
    configureServer(server) {
      server.middlewares.use('/api/samples', (req, res) => {
        let raw = ''
        req.on('data', (c) => (raw += c))
        req.on('end', () => {
          try {
            const { meta, files } = JSON.parse(raw)
            const dir = join(root, `${String(meta.at).replace(/[:.]/g, '-')}_${meta.kind}`)
            mkdirSync(dir, { recursive: true })
            for (const [name, url] of Object.entries(files as Record<string, string>)) {
              writeFileSync(join(dir, `${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'))
            }
            writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2))
            console.log(`[samples] saved ${dir}`)
            res.end('{"ok":true}')
          } catch (e) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(e) }))
          }
        })
      })
    },
  }
}

// The lab: the element on a page with its own controls. Locally it is served over HTTPS (a phone needs
// HTTPS for the camera); built, it is published on GitHub Pages under /camsense/.
export default defineConfig(({ command }) => ({
  root: __dirname,
  base: command === 'build' ? '/camsense/' : '/',
  plugins: command === 'serve' ? [basicSsl(), samples()] : [],
  build: { rollupOptions: { input: { main: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'lab.html'), document: resolve(__dirname, 'document.html') } } },
  server: { host: '0.0.0.0', port: 5444, strictPort: true },
}))
