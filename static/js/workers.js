"use strict";

// Global variables for workers dashboard
let workerData = null;
let refreshTimer;
let pageLoadTime = Date.now();
let lastManualRefreshTime = 0;
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
const MIN_REFRESH_INTERVAL = 10000; // Minimum 10 seconds between refreshes

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

// Initialize the page
$(document).ready(function () {
    console.log("Worker page initializing...");

    // Set up initial UI
    initializePage();

    // Get server time for uptime calculation
    updateServerTime();

    // Define global refresh function for BitcoinMinuteRefresh
    window.manualRefresh = fetchWorkerData;

    // Wait before initializing BitcoinMinuteRefresh to ensure DOM is ready
    setTimeout(function () {
        // Initialize BitcoinMinuteRefresh with our refresh function
        if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
            BitcoinMinuteRefresh.initialize(window.manualRefresh);
            console.log("BitcoinMinuteRefresh initialized with refresh function");
        } else {
            console.warn("BitcoinMinuteRefresh not available");
        }
    }, 500);

    // Fetch worker data immediately on page load
    fetchWorkerData();

    // Set up filter button click handlers
    $('.filter-button').click(function () {
        $('.filter-button').removeClass('active');
        $(this).addClass('active');
        filterState.currentFilter = $(this).data('filter');
        filterWorkers();
    });

    // Set up search input handler
    $('#worker-search').on('input', function () {
        filterState.searchTerm = $(this).val().toLowerCase();
        filterWorkers();
    });
});

// Initialize page elements
function initializePage() {
    console.log("Initializing page elements...");

    // Initialize mini chart for total hashrate if the element exists
    if (document.getElementById('total-hashrate-chart')) {
        initializeMiniChart();
    }

    // Show loading state
    $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-spinner fa-spin"></i> Loading worker data...</div>');

    // Add retry button (hidden by default)
    if (!$('#retry-button').length) {
        $('body').append('<button id="retry-button" style="position: fixed; bottom: 20px; left: 20px; z-index: 1000; background: #f7931a; color: black; border: none; padding: 8px 16px; display: none; border-radius: 4px; cursor: pointer;">Retry Loading Data</button>');

        $('#retry-button').on('click', function () {
            $(this).text('Retrying...').prop('disabled', true);
            fetchWorkerData(true);
            setTimeout(() => {
                $('#retry-button').text('Retry Loading Data').prop('disabled', false);
            }, 3000);
        });
    }
}

// Server time update via polling - enhanced to use shared storage
function updateServerTime() {
    console.log("Updating server time...");

    // First try to get stored values
    try {
        const storedOffset = localStorage.getItem('serverTimeOffset');
        const storedStartTime = localStorage.getItem('serverStartTime');

        if (storedOffset && storedStartTime) {
            serverTimeOffset = parseFloat(storedOffset);
            serverStartTime = parseFloat(storedStartTime);
            console.log("Using stored server time offset:", serverTimeOffset, "ms");

            // Only update BitcoinMinuteRefresh if it's initialized
            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }
            return; // Don't fetch if we have valid values
        }
    } catch (e) {
        console.error("Error reading stored server time:", e);
    }

    // Fetch from API if needed
    $.ajax({
        url: "/api/time",
        method: "GET",
        timeout: 5000,
        success: function (data) {
            // Calculate the offset between server time and local time
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();

            // Store in localStorage for cross-page sharing
            localStorage.setItem('serverTimeOffset', serverTimeOffset.toString());
            localStorage.setItem('serverStartTime', serverStartTime.toString());

            // Only update BitcoinMinuteRefresh if it's initialized
            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }

            console.log("Server time synchronized. Offset:", serverTimeOffset, "ms");
        },
        error: function (jqXHR, textStatus, errorThrown) {
            console.error("Error fetching server time:", textStatus, errorThrown);
        }
    });
}

// Fetch worker data from API
function fetchWorkerData(forceRefresh = false) {
    console.log("Fetching worker data...");

    // Track this as a manual refresh for throttling purposes
    lastManualRefreshTime = Date.now();

    $('#worker-grid').addClass('loading-fade');

    // Choose API URL based on whether we're forcing a refresh
    const apiUrl = `/api/workers${forceRefresh ? '?force=true' : ''}`;

    $.ajax({
        url: apiUrl,
        method: 'GET',
        dataType: 'json',
        timeout: 15000, // 15 second timeout
        success: function (data) {
            if (!data || !data.workers || data.workers.length === 0) {
                console.warn("No workers found in data response");
                $('#worker-grid').html(`
                    <div class="text-center p-5">
                        <p>No workers found. Try refreshing the page.</p>
                    </div>
                `);
                return;
            }

            workerData = data;

            // Notify BitcoinMinuteRefresh that we've refreshed the data
            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
                BitcoinMinuteRefresh.notifyRefresh();
            }

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
        error: function (xhr, status, error) {
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
            console.log(`Will retry in ${delay / 1000} seconds (attempt ${connectionRetryCount})`);

            setTimeout(() => {
                fetchWorkerData(true); // Force refresh on retry
            }, delay);
        },
        complete: function () {
            $('#worker-grid').removeClass('loading-fade');
        }
    });
}

// Update the worker grid with data
function updateWorkerGrid() {
    console.log("Updating worker grid...");

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

    // Generate worker cards
    filteredWorkers.forEach(worker => {
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

        // Add hashrate bar with normalized values for consistent display
        const maxHashrate = 200; // TH/s - adjust based on your fleet
        const normalizedHashrate = normalizeHashrate(
            worker.hashrate_3hr,
            worker.hashrate_3hr_unit || 'th/s'
        );
        const hashratePercent = Math.min(100, (normalizedHashrate / maxHashrate) * 100);

        // Format hashrate for display with appropriate unit
        const formattedHashrate = formatHashrateForDisplay(
            worker.hashrate_3hr,
            worker.hashrate_3hr_unit || 'th/s'
        );

        card.append(`
            <div class="worker-stats-row">
                <div class="worker-stats-label">Hashrate (3hr):</div>
                <div class="white-glow">${formattedHashrate}</div>
            </div>
            <div class="stats-bar-container">
                <div class="stats-bar" style="width: ${hashratePercent}%"></div>
            </div>
        `);

        // Add additional stats
        card.append(`
            <div class="worker-stats">
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Last Share:</div>
                    <div class="blue-glow">${typeof worker.last_share === 'string' ? worker.last_share.split(' ')[1] || worker.last_share : 'N/A'}</div>
                </div>
                <div class="worker-stats-row">
                    <div class="worker-stats-label">Earnings:</div>
                    <div class="green-glow">${worker.earnings.toFixed(8)}</div>
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
}

// Filter worker data based on current filter state
function filterWorkersData(workers) {
    if (!workers) return [];

    return workers.filter(worker => {
        // Default to empty string if name is undefined
        const workerName = (worker.name || '').toLowerCase();
        const isOnline = worker.status === 'online';
        const workerType = (worker.type || '').toLowerCase();

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
        const matchesSearch = filterState.searchTerm === '' || workerName.includes(filterState.searchTerm);

        return matchesFilter && matchesSearch;
    });
}

// Apply filter to rendered worker cards
function filterWorkers() {
    if (!workerData || !workerData.workers) return;

    // Re-render the worker grid with current filters
    updateWorkerGrid();
}

// Modified updateSummaryStats function with normalized hashrate display
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

    // Display normalized hashrate with appropriate unit
    if (workerData.total_hashrate !== undefined) {
        // Format with proper unit conversion
        const formattedHashrate = formatHashrateForDisplay(
            workerData.total_hashrate,
            workerData.hashrate_unit || 'TH/s'
        );
        $('#total-hashrate').text(formattedHashrate);
    } else {
        $('#total-hashrate').text(`0.0 TH/s`);
    }

    // Update other summary stats
    $('#total-earnings').text(`${(workerData.total_earnings || 0).toFixed(8)} BTC`);
    $('#daily-sats').text(`${numberWithCommas(workerData.daily_sats || 0)} sats`);
    $('#avg-acceptance-rate').text(`${(workerData.avg_acceptance_rate || 0).toFixed(2)}%`);
}

// Initialize mini chart
function initializeMiniChart() {
    console.log("Initializing mini chart...");

    const ctx = document.getElementById('total-hashrate-chart');
    if (!ctx) {
        console.error("Mini chart canvas not found");
        return;
    }

    // Generate some sample data to start
    const labels = Array(24).fill('').map((_, i) => i);
    const data = Array(24).fill(0).map(() => Math.random() * 100 + 700);

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

// Update mini chart with real data and normalization
function updateMiniChart() {
    if (!miniChart || !workerData || !workerData.hashrate_history) {
        console.log("Skipping mini chart update - missing data");
        return;
    }

    // Extract hashrate data from history
    const historyData = workerData.hashrate_history;
    if (!historyData || historyData.length === 0) {
        console.log("No hashrate history data available");
        return;
    }

    // Get the normalized values for the chart
    const values = historyData.map(item => {
        const val = parseFloat(item.value) || 0;
        const unit = item.unit || workerData.hashrate_unit || 'th/s';
        return normalizeHashrate(val, unit);
    });
    const labels = historyData.map(item => item.time);

    // Update chart data
    miniChart.data.labels = labels;
    miniChart.data.datasets[0].data = values;

    // Update y-axis range
    const min = Math.min(...values.filter(v => v > 0)) || 0;
    const max = Math.max(...values) || 1;
    miniChart.options.scales.y.min = min * 0.9;
    miniChart.options.scales.y.max = max * 1.1;

    // Update the chart
    miniChart.update('none');
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
