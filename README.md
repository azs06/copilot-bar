# Copilot Bar

A macOS menu bar app powered by GitHub Copilot SDK. Chat with AI and control your computer from the menu bar.

## Features

- **Chat with AI** - Ask questions, get help with tasks
- **System Control** - Volume, brightness, open apps
- **File Operations** - Browse, create, and manage files
- **Shell Commands** - Run terminal commands via natural language

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
