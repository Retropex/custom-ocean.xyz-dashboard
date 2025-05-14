// earnings.js
document.addEventListener('DOMContentLoaded', function () {
    console.log('Earnings page loaded');

    // Add refresh functionality if needed
    setupAutoRefresh();

    // Format all currency values with commas
    formatCurrencyValues();

    // Apply user timezone formatting to all dates
    applyUserTimezoneFormatting();

    // Initialize the system monitor
    initializeSystemMonitor();
});

// Initialize the BitcoinMinuteRefresh system monitor
function initializeSystemMonitor() {
    // Define refresh function for the system monitor
    window.manualRefresh = function () {
        console.log("Manual refresh triggered by system monitor");
        location.reload();
    };

    // Initialize system monitor if it's available
    if (typeof BitcoinMinuteRefresh !== 'undefined') {
        // Get server time and initialize
        fetchServerTimeAndInitializeMonitor();
    } else {
        console.warn("BitcoinMinuteRefresh not available");
    }
}

// Fetch server time and initialize the monitor
function fetchServerTimeAndInitializeMonitor() {
    fetch('/api/time')
        .then(response => response.json())
        .then(data => {
            if (data && data.server_time) {
                const serverTime = new Date(data.server_time).getTime();
                const clientTime = Date.now();
                const offset = serverTime - clientTime;

                // Get server start time
                fetch('/api/server-start')
                    .then(response => response.json())
                    .then(startData => {
                        if (startData && startData.start_time) {
                            const startTime = new Date(startData.start_time).getTime();

                            // Initialize the system monitor with server time info
                            if (typeof BitcoinMinuteRefresh !== 'undefined') {
                                BitcoinMinuteRefresh.initialize(window.manualRefresh);
                                BitcoinMinuteRefresh.updateServerTime(offset, startTime);
                            }
                        }
                    })
                    .catch(error => {
                        console.error("Error fetching server start time:", error);
                        // Initialize with just time offset if server start time fails
                        if (typeof BitcoinMinuteRefresh !== 'undefined') {
                            BitcoinMinuteRefresh.initialize(window.manualRefresh);
                            BitcoinMinuteRefresh.updateServerTime(offset, Date.now() - 3600000); // fallback to 1 hour ago
                        }
                    });
            }
        })
        .catch(error => {
            console.error("Error fetching server time:", error);
            // Initialize without server time if API fails
            if (typeof BitcoinMinuteRefresh !== 'undefined') {
                BitcoinMinuteRefresh.initialize(window.manualRefresh);
            }
        });
}

// Function to format currency values with commas
function formatCurrency(amount) {
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Format all currency values on the page
function formatCurrencyValues() {
    // Format USD/fiat values in monthly summaries table
    const monthlyFiatCells = document.querySelectorAll('.earnings-table td:nth-child(5)');
    monthlyFiatCells.forEach(cell => {
        const currencySymbol = cell.querySelector('.currency-symbol');
        const symbol = currencySymbol ? currencySymbol.textContent : '';

        // Remove symbol temporarily to parse the value
        let valueText = cell.textContent;
        if (currencySymbol) {
            valueText = valueText.replace(symbol, '');
        }

        const value = parseFloat(valueText.replace(/[^\d.-]/g, ''));
        if (!isNaN(value)) {
            // Keep the currency symbol and add commas to the number
            cell.innerHTML = `<span class="currency-symbol">${symbol}</span>${formatCurrency(value.toFixed(2))}`;
        }
    });

    // Format all sats values
    const satsElements = document.querySelectorAll('#unpaid-sats, #total-paid-sats, .earnings-table td:nth-child(4)');
    satsElements.forEach(element => {
        if (element) {
            const rawValue = element.textContent.replace(/,/g, '').trim();
            if (!isNaN(parseInt(rawValue))) {
                element.textContent = formatCurrency(parseInt(rawValue));
            }
        }
    });

    // Format payment count
    const paymentCount = document.getElementById('payment-count');
    if (paymentCount && !isNaN(parseInt(paymentCount.textContent))) {
        paymentCount.textContent = formatCurrency(parseInt(paymentCount.textContent));
    }
}

function setupAutoRefresh() {
    // Check if refresh is enabled in the UI
    const refreshToggle = document.getElementById('refresh-toggle');
    if (refreshToggle && refreshToggle.checked) {
        // Set a refresh interval (e.g., every 5 minutes)
        setInterval(function () {
            location.reload();
        }, 5 * 60 * 1000);
    }
}

// Function to format BTC values
function formatBTC(btcValue) {
    return parseFloat(btcValue).toFixed(8);
}

// Function to format sats with commas
function formatSats(satsValue) {
    return formatCurrency(parseInt(satsValue));
}

// Function to format USD values with commas
function formatUSD(usdValue) {
    return formatCurrency(parseFloat(usdValue).toFixed(2));
}

// Function to apply user timezone formatting to dates
function applyUserTimezoneFormatting() {
    // Store timezone for use by system monitor
    window.dashboardTimezone = userTimezone || 'America/Los_Angeles';

    // This function would format dates according to user timezone preference
    // when dates are dynamically loaded or updated via JavaScript
}

// Function to format a timestamp based on user timezone
function formatDateToUserTimezone(timestamp) {
    const timezone = window.userTimezone || 'America/Los_Angeles';

    return new Date(timestamp).toLocaleString('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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