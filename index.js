#!/usr/bin/env node

import { SerialPort } from 'serialport';
import { ReadlineParser } from '@serialport/parser-readline';
import chalk from 'chalk';
import { Command } from 'commander';
import blessed from 'blessed';
import readline from 'readline';

// Command: Responsive TUI Monitor with adaptive layout
async function tuiMonitor(portPath, options) {
  let port;
  let bytesReceived = 0;
  let bytesSent = 0;
  let messagesReceived = 0;
  let startTime = Date.now();
  
  // Settings
  let showHex = true;
  let showStats = true;
  let pauseLogging = false;
  let lineEnding = 'LF';
  let echoMode = false;
  let filterText = '';
  let filterEnabled = false;
  let autoReconnect = true;
  
  // Reconnection state
  let isReconnecting = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let maxReconnectDelay = 30000;
  let reconnectStartTime = null;
  let currentReconnectDelay = 0;
  
  // UI State
  let screenWidth = 80;
  let screenHeight = 24;
  let compactMode = false;
  
  // Create the screen with responsive settings
  const screen = blessed.screen({
    smartCSR: true,
    title: `ByteStream Monitor - ${portPath}`,
    fullUnicode: true,
    dockBorders: true,
    autoPadding: true
  });

  // Dynamic layout calculator
  function calculateLayout() {
    screenWidth = screen.width;
    screenHeight = screen.height;
    compactMode = screenWidth < 100 || screenHeight < 20;
    
    const layout = {
      // Header takes 1 row
      header: { top: 0, height: 1 },
      
      // Status bar: 2-4 rows depending on space and mode
      status: { 
        top: 1, 
        height: compactMode ? 2 : (showStats ? 4 : 3)
      },
      
      // Main content area (accounts for 2 help rows at bottom)
      content: {
        top: compactMode ? 3 : (showStats ? 5 : 4),
        height: screenHeight - (compactMode ? 5 : (showStats ? 7 : 6))
      },
      
      // Help bar: 2 rows at bottom (like nano)
      help: { 
        bottom: 0,
        height: 2 
      },
      
      // Data panel width (responsive)
      dataWidth: showHex ? (compactMode ? '60%' : '70%') : '100%',
      hexWidth: showHex ? (compactMode ? '40%' : '30%') : '0%'
    };
    
    return layout;
  }

  // Create UI components
  let components = {};

  function createComponents() {
    const layout = calculateLayout();
    
    // Header with gradient background
    components.header = blessed.box({
      parent: screen,
      top: layout.header.top,
      left: 0,
      width: '100%',
      height: layout.header.height,
      content: `{center}{bold}{white-fg}{blue-bg} 🚀 ByteStream Monitor - ${portPath} {/}{/}{/}`,
      tags: true,
      style: {
        bg: 'blue'
      }
    });

    // Responsive status panel
    components.statusPanel = blessed.box({
      parent: screen,
      top: layout.status.top,
      left: 0,
      width: '100%',
      height: layout.status.height,
      border: { type: 'line' },
      label: ' Connection & Statistics ',
      tags: true,
      style: {
        fg: 'white',
        border: { fg: 'cyan' }
      }
    });

    // Main data area with responsive width
    components.dataArea = blessed.log({
      parent: screen,
      top: layout.content.top,
      left: 0,
      width: layout.dataWidth,
      height: layout.content.height,
      border: { type: 'line' },
      label: ` 📡 Serial Data ${compactMode ? '' : '(ASCII)'} `,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      vi: true,
      style: {
        fg: 'white',
        border: { fg: 'yellow' }
      }
    });

    // Hex area (collapsible)
    if (showHex) {
      components.hexArea = blessed.log({
        parent: screen,
        top: layout.content.top,
        left: layout.dataWidth,
        width: layout.hexWidth,
        height: layout.content.height,
        border: { type: 'line' },
        label: ` 🔍 Hex ${compactMode ? '' : 'View'} `,
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        mouse: true,
        style: {
          fg: 'white',
          border: { fg: 'magenta' }
        }
      });
    }

    // Permanent help bar like nano editor (2 rows)
    components.helpBar1 = blessed.box({
      parent: screen,
      bottom: 1,
      left: 0,
      width: '100%',
      height: 1,
      content: compactMode ? 
        '{white-fg}{black-bg} ^Q{/} Exit  {white-fg}{black-bg} ^I{/} Send  {white-fg}{black-bg} ^H{/} Hex  {white-fg}{black-bg} ^S{/} Stats  {white-fg}{black-bg} ^P{/} Pause  {white-fg}{black-bg} ^C{/} Clear {/}' :
        '{white-fg}{black-bg} ^Q{/} Exit     {white-fg}{black-bg} ^I{/} Send Msg   {white-fg}{black-bg} ^H{/} Hex View   {white-fg}{black-bg} ^S{/} Statistics   {white-fg}{black-bg} ^P{/} Pause     {white-fg}{black-bg} ^C{/} Clear {/}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    components.helpBar2 = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: compactMode ?
        '{white-fg}{black-bg} ^F{/} Filter {white-fg}{black-bg} ^E{/} Echo  {white-fg}{black-bg} ^L{/} Line  {white-fg}{black-bg} ^R{/} Reconnect                    {/}' :
        '{white-fg}{black-bg} ^F{/} Filter     {white-fg}{black-bg} ^E{/} Echo Mode  {white-fg}{black-bg} ^L{/} Line End   {white-fg}{black-bg} ^R{/} Auto-Reconnect                  {/}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });
  }

  // Handle terminal resize
  function handleResize() {
    // Destroy old components
    Object.values(components).forEach(component => {
      if (component && component.destroy) {
        component.destroy();
      }
    });
    components = {};
    
    // Recreate with new layout
    createComponents();
    updateStatusDisplay();
    screen.render();
  }

  // Enhanced message display with responsive formatting
  function addMessage(message, color = 'white') {
    if (pauseLogging || !components.dataArea) return;
    
    // Apply filter
    if (filterEnabled && filterText && !message.toLowerCase().includes(filterText.toLowerCase())) {
      return;
    }
    
    // Create responsive timestamp
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const [hours, minutes, seconds] = timeStr.split(':');
    
    // Adaptive timestamp format
    const timestamp = compactMode ?
      `{#666666-fg}[{/}{#4169E1-fg}${hours.substring(1)}{/}{#666666-fg}:{/}{#1E90FF-fg}${minutes}{/}{#666666-fg}:{/}{#00BFFF-fg}${seconds}{/}{#666666-fg}]{/}` :
      `{#666666-fg}[{/}{#4169E1-fg}${hours}{/}{#666666-fg}:{/}{#1E90FF-fg}${minutes}{/}{#666666-fg}:{/}{#00BFFF-fg}${seconds}{/}{#666666-fg}.{/}{#87CEEB-fg}${ms}{/}{#666666-fg}]{/}`;
    
    const coloredMsg = color === 'white' ? `{white-fg}${message}{/white-fg}` : `{${color}-fg}${message}{/${color}-fg}`;
    
    // Responsive message formatting
    const maxLength = Math.max(20, screenWidth - (compactMode ? 15 : 25));
    const truncatedMsg = message.length > maxLength ? message.substring(0, maxLength - 3) + '...' : message;
    const finalMsg = compactMode ? 
      `{${color}-fg}${truncatedMsg}{/${color}-fg}` : coloredMsg;
    
    components.dataArea.log(`${timestamp} ${finalMsg}`);
  }

  // Enhanced hex display with responsive formatting
  function addHexData(data) {
    if (!showHex || pauseLogging || !components.hexArea) return;
    
    const hex = Array.from(data)
      .map(byte => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    
    // Responsive hex formatting
    const now = new Date();
    const timeStr = now.toTimeString().substring(0, 8);
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const [hours, minutes, seconds] = timeStr.split(':');
    
    const timestamp = compactMode ?
      `{#666666-fg}[{/}{#4169E1-fg}${seconds}{/}{#666666-fg}]{/}` :
      `{#666666-fg}[{/}{#4169E1-fg}${hours}{/}{#666666-fg}:{/}{#1E90FF-fg}${minutes}{/}{#666666-fg}:{/}{#00BFFF-fg}${seconds}{/}{#666666-fg}.{/}{#87CEEB-fg}${ms}{/}{#666666-fg}]{/}`;
    
    // Responsive hex length
    const maxHexLength = Math.max(10, Math.floor((screenWidth * 0.3) / 3));
    const displayHex = hex.length > maxHexLength * 3 ? 
      hex.substring(0, maxHexLength * 3 - 3) + '...' : hex;
    
    components.hexArea.log(`${timestamp} {#CCCCCC-fg}${displayHex}{/}`);
  }

  // Smart status display with responsive layout
  function updateStatusDisplay() {
    if (!components.statusPanel) return;
    
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;
    const uptimeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    
    const rxRate = (bytesReceived / Math.max(1, uptime)).toFixed(1);
    const txRate = (bytesSent / Math.max(1, uptime)).toFixed(1);
    
    // Status with countdown
    let status;
    if (isReconnecting && reconnectStartTime) {
      const elapsed = Date.now() - reconnectStartTime;
      const remaining = Math.max(0, Math.ceil((currentReconnectDelay - elapsed) / 1000));
      status = `{yellow-fg}🔄 Reconnecting... #${reconnectAttempts} (${remaining}s){/yellow-fg}`;
    } else if (port && port.isOpen) {
      status = '{green-fg}🟢 Connected{/green-fg}';
    } else {
      status = '{red-fg}🔴 Disconnected{/red-fg}';
    }
    
    // Responsive status content
    if (compactMode) {
      // Compact single-line status
      const content = `{white-fg}${portPath}@${options.baud} | ${status} | ↓${bytesReceived} ↑${bytesSent} | ${autoReconnect ? '🔄' : '⏸️'}{/}`;
      components.statusPanel.setContent(content);
    } else if (showStats) {
      // Full statistics display
      const content = `{white-fg}📡 Port:{/} {bold}{cyan-fg}${portPath}{/}{/} | {white-fg}⚡ Baud:{/} {bold}{cyan-fg}${options.baud}{/}{/} | {white-fg}🔗 Status:{/} ${status} | {white-fg}⏱️ Uptime:{/} {bold}{cyan-fg}${uptimeStr}{/}{/}

{white-fg}📥 RX:{/} {bold}{green-fg}${bytesReceived.toLocaleString()}{/}{/} {white-fg}bytes ({/}{bold}{green-fg}${rxRate}{/}{/} {white-fg}B/s) | 📤 TX:{/} {bold}{blue-fg}${bytesSent.toLocaleString()}{/}{/} {white-fg}bytes ({/}{bold}{blue-fg}${txRate}{/}{/} {white-fg}B/s) | 📊 Messages:{/} {bold}{cyan-fg}${messagesReceived.toLocaleString()}{/}{/}

{white-fg}📝 Log:{/} ${pauseLogging ? '{red-fg}⏸️ PAUSED{/}' : '{green-fg}▶️ ACTIVE{/}'} | {white-fg}🔍 Hex:{/} ${showHex ? '{green-fg}👁️ ON{/}' : '{gray-fg}👁️ OFF{/}'} | {white-fg}🔊 Echo:{/} ${echoMode ? '{green-fg}🔊 ON{/}' : '{gray-fg}🔇 OFF{/}'} | {white-fg}📏 Line:{/} {bold}{cyan-fg}${lineEnding}{/}{/} | {white-fg}🎯 Filter:{/} ${filterEnabled ? `{yellow-fg}🎯 "${filterText}"{/}` : '{gray-fg}🚫 OFF{/}'} | {white-fg}🔄 Auto-reconnect:{/} ${autoReconnect ? '{green-fg}✅ ON{/}' : '{red-fg}❌ OFF{/}'}`;
      
      components.statusPanel.setContent(content);
    } else {
      // Medium detail status
      const content = `{white-fg}📡{/} {bold}{cyan-fg}${portPath}{/}{/} {white-fg}@ {/}{bold}{cyan-fg}${options.baud}{/}{/} | ${status} | {white-fg}⏱️{/} {bold}{cyan-fg}${uptimeStr}{/}{/} | {white-fg}📊{/} {bold}{cyan-fg}${messagesReceived}{/}{/} {white-fg}msgs{/}

{white-fg}📥{/} {bold}{green-fg}${(bytesReceived/1024).toFixed(1)}KB{/}{/} {white-fg}📤{/} {bold}{blue-fg}${(bytesSent/1024).toFixed(1)}KB{/}{/} | ${pauseLogging ? '{red-fg}⏸️{/}' : '{green-fg}▶️{/}'} | ${showHex ? '{green-fg}🔍{/}' : '{gray-fg}🔍{/}'} | ${autoReconnect ? '{green-fg}🔄{/}' : '{red-fg}🔄{/}'}`;
      
      components.statusPanel.setContent(content);
    }
  }

  // Enhanced input dialog with responsive sizing
  function showInputDialog() {
    if (!port || !port.isOpen) {
      addMessage('⚠️ Port not connected. Cannot send data.', 'yellow');
      return;
    }

    const dialogWidth = Math.min(60, Math.max(30, screenWidth - 10));
    const dialogHeight = compactMode ? 3 : 5;

    const input = blessed.textbox({
      parent: screen,
      top: 'center',
      left: 'center',
      width: dialogWidth,
      height: dialogHeight,
      border: { type: 'line' },
      label: ` 💬 Send Data (${lineEnding}) `,
      inputOnFocus: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'green' }
      }
    });

    input.focus();
    
    input.on('submit', (value) => {
      if (value && port && port.isOpen) {
        const endings = {LF: '\n', CR: '\r', CRLF: '\r\n'};
        const dataToSend = value + endings[lineEnding];
        
        try {
          port.write(dataToSend);
          if (echoMode) {
            addMessage(`→ ${value}`, 'blue');
          }
          bytesSent += Buffer.from(dataToSend).length;
        } catch (error) {
          addMessage(`❌ Send failed: ${error.message}`, 'red');
        }
      }
      input.destroy();
      screen.render();
    });

    input.on('cancel', () => {
      input.destroy();
      screen.render();
    });

    screen.render();
  }

  // Enhanced filter dialog
  function showFilterDialog() {
    const dialogWidth = Math.min(50, Math.max(25, screenWidth - 20));
    
    const filter = blessed.textbox({
      parent: screen,
      top: 'center',
      left: 'center',
      width: dialogWidth,
      height: 3,
      border: { type: 'line' },
      label: ' 🎯 Filter Text (empty to disable) ',
      inputOnFocus: true,
      content: filterText,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      }
    });

    filter.focus();
    
    filter.on('submit', (value) => {
      filterText = value || '';
      filterEnabled = Boolean(filterText);
      addMessage(`🎯 Filter ${filterEnabled ? 'enabled' : 'disabled'}: "${filterText}"`, 'yellow');
      filter.destroy();
      screen.render();
    });

    filter.on('cancel', () => {
      filter.destroy();
      screen.render();
    });

    screen.render();
  }

  // Auto-reconnect logic (unchanged but with better logging)
  function attemptReconnect() {
    if (!autoReconnect || isReconnecting) return;
    
    isReconnecting = true;
    reconnectAttempts++;
    currentReconnectDelay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), maxReconnectDelay);
    reconnectStartTime = Date.now();
    
    addMessage(`🔄 Reconnect attempt #${reconnectAttempts} starting in ${currentReconnectDelay/1000}s...`, 'cyan');
    
    reconnectTimer = setTimeout(async () => {
      try {
        addMessage(`🔌 Attempting to open ${portPath}...`, 'cyan');
        
        if (port) {
          try {
            port.removeAllListeners();
            if (port.isOpen) port.close();
          } catch (e) {}
        }
        
        port = new SerialPort({ 
          path: portPath, 
          baudRate: parseInt(options.baud),
          autoOpen: false
        });
        
        setupPortHandlers();
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
          port.open((error) => {
            clearTimeout(timeout);
            error ? reject(error) : resolve();
          });
        });
        
        const attemptCount = reconnectAttempts;
        isReconnecting = false;
        reconnectAttempts = 0;
        reconnectStartTime = null;
        currentReconnectDelay = 0;
        
        addMessage(`✅ Reconnected successfully after ${attemptCount} attempt${attemptCount > 1 ? 's' : ''}!`, 'green');
        
      } catch (error) {
        addMessage(`❌ Reconnect #${reconnectAttempts} failed: ${error.message}`, 'red');
        
        const permanentErrors = ['Access denied', 'Permission denied', 'EACCES', 'EPERM', 'Resource busy', 'EBUSY'];
        const isPermanentError = permanentErrors.some(errorType => error.message.includes(errorType));
        
        if (isPermanentError) {
          addMessage('⚠️ Permanent error - disabling auto-reconnect', 'yellow');
          autoReconnect = false;
          isReconnecting = false;
          reconnectAttempts = 0;
        } else {
          isReconnecting = false;
          setTimeout(() => {
            if (autoReconnect && (!port || !port.isOpen)) {
              attemptReconnect();
            }
          }, 1000);
        }
      }
    }, currentReconnectDelay);
  }

  function cancelReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    isReconnecting = false;
    reconnectAttempts = 0;
    reconnectStartTime = null;
    currentReconnectDelay = 0;
  }

  function setupPortHandlers() {
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    parser.on('data', (data) => {
      const cleanData = data.trim();
      addMessage(`← ${cleanData}`, 'green');
      bytesReceived += Buffer.from(data).length;
      messagesReceived++;
    });

    port.on('data', (data) => {
      addHexData(data);
    });

    port.on('error', (error) => {
      addMessage(`❌ Port error: ${error.message}`, 'red');
    });

    port.on('close', () => {
      addMessage('📴 Port disconnected', 'yellow');
      if (autoReconnect && !isReconnecting) {
        setTimeout(() => {
          if (autoReconnect && (!port || !port.isOpen)) {
            attemptReconnect();
          }
        }, 500);
      }
    });
  }

  // Enhanced keyboard shortcuts (nano-style with Ctrl+ combinations)
  screen.key(['q', 'C-q'], () => {
    cancelReconnect();
    if (port && port.isOpen) port.close();
    process.exit(0);
  });

  screen.key(['i', 'C-i'], showInputDialog);
  screen.key(['f', 'C-f'], showFilterDialog);

  screen.key(['h', 'C-h'], () => {
    showHex = !showHex;
    handleResize();
    addMessage(`🔍 Hex view ${showHex ? 'enabled' : 'disabled'}`, 'yellow');
  });

  screen.key(['s', 'C-s'], () => {
    showStats = !showStats;
    handleResize();
    addMessage(`📊 Statistics ${showStats ? 'enabled' : 'disabled'}`, 'yellow');
  });

  screen.key(['p', 'C-p'], () => {
    pauseLogging = !pauseLogging;
    addMessage(`📝 Logging ${pauseLogging ? 'paused' : 'resumed'}`, 'yellow');
  });

  screen.key(['c', 'C-c'], () => {
    if (components.dataArea) components.dataArea.setContent('');
    if (components.hexArea) components.hexArea.setContent('');
    addMessage('🧹 Logs cleared', 'yellow');
  });

  screen.key(['e', 'C-e'], () => {
    echoMode = !echoMode;
    addMessage(`🔊 Echo mode ${echoMode ? 'enabled' : 'disabled'}`, 'yellow');
  });

  screen.key(['l', 'C-l'], () => {
    const endings = ['LF', 'CR', 'CRLF'];
    const currentIndex = endings.indexOf(lineEnding);
    lineEnding = endings[(currentIndex + 1) % endings.length];
    addMessage(`📏 Line ending changed to ${lineEnding}`, 'yellow');
  });

  screen.key(['r', 'C-r'], () => {
    if (!autoReconnect) {
      autoReconnect = true;
      cancelReconnect();
      addMessage('🔄 Auto-reconnect enabled', 'green');
      if (!port || !port.isOpen) {
        setTimeout(() => attemptReconnect(), 500);
      }
    } else if (isReconnecting) {
      addMessage('🔄 Resetting reconnection attempts...', 'cyan');
      cancelReconnect();
      setTimeout(() => attemptReconnect(), 500);
    } else if (!port || !port.isOpen) {
      addMessage('🚀 Starting reconnection...', 'cyan');
      setTimeout(() => attemptReconnect(), 500);
    } else {
      autoReconnect = false;
      addMessage('⏸️ Auto-reconnect disabled', 'yellow');
      cancelReconnect();
    }
  });

  // Handle screen resize
  screen.on('resize', handleResize);

  // Timer for updates
  const updateTimer = setInterval(() => {
    updateStatusDisplay();
    screen.render();
  }, 1000);

  try {
    // Initialize port
    port = new SerialPort({ 
      path: portPath, 
      baudRate: parseInt(options.baud),
      autoOpen: false
    });

    setupPortHandlers();

    await new Promise((resolve, reject) => {
      port.open((error) => {
        error ? reject(error) : resolve();
      });
    });

    // Create initial UI
    createComponents();
    addMessage(`✅ Connected to ${portPath} at ${options.baud} baud`, 'green');
    updateStatusDisplay();
    
    // Focus on data area
    if (components.dataArea) {
      components.dataArea.focus();
    }
    
    screen.render();

  } catch (error) {
    cancelReconnect();
    clearInterval(updateTimer);
    screen.destroy();
    console.error(chalk.red('❌ Error in TUI monitor:'), error.message);
    process.exit(1);
  }
}

// Global error handler
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Fatal error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Unhandled rejection:'), reason);
  process.exit(1);
});

// Utility function to format port info
function formatPortInfo(port) {
  const info = [`${chalk.cyan(port.path)}`];
  
  if (port.manufacturer) {
    info.push(chalk.gray(`(${port.manufacturer})`));
  }
  
  if (port.serialNumber) {
    info.push(chalk.dim(`SN: ${port.serialNumber}`));
  }
  
  if (port.productId && port.vendorId) {
    info.push(chalk.dim(`PID: ${port.productId} VID: ${port.vendorId}`));
  }
  
  return info.join(' ');
}

// Helper function to prompt user input
function askQuestion(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Enhanced Command: List available serial ports with interactive selection
async function listPorts() {
  try {
    console.log(chalk.blue('📋 Scanning for serial ports...\n'));
    
    const ports = await SerialPort.list();
    
    if (ports.length === 0) {
      console.log(chalk.yellow('⚠️  No serial ports found'));
      return;
    }
    
    console.log(chalk.green(`✅ Found ${ports.length} serial port(s):\n`));
    
    ports.forEach((port, index) => {
      console.log(`${chalk.white(`${index + 1}.`)} ${formatPortInfo(port)}`);
    });
    
    console.log();
    
    // Interactive port selection
    while (true) {
      const selection = await askQuestion(
        chalk.cyan('🔗 Select a port to monitor (1-' + ports.length + '), or press Enter to exit: ')
      );
      
      // Allow exit with empty input
      if (!selection) {
        console.log(chalk.gray('👋 Goodbye!'));
        return;
      }
      
      const portIndex = parseInt(selection) - 1;
      
      if (isNaN(portIndex) || portIndex < 0 || portIndex >= ports.length) {
        console.log(chalk.red('❌ Invalid selection. Please enter a number between 1 and ' + ports.length));
        continue;
      }
      
      const selectedPort = ports[portIndex];
      console.log(chalk.green(`✅ Selected: ${formatPortInfo(selectedPort)}\n`));
      
      // Baud rate selection
      const commonBaudRates = [
        '9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600'
      ];
      
      console.log(chalk.blue('⚡ Common baud rates:'));
      commonBaudRates.forEach((rate, index) => {
        const marker = rate === '9600' ? chalk.green(' (default)') : '';
        console.log(`  ${index + 1}. ${rate}${marker}`);
      });
      console.log(`  ${commonBaudRates.length + 1}. Custom rate`);
      console.log();
      
      let baudRate = '9600'; // default
      
      while (true) {
        const baudSelection = await askQuestion(
          chalk.cyan('⚡ Select baud rate (1-' + (commonBaudRates.length + 1) + '), or press Enter for 9600: ')
        );
        
        if (!baudSelection) {
          // Use default 9600
          break;
        }
        
        const baudIndex = parseInt(baudSelection) - 1;
        
        if (baudIndex >= 0 && baudIndex < commonBaudRates.length) {
          baudRate = commonBaudRates[baudIndex];
          break;
        } else if (baudIndex === commonBaudRates.length) {
          // Custom rate
          while (true) {
            const customRate = await askQuestion(chalk.cyan('⚡ Enter custom baud rate: '));
            const rate = parseInt(customRate);
            
            if (isNaN(rate) || rate <= 0) {
              console.log(chalk.red('❌ Invalid baud rate. Please enter a positive number.'));
              continue;
            }
            
            baudRate = customRate;
            break;
          }
          break;
        } else {
          console.log(chalk.red('❌ Invalid selection. Please enter a number between 1 and ' + (commonBaudRates.length + 1)));
          continue;
        }
      }
      
      console.log(chalk.green(`✅ Baud rate: ${baudRate}\n`));
      console.log(chalk.blue('🚀 Starting TUI monitor...\n'));
      
      // Launch the TUI monitor
      try {
        await tuiMonitor(selectedPort.path, { baud: baudRate });
      } catch (error) {
        console.error(chalk.red('❌ Failed to start monitor:'), error.message);
        console.log(chalk.yellow('🔄 Returning to port selection...\n'));
        continue;
      }
      
      break;
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Error listing ports:'), error.message);
    process.exit(1);
  }
}

// Command: Read from serial port
async function readFromPort(portPath, options) {
  let port;
  
  try {
    console.log(chalk.blue(`📖 Opening ${portPath} at ${options.baud} baud...`));
    
    port = new SerialPort({ 
      path: portPath, 
      baudRate: parseInt(options.baud),
      autoOpen: false
    });
    
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    
    // Handle port events
    port.on('error', (error) => {
      console.error(chalk.red('❌ Port error:'), error.message);
      process.exit(1);
    });
    
    port.on('close', () => {
      console.log(chalk.yellow('\n📴 Port closed'));
      process.exit(0);
    });
    
    parser.on('data', (data) => {
      const timestamp = new Date().toISOString().substring(11, 23);
      console.log(`${chalk.gray(timestamp)} ${chalk.green('←')} ${data.trim()}`);
    });
    
    // Open the port
    await new Promise((resolve, reject) => {
      port.open((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    console.log(chalk.green('✅ Connected! Press Ctrl+C to exit\n'));
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down...'));
      if (port && port.isOpen) {
        port.close();
      }
    });
    
  } catch (error) {
    console.error(chalk.red('❌ Error reading from port:'), error.message);
    if (port && port.isOpen) {
      port.close();
    }
    process.exit(1);
  }
}

// Command: Write to serial port
async function writeToPort(portPath, data, options) {
  let port;
  
  try {
    console.log(chalk.blue(`✍️  Opening ${portPath} at ${options.baud} baud...`));
    
    port = new SerialPort({ 
      path: portPath, 
      baudRate: parseInt(options.baud),
      autoOpen: false
    });
    
    // Handle port events
    port.on('error', (error) => {
      console.error(chalk.red('❌ Port error:'), error.message);
      process.exit(1);
    });
    
    // Open the port
    await new Promise((resolve, reject) => {
      port.open((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    // Write data
    const writeData = data + (options.newline ? '\n' : '');
    
    await new Promise((resolve, reject) => {
      port.write(writeData, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    
    console.log(chalk.green(`✅ Sent: ${chalk.white(JSON.stringify(writeData))}`));
    
    // Close the port
    port.close();
    
  } catch (error) {
    console.error(chalk.red('❌ Error writing to port:'), error.message);
    if (port && port.isOpen) {
      port.close();
    }
    process.exit(1);
  }
}

// CLI Program setup
const program = new Command();

program
  .name('serialconsole')
  .description('Tiny cross-platform serial port console')
  .version('1.0.0');

// Enhanced List command with interactive selection
program
  .command('list')
  .alias('ls')
  .description('List available serial ports and interactively select one to monitor')
  .action(listPorts);

// Read command
program
  .command('read <port>')
  .alias('r')
  .description('Read data from serial port')
  .option('-b, --baud <rate>', 'Baud rate', '9600')
  .action(readFromPort);

// Write command
program
  .command('write <port> <data>')
  .alias('w')
  .description('Write data to serial port')
  .option('-b, --baud <rate>', 'Baud rate', '9600')
  .option('-n, --newline', 'Append newline to data', false)
  .action(writeToPort);

// Interactive mode command
program
  .command('interactive <port>')
  .alias('i')
  .description('Interactive mode (read and write)')
  .option('-b, --baud <rate>', 'Baud rate', '9600')
  .action(async (portPath, options) => {
    let port;
    
    try {
      console.log(chalk.blue(`🔄 Opening ${portPath} in interactive mode at ${options.baud} baud...`));
      
      port = new SerialPort({ 
        path: portPath, 
        baudRate: parseInt(options.baud),
        autoOpen: false
      });
      
      const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      
      // Handle incoming data
      parser.on('data', (data) => {
        const timestamp = new Date().toISOString().substring(11, 23);
        console.log(`${chalk.gray(timestamp)} ${chalk.green('←')} ${data.trim()}`);
      });
      
      // Handle port events
      port.on('error', (error) => {
        console.error(chalk.red('❌ Port error:'), error.message);
        process.exit(1);
      });
      
      port.on('close', () => {
        console.log(chalk.yellow('\n📴 Port closed'));
        process.exit(0);
      });
      
      // Open the port
      await new Promise((resolve, reject) => {
        port.open((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      
      console.log(chalk.green('✅ Connected! Type messages and press Enter. Press Ctrl+C to exit\n'));
      
      // Handle stdin for interactive input
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (input) => {
        const message = input.trim();
        if (message) {
          port.write(message + '\n');
          const timestamp = new Date().toISOString().substring(11, 23);
          console.log(`${chalk.gray(timestamp)} ${chalk.blue('→')} ${message}`);
        }
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\n🛑 Shutting down...'));
        if (port && port.isOpen) {
          port.close();
        }
      });
      
    } catch (error) {
      console.error(chalk.red('❌ Error in interactive mode:'), error.message);
      if (port && port.isOpen) {
        port.close();
      }
      process.exit(1);
    }
  });

// TUI Monitor command
program
  .command('monitor <port>')
  .alias('mon')
  .alias('m')
  .description('Responsive full-screen TUI monitor')
  .option('-b, --baud <rate>', 'Baud rate', '9600')
  .action(tuiMonitor);

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}

// Parse command line arguments
program.parse();