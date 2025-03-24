"use strict";

// Global variables for workers dashboard
let workerData = null;
let refreshTimer;
let pageLoadTime = Date.now();
let currentProgress = 0;
const PROGRESS_MAX = 60; // 60 seconds for a complete cycle
let lastUpdateTime = Date.now();
let filterState = {
    currentFilter: 'all',
    searchTerm: ''
};
let miniChart = null;
let connectionRetryCount = 0;

// Server time variables for uptime calculation - synced with main dashboard
let serverTimeOffset = 0;
let serverStartTime = null;

// New variable to track custom refresh timing
let lastManualRefreshTime = 0;
const MIN_REFRESH_INTERVAL = 10000; // Minimum 10 seconds between refreshes

// Initialize the page
$(document).ready(function() {
    // Set up initial UI
    initializePage();
    
    // Get server time for uptime calculation
    updateServerTime();
    
    // Set up refresh synchronization with main dashboard
    setupRefreshSync();
    
    // Fetch worker data immediately on page load
    fetchWorkerData();
    
    // Set up refresh timer
    setInterval(updateProgressBar, 1000);
    
    // Set up uptime timer - synced with main dashboard
    setInterval(updateUptime, 1000);
    
    // Start server time polling - same as main dashboard
    setInterval(updateServerTime, 30000);
    
    // Auto-refresh worker data - aligned with main dashboard if possible
    setInterval(function() {
        // Check if it's been at least PROGRESS_MAX seconds since last update
        const timeSinceLastUpdate = Date.now() - lastUpdateTime;
        if (timeSinceLastUpdate >= PROGRESS_MAX * 1000) {
            // Check if there was a recent manual refresh
            const timeSinceManualRefresh = Date.now() - lastManualRefreshTime;
            if (timeSinceManualRefresh >= MIN_REFRESH_INTERVAL) {
                console.log("Auto-refresh triggered after time interval");
                fetchWorkerData();
            }
        }
    }, 10000); // Check every 10 seconds to align better with main dashboard
    
    // Set up filter button click handlers
    $('.filter-button').click(function() {
        $('.filter-button').removeClass('active');
        $(this).addClass('active');
        filterState.currentFilter = $(this).data('filter');
        filterWorkers();
    });
    
    // Set up search input handler
    $('#worker-search').on('input', function() {
        filterState.searchTerm = $(this).val().toLowerCase();
        filterWorkers();
    });
});

// Set up refresh synchronization with main dashboard
function setupRefreshSync() {
    // Listen for storage events (triggered by main dashboard)
    window.addEventListener('storage', function(event) {
        // Check if this is our dashboard refresh event
        if (event.key === 'dashboardRefreshEvent') {
            console.log("Detected dashboard refresh event");
            
            // Prevent too frequent refreshes
            const now = Date.now();
            const timeSinceLastRefresh = now - lastUpdateTime;
            
            if (timeSinceLastRefresh >= MIN_REFRESH_INTERVAL) {
                console.log("Syncing refresh with main dashboard");
                // Reset progress bar and immediately fetch
                resetProgressBar();
                // Refresh the worker data
                fetchWorkerData();
            } else {
                console.log("Skipping too-frequent refresh", timeSinceLastRefresh);
                // Just reset the progress bar to match main dashboard
                resetProgressBar();
            }
        }
    });
    
    // On page load, check if we should align with main dashboard timing
    try {
        const lastDashboardRefresh = localStorage.getItem('dashboardRefreshTime');
        if (lastDashboardRefresh) {
            const lastRefreshTime = parseInt(lastDashboardRefresh);
            const timeSinceLastDashboardRefresh = Date.now() - lastRefreshTime;
            
            // If main dashboard refreshed recently, adjust our timer
            if (timeSinceLastDashboardRefresh < PROGRESS_MAX * 1000) {
                console.log("Adjusting timer to align with main dashboard");
                currentProgress = Math.floor(timeSinceLastDashboardRefresh / 1000);
                updateProgressBar(currentProgress);
                
                // Calculate when next update will happen (roughly 60 seconds from last dashboard refresh)
                const timeUntilNextRefresh = (PROGRESS_MAX * 1000) - timeSinceLastDashboardRefresh;
                
                // Schedule a one-time check near the expected refresh time
                if (timeUntilNextRefresh > 0) {
                    console.log(`Scheduling coordinated refresh in ${Math.floor(timeUntilNextRefresh/1000)} seconds`);
                    setTimeout(function() {
                        // Check if a refresh happened in the last few seconds via localStorage event
                        const newLastRefresh = parseInt(localStorage.getItem('dashboardRefreshTime') || '0');
                        const secondsSinceLastRefresh = (Date.now() - newLastRefresh) / 1000;
                        
                        // If dashboard hasn't refreshed in the last 5 seconds, do our own refresh
                        if (secondsSinceLastRefresh > 5) {
                            console.log("Coordinated refresh time reached, fetching data");
                            fetchWorkerData();
                        } else {
                            console.log("Dashboard already refreshed recently, skipping coordinated refresh");
                        }
                    }, timeUntilNextRefresh);
                }
            }
        }
    } catch (e) {
        console.error("Error reading dashboard refresh time:", e);
    }
    
    // Check for dashboard refresh periodically
    setInterval(function() {
        try {
            const lastDashboardRefresh = parseInt(localStorage.getItem('dashboardRefreshTime') || '0');
            const now = Date.now();
            const timeSinceLastRefresh = (now - lastUpdateTime) / 1000;
            const timeSinceDashboardRefresh = (now - lastDashboardRefresh) / 1000;
            
            // If dashboard refreshed more recently than we did and we haven't refreshed in at least 10 seconds
            if (lastDashboardRefresh > lastUpdateTime && timeSinceLastRefresh > 10) {
                console.log("Catching up with dashboard refresh");
                resetProgressBar();
                fetchWorkerData();
            }
        } catch (e) {
            console.error("Error in periodic dashboard check:", e);
        }
    }, 5000); // Check every 5 seconds
}

// Server time update via polling - same as main.js
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

// Update uptime display - synced with main dashboard
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

// Initialize page elements
function initializePage() {
    // Initialize mini chart for total hashrate if the element exists
    if (document.getElementById('total-hashrate-chart')) {
        initializeMiniChart();
    }
    
    // Show loading state
    $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-spinner fa-spin"></i> Loading worker data...</div>');
    
    // Add retry button (hidden by default)
    if (!$('#retry-button').length) {
        $('body').append('<button id="retry-button" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #f7931a; color: black; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Retry Loading Data</button>');
        
        $('#retry-button').on('click', function() {
            $(this).text('Retrying...').prop('disabled', true);
            fetchWorkerData(true);
            setTimeout(() => {
                $('#retry-button').text('Retry Loading Data').prop('disabled', false);
            }, 3000);
        });
    }
}

// Fetch worker data from API
function fetchWorkerData(forceRefresh = false) {
    // Track this as a manual refresh for throttling purposes
    lastManualRefreshTime = Date.now();
    
    $('#worker-grid').addClass('loading-fade');
    
    // Update progress bar to show data is being fetched
    resetProgressBar();
    
    // Choose API URL based on whether we're forcing a refresh
    const apiUrl = `/api/workers${forceRefresh ? '?force=true' : ''}`;
    
    $.ajax({
        url: apiUrl,
        method: 'GET',
        dataType: 'json',
        timeout: 15000, // 15 second timeout
        success: function(data) {
            workerData = data;
            lastUpdateTime = Date.now();
            
            // Update UI with new data
            updateWorkerGrid();
            updateSummaryStats();
            updateMiniChart();
            updateLastUpdated();
            
            // Hide retry button
            $('#retry-button').hide();
            
            // Reset connection retry count
            connectionRetryCount = 0;
            
            console.log("Worker data updated successfully");
        },
        error: function(xhr, status, error) {
            console.error("Error fetching worker data:", error);
            
            // Show error in worker grid
            $('#worker-grid').html(`
                <div class="text-center p-5 text-danger">
                    <i class="fas fa-exclamation-triangle"></i> 
                    <p>Error loading worker data: ${error || 'Unknown error'}</p>
                </div>
            `);
            
            // Show retry button
            $('#retry-button').show();
            
            // Implement exponential backoff for automatic retry
            connectionRetryCount++;
            const delay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(5, connectionRetryCount)));
            console.log(`Will retry in ${delay/1000} seconds (attempt ${connectionRetryCount})`);
            
            setTimeout(() => {
                fetchWorkerData(true); // Force refresh on retry
            }, delay);
        },
        complete: function() {
            $('#worker-grid').removeClass('loading-fade');
        }
    });
}

// Update the worker grid with data
// UPDATED FUNCTION
function updateWorkerGrid() {
    if (!workerData || !workerData.workers) {
        console.error("No worker data available");
        return;
    }
    
    const workerGrid = $('#worker-grid');
    workerGrid.empty();
    
    // Apply current filters before rendering
    const filteredWorkers = filterWorkersData(workerData.workers);
    
    if (filteredWorkers.length === 0) {
        workerGrid.html(`
            <div class="text-center p-5">
                <i class="fas fa-search"></i>
                <p>No workers match your filter criteria</p>
            </div>
        `);
        return;
    }
    
    // Calculate total unpaid earnings (from the dashboard)
    const totalUnpaidEarnings = workerData.total_earnings || 0;
    
    // Sum up hashrates of online workers to calculate share percentages
    const totalHashrate = workerData.workers
        .filter(w => w.status === 'online')
        .reduce((sum, w) => sum + parseFloat(w.hashrate_3hr || 0), 0);
    
    // Calculate share percentage for each worker
    const onlineWorkers = workerData.workers.filter(w => w.status === 'online');
    const offlineWorkers = workerData.workers.filter(w => w.status === 'offline');
    
    // Allocate 95% to online workers, 5% to offline workers
    const onlinePool = totalUnpaidEarnings * 0.95;
    const offlinePool = totalUnpaidEarnings * 0.05;
    
    // Generate worker cards
    filteredWorkers.forEach(worker => {
        // Calculate earnings share based on hashrate proportion
        let earningsDisplay = worker.earnings;
        
        // Explicitly recalculate earnings share for display consistency
        if (worker.status === 'online' && totalHashrate > 0) {
            const hashrateShare = parseFloat(worker.hashrate_3hr || 0) / totalHashrate;
            earningsDisplay = (onlinePool * hashrateShare).toFixed(8);
        } else if (worker.status === 'offline' && offlineWorkers.length > 0) {
            earningsDisplay = (offlinePool / offlineWorkers.length).toFixed(8);
        }
        
        // Create worker card
        const card = $('<div class="worker-card"></div>');
        
        // Add class based on status
        if (worker.status === 'online') {
            card.addClass('worker-card-online');
        } else {
            card.addClass('worker-card-offline');
        }
        
        // Add worker type badge
        card.append(`<div class="worker-type">${worker.type}</div>`);
        
        // Add worker name
        card.append(`<div class="worker-name">${worker.name}</div>`);
        
        // Add status badge
        if (worker.status === 'online') {
            card.append('<div class="status-badge status-badge-online">ONLINE</div>');
        } else {
            card.append('<div class="status-badge status-badge-offline">OFFLINE</div>');
        }
        
        // Add hashrate bar
        const maxHashrate = 200; // TH/s - adjust based on your fleet
        const hashratePercent = Math.min(100, (worker.hashrate_3hr / maxHashrate) * 100);
        card.append(`
            <div class="worker-stats-row">
                <div class="worker-stats-label">Hashrate (3hr):</div>
                <div class="white-glow">${worker.hashrate_3hr} ${worker.hashrate_3hr_unit}</div>
            </div>
            <div class="stats-bar-container">
                <div class="stats-bar" style="width: ${hashratePercent}%"></div>
            </div>
        `);
        
        // Add additional stats - NOTE: Using recalculated earnings
        card.append(`
            <div class="worker-stats">
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Last Share:</div>
                    <div class="blue-glow">${worker.last_share.split(' ')[1]}</div>
                </div>
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Earnings:</div>
                    <div class="green-glow">${earningsDisplay}</div>
                </div>
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Accept Rate:</div>
                    <div class="white-glow">${worker.acceptance_rate}%</div>
                </div>
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Temp:</div>
                    <div class="${worker.temperature > 65 ? 'red-glow' : 'white-glow'}">${worker.temperature > 0 ? worker.temperature + '°C' : 'N/A'}</div>
                </div>
            </div>
        `);
        
        // Add card to grid
        workerGrid.append(card);
    });
    
    // Verify the sum of displayed earnings equals the total
    console.log(`Total unpaid earnings: ${totalUnpaidEarnings} BTC`);
    console.log(`Sum of worker displayed earnings: ${
        filteredWorkers.reduce((sum, w) => {
            if (w.status === 'online' && totalHashrate > 0) {
                const hashrateShare = parseFloat(w.hashrate_3hr || 0) / totalHashrate;
                return sum + parseFloat((onlinePool * hashrateShare).toFixed(8));
            } else if (w.status === 'offline' && offlineWorkers.length > 0) {
                return sum + parseFloat((offlinePool / offlineWorkers.length).toFixed(8));
            }
            return sum;
        }, 0)
    } BTC`);
}

// Filter worker data based on current filter state
function filterWorkersData(workers) {
    if (!workers) return [];
    
    return workers.filter(worker => {
        const workerName = worker.name.toLowerCase();
        const isOnline = worker.status === 'online';
        const workerType = worker.type.toLowerCase();
        
        // Check if worker matches filter
        let matchesFilter = false;
        if (filterState.currentFilter === 'all') {
            matchesFilter = true;
        } else if (filterState.currentFilter === 'online' && isOnline) {
            matchesFilter = true;
        } else if (filterState.currentFilter === 'offline' && !isOnline) {
            matchesFilter = true;
        } else if (filterState.currentFilter === 'asic' && workerType === 'asic') {
            matchesFilter = true;
        } else if (filterState.currentFilter === 'fpga' && workerType === 'fpga') {
            matchesFilter = true;
        }
        
        // Check if worker matches search term
        const matchesSearch = workerName.includes(filterState.searchTerm);
        
        return matchesFilter && matchesSearch;
    });
}

// Apply filter to rendered worker cards
function filterWorkers() {
    if (!workerData || !workerData.workers) return;
    
    // Re-render the worker grid with current filters
    updateWorkerGrid();
}

// Modified updateSummaryStats function for workers.js
function updateSummaryStats() {
    if (!workerData) return;
    
    // Update worker counts
    $('#workers-count').text(workerData.workers_total || 0);
    $('#workers-online').text(workerData.workers_online || 0);
    $('#workers-offline').text(workerData.workers_offline || 0);
    
    // Update worker ring percentage
    const onlinePercent = workerData.workers_total > 0 ? 
        workerData.workers_online / workerData.workers_total : 0;
    $('.worker-ring').css('--online-percent', onlinePercent);
    
    // IMPORTANT: Update total hashrate using EXACT format matching main dashboard
    // This ensures the displayed value matches exactly what's on the main page
    if (workerData.total_hashrate !== undefined) {
        // Format with exactly 1 decimal place - matches main dashboard format
        const formattedHashrate = Number(workerData.total_hashrate).toFixed(1);
        $('#total-hashrate').text(`${formattedHashrate} ${workerData.hashrate_unit || 'TH/s'}`);
    } else {
        $('#total-hashrate').text(`0.0 ${workerData.hashrate_unit || 'TH/s'}`);
    }
    
    // Update other summary stats
    $('#total-earnings').text(`${(workerData.total_earnings || 0).toFixed(8)} BTC`);
    $('#daily-sats').text(`${numberWithCommas(workerData.daily_sats || 0)} sats`);
    $('#avg-acceptance-rate').text(`${(workerData.avg_acceptance_rate || 0).toFixed(2)}%`);
}

// Initialize mini chart
function initializeMiniChart() {
    const ctx = document.getElementById('total-hashrate-chart').getContext('2d');
    
    // Generate some sample data to start
    const labels = Array(24).fill('').map((_, i) => i);
    const data = [750, 760, 755, 770, 780, 775, 760, 765, 770, 775, 780, 790, 785, 775, 770, 765, 780, 785, 775, 770, 775, 780, 775, 774.8];
    
    miniChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                borderColor: '#1137F5',
                backgroundColor: 'rgba(57, 255, 20, 0.1)',
                fill: true,
                tension: 0.3,
                borderWidth: 1.5,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false },
                y: { 
                    display: false,
                    min: Math.min(...data) * 0.9,
                    max: Math.max(...data) * 1.1
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            animation: false,
            elements: {
                line: {
                    tension: 0.4
                }
            }
        }
    });
}

// Update mini chart with real data
function updateMiniChart() {
    if (!miniChart || !workerData || !workerData.hashrate_history) return;
    
    // Extract hashrate data from history
    const historyData = workerData.hashrate_history;
    if (!historyData || historyData.length === 0) return;
    
    // Get the values for the chart
    const values = historyData.map(item => parseFloat(item.value) || 0);
    const labels = historyData.map(item => item.time);
    
    // Update chart data
    miniChart.data.labels = labels;
    miniChart.data.datasets[0].data = values;
    
    // Update y-axis range
    const min = Math.min(...values);
    const max = Math.max(...values);
    miniChart.options.scales.y.min = min * 0.9;
    miniChart.options.scales.y.max = max * 1.1;
    
    // Update the chart
    miniChart.update('none');
}

// Update progress bar
function updateProgressBar() {
    if (currentProgress < PROGRESS_MAX) {
        currentProgress++;
        const progressPercent = (currentProgress / PROGRESS_MAX) * 100;
        $("#bitcoin-progress-inner").css("width", progressPercent + "%");
        
        // Add glowing effect when close to completion
        if (progressPercent > 80) {
            $("#bitcoin-progress-inner").addClass("glow-effect");
        } else {
            $("#bitcoin-progress-inner").removeClass("glow-effect");
        }
        
        // Update remaining seconds text
        let remainingSeconds = PROGRESS_MAX - currentProgress;
        if (remainingSeconds <= 0) {
            $("#progress-text").text("Waiting for update...");
            $("#bitcoin-progress-inner").addClass("waiting-for-update");
        } else {
            $("#progress-text").text(remainingSeconds + "s to next update");
            $("#bitcoin-progress-inner").removeClass("waiting-for-update");
        }
        
        // Check for main dashboard refresh near the end to ensure sync
        if (currentProgress >= 55) { // When we're getting close to refresh time
            try {
                const lastDashboardRefresh = parseInt(localStorage.getItem('dashboardRefreshTime') || '0');
                const secondsSinceDashboardRefresh = (Date.now() - lastDashboardRefresh) / 1000;
                
                // If main dashboard just refreshed (within last 5 seconds)
                if (secondsSinceDashboardRefresh <= 5) {
                    console.log("Detected recent dashboard refresh, syncing now");
                    resetProgressBar();
                    fetchWorkerData();
                    return;
                }
            } catch (e) {
                console.error("Error checking dashboard refresh status:", e);
            }
        }
    } else {
        // Reset progress bar if it's time to refresh
        // But first check if the main dashboard refreshed recently
        try {
            const lastDashboardRefresh = parseInt(localStorage.getItem('dashboardRefreshTime') || '0');
            const secondsSinceDashboardRefresh = (Date.now() - lastDashboardRefresh) / 1000;
            
            // If dashboard refreshed in the last 10 seconds, wait for it instead of refreshing ourselves
            if (secondsSinceDashboardRefresh < 10) {
                console.log("Waiting for dashboard refresh event instead of refreshing independently");
                return;
            }
        } catch (e) {
            console.error("Error checking dashboard refresh status:", e);
        }
        
        // If main dashboard hasn't refreshed recently, do our own refresh
        if (Date.now() - lastUpdateTime > PROGRESS_MAX * 1000) {
            console.log("Progress bar expired, fetching data");
            fetchWorkerData();
        }
    }
}

// Reset progress bar
function resetProgressBar() {
    currentProgress = 0;
    $("#bitcoin-progress-inner").css("width", "0%");
    $("#bitcoin-progress-inner").removeClass("glow-effect");
    $("#bitcoin-progress-inner").removeClass("waiting-for-update");
    $("#progress-text").text(PROGRESS_MAX + "s to next update");
}

// Update the last updated timestamp
function updateLastUpdated() {
    if (!workerData || !workerData.timestamp) return;
    
    try {
        const timestamp = new Date(workerData.timestamp);
        $("#lastUpdated").html("<strong>Last Updated:</strong> " + 
            timestamp.toLocaleString() + "<span id='terminal-cursor'></span>");
    } catch (e) {
        console.error("Error formatting timestamp:", e);
    }
}

// Format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}