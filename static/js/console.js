/**
 * Bitcoin Mining Console Log Simulation
 * A retro-styled terminal/console log display showing real-time mining metrics
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
    logFrequency: {         // Frequency of different message types (ms)
        system: 5000,       // System messages every 5 seconds
        hash: 2000,         // Hash updates every 2 seconds
        share: 10000,       // Share submissions every 10 seconds
        network: 30000,     // Network updates every 30 seconds
        block: 600000       // Block updates roughly every 10 minutes (on average)
    },
    glitchProbability: 0.05 // 5% chance of text glitch effect on any message
};

// Cache for metrics data
let cachedMetrics = null;
const hashRateFluctuation = 0.1; // 10% fluctuation for realistic variance

// Initialize console
document.addEventListener('DOMContentLoaded', function () {
    console.log('Console log initialized');

    // Update clock
    updateClock();
    setInterval(updateClock, 1000);

    // Set up metrics fetch
    fetchMetrics();
    setupEventSource();

    // Start log generators with slight delays to avoid all happening at once
    setTimeout(() => startLogGenerator(MSG_TYPE.HASH), 1000);
    setTimeout(() => startLogGenerator(MSG_TYPE.SHARE), 3000);
    setTimeout(() => startLogGenerator(MSG_TYPE.SYSTEM), 5000);
    setTimeout(() => startLogGenerator(MSG_TYPE.NETWORK), 7000);
    setTimeout(() => startLogGenerator(MSG_TYPE.BLOCK), 9000);

    // Add random errors/warnings occasionally
    setInterval(generateRandomEvent, 60000);
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

            // Update cached metrics
            cachedMetrics = data;

            // Update dashboard stats
            updateDashboardStats(data);

        } catch (error) {
            console.error('Error processing SSE data:', error);
        }
    };

    eventSource.onerror = function () {
        console.error('SSE connection error');
        // Reconnect after 5 seconds
        setTimeout(setupEventSource, 5000);
    };
}

/**
 * Fetch metrics via API
 */
function fetchMetrics() {
    fetch('/api/metrics')
        .then(response => response.json())
        .then(data => {
            cachedMetrics = data;
            updateDashboardStats(data);
        })
        .catch(error => {
            console.error('Error fetching metrics:', error);
            addConsoleMessage('ERROR FETCHING METRICS DATA. RETRYING...', MSG_TYPE.ERROR);
        });
}

/**
 * Update the dashboard stats display
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
 * Start a specific log generator
 */
function startLogGenerator(type) {
    const interval = consoleSettings.logFrequency[type];
    if (!interval) return;

    setInterval(() => {
        generateLog(type);
    }, interval);
}

/**
 * Generate a log message based on type
 */
function generateLog(type) {
    if (!cachedMetrics) return;

    let message = '';
    let messageType = type;

    switch (type) {
        case MSG_TYPE.SYSTEM:
            message = generateSystemMessage();
            break;

        case MSG_TYPE.HASH:
            message = generateHashrateMessage();
            break;

        case MSG_TYPE.SHARE:
            message = generateShareMessage();
            break;

        case MSG_TYPE.NETWORK:
            message = generateNetworkMessage();
            break;

        case MSG_TYPE.BLOCK:
            // Only generate block messages occasionally (simulating real mining)
            if (Math.random() < 0.1) { // 10% chance each time this is called
                message = generateBlockMessage();
            } else {
                return; // Skip this cycle
            }
            break;
    }

    // If we have a message, add it to console
    if (message) {
        addConsoleMessage(message, messageType);
    }
}

/**
 * Generate a system status message
 */
function generateSystemMessage() {
    const systemMessages = [
        `SYSTEM TEMPERATURE: ${randomInt(50, 75)}°C - WITHIN NORMAL PARAMETERS`,
        `MEMORY USAGE: ${randomInt(30, 70)}% - ${randomInt(2048, 8192)}MB ALLOCATED`,
        `CPU UTILIZATION: ${randomInt(20, 95)}% - PROCESSING MINING ALGORITHMS`,
        `NETWORK LATENCY: ${randomInt(5, 200)}ms TO MINING POOL`,
        `SYSTEM UPTIME: ${randomInt(1, 24)}h ${randomInt(0, 59)}m ${randomInt(0, 59)}s`,
        `POWER CONSUMPTION: ${randomInt(800, 1500)}W - ${cachedMetrics.power_usage || 'N/A'}W RATED`,
        `FAN SPEED: ${randomInt(30, 90)}% - COOLING SYSTEM OPERATIONAL`,
        `STORAGE: ${randomInt(40, 90)}% USED - ${randomInt(20, 500)}GB FREE`,
        `CHECKING BLOCKCHAIN SYNC STATUS... 100% SYNCHRONIZED`,
        `MINING SOFTWARE VERSION: v${randomInt(1, 3)}.${randomInt(0, 9)}.${randomInt(0, 999)} RUNNING OPTIMALLY`,
        `SYSTEM HEALTH CHECK: ALL COMPONENTS OPERATIONAL`
    ];

    return systemMessages[Math.floor(Math.random() * systemMessages.length)];
}

/**
 * Generate a hashrate update message
 */
function generateHashrateMessage() {
    if (!cachedMetrics) return '';

    // Get base hashrate from cached metrics
    const baseHashrate = cachedMetrics.hashrate_60sec || cachedMetrics.hashrate_10min || cachedMetrics.hashrate_3hr || 1;
    const hashrateUnit = (cachedMetrics.hashrate_60sec_unit || cachedMetrics.hashrate_10min_unit || cachedMetrics.hashrate_3hr_unit || 'TH/s').toUpperCase();

    // Add some fluctuation for realism
    const fluctuation = (Math.random() * 2 - 1) * hashRateFluctuation;
    const currentHashrate = (baseHashrate * (1 + fluctuation)).toFixed(2);

    const hashMessages = [
        `HASHRATE UPDATE: ${currentHashrate} ${hashrateUnit} - ${fluctuation >= 0 ? 'INCREASE' : 'DECREASE'} OF ${Math.abs(fluctuation * 100).toFixed(2)}%`,
        `MINING PERFORMANCE: ${currentHashrate} ${hashrateUnit} - ${randomInt(97, 100)}% EFFICIENCY`,
        `HASH COMPUTATION RATE: ${currentHashrate} ${hashrateUnit} - ${fluctuation >= 0 ? 'OPTIMAL' : 'SUBOPTIMAL'} PERFORMANCE`,
        `PROCESSING HASHES AT ${currentHashrate} ${hashrateUnit} - ${cachedMetrics.workers_hashing || 1} WORKERS ACTIVE`,
        `CURRENT HASHING POWER: ${currentHashrate} ${hashrateUnit} - NETWORK CONTRIBUTION: ${(baseHashrate / (cachedMetrics.network_hashrate * 1000 || 1) * 100).toFixed(8)}%`
    ];

    return hashMessages[Math.floor(Math.random() * hashMessages.length)];
}

/**
 * Generate a share submission message
 */
function generateShareMessage() {
    if (!cachedMetrics) return '';

    const difficulty = randomInt(8000, 12000) / 100;
    const timeToSolve = randomInt(10, 990) / 10;
    const accepted = Math.random() < 0.98; // 98% acceptance rate

    if (accepted) {
        const shareMessages = [
            `SHARE ACCEPTED [${generateRandomHex(8)}] - DIFFICULTY ${difficulty} - SOLVED IN ${timeToSolve}s`,
            `VALID SHARE SUBMITTED [${generateRandomHex(8)}] - POOL ACCEPTED - DIFFICULTY ${difficulty}`,
            `SHARE SOLUTION FOUND [${generateRandomHex(8)}] - VERIFICATION SUCCESSFUL - EFFORT: ${randomInt(1, 200)}%`,
            `MINING SHARE ACCEPTED BY POOL [${generateRandomHex(8)}] - ${timeToSolve}s SOLUTION TIME`,
            `SHARE SUBMISSION SUCCESSFUL [${generateRandomHex(8)}] - YAY!!! ⚡`
        ];
        return shareMessages[Math.floor(Math.random() * shareMessages.length)];
    } else {
        const rejectReasons = ['LOW DIFFICULTY', 'STALE', 'DUPLICATE', 'INVALID NONCE', 'BAD TRANSACTION'];
        const reason = rejectReasons[Math.floor(Math.random() * rejectReasons.length)];

        return `SHARE REJECTED [${generateRandomHex(8)}] - REASON: ${reason} - DIFFICULTY ${difficulty}`;
    }
}

/**
 * Generate a network update message
 */
function generateNetworkMessage() {
    if (!cachedMetrics) return '';

    const networkHashrate = cachedMetrics.network_hashrate || 350;
    const difficulty = cachedMetrics.difficulty || 60000000000000;
    const btcPrice = cachedMetrics.btc_price || 75000;

    const networkMessages = [
        `NETWORK HASHRATE: ${networkHashrate} EH/s - GLOBAL MINING POWER`,
        `NETWORK DIFFICULTY: ${numberWithCommas(Math.round(difficulty))} - NEXT ADJUSTMENT IN ${randomInt(1, 14)} DAYS`,
        `BTC MARKET UPDATE: $${numberWithCommas(btcPrice)} - ${Math.random() < 0.7 ? 'UP' : 'DOWN'} ${randomInt(1, 500) / 100}% IN 24HR`,
        `BLOCKCHAIN HEIGHT: ${numberWithCommas(cachedMetrics.block_number || 0)} - FULLY SYNCHRONIZED`,
        `MEMPOOL STATUS: ${randomInt(5000, 50000)} TRANSACTIONS PENDING - ${randomInt(10, 100)} SAT/VBYTE`,
        `ESTIMATED EARNINGS: ${cachedMetrics.daily_mined_sats || 0} SATS PER DAY AT CURRENT RATE`,
        `TRANSACTION FEES: AVERAGE ${randomInt(1000, 10000)} SATS PER TRANSACTION`,
        `POOL FEE: ${randomInt(0, 3)}% + ${randomInt(0, 2)}% MINING FEE = ${randomInt(1, 5)}% TOTAL DEDUCTION`
    ];

    return networkMessages[Math.floor(Math.random() * networkMessages.length)];
}

/**
 * Generate a block-related message
 */
function generateBlockMessage() {
    if (!cachedMetrics) return '';

    const blockHeight = cachedMetrics.block_number || 0;
    const nextBlockHeight = blockHeight + 1;

    // Generate random transaction count for the block
    const txCount = randomInt(1000, 4000);
    const blockSize = randomInt(1, 4) + "." + randomInt(0, 9) + " MB";
    const blockReward = "3.125 BTC + " + randomInt(0, 3) + "." + randomInt(0, 999) + " BTC FEES";

    // Determine if this is a block found by the pool (rare event)
    const isPoolBlock = Math.random() < 0.01; // 1% chance

    if (isPoolBlock) {
        // This is a special case - our pool found a block!
        const blockMessages = [
            `🎉 BLOCK FOUND BY POOL! 🎉 HEIGHT: ${blockHeight} - REWARD: ${blockReward}`,
            `⚡⚡⚡ POOL SUCCESSFULLY MINED BLOCK ${blockHeight}! REWARD: ${blockReward} ⚡⚡⚡`,
            `!!!CONGRATULATIONS!!! BLOCK ${blockHeight} MINED BY OUR POOL! ${txCount} TRANSACTIONS CONFIRMED`,
            `$$$ BLOCK REWARD INCOMING $$$ - POOL MINED BLOCK ${blockHeight} - ${blockReward}`,
            `NEW BLOCK ${blockHeight} MINED BY OUR POOL! SIZE: ${blockSize}, TXs: ${txCount}, REWARD: ${blockReward}`
        ];
        return blockMessages[Math.floor(Math.random() * blockMessages.length)];
    } else {
        // Regular block found by someone else
        const blockMessages = [
            `NEW BLOCK DETECTED: HEIGHT ${blockHeight} - ${txCount} TRANSACTIONS - SIZE: ${blockSize}`,
            `BLOCKCHAIN UPDATE: BLOCK ${blockHeight} CONFIRMED - MINED BY EXTERNAL POOL`,
            `BLOCK ${blockHeight} ADDED TO BLOCKCHAIN - DIFFICULTY TARGET: ${generateRandomHex(8)}...`,
            `NETWORK: NEW BLOCK ${blockHeight} - REWARD: ${blockReward}`,
            `BLOCK HEIGHT ${blockHeight} CONFIRMED - WORKING ON NEXT BLOCK: ${nextBlockHeight}`
        ];
        return blockMessages[Math.floor(Math.random() * blockMessages.length)];
    }
}

/**
 * Generate random technical or error events
 */
function generateRandomEvent() {
    // Only 20% chance to generate a random event
    if (Math.random() > 0.2) return;

    const events = [
        { message: "WARNING: EXCESSIVE TEMPERATURE DETECTED ON WORKER #" + randomInt(1, 5), type: MSG_TYPE.WARNING },
        { message: "ERROR: INVALID MINING PARAMETER DETECTED - RECONFIGURING ALGORITHM", type: MSG_TYPE.ERROR },
        { message: "NOTICE: OPTIMIZING MEMORY ALLOCATION FOR IMPROVED PERFORMANCE", type: MSG_TYPE.INFO },
        { message: "ALERT: NETWORK DIFFICULTY INCREASED BY " + randomInt(1, 10) + "% - ADJUSTING PARAMETERS", type: MSG_TYPE.WARNING },
        { message: "SYSTEM: DETECTED " + randomInt(2, 10) + " REJECTED SHARES IN LAST MINUTE - ANALYZING CAUSE", type: MSG_TYPE.WARNING },
        { message: "ERROR: CONNECTION TO MINING POOL TIMED OUT - ATTEMPTING RECONNECTION...", type: MSG_TYPE.ERROR },
        { message: "SUCCESS: CONNECTION RESTORED - RESUMING MINING OPERATIONS", type: MSG_TYPE.SUCCESS },
        { message: "NOTICE: FIRMWARE UPDATE AVAILABLE FOR MINING HARDWARE", type: MSG_TYPE.INFO },
        { message: "WARNING: POWER SUPPLY FLUCTUATION DETECTED - MONITORING VOLTAGE", type: MSG_TYPE.WARNING },
        { message: "SYSTEM: RECALIBRATING HASH VERIFICATION ALGORITHM", type: MSG_TYPE.SYSTEM }
    ];

    const event = events[Math.floor(Math.random() * events.length)];
    addConsoleMessage(event.message, event.type);
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
 * Generate a random integer between min and max (inclusive)
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random hexadecimal string of specified length
 */
function generateRandomHex(length) {
    const characters = '0123456789ABCDEF';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * 16));
    }
    return result;
}