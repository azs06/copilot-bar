# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # Compile TypeScript + copy renderer HTML/assets to dist/
npm start              # Build then launch Electron app
npm run dev            # Same as start (no watch mode)
npm run copy-html      # Re-copy renderer HTML + assets only (skip tsc, for UI-only changes)
npx tsc --noEmit       # Type-check without emitting (quality gate)
```

No automated test runner — verify changes with `npm start` and manual smoke testing.

## Architecture

**Electron menubar app** with two processes communicating via IPC:

```
Renderer (src/renderer/index.html)          Main Process (src/main/)
  vanilla HTML/CSS/JS                         ├─ index.ts         Entry point, IPC handlers, menubar setup
  ipcRenderer.invoke() ──────────────────────→├─ copilot-service.ts  CopilotClient + 50+ tool definitions
  ←── webContents.send("tool-event"|          ├─ database.ts      SQLite via sql.js (~/.copilot-bar/copilot-bar.db)
       "render-widget")                       └─ screenshot-service.ts  desktopCapturer + optional S3 upload
```

### Tool System

All tools live in `copilot-service.ts` using `defineTool()` from `@github/copilot-sdk`. They are collected into a `systemTools` array passed to `CopilotSession`. The tool execution flow:

1. AI decides to call a tool → `tool.execution_start` event → renderer shows indicator
2. Tool handler runs (async, up to 30s)
3. `tool.execution_complete` → if result has `widget` property, renderer gets `render-widget` event

### Native macOS APIs (koffi FFI)

`getNativeApis()` is a lazy-loaded singleton that loads macOS frameworks via koffi:
- **CoreAudio** — volume get/set/mute (AudioObjectGet/SetPropertyData)
- **DisplayServices** — brightness get/set (private framework)
- **IOBluetooth** — Bluetooth power on/off
- **CoreGraphics** — display resolution (CGDisplayPixelsWide/High)

All FFI calls are synchronous after initial load. Since the project is ESM (`"type": "module"`) but koffi is CJS, it's loaded via `createRequire(import.meta.url)`.

### Database

`sql.js` (in-memory SQLite with file persistence) at `~/.copilot-bar/copilot-bar.db`. Tables: `config`, `chat_history`, `chat_sessions`, `notes`, `todos`. Migrations run in `initDb()` — check for missing columns and backfill.

### Session Management

Each chat session maps to a `CopilotSession` instance keyed by numeric `sessionId`. Active session tracked in the `config` table. Switching sessions reuses or creates cached sessions. If the model changes, sessions are recreated.

## Code Conventions

- **ESM with NodeNext resolution** — local imports must use `.js` extensions (e.g., `import { initDb } from "./database.js"`)
- **Strict TypeScript** — `tsconfig.json` has `strict: true`; `npm run build` is the quality gate
- 2-space indentation, semicolons
- Shell commands prefer `execFileAsync` (no shell interpolation) over `execAsync`
- AppleScript runs via `runAppleScript()` helper using `-e` flags (no temp files)
- Native API calls preferred over shelling out when a macOS framework is available

## Environment

- `.env` file (optional, not committed) for S3-compatible screenshot upload config
- `.env.example` is the template — update it when adding new env vars
- App state stored under `~/.copilot-bar/`
