# 🚀 SerialConsole

[![npm version](https://badge.fury.io/js/serialconsole.svg)](https://badge.fury.io/js/serialconsole)
[![GitHub issues](https://img.shields.io/github/issues/Sigmakib2/serialconsole)](https://github.com/Sigmakib2/serialconsole/issues)
[![GitHub license](https://img.shields.io/github/license/Sigmakib2/serialconsole)](https://github.com/Sigmakib2/serialconsole/blob/main/LICENSE)

A powerful cross-platform serial port monitor with interactive TUI interface, auto-reconnect, and hex viewer. Perfect for embedded systems development, Arduino programming, and hardware debugging.

![SerialConsole Demo](https://raw.githubusercontent.com/Sigmakib2/serialconsole/main/demo.gif)

## ✨ Features

- 📊 **Interactive Port Selection** - List and select ports with baud rate configuration
- 🖥️ **Responsive TUI Interface** - Professional terminal UI with real-time statistics
- 🔄 **Auto-Reconnect** - Intelligent reconnection with exponential backoff
- 🔍 **Hex Viewer** - Toggle between ASCII and hex display modes
- ⚡ **Multiple Baud Rates** - Support for all common rates plus custom values
- 🎮 **Nano-style Controls** - Familiar keyboard shortcuts (Ctrl+Q, Ctrl+I, etc.)
- 📱 **Cross-Platform** - Works on Windows, macOS, and Linux
- 🎯 **Message Filtering** - Filter incoming data in real-time
- 📝 **Multiple Modes** - Read-only, write-only, interactive, and full monitor modes

## 🚀 Installation

### NPM (Recommended)
```bash
# Install globally
npm install -g serialconsole

# Alternative short command
npm install -g serialconsole && alias sc=serialconsole
```

### Binary Downloads
Download pre-built binaries from [Releases](https://github.com/Sigmakib2/serialconsole/releases):
- Windows: `serialconsole-win.exe`
- macOS: `serialconsole-macos`
- Linux: `serialconsole-linux`

## 📖 Quick Start

### Interactive Mode (Recommended)
```bash
# List ports and select interactively
serialconsole list
# or
sc list
```

This will:
1. Show all available serial ports
2. Let you select a port by number
3. Choose baud rate from common options
4. Launch the TUI monitor automatically

### Direct Commands
```bash
# Full TUI monitor
serialconsole monitor /dev/ttyUSB0 -b 115200

# Simple read mode
serialconsole read /dev/ttyACM0

# Send data
serialconsole write /dev/ttyUSB0 "Hello Arduino" --newline

# Interactive chat mode
serialconsole interactive COM3 -b 9600
```

## 🎮 TUI Controls

| Key | Action |
|-----|--------|
| `Ctrl+Q` | Exit application |
| `Ctrl+I` | Send message |
| `Ctrl+H` | Toggle hex viewer |
| `Ctrl+S` | Toggle statistics panel |
| `Ctrl+P` | Pause/resume logging |
| `Ctrl+C` | Clear screen |
| `Ctrl+F` | Set message filter |
| `Ctrl+E` | Toggle echo mode |
| `Ctrl+L` | Cycle line endings (LF/CR/CRLF) |
| `Ctrl+R` | Toggle auto-reconnect |

## 🛠️ Use Cases

- **Arduino Development** - Monitor serial output and send commands
- **ESP32/ESP8266 Projects** - Debug IoT devices with auto-reconnect
- **Embedded Systems** - Professional monitoring for production debugging
- **Hardware Testing** - Validate serial communication protocols
- **Educational** - Learn serial communication with visual feedback
- **Raspberry Pi** - Monitor UART communication with peripherals

## 📊 Interface Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 🚀 ByteStream Monitor - /dev/ttyUSB0                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│ 📡 Port: /dev/ttyUSB0 @ 115200 | 🟢 Connected | ⏱️ 00:05:23 | 📊 1,247 msgs │
│ 📥 RX: 15.2KB (51.3 B/s) | 📤 TX: 2.1KB (7.1 B/s) | ▶️ | 🔍 | 🔄           │
├─────────────────────────────────────────────────────────────────────────────┤
│ [14:30:25.123] ← Temperature: 23.5°C, Humidity: 45%                          │
│ [14:30:26.089] ← Sensor reading complete                                     │
│ [14:30:27.156] → status                                                      │
│ [14:30:27.201] ← System OK - All sensors operational                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ ^Q Exit     ^I Send Msg   ^H Hex View   ^S Statistics   ^P Pause     ^C Clear│
│ ^F Filter     ^E Echo Mode  ^L Line End   ^R Auto-Reconnect                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

## ⚙️ Configuration

### Common Baud Rates
- 9600 (default)
- 19200, 38400, 57600
- 115200 (Arduino standard)
- 230400, 460800, 921600
- Custom rates supported

### Line Endings
- **LF** - Linux/macOS standard (`\n`)
- **CR** - Classic Mac (`\r`)
- **CRLF** - Windows standard (`\r\n`)

## 🔧 Advanced Usage

### Filtering Messages
```bash
# Only show messages containing "error"
# Use Ctrl+F in TUI mode, or filter in real-time
```

### Auto-Reconnect
Perfect for development workflows:
- Automatically reconnects when device resets
- Exponential backoff prevents spam
- Visual countdown shows next attempt
- Handles permission errors gracefully

### Hex Viewer
```
ASCII View:                    Hex View:
← Temperature: 23.5°C         ← [14:30:25] 54 65 6D 70 65 72 61 74 75 72 65 3A 20 32 33 2E 35 C2 B0 43
```

## 🚧 Building from Source

```bash
# Clone repository
git clone https://github.com/Sigmakib2/serialconsole.git
cd serialconsole

# Install dependencies
npm install

# Run directly
node index.js list

# Build binaries
npm run build:all
# Outputs to dist/ directory
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [SerialPort](https://serialport.io/) for cross-platform serial communication
- [Blessed](https://github.com/chjj/blessed) for the beautiful TUI interface
- [Commander.js](https://github.com/tj/commander.js) for CLI argument parsing
- [Chalk](https://github.com/chalk/chalk) for colorful terminal output

## 🐛 Issues & Support

- 🐛 [Report Bugs](https://github.com/Sigmakib2/serialconsole/issues)
- 💡 [Feature Requests](https://github.com/Sigmakib2/serialconsole/issues)
- 📚 [Documentation](https://github.com/Sigmakib2/serialconsole#readme)

---

**Star ⭐ this repository if SerialConsole helps with your projects!**