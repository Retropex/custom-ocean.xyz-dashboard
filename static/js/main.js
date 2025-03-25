"use strict";

// Global variables
let previousMetrics = {};
let persistentArrows = {};
let serverTimeOffset = 0;
let serverStartTime = null;
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

    console.log("Current path:", window.location.pathname);
    console.log("Using stream URL:", streamUrl);

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
            }, 10000); // Check every 10 seconds
        };

        eventSource.onmessage = function (e) {
            console.log("SSE message received");
            lastPingTime = Date.now(); // Update ping time on any message

            try {
                const data = JSON.parse(e.data);

                // Handle different message types
                if (data.type === "ping") {
                    console.log("Ping received:", data);
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
        console.log("EventSource setup complete");

        // Set a timeout to detect if connection is established
        connectionLostTimeout = setTimeout(function () {
            if (eventSource.readyState !== 1) { // 1 = OPEN
                console.warn("Connection not established within timeout, switching to manual refresh");
                showConnectionIssue("Connection timeout");
                eventSource.close();
                manualRefresh();
            }
        }, 10000); // 10 seconds timeout to establish connection

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

    $.ajax({
        url: '/api/metrics',
        method: 'GET',
        dataType: 'json',
        timeout: 15000, // 15 second timeout
        success: function (data) {
            console.log("Manual refresh successful");
            lastPingTime = Date.now(); // Update ping time
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

        return new Chart(ctx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Hashrate Trend (TH/s)', // Always use TH/s as the normalized unit
                    data: [],
                    borderColor: '#f7931a',
                    backgroundColor: 'rgba(247,147,26,0.1)',
                    fill: true,
                    tension: 0.2,
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
                                borderColor: '#f7931a',
                                borderWidth: 2,
                                borderDash: [6, 6],
                                label: {
                                    enabled: true,
                                    content: '24hr Avg: 0 TH/s',
                                    backgroundColor: 'rgba(0,0,0,0.7)',
                                    color: '#f7931a',
                                    font: { weight: 'bold', size: 13 },
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

// Update UI indicators (arrows) with unit normalization
function updateIndicators(newMetrics) {
    console.log("Updating indicators with new metrics");

    const keys = [
        "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
        "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
        "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
        "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
        "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats",
        "estimated_rewards_in_window_sats", "workers_hashing"
    ];

    keys.forEach(function (key) {
        const newVal = parseFloat(newMetrics[key]);
        if (isNaN(newVal)) return;

        const oldVal = parseFloat(previousMetrics[key]);
        if (!isNaN(oldVal)) {
            // For hashrate values, normalize both values to the same unit before comparison
            if (key.includes('hashrate')) {
                const newUnit = newMetrics[key + '_unit'] || 'th/s';
                const oldUnit = previousMetrics[key + '_unit'] || 'th/s';

                const normalizedNewVal = normalizeHashrate(newVal, newUnit);
                const normalizedOldVal = normalizeHashrate(oldVal, oldUnit);

                // Lower threshold to 0.5% to catch more changes
                if (normalizedNewVal > normalizedOldVal * 1.0001) {
                    persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green;'></i>";
                } else if (normalizedNewVal < normalizedOldVal * 0.9999) {
                    persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px;'></i>";
                }
            } else {
                // Lower threshold to 0.5% for non-hashrate values too
                if (newVal > oldVal * 1.0001) {
                    persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green;'></i>";
                } else if (newVal < oldVal * 0.9999) {
                    persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px;'></i>";
                }
            }
        } else {
            // Keep using arrow_history as fallback - this code is unchanged
            if (newMetrics.arrow_history && newMetrics.arrow_history[key] && newMetrics.arrow_history[key].length > 0) {
                const historyArr = newMetrics.arrow_history[key];
                for (let i = historyArr.length - 1; i >= 0; i--) {
                    if (historyArr[i].arrow !== "") {
                        if (historyArr[i].arrow === "↑") {
                            persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green;'></i>";
                        } else if (historyArr[i].arrow === "↓") {
                            persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px;'></i>";
                        }
                        break;
                    }
                }
            }
        }

        // Debug which indicators exist
        const indicator = document.getElementById("indicator_" + key);
        if (indicator) {
            indicator.innerHTML = persistentArrows[key] || "";
        } else {
            console.warn(`Missing indicator element for: ${key}`);
        }
    });

    // Store current metrics for next comparison
    previousMetrics = { ...newMetrics };
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
        }, 3000);
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
                console.log(`Updating chart with ${historyData.length} data points`);

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
            } else {
                console.log("No history data points available yet");
            }
        } else {
            console.log("No hashrate_60sec history available yet");

            // If there's no history data, create a starting point using current hashrate
            if (data.hashrate_60sec) {
                const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
                const currentUnit = data.hashrate_60sec_unit ? data.hashrate_60sec_unit.toLowerCase() : 'th/s';
                const normalizedValue = normalizeHashrate(parseFloat(data.hashrate_60sec) || 0, currentUnit);

                chart.data.labels = [currentTime];
                chart.data.datasets[0].data = [normalizedValue];
                console.log("Created initial data point with current hashrate");
            }
        }

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

        // If there's execution time data, log it
        if (data.execution_time) {
            console.log(`Server metrics fetch took ${data.execution_time.toFixed(2)}s`);
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
            const days = parseFloat(payoutText);
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

    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

// Document ready initialization
$(document).ready(function () {
    // Initialize the chart
    trendChart = initializeChart();

    // Initialize BitcoinMinuteRefresh with our refresh function
    BitcoinMinuteRefresh.initialize(manualRefresh);

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
});

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

    // Update every 30 seconds
    setInterval(updateNotificationBadge, 30000);
}

// Add to document ready
$(document).ready(function () {
    // Existing code...

    // Initialize notification badge
    initNotificationBadge();
});
