import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'
import { electronAliases } from './electron-aliases'

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
              external: ['electron', 'electron-store'],
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
    alias: electronAliases(__dirname),
  },
  // Multi-page: main app + floating widget
  build: {
    // Avoids Vite deleting packaged artifacts under `dist/win-unpacked` while Electron holds
    // them locked. For a clean build, delete `dist/` and `dist-electron/` manually first.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main:          path.resolve(__dirname, 'index.html'),
        widget:        path.resolve(__dirname, 'widget/widget.html'),
        mascotOverlay: path.resolve(__dirname, 'widget/mascot-overlay.html'),
        notifications: path.resolve(__dirname, 'widget/notifications.html'),
      },
    },
  },
})
