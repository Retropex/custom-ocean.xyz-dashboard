# Ocean.xyz Bitcoin Mining Dashboard

## A Practical Monitoring Solution for Bitcoin Miners

This open-source dashboard provides comprehensive monitoring for Ocean.xyz pool miners, offering real-time data on hashrate, profitability, and worker status. Designed to be resource-efficient and user-friendly, it helps miners maintain oversight of their operations.

## Practical Mining Intelligence

The dashboard aggregates essential metrics in one accessible interface:

- **Profitability Analysis**: Monitor daily and monthly earnings in BTC and USD
- **Worker Status**: Track online/offline status of mining equipment
- **Payout Monitoring**: View unpaid balance and estimated time to next payout
- **Network Metrics**: Stay informed of difficulty adjustments and network hashrate
- **Cost Analysis**: Calculate profit margins based on power consumption

## Key Features

### Mining Performance Metrics
- **Hashrate Visualization**: Clear graphical representation of hashrate trends
- **Financial Calculations**: Automatic conversion between BTC and USD values
- **Payout Estimation**: Projected time until minimum payout threshold is reached
- **Network Intelligence**: Current Bitcoin price, difficulty, and total network hashrate

### Worker Management
- **Equipment Overview**: Consolidated view of all mining devices
- **Status Monitoring**: Clear indicators for active and inactive devices
- **Performance Data**: Individual hashrate, temperature, and acceptance rate metrics
- **Filtering Options**: Sort and search by device type or operational status

### Thoughtful Design Elements
- **Retro Terminal Monitor**: A floating system monitor with classic design aesthetics
- **Boot Sequence**: An engaging initialization sequence on startup
- **Responsive Interface**: Adapts seamlessly to desktop and mobile devices

![Boot Sequence](https://github.com/user-attachments/assets/8205e8c0-79ad-4780-bc50-237131373cf8)

## Installation Options

### Standard Installation

1. Download the latest release package
2. Configure your mining parameters in `config.json`:
   - Pool wallet address
   - Electricity cost ($/kWh)
   - System power consumption (watts)
3. Launch the application using the included startup script
4. Access the dashboard at `http://localhost:5000`

### Docker Installation

For those preferring containerized deployment:

```bash
docker run -d -p 5000:5000 -e WALLET=your-wallet-address -e POWER_COST=0.12 -e POWER_USAGE=3450 yourusername/ocean-mining-dashboard
```

Then navigate to `http://localhost:5000` in your web browser.

## Dashboard Components

### Main Dashboard
![Main Dashboard](https://github.com/user-attachments/assets/33dafb93-38ef-4fee-aba1-3a7d38eca3c9)

- Interactive hashrate visualization
- Detailed profitability metrics
- Network statistics
- Current Bitcoin price
- Balance and payment information

### Workers Dashboard
![Workers Overview](https://github.com/user-attachments/assets/ae78c34c-fbdf-4186-9706-760a67eac44c)

- Fleet summary with aggregate statistics
- Individual worker performance metrics
- Status indicators for each device
- Flexible filtering and search functionality

### Retro Terminal Monitor

- Floating interface providing system statistics
- Progress indicator for data refresh cycles
- System uptime display
- Minimizable design for unobtrusive monitoring
- Thoughtful visual styling reminiscent of classic computer terminals

## System Requirements

The application is designed for efficient resource utilization:
- Compatible with standard desktop and laptop computers
- Modest CPU and memory requirements
- Suitable for continuous operation
- Cross-platform support for Windows, macOS, and Linux

## Troubleshooting

For optimal performance:

1. Use the refresh function if data appears outdated
2. Verify network connectivity for consistent updates
3. Restart the application after configuration changes
4. Access the health endpoint at `/api/health` for system status information

## Getting Started

1. Download the latest release
2. Configure with your mining information
3. Launch the application to begin monitoring

The dashboard requires only your Ocean.xyz mining wallet address for basic functionality.

---

## Technical Foundation

Built on Flask with Chart.js for visualization and Server-Sent Events for real-time updates, this dashboard retrieves data from Ocean.xyz and performs calculations based on current network metrics and your specified parameters.

The application prioritizes stability and efficiency for reliable long-term operation. Source code is available for review and customization.

## Acknowledgments

- Ocean.xyz mining pool for their service
- The open-source community for their contributions
- Bitcoin protocol developers

Available under the MIT License. This is an independent project not affiliated with Ocean.xyz.
