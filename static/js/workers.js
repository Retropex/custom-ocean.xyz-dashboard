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

// Modified to properly fetch and store currency data 
function fetchWorkerData(forceRefresh = false) {
    console.log("Fetching worker data...");
    lastManualRefreshTime = Date.now();
    $('#worker-grid').addClass('loading-fade');
    showLoader();

    // For large datasets, better to use streaming or chunked approach
    // First fetch just the summary data and first page
    const initialRequest = $.ajax({
        url: `/api/workers?summary=true&page=1${forceRefresh ? '&force=true' : ''}`,
        method: 'GET',
        dataType: 'json',
        timeout: 15000
    });

    initialRequest.then(summaryData => {
        // Store summary stats immediately to update UI
        workerData = summaryData || {};
        workerData.workers = workerData.workers || [];

        // If currency data is missing, fetch it separately
        if (!workerData.currency || !workerData.btc_price) {
            $.ajax({
                url: '/api/metrics',
                method: 'GET',
                dataType: 'json'
            }).then(metrics => {
                if (metrics) {
                    workerData.currency = metrics.currency || 'USD';
                    workerData.btc_price = metrics.btc_price || 75000;
                    workerData.exchange_rates = metrics.exchange_rates || {};
                }

                // Continue with updates
                updateSummaryStats();
                updateMiniChart();
                updateLastUpdated();
                continueFetchingWorkers();
            }).catch(() => {
                // Even if metrics fetch fails, continue with worker data
                continueFetchingWorkers();
            });
        } else {
            // We already have currency data, continue directly
            updateSummaryStats();
            updateMiniChart();
            updateLastUpdated();
            continueFetchingWorkers();
        }
    }).catch(error => {
        console.error("Error fetching initial worker data:", error);
        $('#worker-grid').html('<div class="text-center p-5"><i class="fas fa-exclamation-circle"></i> Error loading workers. <button class="retry-btn">Retry</button></div>');
        $('.retry-btn').on('click', () => fetchWorkerData(true));
        hideLoader();
        $('#worker-grid').removeClass('loading-fade');
    });

    // Function to continue fetching additional worker pages
    function continueFetchingWorkers() {
        const totalPages = Math.ceil((workerData.workers_total || 0) / 100); // Assuming 100 workers per page
        const pagesToFetch = Math.min(totalPages, 20); // Limit to 20 pages max

        if (pagesToFetch <= 1) {
            // We already have all the data from the first request
            finishWorkerLoad();
            return;
        }

        // Progress indicator
        const progressBar = $('<div class="worker-load-progress"><div class="progress-bar"></div><div class="progress-text">Loading workers: 1/' + pagesToFetch + '</div></div>');
        $('#worker-grid').html(progressBar);

        // Load remaining pages in batches to avoid overwhelming the browser
        loadWorkerPages(2, pagesToFetch, progressBar);
    }
}

// Load worker pages in batches
function loadWorkerPages(startPage, totalPages, progressBar) {
    const BATCH_SIZE = 3; // Number of pages to load in parallel
    const endPage = Math.min(startPage + BATCH_SIZE - 1, totalPages);
    const requests = [];

    for (let page = startPage; page <= endPage; page++) {
        requests.push(
            $.ajax({
                url: `/api/workers?page=${page}`,
                method: 'GET',
                dataType: 'json',
                timeout: 15000
            })
        );
    }

    Promise.all(requests)
        .then(pages => {
            // Process each page
            pages.forEach(pageData => {
                if (pageData && pageData.workers && pageData.workers.length > 0) {
                    // Append new workers to our list efficiently
                    workerData.workers = workerData.workers.concat(pageData.workers);
                }
            });

            // Update progress
            const progress = Math.min(endPage / totalPages * 100, 100);
            progressBar.find('.progress-bar').css('width', progress + '%');
            progressBar.find('.progress-text').text(`Loading workers: ${endPage}/${totalPages}`);

            if (endPage < totalPages) {
                // Continue with next batch
                setTimeout(() => loadWorkerPages(endPage + 1, totalPages, progressBar), 100);
            } else {
                // All pages loaded
                finishWorkerLoad();
            }
        })
        .catch(error => {
            console.error(`Error fetching worker pages ${startPage}-${endPage}:`, error);
            // Continue with what we have so far
            finishWorkerLoad();
        });
}

// Finish loading process with optimized rendering
function finishWorkerLoad() {
    // Deduplicate workers more efficiently with a Map
    const uniqueWorkersMap = new Map();
    workerData.workers.forEach(worker => {
        if (worker.name) {
            uniqueWorkersMap.set(worker.name, worker);
        }
    });
    workerData.workers = Array.from(uniqueWorkersMap.values());

    // Notify BitcoinMinuteRefresh
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.notifyRefresh) {
        BitcoinMinuteRefresh.notifyRefresh();
    }

    // Efficiently render workers with virtualized list approach
    renderWorkersList();

    $('#retry-button').hide();
    connectionRetryCount = 0;
    console.log(`Worker data updated successfully: ${workerData.workers.length} workers`);
    $('#worker-grid').removeClass('loading-fade');
    hideLoader();
}

// Virtualized list rendering for large datasets
function renderWorkersList() {
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

    // Performance optimization for large lists
    if (filteredWorkers.length > 200) {
        // For very large lists, render in batches
        const workerBatch = 100;
        const totalBatches = Math.ceil(filteredWorkers.length / workerBatch);

        console.log(`Rendering ${filteredWorkers.length} workers in ${totalBatches} batches`);

        // Render first batch immediately
        renderWorkerBatch(filteredWorkers.slice(0, workerBatch), workerGrid);

        // Render remaining batches with setTimeout to avoid UI freezing
        for (let i = 1; i < totalBatches; i++) {
            const start = i * workerBatch;
            const end = Math.min(start + workerBatch, filteredWorkers.length);

            setTimeout(() => {
                renderWorkerBatch(filteredWorkers.slice(start, end), workerGrid);

                // Update "loading more" message with progress
                const loadingMsg = workerGrid.find('.loading-more-workers');
                if (loadingMsg.length) {
                    if (i === totalBatches - 1) {
                        loadingMsg.remove();
                    } else {
                        loadingMsg.text(`Loading more workers... ${Math.min((i + 1) * workerBatch, filteredWorkers.length)}/${filteredWorkers.length}`);
                    }
                }
            }, i * 50); // 50ms delay between batches
        }

        // Add "loading more" indicator at the bottom
        if (totalBatches > 1) {
            workerGrid.append(`<div class="loading-more-workers">Loading more workers... ${workerBatch}/${filteredWorkers.length}</div>`);
        }
    } else {
        // For smaller lists, render all at once
        renderWorkerBatch(filteredWorkers, workerGrid);
    }
}

// Render a batch of workers efficiently
function renderWorkerBatch(workers, container) {
    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Calculate max hashrate once for this batch
    const maxHashrate = calculateMaxHashrate();

    workers.forEach(worker => {
        const card = createWorkerCard(worker, maxHashrate);
        fragment.appendChild(card[0]);
    });

    container.append(fragment);
}

// Calculate max hashrate once to avoid recalculating for each worker
function calculateMaxHashrate() {
    let maxHashrate = 125; // Default fallback

    // First check if global hashrate data is available
    if (workerData && workerData.hashrate_24hr) {
        const globalHashrate = normalizeHashrate(workerData.hashrate_24hr, workerData.hashrate_24hr_unit || 'th/s');
        if (globalHashrate > 0) {
            return Math.max(5, globalHashrate * 1.2);
        }
    }

    // If no global data, calculate from workers efficiently
    if (workerData && workerData.workers && workerData.workers.length > 0) {
        const onlineWorkers = workerData.workers.filter(w => w.status === 'online');

        if (onlineWorkers.length > 0) {
            let maxWorkerHashrate = 0;

            // Find maximum hashrate without logging every worker
            onlineWorkers.forEach(w => {
                const hashrateValue = w.hashrate_24hr || w.hashrate_3hr || 0;
                const hashrateUnit = w.hashrate_24hr ?
                    (w.hashrate_24hr_unit || 'th/s') :
                    (w.hashrate_3hr_unit || 'th/s');
                const normalizedRate = normalizeHashrate(hashrateValue, hashrateUnit);

                if (normalizedRate > maxWorkerHashrate) {
                    maxWorkerHashrate = normalizedRate;
                }
            });

            if (maxWorkerHashrate > 0) {
                return Math.max(5, maxWorkerHashrate * 1.2);
            }
        }
    }

    // Fallback to total hashrate
    if (workerData && workerData.total_hashrate) {
        const totalHashrate = normalizeHashrate(workerData.total_hashrate, workerData.hashrate_unit || 'th/s');
        if (totalHashrate > 0) {
            return Math.max(5, totalHashrate * 1.2);
        }
    }

    return maxHashrate;
}

// Helper function to format currency values with HTML entity support
function formatCurrencyValue(sats) {
    // Default values
    let symbol = '$';
    let value = '0.00';

    try {
        // Get BTC price and currency info from workerData
        const btcPrice = workerData.btc_price || 75000;
        const configCurrency = workerData.currency || 'USD';
        const exchangeRates = workerData.exchange_rates || {};

        // Convert SATS to BTC then to USD
        const btcValue = sats / 100000000;
        let fiatValue = btcValue * btcPrice; // USD value

        // Apply exchange rate if not USD
        if (configCurrency !== 'USD' && exchangeRates[configCurrency]) {
            fiatValue *= exchangeRates[configCurrency];
        }

        // Format the value
        value = fiatValue.toFixed(2);

        // Set currency symbol using HTML entities or plain ASCII for better compatibility
        switch (configCurrency) {
            case 'EUR': symbol = '&euro;'; break;  // HTML entity for Euro
            case 'GBP': symbol = '&pound;'; break; // HTML entity for Pound
            case 'JPY': symbol = '&yen;'; break;   // HTML entity for Yen
            case 'AUD':
            case 'CAD':
            case 'NZD':
            case 'USD': symbol = '$'; break;       // Dollar sign is ASCII
            default: symbol = configCurrency + ' ';// Fallback to currency code
        }
    } catch (e) {
        console.error('Error formatting currency:', e);
    }

    return { symbol, value, isHTML: (symbol.indexOf('&') === 0) };
}

// Modified createWorkerCard function to display only currency value with proper symbol handling
function createWorkerCard(worker, maxHashrate) {
    const card = $('<div class="worker-card"></div>');

    card.addClass(worker.status === 'online' ? 'worker-card-online' : 'worker-card-offline');
    card.append(`<div class="worker-type">${worker.type}</div>`);
    card.append(`<div class="worker-name">${worker.name}</div>`);
    card.append(`<div class="status-badge ${worker.status === 'online' ? 'status-badge-online' : 'status-badge-offline'}">${worker.status.toUpperCase()}</div>`);

    // Use 3hr hashrate for display
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

    // Format the last share using the proper method for timezone conversion
    let formattedLastShare = 'N/A';
    if (worker.last_share && typeof worker.last_share === 'string') {
        try {
            const dateWithoutTZ = new Date(worker.last_share + 'Z');
            formattedLastShare = dateWithoutTZ.toLocaleString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
                timeZone: window.dashboardTimezone || 'America/Los_Angeles'
            });
        } catch (e) {
            formattedLastShare = worker.last_share;
        }
    }

    // Calculate earnings in SATS and get currency equivalent
    const earningsSats = Math.floor(worker.earnings * 100000000); // Convert BTC to SATS
    const currencyData = formatCurrencyValue(earningsSats);

    // Create the value display with proper handling of HTML entities
    let valueDisplay;
    if (currencyData.isHTML) {
        // Create a temporary element to handle the HTML entities
        const valueElement = $('<div></div>');
        valueElement.html(`${currencyData.symbol}${currencyData.value}`);
        valueDisplay = valueElement.html();
    } else {
        valueDisplay = `${currencyData.symbol}${currencyData.value}`;
    }

    card.append(`
        <div class="worker-stats">
            <div class="worker-stats-row">
                <div class="worker-stats-label">Last Share:</div>
                <div class="blue-glow">${formattedLastShare}</div>
            </div>
            <div class="worker-stats-row">
                <div class="worker-stats-label">Earnings:</div>
                <div class="green-glow">${worker.earnings.toFixed(8)}</div>
            </div>
            <div class="worker-stats-row">
                <div class="worker-stats-label">Fiat Value:</div>
                <div class="yellow-glow">${valueDisplay}</div>
            </div>
        </div>
    `);

    return card;
}

// Modified filterWorkers function for better search functionality
// This will replace the existing filterWorkers function in workers.js
function filterWorkers() {
    if (!workerData || !workerData.workers) return;
    renderWorkersList();
}

// Update the workers grid when filters change
function updateWorkerGrid() {
    renderWorkersList();
}

// Modified filterWorkersData function to only include 'all', 'online', and 'offline' filters
function filterWorkersData(workers) {
    if (!workers) return [];

    return workers.filter(worker => {
        const workerName = (worker.name || '').toLowerCase();
        const isOnline = worker.status === 'online';

        // Modified to only handle 'all', 'online', and 'offline' filters
        const matchesFilter = filterState.currentFilter === 'all' ||
            (filterState.currentFilter === 'online' && isOnline) ||
            (filterState.currentFilter === 'offline' && !isOnline);

        // Improved search matching to check name, model and type
        const matchesSearch = filterState.searchTerm === '' ||
            workerName.includes(filterState.searchTerm) ||
            (worker.model && worker.model.toLowerCase().includes(filterState.searchTerm)) ||
            (worker.type && worker.type.toLowerCase().includes(filterState.searchTerm));

        return matchesFilter && matchesSearch;
    });
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
    $('#daily-sats').text(`${numberWithCommas(workerData.daily_sats || 0)} SATS`);
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

        // Get the configured timezone with a fallback
        const configuredTimezone = window.dashboardTimezone || 'America/Los_Angeles';

        // Format with the configured timezone
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
            timeZone: configuredTimezone  // Explicitly use the configured timezone
        };

        // Format the timestamp and update the DOM
        const formattedTime = timestamp.toLocaleString('en-US', options);

        $("#lastUpdated").html("<strong>Last Updated:</strong> " +
            formattedTime + "<span id='terminal-cursor'></span>");

        console.log(`Last updated timestamp using timezone: ${configuredTimezone}`);
    } catch (e) {
        console.error("Error formatting timestamp:", e);
        // Fallback to basic timestamp if there's an error
        $("#lastUpdated").html("<strong>Last Updated:</strong> " +
            new Date().toLocaleString() + "<span id='terminal-cursor'></span>");
    }
}

// Format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
