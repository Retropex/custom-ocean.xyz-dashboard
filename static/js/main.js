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
let previousBlockHeight = null; // Declare and initialize previousBlockHeight

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
    let $connectionStatus = $("#connectionStatus");
    if (!$connectionStatus.length) {
        $("body").append('<div id="connectionStatus" style="position: fixed; top: 10px; right: 10px; background: rgba(255,0,0,0.7); color: white; padding: 10px; border-radius: 5px; z-index: 9999;"></div>');
        $connectionStatus = $("#connectionStatus");
    }
    $connectionStatus.html(`<i class="fas fa-exclamation-triangle"></i> ${message}`).show();

    // Show manual refresh button when there are connection issues
    $("#refreshButton").show();
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

// Initialize Chart.js with Unit Normalization
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

        // Check if Chart.js plugin is available
        const hasAnnotationPlugin = window['chartjs-plugin-annotation'] !== undefined;

        // Replace the simple color definitions with gradient definitions

        // Inside the initializeChart function, modify the dataset configuration:
        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Hashrate Trend (TH/s)',
                    data: [],
                    borderWidth: 2,
                    borderColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return '#f7931a';
                        }
                        // Create gradient for line
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, '#ffa64d');  // Lighter orange
                        gradient.addColorStop(1, '#f7931a');  // Bitcoin orange
                        return gradient;
                    },
                    backgroundColor: function (context) {
                        const chart = context.chart;
                        const { ctx, chartArea } = chart;
                        if (!chartArea) {
                            return 'rgba(247,147,26,0.1)';
                        }
                        // Create gradient for fill
                        const gradient = ctx.createLinearGradient(0, 0, 0, chartArea.bottom);
                        gradient.addColorStop(0, 'rgba(255, 166, 77, 0.3)');  // Lighter orange with transparency
                        gradient.addColorStop(0.5, 'rgba(247, 147, 26, 0.2)'); // Bitcoin orange with medium transparency
                        gradient.addColorStop(1, 'rgba(247, 147, 26, 0.05)');  // Bitcoin orange with high transparency
                        return gradient;
                    },
                    fill: true,
                    tension: 0.3,  // Slightly increase tension for smoother curves
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
                        display: false,
                        ticks: {
                            maxTicksLimit: 8, // Limit number of x-axis labels
                            maxRotation: 0,   // Don't rotate labels
                            autoSkip: true    // Automatically skip some labels
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Hashrate (TH/s)' // Always display unit as TH/s since that's our normalized unit
                        },
                        ticks: {
                            color: 'white',
                            maxTicksLimit: 6, // Limit total number of ticks
                            precision: 1,     // Control decimal precision
                            autoSkip: true,   // Skip labels to prevent overcrowding
                            autoSkipPadding: 10, // Padding between skipped labels
                            callback: function (value) {
                                // For zero, just return 0
                                if (value === 0) return '0';

                                // For very large values (1M+)
                                if (value >= 1000000) {
                                    return (value / 1000000).toFixed(1) + 'M';
                                }
                                // For large values (1K+)
                                else if (value >= 1000) {
                                    return (value / 1000).toFixed(1) + 'K';
                                }
                                // For values between 10 and 1000
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
                            color: '#333',
                            lineWidth: 0.5,
                            drawBorder: false,
                            zeroLineColor: '#555',
                            zeroLineWidth: 1,
                            drawTicks: false
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                // Format tooltip values with appropriate unit
                                const value = context.raw;
                                return 'Hashrate: ' + formatHashrateForDisplay(value);
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
                borderColor: '#ffd700', // Changed to gold color for better contrast
                borderWidth: 3,         // Increased from 2 to 3
                borderDash: [8, 4],     // Modified dash pattern for distinction
                // Add shadow effect
                shadowColor: 'rgba(255, 215, 0, 0.5)',
                shadowBlur: 8,
                shadowOffsetX: 0,
                shadowOffsetY: 0,
                label: {
                    enabled: true,
                    content: '24hr Avg: 0 TH/s',
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    color: '#ffd700',   // Changed to match the line color
                    font: { 
                        weight: 'bold', 
                        size: 14,       // Increased from 13 to 14
                        family: 'var(--terminal-font)' // Use the terminal font
                    },
                    padding: { top: 4, bottom: 4, left: 8, right: 8 },
                    borderRadius: 2,
                    position: 'start',
                    // Add a subtle shadow to the label
                    textShadow: '0 0 5px rgba(255, 215, 0, 0.7)'
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

// Helper function to show congratulatory messages
function showCongrats(message) {
    const $congrats = $("#congratsMessage");
    $congrats.text(message).fadeIn(500, function () {
        setTimeout(function () {
            $congrats.fadeOut(500);
        }, 900000); //15 minutes fade out
    });
}

// Enhanced Chart Update Function with Unit Normalization
function updateChartWithNormalizedData(chart, data) {
    if (!chart || !data) {
        console.warn("Cannot update chart - chart or data is null");
        return;
    }

    try {
        // Always update the 24hr average line even if we don't have data points yet
        const avg24hr = parseFloat(data.hashrate_24hr || 0);
        const avg24hrUnit = data.hashrate_24hr_unit ? data.hashrate_24hr_unit.toLowerCase() : 'th/s';

        // Normalize the average value to TH/s
        const normalizedAvg = normalizeHashrate(avg24hr, avg24hrUnit);

        if (!isNaN(normalizedAvg) &&
            chart.options.plugins.annotation &&
            chart.options.plugins.annotation.annotations &&
            chart.options.plugins.annotation.annotations.averageLine) {
            const annotation = chart.options.plugins.annotation.annotations.averageLine;
            annotation.yMin = normalizedAvg;
            annotation.yMax = normalizedAvg;
            annotation.label.content = '24hr Avg: ' + normalizedAvg.toFixed(1) + ' TH/s';
        }

        // Update data points if we have any
        if (data.arrow_history && data.arrow_history.hashrate_60sec) {
            const historyData = data.arrow_history.hashrate_60sec;
            if (historyData && historyData.length > 0) {
                // Store the current unit for reference
                const currentUnit = data.hashrate_60sec_unit ? data.hashrate_60sec_unit.toLowerCase() : 'th/s';

                // Create normalized data points
                chart.data.labels = historyData.map(item => {
                    // Simplify time format to just hours:minutes
                    const timeStr = item.time;
                    // If format is HH:MM:SS, truncate seconds
                    if (timeStr.length === 8 && timeStr.indexOf(':') !== -1) {
                        return timeStr.substring(0, 5);
                    }
                    // If already in HH:MM format or other format, return as is
                    return timeStr;
                });

                chart.data.datasets[0].data = historyData.map(item => {
                    const val = parseFloat(item.value);

                    // If the history has unit information
                    if (item.unit) {
                        return normalizeHashrate(val, item.unit);
                    }

                    // Otherwise use the current unit as the baseline
                    return normalizeHashrate(val, currentUnit);
                });

                // Calculate the min and max values after normalization
                const values = chart.data.datasets[0].data.filter(v => !isNaN(v) && v !== null);
                if (values.length > 0) {
                    const max = Math.max(...values);
                    const min = Math.min(...values.filter(v => v > 0)) || 0;

                    // Set appropriate Y-axis scale with some padding
                    chart.options.scales.y.min = min * 0.8;
                    chart.options.scales.y.max = max * 1.2;

                    // Use appropriate tick step based on the range
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
            // If there's no history data, create a starting point using current hashrate
            if (data.hashrate_60sec) {
                const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const currentUnit = data.hashrate_60sec_unit ? data.hashrate_60sec_unit.toLowerCase() : 'th/s';
                const normalizedValue = normalizeHashrate(parseFloat(data.hashrate_60sec) || 0, currentUnit);

                chart.data.labels = [currentTime];
                chart.data.datasets[0].data = [normalizedValue];
            }
        }

        // Add a new dataset for block found points
        const blockFoundDataset = {
            label: 'Block Found',
            data: [], // This will be populated with the points where a block is found
            borderColor: '#32CD32',
            backgroundColor: 'green',
            pointRadius: 9,
            pointHoverRadius: 12,
            pointStyle: 'rect', // Set point style to square
            borderWidth: 2, // Add border for more visibility
            showLine: false
        };

        // Populate the block found dataset
        if (data.block_found_points) {
            blockFoundDataset.data = data.block_found_points.map(point => ({
                x: point.time,
                y: point.value
            }));
        }

        // Add the new dataset to the chart
        chart.data.datasets.push(blockFoundDataset);

        // Always update the chart
        chart.update('none');
    } catch (chartError) {
        console.error("Error updating chart:", chartError);
    }
}

// Main UI update function with hashrate normalization
function updateUI() {
    if (!latestMetrics) {
        console.warn("No metrics data available");
        return;
    }

    try {
        const data = latestMetrics;

        // Check for block updates
        if (previousBlockHeight !== null && data.last_block_height !== previousBlockHeight) {
            // Block found, update the chart
            highlightBlockFound(data.last_block_height);
        }

        previousBlockHeight = data.last_block_height;

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

        // 24hr Hashrate
        let formatted24hrHashrate = "N/A";
        if (data.hashrate_24hr != null) {
            formatted24hrHashrate = formatHashrateForDisplay(
                data.hashrate_24hr,
                data.hashrate_24hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_24hr", formatted24hrHashrate);

        // 3hr Hashrate
        let formatted3hrHashrate = "N/A";
        if (data.hashrate_3hr != null) {
            formatted3hrHashrate = formatHashrateForDisplay(
                data.hashrate_3hr,
                data.hashrate_3hr_unit || 'th/s'
            );
        }
        updateElementText("hashrate_3hr", formatted3hrHashrate);

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

        // Network hashrate (already in EH/s but verify)
        updateElementText("network_hashrate", numberWithCommas(Math.round(data.network_hashrate)) + " EH/s");
        updateElementText("difficulty", numberWithCommas(Math.round(data.difficulty)));
        updateElementText("daily_revenue", "$" + numberWithCommas(data.daily_revenue.toFixed(2)));
        updateElementText("daily_power_cost", "$" + numberWithCommas(data.daily_power_cost.toFixed(2)));
        updateElementText("daily_profit_usd", "$" + numberWithCommas(data.daily_profit_usd.toFixed(2)));
        updateElementText("monthly_profit_usd", "$" + numberWithCommas(data.monthly_profit_usd.toFixed(2)));
        updateElementText("daily_mined_sats", numberWithCommas(data.daily_mined_sats) + " sats");
        updateElementText("monthly_mined_sats", numberWithCommas(data.monthly_mined_sats) + " sats");

        // Update worker count from metrics (just the number, not full worker data)
        updateWorkersCount();

        updateElementText("unpaid_earnings", data.unpaid_earnings + " BTC");

        // Update payout estimation with color coding
        const payoutText = data.est_time_to_payout;
        updateElementText("est_time_to_payout", payoutText);

        if (payoutText && payoutText.toLowerCase().includes("next block")) {
            $("#est_time_to_payout").css({
                "color": "#32CD32",
                "animation": "glowPulse 1s infinite"
            });
        } else {
            const daysMatch = payoutText ? payoutText.match(/(\d+)/) : null;
            const days = daysMatch ? parseFloat(daysMatch[1]) : NaN;
            if (!isNaN(days)) {
                if (days < 4) {
                    $("#est_time_to_payout").css({ "color": "#32CD32", "animation": "none" });
                } else if (days > 20) {
                    $("#est_time_to_payout").css({ "color": "red", "animation": "none" });
                } else {
                    $("#est_time_to_payout").css({ "color": "#ffd700", "animation": "none" });
                }
            } else {
                $("#est_time_to_payout").css({ "color": "#ffd700", "animation": "none" });
            }
        }

        updateElementText("last_block_height", data.last_block_height || "");
        updateElementText("last_block_time", data.last_block_time || "");
        updateElementText("blocks_found", data.blocks_found || "0");
        updateElementText("last_share", data.total_last_share || "");

        // Update Estimated Earnings metrics
        updateElementText("estimated_earnings_per_day_sats", numberWithCommas(data.estimated_earnings_per_day_sats) + " sats");
        updateElementText("estimated_earnings_next_block_sats", numberWithCommas(data.estimated_earnings_next_block_sats) + " sats");
        updateElementText("estimated_rewards_in_window_sats", numberWithCommas(data.estimated_rewards_in_window_sats) + " sats");

        // Update last updated timestamp
        const now = new Date(Date.now() + serverTimeOffset);
        updateElementHTML("lastUpdated", "<strong>Last Updated:</strong> " + now.toLocaleString() + "<span id='terminal-cursor'></span>");

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
function highlightBlockFound(blockHeight) {
    if (!trendChart) {
        console.warn("Chart not initialized");
        return;
    }

    // Add the block found point to the chart data
    const blockFoundPoint = {
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }),
        value: latestMetrics.hashrate_60sec, // Use the current hashrate value
        flash: true // Mark this point to flash/pulse
    };

    if (!latestMetrics.block_found_points) {
        latestMetrics.block_found_points = [];
    }

    latestMetrics.block_found_points.push(blockFoundPoint);

    // Update the chart with the new block found point
    updateChartWithNormalizedData(trendChart, latestMetrics);

    // Flash the point by animating opacity
    flashBlockFoundIndicator();
}

// Add this function to create a flashing effect
function flashBlockFoundIndicator() {
    const flashCount = 5; // Number of flashes
    let count = 0;

    const flashInterval = setInterval(() => {
        if (count >= flashCount * 2) {
            clearInterval(flashInterval);
            return;
        }

        // Toggle visibility of the dataset
        if (trendChart && trendChart.data.datasets.length > 1) {
            const opacity = count % 2 === 0 ? 1.0 : 0.3; // Toggle between full and partial opacity
            trendChart.data.datasets[1].pointBackgroundColor = `rgba(50, 205, 50, ${opacity})`;
            trendChart.data.datasets[1].borderColor = `rgba(50, 205, 50, ${opacity})`;
            trendChart.update('none');
        }

        count++;
    }, 300); // Flash every 300ms
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

// Document ready initialization
$(document).ready(function () {
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

    // Set up event source for SSE
    setupEventSource();

    // Start server time polling
    updateServerTime();
    setInterval(updateServerTime, 30000);

    // Add a manual refresh button for fallback
    $("body").append('<button id="refreshButton" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #f7931a; color: black; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Refresh Data</button>');

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
