# Copilot Bar

A macOS menu bar app powered by GitHub Copilot SDK. Chat with AI and control your computer from the menu bar.

## Features

### Chat & AI
- **Chat with AI** - Ask questions, get help with tasks
- **Markdown Rendering** - Rich text formatting with syntax highlighting
- **Chat History** - Conversations persist across sessions (SQLite)
- **Chat Sessions** - Multiple independent conversations
- **Screenshot Analysis** - Capture screen and ask AI about what's visible
- **Image Analysis** - Extract metadata and dimensions from images
- **URL Summarizer** - Fetch and summarize any web page
- **Code Runner** - Execute Python or JavaScript snippets

### System Controls (Native APIs)

Hardware controls use native macOS framework calls via [koffi](https://koffi.dev/) FFI for instant, reliable operation — no shell commands or AppleScript for core operations.

| Control | Native Framework | What it does |
|---------|-----------------|--------------|
| **Brightness** | DisplayServices | Get/set screen brightness (precise float 0-100%) |
| **Volume** | CoreAudio | Get/set volume, mute/unmute |
| **Bluetooth** | IOBluetooth | Power on/off, status check |
| **Screen Size** | CoreGraphics | Detect actual display resolution |

Additional system controls:
- **WiFi** - Turn on/off, check status, list saved networks (`networksetup`)
- **Do Not Disturb** - Toggle Focus mode (`defaults` command)
- **AirDrop** - Toggle on/off
- **Window Management** - Maximize, split, cascade, minimize/restore windows (adapts to your display resolution)
- **App Launcher** - Open any application by name
- **Shell Commands** - Run terminal commands via natural language
- **Clipboard** - Get, set, and clear clipboard contents

### Music Controls
- **Play/Pause/Next/Previous** - Control Spotify or Apple Music
- **Now Playing** - Get current track info

### Widgets & Productivity
- **Timer** - Interactive stopwatch
- **Countdown** - Custom duration countdown with notifications
- **Pomodoro** - 25min work / 5min break timer
- **World Clock** - Real-time display of multiple timezones
- **Unit Converter** - Length, weight, temperature, volume, area, speed
- **Notes** - Create, search, and manage persistent notes
- **Todos** - Task list with completion tracking
- **Weather** - Current weather for any location
- **WiFi Widget** - Visual network status display
- **Bluetooth Widget** - Paired/connected device listing

### Reminders
- **Native Notifications** - Set reminders that trigger macOS notifications
- **List & Cancel** - View active reminders and cancel them

### Voice
- **Speech-to-Text** - Activate macOS dictation
- **Text-to-Speech** - Read responses aloud with configurable voice and speed

### Customization
- **Light/Dark Theme** - Toggle between themes in settings
- **Global Shortcut** - Customizable keyboard shortcut (default: `Cmd+Shift+T`)
- **Model Selection** - Choose from multiple AI models

## Prerequisites

1. **GitHub Copilot** - Active Copilot subscription and CLI installed
2. **Node.js** - v18 or higher

No additional tools required — brightness, volume, and Bluetooth use native macOS APIs directly.

## Installation

```bash
cd copilot-bar
npm install
npm run build
npm start
```

## macOS Permissions

Some features require macOS permissions (grant in **System Settings > Privacy & Security**):

| Permission | Required for |
|------------|-------------|
| **Notifications** | Reminder notifications |
| **Screen Recording** | Screenshot capture |
| **Accessibility** | Window management (arrange/focus/close) |

## Configuration

Settings are stored in SQLite at: `~/.copilot-bar/copilot-bar.db`

Access settings via the gear button in the app to configure:
- AI Model
- Theme (Light/Dark)
- Global Shortcut

## Usage Examples

```
"Set volume to 50%"          "Turn on Bluetooth"
"Set brightness to 80%"      "List Bluetooth devices"
"Mute my computer"           "Turn off WiFi"
"Turn on do not disturb"     "What network am I on?"
"Open Safari"                "Maximize Chrome"
"Split Safari and Terminal"  "Tile my windows"
"Start a Pomodoro"           "Remind me in 30 minutes"
"What time is it in Tokyo?"  "Convert 100 lbs to kg"
"Take a screenshot"          "What's the weather in NYC?"
"Play next song"             "Create a note about..."
"Run this Python: ..."       "Summarize this URL: ..."
```

## Custom Tools

### Audio & Display (Native)

| Tool | Description |
|------|-------------|
| `set_volume` | Set system volume (0-100%) via CoreAudio |
| `get_volume` | Get current volume level via CoreAudio |
| `toggle_mute` | Mute/unmute audio via CoreAudio |
| `set_brightness` | Adjust screen brightness via DisplayServices |
| `get_brightness` | Get current brightness level via DisplayServices |

### Connectivity (Native + System)

| Tool | Description |
|------|-------------|
| `set_bluetooth` | Turn Bluetooth on/off via IOBluetooth |
| `get_bluetooth_status` | Check Bluetooth state via IOBluetooth |
| `toggle_bluetooth` | Toggle Bluetooth via IOBluetooth |
| `list_bluetooth_devices` | List paired/connected devices via system_profiler |
| `set_wifi` | Turn WiFi on/off |
| `get_wifi_status` | Get WiFi status and current network |
| `toggle_wifi` | Toggle WiFi on/off |
| `list_wifi_networks` | List saved WiFi networks (widget) |
| `toggle_airdrop` | Toggle AirDrop on/off |

### Window Management

| Tool | Description |
|------|-------------|
| `list_windows` | List all visible applications and windows |
| `arrange_windows` | Split, cascade, maximize, minimize/restore |
| `focus_window` | Bring an app to the front |
| `close_window` | Close an app's window |

### Productivity

| Tool | Description |
|------|-------------|
| `create_note` / `list_notes` / `search_notes` | Persistent notes (SQLite) |
| `create_todo` / `list_todos` / `complete_todo` | Todo list with completion |
| `start_timer` / `start_countdown` / `start_pomodoro` | Interactive timer widgets |
| `set_reminder` / `list_reminders` / `cancel_reminder` | Scheduled notifications |
| `show_world_clock` / `get_time` | Timezone display |
| `show_unit_converter` / `convert_unit` | Unit conversion |
| `get_weather` | Weather for any location |
| `capture_screenshot` | Screen capture for AI analysis |
| `analyze_image` | Image metadata extraction |
| `summarize_url` | Web page summarization |
| `run_code` | Execute Python or JavaScript |
| `calculate` | Open calculator |

### Media & Voice

| Tool | Description |
|------|-------------|
| `play_music` / `pause_music` | Control Spotify or Apple Music |
| `next_track` / `previous_track` | Skip tracks |
| `get_music_status` | Current track info |
| `speak_text` | Text-to-speech |
| `speech_to_text` | Activate dictation |

### System

| Tool | Description |
|------|-------------|
| `open_application` | Open macOS apps by name |
| `run_shell_command` | Execute shell commands |
| `get_clipboard` / `set_clipboard` | Clipboard operations |
| `set_do_not_disturb` / `toggle_do_not_disturb` | Focus mode |

## Screenshot & S3 Upload (Optional)

Screenshots are saved locally by default. For cloud storage, configure S3-compatible storage:

1. Copy `.env.example` to `.env`
2. Configure your S3 credentials (supports AWS S3, Cloudflare R2, MinIO, etc.)

## Data Storage

All data is stored locally in SQLite:

| Data | Location |
|------|----------|
| Config, chat history, notes, todos | `~/.copilot-bar/copilot-bar.db` |

## Tech Stack

- **Electron** + **menubar** - Menu bar desktop app
- **@github/copilot-sdk** - AI capabilities
- **koffi** - FFI for native macOS framework calls (CoreAudio, DisplayServices, IOBluetooth, CoreGraphics)
- **sql.js** - SQLite for persistence
- **marked** + **highlight.js** - Markdown rendering
- **TypeScript** - Type safety

## Development

```bash
npm run build    # Compile TypeScript
npm run dev      # Build and run
npm start        # Build and run
```

## Credits & Acknowledgments

### Libraries & Frameworks

| Package | Author / Org | License | Used for |
|---------|-------------|---------|----------|
| [Electron](https://www.electronjs.org/) | OpenJS Foundation | MIT | Desktop app runtime |
| [menubar](https://github.com/maxogden/menubar) | Max Ogden | BSD-2-Clause | Menu bar window management |
| [@github/copilot-sdk](https://github.com/nicolo-ribaudo/github-copilot-sdk-js) | GitHub | MIT | AI chat and tool calling |
| [koffi](https://koffi.dev/) | Niels Martignène | MIT | FFI for native macOS framework calls |
| [sql.js](https://github.com/sql-js/sql.js) | sql.js contributors | MIT | In-browser SQLite for persistence |
| [marked](https://github.com/markedjs/marked) | Christopher Jeffrey & contributors | MIT | Markdown to HTML rendering |
| [highlight.js](https://highlightjs.org/) | Ivan Sagalaev & contributors | BSD-3-Clause | Syntax highlighting in code blocks |
| [@aws-sdk/client-s3](https://github.com/aws/aws-sdk-js-v3) | Amazon Web Services | Apache-2.0 | S3 upload for screenshots (optional) |
| [dotenv](https://github.com/motdotla/dotenv) | Scott Motte | BSD-2-Clause | Environment variable loading |
| [TypeScript](https://www.typescriptlang.org/) | Microsoft | Apache-2.0 | Type-safe development |

### External Services

| Service | Provider | Used for |
|---------|----------|----------|
| [wttr.in](https://wttr.in) | Igor Chubin | Weather data API |
| [GitHub Copilot](https://github.com/features/copilot) | GitHub | AI model backend |

## License

MIT
