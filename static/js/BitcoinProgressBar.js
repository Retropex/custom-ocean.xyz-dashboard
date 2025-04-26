/**
 * BitcoinMinuteRefresh.js - Simplified Bitcoin-themed floating uptime monitor
 * 
 * This module creates a Bitcoin-themed terminal that shows server uptime.
 * Now includes DeepSea theme support.
 */

const BitcoinMinuteRefresh = (function () {
    // Constants
    const STORAGE_KEY = 'bitcoin_last_refresh_time';
    // Default fallback colors if CSS vars aren't available
    const FALLBACK_BITCOIN_COLOR = '#f2a900';
    const FALLBACK_DEEPSEA_COLOR = '#0088cc';

    const DOM_IDS = {
        TERMINAL: 'bitcoin-terminal',
        STYLES: 'bitcoin-terminal-styles',
        CLOCK: 'terminal-clock',
        UPTIME_HOURS: 'uptime-hours',
        UPTIME_MINUTES: 'uptime-minutes',
        UPTIME_SECONDS: 'uptime-seconds',
        MINIMIZED_UPTIME: 'minimized-uptime-value',
        SHOW_BUTTON: 'bitcoin-terminal-show'
    };
    const STORAGE_KEYS = {
        THEME: 'useDeepSeaTheme',
        COLLAPSED: 'bitcoin_terminal_collapsed',
        SERVER_OFFSET: 'serverTimeOffset',
        SERVER_START: 'serverStartTime',
        REFRESH_EVENT: 'bitcoin_refresh_event'
    };
    const SELECTORS = {
        HEADER: '.terminal-header',
        TITLE: '.terminal-title',
        TIMER: '.uptime-timer',
        SEPARATORS: '.uptime-separator',
        UPTIME_TITLE: '.uptime-title',
        MINI_LABEL: '.mini-uptime-label',
        TERMINAL_DOT: '.terminal-dot'
    };

    // Private variables
    let terminalElement = null;
    let uptimeElement = null;
    let serverTimeOffset = 0;
    let serverStartTime = null;
    let uptimeInterval = null;
    let isInitialized = false;
    let refreshCallback = null;
    let currentThemeColor = '';
    let currentThemeRGB = '';
    let dragListenersAdded = false;

    /**
     * Get theme colors from CSS variables
     */
    function getThemeColors() {
        // Try to get CSS variables from document root
        const rootStyles = getComputedStyle(document.documentElement);
        let primaryColor = rootStyles.getPropertyValue('--primary-color').trim();
        let primaryColorRGB = rootStyles.getPropertyValue('--primary-color-rgb').trim();

        // If CSS vars not available, use theme toggle state
        if (!primaryColor) {
            const isDeepSea = localStorage.getItem(STORAGE_KEYS.THEME) === 'true';
            primaryColor = isDeepSea ? FALLBACK_DEEPSEA_COLOR : FALLBACK_BITCOIN_COLOR;
            primaryColorRGB = isDeepSea ? '0, 136, 204' : '242, 169, 0';
        }

        return {
            color: primaryColor,
            rgb: primaryColorRGB
        };
    }

    /**
     * Logging helper function
     * @param {string} message - Message to log
     * @param {string} level - Log level (log, warn, error)
     */
    function log(message, level = 'log') {
        const prefix = "BitcoinMinuteRefresh: ";
        if (level === 'error') {
            console.error(prefix + message);
        } else if (level === 'warn') {
            console.warn(prefix + message);
        } else {
            console.log(prefix + message);
        }
    }

    /**
     * Helper function to set multiple styles on an element
     * @param {Element} element - The DOM element to style
     * @param {Object} styles - Object with style properties
     */
    function applyStyles(element, styles) {
        Object.keys(styles).forEach(key => {
            element.style[key] = styles[key];
        });
    }

    /**
     * Apply the current theme color 
     */
    function applyThemeColor() {
        // Get current theme colors
        const theme = getThemeColors();
        currentThemeColor = theme.color;
        currentThemeRGB = theme.rgb;

        // Don't try to update DOM elements if they don't exist yet
        if (!terminalElement) return;

        // Create theme config
        const themeConfig = {
            color: currentThemeColor,
            borderColor: currentThemeColor,
            boxShadow: `0 0 5px rgba(${currentThemeRGB}, 0.3)`,
            textShadow: `0 0 5px rgba(${currentThemeRGB}, 0.8)`,
            borderColorRGBA: `rgba(${currentThemeRGB}, 0.5)`,
            textShadowStrong: `0 0 8px rgba(${currentThemeRGB}, 0.8)`
        };

        // Apply styles to terminal
        applyStyles(terminalElement, {
            borderColor: themeConfig.color,
            color: themeConfig.color,
            boxShadow: themeConfig.boxShadow
        });

        // Update header border
        const headerElement = terminalElement.querySelector(SELECTORS.HEADER);
        if (headerElement) {
            headerElement.style.borderColor = themeConfig.color;
        }

        // Update terminal title
        const titleElement = terminalElement.querySelector(SELECTORS.TITLE);
        if (titleElement) {
            applyStyles(titleElement, {
                color: themeConfig.color,
                textShadow: themeConfig.textShadow
            });
        }

        // Update uptime timer border
        const uptimeTimer = terminalElement.querySelector(SELECTORS.TIMER);
        if (uptimeTimer) {
            uptimeTimer.style.borderColor = themeConfig.borderColorRGBA;
        }

        // Update uptime separators
        const separators = terminalElement.querySelectorAll(SELECTORS.SEPARATORS);
        separators.forEach(sep => {
            sep.style.textShadow = themeConfig.textShadowStrong;
        });

        // Update uptime title
        const uptimeTitle = terminalElement.querySelector(SELECTORS.UPTIME_TITLE);
        if (uptimeTitle) {
            uptimeTitle.style.textShadow = themeConfig.textShadow;
        }

        // Update minimized view
        const miniLabel = terminalElement.querySelector(SELECTORS.MINI_LABEL);
        if (miniLabel) {
            miniLabel.style.color = themeConfig.color;
        }

        // Update show button if it exists
        const showButton = document.getElementById(DOM_IDS.SHOW_BUTTON);
        if (showButton) {
            showButton.style.backgroundColor = themeConfig.color;
            showButton.style.boxShadow = `0 0 10px rgba(${currentThemeRGB}, 0.5)`;
        }
    }

    /**
     * Listen for theme changes
     */
    function setupThemeChangeListener() {
        // Listen for theme change events from localStorage
        window.addEventListener('storage', function (e) {
            if (e.key === STORAGE_KEYS.THEME) {
                applyThemeColor();
            }
        });

        // Listen for custom theme change events
        document.addEventListener('themeChanged', function () {
            applyThemeColor();
        });

        // Watch for class changes on HTML element that might indicate theme changes
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.attributeName === 'class') {
                    applyThemeColor();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    /**
     * Debounce function to limit execution frequency
     */
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    /**
     * Add dragging functionality to the terminal
     */
    function addDraggingBehavior() {
        // Find the terminal element
        const terminal = document.getElementById(DOM_IDS.TERMINAL) ||
            document.querySelector('.bitcoin-terminal') ||
            document.getElementById('retro-terminal-bar');

        if (!terminal) {
            log('Terminal element not found for drag behavior', 'warn');
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
            if (e.target.closest(SELECTORS.TERMINAL_DOT)) return;

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

        // Function to handle mouse move (dragging) with debounce for better performance
        const handleMouseMove = debounce(function (e) {
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
        }, 10);

        // Function to handle mouse up (drag end)
        function handleMouseUp() {
            if (isDragging) {
                isDragging = false;
                terminal.classList.remove('dragging');
            }
        }

        // Find the terminal header for dragging
        const terminalHeader = terminal.querySelector(SELECTORS.HEADER);
        if (terminalHeader) {
            terminalHeader.addEventListener('mousedown', handleMouseDown);
        } else {
            // If no header found, make the whole terminal draggable
            terminal.addEventListener('mousedown', handleMouseDown);
        }

        // Add touch support for mobile/tablet
        function handleTouchStart(e) {
            if (window.innerWidth < 768) return;
            if (e.target.closest(SELECTORS.TERMINAL_DOT)) return;

            const touch = e.touches[0];
            isDragging = true;
            terminal.classList.add('dragging');

            startX = touch.clientX;

            const style = window.getComputedStyle(terminal);
            if (style.left !== 'auto') {
                startLeft = parseInt(style.left) || 0;
            } else {
                startLeft = window.innerWidth - (parseInt(style.right) || 0) - terminal.offsetWidth;
            }

            e.preventDefault();
        }

        function handleTouchMove(e) {
            if (!isDragging) return;

            const touch = e.touches[0];
            const deltaX = touch.clientX - startX;
            let newLeft = startLeft + deltaX;

            const maxLeft = window.innerWidth - terminal.offsetWidth;
            newLeft = Math.max(0, Math.min(newLeft, maxLeft));

            terminal.style.left = newLeft + 'px';
            terminal.style.right = 'auto';
            terminal.style.transform = 'none';

            e.preventDefault();
        }

        function handleTouchEnd() {
            if (isDragging) {
                isDragging = false;
                terminal.classList.remove('dragging');
            }
        }

        if (terminalHeader) {
            terminalHeader.addEventListener('touchstart', handleTouchStart);
        } else {
            terminal.addEventListener('touchstart', handleTouchStart);
        }

        // Add event listeners only once to prevent memory leaks
        if (!dragListenersAdded) {
            // Add mousemove and mouseup listeners to document
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            // Add touch event listeners
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

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

            // Mark listeners as added
            dragListenersAdded = true;
        }
    }

    /**
     * Create and inject the retro terminal element into the DOM
     */
    function createTerminalElement() {
        // Container element
        terminalElement = document.createElement('div');
        terminalElement.id = DOM_IDS.TERMINAL;
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
          <span id="${DOM_IDS.CLOCK}" class="terminal-clock">00:00:00</span>
        </div>
        <div id="uptime-timer" class="uptime-timer">
          <div class="uptime-title">UPTIME</div>
          <div class="uptime-display">
            <div class="uptime-value">
              <span id="${DOM_IDS.UPTIME_HOURS}" class="uptime-number">00</span>
              <span class="uptime-label">H</span>
            </div>
            <div class="uptime-separator">:</div>
            <div class="uptime-value">
              <span id="${DOM_IDS.UPTIME_MINUTES}" class="uptime-number">00</span>
              <span class="uptime-label">M</span>
            </div>
            <div class="uptime-separator">:</div>
            <div class="uptime-value">
              <span id="${DOM_IDS.UPTIME_SECONDS}" class="uptime-number">00</span>
              <span class="uptime-label">S</span>
            </div>
          </div>
        </div>
      </div>
      <div class="terminal-minimized">
        <div class="minimized-uptime">
          <span class="mini-uptime-label">UPTIME</span>
          <span id="${DOM_IDS.MINIMIZED_UPTIME}">00:00:00</span>
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
        if (localStorage.getItem(STORAGE_KEYS.COLLAPSED) === 'true') {
            terminalElement.classList.add('collapsed');
        }

        // Add custom styles if not already present
        if (!document.getElementById(DOM_IDS.STYLES)) {
            addStyles();
        }
    }

    /**
     * Add CSS styles for the terminal
     */
    function addStyles() {
        // Get current theme colors for initial styling
        const theme = getThemeColors();

        const styleElement = document.createElement('style');
        styleElement.id = DOM_IDS.STYLES;

        styleElement.textContent = `
      /* Terminal Container */
      .bitcoin-terminal {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 230px;
        background-color: #000000;
        border: 1px solid var(--primary-color, ${theme.color});
        color: var(--primary-color, ${theme.color});
        font-family: 'VT323', monospace;
        z-index: 9999;
        overflow: hidden;
        padding: 8px;
        transition: all 0.3s ease;
        box-shadow: 0 0 5px rgba(var(--primary-color-rgb, ${theme.rgb}), 0.3);
      }
      
      /* Terminal Header */
      .terminal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--primary-color, ${theme.color});
        padding-bottom: 5px;
        margin-bottom: 8px;
        cursor: grab;
      }

      .terminal-header:active,
      .bitcoin-terminal.dragging .terminal-header {
        cursor: grabbing;
      }
      
      .terminal-title {
        color: var(--primary-color, ${theme.color});
        font-weight: bold;
        font-size: 1.1rem;
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
      }
      
      /* Uptime Display */
      .uptime-timer {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 5px;
        background-color: #111;
        border: 1px solid rgba(var(--primary-color-rgb, ${theme.rgb}), 0.5);
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
      }
      
      .uptime-title {
        font-size: 0.7rem;
        font-weight: bold;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 3px;
      }
      
      /* Show button */
      #${DOM_IDS.SHOW_BUTTON} {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background-color: var(--primary-color, ${theme.color});
        color: #000;
        border: none;
        padding: 8px 12px;
        font-family: 'VT323', monospace;
        cursor: pointer;
        z-index: 9999;
        display: none;
        box-shadow: 0 0 10px rgba(var(--primary-color-rgb, ${theme.rgb}), 0.5);
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
        color: var(--primary-color, ${theme.color});
      }
      
      #${DOM_IDS.MINIMIZED_UPTIME} {
        font-size: 0.9rem;
        font-weight: bold;
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
            // Use the global timezone setting if available
            const timeZone = window.dashboardTimezone || 'America/Los_Angeles';

            // Format the time in the configured timezone
            const timeString = now.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: timeZone
            });

            // Update clock in normal view
            const clockElement = document.getElementById(DOM_IDS.CLOCK);
            if (clockElement) {
                clockElement.textContent = timeString;
            }
        } catch (e) {
            log("Error updating clock: " + e.message, 'error');
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

                // Format numbers with leading zeros
                const formattedTime = {
                    hours: String(hours).padStart(2, '0'),
                    minutes: String(minutes).padStart(2, '0'),
                    seconds: String(seconds).padStart(2, '0')
                };

                // Update the main uptime display with digital clock style
                const elements = {
                    hours: document.getElementById(DOM_IDS.UPTIME_HOURS),
                    minutes: document.getElementById(DOM_IDS.UPTIME_MINUTES),
                    seconds: document.getElementById(DOM_IDS.UPTIME_SECONDS),
                    minimized: document.getElementById(DOM_IDS.MINIMIZED_UPTIME)
                };

                // Update each element if it exists
                if (elements.hours) elements.hours.textContent = formattedTime.hours;
                if (elements.minutes) elements.minutes.textContent = formattedTime.minutes;
                if (elements.seconds) elements.seconds.textContent = formattedTime.seconds;

                // Update the minimized uptime display
                if (elements.minimized) {
                    elements.minimized.textContent = `${formattedTime.hours}:${formattedTime.minutes}:${formattedTime.seconds}`;
                }
            } catch (e) {
                log("Error updating uptime: " + e.message, 'error');
            }
        }
    }

    /**
     * Start animation frame loop for smooth updates
     */
    function startAnimationLoop() {
        let lastUpdate = 0;
        const updateInterval = 1000; // Update every second

        function animationFrame(timestamp) {
            // Only update once per second to save resources
            if (timestamp - lastUpdate >= updateInterval) {
                updateClock();
                updateUptime();
                lastUpdate = timestamp;
            }

            // Continue the animation loop
            requestAnimationFrame(animationFrame);
        }

        // Start the loop
        requestAnimationFrame(animationFrame);
    }

    /**
     * Notify other tabs that data has been refreshed
     */
    function notifyRefresh() {
        const now = Date.now();
        localStorage.setItem(STORAGE_KEY, now.toString());
        localStorage.setItem(STORAGE_KEYS.REFRESH_EVENT, 'refresh-' + now);
        log("Notified other tabs of refresh at " + new Date(now).toISOString());
    }

    /**
     * Initialize the uptime monitor
     */
    function initialize(refreshFunc) {
        // Store the refresh callback
        refreshCallback = refreshFunc;

        // Create the terminal element if it doesn't exist
        if (!document.getElementById(DOM_IDS.TERMINAL)) {
            createTerminalElement();
        } else {
            // Get references to existing elements
            terminalElement = document.getElementById(DOM_IDS.TERMINAL);
            uptimeElement = document.getElementById('uptime-timer');
        }

        // Apply theme colors
        applyThemeColor();

        // Set up listener for theme changes
        setupThemeChangeListener();

        // Try to get stored server time information
        try {
            serverTimeOffset = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_OFFSET) || '0');
            serverStartTime = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_START) || '0');
        } catch (e) {
            log("Error reading server time from localStorage: " + e.message, 'error');
        }

        // Clear any existing intervals
        if (uptimeInterval) {
            clearInterval(uptimeInterval);
        }

        // Use requestAnimationFrame for smoother animations
        startAnimationLoop();

        // Listen for storage events to sync across tabs
        window.removeEventListener('storage', handleStorageChange);
        window.addEventListener('storage', handleStorageChange);

        // Handle visibility changes
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // Mark as initialized
        isInitialized = true;

        log("Initialized");
    }

    /**
     * Handle storage changes for cross-tab synchronization
     */
    function handleStorageChange(event) {
        if (event.key === STORAGE_KEYS.REFRESH_EVENT) {
            log("Detected refresh from another tab");

            // If another tab refreshed, consider refreshing this one too
            // But don't refresh if it was just refreshed recently (5 seconds)
            const lastRefreshTime = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
            if (typeof refreshCallback === 'function' && Date.now() - lastRefreshTime > 5000) {
                refreshCallback();
            }
        } else if (event.key === STORAGE_KEYS.SERVER_OFFSET || event.key === STORAGE_KEYS.SERVER_START) {
            try {
                serverTimeOffset = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_OFFSET) || '0');
                serverStartTime = parseFloat(localStorage.getItem(STORAGE_KEYS.SERVER_START) || '0');
            } catch (e) {
                log("Error reading updated server time: " + e.message, 'error');
            }
        } else if (event.key === STORAGE_KEYS.THEME) {
            // Update theme when theme preference changes
            applyThemeColor();
        }
    }

    /**
     * Handle visibility changes
     */
    function handleVisibilityChange() {
        if (!document.hidden) {
            log("Page became visible, updating");

            // Apply current theme when page becomes visible
            applyThemeColor();

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
        localStorage.setItem(STORAGE_KEYS.SERVER_OFFSET, serverTimeOffset.toString());
        localStorage.setItem(STORAGE_KEYS.SERVER_START, serverStartTime.toString());

        // Update the uptime immediately
        updateUptime();

        log("Server time updated - offset: " + serverTimeOffset + " ms");
    }

    /**
     * Toggle terminal collapsed state
     */
    function toggleTerminal() {
        if (!terminalElement) return;

        terminalElement.classList.toggle('collapsed');
        localStorage.setItem(STORAGE_KEYS.COLLAPSED, terminalElement.classList.contains('collapsed'));
    }

    /**
     * Hide the terminal and show the restore button
     */
    function hideTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'none';

        // Create show button if it doesn't exist
        if (!document.getElementById(DOM_IDS.SHOW_BUTTON)) {
            const showButton = document.createElement('button');
            showButton.id = DOM_IDS.SHOW_BUTTON;
            showButton.textContent = 'Show Monitor';
            showButton.onclick = showTerminal;
            document.body.appendChild(showButton);

            // Apply current theme to the button
            const theme = getThemeColors();
            showButton.style.backgroundColor = theme.color;
            showButton.style.boxShadow = `0 0 10px rgba(${theme.rgb}, 0.5)`;
        }

        document.getElementById(DOM_IDS.SHOW_BUTTON).style.display = 'block';
    }

    /**
     * Show the terminal and hide the restore button
     */
    function showTerminal() {
        if (!terminalElement) return;

        terminalElement.style.display = 'block';
        const showButton = document.getElementById(DOM_IDS.SHOW_BUTTON);
        if (showButton) {
            showButton.style.display = 'none';
        }
    }

    // Public API
    return {
        initialize: initialize,
        notifyRefresh: notifyRefresh,
        updateServerTime: updateServerTime,
        toggleTerminal: toggleTerminal,
        hideTerminal: hideTerminal,
        showTerminal: showTerminal,
        updateTheme: applyThemeColor
    };
})();

// Auto-initialize when document is ready
document.addEventListener('DOMContentLoaded', function () {
    // Check if manualRefresh function exists in global scope
    if (typeof window.manualRefresh === 'function') {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);
    } else {
        console.log("BitcoinMinuteRefresh: No refresh function found, will need to be initialized manually");
    }

    // Update theme based on current setting
    setTimeout(() => BitcoinMinuteRefresh.updateTheme(), 100);
});
