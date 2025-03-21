# Ocean.xyz Bitcoin Mining Dashboard

A real-time dashboard application for monitoring Bitcoin mining operations using the Ocean.xyz mining pool.

![image](https://github.com/user-attachments/assets/e1fa9ebc-51ab-4488-a493-264683a3f8b1)

## Overview

This application provides miners with a comprehensive view of their mining operations, including:

- Real-time hashrate monitoring
- BTC price tracking
- Profitability metrics
- Payout status
- Network statistics
- Historical data visualization

Built with Flask and modern web technologies, the dashboard features a responsive design that works on both desktop and mobile devices, real-time data updates via Server-Sent Events (SSE), and persistent storage with Redis.

## Features

- **Real-Time Monitoring**: Live updates of mining metrics with minimal delay
- **Hashrate Visualization**: Interactive charts showing hashrate trends
- **Profitability Calculations**: Daily and monthly profit estimates in USD and BTC
- **Network Stats**: Current Bitcoin difficulty, network hashrate, and block count
- **Payout Tracking**: Monitor unpaid earnings and estimated time to next payout
- **High Performance**: Optimized for low-resource environments with data compression
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Retro Boot Screen**: Bitcoin-themed boot sequence with system initialization display

## File Structure

```
ocean-mining-dashboard/
├── App.py                  # Main Flask application with backend logic
├── Dockerfile              # Docker container configuration
├── minify.py               # HTML minification utility
├── requirements.txt        # Python dependencies
├── static/
│   └── js/
│       └── main.js         # Frontend JavaScript for dashboard functionality
├── templates/
│   ├── boot.html           # Bitcoin-themed boot sequence page
│   ├── error.html          # Error page template
│   └── index.html          # Main dashboard template
└── config.json             # Configuration file (created on first run)
```

## Installation

### Prerequisites

- Python 3.9 or higher
- Docker (optional, for containerized deployment)
- Redis (optional, for data persistence)

### Option 1: Local Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/ocean-mining-dashboard.git
   cd ocean-mining-dashboard
   ```

2. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run the application:
   ```bash
   python App.py
   ```

5. Access the dashboard at http://localhost:5000

### Option 2: Docker Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/ocean-mining-dashboard.git
   cd ocean-mining-dashboard
   ```

2. Build the Docker image:
   ```bash
   docker build -t mining-dashboard .
   ```

3. Run the container:
   ```bash
   docker run -d -p 5000:5000 --name mining-dashboard mining-dashboard
   ```

4. Optional: Run with Redis for data persistence:
   ```bash
   # First start a Redis container
   docker run -d --name redis redis
   
   # Then start the dashboard with Redis connection
   docker run -d -p 5000:5000 --link redis --env REDIS_URL=redis://redis:6379 mining-dashboard
   ```

5. Access the dashboard at http://localhost:5000

## Configuration

On first run, the application will create a `config.json` file with default settings. Edit this file to customize:

```json
{
  "power_cost": 0.12,       // Cost per kWh in USD
  "power_usage": 3450,      // Power consumption in watts
  "wallet": "your-btc-wallet-address-here"
}
```

## System Requirements

The dashboard is designed to be lightweight:
- Minimal CPU usage (single worker with threading)
- ~100-200MB RAM usage
- <50MB disk space

## Troubleshooting

If you encounter connection issues with the dashboard:

1. Check the "Health" endpoint at `/api/health` for system status
2. Use the "Force Refresh" button if data becomes stale
3. Inspect browser console logs for error messages
4. Check server logs with `docker logs mining-dashboard` if using Docker

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [Ocean.xyz](https://ocean.xyz) mining pool for the mining API
- [Flask](https://flask.palletsprojects.com/) web framework
- [Chart.js](https://www.chartjs.org/) for data visualization
- [Bootstrap](https://getbootstrap.com/) for responsive UI components

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
