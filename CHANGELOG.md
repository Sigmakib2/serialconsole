# Changelog

All notable changes to SerialConsole will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-01

### Added
- **Interactive Port Selection** - List ports and select with number input
- **Responsive TUI Monitor** - Full-screen terminal interface with adaptive layout
- **Auto-Reconnect System** - Intelligent reconnection with exponential backoff
- **Hex Viewer** - Toggle between ASCII and hexadecimal display modes
- **Multiple Communication Modes**:
  - `list` - Interactive port selection and monitoring
  - `monitor` - Full TUI monitoring interface
  - `read` - Simple read-only mode
  - `write` - Send data to port
  - `interactive` - Two-way communication mode
- **Advanced Features**:
  - Real-time statistics (bytes sent/received, message count, uptime)
  - Message filtering with case-insensitive search
  - Echo mode for sent messages
  - Configurable line endings (LF, CR, CRLF)
  - Pause/resume logging
  - Screen clearing functionality
- **Keyboard Shortcuts** - Nano-style control scheme (Ctrl+Q, Ctrl+I, etc.)
- **Cross-Platform Support** - Windows, macOS, and Linux binaries
- **Professional UI** - Color-coded messages, timestamps, status indicators
- **Error Handling** - Graceful handling of connection errors and recovery

### Technical Details
- Built with Node.js 18+ for modern JavaScript features
- Uses SerialPort library for cross-platform serial communication
- Blessed.js for terminal user interface
- Commander.js for CLI argument parsing
- Chalk for colorful terminal output
- Comprehensive error handling and validation

### Initial Release Features
- Zero-configuration usage with sensible defaults
- Extensive documentation and help system
- MIT licensed for maximum compatibility
- Ready for npm global installation