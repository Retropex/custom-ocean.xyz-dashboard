// Bitcoin Block Mining Animation Controller
class BlockMiningAnimation {
    constructor(svgContainerId) {
        // Get the container element
        this.container = document.getElementById(svgContainerId);
        if (!this.container) {
            console.error("SVG container not found:", svgContainerId);
            return;
        }

        // Get SVG elements
        this.blockHeight = document.getElementById("block-height");
        this.statusHeight = document.getElementById("status-height");
        this.miningPool = document.getElementById("mining-pool");
        this.blockTime = document.getElementById("block-time");
        this.transactionCount = document.getElementById("transaction-count");
        this.miningHash = document.getElementById("mining-hash");
        this.nonceValue = document.getElementById("nonce-value");
        this.difficultyValue = document.getElementById("difficulty-value");
        this.miningStatus = document.getElementById("mining-status");

        // Debug element availability
        console.log("Animation elements found:", {
            blockHeight: !!this.blockHeight,
            statusHeight: !!this.statusHeight,
            miningPool: !!this.miningPool,
            blockTime: !!this.blockTime,
            transactionCount: !!this.transactionCount,
            miningHash: !!this.miningHash,
            nonceValue: !!this.nonceValue,
            difficultyValue: !!this.difficultyValue,
            miningStatus: !!this.miningStatus
        });

        // Animation state
        this.animationPhase = "collecting"; // collecting, mining, found, adding
        this.miningSpeed = 300; // ms between nonce updates
        this.nonceCounter = 0;
        this.currentBlockData = null;
        this.animationInterval = null;
        this.apiRetryCount = 0;
        this.maxApiRetries = 3;

        // Initialize random hash for mining animation
        this.updateRandomHash();
    }

    // Start the animation loop
    start() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
        }

        console.log("Starting block mining animation");
        this.animationInterval = setInterval(() => this.animationTick(), this.miningSpeed);

        // Start by fetching the latest block
        this.fetchLatestBlockWithRetry();
    }

    // Stop the animation
    stop() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    }

    // Main animation tick function
    animationTick() {
        switch (this.animationPhase) {
            case "collecting":
                // Simulate collecting transactions
                this.updateTransactionAnimation();
                break;

            case "mining":
                // Update nonce and hash values
                this.updateMiningAnimation();
                break;

            case "found":
                // Block found phase - brief celebration
                this.updateFoundAnimation();
                break;

            case "adding":
                // Adding block to chain
                this.updateAddingAnimation();
                break;
        }
    }

    // Fetch latest block with retry logic
    fetchLatestBlockWithRetry() {
        this.apiRetryCount = 0;
        this.fetchLatestBlock();
    }

    // Fetch the latest block data from mempool.space
    fetchLatestBlock() {
        console.log("Fetching latest block data, attempt #" + (this.apiRetryCount + 1));

        // Show that we're fetching
        if (this.miningStatus) {
            this.miningStatus.textContent = "Connecting to blockchain...";
        }

        // Use the mempool.space public API
        fetch("https://mempool.space/api/v1/blocks/tip/height")
            .then(response => {
                if (!response.ok) {
                    throw new Error("Failed to fetch latest block height: " + response.status);
                }
                return response.json();
            })
            .then(height => {
                console.log("Latest block height:", height);
                // Fetch multiple blocks but limit to 1
                return fetch(`https://mempool.space/api/v1/blocks?height=${height}&limit=1`);
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error("Failed to fetch block data: " + response.status);
                }
                return response.json();
            })
            .then(blockData => {
                console.log("Block data received:", blockData);

                // Ensure we have data and use the first block
                if (blockData && blockData.length > 0) {
                    this.currentBlockData = blockData[0];
                    this.startBlockAnimation();

                    // Reset retry count on success
                    this.apiRetryCount = 0;
                } else {
                    throw new Error("No block data received");
                }
            })
            .catch(error => {
                console.error("Error fetching block data:", error);

                // Retry logic
                this.apiRetryCount++;
                if (this.apiRetryCount < this.maxApiRetries) {
                    console.log(`Retrying in 2 seconds... (attempt ${this.apiRetryCount + 1}/${this.maxApiRetries})`);
                    setTimeout(() => this.fetchLatestBlock(), 2000);
                } else {
                    console.warn("Max retries reached, using placeholder data");
                    // Use placeholder data if fetch fails after retries
                    this.usePlaceholderData();
                    this.startBlockAnimation();
                }
            });
    }

    // Start the block animation sequence
    startBlockAnimation() {
        // Reset animation state
        this.animationPhase = "collecting";
        this.nonceCounter = 0;

        // Update block data display immediately
        this.updateBlockDisplay();

        // Schedule the animation sequence
        setTimeout(() => {
            this.animationPhase = "mining";
            if (this.miningStatus) {
                this.miningStatus.textContent = "Mining in progress...";
            }

            // After a random mining period, find the block
            setTimeout(() => {
                this.animationPhase = "found";
                if (this.miningStatus) {
                    this.miningStatus.textContent = "BLOCK FOUND!";
                }

                // Then move to adding phase
                setTimeout(() => {
                    this.animationPhase = "adding";
                    if (this.miningStatus) {
                        this.miningStatus.textContent = "Adding to blockchain...";
                    }

                    // After adding, fetch a new block or loop with current one
                    setTimeout(() => {
                        // Fetch a new block every time to keep data current
                        this.fetchLatestBlockWithRetry();
                    }, 3000);
                }, 2000);
            }, 5000 + Math.random() * 5000); // Random mining time
        }, 3000); // Time for collecting transactions
    }

    // Update block display with current block data
    updateBlockDisplay() {
        if (!this.currentBlockData) {
            console.error("No block data available to display");
            return;
        }

        // Safely extract and format block data
        const blockData = Array.isArray(this.currentBlockData)
            ? this.currentBlockData[0]
            : this.currentBlockData;

        console.log("Updating block display with data:", blockData);

        try {
            // Safely extract and format block height
            const height = blockData.height ? blockData.height.toString() : "N/A";
            if (this.blockHeight) this.blockHeight.textContent = height;
            if (this.statusHeight) this.statusHeight.textContent = height;

            // Safely format block timestamp
            let formattedTime = "N/A";
            if (blockData.timestamp) {
                const timestamp = new Date(blockData.timestamp * 1000);
                formattedTime = timestamp.toLocaleString();
            }
            if (this.blockTime) this.blockTime.textContent = formattedTime;

            // Safely format transaction count
            const txCount = blockData.tx_count ? blockData.tx_count.toString() : "N/A";
            if (this.transactionCount) this.transactionCount.textContent = txCount;

            // Format mining pool 
            let poolName = "Unknown";
            if (blockData.extras && blockData.extras.pool && blockData.extras.pool.name) {
                poolName = blockData.extras.pool.name;
            }
            if (this.miningPool) this.miningPool.textContent = poolName;

            // Format difficulty (simplified)
            let difficultyStr = "Unknown";
            if (blockData.difficulty) {
                // Format as scientific notation for better display
                difficultyStr = blockData.difficulty.toExponential(2);
            }
            if (this.difficultyValue) this.difficultyValue.textContent = difficultyStr;

            // Use actual nonce if available
            if (this.nonceValue && blockData.nonce) {
                this.nonceValue.textContent = blockData.nonce.toString();
                // Use this as starting point for animation
                this.nonceCounter = blockData.nonce;
            }

            // Update block hash (if available)
            if (this.miningHash && blockData.id) {
                const blockHash = blockData.id;
                const shortHash = blockHash.substring(0, 8) + "..." + blockHash.substring(blockHash.length - 8);
                this.miningHash.textContent = shortHash;
            }

            console.log("Block display updated successfully");
        } catch (error) {
            console.error("Error updating block display:", error, "Block data:", blockData);
        }
    }

    // Transaction collection animation
    updateTransactionAnimation() {
        // Animation for collecting transactions is handled by SVG animation
        // We could add additional logic here if needed
    }

    // Mining animation - update nonce and hash
    updateMiningAnimation() {
        // Increment nonce
        this.nonceCounter += 1 + Math.floor(Math.random() * 1000);
        if (this.nonceValue) {
            this.nonceValue.textContent = this.nonceCounter.toString().padStart(10, '0');
        }

        // Update hash value
        this.updateRandomHash();
    }

    // Block found animation - show a hash that matches difficulty
    updateFoundAnimation() {
        if (!this.miningHash || !this.nonceValue || !this.currentBlockData) return;

        try {
            // Make the "found" hash start with enough zeros based on difficulty
            // Use actual block hash if available
            const blockData = Array.isArray(this.currentBlockData)
                ? this.currentBlockData[0]
                : this.currentBlockData;

            if (blockData.id) {
                const blockHash = blockData.id;
                const shortHash = blockHash.substring(0, 8) + "..." + blockHash.substring(blockHash.length - 8);
                this.miningHash.textContent = shortHash;
            } else {
                // Fallback to generated hash
                const zeros = Math.min(6, Math.max(2, Math.floor(Math.log10(blockData.difficulty) / 10)));
                const zeroPrefix = '0'.repeat(zeros);
                const remainingChars = '0123456789abcdef';
                let hash = zeroPrefix;

                // Fill the rest with random hex characters
                for (let i = zeros; i < 8; i++) {
                    hash += remainingChars.charAt(Math.floor(Math.random() * remainingChars.length));
                }

                this.miningHash.textContent = hash + "..." + hash;
            }

            // Use the actual nonce if available
            if (blockData.nonce) {
                this.nonceValue.textContent = blockData.nonce.toString();
            }
        } catch (error) {
            console.error("Error updating found animation:", error);
        }
    }

    // Adding block to chain animation
    updateAddingAnimation() {
        // Animation for adding to blockchain is handled by SVG animation
        // We could add additional logic here if needed
    }

    // Generate a random hash string for mining animation
    updateRandomHash() {
        if (!this.miningHash) return;

        const characters = '0123456789abcdef';
        let hash = '';

        // Generate random 8-char segment
        for (let i = 0; i < 8; i++) {
            hash += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        this.miningHash.textContent = hash + "..." + hash;
    }

    // Use placeholder data if API fetch fails
    usePlaceholderData() {
        const now = Math.floor(Date.now() / 1000);
        this.currentBlockData = {
            height: 888888,
            timestamp: now,
            tx_count: 2500,
            difficulty: 50000000000000,
            nonce: 123456789,
            id: "00000000000000000000b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7",
            extras: {
                pool: {
                    name: "Placeholder Pool"
                }
            }
        };
        console.log("Using placeholder data:", this.currentBlockData);
    }
}

// Initialize and start the animation when the page loads
document.addEventListener("DOMContentLoaded", function () {
    console.log("DOM content loaded, initializing animation");

    // Ensure we give the SVG enough time to be fully rendered and accessible
    setTimeout(() => {
        const svgContainer = document.getElementById("svg-container");
        if (!svgContainer) {
            console.error("SVG container not found in DOM");
            return;
        }

        try {
            const animation = new BlockMiningAnimation("svg-container");
            animation.start();
            console.log("Animation started successfully");
        } catch (error) {
            console.error("Error starting animation:", error);
        }
    }, 1500); // Increased delay to ensure SVG is fully loaded
});