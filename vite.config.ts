import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { defineConfig, lazyPlugins } from 'vite-plus'
import preact from '@preact/preset-vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { lazyCode } from './src/lazy-code'

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// one value for the app and the engine frame it serves, new on every build (src/engine/engine-build.ts). It goes in
// the HTML because a value compiled into the code would rename every file that imports it, changed or not.
const buildTag = { tag: 'meta', attrs: { name: 'yt-build', content: randomUUID() } }

export default defineConfig({
  fmt: { semi: false, singleQuote: true },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: {
      'vite-plus/prefer-vite-plus-imports': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        files: ['tests/**', '**/*.spec.ts', '**/*.test.ts', 'examples/**'],
        rules: {
          'no-floating-promises': 'off',
          'no-unused-vars': 'off',
          'no-unused-expressions': 'off',
        },
      },
    ],
  },
  build: {
    outDir: 'build',
    target: 'esnext',
    chunkImportMap: true,
    rollupOptions: {
      input: {
        app: fromRoot('./index.html'),
        engine: fromRoot('./__yt_engine__/engine.html'),
      },
    },
  },
  plugins: lazyPlugins(() => [
    { name: 'yt-build', transformIndexHtml: () => [buildTag] },
    // in the app's own HTML, so the list always names the files of the document's own build
    {
      name: 'yt-lazy-code',
      apply: 'build',
      transformIndexHtml: {
        order: 'post',
        handler: (_html, { path, bundle, chunk }) => path !== '/index.html' || !bundle || !chunk ? undefined : [{
          tag: 'script',
          attrs: { type: 'application/json', id: 'lazy-code' },
          children: JSON.stringify(lazyCode(bundle, chunk.fileName)),
          injectTo: 'head',
        }],
      },
    },
    // Vite inlines the chunk import map into each HTML page in normal generateBundle order; the standalone
    // importmap.json asset is unused on deploy, so drop it after Vite's HTML and preload hooks have read it.
    {
      name: 'yt-drop-importmap-file',
      apply: 'build',
      generateBundle: {
        order: 'post',
        handler: (_options, bundle) => {
          delete bundle['importmap.json']
        },
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
