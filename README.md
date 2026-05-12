# TubeMato

TubeMato is an Electron desktop Pomodoro app with objective tracking, analytics, and optional YouTube bridge controls.

## Current Feature Set

- **Timer states**: Focus, pause, short/long break, grace, overdue/procrastinating.
- **Objectives**: One-time or repeating objectives with check-ins and period tracking.
- **Per-objective timer overrides**: Optional work/short/long durations that can override global settings when selected.
- **Procrastination flow**: Grace countdown after break, overdue tracking, and optional desktop nudge.
- **Daily summary**: End-of-day recap with objective progress, streak, focus/procrastination totals.
- **Analytics**: Focus-day heatmap, shared-scale focus/procrastination charts, streak stats.
- **Mini widget**: Always-on-top floating timer window.
- **Tray controls**: Keep app running in tray and control timer without reopening main window.
- **Windows auto-launch**: Configurable in Settings.
- **Log rotation**: Monthly / quarterly / semiannual / yearly logs.

## Tech Stack

- Electron (main + preload)
- React + Vite (renderer)
- TypeScript
- Zustand (renderer state)
- `electron-store` + JSON log files (local persistence)

## Getting Started

```bash
npm install
npm run bootstrap:icons
npm run electron:dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run electron:dev` | Start Vite dev server for the app UI |
| `npm run build` | Type-check and build renderer + electron bundles |
| `npm run electron:build` | Build and package with electron-builder |
| `npm run generate-icons` | Generate app/tray icons |
| `npm run generate-extension-icons` | Generate YouTube bridge extension icons |
| `npm run bootstrap:icons` | Run both icon generators |
| `npm run preview` | Preview built renderer |

## Project Layout

```text
TubeMato/
├── electron/                # main process: timer engine, IPC, store, scheduler
├── src/                     # renderer (React)
│   ├── components/          # Timer, Objectives, Analytics, Settings
│   ├── hooks/               # renderer hooks (timer events/actions, etc.)
│   ├── store/               # Zustand stores
│   └── types/               # renderer window bridge typing
├── widget/                  # mini-widget HTML entry
├── extension/               # browser bridge extension files
├── assets/icons/            # app + tray icons
└── scripts/                 # icon generation utilities
```

## Data Storage (Local Only)

TubeMato stores all data locally via Electron `userData`.

- Store file (settings/objectives/summary metadata): `tubemato.json`
- Log files: `logs/log-*.json`

Common Windows locations:

- `%APPDATA%\TubeMato\`
- `%APPDATA%\Electron\` (often in dev mode)

No cloud sync is used by default.

## Reset to a Clean State

1. Quit TubeMato fully (including tray).
2. Delete `tubemato.json`.
3. Delete the `logs` folder (or its contents).
4. Relaunch TubeMato.

You can also do partial resets:

- Keep settings/objectives, clear history: delete only `logs`.
- Keep history, reset settings/objectives: delete only `tubemato.json`.

## YouTube Bridge Notes

- Bridge controls depend on the browser extension and local command server.
- Non-embeddable/private/age-restricted content may not be controllable.
- Timer continues even if YouTube control is unavailable.

## Packaging

`npm run electron:build` packages for Windows NSIS using settings in `package.json` (`build` section).
