// Bitcoin Orange theme (default)
const BITCOIN_THEME = {
    PRIMARY: '#f2a900',
    PRIMARY_RGB: '242, 169, 0',
    SHARED: {
        GREEN: '#32CD32',
        RED: '#ff5555',
        YELLOW: '#ffd700'
    },
    CHART: {
        GRADIENT_START: '#f2a900',
        GRADIENT_END: 'rgba(242, 169, 0, 0.2)',
        ANNOTATION: '#ffd700'
    }
};

// DeepSea theme (blue alternative)
const DEEPSEA_THEME = {
    PRIMARY: '#0088cc',
    PRIMARY_RGB: '0, 136, 204',
    SHARED: {
        GREEN: '#32CD32',
        RED: '#ff5555',
        YELLOW: '#ffd700'
    },
    CHART: {
        GRADIENT_START: '#0088cc',
        GRADIENT_END: 'rgba(0, 136, 204, 0.2)',
        ANNOTATION: '#00b3ff'
    }
};

// Global theme constants
const THEME = {
    BITCOIN: BITCOIN_THEME,
    DEEPSEA: DEEPSEA_THEME,
    SHARED: BITCOIN_THEME.SHARED
};

// Function to get the current theme based on localStorage setting
function getCurrentTheme() {
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') === 'true';
    return useDeepSea ? DEEPSEA_THEME : BITCOIN_THEME;
}

// Make globals available
window.THEME = THEME;
window.getCurrentTheme = getCurrentTheme;

// Use window-scoped variable to prevent conflicts
window.themeProcessing = false;

// Fixed applyDeepSeaTheme function with recursion protection
function applyDeepSeaTheme() {
    // Check if we're already applying the theme to prevent recursion
    if (window.themeProcessing) {
        console.log("Theme application already in progress, avoiding recursion");
        return;
    }

    // Set the guard flag
    window.themeProcessing = true;

    try {
        console.log("Applying DeepSea theme...");

        // Create or update CSS variables for the DeepSea theme
        const styleElement = document.createElement('style');
        styleElement.id = 'deepSeaThemeStyles'; // Give it an ID so we can check if it exists

        // Enhanced CSS with your requested changes
        styleElement.textContent = `
            /* Base theme variables */
            :root {
                --primary-color: #0088cc !important;
                --bitcoin-orange: #0088cc !important; 
                --bitcoin-orange-rgb: 0, 136, 204 !important;
                --bg-gradient: linear-gradient(135deg, #0a0a0a, #131b20) !important;
                --accent-color: #00b3ff !important;
                --header-bg: linear-gradient(to right, #0088cc, #005580) !important;
                --card-header-bg: linear-gradient(to right, #0088cc, #006699) !important;
                --progress-bar-color: #0088cc !important;
                --link-color: #0088cc !important;
                --link-hover-color: #00b3ff !important;
            
                /* Standardized text shadow values */
                --blue-text-shadow: 0 0 10px rgba(0, 136, 204, 0.8), 0 0 5px rgba(0, 136, 204, 0.5);
                --yellow-text-shadow: 0 0 10px rgba(255, 215, 0, 0.8), 0 0 5px rgba(255, 215, 0, 0.5);
                --green-text-shadow: 0 0 10px rgba(50, 205, 50, 0.8), 0 0 5px rgba(50, 205, 50, 0.5);
                --red-text-shadow: 0 0 10px rgba(255, 85, 85, 0.8), 0 0 5px rgba(255, 85, 85, 0.5);
                --white-text-shadow: 0 0 10px rgba(255, 255, 255, 0.8), 0 0 5px rgba(255, 255, 255, 0.5);
                --cyan-text-shadow: 0 0 10px rgba(0, 255, 255, 0.8), 0 0 5px rgba(0, 255, 255, 0.5);
            }
        
            /* Blue elements - main theme elements */
            .card-header, .card > .card-header,
            .container-fluid .card > .card-header {
                background: linear-gradient(to right, #0088cc, #006699) !important;
                border-bottom: 1px solid #0088cc !important;
                text-shadow: var(--blue-text-shadow) !important;
                color: #fff !important;
            }
        
            .card {
                border: 1px solid #0088cc !important;
                box-shadow: 0 0 5px rgba(0, 136, 204, 0.3) !important;
            }
        
            /* Navigation and interface elements */
            .nav-link {
                border: 1px solid #0088cc !important;
                color: #0088cc !important;
            }
        
            .nav-link:hover, .nav-link.active {
                background-color: #0088cc !important;
                color: #fff !important;
                box-shadow: 0 0 10px rgba(0, 136, 204, 0.5) !important;
            }
        
            #terminal-cursor {
                background-color: #0088cc !important;
                box-shadow: 0 0 5px rgba(0, 136, 204, 0.8) !important;
            }
        
            #lastUpdated {
                color: #0088cc !important;
            }
        
            /* Chart and progress elements */
            .bitcoin-progress-inner {
                background: linear-gradient(90deg, #0088cc, #00b3ff) !important;
            }
        
            .bitcoin-progress-container {
                border: 1px solid #0088cc !important;
                box-shadow: 0 0 8px rgba(0, 136, 204, 0.5) !important;
            }
        
            h1, .text-center h1 {
                color: #0088cc !important;
                text-shadow: var(--blue-text-shadow) !important;
            }
        
            .nav-badge {
                background-color: #0088cc !important;
            }
            
            /* Theme toggle button styling */
            #themeToggle, 
            button.theme-toggle, 
            .toggle-theme-btn {
                background: transparent !important;
                border: 1px solid #0088cc !important;
                color: #0088cc !important;
                transition: all 0.3s ease !important;
            }

            #themeToggle:hover, 
            button.theme-toggle:hover, 
            .toggle-theme-btn:hover {
                background-color: rgba(0, 136, 204, 0.1) !important;
                box-shadow: 0 0 10px rgba(0, 136, 204, 0.3) !important;
            }
        
            /* ===== COLOR SPECIFIC STYLING ===== */
        
            /* YELLOW - SATOSHI EARNINGS & BTC PRICE */
            /* All Satoshi earnings in yellow with consistent text shadow */
            #daily_mined_sats,
            #monthly_mined_sats,
            #estimated_earnings_per_day_sats,
            #estimated_earnings_next_block_sats,
            #estimated_rewards_in_window_sats,
            #btc_price, /* BTC Price in yellow */
            .card:contains('SATOSHI EARNINGS') span.metric-value {
                color: #ffd700 !important; /* Bitcoin gold/yellow */
                text-shadow: var(--yellow-text-shadow) !important;
            }
        
            /* More specific selectors for Satoshi values */
            span.metric-value[id$="_sats"] {
                color: #ffd700 !important;
                text-shadow: var(--yellow-text-shadow) !important;
            }
        
            /* Retaining original yellow for specific elements */
            .est_time_to_payout:not(.green):not(.red) {
                color: #ffd700 !important;
                text-shadow: var(--yellow-text-shadow) !important;
            }
        
            /* GREEN - POSITIVE USD VALUES */
            /* USD earnings that are positive should be green */
            .metric-value.green,
            span.green,
            #daily_revenue:not([style*="color: #ff"]),
            #monthly_profit_usd:not([style*="color: #ff"]),
            #daily_profit_usd:not([style*="color: #ff"]) {
                color: #32CD32 !important; /* Lime green */
                text-shadow: var(--green-text-shadow) !important;
            }
        
            /* Status indicators remain green */
            .status-green {
                color: #32CD32 !important;
                text-shadow: var(--green-text-shadow) !important;
            }
        
            .online-dot {
                background: #32CD32 !important;
                box-shadow: 0 0 10px #32CD32, 0 0 20px #32CD32 !important;
            }
        
            /* RED - NEGATIVE USD VALUES & WARNINGS */
            /* Red for negative values and warnings */
            .metric-value.red,
            span.red,
            .status-red,
            #daily_power_cost {
                color: #ff5555 !important;
                text-shadow: var(--red-text-shadow) !important;
            }
        
            .offline-dot {
                background: #ff5555 !important;
                box-shadow: 0 0 10px #ff5555, 0 0 20px #ff5555 !important;
            }
        
            /* WHITE - Network stats and worker data */
            #block_number,
            #difficulty,
            #network_hashrate,
            #pool_fees_percentage,
            #workers_hashing,
            #last_share,
            #blocks_found,
            #last_block_height {
                color: #ffffff !important;
                text-shadow: var(--white-text-shadow) !important;
            }
        
            /* CYAN - Time ago in last block */
            #last_block_time {
                color: #00ffff !important; /* Cyan */
                text-shadow: var(--cyan-text-shadow) !important;
            }
        
            /* BLUE - Pool statistics */
            #pool_total_hashrate {
                color: #0088cc !important;
                text-shadow: var(--blue-text-shadow) !important;
            }
        
            /* Hashrate values are white */
            #hashrate_24hr,
            #hashrate_3hr,
            #hashrate_10min,
            #hashrate_60sec {
                color: white !important;
                text-shadow: var(--white-text-shadow) !important;
            }
        
            /* Pool luck/efficiency colors - PRESERVE EXISTING */
            #pool_luck.very-lucky {
                color: #32CD32 !important; /* Very lucky - bright green */
                text-shadow: var(--green-text-shadow) !important;
            }
        
            #pool_luck.lucky {
                color: #90EE90 !important; /* Lucky - light green */
                text-shadow: 0 0 10px rgba(144, 238, 144, 0.8), 0 0 5px rgba(144, 238, 144, 0.5) !important;
            }
        
            #pool_luck.normal-luck {
                color: #F0E68C !important; /* Normal - khaki */
                text-shadow: 0 0 10px rgba(240, 230, 140, 0.8), 0 0 5px rgba(240, 230, 140, 0.5) !important;
            }
        
            #pool_luck.unlucky {
                color: #ff5555 !important; /* Unlucky - red */
                text-shadow: var(--red-text-shadow) !important;
            }
        
            /* Congrats message */
            #congratsMessage {
                background: #0088cc !important;
                box-shadow: 0 0 15px rgba(0, 136, 204, 0.7) !important;
            }
        
            /* Animations */
            @keyframes waitingPulse {
                0%, 100% { box-shadow: 0 0 10px #0088cc, 0 0 15px #0088cc !important; opacity: 0.8; }
                50% { box-shadow: 0 0 20px #0088cc, 0 0 35px #0088cc !important; opacity: 1; }
            }
        
            @keyframes glow {
                0%, 100% { box-shadow: 0 0 10px #0088cc, 0 0 15px #0088cc !important; }
                50% { box-shadow: 0 0 15px #0088cc, 0 0 25px #0088cc !important; }
            }
        `;

        // Check if our style element already exists
        const existingStyle = document.getElementById('deepSeaThemeStyles');
        if (existingStyle) {
            existingStyle.parentNode.removeChild(existingStyle);
        }

        // Add our new style element to the head
        document.head.appendChild(styleElement);

        // Update page title
        document.title = document.title.replace("BTC-OS", "DeepSea");
        document.title = document.title.replace("Bitcoin", "DeepSea");

        // Update header text
        const headerElement = document.querySelector('h1');
        if (headerElement) {
            headerElement.innerHTML = headerElement.innerHTML.replace("BTC-OS", "DeepSea");
            headerElement.innerHTML = headerElement.innerHTML.replace("BITCOIN", "DEEPSEA");
        }

        // Update theme toggle button
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.style.borderColor = '#0088cc';
            themeToggle.style.color = '#0088cc';
        }

        console.log("DeepSea theme applied with color adjustments");
    } finally {
        // Always reset the guard flag when done, even if there's an error
        window.themeProcessing = false;
    }
}

// Make the function accessible globally
window.applyDeepSeaTheme = applyDeepSeaTheme;

// Toggle theme with hard page refresh
function toggleTheme() {
    const useDeepSea = localStorage.getItem('useDeepSeaTheme') !== 'true';

    // Save the new theme preference
    saveThemePreference(useDeepSea);

    // Show a brief loading message to indicate theme change is happening
    const loadingMessage = document.createElement('div');
    loadingMessage.style.position = 'fixed';
    loadingMessage.style.top = '0';
    loadingMessage.style.left = '0';
    loadingMessage.style.width = '100%';
    loadingMessage.style.height = '100%';
    loadingMessage.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    loadingMessage.style.display = 'flex';
    loadingMessage.style.justifyContent = 'center';
    loadingMessage.style.alignItems = 'center';
    loadingMessage.style.zIndex = '9999';
    loadingMessage.style.color = useDeepSea ? '#0088cc' : '#f2a900';
    loadingMessage.style.fontFamily = "'VT323', monospace";
    loadingMessage.style.fontSize = '24px';
    loadingMessage.innerHTML = '<div style="background-color: rgba(0, 0, 0, 0.8); padding: 20px; border-radius: 5px;">APPLYING ' + (useDeepSea ? 'DEEPSEA' : 'BITCOIN') + ' THEME...</div>';
    document.body.appendChild(loadingMessage);

    // Short delay before refreshing to allow the message to be seen
    setTimeout(() => {
        // Hard reload the page
        window.location.reload();
    }, 300);
}

// Set theme preference to localStorage
function saveThemePreference(useDeepSea) {
    try {
        localStorage.setItem('useDeepSeaTheme', useDeepSea);
    } catch (e) {
        console.error("Error saving theme preference:", e);
    }
}

// Check for theme preference in localStorage
function loadThemePreference() {
    try {
        const themePreference = localStorage.getItem('useDeepSeaTheme');
        if (themePreference === 'true') {
            applyDeepSeaTheme();
        } else {
            // Make sure the toggle button is styled correctly for Bitcoin theme
            const themeToggle = document.getElementById('themeToggle');
            if (themeToggle) {
                themeToggle.style.borderColor = '#f2a900';
                themeToggle.style.color = '#f2a900';
            }
        }
    } catch (e) {
        console.error("Error loading theme preference:", e);
    }
}

// Apply theme on page load
document.addEventListener('DOMContentLoaded', loadThemePreference);

// For pages that load content dynamically, also check when the window loads
window.addEventListener('load', loadThemePreference);