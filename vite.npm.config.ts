import { fileURLToPath } from 'node:url'

import { defineConfig, lazyPlugins } from 'vite-plus'
import preact from '@preact/preset-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** Dedicated production build for the npm package (`dist/`), mapped 1:1 to an FKN tenant root. */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    chunkImportMap: false,
    rollupOptions: {
      input: {
        index: fromRoot('./index.html'),
        engine: fromRoot('./__yt_engine__/engine.html'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'index' ? 'index-[hash].js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks: (id) => {
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          return undefined
        },
      },
    },
  },
  plugins: lazyPlugins(() => [
    // unpkg answers 500 for 0-byte chunks, and signed releases verify every listed asset.
    {
      name: 'ftube-no-empty-chunks',
      apply: 'build',
      generateBundle: (_options, bundle) => {
        for (const file of Object.values(bundle)) {
          if (file.type === 'chunk' && !file.code.trim()) file.code = '/* empty */\n'
        }
      },
    },
    // The FKN sandbox mounts only package `main` as `<script type="module">`, so inject extracted CSS stylesheets.
    {
      name: 'ftube-inject-css',
      apply: 'build',
      generateBundle: (_options, bundle) => {
        const cssHrefs = Object.keys(bundle)
          .filter((name) => name.endsWith('.css'))
          .sort()
          .map((name) => `/${name}`)
        if (cssHrefs.length === 0) return
        const entry = Object.values(bundle).find(
          (file) => file.type === 'chunk' && file.isEntry && /^index-[A-Za-z0-9_-]+\.js$/.test(file.fileName),
        )
        if (!entry || entry.type !== 'chunk') return
        const loader = `(()=>{for(const h of ${JSON.stringify(cssHrefs)}){if(!document.querySelector('link[rel="stylesheet"][href="'+h+'"]')){const l=document.createElement('link');l.rel='stylesheet';l.href=h;document.head.appendChild(l)}}})();\n`
        entry.code = loader + entry.code
      },
    },
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
    }),
    preact({
      jsxImportSource: '@emotion/react',
    }),
  ]),
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-runtime',
    },
    dedupe: ['osra', 'preact'],
  },
  worker: {
    format: 'es',
    plugins: () => [
      nodePolyfills({
        globals: { Buffer: true, global: true, process: true },
      }),
    ],
  },
})
