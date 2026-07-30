// Bundled locally (@fontsource). Keeps the widget fully offline.
// Vite processes this module script and emits the woff2 files with the build.
// Load only the faces the widget actually renders:
//   Inter 400          base / "+1" button text
//   Inter 600          status label (.widget__label)
//   JetBrains Mono 500 countdown (.widget__timer)
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/jetbrains-mono/latin-500.css'
