# Installation and Quick Start

This guide covers the basic steps to get the dashboard running in a local development environment.

## Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/Djobleezy/DeepSea-Dashboard.git
   cd DeepSea-Dashboard
   ```
2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```
3. **Run the setup script**
   ```bash
   make setup
   ```
   The provided `Makefile` also exposes helpers like `make minify` for asset compression.
4. **Start the application**
   ```bash
   python App.py
   ```
5. **Open your browser** at `http://localhost:5000`

For deployment options such as Docker or Gunicorn, see [DEPLOYMENT.md](DEPLOYMENT.md).
