"use strict";

// Global variables for workers dashboard
let workerData = null;
let refreshTimer;
const pageLoadTime = Date.now();
let lastManualRefreshTime = 0;
const filterState = {
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
function normalizeHashrate(value, unit = 'th/s') {
    if (!value || isNaN(value)) return 0;

    unit = unit.toLowerCase();
    const unitConversion = {
        'ph/s': 1000,
        'eh/s': 1000000,
        'gh/s': 1 / 1000,
        'mh/s': 1 / 1000000,
        'kh/s': 1 / 1000000000,
        'h/s': 1 / 1000000000000
    };

    return unitConversion[unit] !== undefined ? value * unitConversion[unit] : value;
}

// Helper function to format hashrate values for display
function formatHashrateForDisplay(value, unit) {
    if (isNaN(value) || value === null || value === undefined) return "N/A";

    const normalizedValue = unit ? normalizeHashrate(value, unit) : value;
    const unitRanges = [
        { threshold: 1000000, unit: 'EH/s', divisor: 1000000 },
        { threshold: 1000, unit: 'PH/s', divisor: 1000 },
        { threshold: 1, unit: 'TH/s', divisor: 1 },
        { threshold: 0.001, unit: 'GH/s', divisor: 1 / 1000 },
        { threshold: 0, unit: 'MH/s', divisor: 1 / 1000000 }
    ];

    for (const range of unitRanges) {
        if (normalizedValue >= range.threshold) {
            return (normalizedValue / range.divisor).toFixed(2) + ' ' + range.unit;
        }
    }
    return (normalizedValue * 1000000).toFixed(2) + ' MH/s';
}

// Initialize the page
$(document).ready(function () {
    console.log("Worker page initializing...");

    initNotificationBadge();
    initializePage();
    updateServerTime();

    window.manualRefresh = fetchWorkerData;

    setTimeout(() => {
        if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
            BitcoinMinuteRefresh.initialize(window.manualRefresh);
            console.log("BitcoinMinuteRefresh initialized with refresh function");
        } else {
            console.warn("BitcoinMinuteRefresh not available");
        }
    }, 500);

    fetchWorkerData();

    $('.filter-button').click(function () {
        $('.filter-button').removeClass('active');
        $(this).addClass('active');
        filterState.currentFilter = $(this).data('filter');
        filterWorkers();
    });

    $('#worker-search').on('input', function () {
        filterState.searchTerm = $(this).val().toLowerCase();
        filterWorkers();
    });
});

// Initialize page elements
function initializePage() {
    console.log("Initializing page elements...");

    if (document.getElementById('total-hashrate-chart')) {
        initializeMiniChart();
    }

    $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-spinner fa-spin"></i> Loading worker data...</div>');

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
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 60000);
}

// Server time update via polling - enhanced to use shared storage
function updateServerTime() {
    console.log("Updating server time...");

    try {
        const storedOffset = localStorage.getItem('serverTimeOffset');
        const storedStartTime = localStorage.getItem('serverStartTime');

        if (storedOffset && storedStartTime) {
            serverTimeOffset = parseFloat(storedOffset);
            serverStartTime = parseFloat(storedStartTime);
            console.log("Using stored server time offset:", serverTimeOffset, "ms");

            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.updateServerTime) {
                BitcoinMinuteRefresh.updateServerTime(serverTimeOffset, serverStartTime);
            }
            return;
        }
    } catch (e) {
        console.error("Error reading stored server time:", e);
    }

    $.ajax({
        url: "/api/time",
        method: "GET",
        timeout: 5000,
        success: function (data) {
            serverTimeOffset = new Date(data.server_timestamp).getTime() - Date.now();
            serverStartTime = new Date(data.server_start_time).getTime();

            localStorage.setItem('serverTimeOffset', serverTimeOffset.toString());
            localStorage.setItem('serverStartTime', serverStartTime.toString());

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

// Utility functions to show/hide loader
function showLoader() {
    $("#loader").show();
}

function hideLoader() {
    $("#loader").hide();
}

// Fetch worker data from API with pagination, limiting to 10 pages
function fetchWorkerData(forceRefresh = false) {
    console.log("Fetching worker data...");
    lastManualRefreshTime = Date.now();
    $('#worker-grid').addClass('loading-fade');
    showLoader();

    const maxPages = 10;
    const requests = [];

    // Create requests for pages 1 through maxPages concurrently
    for (let page = 1; page <= maxPages; page++) {
        const apiUrl = `/api/workers?page=${page}${forceRefresh ? '&force=true' : ''}`;
        requests.push($.ajax({
            url: apiUrl,
            method: 'GET',
            dataType: 'json',
            timeout: 15000
        }));
    }

    // Process all requests concurrently
    Promise.all(requests)
        .then(pages => {
            let allWorkers = [];
            let aggregatedData = null;

            pages.forEach((data, i) => {
                if (data && data.workers && data.workers.length > 0) {
                    allWorkers = allWorkers.concat(data.workers);
                    if (i === 0) {
                        aggregatedData = data; // preserve stats from first page
                    }
                } else {
                    console.warn(`No workers found on page ${i + 1}`);
                }
            });

            // Deduplicate workers if necessary (using worker.name as unique key)
            const uniqueWorkers = allWorkers.filter((worker, index, self) =>
                index === self.findIndex((w) => w.name === worker.name)
            );

            workerData = aggregatedData || {};
            workerData.workers = uniqueWorkers;

            if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
                BitcoinMinuteRefresh.notifyRefresh();
            }

            updateWorkerGrid();
            updateSummaryStats();
            updateMiniChart();
            updateLastUpdated();

            $('#retry-button').hide();
            connectionRetryCount = 0;
            console.log("Worker data updated successfully");
            $('#worker-grid').removeClass('loading-fade');
        })
        .catch(error => {
            console.error("Error fetching worker data:", error);
        })
        .finally(() => {
            hideLoader();
        });
}

// Refresh worker data every 60 seconds
setInterval(function () {
    console.log("Refreshing worker data at " + new Date().toLocaleTimeString());
    fetchWorkerData();
}, 60000);

// Update the worker grid with data
function updateWorkerGrid() {
    console.log("Updating worker grid...");

    if (!workerData || !workerData.workers) {
        console.error("No worker data available");
        return;
    }

    const workerGrid = $('#worker-grid');
    workerGrid.empty();

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

    filteredWorkers.forEach(worker => {
        const card = createWorkerCard(worker);
        workerGrid.append(card);
    });
}

// Create worker card element
function createWorkerCard(worker) {
    const card = $('<div class="worker-card"></div>');

    card.addClass(worker.status === 'online' ? 'worker-card-online' : 'worker-card-offline');
    card.append(`<div class="worker-type">${worker.type}</div>`);
    card.append(`<div class="worker-name">${worker.name}</div>`);
    card.append(`<div class="status-badge ${worker.status === 'online' ? 'status-badge-online' : 'status-badge-offline'}">${worker.status.toUpperCase()}</div>`);

    const maxHashrate = 125; // TH/s - adjust based on your fleet
    const normalizedHashrate = normalizeHashrate(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');
    const hashratePercent = Math.min(100, (normalizedHashrate / maxHashrate) * 100);
    const formattedHashrate = formatHashrateForDisplay(worker.hashrate_3hr, worker.hashrate_3hr_unit || 'th/s');

    card.append(`
        <div class="worker-stats-row">
            <div class="worker-stats-label">Hashrate (3hr):</div>
            <div class="white-glow">${formattedHashrate}</div>
        </div>
        <div class="stats-bar-container">
            <div class="stats-bar" style="width: ${hashratePercent}%"></div>
        </div>
    `);

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

    return card;
}

// Filter worker data based on current filter state
function filterWorkersData(workers) {
    if (!workers) return [];

    return workers.filter(worker => {
        const workerName = (worker.name || '').toLowerCase();
        const isOnline = worker.status === 'online';
        const workerType = (worker.type || '').toLowerCase();

        const matchesFilter = filterState.currentFilter === 'all' ||
            (filterState.currentFilter === 'online' && isOnline) ||
            (filterState.currentFilter === 'offline' && !isOnline) ||
            (filterState.currentFilter === 'asic' && workerType === 'asic') ||
            (filterState.currentFilter === 'bitaxe' && workerType === 'bitaxe');

        const matchesSearch = filterState.searchTerm === '' || workerName.includes(filterState.searchTerm);

        return matchesFilter && matchesSearch;
    });
}

// Apply filter to rendered worker cards
function filterWorkers() {
    if (!workerData || !workerData.workers) return;
    updateWorkerGrid();
}

// Update summary stats with normalized hashrate display
function updateSummaryStats() {
    if (!workerData) return;

    $('#workers-count').text(workerData.workers_total || 0);
    $('#workers-online').text(workerData.workers_online || 0);
    $('#workers-offline').text(workerData.workers_offline || 0);

    const onlinePercent = workerData.workers_total > 0 ? workerData.workers_online / workerData.workers_total : 0;
    $('.worker-ring').css('--online-percent', onlinePercent);

    const formattedHashrate = workerData.total_hashrate !== undefined ?
        formatHashrateForDisplay(workerData.total_hashrate, workerData.hashrate_unit || 'TH/s') :
        '0.0 TH/s';
    $('#total-hashrate').text(formattedHashrate);

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

    const historyData = workerData.hashrate_history;
    if (!historyData || historyData.length === 0) {
        console.log("No hashrate history data available");
        return;
    }

    const values = historyData.map(item => normalizeHashrate(parseFloat(item.value) || 0, item.unit || workerData.hashrate_unit || 'th/s'));
    const labels = historyData.map(item => item.time);

    miniChart.data.labels = labels;
    miniChart.data.datasets[0].data = values;

    const min = Math.min(...values.filter(v => v > 0)) || 0;
    const max = Math.max(...values) || 1;
    miniChart.options.scales.y.min = min * 0.9;
    miniChart.options.scales.y.max = max * 1.1;

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
