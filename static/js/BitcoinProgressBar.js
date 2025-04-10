/**
 * BitcoinMinuteRefresh.js - Simplified Bitcoin-themed floating uptime monitor
 * 
 * This module creates a Bitcoin-themed terminal that shows server uptime.
 */

const BitcoinMinuteRefresh = (function () {
    // Constants
    const STORAGE_KEY = 'bitcoin_last_refresh_time'; // For cross-page sync

    // Private variables
    let terminalElement = null;
    let uptimeElement = null;
    let serverTimeOffset = 0;
    let serverStartTime = null;
    let uptimeInterval = null;
    let isInitialized = false;
    let refreshCallback = null;

    /**
     * Add dragging functionality to the terminal
     */
    function addDraggingBehavior() {
        // Find the terminal element
        const terminal = document.getElementById('bitcoin-terminal') ||
            document.querySelector('.bitcoin-terminal') ||
            document.getElementById('retro-terminal-bar');

        if (!terminal) {
            console.warn('Terminal element not found for drag behavior');
            return;
        }

        let isDragging = false;
        let startX = 0;
        let startLeft = 0;

        // Function to handle mouse down (drag start)
        function handleMouseDown(e) {
            // Only enable dragging in desktop view
            if (window.innerWidth < 768) return;

            // Don't handle drag if clicking on controls
            if (e.target.closest('.terminal-dot')) return;

            isDragging = true;
            terminal.classList.add('dragging');

            // Calculate start position
            startX = e.clientX;

            // Get current left position accounting for different possible styles
            const style = window.getComputedStyle(terminal);
            if (style.left !== 'auto') {
                startLeft = parseInt(style.left) || 0;
            } else {
                // Calculate from right if left is not set
                startLeft = window.innerWidth -
                    (parseInt(style.right) || 0) -
                    terminal.offsetWidth;
            }

            e.preventDefault(); // Prevent text selection
        }

        // Function to handle mouse move (dragging)
        function handleMouseMove(e) {
            if (!isDragging) return;

            // Calculate the horizontal movement - vertical stays fixed
            const deltaX = e.clientX - startX;
            let newLeft = startLeft + deltaX;

            // Constrain to window boundaries
            const maxLeft = window.innerWidth - terminal.offsetWidth;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));

            // Update position - only horizontally along bottom
            terminal.style.left = newLeft + 'px';
            terminal.style.right = 'auto'; // Remove right positioning
            terminal.style.transform = 'none'; // Remove transformations
        }

        // Function to handle mouse up (drag end)
        function handleMouseUp() {
            if (isDragging) {
                isDragging = false;
                terminal.classList.remove('dragging');
            }
        }

        // Find the terminal header for dragging
        const terminalHeader = terminal.querySelector('.terminal-header');
        if (terminalHeader) {
            terminalHeader.addEventListener('mousedown', handleMouseDown);
        } else {
            // If no header found, make the whole terminal draggable
            terminal.addEventListener('mousedown', handleMouseDown);
        }

        // Add mousemove and mouseup listeners to document
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        // Handle window resize to keep terminal visible
        window.addEventListener('resize', function () {
            if (window.innerWidth < 768) {
                // Reset position for mobile view
                terminal.style.left = '50%';
                terminal.style.right = 'auto';
                terminal.style.transform = 'translateX(-50%)';
            } else {
                // Ensure terminal stays visible in desktop view
                const maxLeft = window.innerWidth - terminal.offsetWidth;
                const currentLeft = parseInt(window.getComputedStyle(terminal).left) || 0;

                if (currentLeft > maxLeft) {
                    terminal.style.left = maxLeft + 'px';
                }
            }
        });
    }

    /**
     * Create and inject the retro terminal element into the DOM
     */
    function createTerminalElement() {
        // Container element
        terminalElement = document.createElement('div');
        terminalElement.id = 'bitcoin-terminal';
        terminalElement.className = 'bitcoin-terminal';

        // Terminal content - simplified for uptime-only
        terminalElement.innerHTML = `
      <div class="terminal-header">
        <div class="terminal-title">SYSTEM MONITOR v.3</div>
        <div class="terminal-controls">
          <div class="terminal-dot minimize" title="Minimize" onclick="BitcoinMinuteRefresh.toggleTerminal()"></div>
          <div class="terminal-dot close" title="Close" onclick="BitcoinMinuteRefresh.hideTerminal()"></div>
        </div>
      </div>
      <div class="terminal-content">
        <div class="status-row">
          <div class="status-indicator">
            <div class="status-dot connected"></div>
            <span>LIVE</span>
          </div>
          <span id="terminal-clock" class="terminal-clock">00:00:00</span>
        </div>
        <div id="uptime-timer" class="uptime-timer">
          <div class="uptime-title">UPTIME</div>
          <div class="uptime-display">
            <div class="uptime-value">
              <span id="uptime-hours" class="uptime-number">00</span>
              <span class="uptime-label">H</span>
            </div>
            <div class="uptime-separator">:</div>
            <div class="uptime-value">
              <span id="uptime-minutes" class="uptime-number">00</span>
              <span class="uptime-label">M</span>
            </div>
            <div class="uptime-separator">:</div>
            <div class="uptime-value">
              <span id="uptime-seconds" class="uptime-number">00</span>
              <span class="uptime-label">S</span>
            </div>
          </div>
        </div>
      </div>
      <div class="terminal-minimized">
        <div class="minimized-uptime">
          <span class="mini-uptime-label">UPTIME</span>
          <span id="minimized-uptime-value">00:00:00</span>
        </div>
        <div class="minimized-status-dot connected"></div>
      </div>
    `;

        // Append to body
        document.body.appendChild(terminalElement);

        // Add dragging behavior
        addDraggingBehavior();

        // Cache element references
        uptimeElement = document.getElementById('uptime-timer');

        // Check if terminal was previously collapsed
        if (localStorage.getItem('bitcoin_terminal_collapsed') === 'true') {
            terminalElement.classList.add('collapsed');
        }

        // Add custom styles if not already present
        if (!document.getElementById('bitcoin-terminal-styles')) {
            addStyles();
        }
    }

    /**
     * Add CSS styles for the terminal
     */
    function addStyles() {
        const styleElement = document.createElement('style');
        styleElement.id = 'bitcoin-terminal-styles';
        styleElement.textContent = `
      /* Terminal Container */
      .bitcoin-terminal {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 230px;
        background-color: #000000;
        border: 1px solid #f7931a;
        color: #f7931a;
        font-family: 'VT323', monospace;
        z-index: 9999;
        overflow: hidden;
        padding: 8px;
        transition: all 0.3s ease;
        box-shadow: 0 0 5px rgba(247, 147, 26, 0.3);
      }
      
      /* Terminal Header */
      .terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #f7931a;
        padding-bottom: 5px;
        margin-bottom: 8px;
        cursor: pointer; /* Add pointer (hand) cursor on hover */
      }

      /* Apply grabbing cursor during active drag */
      .terminal-header:active,
      .bitcoin-terminal.dragging .terminal-header {
        cursor: grabbing;
      }
      
      .terminal-title {
        color: #f7931a;
        font-weight: bold;
        font-size: 1.1rem;
        text-shadow: 0 0 5px rgba(247, 147, 26, 0.8);
        animation: terminal-flicker 4s infinite;
      }
      
      /* Control Dots */
      .terminal-controls {
        display: flex;
        gap: 5px;
        margin-left: 5px;
      }
      
      .terminal-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #555;
        cursor: pointer;
        transition: background-color 0.3s;
      }
      
      .terminal-dot.minimize:hover {
        background-color: #ffcc00;
      }
      
      .terminal-dot.close:hover {
        background-color: #ff3b30;
      }
      
      /* Terminal Content */
      .terminal-content {
        position: relative;
      }
      
      /* Status Row */
      .status-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      /* Status Indicator */
      .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.8rem;
      }
      
      .status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      
      .status-dot.connected {
        background-color: #32CD32;
        box-shadow: 0 0 5px #32CD32;
        animation: pulse 2s infinite;
      }
      
      .terminal-clock {
        font-size: 1rem;
        font-weight: bold;
        text-shadow: 0 0 5px rgba(247, 147, 26, 0.5);
      }
      
      /* Uptime Display - Modern Digital Clock Style (Horizontal) */
      .uptime-timer {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 5px;
        background-color: #111;
        border: 1px solid rgba(247, 147, 26, 0.5);
        margin-top: 5px;
      }
      
      .uptime-display {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2px;
        margin-top: 5px;
      }
      
      .uptime-value {
        display: flex;
        align-items: baseline;
      }
      
      .uptime-number {
        font-size: 1.4rem;
        font-weight: bold;
        background-color: #000;
        padding: 2px 5px;
        border-radius: 3px;
        min-width: 32px;
        display: inline-block;
        text-align: center;
        letter-spacing: 2px;
        text-shadow: 0 0 8px rgba(247, 147, 26, 0.8);
        color: #dee2e6;
      }
      
      .uptime-label {
        font-size: 0.7rem;
        opacity: 0.7;
        margin-left: 2px;
      }
      
      .uptime-separator {
        font-size: 1.4rem;
        font-weight: bold;
        padding: 0 2px;
        text-shadow: 0 0 8px rgba(247, 147, 26, 0.8);
      }
      
      .uptime-title {
        font-size: 0.7rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;
        text-shadow: 0 0 5px rgba(247, 147, 26, 0.8);
        margin-bottom: 3px;
      }
      
      /* Show button */
      #bitcoin-terminal-show {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background-color: #f7931a;
        color: #000;
        border: none;
        padding: 8px 12px;
        font-family: 'VT323', monospace;
        cursor: pointer;
        z-index: 9999;
        display: none;
        box-shadow: 0 0 10px rgba(247, 147, 26, 0.5);
      }
      
      /* CRT scanline effect */
      .terminal-content::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.15),
          rgba(0, 0, 0, 0.15) 1px,
          transparent 1px,
          transparent 2px
        );
        pointer-events: none;
        z-index: 1;
      }
      
      /* Minimized view styling */
      .terminal-minimized {
        display: none;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        padding: 4px 10px;
        background-color: #000;
        position: relative;
      }
      
      .terminal-minimized::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: repeating-linear-gradient(
          0deg,
          rgba(0, 0, 0, 0.15),
          rgba(0, 0, 0, 0.15) 1px,
          transparent 1px,
          transparent 2px
        );
        pointer-events: none;
        z-index: 1;
      }
      
      .minimized-uptime {
        display: flex;
        flex-direction: column;
        align-items: center;
        position: relative;
        z-index: 2;
      }
      
      .mini-uptime-label {
        font-size: 0.6rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 1px;
        opacity: 0.7;
        margin-left: 45px;
        color: #f7931a;
      }
      
      #minimized-uptime-value {
        font-size: 0.9rem;
        font-weight: bold;
        text-shadow: 0 0 5px rgba(247, 147, 26, 0.5);
        margin-left: 45px;
        color: #dee2e6;
      }
      
      .minimized-status-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        margin-left: 10px;
        position: relative;
        z-index: 2;
      }
      
      /* Collapsed state */
      .bitcoin-terminal.collapsed {
        width: auto;
        max-width: 500px;
        height: auto;
        padding: 5px;
      }
      
      .bitcoin-terminal.collapsed .terminal-content {
        display: none;
      }
      
      .bitcoin-terminal.collapsed .terminal-minimized {
        display: flex;
      }
      
      .bitcoin-terminal.collapsed .terminal-header {
        border-bottom: none;
        margin-bottom: 2px;
        padding-bottom: 2px;
      }
      
      /* Animations */
      @keyframes pulse {
        0%, 100% { opacity: 0.8; }
        50% { opacity: 1; }
      }
      
      @keyframes terminal-flicker {
        0% { opacity: 0.97; }
        5% { opacity: 0.95; }
        10% { opacity: 0.97; }
        15% { opacity: 0.94; }
        20% { opacity: 0.98; }
        50% { opacity: 0.95; }
        80% { opacity: 0.96; }
        90% { opacity: 0.94; }
        100% { opacity: 0.98; }
      }
      
      /* Media Queries */
      @media (max-width: 768px) {
        .bitcoin-terminal {
          left: 50%;
          right: auto;
          transform: translateX(-50%);
          width: 90%;
          max-width: 320px;
          bottom: 10px;
        }

        .bitcoin-terminal.collapsed {
          width: auto;
          max-width: 300px;
          left: 50%;
          right: auto;
          transform: translateX(-50%);
        }
      }
    `;

        document.head.appendChild(styleElement);
    }

    /**
     * Update the terminal clock
     */
    function updateClock() {
        try {
            const now = new Date(Date.now() + (serverTimeOffset || 0));
            let hours = now.getHours();
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            const timeString = `${String(hours).padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;

            // Update clock in normal view
            const clockElement = document.getElementById('terminal-clock');
            if (clockElement) {
                clockElement.textContent = timeString;
            }
        } catch (e) {
            console.error("BitcoinMinuteRefresh: Error updating clock:", e);
        }
    }

    /**
     * Update the uptime display
     */
    function updateUptime() {
        if (serverStartTime) {
            try {
                const currentServerTime = Date.now() + serverTimeOffset;
                const diff = currentServerTime - serverStartTime;

                // Calculate hours, minutes, seconds
                const hours = Math.floor(diff / (1000 * 60 * 60));
                const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((diff % (1000 * 60)) / 1000);

                // Update the main uptime display with digital clock style
                const uptimeHoursElement = document.getElementById('uptime-hours');
                const uptimeMinutesElement = document.getElementById('uptime-minutes');
                const uptimeSecondsElement = document.getElementById('uptime-seconds');

                if (uptimeHoursElement) {
                    uptimeHoursElement.textContent = String(hours).padStart(2, '0');
                }
                if (uptimeMinutesElement) {
                    uptimeMinutesElement.textContent = String(minutes).padStart(2, '0');
                }
                if (uptimeSecondsElement) {
                    uptimeSecondsElement.textContent = String(seconds).padStart(2, '0');
                }

                // Update the minimized uptime display
                const minimizedUptimeElement = document.getElementById('minimized-uptime-value');
                if (minimizedUptimeElement) {
                    minimizedUptimeElement.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                }
            } catch (e) {
                console.error("BitcoinMinuteRefresh: Error updating uptime:", e);
            }
        }
    }

    /**
     * Notify other tabs that data has been refreshed
     */
    function notifyRefresh() {
        const now = Date.now();
        localStorage.setItem(STORAGE_KEY, now.toString());
        localStorage.setItem('bitcoin_refresh_event', 'refresh-' + now);
        console.log("BitcoinMinuteRefresh: Notified other tabs of refresh at " + new Date(now).toISOString());
    }

    /**
     * Initialize the uptime monitor
     */
    function initialize(refreshFunc) {
        // Store the refresh callback
        refreshCallback = refreshFunc;

        // Create the terminal element if it doesn't exist
        if (!document.getElementById('bitcoin-terminal')) {
            createTerminalElement();
        } else {
            // Get references to existing elements
            terminalElement = document.getElementById('bitcoin-terminal');
            uptimeElement = document.getElementById('uptime-timer');
        }

        // Try to get stored server time information
        try {
            serverTimeOffset = parseFloat(localStorage.getItem('serverTimeOffset') || '0');
            serverStartTime = parseFloat(localStorage.getItem('serverStartTime') || '0');
        } catch (e) {
            console.error("BitcoinMinuteRefresh: Error reading server time from localStorage:", e);
        }

        // Clear any existing intervals
        if (uptimeInterval) {
            clearInterval(uptimeInterval);
        }

        // Set up interval for updating clock and uptime display
        uptimeInterval = setInterval(function () {
            updateClock();
            updateUptime();
        }, 1000); // Update every second is sufficient for uptime display

        // Listen for storage events to sync across tabs
        window.removeEventListener('storage', handleStorageChange);
        window.addEventListener('storage', handleStorageChange);

        // Handle visibility changes
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Mark as initialized
        isInitialized = true;

        console.log("BitcoinMinuteRefresh: Initialized");
    }

    /**
     * Handle storage changes for cross-tab synchronization
     */
    function handleStorageChange(event) {
        if (event.key === 'bitcoin_refresh_event') {
            console.log("BitcoinMinuteRefresh: Detected refresh from another tab");

            // If another tab refreshed, consider refreshing this one too
            // But don't refresh if it was just refreshed recently (5 seconds)
            const lastRefreshTime = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
            if (typeof refreshCallback === 'function' && Date.now() - lastRefreshTime > 5000) {
                refreshCallback();
            }
        } else if (event.key === 'serverTimeOffset' || event.key === 'serverStartTime') {
            try {
                serverTimeOffset = parseFloat(localStorage.getItem('serverTimeOffset') || '0');
                serverStartTime = parseFloat(localStorage.getItem('serverStartTime') || '0');
            } catch (e) {
                console.error("BitcoinMinuteRefresh: Error reading updated server time:", e);
            }
        }
    }

    /**
     * Handle visibility changes
     */
    function handleVisibilityChange() {
        if (!document.hidden) {
            console.log("BitcoinMinuteRefresh: Page became visible, updating");

            // Update immediately when page becomes visible
            updateClock();
            updateUptime();

            // Check if we need to do a refresh based on time elapsed
            if (typeof refreshCallback === 'function') {
                const lastRefreshTime = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
                if (Date.now() - lastRefreshTime > 60000) { // More than a minute since last refresh
                    refreshCallback();
                }
            }
        }
    }

    /**
     * Update server time information
     */
    function updateServerTime(timeOffset, startTime) {
        serverTimeOffset = timeOffset;
        serverStartTime = startTime;

        // Store in localStorage for cross-page sharing
        localStorage.setItem('serverTimeOffset', serverTimeOffset.toString());
        localStorage.setItem('serverStartTime', serverStartTime.toString());

        // Update the uptime immediately
        updateUptime();

        console.log("BitcoinMinuteRefresh: Server time updated - offset:", serverTimeOffset, "ms");
    }

    /**
     * Toggle terminal collapsed state
     */
    function toggleTerminal() {
        if (!terminalElement) return;

        terminalElement.classList.toggle('collapsed');
        localStorage.setItem('bitcoin_terminal_collapsed', terminalElement.classList.contains('collapsed'));
    }

    /**
     * Hide the terminal and show the restore button
     */
    function hideTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'none';

        // Create show button if it doesn't exist
        if (!document.getElementById('bitcoin-terminal-show')) {
            const showButton = document.createElement('button');
            showButton.id = 'bitcoin-terminal-show';
            showButton.textContent = 'Show Monitor';
            showButton.onclick = showTerminal;
            document.body.appendChild(showButton);
        }

        document.getElementById('bitcoin-terminal-show').style.display = 'block';
    }

    /**
     * Show the terminal and hide the restore button
     */
    function showTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'block';
        document.getElementById('bitcoin-terminal-show').style.display = 'none';
    }

    // Public API
    return {
        initialize: initialize,
        notifyRefresh: notifyRefresh,
        updateServerTime: updateServerTime,
        toggleTerminal: toggleTerminal,
        hideTerminal: hideTerminal,
        showTerminal: showTerminal
    };
})();

// Auto-initialize when document is ready if a refresh function is available in the global scope
document.addEventListener('DOMContentLoaded', function () {
    // Check if manualRefresh function exists in global scope
    if (typeof window.manualRefresh === 'function') {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);
    } else {
        console.log("BitcoinMinuteRefresh: No refresh function found, will need to be initialized manually");
    }
});
