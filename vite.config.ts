import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron', 'electron-store', 'electron-auto-launch'],
            },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@electron/types': path.resolve(__dirname, 'electron/types.ts'),
      '@electron/calendarDate': path.resolve(__dirname, 'electron/calendarDate.ts'),
    },
  },
  // Multi-page: main app + floating widget
  build: {
    // Prevent Vite from deleting packaged artifacts under `dist/win-unpacked`
    // when a previous package/build is still locked by Electron/Windows.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main:   path.resolve(__dirname, 'index.html'),
        widget: path.resolve(__dirname, 'widget/widget.html'),
      },
    },
  },
})
