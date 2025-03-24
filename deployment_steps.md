# Deployment Guide

This guide provides instructions for deploying the Bitcoin Mining Dashboard application in various environments.

## Prerequisites

- Python 3.9 or higher
- Redis server (optional, for persistent state)
- Docker (optional, for containerized deployment)

## Installation

### Option 1: Standard Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/bitcoin-mining-dashboard.git
   cd bitcoin-mining-dashboard
   ```

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Run the setup script to organize the files correctly:
   ```
   python setup.py
   ```

4. Configure your mining parameters in `config.json`:
   ```json
   {
     "power_cost": 0.12,     // Cost of electricity per kWh
     "power_usage": 3450,    // Power consumption in watts
     "wallet": "your-wallet-address"  // Your Ocean.xyz wallet
   }
   ```

5. Start the application:
   ```
   python App.py
   ```

6. Access the dashboard at `http://localhost:5000`

### Option 2: Production Deployment with Gunicorn

For better performance in production environments:

1. Follow steps 1-4 from standard installation

2. Install Gunicorn if not already installed:
   ```
   pip install gunicorn
   ```

3. Start with Gunicorn:
   ```
   gunicorn -b 0.0.0.0:5000 App:app --workers=1 --threads=12 --timeout=600 --keep-alive=5
   ```

   > **Note**: Use only 1 worker to maintain shared state. Use threads for concurrency.

### Option 3: Docker Deployment

1. Build the Docker image:
   ```
   docker build -t bitcoin-mining-dashboard .
   ```

2. Run the container:
   ```
   docker run -d -p 5000:5000 \
     -e WALLET=your-wallet-address \
     -e POWER_COST=0.12 \
     -e POWER_USAGE=3450 \
     -e REDIS_URL=redis://redis:6379 \
     --name mining-dashboard \
     bitcoin-mining-dashboard
   ```

3. Access the dashboard at `http://localhost:5000`

For Redis persistence, you can create a Redis container and connect them:

```
docker network create mining-network
docker run -d --name redis --network mining-network redis
docker run -d -p 5000:5000 --network mining-network -e REDIS_URL=redis://redis:6379 --name mining-dashboard bitcoin-mining-dashboard
```

## Environment Variables

The application can be configured using environment variables:

- `REDIS_URL`: Redis connection URL for persistent state (optional)
- `WALLET`: Ocean.xyz wallet address
- `POWER_COST`: Electricity cost per kWh
- `POWER_USAGE`: Power consumption in watts
- `FLASK_ENV`: Set to 'production' for production environments
- `LOG_LEVEL`: Logging level (default: INFO)

## Maintenance

### Logs

Logs are stored in the `logs` directory by default. Monitor these logs for errors or warnings.

### Health Check

A health check endpoint is available at `/api/health` to verify the application status. This returns:
- Application status (healthy, degraded, unhealthy)
- Uptime information
- Memory usage
- Data freshness
- Redis connection status

Use this endpoint for monitoring the application in production.

### Troubleshooting

If the application becomes unresponsive:

1. Check the logs for error messages
2. Access the `/api/scheduler-health` endpoint to check scheduler status
3. If the scheduler is not functioning, access `/api/fix-scheduler` with a POST request to repair it
4. For stale data, access `/api/force-refresh` with a POST request to force a data refresh

## Updating

To update the application:

1. Pull the latest changes:
   ```
   git pull origin main
   ```

2. Run the setup script to reorganize files if needed:
   ```
   python setup.py
   ```

3. Restart the application
