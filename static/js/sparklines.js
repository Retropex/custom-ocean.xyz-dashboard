'use strict';

/**
 * SparklineModule - renders tiny line charts inline with metrics.
 */
(function () {
    const charts = {};
    let lastTheme = null;

    function ensureCanvas(id) {
        let canvas = document.getElementById(id);
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = id;
            canvas.className = 'sparkline';
            canvas.width = 60;
            canvas.height = 16;
        }
        return canvas;
    }

    /**
     * Initialize sparkline canvases and ensure metrics are structured
     * consistently so the charts appear inline with the metric value.
     */
    function initSparklines() {
        // Metrics under the Payout Info section don't require sparklines
        const skipKeys = new Set([
            'workers_hashing',
            'unpaid_earnings',
            'pool_fees_percentage',
            'last_block',
            'est_time_to_payout',
            'daily_mined_sats',
            'monthly_mined_sats',
            'estimated_earnings_per_day_sats',
            'estimated_earnings_next_block_sats',
            'estimated_rewards_in_window_sats',
            'daily_power_cost',
            'daily_profit_usd',
            'monthly_profit_usd',
            'difficulty',
            'block_number',
            'hashrate_3hr',
            'hashrate_10min',
            'hashrate_60sec'
        ]);

        document.querySelectorAll('[id^="indicator_"]').forEach(indicator => {
            const key = indicator.id.replace('indicator_', '');
            if (skipKeys.has(key)) {
                return; // skip sparklines for specified metrics
            }

            const canvas = ensureCanvas(`sparkline_${key}`);

            // Ensure a container span so the metric, indicator and chart
            // share the same grid cell regardless of divider usage
            let mainMetric = indicator.closest('.main-metric');
            if (!mainMetric) {
                const metricEl = document.getElementById(key);
                if (metricEl && metricEl.parentNode === indicator.parentNode) {
                    mainMetric = document.createElement('span');
                    mainMetric.className = 'main-metric';
                    metricEl.parentNode.insertBefore(mainMetric, metricEl);
                    mainMetric.appendChild(metricEl);
                    mainMetric.appendChild(indicator);
                }
            }

            const container = mainMetric || indicator.parentNode;
            if (!canvas.parentNode || canvas.parentNode !== container) {
                container.appendChild(canvas);
            }
        });
    }

    function updateSparklines(data) {
        if (!window.Chart || !data.arrow_history) {
            return;
        }
        const theme = window.getCurrentTheme ? window.getCurrentTheme() : { PRIMARY: '#0088cc' };
        if (lastTheme !== theme) {
            lastTheme = theme;
        }

        Object.entries(data.arrow_history).forEach(([key, list]) => {
            const canvasId = `sparkline_${key}`;
            const canvas = document.getElementById(canvasId);
            if (!canvas) {
                const existing = charts[canvasId];
                if (existing) {
                    existing.destroy();
                    delete charts[canvasId];
                }
                return;
            }

            const values = list.map(v => parseFloat(v.value)).filter(v => !isNaN(v));
            if (values.length === 0) {
                return;
            }

            let chart = charts[canvasId];
            const labels = values.map((_, i) => i);

            if (chart && !document.contains(canvas)) {
                chart.destroy();
                delete charts[canvasId];
                chart = null;
            }

            if (!chart) {
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
                gradient.addColorStop(0, theme.PRIMARY + '80'); // 50% opacity at start
                gradient.addColorStop(1, theme.PRIMARY); // Full opacity at end

                chart = new Chart(ctx, {
                    type: 'line',
                    data: { labels: labels, datasets: [{
                        data: values,
                        borderColor: gradient,
                        borderWidth: 1,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false
                    }] },
                    options: {
                        responsive: false,
                        animation: false,
                        scales: { x: { display: false }, y: { display: false } },
                        plugins: {
                            legend: { display: false },
                            tooltip: { enabled: false }
                        },
                        elements: {
                            point: {
                                radius: 0,
                                hitRadius: 0,
                                hoverRadius: 0
                            }
                        }
                    }
                });

                // Add dot for latest data point
                const lastPoint = {
                    x: labels[labels.length - 1],
                    y: values[values.length - 1]
                };
                
                chart.data.datasets.push({
                    data: [lastPoint],
                    pointBackgroundColor: theme.PRIMARY,
                    pointRadius: 2,
                    pointHoverRadius: 2,
                    showLine: false
                });

                chart._theme = theme;
                charts[canvasId] = chart;
            } else {
                chart.data.labels = labels;
                chart.data.datasets[0].data = values;
                
                // Update gradient
                const ctx = canvas.getContext('2d');
                const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);
                gradient.addColorStop(0, theme.PRIMARY + '80');
                gradient.addColorStop(1, theme.PRIMARY);
                chart.data.datasets[0].borderColor = gradient;

                // Update latest point
                const lastPoint = {
                    x: labels[labels.length - 1],
                    y: values[values.length - 1]
                };
                
                if (chart.data.datasets.length === 1) {
                    chart.data.datasets.push({
                        data: [lastPoint],
                        pointBackgroundColor: theme.PRIMARY,
                        pointRadius: 2,
                        pointHoverRadius: 2,
                        showLine: false
                    });
                } else {
                    chart.data.datasets[1].data = [lastPoint];
                    chart.data.datasets[1].pointBackgroundColor = theme.PRIMARY;
                }

                if (chart._theme !== theme) {
                    chart._theme = theme;
                }
                chart.update();
            }
        });
    }

    function destroySparklines() {
        Object.values(charts).forEach(chart => chart.destroy());
        Object.keys(charts).forEach(id => delete charts[id]);
    }

    window.addEventListener('beforeunload', destroySparklines);

    window.SparklineModule = { initSparklines, updateSparklines, destroySparklines };
})();

// Refresh sparklines when the theme changes so colors stay in sync
if (window.jQuery) {
    window.jQuery(document).on('themeChanged', function () {
        if (typeof latestMetrics !== 'undefined' && latestMetrics && window.SparklineModule) {
            window.SparklineModule.updateSparklines(latestMetrics);
        }
    });
}

