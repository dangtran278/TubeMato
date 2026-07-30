<p align="center">
  <img src="assets/icons/icon256.png" width="96" alt="TubeMato" />
</p>

<h1 align="center">TubeMato</h1>

<p align="center">A Pomodoro timer with opinions. Mostly about you.</p>

---

TubeMato is a desktop Pomodoro timer that tracks procrastination alongside focus, remembers what objectives you skipped instead of letting them disappear, and closes out each day with a summary whether you want one or not. An optional browser extension syncs YouTube audio to the timer.

## Features

- **Timer:** Pomodoro loop with procrastination tracking. When you don't resume after a break, the app notices and starts counting.
- **Objectives:** One-time deadlines and recurring targets that carry missed completions forward as debt. Each objective can override the global timer and audio settings.
- **Calendar:** Set in advance when to work on an objective. When the time comes, a notification starts it with one click.
- **Five-Year Plan:** A board for longer-term goals. Lay out where you want to be, year by year.
- **Reminders:** Sends reminders as deadlines get close and wraps up each day with a summary.
- **Analytics:** Heatmap and charts showing where your focus went, day by day, and which hours you focus best in.
- **YouTube bridge:** Optional browser extension that controls YouTube audio with focus and break blocks.
- **Widget & tray:** Always-on-top mini timer with a tray icon that keeps the app running when the main window closes.
- **Settings:** Full control over how the timer runs, how the app looks, and when it speaks up.

## Getting Started

```bash
npm install
npm run bootstrap:icons
npm run dev
```

## Scripts

| Command                          | Description                             |
| -------------------------------- | --------------------------------------- |
| `npm run dev`                    | Start Vite dev server + Electron        |
| `npm run build`                  | Type-check and build                    |
| `npm test`                       | Run test suite (Vitest)                 |
| `npm run test:watch`             | Run tests in watch mode                 |
| `npm run seed`                   | Seed dev data for local testing         |
| `npm run electron:build`         | Package for Windows x64 (NSIS)          |
| `npm run electron:build:win-all` | Package for Windows x64 + ia32 + arm64  |
| `npm run electron:build:linux`   | Package for Linux                       |
| `npm run electron:build:mac`     | Package for macOS                       |
| `npm run bootstrap:icons`        | Generate app, tray, and extension icons |

## Project Layout

```
TubeMato/
├── electron/       # Main process: timer, scheduler, store, IPC, copy
├── src/            # Renderer (React + Zustand)
├── widget/         # Always-on-top mini widget (standalone HTML)
├── extension/      # YouTube bridge browser extension
├── tests/          # Vitest unit tests
└── scripts/        # Icon generation and build utilities
```

## Data Storage

All data is stored locally. Nothing leaves your machine.

| File              | Contents                                          |
| ----------------- | ------------------------------------------------- |
| `tubemato.json`   | Settings, objectives, summary metadata            |
| `logs/log-*.json` | Focus sessions, procrastination events, check-ins |

Default locations on Windows:

- `%APPDATA%\TubeMato\` (installed)
- `%APPDATA%\Electron\` (dev mode)

## Reset

1. Quit TubeMato fully (tray included).
2. Delete `tubemato.json` and/or the `logs/` folder.
3. Relaunch.

## YouTube Bridge

The bridge extension is optional. Without it the timer works normally; YouTube music just won't fade automatically. To install, open the extension guide from within the app.

Limitations: non-embeddable, private, or age-restricted content may not be controllable. The timer continues regardless.

## Packaging

```bash
npm run electron:build          # Windows x64 NSIS
npm run electron:build:win-all  # Windows x64 + ia32 + arm64
npm run electron:build:linux    # Linux
npm run electron:build:mac      # macOS
```
