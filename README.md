# Copilot Bar

A macOS menu bar app powered by GitHub Copilot SDK. Chat with AI and control your computer from the menu bar.

## Features

- **Chat with AI** - Ask questions, get help with tasks (with markdown rendering)
- **System Control** - Volume, brightness, open apps
- **File Operations** - Browse, create, and manage files
- **Shell Commands** - Run terminal commands via natural language
- **Reminders** - Set reminders with native macOS notifications
- **Interactive Widgets** - Timer, countdown, Pomodoro, world clock, unit converter
- **Screenshot Capture** - Take screenshots for AI analysis
- **Global Shortcut** - Quick access from anywhere

## Keyboard Shortcut

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+T` (macOS) / `Ctrl+Shift+T` (Windows/Linux) | Toggle Copilot Bar |

The shortcut can be customized in the settings menu.

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

## Configuration

Config file location: `~/.copilot-bar/config.json`

```json
{
  "model": "gpt-5-mini"
}
```

### Available Models

Change the `model` field to use different AI models:

- `gpt-5-mini` (default)
- `gpt-5`
- `claude-sonnet-4.5`
- And other models supported by Copilot SDK

## Usage Examples

### System Control

- "Set volume to 50%"
- "Mute my computer"
- "What's the current volume?"
- "Set brightness to 80%"

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

| Tool | Description |
|------|-------------|
| `set_volume` | Set system volume (0-100%) |
| `get_volume` | Get current volume level |
| `toggle_mute` | Mute/unmute audio |
| `set_brightness` | Set screen brightness (requires `brightness` CLI) |
| `open_application` | Open macOS apps by name |
| `run_shell_command` | Execute shell commands |
| `start_timer` | Interactive stopwatch widget with start/pause/reset |
| `start_countdown` | Countdown timer with custom duration and label |
| `start_pomodoro` | Pomodoro timer (25min work / 5min break) |
| `show_world_clock` | Display multiple timezones in real-time |
| `get_time` | Get current time in any timezone |
| `show_unit_converter` | Interactive unit converter widget |
| `convert_unit` | Convert values between units |
| `set_reminder` | Schedule a reminder with native notification |
| `list_reminders` | List all active reminders |
| `cancel_reminder` | Cancel a scheduled reminder |
| `capture_screenshot` | Capture screen for AI analysis |

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
- **TypeScript** - Type safety

## License

MIT
