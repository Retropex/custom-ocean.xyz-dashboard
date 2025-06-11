(function () {
    "use strict";

    // Module-level variables for cleanup tracking
    let matrixIntervalId = null;
    let resizeHandler = null;
    let isRunning = false;

    function initMatrixRain() {
        // Prevent multiple instances
        if (isRunning) {
            return;
        }

        // Ensure cleanup if we're re-initializing
        if (document.getElementById('matrixRain')) {
            cleanupMatrixRain();
        }

        isRunning = true;

        // CONSTANTS - extracted for better maintainability and performance
        const COLUMN_WIDTH = 20;
        const FADE_OPACITY = 0.15;
        const MATRIX_COLOR = '#39ff14';
        const WORD_CHANCE = 0.0005;
        const ROTATION_CHANCE = 0.1;
        const ROTATION_MAX = Math.PI / 3;
        const RESET_CHANCE = 0.975;
        const FRAME_INTERVAL = 50;

        const canvas = document.createElement('canvas');
        canvas.id = 'matrixRain';
        canvas.className = 'matrix-rain';
        // Insert the canvas as the first element so it stays behind
        document.body.insertBefore(canvas, document.body.firstChild);

        const ctx = canvas.getContext('2d');
        let width, height, columns, drops;
        let word_cycle_index = 0;

        function resize() {
            const prev_columns = columns || 0;
            width = window.innerWidth;
            height = window.innerHeight;

            const new_columns = Math.floor(width / COLUMN_WIDTH);

            // Prevent canvas from consuming excessive memory by capping size
            const maxCanvasSize = 16384; // Most browsers limit canvas dimensions
            canvas.width = Math.min(width, maxCanvasSize);
            canvas.height = Math.min(height, maxCanvasSize);

            if (!drops) {
                drops = Array.from({ length: new_columns }, () => ({ y: 0, word: null, index: 0 }));
            } else {
                if (new_columns > prev_columns) {
                    for (let i = prev_columns; i < new_columns; i++) {
                        drops[i] = { y: Math.floor(Math.random() * (height / COLUMN_WIDTH)), word: null, index: 0 };
                    }
                } else if (new_columns < prev_columns) {
                    drops.length = new_columns;
                }
            }

            columns = new_columns;
        }

        const charSet =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()[]{}<>?/|~' +
            'ΩβπΣΔΘΛΞΦΨαβγδεζηθικλμνξοπρστυφχψω' +
            'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ';

        const words = ['BITCOIN', 'MATRIX', 'OCEAN'];
        const fonts = [
            '16px "Courier New", monospace',
            '16px "Consolas", monospace',
            '16px "MS Gothic", monospace',
            '16px "Noto Sans JP", monospace'
        ];

        // Pre-compute font array indices for better performance
        const fontIndices = Array(fonts.length).fill().map((_, i) => i);

        function getRandomFontIndex() {
            return fontIndices[Math.floor(Math.random() * fontIndices.length)];
        }

        function getRandomChar() {
            return charSet[Math.floor(Math.random() * charSet.length)];
        }

        function nextWord() {
            const word = words[word_cycle_index];
            word_cycle_index = (word_cycle_index + 1) % words.length;
            return word;
        }

        function draw() {
            // Skip drawing if canvas no longer exists (helps prevent errors during cleanup)
            if (!document.getElementById('matrixRain') || !isRunning) {
                return;
            }

            ctx.fillStyle = `rgba(0, 0, 0, ${FADE_OPACITY})`;
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = MATRIX_COLOR;

            // Process drops in smaller batches if there are many to prevent long frames
            const batchSize = 200;
            const totalDrops = drops.length;

            for (let i = 0; i < totalDrops; i++) {
                const drop = drops[i];
                let char;

                // Character selection logic
                if (drop.word) {
                    char = drop.word[drop.index];
                    drop.index += 1;
                    if (drop.index >= drop.word.length) {
                        drop.word = null;
                        drop.index = 0;
                    }
                } else if (Math.random() < WORD_CHANCE) {
                    drop.word = nextWord();
                    char = drop.word[0];
                    drop.index = 1;
                } else {
                    char = getRandomChar();
                }

                // Use font index caching for better performance
                ctx.font = fonts[getRandomFontIndex()];

                // Optimize matrix transformations
                ctx.save();
                ctx.translate(i * COLUMN_WIDTH, drop.y * COLUMN_WIDTH);

                // Only rotate a small percentage of characters
                if (Math.random() < ROTATION_CHANCE) {
                    ctx.rotate((Math.random() - 0.5) * ROTATION_MAX);
                }

                ctx.fillText(char, 0, 0);
                ctx.restore();

                // Reset logic for drops that go off screen
                if (drop.y * COLUMN_WIDTH > height && Math.random() > RESET_CHANCE) {
                    drop.y = 0;
                }
                drop.y += 1;
            }
        }

        // Initialize
        resize();

        // Store resize handler with proper binding
        resizeHandler = resize;
        window.addEventListener('resize', resizeHandler);

        // Use requestAnimationFrame with throttling for smoother animation
        let lastFrameTime = 0;

        function animationLoop(timestamp) {
            if (!isRunning) return;

            if (!lastFrameTime) lastFrameTime = timestamp;
            const elapsed = timestamp - lastFrameTime;

            if (elapsed > FRAME_INTERVAL) {
                lastFrameTime = timestamp;
                draw();
            }

            matrixIntervalId = requestAnimationFrame(animationLoop);
        }

        // Start animation loop using requestAnimationFrame instead of setInterval
        matrixIntervalId = requestAnimationFrame(animationLoop);
    }

    function cleanupMatrixRain() {
        // Set running flag to false first to prevent new frames
        isRunning = false;

        // Cancel animation frame instead of clearing interval
        if (matrixIntervalId) {
            cancelAnimationFrame(matrixIntervalId);
            matrixIntervalId = null;
        }

        // Remove event listener to prevent memory leaks
        if (resizeHandler) {
            window.removeEventListener('resize', resizeHandler);
            resizeHandler = null;
        }

        // Remove canvas element
        const canvas = document.getElementById('matrixRain');
        if (canvas) {
            canvas.remove();
        }

        // Force garbage collection hint (not guaranteed to work)
        if (window.gc) {
            window.gc();
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (localStorage.getItem('useMatrixTheme') === 'true') {
            initMatrixRain();
        }
    });

    // Explicitly clean up on page unload to prevent memory leaks
    window.addEventListener('beforeunload', function () {
        cleanupMatrixRain();
    });

    window.initMatrixRain = initMatrixRain;
    window.cleanupMatrixRain = cleanupMatrixRain;
})();
