"use strict";

/**
 * ArrowIndicator - A clean implementation for managing metric value change indicators
 * 
 * This module provides a simple, self-contained system for managing arrow indicators
 * that show whether metric values have increased, decreased, or remained stable
 * between refreshes.
 */
class ArrowIndicator {
    constructor() {
        this.previousMetrics = {};
        this.arrowStates = {};
        this.changeThreshold = 0.00001;
        this.debug = false;

        // Load saved state immediately
        this.loadFromStorage();

        // DOM ready handling
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeDOM());
        } else {
            setTimeout(() => this.initializeDOM(), 100);
        }

        // Handle tab visibility changes
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                this.loadFromStorage();
                this.forceApplyArrows();
            }
        });

        // Handle storage changes for cross-tab sync
        window.addEventListener('storage', this.handleStorageEvent.bind(this));
    }

    initializeDOM() {
        // First attempt to apply arrows
        this.forceApplyArrows();

        // Set up a detection system to find indicator elements
        this.detectIndicatorElements();
    }

    detectIndicatorElements() {
        // Scan the DOM for all elements that match our indicator pattern
        const indicatorElements = {};

        // Look for elements with IDs starting with "indicator_"
        const elements = document.querySelectorAll('[id^="indicator_"]');
        elements.forEach(element => {
            const key = element.id.replace('indicator_', '');
            indicatorElements[key] = element;
        });

        // Apply arrows to the found elements
        this.applyArrowsToFoundElements(indicatorElements);

        // Set up a MutationObserver to catch dynamically added elements
        this.setupMutationObserver();

        // Schedule additional attempts with increasing delays
        [500, 1000, 2000].forEach(delay => {
            setTimeout(() => this.forceApplyArrows(), delay);
        });
    }

    setupMutationObserver() {
        // Watch for changes to the DOM that might add indicator elements
        const observer = new MutationObserver(mutations => {
            let newElementsFound = false;

            mutations.forEach(mutation => {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) { // Element node
                            // Check the node itself
                            if (node.id && node.id.startsWith('indicator_')) {
                                newElementsFound = true;
                            }

                            // Check children of the node
                            const childIndicators = node.querySelectorAll('[id^="indicator_"]');
                            if (childIndicators.length) {
                                newElementsFound = true;
                            }
                        }
                    });
                }
            });

            if (newElementsFound) {
                this.forceApplyArrows();
            }
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    forceApplyArrows() {
        let applied = 0;
        let missing = 0;

        // Apply arrows to all indicators we know about
        Object.keys(this.arrowStates).forEach(key => {
            const element = document.getElementById(`indicator_${key}`);
            if (element) {
                // Double-check if the element is visible
                const arrowValue = this.arrowStates[key] || "";

                // Use direct DOM manipulation instead of innerHTML for better reliability
                if (arrowValue) {
                    // Clear existing content
                    while (element.firstChild) {
                        element.removeChild(element.firstChild);
                    }

                    // Create the new icon element
                    const tmpDiv = document.createElement('div');
                    tmpDiv.innerHTML = arrowValue;
                    const iconElement = tmpDiv.firstChild;

                    // Make the arrow more visible
                    if (iconElement) {
                        element.appendChild(iconElement);

                        // Force the arrow to be visible
                        iconElement.style.display = "inline-block";
                    }
                }

                applied++;
            } else {
                missing++;
            }
        });

        return applied;
    }

    applyArrowsToFoundElements(elements) {
        let applied = 0;

        Object.keys(elements).forEach(key => {
            if (this.arrowStates[key]) {
                const element = elements[key];
                element.innerHTML = this.arrowStates[key];
                applied++;
            }
        });
    }

    updateIndicators(newMetrics, forceReset = false) {
        if (!newMetrics) return this.arrowStates;

        // Define metrics that should have indicators
        const metricKeys = [
            "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
            "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
            "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
            "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
            "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats",
            "estimated_rewards_in_window_sats", "workers_hashing"
        ];

        // Clear all arrows if requested
        if (forceReset) {
            metricKeys.forEach(key => {
                this.arrowStates[key] = "";
            });
        }

        // Current theme affects arrow colors
        const theme = getCurrentTheme();
        const upArrowColor = THEME.SHARED.GREEN;
        const downArrowColor = THEME.SHARED.RED;

        // Get normalized values and compare with previous metrics
        for (const key of metricKeys) {
            if (newMetrics[key] === undefined) continue;

            const newValue = this.getNormalizedValue(newMetrics, key);
            if (newValue === null) continue;

            if (this.previousMetrics[key] !== undefined) {
                const prevValue = this.previousMetrics[key];

                if (newValue > prevValue * (1 + this.changeThreshold)) {
                    this.arrowStates[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green; display: inline-block !important;'></i>";
                }
                else if (newValue < prevValue * (1 - this.changeThreshold)) {
                    this.arrowStates[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px; display: inline-block !important;'></i>";
                }
            }

            this.previousMetrics[key] = newValue;
        }

        // Apply arrows to DOM
        this.forceApplyArrows();

        // Save to localStorage for persistence
        this.saveToStorage();

        return this.arrowStates;
    }

    // Get a normalized value for a metric to ensure consistent comparisons
    getNormalizedValue(metrics, key) {
        const value = parseFloat(metrics[key]);
        if (isNaN(value)) return null;

        // Special handling for hashrate values to normalize units
        if (key.includes('hashrate')) {
            const unit = metrics[key + '_unit'] || 'th/s';
            return this.normalizeHashrate(value, unit);
        }

        return value;
    }

    // Normalize hashrate to a common unit (TH/s)
    normalizeHashrate(value, unit) {
        if (!value || isNaN(value)) return 0;

        unit = (unit || 'th/s').toLowerCase();
        if (unit.includes('ph/s')) {
            return value * 1000; // Convert PH/s to TH/s
        } else if (unit.includes('eh/s')) {
            return value * 1000000; // Convert EH/s to TH/s
        } else if (unit.includes('gh/s')) {
            return value / 1000; // Convert GH/s to TH/s
        } else if (unit.includes('mh/s')) {
            return value / 1000000; // Convert MH/s to TH/s
        } else if (unit.includes('kh/s')) {
            return value / 1000000000; // Convert KH/s to TH/s
        } else if (unit.includes('h/s') && !unit.includes('th/s') && !unit.includes('ph/s') &&
            !unit.includes('eh/s') && !unit.includes('gh/s') && !unit.includes('mh/s') &&
            !unit.includes('kh/s')) {
            return value / 1000000000000; // Convert H/s to TH/s
        } else {
            // Assume TH/s if unit is not recognized
            return value;
        }
    }

    // Save current state to localStorage
    saveToStorage() {
        try {
            // Save arrow states
            localStorage.setItem('dashboardArrows', JSON.stringify(this.arrowStates));

            // Save previous metrics for comparison after page reload
            localStorage.setItem('dashboardPreviousMetrics', JSON.stringify(this.previousMetrics));
        } catch (e) {
            console.error("Error saving arrow indicators to localStorage:", e);
        }
    }

    // Load state from localStorage
    loadFromStorage() {
        try {
            // Load arrow states
            const savedArrows = localStorage.getItem('dashboardArrows');
            if (savedArrows) {
                this.arrowStates = JSON.parse(savedArrows);
            }

            // Load previous metrics
            const savedMetrics = localStorage.getItem('dashboardPreviousMetrics');
            if (savedMetrics) {
                this.previousMetrics = JSON.parse(savedMetrics);
            }
        } catch (e) {
            console.error("Error loading arrow indicators from localStorage:", e);
            // On error, reset to defaults
            this.arrowStates = {};
            this.previousMetrics = {};
        }
    }

    // Handle storage events for cross-tab synchronization
    handleStorageEvent(event) {
        if (event.key === 'dashboardArrows') {
            try {
                const newArrows = JSON.parse(event.newValue);
                this.arrowStates = newArrows;
                this.forceApplyArrows();
            } catch (e) {
                console.error("Error handling storage event:", e);
            }
        }
    }

    // Reset for new refresh cycle
    prepareForRefresh() {
        Object.keys(this.arrowStates).forEach(key => {
            this.arrowStates[key] = "";
        });
        this.forceApplyArrows();
    }

    // Clear all indicators
    clearAll() {
        this.arrowStates = {};
        this.previousMetrics = {};
        this.forceApplyArrows();
        this.saveToStorage();
    }
}

// Create the singleton instance
const arrowIndicator = new ArrowIndicator();

// Global timezone configuration
let dashboardTimezone = 'America/Los_Angeles'; // Default
window.dashboardTimezone = dashboardTimezone; // Make it globally accessible

// Fetch the configured timezone when the page loads
function fetchTimezoneConfig() {
    fetch('/api/timezone')
        .then(response => response.json())
        .then(data => {
            if (data && data.timezone) {
                dashboardTimezone = data.timezone;
                window.dashboardTimezone = dashboardTimezone; // Make it globally accessible
                console.log(`Using configured timezone: ${dashboardTimezone}`);
            }
        })
        .catch(error => console.error('Error fetching timezone config:', error));
}

// Call this on page load
document.addEventListener('DOMContentLoaded', fetchTimezoneConfig);

// Global variables
let previousMetrics = {};
let latestMetrics = null;
let initialLoad = true;
let trendData = [];
let trendLabels = [];
let trendChart = null;
let connectionRetryCount = 0;
let maxRetryCount = 10;
let reconnectionDelay = 1000; // Start with 1 second
let pingInterval = null;
let lastPingTime = Date.now();
let connectionLostTimeout = null;

// Server time variables for uptime calculation
let serverTimeOffset = 0;
let serverStartTime = null;

// Register Chart.js annotation plugin if available
if (window['chartjs-plugin-annotation']) {
    Chart.register(window['chartjs-plugin-annotation']);
}

// Hashrate Normalization Utilities
// Helper function to normalize hashrate to TH/s for consistent graphing
function normalizeHashrate(value, unit) {
    if (!value || isNaN(value)) return 0;

    unit = (unit || 'th/s').toLowerCase();
    if (unit.includes('ph/s')) {
        return value * 1000; // Convert PH/s to TH/s
    } else if (unit.includes('eh/s')) {
        return value * 1000000; // Convert EH/s to TH/s
    } else if (unit.includes('gh/s')) {
        return value / 1000; // Convert GH/s to TH/s
    } else if (unit.includes('mh/s')) {
        return value / 1000000; // Convert MH/s to TH/s
    } else if (unit.includes('kh/s')) {
        return value / 1000000000; // Convert KH/s to TH/s
    } else if (unit.includes('h/s') && !unit.includes('th/s') && !unit.includes('ph/s') &&
        !unit.includes('eh/s') && !unit.includes('gh/s') && !unit.includes('mh/s') &&
        !unit.includes('kh/s')) {
        return value / 1000000000000; // Convert H/s to TH/s
    } else {
        // Assume TH/s if unit is not recognized
        return value;
    }
}

// Helper function to format hashrate values for display
function formatHashrateForDisplay(value, unit) {
    if (isNaN(value) || value === null || value === undefined) return "N/A";

    // Always normalize to TH/s first if unit is provided
    let normalizedValue = unit ? normalizeHashrate(value, unit) : value;

    // Select appropriate unit based on magnitude
    if (normalizedValue >= 1000000) { // EH/s range
        return (normalizedValue / 1000000).toFixed(2) + ' EH/s';
    } else if (normalizedValue >= 1000) { // PH/s range
        return (normalizedValue / 1000).toFixed(2) + ' PH/s';
    } else if (normalizedValue >= 1) { // TH/s range
        return normalizedValue.toFixed(2) + ' TH/s';
    } else if (normalizedValue >= 0.001) { // GH/s range
        return (normalizedValue * 1000).toFixed(2) + ' GH/s';
    } else { // MH/s range or smaller
        return (normalizedValue * 1000000).toFixed(2) + ' MH/s';
    }
}

// Function to calculate block finding probability based on hashrate and network hashrate
function calculateBlockProbability(yourHashrate, yourHashrateUnit, networkHashrate) {
    // First normalize both hashrates to the same unit (TH/s)
    const normalizedYourHashrate = normalizeHashrate(yourHashrate, yourHashrateUnit);

    // Network hashrate is in EH/s, convert to TH/s (1 EH/s = 1,000,000 TH/s)
    const networkHashrateInTH = networkHashrate * 1000000;

    // Calculate probability as your_hashrate / network_hashrate
    const probability = normalizedYourHashrate / networkHashrateInTH;

    // Format the probability for display
    return formatProbability(probability);
}

// Format probability for display
function formatProbability(probability) {
    // Format as 1 in X chance (more intuitive for small probabilities)
    if (probability > 0) {
        const oneInX = Math.round(1 / probability);
        return `1 : ${numberWithCommas(oneInX)}`;
    } else {
        return "N/A";
    }
}

// Calculate theoretical time to find a block based on hashrate
function calculateBlockTime(yourHashrate, yourHashrateUnit, networkHashrate) {
    // First normalize both hashrates to the same unit (TH/s)
    const normalizedYourHashrate = normalizeHashrate(yourHashrate, yourHashrateUnit);

    // Make sure network hashrate is a valid number
    if (typeof networkHashrate !== 'number' || isNaN(networkHashrate) || networkHashrate <= 0) {
        console.error("Invalid network hashrate:", networkHashrate);
        return "N/A";
    }

    // Network hashrate is in EH/s, convert to TH/s (1 EH/s = 1,000,000 TH/s)
    const networkHashrateInTH = networkHashrate * 1000000;

    // Calculate the probability of finding a block per hash attempt
    const probability = normalizedYourHashrate / networkHashrateInTH;

    // Bitcoin produces a block every 10 minutes (600 seconds) on average
    const secondsToFindBlock = 600 / probability;

    // Log the calculation for debugging
    console.log(`Block time calculation using network hashrate: ${networkHashrate} EH/s`);
    console.log(`Your hashrate: ${yourHashrate} ${yourHashrateUnit} (normalized: ${normalizedYourHashrate} TH/s)`);
    console.log(`Probability: ${normalizedYourHashrate} / (${networkHashrate} * 1,000,000) = ${probability}`);
    console.log(`Time to find block: 600 seconds / ${probability} = ${secondsToFindBlock} seconds`);
    console.log(`Estimated time: ${secondsToFindBlock / 86400} days (${secondsToFindBlock / 86400 / 365.25} years)`);

    return formatTimeRemaining(secondsToFindBlock);
}

// Format time in seconds to a readable format (similar to est_time_to_payout)
function formatTimeRemaining(seconds) {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) {
        return "N/A";
    }

    // Extremely large values (over 100 years) are not useful
    if (seconds > 3153600000) { // 100 years in seconds
        return "Never (statistically)";
    }

    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;
    const months = days / 30.44; // Average month length
    const years = days / 365.25; // Account for leap years

    if (years >= 1) {
        // For very long timeframes, show years and months
        const remainingMonths = Math.floor((years - Math.floor(years)) * 12);
        if (remainingMonths > 0) {
            return `${Math.floor(years)} year${Math.floor(years) !== 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(years)} year${Math.floor(years) !== 1 ? 's' : ''}`;
    } else if (months >= 1) {
        // For months, show months and days
        const remainingDays = Math.floor((months - Math.floor(months)) * 30.44);
        if (remainingDays > 0) {
            return `${Math.floor(months)} month${Math.floor(months) !== 1 ? 's' : ''}, ${remainingDays} day${remainingDays !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(months)} month${Math.floor(months) !== 1 ? 's' : ''}`;
    } else if (days >= 1) {
        // For days, show days and hours
        const remainingHours = Math.floor((days - Math.floor(days)) * 24);
        if (remainingHours > 0) {
            return `${Math.floor(days)} day${Math.floor(days) !== 1 ? 's' : ''}, ${remainingHours} hour${remainingHours !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(days)} day${Math.floor(days) !== 1 ? 's' : ''}`;
    } else if (hours >= 1) {
        // For hours, show hours and minutes
        const remainingMinutes = Math.floor((hours - Math.floor(hours)) * 60);
        if (remainingMinutes > 0) {
            return `${Math.floor(hours)} hour${Math.floor(hours) !== 1 ? 's' : ''}, ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
        }
        return `${Math.floor(hours)} hour${Math.floor(hours) !== 1 ? 's' : ''}`;
    } else {
        // For minutes, just show minutes
        return `${Math.ceil(minutes)} minute${Math.ceil(minutes) !== 1 ? 's' : ''}`;
    }
}

// Calculate pool luck as a percentage
function calculatePoolLuck(actualSats, estimatedSats) {
    if (!actualSats || !estimatedSats || estimatedSats === 0) {
        return null;
    }

    // Calculate luck as a percentage (actual/estimated * 100)
    const luck = (actualSats / estimatedSats) * 100;
    return luck;
}

// Format luck percentage for display with color coding
function formatLuckPercentage(luckPercentage) {
    if (luckPercentage === null) {
        return "N/A";
    }

    const formattedLuck = luckPercentage.toFixed(1) + "%";

    // Don't add classes here, just return the formatted value
    // The styling will be applied separately based on the value
    return formattedLuck;
}

// SSE Connection with Error Handling and Reconnection Logic
function setupEventSource() {
    console.log("Setting up EventSource connection...");

    if (window.eventSource) {
        console.log("Closing existing EventSource connection");
        window.eventSource.close();
        window.eventSource = null;
    }

    // Always use absolute URL with origin to ensure it works from any path
    const baseUrl = window.location.origin;
    const streamUrl = `${baseUrl}/stream`;

    // Clear any existing ping interval
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }

    // Clear any connection lost timeout
    if (connectionLostTimeout) {
        clearTimeout(connectionLostTimeout);
        connectionLostTimeout = null;
    }

    try {
        const eventSource = new EventSource(streamUrl);

        eventSource.onopen = function (e) {
            console.log("EventSource connection opened successfully");
            connectionRetryCount = 0; // Reset retry count on successful connection
            reconnectionDelay = 1000; // Reset reconnection delay
            hideConnectionIssue();

            // Start ping interval to detect dead connections
            lastPingTime = Date.now();
            pingInterval = setInterval(function () {
                const now = Date.now();
                if (now - lastPingTime > 60000) { // 60 seconds without data
                    console.warn("No data received for 60 seconds, reconnecting...");
                    showConnectionIssue("Connection stalled");
                    eventSource.close();
                    setupEventSource();
                }
            }, 30000); // Check every 30 seconds
        };

        eventSource.onmessage = function (e) {
            lastPingTime = Date.now(); // Update ping time on any message

            try {
                const data = JSON.parse(e.data);

                // Handle different message types
                if (data.type === "ping") {
                    // Update connection count if available
                    if (data.connections !== undefined) {
                        console.log(`Active connections: ${data.connections}`);
                    }
                    return;
                }

                if (data.type === "timeout_warning") {
                    console.log(`Connection timeout warning: ${data.remaining}s remaining`);
                    // If less than 30 seconds remaining, prepare for reconnection
                    if (data.remaining < 30) {
                        console.log("Preparing for reconnection due to upcoming timeout");
                    }
                    return;
                }

                if (data.type === "timeout") {
                    console.log("Connection timeout from server:", data.message);
                    eventSource.close();
                    // If reconnect flag is true, reconnect immediately
                    if (data.reconnect) {
                        console.log("Server requested reconnection");
                        setTimeout(setupEventSource, 500);
                    } else {
                        setupEventSource();
                    }
                    return;
                }

                if (data.error) {
                    console.error("Server reported error:", data.error);
                    showConnectionIssue(data.error);

                    // If retry time provided, use it, otherwise use default
                    const retryTime = data.retry || 5000;
                    setTimeout(function () {
                        manualRefresh();
                    }, retryTime);
                    return;
                }

                // Process regular data update
                latestMetrics = data;
                updateUI();
                hideConnectionIssue();

                // Notify BitcoinMinuteRefresh that we did a refresh
                BitcoinMinuteRefresh.notifyRefresh();
            } catch (err) {
                console.error("Error processing SSE data:", err);
                showConnectionIssue("Data processing error");
            }
        };

        eventSource.onerror = function (e) {
            console.error("SSE connection error", e);
            showConnectionIssue("Connection lost");

            eventSource.close();

            // Implement exponential backoff for reconnection
            connectionRetryCount++;

            if (connectionRetryCount > maxRetryCount) {
                console.log("Maximum retry attempts reached, switching to polling mode");
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = null;
                }

                // Switch to regular polling
                showConnectionIssue("Using polling mode");
                setInterval(manualRefresh, 30000); // Poll every 30 seconds
                manualRefresh(); // Do an immediate refresh
                return;
            }

            // Exponential backoff with jitter
            const jitter = Math.random() * 0.3 + 0.85; // 0.85-1.15
            reconnectionDelay = Math.min(30000, reconnectionDelay * 1.5 * jitter);

            console.log(`Reconnecting in ${(reconnectionDelay / 1000).toFixed(1)} seconds... (attempt ${connectionRetryCount}/${maxRetryCount})`);
            setTimeout(setupEventSource, reconnectionDelay);
        };

        window.eventSource = eventSource;

        // Set a timeout to detect if connection is established
        connectionLostTimeout = setTimeout(function () {
            if (eventSource.readyState !== 1) { // 1 = OPEN
                console.warn("Connection not established within timeout, switching to manual refresh");
                showConnectionIssue("Connection timeout");
                eventSource.close();
                manualRefresh();
            }
        }, 30000); // 30 seconds timeout to establish connection

    } catch (error) {
        console.error("Failed to create EventSource:", error);
        showConnectionIssue("Connection setup failed");
        setTimeout(setupEventSource, 5000); // Try again in 5 seconds
    }

    // Add page visibility change listener
    // This helps reconnect when user returns to the tab after it's been inactive
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
}

// Handle page visibility changes
function handleVisibilityChange() {
    if (!document.hidden) {
        console.log("Page became visible, checking connection");
        if (!window.eventSource || window.eventSource.readyState !== 1) {
            console.log("Connection not active, reestablishing");
            setupEventSource();
        }
        manualRefresh(); // Always refresh data when page becomes visible
    }
}

// Helper function to show connection issues to the user
function showConnectionIssue(message) {
    const theme = getCurrentTheme();
    let $connectionStatus = $("#connectionStatus");
    if (!$connectionStatus.length) {
        $("body").append(`<div id="connectionStatus" style="position: fixed; top: 10px; right: 10px; background: rgba(255,0,0,0.7); color: white; padding: 10px; border-radius: 5px; z-index: 9999;"></div>`);
        $connectionStatus = $("#connectionStatus");
    }
    $connectionStatus.html(`<i class="fas fa-exclamation-triangle"></i> ${message}`).show();

    // Show manual refresh button with theme color
    $("#refreshButton").css('background-color', theme.PRIMARY).show();
}

// Helper function to hide connection issue message
function hideConnectionIssue() {
    $("#connectionStatus").hide();
    $("#refreshButton").hide();
}

// Improved manual refresh function as fallback
function manualRefresh() {
    console.log("Manually refreshing data...");

    // Prepare arrow indicators for a new refresh cycle
    arrowIndicator.prepareForRefresh();

    $.ajax({
        url: '/api/metrics',
        method: 'GET',
        dataType: 'json',
        timeout: 15000, // 15 second timeout
        success: function (data) {
            console.log("Manual refresh successful");
            lastPingTime = Date.now();
            latestMetrics = data;

            updateUI();
            hideConnectionIssue();

            // Notify BitcoinMinuteRefresh that we've refreshed the data
            BitcoinMinuteRefresh.notifyRefresh();
        },
        error: function (xhr, status, error) {
            console.error("Manual refresh failed:", error);
            showConnectionIssue("Manual refresh failed");

            // Try again with exponential backoff
            const retryDelay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(5, connectionRetryCount)));
            connectionRetryCount++;
            setTimeout(manualRefresh, retryDelay);
        }
    });
}

// Modify the initializeChart function to use blue colors for the chart
function initializeChart() {
    try {
        const ctx = document.getElementById('trendGraph').getContext('2d');
        if (!ctx) {
            console.error("Could not find trend graph canvas");
            return null;
        }

        if (!window.Chart) {
            console.error("Chart.js not loaded");
            return null;
        }

        // Get the current theme colors
        const theme = getCurrentTheme();

        // Check if Chart.js plugin is available
        const hasAnnotationPlugin = window['chartjs-plugin-annotation'] !== undefined;

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'HASHRATE TREND (TH/s)',
                    data: [],
                    borderWidth: 2,
                    borderColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return theme.PRIMARY;
                        }
                        // Create gradient for line
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, theme.CHART.GRADIENT_START);
                        gradient.addColorStop(1, theme.CHART.GRADIENT_END);
                        return gradient;
                    },
                    backgroundColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return `rgba(${theme.PRIMARY_RGB}, 0.1)`;
                        }
                        // Create gradient for fill
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, `rgba(${theme.PRIMARY_RGB}, 0.3)`);
                        gradient.addColorStop(0.5, `rgba(${theme.PRIMARY_RGB}, 0.2)`);
                        gradient.addColorStop(1, `rgba(${theme.PRIMARY_RGB}, 0.05)`);
                        return gradient;
                    },
                    fill: true,
                    tension: 0.3,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 0 // Disable animations for better performance
                },
                scales: {
                    x: {
                        display: true,
                        ticks: {
                            maxTicksLimit: 8, // Limit number of x-axis labels
                            maxRotation: 0,   // Don't rotate labels
                            autoSkip: true,   // Automatically skip some labels
                            color: '#FFFFFF',
                            font: {
                                family: "'VT323', monospace", // Terminal font
                                size: 14
                            }
                        },
                        grid: {
                            color: '#333333',
                            lineWidth: 0.5
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'HASHRATE (TH/S)',
                            color: theme.PRIMARY,
                            font: {
                                family: "'VT323', monospace",
                                size: 16,
                                weight: 'bold'
                            }
                        },
                        ticks: {
                            color: '#FFFFFF',
                            maxTicksLimit: 6, // Limit total number of ticks
                            precision: 1,     // Control decimal precision
                            autoSkip: true,   // Skip labels to prevent overcrowding
                            autoSkipPadding: 10, // Padding between skipped labels
                            font: {
                                family: "'VT323', monospace", // Terminal font
                                size: 14
                            },
                            callback: function (value) {
                                // For zero, just return 0
                                if (value === 0) return '0';

                                // For large values (1000+ TH/s), show in PH/s
                                if (value >= 1000) {
                                    return (value / 1000).toFixed(1) + ' PH';
                                }
                                // For values between 10 and 1000 TH/s
                                else if (value >= 10) {
                                    return Math.round(value);
                                }
                                // For small values, limit decimal places
                                else if (value >= 1) {
                                    return value.toFixed(1);
                                }
                                // For tiny values, use appropriate precision
                                else {
                                    return value.toPrecision(2);
                                }
                            }
                        },
                        grid: {
                            color: '#333333',
                            lineWidth: 0.5,
                            drawBorder: false,
                            zeroLineColor: '#555555',
                            zeroLineWidth: 1,
                            drawTicks: false
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: theme.PRIMARY,
                        bodyColor: '#FFFFFF',
                        titleFont: {
                            family: "'VT323', monospace",
                            size: 16,
                            weight: 'bold'
                        },
                        bodyFont: {
                            family: "'VT323', monospace",
                            size: 14
                        },
                        padding: 10,
                        cornerRadius: 0,
                        displayColors: false,
                        callbacks: {
                            title: function (tooltipItems) {
                                return tooltipItems[0].label.toUpperCase();
                            },
                            label: function (context) {
                                // Format tooltip values with appropriate unit
                                const value = context.raw;
                                return 'HASHRATE: ' + formatHashrateForDisplay(value).toUpperCase();
                            }
                        }
                    },
                    legend: { display: false },
                    annotation: hasAnnotationPlugin ? {
                        annotations: {
                            averageLine: {
                                type: 'line',
                                yMin: 0,
                                yMax: 0,
                                borderColor: theme.CHART.ANNOTATION,
                                borderWidth: 3,
                                borderDash: [8, 4],
                                shadowColor: `rgba(${theme.PRIMARY_RGB}, 0.5)`,
                                shadowBlur: 8,
                                shadowOffsetX: 0,
                                shadowOffsetY: 0,
                                label: {
                                    enabled: true,
                                    content: '24HR AVG: 0 TH/S',
                                    backgroundColor: 'rgba(0,0,0,0.8)',
                                    color: theme.CHART.ANNOTATION,
                                    font: {
                                        family: "'VT323', monospace",
                                        size: 16,
                                        weight: 'bold'
                                    },
                                    padding: { top: 4, bottom: 4, left: 8, right: 8 },
                                    borderRadius: 0,
                                    position: 'start'
                                }
                            }
                        }
                    } : {}
                }
            }
        });
    } catch (error) {
        console.error("Error initializing chart:", error);
        return null;
    }
}

// Helper function to safely format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Server time update via polling
function updateServerTime() {
    $.ajax({
        url: "/api/time",
        method: "GET",
        timeout: 5000,
        success: function (data) {
            // Calculate the offset between server time and local time
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();

            // Update BitcoinMinuteRefresh with server time info
            BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);

            console.log("Server time synchronized. Offset:", serverTimeOffset, "ms");
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", textStatus, errorThrown);
        }
    });
}

// Update UI indicators (arrows) - replaced with ArrowIndicator call
function updateIndicators(newMetrics) {
    arrowIndicator.updateIndicators(newMetrics);
}

// Helper function to safely update element text content
function updateElementText(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
    }
}

// Helper function to safely update element HTML content
function updateElementHTML(elementId, html) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = html;
    }
}

// Update workers_hashing value from metrics, but don't try to access worker details
function updateWorkersCount() {
    if (latestMetrics && latestMetrics.workers_hashing !== undefined) {
        $("#workers_hashing").text(latestMetrics.workers_hashing || 0);

        // Update miner status with online/offline indicator based on worker count
        if (latestMetrics.workers_hashing > 0) {
            updateElementHTML("miner_status", "<span class='status-green'>ONLINE</span> <span class='online-dot'></span>");
        } else {
            updateElementHTML("miner_status", "<span class='status-red'>OFFLINE</span> <span class='offline-dot'></span>");
        }
    }
}

// Check for block updates and show congratulatory messages
function checkForBlockUpdates(data) {
    if (previousMetrics.last_block_height !== undefined &&
        data.last_block_height !== previousMetrics.last_block_height) {
        showCongrats("Congrats! New Block Found: " + data.last_block_height);
    }

    if (previousMetrics.blocks_found !== undefined &&
        data.blocks_found !== previousMetrics.blocks_found) {
        showCongrats("Congrats! Blocks Found updated: " + data.blocks_found);
    }
}

// Helper function to show congratulatory messages with timestamps
function showCongrats(message) {
    const $congrats = $("#congratsMessage");

    // Add timestamp to the message
    const now = new Date(Date.now() + serverTimeOffset); // Use server time offset for accuracy
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    const timeString = now.toLocaleTimeString('en-US', options);

    // Format the message with the timestamp
    const messageWithTimestamp = `${message} [${timeString}]`;

    // Display the message
    $congrats.text(messageWithTimestamp).fadeIn(500, function () {
        setTimeout(function () {
            $congrats.fadeOut(500);
        }, 900000); // 15 minutes fade out
    });
}

// Enhanced Chart Update Function with Dynamic Hashrate Selection
function updateChartWithNormalizedData(chart, data) {
    if (!chart || !data) {
        console.warn("Cannot update chart - chart or data is null");
        return;
    }

    try {
        // Always update the 24hr average line even if we don't have data points yet
        const avg24hr = parseFloat(data.hashrate_24hr || 0);
        const avg24hrUnit = data.hashrate_24hr_unit ? data.hashrate_24hr_unit.toLowerCase() : 'th/s';
        const normalizedAvg = normalizeHashrate(avg24hr, avg24hrUnit);

        // Update the 24HR AVG line using the existing formatHashrateForDisplay function
        if (!isNaN(normalizedAvg) &&
            chart.options.plugins.annotation &&
            chart.options.plugins.annotation.annotations &&
            chart.options.plugins.annotation.annotations.averageLine) {
            const annotation = chart.options.plugins.annotation.annotations.averageLine;
            annotation.yMin = normalizedAvg;
            annotation.yMax = normalizedAvg;

            // Use the formatting function already available to ensure consistent units
            const formattedAvg = formatHashrateForDisplay(normalizedAvg);
            annotation.label.content = '24HR AVG: ' + formattedAvg.toUpperCase();
        }

        // Detect low hashrate devices (Bitaxe < 2 TH/s)
        const hashrate60sec = parseFloat(data.hashrate_60sec || 0);
        const hashrate60secUnit = data.hashrate_60sec_unit ? data.hashrate_60sec_unit.toLowerCase() : 'th/s';
        const normalizedHashrate60sec = normalizeHashrate(hashrate60sec, hashrate60secUnit);

        const hashrate3hr = parseFloat(data.hashrate_3hr || 0);
        const hashrate3hrUnit = data.hashrate_3hr_unit ? data.hashrate_3hr_unit.toLowerCase() : 'th/s';
        const normalizedHashrate3hr = normalizeHashrate(hashrate3hr, hashrate3hrUnit);

        // Choose which hashrate average to display based on device characteristics
        let useHashrate3hr = false;

        // For devices with hashrate under 2 TH/s, use the 3hr average if:
        // 1. Their 60sec average is zero (appears offline) AND
        // 2. Their 3hr average shows actual mining activity
        if (normalizedHashrate3hr < 2.0) {
            if (normalizedHashrate60sec < 0.01 && normalizedHashrate3hr > 0.01) {
                useHashrate3hr = true;
                console.log("Low hashrate device detected. Using 3hr average instead of 60sec average.");
            }
        }

        // Process history data if available
        if (data.arrow_history && data.arrow_history.hashrate_60sec) {
            console.log("History data received:", data.arrow_history.hashrate_60sec);

            // If we're using 3hr average, try to use that history if available
            const historyData = useHashrate3hr && data.arrow_history.hashrate_3hr ?
                data.arrow_history.hashrate_3hr : data.arrow_history.hashrate_60sec;

            if (historyData && historyData.length > 0) {
                // Add day info to labels if they cross midnight
                let prevHour = -1;
                let dayCount = 0;

                chart.data.labels = historyData.map(item => {
                    const timeStr = item.time;

                    // Convert the time string to a Date object in Los Angeles timezone
                    let timeParts;
                    if (timeStr.length === 8 && timeStr.indexOf(':') !== -1) {
                        // Format: HH:MM:SS
                        timeParts = timeStr.split(':');
                    } else if (timeStr.length === 5 && timeStr.indexOf(':') !== -1) {
                        // Format: HH:MM
                        timeParts = timeStr.split(':');
                        timeParts.push('00'); // Add seconds
                    } else {
                        // Use current date if format is unexpected
                        return timeStr;
                    }

                    // Create a date object for today with the time
                    const now = new Date();
                    const timeDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                        parseInt(timeParts[0]), parseInt(timeParts[1]), parseInt(timeParts[2] || 0));

                    // Format in 12-hour time for Los Angeles (Pacific Time)
                    // The options define Pacific Time and 12-hour format without AM/PM
                    try {
                        let formattedTime = timeDate.toLocaleTimeString('en-US', {
                            timeZone: dashboardTimezone,
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: true
                        });

                        // Remove the AM/PM part
                        formattedTime = formattedTime.replace(/\s[AP]M$/i, '');

                        return formattedTime;
                    } catch (e) {
                        console.error("Error formatting time:", e);
                        return timeStr.substring(0, 5); // Fallback to original format
                    }
                });

                chart.data.datasets[0].data = historyData.map(item => {
                    const val = parseFloat(item.value);
                    const unit = item.unit || 'th/s'; // Ensure unit is assigned
                    return normalizeHashrate(val, unit);
                });

                // Update chart dataset label to indicate which average we're displaying
                chart.data.datasets[0].label = useHashrate3hr ?
                    'Hashrate Trend (3HR AVG)' : 'Hashrate Trend (60SEC AVG)';

                const values = chart.data.datasets[0].data.filter(v => !isNaN(v) && v !== null);
                if (values.length > 0) {
                    const max = Math.max(...values);
                    const min = Math.min(...values.filter(v => v > 0)) || 0;
                    chart.options.scales.y.min = min * 0.8;
                    chart.options.scales.y.max = max * 1.2;
                    const range = max - min;
                    if (range > 1000) {
                        chart.options.scales.y.ticks.stepSize = 500;
                    } else if (range > 100) {
                        chart.options.scales.y.ticks.stepSize = 50;
                    } else if (range > 10) {
                        chart.options.scales.y.ticks.stepSize = 5;
                    } else {
                        chart.options.scales.y.ticks.stepSize = 1;
                    }
                }
            }
        } else {
            // No history data, just use the current point
            // Format current time in 12-hour format for Los Angeles timezone without AM/PM
            const now = new Date();
            let currentTime;

            try {
                currentTime = now.toLocaleTimeString('en-US', {
                    timeZone: dashboardTimezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).replace(/\s[AP]M$/i, '');
            } catch (e) {
                console.error("Error formatting current time:", e);
                currentTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
            }

            // Choose which current hashrate to display based on our earlier logic
            let currentValue, currentUnit;
            if (useHashrate3hr) {
                currentValue = parseFloat(data.hashrate_3hr || 0);
                currentUnit = data.hashrate_3hr_unit ? data.hashrate_3hr_unit.toLowerCase() : 'th/s';
                chart.data.datasets[0].label = 'Hashrate Trend (3HR AVG)';
            } else {
                currentValue = parseFloat(data.hashrate_60sec || 0);
                currentUnit = data.hashrate_60sec_unit ? data.hashrate_60sec_unit.toLowerCase() : 'th/s';
                chart.data.datasets[0].label = 'Hashrate Trend (60SEC AVG)';
            }

            const normalizedValue = normalizeHashrate(currentValue, currentUnit);
            chart.data.labels = [currentTime];
            chart.data.datasets[0].data = [normalizedValue];
        }

        // In updateChartWithNormalizedData function
        if (useHashrate3hr) {
            // Add indicator text to the chart
            if (!chart.lowHashrateIndicator) {
                // Create the indicator element if it doesn't exist
                const graphContainer = document.getElementById('graphContainer');
                if (graphContainer) {
                    const theme = getCurrentTheme();
                    const indicator = document.createElement('div');
                    indicator.id = 'lowHashrateIndicator';
                    indicator.style.position = 'absolute';

                    // Change position from bottom to top right
                    indicator.style.top = '10px';  // Changed from bottom to top
                    indicator.style.right = '10px';

                    indicator.style.background = 'rgba(0,0,0,0.7)';
                    indicator.style.color = theme.PRIMARY;
                    indicator.style.padding = '5px 10px';
                    indicator.style.borderRadius = '3px';
                    indicator.style.fontSize = '12px';
                    indicator.style.zIndex = '10';
                    indicator.style.fontWeight = 'bold';
                    indicator.textContent = 'LOW HASHRATE MODE: SHOWING 3HR AVG';
                    graphContainer.appendChild(indicator);
                    chart.lowHashrateIndicator = indicator;
                }
            } else {
                // Update color based on current theme
                chart.lowHashrateIndicator.style.color = getCurrentTheme().PRIMARY;
                // Show the indicator if it already exists
                chart.lowHashrateIndicator.style.display = 'block';
            }
        } else if (chart.lowHashrateIndicator) {
            // Hide the indicator when not in low hashrate mode
            chart.lowHashrateIndicator.style.display = 'none';
        }

        chart.update('none');
    } catch (chartError) {
        console.error("Error updating chart:", chartError);
    }
}

// Main UI update function with hashrate normalization
function updateUI() {
    function ensureElementStyles() {
        // Create a style element if it doesn't exist
        if (!document.getElementById('customMetricStyles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'customMetricStyles';
            styleEl.textContent = `
        /* Ensure rows have consistent layout */
        .card-body p {
            position: relative;
            display: grid;
            grid-template-columns: auto auto 1fr;
            align-items: center;
            margin: 0.25rem 0;
            line-height: 1.2;
            gap: 0.25rem;
        }
        
        /* Label style */
        .card-body strong {
            grid-column: 1;
        }
        
        /* Main metric container */
        .main-metric {
            grid-column: 2;
            display: flex;
            align-items: center;
            white-space: nowrap;
        }
        
        /* All dividers */
        .metric-divider-container {
            grid-column: 3;
            justify-self: end;
            display: flex;
            align-items: center;
        }
        
        .metric-divider {
            display: inline-flex;
            align-items: center;
            margin-left: 1rem;
            padding-left: 0.75rem;
            height: 1.5em;
            white-space: nowrap;
        }
        
        .metric-divider-value {
            font-size: 0.85em;
            font-weight: normal;
            margin-right: 0.5rem;
        }
        
        .metric-divider-note {
            font-size: 0.75em;
            opacity: 0.8;
            color: white;
            font-weight: normal;
        }
        
        span[id^="indicator_"] {
            margin-left: 0.25rem;
            width: 1rem;
            display: inline-flex;
        }
        `;
            document.head.appendChild(styleEl);
        }
    }

    // Helper function to create dividers with consistent horizontal alignment
    function createDivider(valueId, valueText, labelText, valueClass = "yellow") {
        const dividerContainer = document.createElement("span");
        dividerContainer.className = "metric-divider";

        // Value element
        const valueSpan = document.createElement("span");
        valueSpan.id = valueId;
        valueSpan.className = `metric-value metric-divider-value ${valueClass}`;
        valueSpan.textContent = valueText;
        dividerContainer.appendChild(valueSpan);

        // Label element
        const labelSpan = document.createElement("span");
        labelSpan.className = "metric-divider-note";
        labelSpan.textContent = labelText;
        dividerContainer.appendChild(labelSpan);

        return dividerContainer;
    }

    if (!latestMetrics) {
        console.warn("No metrics data available");
        return;
    }

    try {
        const data = latestMetrics;

        // If this is the initial load, force a reset of all arrows
        if (initialLoad) {
            arrowIndicator.forceApplyArrows();
            initialLoad = false;
        }

        // Cache jQuery selectors for performance and use safe update methods
        // Format each hashrate with proper normalization

        // Pool Hashrate
        let formattedPoolHashrate = "N/A";
        if (data.pool_total_hashrate != null) {
            formattedPoolHashrate = formatHashrateForDisplay(
                data.pool_total_hashrate,
                data.pool_total_hashrate_unit || 'th/s'
            );
        }
        updateElementText("pool_total_hashrate", formattedPoolHashrate);

        // Add pool luck calculation right after pool_total_hashrate
        if (data.daily_mined_sats && data.estimated_earnings_per_day_sats) {
            const poolLuck = calculatePoolLuck(
                parseFloat(data.daily_mined_sats),
                parseFloat(data.estimated_earnings_per_day_sats)
            );

            // Add pool_luck to the metrics data for arrow indicators
            if (poolLuck !== null) {
                data.pool_luck = poolLuck;
            }

            const poolLuckValue = poolLuck !== null ? formatLuckPercentage(poolLuck) : "N/A";

            // Get the pool_total_hashrate element's parent paragraph
            const poolHashratePara = document.getElementById("pool_total_hashrate").parentNode;

            // Ensure grid layout and structure
            ensureElementStyles();

            // Structure parent for proper grid layout (similar to the other metrics)
            if (!poolHashratePara.querySelector('.main-metric')) {
                const poolHashrate = document.getElementById("pool_total_hashrate");
                const indicatorPoolHashrate = document.getElementById("indicator_pool_total_hashrate");

                // Create the main metric container
                const mainMetric = document.createElement("span");
                mainMetric.className = "main-metric";

                // Move the metric and its indicator inside the container
                if (poolHashrate && indicatorPoolHashrate) {
                    // Clear any existing text nodes between the elements
                    let node = poolHashrate.nextSibling;
                    while (node && node !== indicatorPoolHashrate) {
                        const nextNode = node.nextSibling;
                        if (node.nodeType === 3) { // Text node
                            poolHashratePara.removeChild(node);
                        }
                        node = nextNode;
                    }

                    poolHashrate.parentNode.insertBefore(mainMetric, poolHashrate);
                    mainMetric.appendChild(poolHashrate);
                    mainMetric.appendChild(indicatorPoolHashrate);
                }

                // Create divider container for pool hashrate row
                const dividerContainer = document.createElement("span");
                dividerContainer.className = "metric-divider-container";
                poolHashratePara.appendChild(dividerContainer);
            }

            // Get or create the divider container
            let poolDividerContainer = poolHashratePara.querySelector('.metric-divider-container');
            if (!poolDividerContainer) {
                poolDividerContainer = document.createElement("span");
                poolDividerContainer.className = "metric-divider-container";
                poolHashratePara.appendChild(poolDividerContainer);
            }

            // Check if the "pool_luck" element already exists
            const existingLuck = document.getElementById("pool_luck");
            if (existingLuck) {
                // Update existing element
                existingLuck.textContent = poolLuckValue;

                // Apply appropriate color class based on luck value
                existingLuck.className = "metric-value metric-divider-value";
                if (poolLuck !== null) {
                    if (poolLuck > 110) {
                        existingLuck.classList.add("very-lucky");
                    } else if (poolLuck > 100) {
                        existingLuck.classList.add("lucky");
                    } else if (poolLuck >= 90) {
                        existingLuck.classList.add("normal-luck");
                    } else {
                        existingLuck.classList.add("unlucky");
                    }
                }
            } else {
                // Create the divider if it doesn't exist
                const poolLuckDiv = createDivider("pool_luck", poolLuckValue, "Earnings Efficiency");

                // Apply appropriate color class
                const valueSpan = poolLuckDiv.querySelector('#pool_luck');
                if (valueSpan && poolLuck !== null) {
                    if (poolLuck > 110) {
                        valueSpan.classList.add("very-lucky");
                    } else if (poolLuck > 100) {
                        valueSpan.classList.add("lucky");
                    } else if (poolLuck >= 90) {
                        valueSpan.classList.add("normal-luck");
                    } else {
                        valueSpan.classList.add("unlucky");
                    }
                }

                // Add to divider container
                poolDividerContainer.appendChild(poolLuckDiv);
            }
        }

        // 24hr Hashrate
        let formatted24hrHashrate = "N/A";
        if (data.hashrate_24hr != null) {
            formatted24hrHashrate = formatHashrateForDisplay(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_24hr", formatted24hrHashrate);

        // Update the block time section with consistent addition logic
        let blockTime = "N/A"; // Default value
        if (data.hashrate_24hr != null && data.network_hashrate != null) {
            blockTime = calculateBlockTime(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s',
                data.network_hashrate
            );
        }

        // Find the hashrate_24hr element's parent paragraph
        const hashrate24hrPara = document.getElementById("hashrate_24hr").parentNode;

        // Structure parent for proper grid layout
        if (!hashrate24hrPara.querySelector('.main-metric')) {
            const hashrate24hr = document.getElementById("hashrate_24hr");
            const indicator24hr = document.getElementById("indicator_hashrate_24hr");

            // Create the main metric container
            const mainMetric = document.createElement("span");
            mainMetric.className = "main-metric";

            // Move the metric and its indicator inside the container
            if (hashrate24hr && indicator24hr) {
                // Clear any existing text nodes between the elements
                let node = hashrate24hr.nextSibling;
                while (node && node !== indicator24hr) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) { // Text node
                        hashrate24hrPara.removeChild(node);
                    }
                    node = nextNode;
                }

                hashrate24hr.parentNode.insertBefore(mainMetric, hashrate24hr);
                mainMetric.appendChild(hashrate24hr);
                mainMetric.appendChild(indicator24hr);
            }

            // Create divider container
            const dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate24hrPara.appendChild(dividerContainer);
        }

        // Get or create the divider container
        let dividerContainer = hashrate24hrPara.querySelector('.metric-divider-container');
        if (!dividerContainer) {
            dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate24hrPara.appendChild(dividerContainer);
        }

        // Check if the "block_time" element already exists
        const existingBlockTime = document.getElementById("block_time");
        if (existingBlockTime) {
            // Find the containing metric-divider
            let dividerElement = existingBlockTime.closest('.metric-divider');
            if (dividerElement) {
                // Just update the text
                existingBlockTime.textContent = blockTime;
            } else {
                // If structure is broken, recreate it
                const blockTimeDiv = createDivider("block_time", blockTime, "[Time to ₿]");
                dividerContainer.innerHTML = ''; // Clear container
                dividerContainer.appendChild(blockTimeDiv);
            }
        } else {
            // Create the "Time to ₿" divider
            const blockTimeDiv = createDivider("block_time", blockTime, "[Time to ₿]");
            dividerContainer.appendChild(blockTimeDiv);
        }

        // 3hr Hashrate
        let formatted3hrHashrate = "N/A";
        if (data.hashrate_3hr != null) {
            formatted3hrHashrate = formatHashrateForDisplay(
                data.hashrate_3hr,
                data.hashrate_3hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_3hr", formatted3hrHashrate);

        // Same for 3hr data with blockOdds
        const hashrate3hrPara = document.getElementById("hashrate_3hr").parentNode;

        // Structure parent for proper grid layout
        if (!hashrate3hrPara.querySelector('.main-metric')) {
            const hashrate3hr = document.getElementById("hashrate_3hr");
            const indicator3hr = document.getElementById("indicator_hashrate_3hr");

            // Create the main metric container
            const mainMetric = document.createElement("span");
            mainMetric.className = "main-metric";

            // Move the metric and its indicator inside the container
            if (hashrate3hr && indicator3hr) {
                // Clear any existing text nodes between the elements
                let node = hashrate3hr.nextSibling;
                while (node && node !== indicator3hr) {
                    const nextNode = node.nextSibling;
                    if (node.nodeType === 3) { // Text node
                        hashrate3hrPara.removeChild(node);
                    }
                    node = nextNode;
                }

                hashrate3hr.parentNode.insertBefore(mainMetric, hashrate3hr);
                mainMetric.appendChild(hashrate3hr);
                mainMetric.appendChild(indicator3hr);
            }

            // Create divider container
            const dividerContainer = document.createElement("span");
            dividerContainer.className = "metric-divider-container";
            hashrate3hrPara.appendChild(dividerContainer);
        }

        // Get or create the divider container
        let odds3hrContainer = hashrate3hrPara.querySelector('.metric-divider-container');
        if (!odds3hrContainer) {
            odds3hrContainer = document.createElement("span");
            odds3hrContainer.className = "metric-divider-container";
            hashrate3hrPara.appendChild(odds3hrContainer);
        }

        // Apply the same consistent approach for the block odds section
        if (data.hashrate_24hr != null && data.network_hashrate != null) {
            const blockProbability = calculateBlockProbability(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s',
                data.network_hashrate
            );

            // Update the element if it already exists
            const existingProbability = document.getElementById("block_odds_3hr");
            if (existingProbability) {
                existingProbability.textContent = blockProbability;
            } else {
                // For block odds after 3hr hashrate
                const blockOddsDiv = createDivider("block_odds_3hr", blockProbability, "[₿ Odds]");
                odds3hrContainer.appendChild(blockOddsDiv);
            }
        }

        // 10min Hashrate
        let formatted10minHashrate = "N/A";
        if (data.hashrate_10min != null) {
            formatted10minHashrate = formatHashrateForDisplay(
                data.hashrate_10min,
                data.hashrate_10min_unit || 'th/s'
            );
        }
        updateElementText("hashrate_10min", formatted10minHashrate);

        // 60sec Hashrate
        let formatted60secHashrate = "N/A";
        if (data.hashrate_60sec != null) {
            formatted60secHashrate = formatHashrateForDisplay(
                data.hashrate_60sec,
                data.hashrate_60sec_unit || 'th/s'
            );
        }
        updateElementText("hashrate_60sec", formatted60secHashrate);

        // Update other non-hashrate metrics
        updateElementText("block_number", numberWithCommas(data.block_number));

        updateElementText("btc_price",
            data.btc_price != null ? "$" + numberWithCommas(parseFloat(data.btc_price).toFixed(2)) : "N/A"
        );

        // Update last block earnings
        if (data.last_block_earnings !== undefined) {
            // Format with "+" prefix and "SATS" suffix
            updateElementText("last_block_earnings",
                "+" + numberWithCommas(data.last_block_earnings) + " SATS");
        }

        // Network hashrate (already in EH/s but verify)
        // Improved version with ZH/s support:
        if (data.network_hashrate >= 1000) {
            // Convert to Zettahash if over 1000 EH/s
            updateElementText("network_hashrate",
                (data.network_hashrate / 1000).toFixed(2) + " ZH/s");
        } else {
            // Use regular EH/s formatting
            updateElementText("network_hashrate",
                numberWithCommas(Math.round(data.network_hashrate)) + " EH/s");
        }
        updateElementText("difficulty", numberWithCommas(Math.round(data.difficulty)));

        // Daily revenue
        updateElementText("daily_revenue", "$" + numberWithCommas(data.daily_revenue.toFixed(2)));

        // Daily power cost
        updateElementText("daily_power_cost", "$" + numberWithCommas(data.daily_power_cost.toFixed(2)));

        // Daily profit USD - Add red color if negative
        const dailyProfitUSD = data.daily_profit_usd;
        const dailyProfitElement = document.getElementById("daily_profit_usd");
        if (dailyProfitElement) {
            dailyProfitElement.textContent = "$" + numberWithCommas(dailyProfitUSD.toFixed(2));
            if (dailyProfitUSD < 0) {
                // Use setAttribute to properly set the style with !important
                dailyProfitElement.setAttribute("style", "color: #ff5555 !important; font-weight: bold !important;");
            } else {
                // Clear the style attribute completely instead of setting it to empty
                dailyProfitElement.removeAttribute("style");
            }
        }

        // Monthly profit USD - Add red color if negative
        const monthlyProfitUSD = data.monthly_profit_usd;
        const monthlyProfitElement = document.getElementById("monthly_profit_usd");
        if (monthlyProfitElement) {
            monthlyProfitElement.textContent = "$" + numberWithCommas(monthlyProfitUSD.toFixed(2));
            if (monthlyProfitUSD < 0) {
                // Use setAttribute to properly set the style with !important
                monthlyProfitElement.setAttribute("style", "color: #ff5555 !important; font-weight: bold !important;");
            } else {
                // Clear the style attribute completely
                monthlyProfitElement.removeAttribute("style");
            }
        }

        updateElementText("daily_mined_sats", numberWithCommas(data.daily_mined_sats) + " SATS");
        updateElementText("monthly_mined_sats", numberWithCommas(data.monthly_mined_sats) + " SATS");

        // Update worker count from metrics (just the number, not full worker data)
        updateWorkersCount();

        updateElementText("unpaid_earnings", data.unpaid_earnings.toFixed(8) + " BTC");

        // Update payout estimation with color coding
        const payoutText = data.est_time_to_payout;
        updateElementText("est_time_to_payout", payoutText);

        // Check for "next block" in any case format
        if (payoutText && /next\s+block/i.test(payoutText)) {
            $("#est_time_to_payout").attr("style", "color: #32CD32 !important; animation: pulse 1s infinite !important; text-transform: uppercase !important;");
        } else {
            // Trim any extra whitespace
            const cleanText = payoutText ? payoutText.trim() : "";
            // Update your regex to handle hours-only format as well
            const regex = /(?:(\d+)\s*days?(?:,?\s*(\d+)\s*hours?)?)|(?:(\d+)\s*hours?)/i;
            const match = cleanText.match(regex);

            let totalDays = NaN;
            if (match) {
                if (match[1]) {
                    // Format: "X days" or "X days, Y hours"
                    const days = parseFloat(match[1]);
                    const hours = match[2] ? parseFloat(match[2]) : 0;
                    totalDays = days + (hours / 24);
                } else if (match[3]) {
                    // Format: "X hours"
                    const hours = parseFloat(match[3]);
                    totalDays = hours / 24;
                }
                console.log("Total days computed:", totalDays);  // Debug output
            }

            if (!isNaN(totalDays)) {
                if (totalDays < 4) {
                    $("#est_time_to_payout").attr("style", "color: #32CD32 !important; animation: none !important;");
                } else if (totalDays > 20) {
                    $("#est_time_to_payout").attr("style", "color: #ff5555 !important; animation: none !important;");
                } else {
                    $("#est_time_to_payout").attr("style", "color: #ffd700 !important; animation: none !important;");
                }
            } else {
                $("#est_time_to_payout").attr("style", "color: #ffd700 !important; animation: none !important;");
            }
        }

        updateElementText("last_block_height", data.last_block_height ? numberWithCommas(data.last_block_height) : "N/A");
        updateElementText("last_block_time", data.last_block_time || "");
        updateElementText("blocks_found", data.blocks_found || "0");
        updateElementText("last_share", data.total_last_share || "");

        // Update Estimated Earnings metrics
        updateElementText("estimated_earnings_per_day_sats", numberWithCommas(data.estimated_earnings_per_day_sats) + " SATS");
        updateElementText("estimated_earnings_next_block_sats", numberWithCommas(data.estimated_earnings_next_block_sats) + " SATS");
        updateElementText("estimated_rewards_in_window_sats", numberWithCommas(data.estimated_rewards_in_window_sats) + " SATS");

        // Update last updated timestamp
        try {
            // Get the configured timezone with fallback
            const configuredTimezone = window.dashboardTimezone || 'America/Los_Angeles';

            // Use server timestamp from metrics if available, otherwise use adjusted local time
            const timestampToUse = latestMetrics && latestMetrics.server_timestamp ?
                new Date(latestMetrics.server_timestamp) :
                new Date(Date.now() + (serverTimeOffset || 0));

            // Format with explicit timezone
            const options = {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true,
                timeZone: configuredTimezone // Explicitly set timezone
            };

            // Update the lastUpdated element
            updateElementHTML("lastUpdated",
                "<strong>Last Updated:</strong> " +
                timestampToUse.toLocaleString('en-US', options) +
                "<span id='terminal-cursor'></span>");

            console.log(`Last updated timestamp shown using timezone: ${configuredTimezone}`);
        } catch (error) {
            console.error("Error formatting last updated timestamp:", error);
            // Fallback to basic timestamp if there's an error
            const now = new Date();
            updateElementHTML("lastUpdated",
                "<strong>Last Updated:</strong> " +
                now.toLocaleString() +
                "<span id='terminal-cursor'></span>");
        }

        // Update chart with normalized data if it exists
        if (trendChart) {
            // Use the enhanced chart update function with normalization
            updateChartWithNormalizedData(trendChart, data);
        }

        // Update indicators and check for block updates
        updateIndicators(data);
        checkForBlockUpdates(data);

        // Store current metrics for next comparison
        previousMetrics = { ...data };

    } catch (error) {
        console.error("Error updating UI:", error);
    }
}


// Update unread notifications badge in navigation
function updateNotificationBadge() {
    $.ajax({
        url: "/api/notifications/unread_count",
        method: "GET",
        success: function (data) {
            const unreadCount = data.unread_count;
            const badge = $("#nav-unread-badge");

            if (unreadCount > 0) {
                badge.text(unreadCount).show();
            } else {
                badge.hide();
            }
        }
    });
}

// Initialize notification badge checking
function initNotificationBadge() {
    // Update immediately
    updateNotificationBadge();

    // Update every 60 seconds
    setInterval(updateNotificationBadge, 60000);
}

// Modify the resetDashboardChart function
function resetDashboardChart() {
    console.log("Resetting dashboard chart data");

    if (trendChart) {
        // Reset chart data arrays first (always succeeds)
        trendChart.data.labels = [];
        trendChart.data.datasets[0].data = [];
        trendChart.update('none');

        // Show immediate feedback
        showConnectionIssue("Resetting chart data...");

        // Then call the API to clear underlying data
        $.ajax({
            url: '/api/reset-chart-data',
            method: 'POST',
            success: function (response) {
                console.log("Server data reset:", response);
                showConnectionIssue("Chart data reset successfully");
                setTimeout(hideConnectionIssue, 3000);
            },
            error: function (xhr, status, error) {
                console.error("Error resetting chart data:", error);
                showConnectionIssue("Chart display reset (backend error: " + error + ")");
                setTimeout(hideConnectionIssue, 5000);
            }
        });
    }
}

$(document).ready(function () {
    // Apply theme based on stored preference - moved to beginning for better initialization
    try {
        const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
        if (useDeepSea) {
            applyDeepSeaTheme();
        }
        // Setup theme change listener
        setupThemeChangeListener();
    } catch (e) {
        console.error("Error handling theme:", e);
    }

    // Modify the initializeChart function to use blue colors for the chart
    function initializeChart() {
        try {
            const ctx = document.getElementById('trendGraph').getContext('2d');
            if (!ctx) {
                console.error("Could not find trend graph canvas");
                return null;
            }

            if (!window.Chart) {
                console.error("Chart.js not loaded");
                return null;
            }

            // Get the current theme colors
            const theme = getCurrentTheme();

            // Check if Chart.js plugin is available
            const hasAnnotationPlugin = window['chartjs-plugin-annotation'] !== undefined;

            return new Chart(ctx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'HASHRATE TREND (TH/s)',
                        data: [],
                        borderWidth: 2,
                        borderColor: function (context) {
                            const chart = context.chart;
                            const { ctx, chartArea } = chart;
                            if (!chartArea) {
                                return theme.PRIMARY;
                            }
                            // Create gradient for line
                            const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                            gradient.addColorStop(0, theme.CHART.GRADIENT_START);
                            gradient.addColorStop(1, theme.CHART.GRADIENT_END);
                            return gradient;
                        },
                        backgroundColor: function (context) {
                            const chart = context.chart;
                            const { ctx, chartArea } = chart;
                            if (!chartArea) {
                                return `rgba(${theme.PRIMARY_RGB}, 0.1)`;
                            }
                            // Create gradient for fill
                            const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                            gradient.addColorStop(0, `rgba(${theme.PRIMARY_RGB}, 0.3)`);
                            gradient.addColorStop(0.5, `rgba(${theme.PRIMARY_RGB}, 0.2)`);
                            gradient.addColorStop(1, `rgba(${theme.PRIMARY_RGB}, 0.05)`);
                            return gradient;
                        },
                        fill: true,
                        tension: 0.3,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {
                        duration: 0 // Disable animations for better performance
                    },
                    scales: {
                        x: {
                            display: true,
                            ticks: {
                                maxTicksLimit: 8, // Limit number of x-axis labels
                                maxRotation: 0,   // Don't rotate labels
                                autoSkip: true,   // Automatically skip some labels
                                color: '#FFFFFF',
                                font: {
                                    family: "'VT323', monospace", // Terminal font
                                    size: 14
                                }
                            },
                            grid: {
                                color: '#333333',
                                lineWidth: 0.5
                            }
                        },
                        y: {
                            title: {
                                display: true,
                                text: 'HASHRATE',
                                color: theme.PRIMARY,
                                font: {
                                    family: "'VT323', monospace",
                                    size: 16,
                                    weight: 'bold'
                                }
                            },
                            ticks: {
                                color: '#FFFFFF',
                                maxTicksLimit: 6, // Limit total number of ticks
                                precision: 1,     // Control decimal precision
                                autoSkip: true,   // Skip labels to prevent overcrowding
                                autoSkipPadding: 10, // Padding between skipped labels
                                font: {
                                    family: "'VT323', monospace", // Terminal font
                                    size: 14
                                },
                                callback: function (value) {
                                    // For zero, just return 0
                                    if (value === 0) return '0';

                                    // For very large values (1M+ TH/s = 1000+ PH/s)
                                    if (value >= 1000000) {
                                        return (value / 1000000).toFixed(1) + 'E'; // Show as EH/s
                                    }
                                    // For large values (1000+ TH/s), show in PH/s
                                    else if (value >= 1000) {
                                        return (value / 1000).toFixed(1) + 'P'; // Show as PH/s
                                    }
                                    // For values between 10 and 1000 TH/s
                                    else if (value >= 10) {
                                        return Math.round(value);
                                    }
                                    // For small values, limit decimal places
                                    else if (value >= 1) {
                                        return value.toFixed(1);
                                    }
                                    // For tiny values, use appropriate precision
                                    else {
                                        return value.toPrecision(2);
                                    }
                                }
                            },
                            grid: {
                                color: '#333333',
                                lineWidth: 0.5,
                                drawBorder: false,
                                zeroLineColor: '#555555',
                                zeroLineWidth: 1,
                                drawTicks: false
                            }
                        }
                    },
                    plugins: {
                        tooltip: {
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            titleColor: theme.PRIMARY,
                            bodyColor: '#FFFFFF',
                            titleFont: {
                                family: "'VT323', monospace",
                                size: 16,
                                weight: 'bold'
                            },
                            bodyFont: {
                                family: "'VT323', monospace",
                                size: 14
                            },
                            padding: 10,
                            cornerRadius: 0,
                            displayColors: false,
                            callbacks: {
                                title: function (tooltipItems) {
                                    return tooltipItems[0].label.toUpperCase();
                                },
                                label: function (context) {
                                    // Format tooltip values with appropriate unit
                                    const value = context.raw;
                                    return 'HASHRATE: ' + formatHashrateForDisplay(value).toUpperCase();
                                }
                            }
                        },
                        legend: { display: false },
                        annotation: hasAnnotationPlugin ? {
                            annotations: {
                                averageLine: {
                                    type: 'line',
                                    yMin: 0,
                                    yMax: 0,
                                    borderColor: theme.CHART.ANNOTATION,
                                    borderWidth: 3,
                                    borderDash: [8, 4],
                                    shadowColor: `rgba(${theme.PRIMARY_RGB}, 0.5)`,
                                    shadowBlur: 8,
                                    shadowOffsetX: 0,
                                    shadowOffsetY: 0,
                                    label: {
                                        enabled: true,
                                        content: '24HR AVG: 0 TH/S',
                                        backgroundColor: 'rgba(0,0,0,0.8)',
                                        color: theme.CHART.ANNOTATION,
                                        font: {
                                            family: "'VT323', monospace",
                                            size: 16,
                                            weight: 'bold'
                                        },
                                        padding: { top: 4, bottom: 4, left: 8, right: 8 },
                                        borderRadius: 0,
                                        position: 'start'
                                    }
                                }
                            }
                        } : {}
                    }
                }
            });
        } catch (error) {
            console.error("Error initializing chart:", error);
            return null;
        }
    }

    // Add this function to the document ready section
    function setupThemeChangeListener() {
        window.addEventListener('storage', function (event) {
            if (event.key === 'useDeepSeaTheme') {
                if (trendChart) {
                    // Save all font configurations
                    const fontConfig = {
                        xTicks: { ...trendChart.options.scales.x.ticks.font },
                        yTicks: { ...trendChart.options.scales.y.ticks.font },
                        yTitle: { ...trendChart.options.scales.y.title.font },
                        tooltip: {
                            title: { ...trendChart.options.plugins.tooltip.titleFont },
                            body: { ...trendChart.options.plugins.tooltip.bodyFont }
                        }
                    };

                    // Check if we're on mobile (viewport width < 768px)
                    const isMobile = window.innerWidth < 768;

                    // Store the original sizes before destroying chart
                    const xTicksFontSize = fontConfig.xTicks.size || 14;
                    const yTicksFontSize = fontConfig.yTicks.size || 14;
                    const yTitleFontSize = fontConfig.yTitle.size || 16;

                    // Recreate the chart with new theme colors
                    trendChart.destroy();
                    trendChart = initializeChart();

                    // Ensure font sizes are explicitly set to original values
                    // This is especially important for mobile
                    if (isMobile) {
                        // On mobile, set explicit font sizes (based on the originals)
                        trendChart.options.scales.x.ticks.font = {
                            ...fontConfig.xTicks,
                            size: xTicksFontSize
                        };

                        trendChart.options.scales.y.ticks.font = {
                            ...fontConfig.yTicks,
                            size: yTicksFontSize
                        };

                        trendChart.options.scales.y.title.font = {
                            ...fontConfig.yTitle,
                            size: yTitleFontSize
                        };

                        // Also set tooltip font sizes explicitly
                        trendChart.options.plugins.tooltip.titleFont = {
                            ...fontConfig.tooltip.title,
                            size: fontConfig.tooltip.title.size || 16
                        };

                        trendChart.options.plugins.tooltip.bodyFont = {
                            ...fontConfig.tooltip.body,
                            size: fontConfig.tooltip.body.size || 14
                        };

                        console.log('Mobile device detected: Setting explicit font sizes for chart labels');
                    } else {
                        // On desktop, use the full font config objects as before
                        trendChart.options.scales.x.ticks.font = fontConfig.xTicks;
                        trendChart.options.scales.y.ticks.font = fontConfig.yTicks;
                        trendChart.options.scales.y.title.font = fontConfig.yTitle;
                        trendChart.options.plugins.tooltip.titleFont = fontConfig.tooltip.title;
                        trendChart.options.plugins.tooltip.bodyFont = fontConfig.tooltip.body;
                    }

                    // Update with data and force an immediate chart update
                    updateChartWithNormalizedData(trendChart, latestMetrics);
                    trendChart.update('none');
                }

                // Update refresh button color
                updateRefreshButtonColor();

                // Trigger custom event
                $(document).trigger('themeChanged');
            }
        });
    }

    setupThemeChangeListener();

    // Remove the existing refreshUptime container to avoid duplicates
    $('#refreshUptime').hide();

    // Create a shared timing object that both systems can reference
    window.sharedTimingData = {
        serverTimeOffset: serverTimeOffset,
        serverStartTime: serverStartTime,
        lastRefreshTime: Date.now()
    };

    // Override the updateServerTime function to update the shared object
    const originalUpdateServerTime = updateServerTime;
    updateServerTime = function () {
        originalUpdateServerTime();

        // Update shared timing data after the original function runs
        setTimeout(function () {
            window.sharedTimingData.serverTimeOffset = serverTimeOffset;
            window.sharedTimingData.serverStartTime = serverStartTime;

            // Make sure BitcoinMinuteRefresh uses the same timing information
            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }
        }, 100);
    };

    // Add this to your $(document).ready() function in main.js
    function fixLastBlockLine() {
        // Add the style to fix the Last Block line
        $("<style>")
            .prop("type", "text/css")
            .html(`
      /* Fix for Last Block line to keep all elements on one line */
      .card-body p.last-block-line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        display: flex;
        align-items: center;
      }
      
      .card-body p.last-block-line > strong {
        flex-shrink: 0;
      }
      
      .card-body p.last-block-line > span,
      .card-body p.last-block-line > #indicator_last_block {
        display: inline-block;
        margin-right: 5px;
      }
    `)
            .appendTo("head");

        // Apply the class to the Last Block line
        $("#payoutMiscCard .card-body p").each(function () {
            const strongElem = $(this).find("strong");
            if (strongElem.length && strongElem.text().includes("Last Block")) {
                $(this).addClass("last-block-line");
            }
        });
    }

    // Call this function
    fixLastBlockLine();

    // Load timezone setting early
    (function loadTimezoneEarly() {
        // First try to get from localStorage for instant access
        try {
            const storedTimezone = localStorage.getItem('dashboardTimezone');
            if (storedTimezone) {
                window.dashboardTimezone = storedTimezone;
                console.log(`Using cached timezone: ${storedTimezone}`);
            }
        } catch (e) {
            console.error("Error reading timezone from localStorage:", e);
        }

        // Then fetch from server to ensure we have the latest setting
        fetch('/api/timezone')
            .then(response => response.json())
            .then(data => {
                if (data && data.timezone) {
                    window.dashboardTimezone = data.timezone;
                    console.log(`Set timezone from server: ${data.timezone}`);

                    // Cache for future use
                    try {
                        localStorage.setItem('dashboardTimezone', data.timezone);
                    } catch (e) {
                        console.error("Error storing timezone in localStorage:", e);
                    }
                }
            })
            .catch(error => {
                console.error("Error fetching timezone:", error);
            });
    })();

    // Override the manualRefresh function to update the shared lastRefreshTime
    const originalManualRefresh = manualRefresh;
    window.manualRefresh = function () {
        // Update the shared timing data
        window.sharedTimingData.lastRefreshTime = Date.now();

        // Call the original function
        originalManualRefresh();

        // Notify BitcoinMinuteRefresh about the refresh
        if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
            BitcoinMinuteRefresh.notifyRefresh();
        }
    };

    // Initialize the chart
    trendChart = initializeChart();

    // Add keyboard event listener for Shift+R
    $(document).keydown(function (event) {
        // Check if Shift+R is pressed (key code 82 is 'R')
        if (event.shiftKey && event.keyCode === 82) {
            resetDashboardChart();

            // Prevent default browser behavior (e.g., reload with Shift+R in some browsers)
            event.preventDefault();
        }
    });

    // Apply any saved arrows to DOM on page load
    arrowIndicator.forceApplyArrows();

    // Initialize BitcoinMinuteRefresh with our refresh function
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
        BitcoinMinuteRefresh.initialize(window.manualRefresh);

        // Immediately update it with our current server time information
        if (serverTimeOffset && serverStartTime) {
            BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
        }
    }

    // Update BitcoinProgressBar theme when theme changes
    $(document).on('themeChanged', function () {
        if (typeof BitcoinMinuteRefresh !== 'undefined' &&
            typeof BitcoinMinuteRefresh.updateTheme === 'function') {
            BitcoinMinuteRefresh.updateTheme();
        }
    });

    // Set up event source for SSE
    setupEventSource();

    // Start server time polling
    updateServerTime();
    setInterval(updateServerTime, 30000);

    // Update the manual refresh button color
    $("body").append('<button id="refreshButton" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #0088cc; color: white; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Refresh Data</button>');

    $("#refreshButton").on("click", function () {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);
        manualRefresh();
        setTimeout(function () {
            $("#refreshButton").text("Refresh Data");
            $("#refreshButton").prop("disabled", false);
        }, 5000);
    });

    // Force a data refresh when the page loads
    manualRefresh();

    // Add emergency refresh button functionality
    $("#forceRefreshBtn").show().on("click", function () {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);

        $.ajax({
            url: '/api/force-refresh',
            method: 'POST',
            timeout: 15000,
            success: function (data) {
                console.log("Force refresh successful:", data);
                manualRefresh(); // Immediately get the new data
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
            },
            error: function (xhr, status, error) {
                console.error("Force refresh failed:", error);
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
                alert("Refresh failed: " + error);
            }
        });
    });

    // Add stale data detection
    setInterval(function () {
        if (latestMetrics && latestMetrics.server_timestamp) {
            const lastUpdate = new Date(latestMetrics.server_timestamp);
            const timeSinceUpdate = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
            if (timeSinceUpdate > 120) { // More than 2 minutes
                showConnectionIssue(`Data stale (${timeSinceUpdate}s old). Use Force Refresh.`);
                $("#forceRefreshBtn").show();
            }
        }
    }, 30000); // Check every 30 seconds

    // Initialize notification badge
    initNotificationBadge();
});
