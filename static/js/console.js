/**
 * Bitcoin Mining Console Log - Real-time Mining Data Display
 * Displays actual mining metrics rather than simulated logs
 */

// Message type constants
const MSG_TYPE = {
    SYSTEM: 'system',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    SUCCESS: 'success',
    HASH: 'hash',
    SHARE: 'share',
    BLOCK: 'block',
    NETWORK: 'network'
};

// Global settings and state
const consoleSettings = {
    maxLines: 500,          // Maximum number of lines to keep in the console
    autoScroll: true,       // Auto-scroll to bottom on new messages
    refreshInterval: 15000, // Refresh metrics every 15 seconds
    glitchProbability: 0.05 // 5% chance of text glitch effect for retro feel
};

// Cache for metrics data and tracking changes
let cachedMetrics = null;
let previousMetrics = null;
let lastBlockHeight = null;
let lastUpdateTime = null;
let logUpdateQueue = []; // Queue to store log updates
let logInterval = 2000; // Interval to process log updates (2 seconds)

// Initialize console
document.addEventListener('DOMContentLoaded', function () {
    console.log('Bitcoin Mining Console initialized');

    // Update clock
    updateClock();
    setInterval(updateClock, 1000);

    // Fetch initial metrics
    fetchMetrics();

    // Setup event source for real-time updates
    setupEventSource();

    // Periodic full refresh as backup
    setInterval(fetchMetrics, consoleSettings.refreshInterval);

    // Process queued metric updates regularly
    setInterval(processLogQueue, logInterval);

    // Add layout adjustment
    adjustConsoleLayout();
    window.addEventListener('resize', adjustConsoleLayout);

    // Add initial system message
    addConsoleMessage("BITCOIN MINING CONSOLE INITIALIZED - CONNECTING TO DATA SOURCES...", MSG_TYPE.SYSTEM);
});

/**
 * Format date for console display
 */
function formatDate(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Update the clock in the console header
 */
function updateClock() {
    const now = new Date();
    document.getElementById('current-time').textContent = formatDate(now);
}

/**
 * Set up Server-Sent Events for real-time updates
 */
function setupEventSource() {
    const eventSource = new EventSource('/stream');

    eventSource.onmessage = function (event) {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "ping" || data.type === "timeout_warning" || data.type === "timeout") {
                return; // Ignore ping and timeout messages
            }

            // Store previous metrics for comparison
            previousMetrics = cachedMetrics ? { ...cachedMetrics } : null;

            // Update cached metrics
            cachedMetrics = data;

            // Check for significant changes and log them
            processMetricChanges(previousMetrics, cachedMetrics);

            // Update dashboard stats
            updateDashboardStats(data);

        } catch (error) {
            console.error('Error processing SSE data:', error);
            addConsoleMessage(`DATA STREAM ERROR: ${error.message}`, MSG_TYPE.ERROR);
        }
    };

    eventSource.onerror = function () {
        console.error('SSE connection error');
        addConsoleMessage("CONNECTION ERROR: METRICS STREAM INTERRUPTED - ATTEMPTING RECONNECTION...", MSG_TYPE.ERROR);
        // Reconnect after 5 seconds
        setTimeout(setupEventSource, 5000);
    };

    // Log successful connection
    addConsoleMessage("REAL-TIME DATA STREAM ESTABLISHED", MSG_TYPE.SUCCESS);
}

/**
 * Fetch metrics via API
 */
function fetchMetrics() {
    fetch('/api/metrics')
        .then(response => response.json())
        .then(data => {
            // Store previous metrics for comparison
            previousMetrics = cachedMetrics ? { ...cachedMetrics } : null;

            // Update cached metrics
            cachedMetrics = data;
            lastUpdateTime = new Date();

            // Check for significant changes and log them
            processMetricChanges(previousMetrics, cachedMetrics);

            // Update dashboard stats
            updateDashboardStats(data);

            // Log first connection
            if (!previousMetrics) {
                addConsoleMessage("CONNECTED TO MINING DATA SOURCE - MONITORING METRICS", MSG_TYPE.SUCCESS);
            }
        })
        .catch(error => {
            console.error('Error fetching metrics:', error);
            addConsoleMessage(`METRICS FETCH ERROR: ${error.message} - RETRYING...`, MSG_TYPE.ERROR);
        });
}

/**
 * Process changes between old and new metrics
 */
function processMetricChanges(oldMetrics, newMetrics) {
    if (!oldMetrics || !newMetrics) return;

    // Check for block height change (new block found)
    if (oldMetrics.block_number !== newMetrics.block_number) {
        const message = `BLOCKCHAIN UPDATE: NEW BLOCK #${numberWithCommas(newMetrics.block_number)} DETECTED`;
        queueLogUpdate(message, MSG_TYPE.BLOCK);
        lastBlockHeight = newMetrics.block_number;
    }

    // Check for worker count changes
    if (oldMetrics.workers_hashing !== newMetrics.workers_hashing) {
        let message;
        if (newMetrics.workers_hashing > oldMetrics.workers_hashing) {
            const diff = newMetrics.workers_hashing - oldMetrics.workers_hashing;
            message = `WORKER STATUS: ${diff} ADDITIONAL WORKER${diff > 1 ? 'S' : ''} CAME ONLINE - NOW ${newMetrics.workers_hashing} ACTIVE`;
            queueLogUpdate(message, MSG_TYPE.SUCCESS);
        } else {
            const diff = oldMetrics.workers_hashing - newMetrics.workers_hashing;
            message = `WORKER STATUS: ${diff} WORKER${diff > 1 ? 'S' : ''} WENT OFFLINE - NOW ${newMetrics.workers_hashing} ACTIVE`;
            queueLogUpdate(message, MSG_TYPE.WARNING);
        }
    }

    // Check for significant hashrate changes (>5%)
    const oldHashrate = oldMetrics.hashrate_10min || oldMetrics.hashrate_3hr || 0;
    const newHashrate = newMetrics.hashrate_10min || newMetrics.hashrate_3hr || 0;
    const hashrateUnit = newMetrics.hashrate_10min_unit || newMetrics.hashrate_3hr_unit || 'TH/s';

    if (oldHashrate > 0 && Math.abs((newHashrate - oldHashrate) / oldHashrate) > 0.05) {
        const pctChange = ((newHashrate - oldHashrate) / oldHashrate * 100).toFixed(1);
        const direction = newHashrate > oldHashrate ? 'INCREASE' : 'DECREASE';
        const message = `HASHRATE ${direction}: ${newHashrate.toFixed(2)} ${hashrateUnit} - ${Math.abs(pctChange)}% CHANGE`;
        queueLogUpdate(message, newHashrate > oldHashrate ? MSG_TYPE.SUCCESS : MSG_TYPE.INFO);
    }

    // Check for BTC price changes
    if (Math.abs((newMetrics.btc_price - oldMetrics.btc_price) / oldMetrics.btc_price) > 0.005) {
        const direction = newMetrics.btc_price > oldMetrics.btc_price ? 'UP' : 'DOWN';
        const pctChange = ((newMetrics.btc_price - oldMetrics.btc_price) / oldMetrics.btc_price * 100).toFixed(2);
        const message = `MARKET UPDATE: BTC ${direction} ${Math.abs(pctChange)}% - NOW $${numberWithCommas(newMetrics.btc_price.toFixed(2))}`;
        queueLogUpdate(message, newMetrics.btc_price > oldMetrics.btc_price ? MSG_TYPE.SUCCESS : MSG_TYPE.INFO);
    }

    // Check mining profitability changes
    if (newMetrics.daily_profit_usd !== oldMetrics.daily_profit_usd) {
        if ((oldMetrics.daily_profit_usd < 0 && newMetrics.daily_profit_usd >= 0) ||
            (oldMetrics.daily_profit_usd >= 0 && newMetrics.daily_profit_usd < 0)) {
            const message = newMetrics.daily_profit_usd >= 0
                ? `PROFITABILITY ALERT: MINING NOW PROFITABLE AT $${newMetrics.daily_profit_usd.toFixed(2)}/DAY`
                : `PROFITABILITY ALERT: MINING NOW UNPROFITABLE - LOSING $${Math.abs(newMetrics.daily_profit_usd).toFixed(2)}/DAY`;
            queueLogUpdate(message, newMetrics.daily_profit_usd >= 0 ? MSG_TYPE.SUCCESS : MSG_TYPE.WARNING);
        }
    }

    // Log difficulty changes
    if (oldMetrics.difficulty && newMetrics.difficulty &&
        Math.abs((newMetrics.difficulty - oldMetrics.difficulty) / oldMetrics.difficulty) > 0.001) {
        const direction = newMetrics.difficulty > oldMetrics.difficulty ? 'INCREASED' : 'DECREASED';
        const pctChange = ((newMetrics.difficulty - oldMetrics.difficulty) / oldMetrics.difficulty * 100).toFixed(2);
        const message = `NETWORK DIFFICULTY ${direction} BY ${Math.abs(pctChange)}% - NOW ${numberWithCommas(Math.round(newMetrics.difficulty))}`;
        queueLogUpdate(message, MSG_TYPE.NETWORK);
    }

    // Add periodic stats summary regardless of changes
    if (!lastUpdateTime || (new Date() - lastUpdateTime) > 60000) { // Every minute
        logCurrentStats(newMetrics);
    }
}

/**
 * Queue a log update to be shown (prevents flooding)
 */
function queueLogUpdate(message, type = MSG_TYPE.INFO) {
    logUpdateQueue.push({ message, type });
}

/**
 * Process queued log updates
 */
function processLogQueue() {
    if (logUpdateQueue.length > 0) {
        const update = logUpdateQueue.shift(); // Get the next update
        addConsoleMessage(update.message, update.type); // Display it
    } else {
        // If the queue is empty, log periodic stats
        logCurrentStats(cachedMetrics);
    }
}

/**
 * Log current mining stats periodically
 */
function logCurrentStats(metrics) {
    if (!metrics) return;

    // Define an array of possible log messages with corrected formatting
    const logMessages = [
        `HASHRATE: ${metrics.hashrate_60sec || metrics.hashrate_10min || metrics.hashrate_3hr || 0} ${metrics.hashrate_60sec_unit || metrics.hashrate_10min_unit || metrics.hashrate_3hr_unit || 'TH/s'}`,
        `BLOCK HEIGHT: ${numberWithCommas(metrics.block_number || 0)}`,
        `WORKERS ONLINE: ${metrics.workers_hashing || 0}`,
        `BTC PRICE: $${numberWithCommas(parseFloat(metrics.btc_price || 0).toFixed(2))}`,
        `DAILY PROFIT: $${metrics.daily_profit_usd ? metrics.daily_profit_usd.toFixed(2) : '0.00'}`,
        // Fix the unpaid earnings format to display as SATS correctly
        `UNPAID EARNINGS: ${numberWithCommas(parseInt(metrics.unpaid_earnings || 0))} SATS`,
        `NETWORK DIFFICULTY: ${numberWithCommas(Math.round(metrics.difficulty || 0))}`,
        // Fix power consumption to show 0W instead of N/AW when not available
        `POWER CONSUMPTION: ${metrics.power_usage || '0'} WATTS`,
    ];

    // Randomize the order of log messages
    shuffleArray(logMessages);

    // Queue the first few messages for display
    logMessages.slice(0, 3).forEach(message => queueLogUpdate(message, MSG_TYPE.INFO));

    // Update the last update time
    lastUpdateTime = new Date();
}

/**
 * Shuffle an array in place
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

/**
 * Update the dashboard stats display in the footer
 */
function updateDashboardStats(data) {
    if (!data) return;

    // Update hashrate
    const hashrate = data.hashrate_60sec || data.hashrate_10min || data.hashrate_3hr || 0;
    const hashrateUnit = (data.hashrate_60sec_unit || data.hashrate_10min_unit || data.hashrate_3hr_unit || 'TH/s').toUpperCase();
    document.getElementById('current-hashrate').textContent = `${hashrate} ${hashrateUnit}`;

    // Update block height
    document.getElementById('block-height').textContent = numberWithCommas(data.block_number || 0);

    // Update workers online
    document.getElementById('workers-online').textContent = data.workers_hashing || 0;

    // Update BTC price
    document.getElementById('btc-price').textContent = `$${numberWithCommas(parseFloat(data.btc_price || 0).toFixed(2))}`;
}

/**
 * Format number with commas
 */
function numberWithCommas(x) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Add a message to the console output
 */
function addConsoleMessage(message, type = MSG_TYPE.SYSTEM) {
    const consoleOutput = document.getElementById('console-output');
    const now = new Date();
    const timestamp = formatDate(now);

    // Create the message element
    const lineElement = document.createElement('div');
    lineElement.className = 'console-line';

    // Add timestamp
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'timestamp';
    timestampSpan.textContent = `[${timestamp}] `;
    lineElement.appendChild(timestampSpan);

    // Add message with appropriate class based on type
    const messageSpan = document.createElement('span');
    messageSpan.className = type;
    messageSpan.textContent = message;

    // Apply glitch effect occasionally for retro aesthetic
    if (Math.random() < consoleSettings.glitchProbability) {
        messageSpan.classList.add('glitch');
        messageSpan.setAttribute('data-text', message);
    }

    lineElement.appendChild(messageSpan);

    // Add to console
    consoleOutput.appendChild(lineElement);

    // Limit the number of lines in the console
    while (consoleOutput.children.length > consoleSettings.maxLines) {
        consoleOutput.removeChild(consoleOutput.firstChild);
    }

    // Auto-scroll to bottom
    if (consoleSettings.autoScroll) {
        const consoleWrapper = document.querySelector('.console-wrapper');
        consoleWrapper.scrollTop = consoleWrapper.scrollHeight;
    }
}

/**
 * Adjust console layout to ensure proper proportions
 */
function adjustConsoleLayout() {
    const container = document.querySelector('.console-container');
    const header = document.querySelector('.console-header');
    const stats = document.querySelector('.console-stats');
    const wrapper = document.querySelector('.console-wrapper');

    if (container && header && stats && wrapper) {
        // Calculate the proper height for wrapper
        const containerHeight = container.clientHeight;
        const headerHeight = header.clientHeight;
        const statsHeight = stats.clientHeight;

        // Set the wrapper height to fill the space between header and stats
        const wrapperHeight = containerHeight - headerHeight - statsHeight;
        wrapper.style.height = `${Math.max(wrapperHeight, 150)}px`; // Min height of 150px
    }
}