(function() {
    // Initialize DEBUG flag from localStorage or default to false
    const stored = localStorage.getItem('debugLogging');
    window.DEBUG = stored === 'true';

    const originalLog = console.log.bind(console);
    console.log = function(...args) {
        if (window.DEBUG) {
            originalLog(...args);
        }
    };
})();
