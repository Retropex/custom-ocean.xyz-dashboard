"use strict";

// Global variables
let currentStartHeight = null;
const mempoolBaseUrl = "https://mempool.guide"; // Switched from mempool.space to mempool.guide - more aligned with Ocean.xyz ethos
let blocksCache = {};
let isLoading = false;

// DOM ready initialization
$(document).ready(function() {
    console.log("Blocks page initialized");

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

    // Initialize notification badge
    initNotificationBadge();
    
    // Load the latest blocks on page load
    loadLatestBlocks();
    
    // Set up event listeners
    $("#load-blocks").on("click", function() {
        const height = $("#block-height").val();
        if (height && !isNaN(height)) {
            loadBlocksFromHeight(height);
        } else {
            showToast("Please enter a valid block height");
        }
    });
    
    $("#latest-blocks").on("click", loadLatestBlocks);
    
    // Handle Enter key on the block height input
    $("#block-height").on("keypress", function(e) {
        if (e.which === 13) {
            const height = $(this).val();
            if (height && !isNaN(height)) {
                loadBlocksFromHeight(height);
            } else {
                showToast("Please enter a valid block height");
            }
        }
    });
    
    // Close the modal when clicking the X or outside the modal
    $(".block-modal-close").on("click", closeModal);
    $(window).on("click", function(event) {
        if ($(event.target).hasClass("block-modal")) {
            closeModal();
        }
    });
    
    // Initialize BitcoinMinuteRefresh if available
    if (typeof BitcoinMinuteRefresh !== 'undefined' && BitcoinMinuteRefresh.initialize) {
        BitcoinMinuteRefresh.initialize(loadLatestBlocks);
        console.log("BitcoinMinuteRefresh initialized with refresh function");
    }
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

    // Update every 60 seconds
    setInterval(updateNotificationBadge, 60000);
}
// Helper function to format timestamps as readable dates
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: window.dashboardTimezone || 'America/Los_Angeles' // Use global timezone setting
    };
    return date.toLocaleString('en-US', options);
}

// Helper function to format numbers with commas
function numberWithCommas(x) {
    if (x == null) return "N/A";
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Helper function to format file sizes
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    else if (bytes < 1048576) return (bytes / 1024).toFixed(2) + " KB";
    else return (bytes / 1048576).toFixed(2) + " MB";
}

// Helper function to show toast messages
function showToast(message) {
    // Check if we already have a toast container
    let toastContainer = $(".toast-container");
    if (toastContainer.length === 0) {
        // Create a new toast container
        toastContainer = $("<div>", {
            class: "toast-container",
            css: {
                position: "fixed",
                bottom: "20px",
                right: "20px",
                zIndex: 9999
            }
        }).appendTo("body");
    }
    
    // Create a new toast
    const toast = $("<div>", {
        class: "toast",
        text: message,
        css: {
            backgroundColor: "#f7931a",
            color: "#000",
            padding: "10px 15px",
            borderRadius: "5px",
            marginTop: "10px",
            boxShadow: "0 0 10px rgba(247, 147, 26, 0.5)",
            fontFamily: "var(--terminal-font)",
            opacity: 0,
            transition: "opacity 0.3s ease"
        }
    }).appendTo(toastContainer);
    
    // Show the toast
    setTimeout(() => {
        toast.css("opacity", 1);
        
        // Hide and remove the toast after 3 seconds
        setTimeout(() => {
            toast.css("opacity", 0);
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }, 100);
}

// Pool color mapping function - add this after your existing helper functions
function getPoolColor(poolName) {
    // Normalize the pool name (lowercase and remove special characters)
    const normalizedName = poolName.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Define color mappings for common mining pools with Ocean pool featured prominently
    const poolColors = {
        // OCEAN pool with a distinctive bright cyan color for prominence
        'ocean': '#00ffff',                // Bright Cyan for Ocean
        'oceanpool': '#00ffff',            // Bright Cyan for Ocean
        'oceanxyz': '#00ffff',             // Bright Cyan for Ocean
        'ocean.xyz': '#00ffff',            // Bright Cyan for Ocean

        // Other common mining pools with more muted colors
        'f2pool': '#1a9eff',               // Blue
        'antpool': '#ff7e33',              // Orange
        'binancepool': '#f3ba2f',          // Binance gold
        'foundryusa': '#b150e2',           // Purple
        'viabtc': '#ff5c5c',               // Red
        'luxor': '#2bae2b',                // Green
        'slushpool': '#3355ff',            // Bright blue
        'btccom': '#ff3355',               // Pink
        'poolin': '#ffaa22',               // Amber
        'sbicrypto': '#cc9933',            // Bronze
        'mara': '#8844cc',                 // Violet
        'ultimuspool': '#09c7be',          // Teal
        'unknown': '#999999'               // Grey for unknown pools
    };

    // Check for partial matches in pool names (for variations like "F2Pool" vs "F2pool.com")
    for (const [key, color] of Object.entries(poolColors)) {
        if (normalizedName.includes(key)) {
            return color;
        }
    }

    // If no match is found, generate a consistent color based on the pool name
    let hash = 0;
    for (let i = 0; i < poolName.length; i++) {
        hash = poolName.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate HSL color with fixed saturation and lightness for readability
    // Use the hash to vary the hue only (0-360)
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
}

// Function to create a block card
function createBlockCard(block) {
    const timestamp = formatTimestamp(block.timestamp);
    const formattedSize = formatFileSize(block.size);
    const formattedTxCount = numberWithCommas(block.tx_count);

    // Get the pool name or "Unknown"
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";

    // Get pool color
    const poolColor = getPoolColor(poolName);

    // Check if this is an Ocean pool block for special styling
    const isOceanPool = poolName.toLowerCase().includes('ocean');

    // Calculate total fees in BTC
    const totalFees = block.extras ? (block.extras.totalFees / 100000000).toFixed(8) : "N/A";

    // Create the block card
    const blockCard = $("<div>", {
        class: "block-card",
        "data-height": block.height,
        "data-hash": block.id
    });

    // Apply pool color border - with special emphasis for Ocean pool
    if (isOceanPool) {
        // Give Ocean pool blocks a more prominent styling
        blockCard.css({
            "border": `2px solid ${poolColor}`,
            "box-shadow": `0 0 10px ${poolColor}`,
            "background": `linear-gradient(to bottom, rgba(0, 255, 255, 0.1), rgba(0, 0, 0, 0))`
        });
    } else {
        // Standard styling for other pools
        blockCard.css({
            "border-left": `4px solid ${poolColor}`,
            "border-top": `1px solid ${poolColor}30`,
            "border-right": `1px solid ${poolColor}30`,
            "border-bottom": `1px solid ${poolColor}30`
        });
    }

    // Create the block header
    const blockHeader = $("<div>", {
        class: "block-header"
    });

    blockHeader.append($("<div>", {
        class: "block-height",
        text: "#" + block.height
    }));

    blockHeader.append($("<div>", {
        class: "block-time",
        text: timestamp
    }));

    blockCard.append(blockHeader);

    // Create the block info section
    const blockInfo = $("<div>", {
        class: "block-info"
    });

    // Add transaction count with conditional coloring based on count
    const txCountItem = $("<div>", {
        class: "block-info-item"
    });
    txCountItem.append($("<div>", {
        class: "block-info-label",
        text: "Transactions"
    }));

    // Determine transaction count color based on thresholds
    let txCountClass = "green"; // Default for high transaction counts (2000+)
    if (block.tx_count < 500) {
        txCountClass = "red"; // Less than 500 transactions
    } else if (block.tx_count < 2000) {
        txCountClass = "yellow"; // Between 500 and 1999 transactions
    }

    txCountItem.append($("<div>", {
        class: `block-info-value ${txCountClass}`,
        text: formattedTxCount
    }));
    blockInfo.append(txCountItem);

    // Add size
    const sizeItem = $("<div>", {
        class: "block-info-item"
    });
    sizeItem.append($("<div>", {
        class: "block-info-label",
        text: "Size"
    }));
    sizeItem.append($("<div>", {
        class: "block-info-value white",
        text: formattedSize
    }));
    blockInfo.append(sizeItem);

    // Add miner/pool with custom color
    const minerItem = $("<div>", {
        class: "block-info-item"
    });
    minerItem.append($("<div>", {
        class: "block-info-label",
        text: "Miner"
    }));

    // Apply the custom pool color with special styling for Ocean pool
    const minerValue = $("<div>", {
        class: "block-info-value",
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isOceanPool ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isOceanPool ? "bold" : "normal"
        }
    });

    // Add a special indicator icon for Ocean pool
    if (isOceanPool) {
        minerValue.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));
    }

    minerItem.append(minerValue);
    blockInfo.append(minerItem);

    // Add Avg Fee Rate
    const feesItem = $("<div>", {
        class: "block-info-item"
    });
    feesItem.append($("<div>", {
        class: "block-info-label",
        text: "Avg Fee Rate"
    }));
    feesItem.append($("<div>", {
        class: "block-info-value yellow",
        text: block.extras && block.extras.avgFeeRate ? block.extras.avgFeeRate + " sat/vB" : "N/A"
    }));
    blockInfo.append(feesItem);

    blockCard.append(blockInfo);

    // Add event listener for clicking on the block card
    blockCard.on("click", function () {
        showBlockDetails(block);
    });

    return blockCard;
}

// Function to load blocks from a specific height
function loadBlocksFromHeight(height) {
    if (isLoading) return;
    
    // Convert to integer
    height = parseInt(height);
    if (isNaN(height) || height < 0) {
        showToast("Please enter a valid block height");
        return;
    }
    
    isLoading = true;
    currentStartHeight = height;
    
    // Check if we already have this data in cache
    if (blocksCache[height]) {
        displayBlocks(blocksCache[height]);
        isLoading = false;
        return;
    }
    
    // Show loading state
    $("#blocks-grid").html('<div class="loader"><span class="loader-text">Loading blocks from height ' + height + '<span class="terminal-cursor"></span></span></div>');
    
    // Fetch blocks from the API
    $.ajax({
        url: `${mempoolBaseUrl}/api/v1/blocks/${height}`,
        method: "GET",
        dataType: "json",
        timeout: 10000,
        success: function(data) {
            // Cache the data
            blocksCache[height] = data;
            
            // Display the blocks
            displayBlocks(data);
            
            // Update latest block stats
            if (data.length > 0) {
                updateLatestBlockStats(data[0]);
            }
        },
        error: function(xhr, status, error) {
            console.error("Error fetching blocks:", error);
            $("#blocks-grid").html('<div class="error">Error fetching blocks. Please try again later.</div>');
            
            // Show error toast
            showToast("Failed to load blocks. Please try again later.");
        },
        complete: function() {
            isLoading = false;
        }
    });
}

// Function to load the latest blocks and return a promise with the latest block height
function loadLatestBlocks() {
    if (isLoading) return Promise.resolve(null);

    isLoading = true;

    // Show loading state
    $("#blocks-grid").html('<div class="loader"><span class="loader-text">Loading latest blocks<span class="terminal-cursor"></span></span></div>');

    // Fetch the latest blocks from the API
    return $.ajax({
        url: `${mempoolBaseUrl}/api/v1/blocks`,
        method: "GET",
        dataType: "json",
        timeout: 10000,
        success: function (data) {
            // Cache the data (use the first block's height as the key)
            if (data.length > 0) {
                currentStartHeight = data[0].height;
                blocksCache[currentStartHeight] = data;

                // Update the block height input with the latest height
                $("#block-height").val(currentStartHeight);

                // Update latest block stats
                updateLatestBlockStats(data[0]);
            }

            // Display the blocks
            displayBlocks(data);
        },
        error: function (xhr, status, error) {
            console.error("Error fetching latest blocks:", error);
            $("#blocks-grid").html('<div class="error">Error fetching blocks. Please try again later.</div>');

            // Show error toast
            showToast("Failed to load latest blocks. Please try again later.");
        },
        complete: function () {
            isLoading = false;
        }
    }).then(data => data.length > 0 ? data[0].height : null);
}

// Refresh blocks page every 60 seconds if there are new blocks
setInterval(function () {
    console.log("Checking for new blocks at " + new Date().toLocaleTimeString());
    loadLatestBlocks().then(latestHeight => {
        if (latestHeight && latestHeight > currentStartHeight) {
            console.log("New blocks detected, refreshing the page");
            location.reload();
        } else {
            console.log("No new blocks detected");
        }
    });
}, 60000);


// Function to update the latest block stats section
function updateLatestBlockStats(block) {
    if (!block) return;

    $("#latest-height").text(block.height);
    $("#latest-time").text(formatTimestamp(block.timestamp));
    $("#latest-tx-count").text(numberWithCommas(block.tx_count));
    $("#latest-size").text(formatFileSize(block.size));
    $("#latest-difficulty").text(numberWithCommas(Math.round(block.difficulty)));

    // Pool info with color coding
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";
    const poolColor = getPoolColor(poolName);
    const isOceanPool = poolName.toLowerCase().includes('ocean');

    // Clear previous content of the pool span
    const poolSpan = $("#latest-pool");
    poolSpan.empty();

    // Create the pool name element with styling
    const poolElement = $("<span>", {
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isOceanPool ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isOceanPool ? "bold" : "normal"
        }
    });

    // Add star icon for Ocean pool
    if (isOceanPool) {
        poolElement.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));
    }

    // Add the styled element to the DOM
    poolSpan.append(poolElement);

    // If this is the latest block from Ocean pool, add a subtle highlight to the stats card
    const statsCard = $(".latest-block-stats").closest(".card");
    if (isOceanPool) {
        statsCard.css({
            "border": `2px solid ${poolColor}`,
            "box-shadow": `0 0 10px ${poolColor}`,
            "background": `linear-gradient(to bottom, rgba(0, 255, 255, 0.05), rgba(0, 0, 0, 0))`
        });
    } else {
        // Reset to default styling if not Ocean pool
        statsCard.css({
            "border": "",
            "box-shadow": "",
            "background": ""
        });
    }

    // Average Fee Rate
    if (block.extras && block.extras.avgFeeRate) {
        $("#latest-fee-rate").text(block.extras.avgFeeRate + " sat/vB");
    } else {
        $("#latest-fee-rate").text("N/A");
    }
}

// Function to display the blocks in the grid
function displayBlocks(blocks) {
    const blocksGrid = $("#blocks-grid");
    
    // Clear the grid
    blocksGrid.empty();
    
    if (!blocks || blocks.length === 0) {
        blocksGrid.html('<div class="no-blocks">No blocks found</div>');
        return;
    }
    
    // Create a card for each block
    blocks.forEach(function(block) {
        const blockCard = createBlockCard(block);
        blocksGrid.append(blockCard);
    });
    
    // Add navigation controls if needed
    addNavigationControls(blocks);
}

// Function to add navigation controls to the blocks grid
function addNavigationControls(blocks) {
    // Get the height of the first and last block in the current view
    const firstBlockHeight = blocks[0].height;
    const lastBlockHeight = blocks[blocks.length - 1].height;
    
    // Create navigation controls
    const navControls = $("<div>", {
        class: "block-navigation"
    });
    
    // Newer blocks button (if not already at the latest blocks)
    if (firstBlockHeight !== currentStartHeight) {
        const newerButton = $("<button>", {
            class: "block-button",
            text: "Newer Blocks"
        });
        
        newerButton.on("click", function() {
            loadBlocksFromHeight(firstBlockHeight + 15);
        });
        
        navControls.append(newerButton);
    }
    
    // Older blocks button
    const olderButton = $("<button>", {
        class: "block-button",
        text: "Older Blocks"
    });
    
    olderButton.on("click", function() {
        loadBlocksFromHeight(lastBlockHeight - 1);
    });
    
    navControls.append(olderButton);
    
    // Add the navigation controls to the blocks grid
    $("#blocks-grid").append(navControls);
}

// Function to show block details in a modal
function showBlockDetails(block) {
    const modal = $("#block-modal");
    const blockDetails = $("#block-details");

    // Clear the details
    blockDetails.empty();

    // Format the timestamp
    const timestamp = formatTimestamp(block.timestamp);

    // Create the block header section
    const headerSection = $("<div>", {
        class: "block-detail-section"
    });

    headerSection.append($("<div>", {
        class: "block-detail-title",
        text: "Block #" + block.height
    }));

    // Add block hash
    const hashItem = $("<div>", {
        class: "block-detail-item"
    });
    hashItem.append($("<div>", {
        class: "block-detail-label",
        text: "Block Hash"
    }));
    hashItem.append($("<div>", {
        class: "block-hash",
        text: block.id
    }));
    headerSection.append(hashItem);

    // Add mempool.guide link
    const linkItem = $("<div>", {
        class: "block-detail-item"
    });
    linkItem.append($("<div>", {
        class: "block-detail-label",
        text: "Explorer Link"
    }));

    const mempoolLink = $("<a>", {
        href: `${mempoolBaseUrl}/block/${block.id}`,
        target: "_blank",
        class: "mempool-link",
        text: "View on mempool.guide",
        css: {
            color: "#f7931a",
            textDecoration: "none"
        }
    });

    // Add icon or indicator that it's an external link
    mempoolLink.append($("<span>", {
        html: " ↗",
        css: {
            fontSize: "14px"
        }
    }));

    const linkContainer = $("<div>", {
        class: "block-detail-value"
    });
    linkContainer.append(mempoolLink);
    linkItem.append(linkContainer);

    headerSection.append(linkItem);

    // Add timestamp
    const timeItem = $("<div>", {
        class: "block-detail-item"
    });
    timeItem.append($("<div>", {
        class: "block-detail-label",
        text: "Timestamp"
    }));
    timeItem.append($("<div>", {
        class: "block-detail-value",
        text: timestamp
    }));
    headerSection.append(timeItem);

    // Add merkle root
    const merkleItem = $("<div>", {
        class: "block-detail-item"
    });
    merkleItem.append($("<div>", {
        class: "block-detail-label",
        text: "Merkle Root"
    }));
    merkleItem.append($("<div>", {
        class: "block-hash",
        text: block.merkle_root
    }));
    headerSection.append(merkleItem);

    // Add previous block hash
    const prevHashItem = $("<div>", {
        class: "block-detail-item"
    });
    prevHashItem.append($("<div>", {
        class: "block-detail-label",
        text: "Previous Block"
    }));
    prevHashItem.append($("<div>", {
        class: "block-hash",
        text: block.previousblockhash
    }));
    headerSection.append(prevHashItem);

    blockDetails.append(headerSection);

    // Create the mining section
    const miningSection = $("<div>", {
        class: "block-detail-section"
    });

    miningSection.append($("<div>", {
        class: "block-detail-title",
        text: "Mining Details"
    }));

    // Add miner/pool with matching color
    const minerItem = $("<div>", {
        class: "block-detail-item"
    });
    minerItem.append($("<div>", {
        class: "block-detail-label",
        text: "Miner"
    }));
    const poolName = block.extras && block.extras.pool ? block.extras.pool.name : "Unknown";
    const poolColor = getPoolColor(poolName);
    const isOceanPool = poolName.toLowerCase().includes('ocean');

    // Apply special styling for Ocean pool in the modal
    const minerValue = $("<div>", {
        class: "block-detail-value",
        text: poolName,
        css: {
            color: poolColor,
            textShadow: isOceanPool ? `0 0 8px ${poolColor}` : `0 0 6px ${poolColor}80`,
            fontWeight: isOceanPool ? "bold" : "normal"
        }
    });

    // Add a special indicator icon for Ocean pool
    if (isOceanPool) {
        minerValue.prepend($("<span>", {
            html: "★ ",
            css: { color: poolColor }
        }));

        // Add a note for Ocean pool
        minerValue.append($("<div>", {
            text: "(Your Mining Pool)",
            css: {
                fontSize: "0.8em",
                marginTop: "3px",
                color: "#ffffffbb"
            }
        }));
    }

    minerItem.append(minerValue);
    miningSection.append(minerItem);

    // Rest of the function remains unchanged
    // Add difficulty
    const difficultyItem = $("<div>", {
        class: "block-detail-item"
    });
    difficultyItem.append($("<div>", {
        class: "block-detail-label",
        text: "Difficulty"
    }));
    difficultyItem.append($("<div>", {
        class: "block-detail-value",
        text: numberWithCommas(Math.round(block.difficulty))
    }));
    miningSection.append(difficultyItem);

    // Add nonce
    const nonceItem = $("<div>", {
        class: "block-detail-item"
    });
    nonceItem.append($("<div>", {
        class: "block-detail-label",
        text: "Nonce"
    }));
    nonceItem.append($("<div>", {
        class: "block-detail-value",
        text: numberWithCommas(block.nonce)
    }));
    miningSection.append(nonceItem);

    // Add bits
    const bitsItem = $("<div>", {
        class: "block-detail-item"
    });
    bitsItem.append($("<div>", {
        class: "block-detail-label",
        text: "Bits"
    }));
    bitsItem.append($("<div>", {
        class: "block-detail-value",
        text: block.bits
    }));
    miningSection.append(bitsItem);

    // Add version
    const versionItem = $("<div>", {
        class: "block-detail-item"
    });
    versionItem.append($("<div>", {
        class: "block-detail-label",
        text: "Version"
    }));
    versionItem.append($("<div>", {
        class: "block-detail-value",
        text: "0x" + block.version.toString(16)
    }));
    miningSection.append(versionItem);

    blockDetails.append(miningSection);

    // Create the transaction section
    const txSection = $("<div>", {
        class: "block-detail-section"
    });

    txSection.append($("<div>", {
        class: "block-detail-title",
        text: "Transaction Details"
    }));

    // Add transaction count
    const txCountItem = $("<div>", {
        class: "block-detail-item"
    });
    txCountItem.append($("<div>", {
        class: "block-detail-label",
        text: "Transaction Count"
    }));
    txCountItem.append($("<div>", {
        class: "block-detail-value",
        text: numberWithCommas(block.tx_count)
    }));
    txSection.append(txCountItem);

    // Add size
    const sizeItem = $("<div>", {
        class: "block-detail-item"
    });
    sizeItem.append($("<div>", {
        class: "block-detail-label",
        text: "Size"
    }));
    sizeItem.append($("<div>", {
        class: "block-detail-value",
        text: formatFileSize(block.size)
    }));
    txSection.append(sizeItem);

    // Add weight
    const weightItem = $("<div>", {
        class: "block-detail-item"
    });
    weightItem.append($("<div>", {
        class: "block-detail-label",
        text: "Weight"
    }));
    weightItem.append($("<div>", {
        class: "block-detail-value",
        text: numberWithCommas(block.weight) + " WU"
    }));
    txSection.append(weightItem);

    blockDetails.append(txSection);

    // Create the fee section if available
    if (block.extras) {
        const feeSection = $("<div>", {
            class: "block-detail-section"
        });

        feeSection.append($("<div>", {
            class: "block-detail-title",
            text: "Fee Details"
        }));

        // Add total fees
        const totalFeesItem = $("<div>", {
            class: "block-detail-item"
        });
        totalFeesItem.append($("<div>", {
            class: "block-detail-label",
            text: "Total Fees"
        }));
        const totalFees = (block.extras.totalFees / 100000000).toFixed(8);
        totalFeesItem.append($("<div>", {
            class: "block-detail-value",
            text: totalFees + " BTC"
        }));
        feeSection.append(totalFeesItem);

        // Add reward
        const rewardItem = $("<div>", {
            class: "block-detail-item"
        });
        rewardItem.append($("<div>", {
            class: "block-detail-label",
            text: "Block Reward"
        }));
        const reward = (block.extras.reward / 100000000).toFixed(8);
        rewardItem.append($("<div>", {
            class: "block-detail-value",
            text: reward + " BTC"
        }));
        feeSection.append(rewardItem);

        // Add median fee
        const medianFeeItem = $("<div>", {
            class: "block-detail-item"
        });
        medianFeeItem.append($("<div>", {
            class: "block-detail-label",
            text: "Median Fee Rate"
        }));
        medianFeeItem.append($("<div>", {
            class: "block-detail-value",
            text: block.extras.medianFee + " sat/vB"
        }));
        feeSection.append(medianFeeItem);

        // Add average fee
        const avgFeeItem = $("<div>", {
            class: "block-detail-item"
        });
        avgFeeItem.append($("<div>", {
            class: "block-detail-label",
            text: "Average Fee"
        }));
        avgFeeItem.append($("<div>", {
            class: "block-detail-value",
            text: numberWithCommas(block.extras.avgFee) + " sat"
        }));
        feeSection.append(avgFeeItem);

        // Add average fee rate
        const avgFeeRateItem = $("<div>", {
            class: "block-detail-item"
        });
        avgFeeRateItem.append($("<div>", {
            class: "block-detail-label",
            text: "Average Fee Rate"
        }));
        avgFeeRateItem.append($("<div>", {
            class: "block-detail-value",
            text: block.extras.avgFeeRate + " sat/vB"
        }));
        feeSection.append(avgFeeRateItem);

        // Add fee range with visual representation
        if (block.extras.feeRange && block.extras.feeRange.length > 0) {
            const feeRangeItem = $("<div>", {
                class: "block-detail-item transaction-data"
            });

            feeRangeItem.append($("<div>", {
                class: "block-detail-label",
                text: "Fee Rate Percentiles (sat/vB)"
            }));

            const feeRangeText = $("<div>", {
                class: "block-detail-value",
                text: block.extras.feeRange.join(", ")
            });

            feeRangeItem.append(feeRangeText);

            // Add visual fee bar
            const feeBarContainer = $("<div>", {
                class: "fee-bar-container"
            });

            const feeBar = $("<div>", {
                class: "fee-bar"
            });

            feeBarContainer.append(feeBar);
            feeRangeItem.append(feeBarContainer);

            // Animate the fee bar
            setTimeout(() => {
                feeBar.css("width", "100%");
            }, 100);

            feeSection.append(feeRangeItem);
        }

        blockDetails.append(feeSection);
    }

    // Show the modal
    modal.css("display", "block");
}

// Function to close the modal
function closeModal() {
    $("#block-modal").css("display", "none");
}
