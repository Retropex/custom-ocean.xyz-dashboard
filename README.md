# Ocean.xyz Bitcoin Mining Dashboard

## 🚀 Stack Sats Smarter with Real-Time Mining Insights

A complete monitoring solution for Ocean.xyz pool miners that helps you track profits, hashrates, and mining performance in real-time. Keep your mining operation running at peak efficiency with minimal effort.

![Main Dashboard](https://github.com/user-attachments/assets/33dafb93-38ef-4fee-aba1-3a7d38eca3c9)

## 💰 Built By Miners, For Miners

Whether you're running a single ASIC in your garage or managing a fleet of mining rigs, this dashboard gives you the critical information you need:

- **See Your Profits**: Track daily and monthly earnings in both BTC and USD
- **Watch Your Workers**: Know immediately when a miner goes offline
- **Track Your Payouts**: See exactly when your next payout is coming
- **Monitor Network Changes**: Stay ahead of difficulty adjustments
- **Make Better Decisions**: Power cost analysis helps you maximize profitability

## ⚡ Main Features

### 24/7 Mining Insights
- **Live Hashrate Monitoring**: See your hashrate updated in real-time
- **Profit Tracking**: USD and sats calculations updated every minute
- **Payout Countdown**: Know exactly when your next Ocean.xyz payment is coming
- **Bitcoin Network Stats**: Current price, difficulty, and network hashrate

### Complete Worker Management
- **Full Fleet Overview**: See all your machines in one place
- **Quick Status Checks**: Instantly see which miners are online/offline
- **Worker Details**: Hashrate, temperature, earnings, and accept rate for each machine
- **Easy Filtering**: Find specific workers by name, status, or type

### Old-School Cool Design
- **Retro Terminal Monitor**: Track your stats with a floating terminal that looks like it's straight out of the 90s
- **Bitcoin Boot Sequence**: Enjoy the nostalgic boot screen when you start the dashboard
- **Mobile Friendly**: Works on your phone when you're away from your mining operation

![Boot Sequence](https://github.com/user-attachments/assets/8205e8c0-79ad-4780-bc50-237131373cf8)

## 🔧 Easy Setup

### Option 1: Quick Start (For Most Miners)

1. Download the release package from GitHub
2. Extract the files
3. Edit the `config.json` file with:
   - Your Ocean.xyz wallet address
   - Your power cost ($/kWh)
   - Your miners' total power usage (watts)
4. Run the included `start.bat` file (Windows) or `start.sh` (Mac/Linux)
5. Open your browser to `http://localhost:5000`

### Option 2: Docker Setup (For Tech-Savvy Miners)

If you're familiar with Docker, this option gives you a cleaner installation:

```bash
# Pull and run with one command
docker run -d -p 5000:5000 -e WALLET=your-wallet-address -e POWER_COST=0.12 -e POWER_USAGE=3450 yourusername/ocean-mining-dashboard
```

Then access at `http://localhost:5000` in your browser.

## 📱 Dashboard Tour

### Main Dashboard
![Main Dashboard](https://github.com/user-attachments/assets/33dafb93-38ef-4fee-aba1-3a7d38eca3c9)

- Real-time hashrate graph
- Daily and monthly profit calculations
- Network difficulty and hashrate stats
- BTC price tracking
- Unpaid earnings monitor
- Estimated time to payout

### Workers Overview
![Workers Overview](https://github.com/user-attachments/assets/ae78c34c-fbdf-4186-9706-760a67eac44c)

- Fleet summary with total hashrate
- Online/offline status for all workers
- Individual stats for each miner
- Filter workers by type or status
- Search function to find specific miners

### NEW: Retro Terminal Monitor
![Retro Terminal Monitor](https://github.com/user-attachments/assets/screenshot-placeholder.png)

- Floating system monitor with old-school terminal look
- Real-time refresh countdown with progress bar
- System uptime tracking
- Minimizable interface that stays out of your way
- Classic CRT effects for nostalgia

## 🔥 Why Miners Love This Dashboard

> "Finally I can see exactly when my miners go offline without constantly checking the pool website." - ASIC Miner

> "The profit calculations help me know exactly how changes in BTC price affect my bottom line." - Home Miner

> "I love the retro terminal - brings me back to my early computing days while stacking sats." - Bitcoin OG

## 📊 Hardware Requirements

The dashboard is designed to run on almost anything:
- Works on old laptops and basic PCs
- Uses minimal resources (CPU, RAM, disk space)
- Can run 24/7 without performance issues
- Compatible with Windows, Mac, and Linux

## 🛠️ Quick Fixes

If something's not working right:

1. Click the "Force Refresh" button if data seems stale
2. Check your internet connection if updates stop
3. Restart the dashboard if you make config changes
4. Visit `/api/health` to check system status

## 🚀 Getting Started

1. Download from the Releases page
2. Set up with your wallet and power info
3. Start stacking sats with better insights!

*All you need is your Ocean.xyz pool mining address to get started. The dashboard does the rest!*

---

## Technical Details (For the Curious)

This open-source dashboard uses Flask, Chart.js, and Server-Sent Events for real-time updates. It scrapes data from the Ocean.xyz pool website and calculates profitability based on your power costs.

The system is optimized for continuous running with minimal resource usage. Full source code is available for those who want to customize or contribute.

## 🙏 Acknowledgments

- The amazing Ocean.xyz pool team
- Bitcoin miners worldwide
- Satoshi Nakamoto for creating Bitcoin

Licensed under MIT - Free to use and modify. Not affiliated with Ocean.xyz.

*"Stack sats and watch the terminal glow."* 🔶
