# Copilot Bar

A macOS menu bar app powered by GitHub Copilot SDK. Chat with AI and control your computer from the menu bar.

![Progress](https://img.shields.io/badge/Features-11%2F27%20completed-blue)

## Features

### 💬 Chat & AI
- **Chat with AI** - Ask questions, get help with tasks
- **Markdown Rendering** - Rich text formatting with syntax highlighting
- **Chat History** - Conversations persist across sessions (SQLite)
- **Screenshot Analysis** - Capture screen and ask AI about what's visible

### 🎛️ System Controls
- **Volume Control** - Set, get, mute/unmute system audio
- **Brightness Control** - Adjust screen brightness
- **Do Not Disturb** - Toggle Focus mode on/off
- **WiFi Control** - Turn WiFi on/off, check status, list saved networks
- **App Launcher** - Open any application by name
- **Shell Commands** - Run terminal commands via natural language

### ⏱️ Widgets & Productivity
- **Timer** - Interactive stopwatch with start/pause/reset
- **Countdown** - Custom duration countdown with notifications
- **Pomodoro** - 25min work / 5min break productivity timer
- **World Clock** - Real-time display of multiple timezones
- **Unit Converter** - Convert length, weight, temperature, volume, area, speed
- **WiFi Widget** - Visual display of network status and saved networks

### 🔔 Reminders
- **Native Notifications** - Set reminders that trigger macOS notifications
- **List & Cancel** - View active reminders and cancel them

### 🎨 Customization
- **Light/Dark Theme** - Toggle between themes in settings
- **Global Shortcut** - Customizable keyboard shortcut
- **Model Selection** - Choose from multiple AI models

## Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+T` (macOS) / `Ctrl+Shift+T` (Windows/Linux) | Toggle Copilot Bar |

The shortcut can be customized in the settings menu (⚙️).

## Screenshots

### Chat Interface
The main chat interface with markdown rendering and interactive widgets.

### Widgets
- **Timer/Countdown/Pomodoro** - Productivity timers with start/pause/reset controls
- **World Clock** - Real-time display of multiple timezones
- **Unit Converter** - Interactive converter for length, weight, temperature, volume, area, speed
- **WiFi Widget** - Visual network status and saved networks list

### Settings
Configure AI model, theme (light/dark), and global keyboard shortcut.

## Prerequisites

1. **GitHub Copilot** - Active Copilot subscription and CLI installed
2. **Node.js** - v18 or higher
3. **Brightness CLI** (optional, for brightness control):

   ```bash
   brew install brightness
   ```

## Installation

```bash
cd copilot-bar
npm install
npm run build
npm start
```

## macOS Permissions

Some features require macOS permissions:

- **Accessibility**: Needed for Do Not Disturb toggling via UI automation fallback
- **Notifications**: Needed for reminder notifications
- **Screen Recording**: Needed for screenshot capture

You can grant these in **System Settings → Privacy & Security**.

## Configuration

Settings are stored in SQLite at: `~/.copilot-bar/copilot-bar.db`

Access settings via the ⚙️ button in the app to configure:
- AI Model
- Theme (Light/Dark)
- Global Shortcut

### Available Models

- `gpt-5-mini` (default)
- `gpt-5`
- `claude-3.5-sonnet`
- `claude-4-opus`

## Usage Examples

### System Control

- "Set volume to 50%"
- "Mute my computer"
- "What's the current volume?"
- "Set brightness to 80%"

### Do Not Disturb

- "Turn on do not disturb"
- "Disable DND"
- "Is focus mode enabled?"
- "Toggle do not disturb"

### WiFi

- "Turn off WiFi"
- "Is WiFi on?"
- "What network am I connected to?"
- "List WiFi networks"
- "Show my saved networks"

### Applications

- "Open Safari"
- "Open Terminal"
- "Open Finder"

### File Operations

- "List files in my Downloads folder"
- "What's in ~/Desktop?"
- "Create a folder called Projects on Desktop"

### Shell Commands

- "Run `ls -la ~/Documents`"
- "Show disk usage"
- "What's my IP address?"

### Timers & Productivity

- "Start a timer"
- "Set a 5 minute countdown"
- "Start a Pomodoro"
- "Remind me to take a break in 30 minutes"
- "What reminders do I have?"

### Time & Conversion

- "What time is it in Tokyo?"
- "Show me a world clock"
- "Convert 100 pounds to kilograms"
- "Open the temperature converter"

### Screenshot

- "Take a screenshot"
- "Capture my screen and tell me what you see"

## Custom Tools

The app includes these custom tools for system interaction:

### Audio & Display

| Tool | Description |
|------|-------------|
| `set_volume` | Set system volume (0-100%) |
| `get_volume` | Get current volume level |
| `toggle_mute` | Mute/unmute audio |
| `set_brightness` | Set screen brightness (requires `brightness` CLI) |

### System Controls

| Tool | Description |
|------|-------------|
| `set_do_not_disturb` | Enable/disable Do Not Disturb |
| `get_do_not_disturb_status` | Check if DND is enabled |
| `toggle_do_not_disturb` | Toggle DND on/off |
| `set_wifi` | Turn WiFi on/off |
| `get_wifi_status` | Get WiFi status and current network |
| `toggle_wifi` | Toggle WiFi on/off |
| `list_wifi_networks` | List saved WiFi networks (widget) |
| `open_application` | Open macOS apps by name |
| `run_shell_command` | Execute shell commands |

### Widgets

| Tool | Description |
|------|-------------|
| `start_timer` | Interactive stopwatch widget |
| `start_countdown` | Countdown timer with custom duration |
| `start_pomodoro` | Pomodoro timer (25min work / 5min break) |
| `show_world_clock` | Display multiple timezones |
| `show_unit_converter` | Interactive unit converter |
| `convert_unit` | Convert values between units |

### Reminders & Time

| Tool | Description |
|------|-------------|
| `set_reminder` | Schedule a reminder notification |
| `list_reminders` | List all active reminders |
| `cancel_reminder` | Cancel a scheduled reminder |
| `get_time` | Get current time in any timezone |
| `capture_screenshot` | Capture screen for AI analysis |

## Data Storage

All data is stored locally in SQLite:

| Data | Location |
|------|----------|
| Config & Settings | `~/.copilot-bar/copilot-bar.db` |
| Chat History | `~/.copilot-bar/copilot-bar.db` |

## Screenshot & S3 Upload (Optional)

Screenshots are saved locally by default. For cloud storage, configure S3-compatible storage:

1. Copy `.env.example` to `.env`
2. Configure your S3 credentials (supports AWS S3, Cloudflare R2, MinIO, etc.)

```bash
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_BUCKET=your-bucket
S3_REGION=auto
S3_ACCESS_KEY_ID=your-key
S3_SECRET_ACCESS_KEY=your-secret
S3_PUBLIC_URL=https://your-public-url
```

## Development

```bash
# Build
npm run build

# Run in development
npm run dev

# Start
npm start
```

## Tech Stack

- **Electron** - Desktop app framework
- **menubar** - Menu bar integration
- **@github/copilot-sdk** - AI capabilities
- **sql.js** - SQLite for persistence
- **marked** - Markdown rendering
- **highlight.js** - Syntax highlighting
- **TypeScript** - Type safety

## Troubleshooting

### Do Not Disturb doesn't toggle
- Ensure Accessibility permissions are granted.
- If it still fails, macOS may block UI automation in the background.

### WiFi list doesn't show nearby networks
- The `list_wifi_networks` tool shows **saved/preferred networks** on newer macOS versions.
- A live scan requires the deprecated `airport` utility (missing on modern macOS).

### Screenshot capture fails
- Grant **Screen Recording** permission.
- If using S3 uploads, verify `.env` credentials.

## Roadmap

See [TASKS.md](./TASKS.md) for the full feature roadmap. Upcoming features include:

- Bluetooth toggle & device listing
- AirDrop toggle
- Window organizer
- Clipboard history
- Voice input/output
- Weather widget
- And more...

## License

MIT
