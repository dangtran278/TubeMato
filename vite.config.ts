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
        // `npm run dev:test` sets TUBEMATO_USER_DATA_DIR to a throwaway profile. Passing it
        // through as Chromium's --user-data-dir moves app.getPath('userData'), so a dev run
        // reads and writes that copy instead of the profile you actually use. Unset, this is
        // exactly the plugin's own default startup - plain `npm run dev` is unchanged.
        onstart({ startup }) {
          const profile = process.env.TUBEMATO_USER_DATA_DIR
          const argv = ['.', '--no-sandbox']
          if (profile) argv.push(`--user-data-dir=${profile}`)
          startup(argv)
        },
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
