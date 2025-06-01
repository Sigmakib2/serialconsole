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
  let parser;
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
  let isShuttingDown = false;
  let updateTimer = null;
  let renderScheduled = false;
  
  // Create the screen with proper key handling
  const screen = blessed.screen({
    smartCSR: true,
    title: `ByteStream Monitor - ${portPath}`,
    fullUnicode: true,
    dockBorders: true,
    autoPadding: true
  });

  // UI State management
  let components = {};
  let keyHandlers = [];
  let screenHandlersAttached = false;

  // Optimized rendering function
  function scheduleRender() {
    if (!renderScheduled && !isShuttingDown) {
      renderScheduled = true;
      setImmediate(() => {
        if (!isShuttingDown) {
          try {
            screen.render();
          } catch (error) {
            // Ignore rendering errors during shutdown
          }
        }
        renderScheduled = false;
      });
    }
  }

  // Dynamic layout calculator
  function calculateLayout() {
    screenWidth = screen.width || 80;
    screenHeight = screen.height || 24;
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
        height: Math.max(3, screenHeight - (compactMode ? 5 : (showStats ? 7 : 6)))
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

  // Enhanced cleanup function for components
  function cleanupComponents() {
    Object.values(components).forEach(component => {
      if (component) {
        try {
          // Remove all event listeners before destroying
          if (component.removeAllListeners) {
            component.removeAllListeners();
          }
          if (component.destroy) {
            component.destroy();
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    });
    components = {};
  }

  // Create UI components with proper error handling
  function createComponents() {
    if (isShuttingDown) return;
    
    try {
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

      // Permanent help bar with working keys (2 rows)
      components.helpBar1 = blessed.box({
        parent: screen,
        bottom: 1,
        left: 0,
        width: '100%',
        height: 1,
        content: compactMode ? 
          '{white-fg}{black-bg} Q{/} Exit  {white-fg}{black-bg} I{/} Send  {white-fg}{black-bg} H{/} Hex  {white-fg}{black-bg} S{/} Stats  {white-fg}{black-bg} P{/} Pause  {white-fg}{black-bg} C{/} Clear {/}' :
          '{white-fg}{black-bg} Q{/} Exit     {white-fg}{black-bg} I{/} Send Msg   {white-fg}{black-bg} H{/} Hex View   {white-fg}{black-bg} S{/} Statistics   {white-fg}{black-bg} P{/} Pause     {white-fg}{black-bg} C{/} Clear {/}',
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
          '{white-fg}{black-bg} F{/} Filter {white-fg}{black-bg} E{/} Echo  {white-fg}{black-bg} L{/} Line  {white-fg}{black-bg} R{/} Reconnect {white-fg}{black-bg} ?{/} Help  {/}' :
          '{white-fg}{black-bg} F{/} Filter     {white-fg}{black-bg} E{/} Echo Mode  {white-fg}{black-bg} L{/} Line End   {white-fg}{black-bg} R{/} Auto-Reconnect {white-fg}{black-bg} ?{/} Help  {/}',
        tags: true,
        style: {
          fg: 'white',
          bg: 'black'
        }
      });
    } catch (error) {
      if (!isShuttingDown) {
        addMessage(`⚠️ UI creation error: ${error.message}`, 'yellow');
      }
    }
  }

  // Handle terminal resize with better error handling
  function handleResize() {
    if (isShuttingDown) return;
    
    try {
      // Cleanup old components properly
      cleanupComponents();
      
      // Recreate with new layout
      createComponents();
      updateStatusDisplay();
      scheduleRender();
    } catch (error) {
      if (!isShuttingDown) {
        console.error('Resize error:', error.message);
      }
    }
  }

  // Enhanced message display with better null checking
  function addMessage(message, color = 'white') {
    if (isShuttingDown || !components.dataArea) return;
    
    try {
      // Always show system messages (like pause notifications) even when paused
      const isSystemMessage = color === 'yellow' || color === 'cyan' || color === 'red';
      
      if (pauseLogging && !isSystemMessage) {
        return; // Skip regular messages when paused
      }
      
      // Apply filter if enabled (only for non-system messages)
      if (!isSystemMessage && filterEnabled && filterText && 
          !String(message || '').toLowerCase().includes(filterText.toLowerCase())) {
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
      
      // Ensure message is a string and handle null/undefined
      const messageStr = String(message || '');
      const coloredMsg = color === 'white' ? `{white-fg}${messageStr}{/white-fg}` : `{${color}-fg}${messageStr}{/${color}-fg}`;
      
      // Responsive message formatting
      const maxLength = Math.max(20, screenWidth - (compactMode ? 15 : 25));
      const truncatedMsg = messageStr.length > maxLength ? messageStr.substring(0, maxLength - 3) + '...' : messageStr;
      const finalMsg = compactMode ? 
        `{${color}-fg}${truncatedMsg}{/${color}-fg}` : coloredMsg;
      
      components.dataArea.log(`${timestamp} ${finalMsg}`);
      scheduleRender();
    } catch (error) {
      // Ignore message display errors to prevent cascading failures
    }
  }

  // Enhanced hex display with better error handling
  function addHexData(data) {
    if (isShuttingDown || !showHex || pauseLogging || !components.hexArea || !data) return;
    
    try {
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
      scheduleRender();
    } catch (error) {
      // Ignore hex display errors
    }
  }

  // Smart status display with better error handling
  function updateStatusDisplay() {
    if (isShuttingDown || !components.statusPanel) return;
    
    try {
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
      let content;
      if (compactMode) {
        // Compact single-line status
        content = `{white-fg}${portPath}@${options.baud} | ${status} | ↓${bytesReceived} ↑${bytesSent} | ${autoReconnect ? '🔄' : '⏸️'} | Press ? for help{/}`;
      } else if (showStats) {
        // Full statistics display
        content = `{white-fg}📡 Port:{/} {bold}{cyan-fg}${portPath}{/}{/} | {white-fg}⚡ Baud:{/} {bold}{cyan-fg}${options.baud}{/}{/} | {white-fg}🔗 Status:{/} ${status} | {white-fg}⏱️ Uptime:{/} {bold}{cyan-fg}${uptimeStr}{/}{/} | Press ? for help

{white-fg}📥 RX:{/} {bold}{green-fg}${bytesReceived.toLocaleString()}{/}{/} {white-fg}bytes ({/}{bold}{green-fg}${rxRate}{/}{/} {white-fg}B/s) | 📤 TX:{/} {bold}{blue-fg}${bytesSent.toLocaleString()}{/}{/} {white-fg}bytes ({/}{bold}{blue-fg}${txRate}{/}{/} {white-fg}B/s) | 📊 Messages:{/} {bold}{cyan-fg}${messagesReceived.toLocaleString()}{/}{/}

{white-fg}📝 Log:{/} ${pauseLogging ? '{red-fg}⏸️ PAUSED{/}' : '{green-fg}▶️ ACTIVE{/}'} | {white-fg}🔍 Hex:{/} ${showHex ? '{green-fg}👁️ ON{/}' : '{gray-fg}👁️ OFF{/}'} | {white-fg}🔊 Echo:{/} ${echoMode ? '{green-fg}🔊 ON{/}' : '{gray-fg}🔇 OFF{/}'} | {white-fg}📏 Line:{/} {bold}{cyan-fg}${lineEnding}{/}{/} | {white-fg}🎯 Filter:{/} ${filterEnabled ? `{yellow-fg}🎯 "${filterText}"{/}` : '{gray-fg}🚫 OFF{/}'} | {white-fg}🔄 Auto-reconnect:{/} ${autoReconnect ? '{green-fg}✅ ON{/}' : '{red-fg}❌ OFF{/}'}`;
      } else {
        // Medium detail status
        content = `{white-fg}📡{/} {bold}{cyan-fg}${portPath}{/}{/} {white-fg}@ {/}{bold}{cyan-fg}${options.baud}{/}{/} | ${status} | {white-fg}⏱️{/} {bold}{cyan-fg}${uptimeStr}{/}{/} | {white-fg}📊{/} {bold}{cyan-fg}${messagesReceived}{/}{/} {white-fg}msgs{/} | Press ? for help

{white-fg}📥{/} {bold}{green-fg}${(bytesReceived/1024).toFixed(1)}KB{/}{/} {white-fg}📤{/} {bold}{blue-fg}${(bytesSent/1024).toFixed(1)}KB{/}{/} | ${pauseLogging ? '{red-fg}⏸️{/}' : '{green-fg}▶️{/}'} | ${showHex ? '{green-fg}🔍{/}' : '{gray-fg}🔍{/}'} | ${autoReconnect ? '{green-fg}🔄{/}' : '{red-fg}🔄{/}'}`;
      }
      
      components.statusPanel.setContent(content);
    } catch (error) {
      // Ignore status display errors
    }
  }

  // Enhanced input dialog with better cleanup
  function showInputDialog() {
    if (isShuttingDown || !port || !port.isOpen) {
      addMessage('⚠️ Port not connected. Cannot send data.', 'yellow');
      return;
    }

    // Disable screen shortcuts while dialog is open
    disableScreenKeys();

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

    function closeDialog() {
      if (input && input.destroy) {
        input.removeAllListeners();
        input.destroy();
      }
      enableScreenKeys(); // Re-enable shortcuts when dialog closes
      scheduleRender();
    }

    // Set up event handlers with proper cleanup
    const submitHandler = (value) => {
      if (value && port && port.isOpen && !isShuttingDown) {
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
      closeDialog();
    };

    const cancelHandler = () => {
      closeDialog();
    };

    const escapeHandler = () => {
      closeDialog();
    };

    input.on('submit', submitHandler);
    input.on('cancel', cancelHandler);
    input.key(['escape'], escapeHandler);

    try {
      input.focus();
      scheduleRender();
    } catch (error) {
      closeDialog();
    }
  }

  // Enhanced filter dialog with better cleanup
  function showFilterDialog() {
    if (isShuttingDown) return;
    
    // Disable screen shortcuts while dialog is open
    disableScreenKeys();

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

    function closeDialog() {
      if (filter && filter.destroy) {
        filter.removeAllListeners();
        filter.destroy();
      }
      enableScreenKeys(); // Re-enable shortcuts when dialog closes
      scheduleRender();
    }

    const submitHandler = (value) => {
      filterText = value || '';
      filterEnabled = Boolean(filterText);
      addMessage(`🎯 Filter ${filterEnabled ? 'enabled' : 'disabled'}: "${filterText}"`, 'yellow');
      closeDialog();
    };

    const cancelHandler = () => {
      closeDialog();
    };

    const escapeHandler = () => {
      closeDialog();
    };

    filter.on('submit', submitHandler);
    filter.on('cancel', cancelHandler);
    filter.key(['escape'], escapeHandler);

    try {
      filter.focus();
      scheduleRender();
    } catch (error) {
      closeDialog();
    }
  }

  // Auto-reconnect logic with better error handling and race condition prevention
  function attemptReconnect() {
    if (!autoReconnect || isReconnecting || isShuttingDown) return;
    
    isReconnecting = true;
    reconnectAttempts++;
    currentReconnectDelay = Math.min(1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)), maxReconnectDelay);
    reconnectStartTime = Date.now();
    
    addMessage(`🔄 Reconnect attempt #${reconnectAttempts} starting in ${currentReconnectDelay/1000}s...`, 'cyan');
    
    reconnectTimer = setTimeout(async () => {
      if (isShuttingDown || !autoReconnect) {
        isReconnecting = false;
        return;
      }
      
      try {
        addMessage(`🔌 Attempting to open ${portPath}...`, 'cyan');
        
        // Cleanup existing port
        if (port) {
          try {
            if (parser) {
              parser.removeAllListeners();
              parser = null;
            }
            port.removeAllListeners();
            if (port.isOpen) {
              await new Promise(resolve => {
                port.close(resolve);
              });
            }
          } catch (e) {
            // Ignore close errors
          }
        }
        
        // Create new port
        port = new SerialPort({ 
          path: portPath, 
          baudRate: parseInt(options.baud),
          autoOpen: false
        });
        
        setupPortHandlers();
        
        // Open with timeout
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
        if (isShuttingDown) return;
        
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
          // Schedule next attempt with a small delay
          setTimeout(() => {
            if (autoReconnect && (!port || !port.isOpen) && !isShuttingDown) {
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

  // Enhanced port setup with better error handling
  function setupPortHandlers() {
    if (!port || isShuttingDown) return;

    try {
      // Remove any existing listeners to prevent duplicates
      port.removeAllListeners();
      
      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

      parser.on('data', (data) => {
        if (isShuttingDown) return;
        const cleanData = data.trim();
        if (cleanData) {
          addMessage(`← ${cleanData}`, 'green');
          messagesReceived++;
        }
        bytesReceived += Buffer.from(data).length;
      });

      port.on('data', (data) => {
        if (isShuttingDown) return;
        addHexData(data);
      });

      port.on('error', (error) => {
        if (isShuttingDown) return;
        addMessage(`❌ Port error: ${error.message}`, 'red');
      });

      port.on('close', () => {
        if (isShuttingDown) return;
        addMessage('📴 Port disconnected', 'yellow');
        if (autoReconnect && !isReconnecting) {
          setTimeout(() => {
            if (autoReconnect && (!port || !port.isOpen) && !isShuttingDown) {
              attemptReconnect();
            }
          }, 500);
        }
      });
    } catch (error) {
      if (!isShuttingDown) {
        addMessage(`⚠️ Error setting up port handlers: ${error.message}`, 'yellow');
      }
    }
  }

  // Help dialog function with better cleanup
  function showHelpDialog() {
    if (isShuttingDown) return;
    
    // Disable screen shortcuts while dialog is open
    disableScreenKeys();

    const helpDialog = blessed.box({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '70%',
      border: { type: 'line' },
      label: ' 🎮 Keyboard Shortcuts Help ',
      content: `{center}{bold}SerialConsole Keyboard Shortcuts{/bold}{/center}

{yellow-fg}{bold}Main Controls:{/bold}{/yellow-fg}
{white-fg}Q{/white-fg} - Exit application
{white-fg}I{/white-fg} - Send message to serial port
{white-fg}F{/white-fg} - Set message filter
{white-fg}H{/white-fg} - Toggle hex viewer on/off
{white-fg}S{/white-fg} - Toggle statistics panel
{white-fg}P{/white-fg} or {white-fg}Space{/white-fg} - Pause/resume logging
{white-fg}C{/white-fg} - Clear screen
{white-fg}E{/white-fg} - Toggle echo mode
{white-fg}L{/white-fg} - Cycle line endings (LF/CR/CRLF)
{white-fg}R{/white-fg} - Toggle auto-reconnect

{yellow-fg}{bold}Navigation:{/bold}{/yellow-fg}
{white-fg}Escape{/white-fg} - Close dialogs
{white-fg}?{/white-fg} - Show this help
{white-fg}Ctrl+C{/white-fg} - Force exit

{yellow-fg}{bold}Current Status:{/bold}{/yellow-fg}
• Hex View: ${showHex ? '{green-fg}ON{/green-fg}' : '{red-fg}OFF{/red-fg}'}
• Statistics: ${showStats ? '{green-fg}ON{/green-fg}' : '{red-fg}OFF{/red-fg}'}
• Logging: ${pauseLogging ? '{red-fg}PAUSED{/red-fg}' : '{green-fg}ACTIVE{/green-fg}'}
• Echo Mode: ${echoMode ? '{green-fg}ON{/green-fg}' : '{red-fg}OFF{/red-fg}'}
• Auto-Reconnect: ${autoReconnect ? '{green-fg}ON{/green-fg}' : '{red-fg}OFF{/red-fg}'}
• Line Ending: {cyan-fg}${lineEnding}{/cyan-fg}
• Filter: ${filterEnabled ? `{yellow-fg}${filterText}{/yellow-fg}` : '{red-fg}OFF{/red-fg}'}

{center}{gray-fg}Press any key to close this help{/gray-fg}{/center}`,
      tags: true,
      scrollable: true,
      style: {
        fg: 'white',
        bg: 'black',
        border: { fg: 'cyan' }
      }
    });

    function closeHelp() {
      if (helpDialog && helpDialog.destroy) {
        helpDialog.removeAllListeners();
        helpDialog.destroy();
      }
      enableScreenKeys(); // Re-enable shortcuts when dialog closes
      scheduleRender();
    }

    helpDialog.key(['escape', 'enter', 'q', 'space', '?'], closeHelp);
    helpDialog.on('keypress', closeHelp);

    try {
      helpDialog.focus();
      scheduleRender();
    } catch (error) {
      closeHelp();
    }
  }

  // Enhanced keyboard handler management
  function setupKeyHandlers() {
    if (screenHandlersAttached) return;
    
    // Store all key handlers so we can disable them during dialogs
    const handlers = [
      // Exit - Q key and Ctrl+Q
      { keys: ['q', 'Q', 'C-c'], handler: () => {
        cleanup();
        process.exit(0);
      }},

      // Send message - I key
      { keys: ['i', 'I'], handler: () => {
        showInputDialog();
      }},
      
      // Filter - F key
      { keys: ['f', 'F'], handler: () => {
        showFilterDialog();
      }},

      // Toggle hex view - H key
      { keys: ['h', 'H'], handler: () => {
        showHex = !showHex;
        handleResize();
        addMessage(`🔍 Hex view ${showHex ? 'enabled' : 'disabled'}`, 'yellow');
      }},

      // Toggle statistics - S key
      { keys: ['s', 'S'], handler: () => {
        showStats = !showStats;
        handleResize();
        addMessage(`📊 Statistics ${showStats ? 'enabled' : 'disabled'}`, 'yellow');
      }},

      // Pause logging - P key and Space
      { keys: ['p', 'P', 'space'], handler: () => {
        pauseLogging = !pauseLogging;
        const status = pauseLogging ? 'paused' : 'resumed';
        addMessage(`📝 Logging ${status}`, 'yellow');
        updateStatusDisplay();
      }},

      // Clear screen - C key
      { keys: ['c', 'C'], handler: () => {
        if (components.dataArea) {
          components.dataArea.setContent('');
        }
        if (components.hexArea) {
          components.hexArea.setContent('');
        }
        addMessage('🧹 Logs cleared', 'yellow');
        scheduleRender();
      }},

      // Toggle echo mode - E key
      { keys: ['e', 'E'], handler: () => {
        echoMode = !echoMode;
        addMessage(`🔊 Echo mode ${echoMode ? 'enabled' : 'disabled'}`, 'yellow');
      }},

      // Cycle line endings - L key
      { keys: ['l', 'L'], handler: () => {
        const endings = ['LF', 'CR', 'CRLF'];
        const currentIndex = endings.indexOf(lineEnding);
        lineEnding = endings[(currentIndex + 1) % endings.length];
        addMessage(`📏 Line ending changed to ${lineEnding}`, 'yellow');
      }},

      // Toggle auto-reconnect - R key
      { keys: ['r', 'R'], handler: () => {
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
      }},

      // Help - ? key
      { keys: ['?'], handler: () => {
        showHelpDialog();
      }}
    ];

    // Bind all handlers
    try {
      handlers.forEach(({keys, handler}) => {
        screen.key(keys, handler);
        keyHandlers.push({keys, handler});
      });
      screenHandlersAttached = true;
      
      addMessage('🎮 Keyboard shortcuts loaded. Press ? for help', 'cyan');
    } catch (error) {
      addMessage(`⚠️ Error setting up keyboard shortcuts: ${error.message}`, 'yellow');
    }
  }

  // Function to temporarily disable screen shortcuts
  function disableScreenKeys() {
    try {
      keyHandlers.forEach(({keys, handler}) => {
        screen.unkey(keys, handler);
      });
    } catch (error) {
      // Ignore unkey errors
    }
  }

  // Function to re-enable screen shortcuts
  function enableScreenKeys() {
    try {
      keyHandlers.forEach(({keys, handler}) => {
        screen.key(keys, handler);
      });
    } catch (error) {
      // Ignore key binding errors
    }
  }

  // Enhanced cleanup function
  function cleanup() {
    if (isShuttingDown) return;
    isShuttingDown = true;

    try {
      // Cancel all timers
      cancelReconnect();
      if (updateTimer) {
        clearInterval(updateTimer);
        updateTimer = null;
      }

      // Cleanup port
      if (port) {
        try {
          if (parser) {
            parser.removeAllListeners();
          }
          port.removeAllListeners();
          if (port.isOpen) {
            port.close();
          }
        } catch (e) {
          // Ignore close errors
        }
      }

      // Cleanup components and screen
      cleanupComponents();
      if (screen) {
        try {
          screen.removeAllListeners();
          screen.destroy();
        } catch (e) {
          // Ignore screen cleanup errors
        }
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  // Handle process termination
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  // Handle screen resize
  screen.on('resize', handleResize);

  try {
    // Initialize port
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

    // Create initial UI
    createComponents();
    
    // Setup keyboard shortcuts AFTER components are created
    setupKeyHandlers();
    
    addMessage(`✅ Connected to ${portPath} at ${options.baud} baud`, 'green');
    updateStatusDisplay();
    
    // Timer for updates with error handling
    updateTimer = setInterval(() => {
      if (!isShuttingDown) {
        try {
          updateStatusDisplay();
          scheduleRender();
        } catch (error) {
          // Ignore update errors
        }
      }
    }, 1000);
    
    scheduleRender();

  } catch (error) {
    cleanup();
    console.error(chalk.red('❌ Error in TUI monitor:'), error.message);
    process.exit(1);
  }
}

// Global error handlers with better logging
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

// Helper function to prompt user input with validation
function askQuestion(question, validator = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    const ask = () => {
      rl.question(question, (answer) => {
        const trimmedAnswer = answer.trim();
        
        if (validator) {
          const validation = validator(trimmedAnswer);
          if (validation !== true) {
            console.log(chalk.red(validation));
            return ask();
          }
        }
        
        rl.close();
        resolve(trimmedAnswer);
      });
    };
    ask();
  });
}

// Enhanced Command: List available serial ports with interactive selection
async function listPorts() {
  try {
    console.log(chalk.blue('📋 Scanning for serial ports...\n'));
    
    const ports = await SerialPort.list();
    
    if (ports.length === 0) {
      console.log(chalk.yellow('⚠️  No serial ports found'));
      console.log(chalk.gray('Make sure your device is connected and drivers are installed.'));
      return;
    }
    
    console.log(chalk.green(`✅ Found ${ports.length} serial port(s):\n`));
    
    ports.forEach((port, index) => {
      console.log(`${chalk.white(`${index + 1}.`)} ${formatPortInfo(port)}`);
    });
    
    console.log();
    
    // Interactive port selection with validation
    while (true) {
      const selection = await askQuestion(
        chalk.cyan('🔗 Select a port to monitor (1-' + ports.length + '), or press Enter to exit: '),
        (input) => {
          if (!input) return true; // Allow empty for exit
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > ports.length) {
            return `Invalid selection. Please enter a number between 1 and ${ports.length}`;
          }
          return true;
        }
      );
      
      // Allow exit with empty input
      if (!selection) {
        console.log(chalk.gray('👋 Goodbye!'));
        return;
      }
      
      const portIndex = parseInt(selection) - 1;
      const selectedPort = ports[portIndex];
      console.log(chalk.green(`✅ Selected: ${formatPortInfo(selectedPort)}\n`));
      
      // Baud rate selection with validation
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
      
      const baudSelection = await askQuestion(
        chalk.cyan('⚡ Select baud rate (1-' + (commonBaudRates.length + 1) + '), or press Enter for 9600: '),
        (input) => {
          if (!input) return true; // Allow empty for default
          const num = parseInt(input);
          if (isNaN(num) || num < 1 || num > (commonBaudRates.length + 1)) {
            return `Invalid selection. Please enter a number between 1 and ${commonBaudRates.length + 1}`;
          }
          return true;
        }
      );
      
      if (baudSelection) {
        const baudIndex = parseInt(baudSelection) - 1;
        
        if (baudIndex >= 0 && baudIndex < commonBaudRates.length) {
          baudRate = commonBaudRates[baudIndex];
        } else if (baudIndex === commonBaudRates.length) {
          // Custom rate
          baudRate = await askQuestion(
            chalk.cyan('⚡ Enter custom baud rate: '),
            (input) => {
              const rate = parseInt(input);
              if (isNaN(rate) || rate <= 0) {
                return 'Invalid baud rate. Please enter a positive number.';
              }
              return true;
            }
          );
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

// Command: Read from serial port with enhanced error handling
async function readFromPort(portPath, options) {
  let port;
  let parser;
  
  try {
    console.log(chalk.blue(`📖 Opening ${portPath} at ${options.baud} baud...`));
    
    port = new SerialPort({ 
      path: portPath, 
      baudRate: parseInt(options.baud),
      autoOpen: false
    });
    
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    
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
    
    // Open the port with timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      port.open((error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      });
    });
    
    console.log(chalk.green('✅ Connected! Press Ctrl+C to exit\n'));
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n🛑 Shutting down...'));
      if (parser) {
        parser.removeAllListeners();
      }
      if (port && port.isOpen) {
        port.close();
      }
    });
    
  } catch (error) {
    console.error(chalk.red('❌ Error reading from port:'), error.message);
    if (parser) {
      parser.removeAllListeners();
    }
    if (port && port.isOpen) {
      port.close();
    }
    process.exit(1);
  }
}

// Command: Write to serial port with enhanced error handling
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
    
    // Open the port with timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
      port.open((error) => {
        clearTimeout(timeout);
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

// Interactive mode command with enhanced error handling
program
  .command('interactive <port>')
  .alias('i')
  .description('Interactive mode (read and write)')
  .option('-b, --baud <rate>', 'Baud rate', '9600')
  .action(async (portPath, options) => {
    let port;
    let parser;
    
    try {
      console.log(chalk.blue(`🔄 Opening ${portPath} in interactive mode at ${options.baud} baud...`));
      
      port = new SerialPort({ 
        path: portPath, 
        baudRate: parseInt(options.baud),
        autoOpen: false
      });
      
      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      
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
      
      // Open the port with timeout
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        port.open((error) => {
          clearTimeout(timeout);
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
        if (parser) {
          parser.removeAllListeners();
        }
        if (port && port.isOpen) {
          port.close();
        }
      });
      
    } catch (error) {
      console.error(chalk.red('❌ Error in interactive mode:'), error.message);
      if (parser) {
        parser.removeAllListeners();
      }
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