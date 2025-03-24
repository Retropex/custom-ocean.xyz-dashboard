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

// Bitcoin-themed progress bar functionality
let progressInterval;
let currentProgress = 0;
let lastUpdateTime = Date.now();
let expectedUpdateInterval = 60000; // Expected server update interval (60 seconds)
const PROGRESS_MAX = 60; // 60 seconds for a complete cycle

// Initialize the progress bar and start the animation
function initProgressBar() {
    // Clear any existing interval
    if (progressInterval) {
        clearInterval(progressInterval);
    }
    
    // Set last update time to now
    lastUpdateTime = Date.now();
    
    // Reset progress with initial offset
    currentProgress = 1; // Start at 1 instead of 0 for offset
    updateProgressBar(currentProgress);
    
    // Start the interval
    progressInterval = setInterval(function() {
        // Calculate elapsed time since last update
        const elapsedTime = Date.now() - lastUpdateTime;
        
        // Calculate progress percentage based on elapsed time with +1 second offset
        const secondsElapsed = Math.floor(elapsedTime / 1000) + 1; // Add 1 second offset
        
        // If we've gone past the expected update time
        if (secondsElapsed >= PROGRESS_MAX) {
            // Keep the progress bar full but show waiting state
            currentProgress = PROGRESS_MAX;
        } else {
            // Normal progress with offset
            currentProgress = secondsElapsed;
        }
        
        updateProgressBar(currentProgress);
    }, 1000);
}

// Update the progress bar display
function updateProgressBar(seconds) {
    const progressPercent = (seconds / PROGRESS_MAX) * 100;
    $("#bitcoin-progress-inner").css("width", progressPercent + "%");
    
    // Add glowing effect when close to completion
    if (progressPercent > 80) {
        $("#bitcoin-progress-inner").addClass("glow-effect");
    } else {
        $("#bitcoin-progress-inner").removeClass("glow-effect");
    }
    
    // Update remaining seconds text - more precise calculation
    let remainingSeconds = PROGRESS_MAX - seconds;
    
    // When we're past the expected time, show "Waiting for update..."
    if (remainingSeconds <= 0) {
        $("#progress-text").text("Waiting for update...");
        $("#bitcoin-progress-inner").addClass("waiting-for-update");
    } else {
        $("#progress-text").text(remainingSeconds + "s to next update");
        $("#bitcoin-progress-inner").removeClass("waiting-for-update");
    }
}

// Register Chart.js annotation plugin if available
if (window['chartjs-plugin-annotation']) {
  Chart.register(window['chartjs-plugin-annotation']);
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
        
        eventSource.onopen = function(e) {
            console.log("EventSource connection opened successfully");
            connectionRetryCount = 0; // Reset retry count on successful connection
            reconnectionDelay = 1000; // Reset reconnection delay
            hideConnectionIssue();
            
            // Start ping interval to detect dead connections
            lastPingTime = Date.now();
            pingInterval = setInterval(function() {
                const now = Date.now();
                if (now - lastPingTime > 60000) { // 60 seconds without data
                    console.warn("No data received for 60 seconds, reconnecting...");
                    showConnectionIssue("Connection stalled");
                    eventSource.close();
                    setupEventSource();
                }
            }, 10000); // Check every 10 seconds
        };
        
        eventSource.onmessage = function(e) {
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
                    setTimeout(function() {
                        manualRefresh();
                    }, retryTime);
                    return;
                }
                
                // Process regular data update
                latestMetrics = data;
                updateUI();
                hideConnectionIssue();
                
                // Also explicitly trigger a data refresh event
                $(document).trigger('dataRefreshed');
            } catch (err) {
                console.error("Error processing SSE data:", err);
                showConnectionIssue("Data processing error");
            }
        };
        
        eventSource.onerror = function(e) {
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
            
            console.log(`Reconnecting in ${(reconnectionDelay/1000).toFixed(1)} seconds... (attempt ${connectionRetryCount}/${maxRetryCount})`);
            setTimeout(setupEventSource, reconnectionDelay);
        };
        
        window.eventSource = eventSource;
        console.log("EventSource setup complete");
        
        // Set a timeout to detect if connection is established
        connectionLostTimeout = setTimeout(function() {
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
        success: function(data) {
            console.log("Manual refresh successful");
            lastPingTime = Date.now(); // Update ping time
            latestMetrics = data;
            updateUI();
            hideConnectionIssue();
            
            // Explicitly trigger data refresh event
            $(document).trigger('dataRefreshed');
        },
        error: function(xhr, status, error) {
            console.error("Manual refresh failed:", error);
            showConnectionIssue("Manual refresh failed");
            
            // Try again with exponential backoff
            const retryDelay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(5, connectionRetryCount)));
            connectionRetryCount++;
            setTimeout(manualRefresh, retryDelay);
        }
    });
}

// Initialize Chart.js with Error Handling
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
                    label: '60s Hashrate Trend (TH/s)',
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
                    x: { display: false },
                    y: {
                        ticks: { color: 'white' },
                        grid: { color: '#333' }
                    }
                },
                plugins: { 
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
        success: function(data) {
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();
        },
        error: function(jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", textStatus, errorThrown);
        }
    });
}

// Update uptime display
function updateUptime() {
    if (serverStartTime) {
        const currentServerTime = Date.now() + serverTimeOffset;
        const diff = currentServerTime - serverStartTime;
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        $("#uptimeTimer").html("<strong>Uptime:</strong> " + hours + "h " + minutes + "m " + seconds + "s");
    }
}

// Update UI indicators (arrows)
function updateIndicators(newMetrics) {
    const keys = [
        "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
        "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
        "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
        "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
        "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats", "estimated_rewards_in_window_sats",
        "workers_hashing"
    ];
    
    keys.forEach(function(key) {
        const newVal = parseFloat(newMetrics[key]);
        if (isNaN(newVal)) return;
        
        const oldVal = parseFloat(previousMetrics[key]);
        if (!isNaN(oldVal)) {
            if (newVal > oldVal) {
                persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-up bounce-up' style='color: green;'></i>";
            } else if (newVal < oldVal) {
                persistentArrows[key] = "<i class='arrow chevron fa-solid fa-angle-double-down bounce-down' style='color: red; position: relative; top: -2px;'></i>";
            }
        } else {
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
        
        const indicator = document.getElementById("indicator_" + key);
        if (indicator) {
            indicator.innerHTML = persistentArrows[key] || "";
        }
    });
    
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
    $congrats.text(message).fadeIn(500, function() {
        setTimeout(function() {
            $congrats.fadeOut(500);
        }, 3000);
    });
}

// Main UI update function
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
        updateElementText("pool_total_hashrate", 
            (data.pool_total_hashrate != null ? data.pool_total_hashrate : "N/A") + " " +
            (data.pool_total_hashrate_unit ? data.pool_total_hashrate_unit.slice(0,-2).toUpperCase() + data.pool_total_hashrate_unit.slice(-2) : "")
        );
        
        updateElementText("hashrate_24hr", 
            (data.hashrate_24hr != null ? data.hashrate_24hr : "N/A") + " " +
            (data.hashrate_24hr_unit ? data.hashrate_24hr_unit.slice(0,-2).toUpperCase() + data.hashrate_24hr_unit.slice(-2) : "")
        );
        
        updateElementText("hashrate_3hr", 
            (data.hashrate_3hr != null ? data.hashrate_3hr : "N/A") + " " +
            (data.hashrate_3hr_unit ? data.hashrate_3hr_unit.slice(0,-2).toUpperCase() + data.hashrate_3hr_unit.slice(-2) : "")
        );
        
        updateElementText("hashrate_10min", 
            (data.hashrate_10min != null ? data.hashrate_10min : "N/A") + " " +
            (data.hashrate_10min_unit ? data.hashrate_10min_unit.slice(0,-2).toUpperCase() + data.hashrate_10min_unit.slice(-2) : "")
        );
        
        updateElementText("hashrate_60sec", 
            (data.hashrate_60sec != null ? data.hashrate_60sec : "N/A") + " " +
            (data.hashrate_60sec_unit ? data.hashrate_60sec_unit.slice(0,-2).toUpperCase() + data.hashrate_60sec_unit.slice(-2) : "")
        );
        
        updateElementText("block_number", numberWithCommas(data.block_number));
        
        updateElementText("btc_price", 
            data.btc_price != null ? "$" + numberWithCommas(parseFloat(data.btc_price).toFixed(2)) : "N/A"
        );
        
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
                    $("#est_time_to_payout").css({"color": "#32CD32", "animation": "none"});
                } else if (days > 20) {
                    $("#est_time_to_payout").css({"color": "red", "animation": "none"});
                } else {
                    $("#est_time_to_payout").css({"color": "#ffd700", "animation": "none"});
                }
            } else {
                $("#est_time_to_payout").css({"color": "#ffd700", "animation": "none"});
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
        
        // Update chart if it exists
        if (trendChart) {
            try {
                // Always update the 24hr average line even if we don't have data points yet
                const avg24hr = parseFloat(data.hashrate_24hr || 0);
                if (!isNaN(avg24hr) && 
                    trendChart.options.plugins.annotation && 
                    trendChart.options.plugins.annotation.annotations &&
                    trendChart.options.plugins.annotation.annotations.averageLine) {
                    const annotation = trendChart.options.plugins.annotation.annotations.averageLine;
                    annotation.yMin = avg24hr;
                    annotation.yMax = avg24hr;
                    annotation.label.content = '24hr Avg: ' + avg24hr + ' TH/s';
                }
                
                // Update data points if we have any (removed minimum length requirement)
                if (data.arrow_history && data.arrow_history.hashrate_60sec) {
                    const historyData = data.arrow_history.hashrate_60sec;
                    if (historyData && historyData.length > 0) {
                        console.log(`Updating chart with ${historyData.length} data points`);
                        trendChart.data.labels = historyData.map(item => item.time);
                        trendChart.data.datasets[0].data = historyData.map(item => {
                            const val = parseFloat(item.value);
                            return isNaN(val) ? 0 : val;
                        });
                    } else {
                        console.log("No history data points available yet");
                    }
                } else {
                    console.log("No hashrate_60sec history available yet");
                    
                    // If there's no history data, create a starting point using current hashrate
                    if (data.hashrate_60sec) {
                        const currentTime = new Date().toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit'});
                        trendChart.data.labels = [currentTime];
                        trendChart.data.datasets[0].data = [parseFloat(data.hashrate_60sec) || 0];
                        console.log("Created initial data point with current hashrate");
                    }
                }
                
                // Always update the chart, even if we just updated the average line
                trendChart.update('none');
            } catch (chartError) {
                console.error("Error updating chart:", chartError);
            }
        }
        
        // Update indicators and check for block updates
        updateIndicators(data);
        checkForBlockUpdates(data);
        
    } catch (error) {
        console.error("Error updating UI:", error);
    }
}

// Set up refresh synchronization
function setupRefreshSync() {
    // Listen for the dataRefreshed event
    $(document).on('dataRefreshed', function() {
        // Broadcast to any other open tabs/pages that the data has been refreshed
        try {
            // Store the current timestamp to localStorage
            localStorage.setItem('dashboardRefreshTime', Date.now().toString());
            
            // Create a custom event that can be detected across tabs/pages
            localStorage.setItem('dashboardRefreshEvent', 'refresh-' + Date.now());
            
            console.log("Dashboard refresh synchronized");
        } catch (e) {
            console.error("Error synchronizing refresh:", e);
        }
    });
}

// Document ready initialization
$(document).ready(function() {
    // Initialize the chart
    trendChart = initializeChart();
    
    // Initialize the progress bar
    initProgressBar();
    
    // Set up direct monitoring of data refreshes
    $(document).on('dataRefreshed', function() {
        console.log("Data refresh event detected, resetting progress bar");
        lastUpdateTime = Date.now();
        currentProgress = 0;
        updateProgressBar(currentProgress);
    });
    
    // Wrap the updateUI function to detect changes and trigger events
    const originalUpdateUI = updateUI;
    updateUI = function() {
        const previousMetricsTimestamp = latestMetrics ? latestMetrics.server_timestamp : null;
        
        // Call the original function
        originalUpdateUI.apply(this, arguments);
        
        // Check if we got new data by comparing timestamps
        if (latestMetrics && latestMetrics.server_timestamp !== previousMetricsTimestamp) {
            console.log("New data detected, triggering refresh event");
            $(document).trigger('dataRefreshed');
        }
    };
    
    // Set up event source for SSE
    setupEventSource();
    
    // Start server time polling
    updateServerTime();
    setInterval(updateServerTime, 30000);
    
    // Start uptime timer
    setInterval(updateUptime, 1000);
    updateUptime();
    
    // Set up refresh synchronization with workers page
    setupRefreshSync();
    
    // Add a manual refresh button for fallback
    $("body").append('<button id="refreshButton" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #f7931a; color: black; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Refresh Data</button>');
    
    $("#refreshButton").on("click", function() {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);
        manualRefresh();
        setTimeout(function() {
            $("#refreshButton").text("Refresh Data");
            $("#refreshButton").prop("disabled", false);
        }, 5000);
    });
    
    // Force a data refresh when the page loads
    manualRefresh();

    // Add emergency refresh button functionality
    $("#forceRefreshBtn").show().on("click", function() {
        $(this).text("Refreshing...");
        $(this).prop("disabled", true);
        
        $.ajax({
            url: '/api/force-refresh',
            method: 'POST',
            timeout: 15000,
            success: function(data) {
                console.log("Force refresh successful:", data);
                manualRefresh(); // Immediately get the new data
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
            },
            error: function(xhr, status, error) {
                console.error("Force refresh failed:", error);
                $("#forceRefreshBtn").text("Force Refresh").prop("disabled", false);
                alert("Refresh failed: " + error);
            }
        });
    });

    // Add stale data detection
    setInterval(function() {
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