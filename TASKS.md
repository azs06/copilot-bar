# Copilot Bar - Feature Tasks

> **Progress: 26/26 completed (100%)**
>
> █████████████████████████

## Completed (26)

| # | Feature | Implementation |
|---|---------|----------------|
| 1 | Global keyboard shortcut | Electron globalShortcut |
| 2 | Reminder tool with notifications | Native macOS notifications |
| 3 | Markdown rendering | marked + highlight.js |
| 4 | Add calculator widget | Safe math evaluation |
| 5 | World clock / timezone widget | Interactive widget |
| 6 | Add quick notes / sticky notes widget | SQLite notes table |
| 7 | Add todo list widget | SQLite todos table |
| 8 | Add weather widget | wttr.in API |
| 9 | Unit converter widget | Interactive widget |
| 10 | Screenshot capture + AI analysis | screencapture + S3 upload |
| 11 | Add clipboard history tool | pbpaste/pbcopy commands |
| 12 | Do Not Disturb toggle | defaults command |
| 13 | Add voice input (speech-to-text) | macOS dictation |
| 14 | Add text-to-speech for responses | say command |
| 15 | Add URL summarizer tool | Web fetch + text extraction |
| 16 | Add code runner widget (Python/JS) | Python/node execution |
| 17 | Add image drop for AI analysis | Image metadata extraction |
| 18 | Add Spotify/Apple Music controls | AppleScript |
| 19 | Chat history persistence | SQLite via sql.js |
| 20 | Light/dark theme toggle | CSS variables + settings UI |
| 21 | Chat session management (multiple conversations) | SQLite chat_sessions + session_id |
| 22 | WiFi toggle (on/off/status) | networksetup command |
| 23 | Bluetooth toggle (on/off/status) | Native IOBluetooth API via koffi |
| 24 | Add AirDrop toggle (on/off) | defaults command |
| 25 | Add window organizer (arrange/tile windows) | AppleScript + native screen detection |
| 26 | List available WiFi networks | networksetup command |
| 27 | List paired/nearby Bluetooth devices | system_profiler (built-in) |

## Native API Upgrades

| Feature | Before | After |
|---------|--------|-------|
| Brightness | AppleScript key codes (slow, 16 steps) | DisplayServices native API (instant, precise) |
| Volume | osascript (process spawn each call) | CoreAudio native API (synchronous FFI) |
| Bluetooth on/off | blueutil (required brew install) | IOBluetooth native API (zero dependencies) |
| Bluetooth devices | blueutil --paired/--connected | system_profiler (built-in) |
| Window maximize | Hardcoded 1920x1080 | CGDisplayPixelsWide/High (any resolution) |
| Do Not Disturb | defaults + AppleScript UI automation fallback | defaults only (removed brittle fallback) |

All native APIs share a single lazy-loaded `getNativeApis()` singleton via koffi FFI.
