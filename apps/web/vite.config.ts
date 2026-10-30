import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)
const page = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const emptyModule = page('./src/shims/empty.ts')
const { version } = require('../../package.json') as { version: string }

// Visit counting with Umami Cloud (D23): only in the published build, and the script itself counts
// only on the Pages domain, so local builds and previews send nothing.
const UMAMI = {
  scriptUrl: 'https://cloud.umami.is/script.js',
  // From Umami Cloud › Settings › Websites; public, as it is in every page. Empty: no script.
  websiteId: '933988fb-f227-4f09-bc3a-e4cd259b4df2',
  domains: 'pouju.github.io',
}

const umami = (): Plugin => ({
  name: 'umami',
  apply: 'build',
  transformIndexHtml: () =>
    UMAMI.websiteId
      ? [
          {
            tag: 'script',
            attrs: {
              defer: true,
              src: UMAMI.scriptUrl,
              'data-website-id': UMAMI.websiteId,
              'data-domains': UMAMI.domains,
            },
            injectTo: 'head',
          },
        ]
      : [],
})

export default defineConfig({
  base: './',
  plugins: [react(), umami()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Vite would otherwise listen only on IPv6 localhost in the dev container, where the forwarded
  // port never answers. File change events don't reach the container either, so it polls there.
  server: {
    host: '127.0.0.1',
    ...(process.env.DEVCONTAINER === 'true' && { watch: { usePolling: true } }),
  },
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      input: {
        landing: page('./index.html'),
        app: page('./app/index.html'),
        guides: page('./guides/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      fs: emptyModule,
      buffer: require.resolve('buffer/'),
      string_decoder: require.resolve('string_decoder/'),
    },
  },
})
