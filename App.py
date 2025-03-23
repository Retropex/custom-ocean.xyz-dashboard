from flask import Flask, render_template, jsonify, Response, request
import requests, json, os, logging, re, time, sys, gc, psutil, signal, random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup
from flask_caching import Cache
import redis
from apscheduler.schedulers.background import BackgroundScheduler
import threading

app = Flask(__name__)

# Set up caching using a simple in-memory cache.
cache = Cache(app, config={'CACHE_TYPE': 'SimpleCache', 'CACHE_DEFAULT_TIMEOUT': 10})

# Global variables for arrow history, legacy hashrate history, and a log of full metrics snapshots.
arrow_history = {}    # stored per second
hashrate_history = []
metrics_log = []

# Limits for data collections to prevent memory growth
MAX_HISTORY_ENTRIES = 180  # 3 hours worth at 1 min intervals
MAX_SSE_CONNECTIONS = 10   # Maximum concurrent SSE connections
MAX_SSE_CONNECTION_TIME = 900  # 15 minutes maximum SSE connection time (increased from 10 min)

# Track active SSE connections
active_sse_connections = 0
sse_connections_lock = threading.Lock()

# Global variable to hold the cached metrics updated by the background job.
cached_metrics = None
last_metrics_update_time = None

# New global variables for worker data caching
worker_data_cache = None
last_worker_data_update = None
WORKER_DATA_CACHE_TIMEOUT = 60  # Cache worker data for 60 seconds

# Track scheduler health
scheduler_last_successful_run = None
scheduler_recreate_lock = threading.Lock()

# Global lock for thread safety on shared state.
state_lock = threading.Lock()

# Configure logging.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Global Server Start Time (Los Angeles Time) ---
SERVER_START_TIME = datetime.now(ZoneInfo("America/Los_Angeles"))

# --- Disable Client Caching for All Responses ---
@app.after_request
def add_header(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# --- Memory usage monitoring ---
def log_memory_usage():
    """Log current memory usage"""
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        logging.info(f"Memory usage: {mem_info.rss / 1024 / 1024:.2f} MB (RSS)")
        
        # Log the size of key data structures
        logging.info(f"Arrow history entries: {sum(len(v) for v in arrow_history.values() if isinstance(v, list))}")
        logging.info(f"Metrics log entries: {len(metrics_log)}")
        logging.info(f"Active SSE connections: {active_sse_connections}")
    except Exception as e:
        logging.error(f"Error logging memory usage: {e}")

# --- Redis Connection for Shared State (fixed) ---
def get_redis_client():
    """Get a Redis client with connection retry logic."""
    REDIS_URL = os.environ.get("REDIS_URL")
    
    # Make Redis truly optional - if no URL provided, don't attempt connection
    if not REDIS_URL:
        logging.info("Redis URL not configured, using in-memory state only.")
        return None
    
    retry_count = 0
    max_retries = 3
    
    while retry_count < max_retries:
        try:
            # Removed compress parameter as it's not supported in your version
            client = redis.Redis.from_url(REDIS_URL)
            client.ping()  # Test the connection
            logging.info(f"Connected to Redis at {REDIS_URL}")
            return client
        except Exception as e:
            retry_count += 1
            if retry_count < max_retries:
                logging.warning(f"Redis connection attempt {retry_count} failed: {e}. Retrying...")
                time.sleep(1)  # Wait before retrying
            else:
                logging.error(f"Could not connect to Redis after {max_retries} attempts: {e}")
                return None

# Get Redis client with retry logic
redis_client = get_redis_client()
STATE_KEY = "graph_state"

# --- Modified Load Graph State Function ---
def load_graph_state():
    """Load graph state from Redis with support for the optimized format."""
    global arrow_history, hashrate_history, metrics_log
    if redis_client:
        try:
            # Check version to handle format changes
            version = redis_client.get(f"{STATE_KEY}_version")
            version = version.decode('utf-8') if version else "1.0"
            
            state_json = redis_client.get(STATE_KEY)
            if state_json:
                state = json.loads(state_json)
                
                # Handle different versions of the data format
                if version == "2.0":  # Optimized format
                    # Restore arrow_history
                    compact_arrow_history = state.get("arrow_history", {})
                    for key, values in compact_arrow_history.items():
                        arrow_history[key] = [
                            {"time": entry.get("t", ""), 
                             "value": entry.get("v", 0), 
                             "arrow": ""}  # Default empty arrow
                            for entry in values
                        ]
                    
                    # Restore hashrate_history
                    hashrate_history = state.get("hashrate_history", [])
                    
                    # Restore metrics_log
                    compact_metrics_log = state.get("metrics_log", [])
                    metrics_log = []
                    for entry in compact_metrics_log:
                        metrics_log.append({
                            "timestamp": entry.get("ts", ""),
                            "metrics": entry.get("m", {})
                        })
                else:  # Original format
                    arrow_history = state.get("arrow_history", {})
                    hashrate_history = state.get("hashrate_history", [])
                    metrics_log = state.get("metrics_log", [])
                
                logging.info(f"Loaded graph state from Redis (format version {version}).")
            else:
                logging.info("No previous graph state found in Redis.")
        except Exception as e:
            logging.error(f"Error loading graph state from Redis: {e}")
    else:
        logging.info("Redis not available, using in-memory state.")

# --- Save Graph State with Advanced Optimizations ---
def save_graph_state():
    """Save graph state to Redis with optimized frequency, pruning, and data reduction."""
    if redis_client:
        # Check if we've saved recently to avoid too frequent saves
        # Only save at most once every 5 minutes
        current_time = time.time()
        if hasattr(save_graph_state, 'last_save_time') and \
           current_time - save_graph_state.last_save_time < 300:  # 300 seconds = 5 minutes
            logging.debug("Skipping Redis save - last save was less than 5 minutes ago")
            return
            
        # Update the last save time
        save_graph_state.last_save_time = current_time
        
        # Prune data first to reduce volume
        prune_old_data()
        
        # Create compact versions of the data structures for Redis storage
        try:
            # 1. Create compact arrow_history with minimal data
            compact_arrow_history = {}
            for key, values in arrow_history.items():
                if isinstance(values, list) and values:
                    # Only store recent history (last 2 hours)
                    recent_values = values[-120:] if len(values) > 120 else values
                    # Use shorter field names and remove unnecessary fields
                    compact_arrow_history[key] = [
                        {"t": entry["time"], "v": entry["value"]} 
                        for entry in recent_values
                    ]
            
            # 2. Only keep essential hashrate_history
            compact_hashrate_history = hashrate_history[-60:] if len(hashrate_history) > 60 else hashrate_history
            
            # 3. Only keep recent metrics_log entries (last 30 minutes)
            # This is typically the largest data structure
            compact_metrics_log = []
            if metrics_log:
                # Keep only last 30 entries (30 minutes assuming 1-minute updates)
                recent_logs = metrics_log[-30:] 
                
                for entry in recent_logs:
                    # Only keep necessary fields from each metrics entry
                    if "metrics" in entry and "timestamp" in entry:
                        metrics_copy = {}
                        original_metrics = entry["metrics"]
                        
                        # Only copy the most important metrics for historical tracking
                        essential_keys = [
                            "hashrate_60sec", "hashrate_24hr", "btc_price", 
                            "workers_hashing", "unpaid_earnings", "difficulty",
                            "network_hashrate", "daily_profit_usd"
                        ]
                        
                        for key in essential_keys:
                            if key in original_metrics:
                                metrics_copy[key] = original_metrics[key]
                        
                        # Skip arrow_history within metrics as we already stored it separately
                        compact_metrics_log.append({
                            "ts": entry["timestamp"],
                            "m": metrics_copy
                        })
            
            # Create the final state object
            state = {
                "arrow_history": compact_arrow_history,
                "hashrate_history": compact_hashrate_history,
                "metrics_log": compact_metrics_log
            }
            
            # Convert to JSON once to reuse and measure size
            state_json = json.dumps(state)
            data_size_kb = len(state_json) / 1024
            
            # Log data size for monitoring
            logging.info(f"Saving graph state to Redis: {data_size_kb:.2f} KB (optimized format)")
            
            # Only save if data size is reasonable (adjust threshold as needed)
            if data_size_kb > 2000:  # 2MB warning threshold (reduced from 5MB)
                logging.warning(f"Redis save data size is still large: {data_size_kb:.2f} KB")
            
            # Store version info to handle future format changes
            redis_client.set(f"{STATE_KEY}_version", "2.0")  
            redis_client.set(STATE_KEY, state_json)
            logging.info(f"Successfully saved graph state to Redis ({data_size_kb:.2f} KB)")
        except Exception as e:
            logging.error(f"Error saving graph state to Redis: {e}")
    else:
        logging.info("Redis not available, skipping state save.")

# Load persisted state on startup.
load_graph_state()

# --- Clean up old data ---
def prune_old_data():
    """Remove old data to prevent memory growth with optimized strategy"""
    global arrow_history, metrics_log
    
    with state_lock:
        # Prune arrow_history with more sophisticated approach
        for key in arrow_history:
            if isinstance(arrow_history[key], list):
                if len(arrow_history[key]) > MAX_HISTORY_ENTRIES:
                    # For most recent data (last hour) - keep every point
                    recent_data = arrow_history[key][-60:]
                    
                    # For older data, reduce resolution by keeping every other point
                    older_data = arrow_history[key][:-60]
                    if len(older_data) > 0:
                        sparse_older_data = [older_data[i] for i in range(0, len(older_data), 2)]
                        arrow_history[key] = sparse_older_data + recent_data
                    else:
                        arrow_history[key] = recent_data
                        
                    logging.info(f"Pruned {key} history from {len(arrow_history[key])} to {len(sparse_older_data + recent_data) if older_data else len(recent_data)} entries")
                
        # Prune metrics_log more aggressively
        if len(metrics_log) > MAX_HISTORY_ENTRIES:
            # Keep most recent entries at full resolution
            recent_logs = metrics_log[-60:]
            
            # Reduce resolution of older entries
            older_logs = metrics_log[:-60]
            if len(older_logs) > 0:
                sparse_older_logs = [older_logs[i] for i in range(0, len(older_logs), 3)]  # Keep every 3rd entry
                metrics_log = sparse_older_logs + recent_logs
                logging.info(f"Pruned metrics log from {len(metrics_log)} to {len(sparse_older_logs + recent_logs)} entries")
    
    # Free memory more aggressively
    gc.collect()
    
    # Log memory usage after pruning
    log_memory_usage()

# --- State persistence function ---
def persist_critical_state():
    """Store critical state in Redis for recovery after worker restarts"""
    if redis_client:
        try:
            # Only persist if we have valid data
            if cached_metrics and cached_metrics.get("server_timestamp"):
                state = {
                    "cached_metrics_timestamp": cached_metrics.get("server_timestamp"),
                    "last_successful_run": scheduler_last_successful_run,
                    "last_update_time": last_metrics_update_time
                }
                redis_client.set("critical_state", json.dumps(state))
                logging.info(f"Persisted critical state to Redis, timestamp: {cached_metrics.get('server_timestamp')}")
        except Exception as e:
            logging.error(f"Error persisting critical state: {e}")

# --- Custom Template Filter ---
@app.template_filter('commafy')
def commafy(value):
    try:
        return "{:,}".format(int(value))
    except Exception:
        return value

# --- Configuration Management ---
CONFIG_FILE = "config.json"

def load_config():
    default_config = {
        "power_cost": 0.0,
        "power_usage": 0.0,
        "wallet": "bc1py5zmrtssheq3shd8cptpl5l5m3txxr5afynyg2gyvam6w78s4dlqqnt4v9"
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                config = json.load(f)
            return config
        except Exception as e:
            logging.error(f"Error loading config: {e}")
    return default_config

# --- Data Structures ---
@dataclass
class OceanData:
    pool_total_hashrate: float = None
    pool_total_hashrate_unit: str = None
    hashrate_24hr: float = None
    hashrate_24hr_unit: str = None
    hashrate_3hr: float = None
    hashrate_3hr_unit: str = None
    hashrate_10min: float = None
    hashrate_10min_unit: str = None
    hashrate_5min: float = None
    hashrate_5min_unit: str = None
    hashrate_60sec: float = None
    hashrate_60sec_unit: str = None
    estimated_earnings_per_day: float = None
    estimated_earnings_next_block: float = None
    estimated_rewards_in_window: float = None
    workers_hashing: int = None
    unpaid_earnings: float = None
    est_time_to_payout: str = None
    last_block: str = None
    last_block_height: str = None
    last_block_time: str = None
    blocks_found: str = None
    total_last_share: str = "N/A"
    # Field for BTC earned for the last block, now in sats.
    last_block_earnings: str = None

def convert_to_ths(value: float, unit: str) -> float:
    """Convert any hashrate unit to TH/s equivalent."""
    unit = unit.lower()
    if 'ph/s' in unit:
        return value * 1000  # 1 PH/s = 1000 TH/s
    elif 'eh/s' in unit:
        return value * 1000000  # 1 EH/s = 1,000,000 TH/s
    elif 'gh/s' in unit:
        return value / 1000  # 1 TH/s = 1000 GH/s
    elif 'mh/s' in unit:
        return value / 1000000  # 1 TH/s = 1,000,000 MH/s
    elif 'th/s' in unit:
        return value
    else:
        # Log unexpected unit
        logging.warning(f"Unexpected hashrate unit: {unit}, defaulting to treating as TH/s")
        return value

# --- Data Fetching Functions ---
def get_ocean_data(session: requests.Session, wallet: str) -> OceanData:
    base_url = "https://ocean.xyz"
    stats_url = f"{base_url}/stats/{wallet}"
    headers = {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cache-Control': 'no-cache'
    }
    
    # Create an empty data object to populate
    data = OceanData()
    
    try:
        response = session.get(stats_url, headers=headers, timeout=10)
        if not response.ok:
            logging.error(f"Error fetching ocean data: status code {response.status_code}")
            return None
            
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Safely extract pool status information
        try:
            pool_status = soup.find("p", id="pool-status-item")
            if pool_status:
                text = pool_status.get_text(strip=True)
                m_total = re.search(r'HASHRATE:\s*([\d\.]+)\s*(\w+/s)', text, re.IGNORECASE)
                if m_total:
                    raw_val = float(m_total.group(1))
                    unit = m_total.group(2)
                    data.pool_total_hashrate = raw_val
                    data.pool_total_hashrate_unit = unit
                span = pool_status.find("span", class_="pool-status-newline")
                if span:
                    last_block_text = span.get_text(strip=True)
                    m_block = re.search(r'LAST BLOCK:\s*(\d+\s*\(.*\))', last_block_text, re.IGNORECASE)
                    if m_block:
                        full_last_block = m_block.group(1)
                        data.last_block = full_last_block
                        match = re.match(r'(\d+)\s*\((.*?)\)', full_last_block)
                        if match:
                            data.last_block_height = match.group(1)
                            data.last_block_time = match.group(2)
                        else:
                            data.last_block_height = full_last_block
                            data.last_block_time = ""
        except Exception as e:
            logging.error(f"Error parsing pool status: {e}")
        
        # Parse the earnings value from the earnings table and convert to sats.
        try:
            earnings_table = soup.find('tbody', id='earnings-tablerows')
            if earnings_table:
                latest_row = earnings_table.find('tr', class_='table-row')
                if latest_row:
                    cells = latest_row.find_all('td', class_='table-cell')
                    if len(cells) >= 3:
                        earnings_text = cells[2].get_text(strip=True)
                        earnings_value = earnings_text.replace('BTC', '').strip()
                        try:
                            btc_earnings = float(earnings_value)
                            sats = int(round(btc_earnings * 100000000))
                            data.last_block_earnings = str(sats)
                        except Exception:
                            data.last_block_earnings = earnings_value
        except Exception as e:
            logging.error(f"Error parsing earnings data: {e}")

        # Parse hashrate data from the hashrates table
        try:
            time_mapping = {
                '24 hrs': ('hashrate_24hr', 'hashrate_24hr_unit'),
                '3 hrs': ('hashrate_3hr', 'hashrate_3hr_unit'),
                '10 min': ('hashrate_10min', 'hashrate_10min_unit'),
                '5 min': ('hashrate_5min', 'hashrate_5min_unit'),
                '60 sec': ('hashrate_60sec', 'hashrate_60sec_unit')
            }
            hashrate_table = soup.find('tbody', id='hashrates-tablerows')
            if hashrate_table:
                for row in hashrate_table.find_all('tr', class_='table-row'):
                    cells = row.find_all('td', class_='table-cell')
                    if len(cells) >= 2:
                        period_text = cells[0].get_text(strip=True).lower()
                        hashrate_str = cells[1].get_text(strip=True).lower()
                        try:
                            parts = hashrate_str.split()
                            hashrate_val = float(parts[0])
                            unit = parts[1] if len(parts) > 1 else 'th/s'
                            for key, (attr, unit_attr) in time_mapping.items():
                                if key.lower() in period_text:
                                    setattr(data, attr, hashrate_val)
                                    setattr(data, unit_attr, unit)
                                    break
                        except Exception as e:
                            logging.error(f"Error parsing hashrate '{hashrate_str}': {e}")
        except Exception as e:
            logging.error(f"Error parsing hashrate table: {e}")
        
        # Parse lifetime stats data
        try:
            lifetime_snap = soup.find('div', id='lifetimesnap-statcards')
            if lifetime_snap:
                for container in lifetime_snap.find_all('div', class_='blocks dashboard-container'):
                    label_div = container.find('div', class_='blocks-label')
                    if label_div:
                        label_text = label_div.get_text(strip=True).lower()
                        earnings_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                        if earnings_span:
                            span_text = earnings_span.get_text(strip=True)
                            try:
                                earnings_value = float(span_text.split()[0].replace(',', ''))
                                if "earnings" in label_text and "day" in label_text:
                                    data.estimated_earnings_per_day = earnings_value
                            except Exception:
                                pass
        except Exception as e:
            logging.error(f"Error parsing lifetime stats: {e}")
        
        # Parse payout stats data
        try:
            payout_snap = soup.find('div', id='payoutsnap-statcards')
            if payout_snap:
                for container in payout_snap.find_all('div', class_='blocks dashboard-container'):
                    label_div = container.find('div', class_='blocks-label')
                    if label_div:
                        label_text = label_div.get_text(strip=True).lower()
                        earnings_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                        if earnings_span:
                            span_text = earnings_span.get_text(strip=True)
                            try:
                                earnings_value = float(span_text.split()[0].replace(',', ''))
                                if "earnings" in label_text and "block" in label_text:
                                    data.estimated_earnings_next_block = earnings_value
                                elif "rewards" in label_text and "window" in label_text:
                                    data.estimated_rewards_in_window = earnings_value
                            except Exception:
                                pass
        except Exception as e:
            logging.error(f"Error parsing payout stats: {e}")
        
        # Parse user stats data
        try:
            usersnap = soup.find('div', id='usersnap-statcards')
            if usersnap:
                for container in usersnap.find_all('div', class_='blocks dashboard-container'):
                    label_div = container.find('div', class_='blocks-label')
                    if label_div:
                        label_text = label_div.get_text(strip=True).lower()
                        value_span = label_div.find_next('span', class_=lambda x: x != 'tooltiptext')
                        if value_span:
                            span_text = value_span.get_text(strip=True)
                            if "workers currently hashing" in label_text:
                                try:
                                    data.workers_hashing = int(span_text.replace(",", ""))
                                except Exception:
                                    pass
                            elif "unpaid earnings" in label_text and "btc" in span_text.lower():
                                try:
                                    data.unpaid_earnings = float(span_text.split()[0].replace(',', ''))
                                except Exception:
                                    pass
                            elif "estimated time until minimum payout" in label_text:
                                data.est_time_to_payout = span_text
        except Exception as e:
            logging.error(f"Error parsing user stats: {e}")
        
        # Parse blocks found data
        try:
            blocks_container = soup.find(lambda tag: tag.name == "div" and "blocks found" in tag.get_text(strip=True).lower())
            if blocks_container:
                span = blocks_container.find_next_sibling("span")
                if span:
                    num_match = re.search(r'(\d+)', span.get_text(strip=True))
                    if num_match:
                        data.blocks_found = num_match.group(1)
        except Exception as e:
            logging.error(f"Error parsing blocks found: {e}")
        
        # Parse last share time data
        try:
            workers_table = soup.find("tbody", id="workers-tablerows")
            if workers_table:
                for row in workers_table.find_all("tr", class_="table-row"):
                    cells = row.find_all("td")
                    if cells and cells[0].get_text(strip=True).lower().startswith("total"):
                        last_share_str = cells[2].get_text(strip=True)
                        try:
                            naive_dt = datetime.strptime(last_share_str, "%Y-%m-%d %H:%M")
                            utc_dt = naive_dt.replace(tzinfo=ZoneInfo("UTC"))
                            la_dt = utc_dt.astimezone(ZoneInfo("America/Los_Angeles"))
                            data.total_last_share = la_dt.strftime("%Y-%m-%d %I:%M %p")
                        except Exception as e:
                            logging.error(f"Error converting last share time '{last_share_str}': {e}")
                            data.total_last_share = last_share_str
                        break
        except Exception as e:
            logging.error(f"Error parsing last share time: {e}")
            
        return data
    except Exception as e:
        logging.error(f"Error fetching Ocean data: {e}")
        return None

def fetch_url(session: requests.Session, url: str, timeout: int = 5):
    try:
        return session.get(url, timeout=timeout)
    except Exception as e:
        logging.error(f"Error fetching {url}: {e}")
        return None

def get_bitcoin_stats(session: requests.Session, cache_data: dict):
    """Fetch Bitcoin network statistics with improved error handling and caching."""
    urls = {
        "difficulty": "https://blockchain.info/q/getdifficulty",
        "hashrate": "https://blockchain.info/q/hashrate",
        "ticker": "https://blockchain.info/ticker",
        "blockcount": "https://blockchain.info/q/getblockcount"
    }
    
    # Use previous cached values as defaults if available
    difficulty = cache_data.get("difficulty")
    network_hashrate = cache_data.get("network_hashrate")
    btc_price = cache_data.get("btc_price")
    block_count = cache_data.get("block_count")
    
    try:
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {key: executor.submit(fetch_url, session, url) for key, url in urls.items()}
            responses = {key: futures[key].result(timeout=5) for key in futures}
            
        # Process each response individually with error handling
        if responses["difficulty"] and responses["difficulty"].ok:
            try:
                difficulty = float(responses["difficulty"].text)
                cache_data["difficulty"] = difficulty
            except (ValueError, TypeError) as e:
                logging.error(f"Error parsing difficulty: {e}")
                
        if responses["hashrate"] and responses["hashrate"].ok:
            try:
                network_hashrate = float(responses["hashrate"].text) * 1e9
                cache_data["network_hashrate"] = network_hashrate
            except (ValueError, TypeError) as e:
                logging.error(f"Error parsing network hashrate: {e}")
                
        if responses["ticker"] and responses["ticker"].ok:
            try:
                ticker_data = responses["ticker"].json()
                btc_price = float(ticker_data.get("USD", {}).get("last", btc_price))
                cache_data["btc_price"] = btc_price
            except (ValueError, TypeError, json.JSONDecodeError) as e:
                logging.error(f"Error parsing BTC price: {e}")
                
        if responses["blockcount"] and responses["blockcount"].ok:
            try:
                block_count = int(responses["blockcount"].text)
                cache_data["block_count"] = block_count
            except (ValueError, TypeError) as e:
                logging.error(f"Error parsing block count: {e}")
                
    except Exception as e:
        logging.error(f"Error fetching Bitcoin stats: {e}")
        
    return difficulty, network_hashrate, btc_price, block_count

# --- Dashboard Class ---
class MiningDashboardWeb:
    def __init__(self, power_cost, power_usage, wallet):
        self.power_cost = power_cost
        self.power_usage = power_usage
        self.wallet = wallet
        self.cache = {}
        self.sats_per_btc = 100_000_000
        self.previous_values = {}
        self.session = requests.Session()

    def fetch_metrics(self):
        # Add execution time tracking
        start_time = time.time()
        
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                future_ocean = executor.submit(get_ocean_data, self.session, self.wallet)
                future_btc = executor.submit(get_bitcoin_stats, self.session, self.cache)
                try:
                    ocean_data = future_ocean.result(timeout=15)
                    btc_stats = future_btc.result(timeout=15)
                except Exception as e:
                    logging.error(f"Error fetching metrics concurrently: {e}")
                    return None

            if ocean_data is None:
                logging.error("Failed to retrieve Ocean data")
                return None
                
            difficulty, network_hashrate, btc_price, block_count = btc_stats
            
            # If we failed to get network hashrate, use a reasonable default to prevent division by zero
            if network_hashrate is None:
                logging.warning("Using default network hashrate")
                network_hashrate = 500e18  # ~500 EH/s as a reasonable fallback
                
            # If we failed to get BTC price, use a reasonable default
            if btc_price is None:
                logging.warning("Using default BTC price")
                btc_price = 75000  # $75,000 as a reasonable fallback

            # Convert hashrates to a common unit (TH/s) for consistency
            hr3 = ocean_data.hashrate_3hr or 0
            hr3_unit = (ocean_data.hashrate_3hr_unit or 'th/s').lower()
            local_hashrate = convert_to_ths(hr3, hr3_unit) * 1e12  # Convert to H/s for calculation

            hash_proportion = local_hashrate / network_hashrate if network_hashrate else 0
            block_reward = 3.125
            blocks_per_day = 86400 / 600
            daily_btc_gross = hash_proportion * block_reward * blocks_per_day
            daily_btc_net = daily_btc_gross * (1 - 0.02 - 0.028)

            daily_revenue = round(daily_btc_net * btc_price, 2) if btc_price is not None else None
            daily_power_cost = round((self.power_usage / 1000) * self.power_cost * 24, 2)
            daily_profit_usd = round(daily_revenue - daily_power_cost, 2) if daily_revenue is not None else None
            monthly_profit_usd = round(daily_profit_usd * 30, 2) if daily_profit_usd is not None else None

            daily_mined_sats = int(round(daily_btc_net * self.sats_per_btc))
            monthly_mined_sats = daily_mined_sats * 30

            # Use default 0 for earnings if scraping returned None.
            estimated_earnings_per_day = ocean_data.estimated_earnings_per_day if ocean_data.estimated_earnings_per_day is not None else 0
            estimated_earnings_next_block = ocean_data.estimated_earnings_next_block if ocean_data.estimated_earnings_next_block is not None else 0
            estimated_rewards_in_window = ocean_data.estimated_rewards_in_window if ocean_data.estimated_rewards_in_window is not None else 0

            metrics = {
                'pool_total_hashrate': ocean_data.pool_total_hashrate,
                'pool_total_hashrate_unit': ocean_data.pool_total_hashrate_unit,
                'hashrate_24hr': ocean_data.hashrate_24hr,
                'hashrate_24hr_unit': ocean_data.hashrate_24hr_unit,
                'hashrate_3hr': ocean_data.hashrate_3hr,
                'hashrate_3hr_unit': ocean_data.hashrate_3hr_unit,
                'hashrate_10min': ocean_data.hashrate_10min,
                'hashrate_10min_unit': ocean_data.hashrate_10min_unit,
                'hashrate_5min': ocean_data.hashrate_5min,
                'hashrate_5min_unit': ocean_data.hashrate_5min_unit,
                'hashrate_60sec': ocean_data.hashrate_60sec,
                'hashrate_60sec_unit': ocean_data.hashrate_60sec_unit,
                'workers_hashing': ocean_data.workers_hashing,
                'btc_price': btc_price,
                'block_number': block_count,
                'network_hashrate': (network_hashrate / 1e18) if network_hashrate else None,
                'difficulty': difficulty,
                'daily_btc_net': daily_btc_net,
                'estimated_earnings_per_day': estimated_earnings_per_day,
                'daily_revenue': daily_revenue,
                'daily_power_cost': daily_power_cost,
                'daily_profit_usd': daily_profit_usd,
                'monthly_profit_usd': monthly_profit_usd,
                'daily_mined_sats': daily_mined_sats,
                'monthly_mined_sats': monthly_mined_sats,
                'estimated_earnings_next_block': estimated_earnings_next_block,
                'estimated_rewards_in_window': estimated_rewards_in_window,
                'unpaid_earnings': ocean_data.unpaid_earnings,
                'est_time_to_payout': ocean_data.est_time_to_payout,
                'last_block_height': ocean_data.last_block_height,
                'last_block_time': ocean_data.last_block_time,
                'total_last_share': ocean_data.total_last_share,
                'blocks_found': ocean_data.blocks_found or "0",
                # Last block earnings (in sats)
                'last_block_earnings': ocean_data.last_block_earnings
            }
            metrics['estimated_earnings_per_day_sats'] = int(round(estimated_earnings_per_day * self.sats_per_btc))
            metrics['estimated_earnings_next_block_sats'] = int(round(estimated_earnings_next_block * self.sats_per_btc))
            metrics['estimated_rewards_in_window_sats'] = int(round(estimated_rewards_in_window * self.sats_per_btc))

            # Ensure we have at least one data point for history at startup
            if not arrow_history.get('hashrate_60sec') and ocean_data.hashrate_60sec:
                logging.info("Initializing hashrate_60sec history with first data point")
                current_minute = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%H:%M")
                current_second = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%H:%M:%S")
                if 'hashrate_60sec' not in arrow_history:
                    arrow_history['hashrate_60sec'] = []
                
                # Add a starter point for the chart
                arrow_history['hashrate_60sec'].append({
                    "time": current_second,
                    "value": float(ocean_data.hashrate_60sec),
                    "arrow": ""
                })
                # Add a second point slightly offset to ensure chart renders
                arrow_history['hashrate_60sec'].append({
                    "time": current_second.replace(current_second[-1], str(int(current_second[-1])+1 % 10)),
                    "value": float(ocean_data.hashrate_60sec),
                    "arrow": ""
                })
                logging.info(f"Added initial data points for chart: {ocean_data.hashrate_60sec} {ocean_data.hashrate_60sec_unit}")

            arrow_keys = [
                "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
                "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
                "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
                "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
                "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats", "estimated_rewards_in_window_sats",
                "workers_hashing"
            ]
            
            # --- Bucket by second (Los Angeles Time) with thread safety ---
            current_second = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%H:%M:%S")
            with state_lock:
                for key in arrow_keys:
                    if metrics.get(key) is not None:
                        current_val = metrics[key]
                        arrow = ""
                        if key in arrow_history and arrow_history[key]:
                            previous_val = arrow_history[key][-1]["value"]
                            if current_val > previous_val:
                                arrow = "↑"
                            elif current_val < previous_val:
                                arrow = "↓"
                        if key not in arrow_history:
                            arrow_history[key] = []
                        if not arrow_history[key] or arrow_history[key][-1]["time"] != current_second:
                            arrow_history[key].append({
                                "time": current_second,
                                "value": current_val,
                                "arrow": arrow
                            })
                        else:
                            arrow_history[key][-1]["value"] = current_val
                            arrow_history[key][-1]["arrow"] = arrow
                        # Cap history to three hours worth (180 entries)
                        if len(arrow_history[key]) > MAX_HISTORY_ENTRIES:
                            arrow_history[key] = arrow_history[key][-MAX_HISTORY_ENTRIES:]

                # --- Aggregate arrow_history by minute for the graph ---
                aggregated_history = {}
                for key, entries in arrow_history.items():
                    minute_groups = {}
                    for entry in entries:
                        minute = entry["time"][:5]  # extract HH:MM
                        minute_groups[minute] = entry  # take last entry for that minute
                    aggregated_history[key] = list(minute_groups.values())
                metrics["arrow_history"] = aggregated_history
                metrics["history"] = hashrate_history

                global metrics_log
                entry = {"timestamp": datetime.now().isoformat(), "metrics": metrics}
                metrics_log.append(entry)
                # Cap the metrics log to three hours worth (180 entries)
                if len(metrics_log) > MAX_HISTORY_ENTRIES:
                    metrics_log = metrics_log[-MAX_HISTORY_ENTRIES:]

            # --- Add server timestamps to the response in Los Angeles Time ---
            metrics["server_timestamp"] = datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            metrics["server_start_time"] = SERVER_START_TIME.astimezone(ZoneInfo("America/Los_Angeles")).isoformat()

            # Log execution time
            execution_time = time.time() - start_time
            metrics["execution_time"] = execution_time
            if execution_time > 10:
                logging.warning(f"Metrics fetch took {execution_time:.2f} seconds")
            else:
                logging.info(f"Metrics fetch completed in {execution_time:.2f} seconds")

            return metrics
            
        except Exception as e:
            logging.error(f"Unexpected error in fetch_metrics: {e}")
            return None

# --- Workers Dashboard Functions ---
def get_workers_data(force_refresh=False):
    """Get worker data from Ocean.xyz with caching for better performance."""
    global worker_data_cache, last_worker_data_update
    
    current_time = time.time()
    
    # Return cached data if it's still fresh and not forced to refresh
    if not force_refresh and worker_data_cache and last_worker_data_update and \
       (current_time - last_worker_data_update) < WORKER_DATA_CACHE_TIMEOUT:
        logging.info("Using cached worker data")
        return worker_data_cache
        
    try:
        # If metrics aren't available yet, return default data
        if not cached_metrics:
            return generate_default_workers_data()
            
        # Check if we have workers_hashing information
        workers_count = cached_metrics.get("workers_hashing", 0)
        if workers_count <= 0:
            return generate_default_workers_data()
            
        # Calculate total hashrate from cached metrics
        hashrate_3hr = float(cached_metrics.get("hashrate_3hr", 0) or 0)
        hashrate_unit = cached_metrics.get("hashrate_3hr_unit", "TH/s")
        
        # Generate worker data based on the number of active workers
        workers_data = generate_workers_data(workers_count, hashrate_3hr, hashrate_unit)
        
        # Calculate total statistics
        workers_online = len([w for w in workers_data if w['status'] == 'online'])
        workers_offline = len(workers_data) - workers_online
        total_hashrate = sum([float(w.get('hashrate_3hr', 0) or 0) for w in workers_data])
        total_earnings = sum([float(w.get('earnings', 0) or 0) for w in workers_data])
        avg_acceptance_rate = sum([float(w.get('acceptance_rate', 0) or 0) for w in workers_data]) / len(workers_data) if workers_data else 0
        
        # Calculate daily sats using the same formula as in the main dashboard
        daily_sats = cached_metrics.get("daily_mined_sats", 0)
        
        # Create hashrate history based on arrow_history if available
        hashrate_history = []
        if cached_metrics.get("arrow_history") and cached_metrics["arrow_history"].get("hashrate_3hr"):
            hashrate_history = cached_metrics["arrow_history"]["hashrate_3hr"]
        
        result = {
            "workers": workers_data,
            "workers_total": len(workers_data),
            "workers_online": workers_online,
            "workers_offline": workers_offline,
            "total_hashrate": total_hashrate,
            "hashrate_unit": hashrate_unit,
            "total_earnings": total_earnings,
            "daily_sats": daily_sats,
            "avg_acceptance_rate": avg_acceptance_rate,
            "hashrate_history": hashrate_history,
            "timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
        }
        
        # Update cache
        worker_data_cache = result
        last_worker_data_update = current_time
        
        return result
    except Exception as e:
        logging.error(f"Error getting worker data: {e}")
        return generate_default_workers_data()

# Modified generate_workers_data function for App.py

def generate_workers_data(num_workers, total_hashrate, hashrate_unit):
    """Generate simulated worker data based on total hashrate, ensuring total matches exactly."""
    # Worker model types for simulation
    models = [
        {"type": "ASIC", "model": "Bitmain Antminer S19 Pro", "max_hashrate": 110, "power": 3250},
        {"type": "ASIC", "model": "MicroBT Whatsminer M50S", "max_hashrate": 130, "power": 3276},
        {"type": "ASIC", "model": "Bitmain Antminer S19j Pro", "max_hashrate": 104, "power": 3150},
        {"type": "FPGA", "model": "BitAxe FPGA Miner", "max_hashrate": 3.2, "power": 35}
    ]
    
    # Worker names for simulation
    prefixes = ["Antminer", "Whatsminer", "Miner", "Rig", "Node", "Worker", "BitAxe", "BTC"]
    
    # Calculate hashrate distribution - majority of hashrate to online workers
    online_count = max(1, int(num_workers * 0.8))  # At least 1 online worker
    offline_count = num_workers - online_count
    
    # Average hashrate per online worker
    avg_hashrate = total_hashrate / online_count if online_count > 0 else 0
    
    workers = []
    current_time = datetime.now(ZoneInfo("America/Los_Angeles"))
    
    # Generate online workers
    for i in range(online_count):
        # Select a model based on hashrate
        model_info = models[0] if avg_hashrate > 50 else models[-1] if avg_hashrate < 5 else random.choice(models)
        
        # For Antminers and regular ASICs, use ASIC model
        if i < online_count - 1 or avg_hashrate > 5:
            model_idx = random.randint(0, len(models) - 2)  # Exclude FPGA for most workers
        else:
            model_idx = len(models) - 1  # FPGA for last worker if small hashrate
            
        model_info = models[model_idx]
        
        # Generate hashrate with some random variation
        base_hashrate = min(model_info["max_hashrate"], avg_hashrate * random.uniform(0.5, 1.5))
        hashrate_60sec = round(base_hashrate * random.uniform(0.9, 1.1), 2)
        hashrate_3hr = round(base_hashrate * random.uniform(0.85, 1.0), 2)
        
        # Generate last share time (within last 5 minutes)
        minutes_ago = random.randint(0, 5)
        last_share = (current_time - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%d %H:%M")
        
        # Generate earnings proportional to hashrate
        hashrate_proportion = hashrate_3hr / total_hashrate if total_hashrate > 0 else 0
        earnings = round(0.001 * hashrate_proportion, 8)  # Example: 0.001 BTC total distributed by hashrate
        
        # Generate acceptance rate (95-100%)
        acceptance_rate = round(random.uniform(95, 100), 1)
        
        # Generate temperature (normal operating range)
        temperature = random.randint(55, 70) if model_info["type"] == "ASIC" else random.randint(45, 55)
        
        # Create a unique name
        if model_info["type"] == "FPGA":
            name = f"{prefixes[-1]}{random.randint(1, 99):02d}"
        else:
            name = f"{random.choice(prefixes[:-1])}{random.randint(1, 99):02d}"
        
        workers.append({
            "name": name,
            "status": "online",
            "type": model_info["type"],
            "model": model_info["model"],
            "hashrate_60sec": hashrate_60sec,
            "hashrate_60sec_unit": hashrate_unit,
            "hashrate_3hr": hashrate_3hr,
            "hashrate_3hr_unit": hashrate_unit,
            "efficiency": round(random.uniform(65, 95), 1),
            "last_share": last_share,
            "earnings": earnings,
            "acceptance_rate": acceptance_rate,
            "power_consumption": model_info["power"],
            "temperature": temperature
        })
    
    # Generate offline workers
    for i in range(offline_count):
        # Select a model - more likely to be FPGA for offline
        if random.random() > 0.6:
            model_info = models[-1]  # FPGA
        else:
            model_info = random.choice(models[:-1])  # ASIC
            
        # Generate last share time (0.5 to 8 hours ago)
        hours_ago = random.uniform(0.5, 8)
        last_share = (current_time - timedelta(hours=hours_ago)).strftime("%Y-%m-%d %H:%M")
        
        # Generate hashrate (historical before going offline)
        if model_info["type"] == "FPGA":
            hashrate_3hr = round(random.uniform(1, 3), 2)
        else:
            hashrate_3hr = round(random.uniform(20, 90), 2)
            
        # Create a unique name
        if model_info["type"] == "FPGA":
            name = f"{prefixes[-1]}{random.randint(1, 99):02d}"
        else:
            name = f"{random.choice(prefixes[:-1])}{random.randint(1, 99):02d}"
        
        workers.append({
            "name": name,
            "status": "offline",
            "type": model_info["type"],
            "model": model_info["model"],
            "hashrate_60sec": 0,
            "hashrate_60sec_unit": hashrate_unit,
            "hashrate_3hr": hashrate_3hr,
            "hashrate_3hr_unit": hashrate_unit,
            "efficiency": 0,
            "last_share": last_share,
            "earnings": round(0.0001 * random.random(), 8),
            "acceptance_rate": round(random.uniform(95, 99), 1),
            "power_consumption": 0,
            "temperature": 0
        })

    # --- NEW CODE FOR HASHRATE ALIGNMENT ---
    # Calculate the current sum of online worker hashrates
    current_total = sum(w["hashrate_3hr"] for w in workers if w["status"] == "online")
    
    # If we have online workers and the total doesn't match, apply a scaling factor
    if online_count > 0 and abs(current_total - total_hashrate) > 0.01:
        scaling_factor = total_hashrate / current_total if current_total > 0 else 1
        
        # Apply scaling to all online workers
        for worker in workers:
            if worker["status"] == "online":
                # Scale the 3hr hashrate to exactly match total
                worker["hashrate_3hr"] = round(worker["hashrate_3hr"] * scaling_factor, 2)
                
                # Scale the 60sec hashrate proportionally
                if worker["hashrate_60sec"] > 0:
                    worker["hashrate_60sec"] = round(worker["hashrate_60sec"] * scaling_factor, 2)
        
        # Verify the total now matches
        new_total = sum(w["hashrate_3hr"] for w in workers if w["status"] == "online")
        logging.info(f"Adjusted worker hashrates: {current_total} → {new_total} (target: {total_hashrate})")
    
    return workers

# Modified get_workers_data function with exact hashrate handling

def get_workers_data(force_refresh=False):
    """Get worker data with guaranteed exact hashrate match."""
    global worker_data_cache, last_worker_data_update
    
    current_time = time.time()
    
    # Return cached data if it's still fresh and not forced to refresh
    if not force_refresh and worker_data_cache and last_worker_data_update and \
       (current_time - last_worker_data_update) < WORKER_DATA_CACHE_TIMEOUT:
        logging.info("Using cached worker data")
        return worker_data_cache
        
    try:
        # If metrics aren't available yet, return default data
        if not cached_metrics:
            return generate_default_workers_data()
            
        # Check if we have workers_hashing information
        workers_count = cached_metrics.get("workers_hashing", 0)
        if workers_count <= 0:
            return generate_default_workers_data()
            
        # Get hashrate from cached metrics - using EXACT value
        # Store this ORIGINAL value to ensure it's never changed in calculations
        original_hashrate_3hr = float(cached_metrics.get("hashrate_3hr", 0) or 0)
        hashrate_unit = cached_metrics.get("hashrate_3hr_unit", "TH/s")
        
        # Generate worker data based on the number of active workers
        workers_data = generate_workers_data(workers_count, original_hashrate_3hr, hashrate_unit)
        
        # Calculate basic statistics
        workers_online = len([w for w in workers_data if w['status'] == 'online'])
        workers_offline = len(workers_data) - workers_online
        total_earnings = sum([float(w.get('earnings', 0) or 0) for w in workers_data])
        avg_acceptance_rate = sum([float(w.get('acceptance_rate', 0) or 0) for w in workers_data]) / len(workers_data) if workers_data else 0
        
        # IMPORTANT: Use the EXACT original value for total_hashrate
        # Do NOT recalculate it from worker data
        total_hashrate = original_hashrate_3hr
        
        # Daily sats from main dashboard
        daily_sats = cached_metrics.get("daily_mined_sats", 0)
        
        # Create hashrate history based on arrow_history if available
        hashrate_history = []
        if cached_metrics.get("arrow_history") and cached_metrics["arrow_history"].get("hashrate_3hr"):
            hashrate_history = cached_metrics["arrow_history"]["hashrate_3hr"]
        
        result = {
            "workers": workers_data,
            "workers_total": len(workers_data),
            "workers_online": workers_online,
            "workers_offline": workers_offline,
            "total_hashrate": total_hashrate,  # EXACT value from main dashboard
            "hashrate_unit": hashrate_unit,
            "total_earnings": total_earnings,
            "daily_sats": daily_sats,
            "avg_acceptance_rate": avg_acceptance_rate,
            "hashrate_history": hashrate_history,
            "timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
        }
        
        # Update cache
        worker_data_cache = result
        last_worker_data_update = current_time
        
        return result
    except Exception as e:
        logging.error(f"Error getting worker data: {e}")
        return generate_default_workers_data()

# --- New Time Endpoint for Fine Syncing ---
@app.route("/api/time")
def api_time():
    return jsonify({
        "server_timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat(),
        "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo("America/Los_Angeles")).isoformat()
    })

# --- Workers Dashboard Route and API ---
@app.route("/workers")
def workers_dashboard():
    """Serve the workers overview dashboard page."""
    current_time = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %I:%M:%S %p")
    
    # Only get minimal worker stats for initial page load
    # Client-side JS will fetch the full data via API
    workers_data = get_workers_data()
    
    return render_template("workers.html", 
                           current_time=current_time,
                           workers_total=workers_data.get('workers_total', 0),
                           workers_online=workers_data.get('workers_online', 0),
                           workers_offline=workers_data.get('workers_offline', 0),
                           total_hashrate=workers_data.get('total_hashrate', 0),
                           hashrate_unit=workers_data.get('hashrate_unit', 'TH/s'),
                           total_earnings=workers_data.get('total_earnings', 0),
                           daily_sats=workers_data.get('daily_sats', 0),
                           avg_acceptance_rate=workers_data.get('avg_acceptance_rate', 0))

@app.route("/api/workers")
def api_workers():
    """API endpoint for worker data."""
    # Get the force_refresh parameter from the query string (default: False)
    force_refresh = request.args.get('force', 'false').lower() == 'true'
    return jsonify(get_workers_data(force_refresh=force_refresh))

# --- Modified update_metrics_job function ---
def update_metrics_job(force=False):
    global cached_metrics, last_metrics_update_time, scheduler, scheduler_last_successful_run
    
    try:
        # Check scheduler health - enhanced logic to detect failed executors
        if not scheduler or not hasattr(scheduler, 'running'):
            logging.error("Scheduler object is invalid, attempting to recreate")
            with scheduler_recreate_lock:
                create_scheduler()
            return
            
        if not scheduler.running:
            logging.warning("Scheduler stopped unexpectedly, attempting to restart")
            try:
                scheduler.start()
                logging.info("Scheduler restarted successfully")
            except Exception as e:
                logging.error(f"Failed to restart scheduler: {e}")
                # More aggressive recovery - recreate scheduler entirely
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        
        # Test the scheduler's executor by checking its state
        try:
            # Check if any jobs exist and are scheduled 
            jobs = scheduler.get_jobs()
            if not jobs:
                logging.error("No jobs found in scheduler - recreating")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
                
            # Check if the next run time is set for any job
            next_runs = [job.next_run_time for job in jobs]
            if not any(next_runs):
                logging.error("No jobs with next_run_time found - recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except RuntimeError as e:
            # Properly handle the "cannot schedule new futures after shutdown" error
            if "cannot schedule new futures after shutdown" in str(e):
                logging.error("Detected dead executor, recreating scheduler")
                with scheduler_recreate_lock:
                    create_scheduler()
                return
        except Exception as e:
            logging.error(f"Error checking scheduler state: {e}")
        
        # Skip update if the last one was too recent (prevents overlapping runs)
        # Unless force=True is specified
        current_time = time.time()
        if not force and last_metrics_update_time and (current_time - last_metrics_update_time < 30):
            logging.info("Skipping metrics update - previous update too recent")
            return
            
        # Set last update time to now
        last_metrics_update_time = current_time
        
        # Add timeout handling with a timer
        job_timeout = 45  # seconds
        job_successful = False
        
        def timeout_handler():
            if not job_successful:
                logging.error("Background job timed out after 45 seconds")
        
        # Set timeout timer
        timer = threading.Timer(job_timeout, timeout_handler)
        timer.daemon = True
        timer.start()
        
        try:
            # Correctly call the dashboard instance's fetch_metrics method
            metrics = dashboard.fetch_metrics()
            if metrics:
                global cached_metrics
                cached_metrics = metrics
                logging.info("Background job: Metrics updated successfully")
                job_successful = True
                
                # Mark successful run time for watchdog
                global scheduler_last_successful_run
                scheduler_last_successful_run = time.time()

                persist_critical_state()
                
                # Periodically check and prune data to prevent memory growth
                if current_time % 300 < 60:  # Every ~5 minutes
                    prune_old_data()
                    
                # Only save state to Redis on a similar schedule, not every update
                if current_time % 300 < 60:  # Every ~5 minutes
                    save_graph_state()
                    
                # Periodic full memory cleanup (every 2 hours)
                if current_time % 7200 < 60:  # Every ~2 hours
                    logging.info("Performing full memory cleanup")
                    gc.collect(generation=2)  # Force full collection
                
                # CHANGE: Removed the worker data preparation from here
                # No longer attaching workers_data to cached_metrics
            else:
                logging.error("Background job: Metrics update returned None")
        except Exception as e:
            logging.error(f"Background job: Unexpected error: {e}")
            import traceback
            logging.error(traceback.format_exc())
            log_memory_usage()
        finally:
            # Cancel timer in finally block to ensure it's always canceled
            timer.cancel()
    except Exception as e:
        logging.error(f"Background job: Unhandled exception: {e}")
        import traceback
        logging.error(traceback.format_exc())

# --- Fixed SSE Endpoint with proper request context handling ---
@app.route('/stream')
def stream():
    # Important: Capture any request context information BEFORE the generator
    # This ensures we're not trying to access request outside its context
    
    def event_stream():
        global active_sse_connections, cached_metrics
        client_id = None
        
        try:
            # Check if we're at the connection limit
            with sse_connections_lock:
                if active_sse_connections >= MAX_SSE_CONNECTIONS:
                    logging.warning(f"Connection limit reached ({MAX_SSE_CONNECTIONS}), refusing new SSE connection")
                    yield f"data: {{\"error\": \"Too many connections, please try again later\", \"retry\": 5000}}\n\n"
                    return
                
                active_sse_connections += 1
                client_id = f"client-{int(time.time() * 1000) % 10000}"
                logging.info(f"SSE {client_id}: Connection established (total: {active_sse_connections})")
            
            # Set a maximum connection time - increased to 15 minutes for better user experience
            end_time = time.time() + MAX_SSE_CONNECTION_TIME
            last_timestamp = None
            
            # Send initial data immediately to prevent delay in dashboard updates
            if cached_metrics:
                yield f"data: {json.dumps(cached_metrics)}\n\n"
                last_timestamp = cached_metrics.get("server_timestamp")
            else:
                # Send ping if no data available yet
                yield f"data: {{\"type\": \"ping\", \"client_id\": \"{client_id}\"}}\n\n"
            
            # Main event loop with improved error handling
            while time.time() < end_time:
                try:
                    # Send data only if it's changed
                    if cached_metrics and cached_metrics.get("server_timestamp") != last_timestamp:
                        data = json.dumps(cached_metrics)
                        last_timestamp = cached_metrics.get("server_timestamp")
                        yield f"data: {data}\n\n"
                    
                    # Send regular pings about every 30 seconds to keep connection alive
                    if int(time.time()) % 30 == 0:
                        yield f"data: {{\"type\": \"ping\", \"time\": {int(time.time())}, \"connections\": {active_sse_connections}}}\n\n"
                    
                    # Sleep to reduce CPU usage
                    time.sleep(1)
                    
                    # Warn client 60 seconds before timeout so client can prepare to reconnect
                    remaining_time = end_time - time.time()
                    if remaining_time < 60 and int(remaining_time) % 15 == 0:  # Every 15 sec in last minute
                        yield f"data: {{\"type\": \"timeout_warning\", \"remaining\": {int(remaining_time)}}}\n\n"
                    
                except Exception as e:
                    logging.error(f"SSE {client_id}: Error in stream: {e}")
                    time.sleep(2)  # Prevent tight error loops
            
            # Connection timeout reached - send a reconnect instruction to client
            logging.info(f"SSE {client_id}: Connection timeout reached ({MAX_SSE_CONNECTION_TIME}s)")
            yield f"data: {{\"type\": \"timeout\", \"message\": \"Connection timeout reached\", \"reconnect\": true}}\n\n"
            
        except GeneratorExit:
            # This is how we detect client disconnection
            logging.info(f"SSE {client_id}: Client disconnected (GeneratorExit)")
            # Don't yield here - just let the generator exit normally
            
        finally:
            # Always decrement the connection counter when done
            with sse_connections_lock:
                active_sse_connections = max(0, active_sse_connections - 1)
                logging.info(f"SSE {client_id}: Connection closed (remaining: {active_sse_connections})")
    
    # Configure response with improved error handling
    try:
        response = Response(event_stream(), mimetype="text/event-stream")
        response.headers['Cache-Control'] = 'no-cache'
        response.headers['X-Accel-Buffering'] = 'no'  # Disable nginx buffering
        response.headers['Access-Control-Allow-Origin'] = '*'  # Allow CORS
        return response
    except Exception as e:
        logging.error(f"Error creating SSE response: {e}")
        return jsonify({"error": "Internal server error"}), 500

# Duplicate stream endpoint for the dashboard path
@app.route('/dashboard/stream')
def dashboard_stream():
    """Duplicate of the stream endpoint for the dashboard route."""
    return stream()

# --- SchedulerWatchdog to monitor and recover ---
def scheduler_watchdog():
    """Periodically check if the scheduler is running and healthy"""
    global scheduler, scheduler_last_successful_run
    
    try:
        # If no successful run in past 2 minutes, consider the scheduler dead
        if (scheduler_last_successful_run is None or
            time.time() - scheduler_last_successful_run > 120):
            logging.warning("Scheduler watchdog: No successful runs detected in last 2 minutes")
            
            # Check if actual scheduler exists and is reported as running
            if not scheduler or not getattr(scheduler, 'running', False):
                logging.error("Scheduler watchdog: Scheduler appears to be dead, recreating")
                
                # Use the lock to avoid multiple threads recreating simultaneously
                with scheduler_recreate_lock:
                    create_scheduler()
    except Exception as e:
        logging.error(f"Error in scheduler watchdog: {e}")

# --- Create Scheduler ---
def create_scheduler():
    """Create and configure a new scheduler instance with proper error handling."""
    try:
        # Stop existing scheduler if it exists
        global scheduler
        if 'scheduler' in globals() and scheduler:
            try:
                # Check if scheduler is running before attempting to shut it down
                if hasattr(scheduler, 'running') and scheduler.running:
                    logging.info("Shutting down existing scheduler before creating a new one")
                    scheduler.shutdown(wait=False)
            except Exception as e:
                logging.error(f"Error shutting down existing scheduler: {e}")
        
        # Create a new scheduler with more robust configuration
        new_scheduler = BackgroundScheduler(
            job_defaults={
                'coalesce': True,  # Combine multiple missed runs into a single one
                'max_instances': 1,  # Prevent job overlaps
                'misfire_grace_time': 30  # Allow misfires up to 30 seconds
            }
        )
        
        # Add the update job
        new_scheduler.add_job(
            func=update_metrics_job,
            trigger="interval",
            seconds=60,
            id='update_metrics_job',
            replace_existing=True
        )
        
        # Add watchdog job - runs every 30 seconds to check scheduler health
        new_scheduler.add_job(
            func=scheduler_watchdog,
            trigger="interval",
            seconds=30,
            id='scheduler_watchdog',
            replace_existing=True
        )
        
        # Start the scheduler
        new_scheduler.start()
        logging.info("Scheduler created and started successfully")
        return new_scheduler
    except Exception as e:
        logging.error(f"Error creating scheduler: {e}")
        return None

# --- Routes ---
@app.route("/")
def boot():
    """Serve the boot sequence page."""
    return render_template("boot.html", base_url=request.host_url.rstrip('/'))

# --- Updated Dashboard Route ---
@app.route("/dashboard")
def dashboard():
    """Serve the main dashboard page."""
    global cached_metrics, last_metrics_update_time
    
    # Make sure we have metrics data before rendering the template
    if cached_metrics is None:
        # Force an immediate metrics fetch regardless of the time since last update
        logging.info("Dashboard accessed with no cached metrics - forcing immediate fetch")
        try:
            # Force update with the force parameter
            update_metrics_job(force=True)
        except Exception as e:
            logging.error(f"Error during forced metrics fetch: {e}")
        
        # If still None after our attempt, create default metrics
        if cached_metrics is None:
            default_metrics = {
                "server_timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat(),
                "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo("America/Los_Angeles")).isoformat(),
                "hashrate_24hr": None,
                "hashrate_24hr_unit": "TH/s",
                "hashrate_3hr": None,
                "hashrate_3hr_unit": "TH/s",
                "hashrate_10min": None,
                "hashrate_10min_unit": "TH/s",
                "hashrate_60sec": None,
                "hashrate_60sec_unit": "TH/s",
                "pool_total_hashrate": None,
                "pool_total_hashrate_unit": "TH/s",
                "workers_hashing": 0,
                "total_last_share": None,
                "block_number": None,
                "btc_price": 0,
                "network_hashrate": 0,
                "difficulty": 0,
                "daily_revenue": 0,
                "daily_power_cost": 0,
                "daily_profit_usd": 0,
                "monthly_profit_usd": 0,
                "daily_mined_sats": 0,
                "monthly_mined_sats": 0,
                "unpaid_earnings": "0",
                "est_time_to_payout": None,
                "last_block_height": None,
                "last_block_time": None,
                "last_block_earnings": None,
                "blocks_found": "0",
                "estimated_earnings_per_day_sats": 0,
                "estimated_earnings_next_block_sats": 0,
                "estimated_rewards_in_window_sats": 0,
                "arrow_history": {}
            }
            logging.warning("Rendering dashboard with default metrics - no data available yet")
            current_time = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %I:%M:%S %p")
            return render_template("index.html", metrics=default_metrics, current_time=current_time)
    
    # If we have metrics, use them
    current_time = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%Y-%m-%d %I:%M:%S %p")
    return render_template("index.html", metrics=cached_metrics, current_time=current_time)

@app.route("/api/metrics")
def api_metrics():
    if cached_metrics is None:
        update_metrics_job()
    return jsonify(cached_metrics)

# Health check endpoint with detailed diagnostics
@app.route("/api/health")
def health_check():
    """Health check endpoint with enhanced system diagnostics."""
    # Calculate uptime
    uptime_seconds = (datetime.now(ZoneInfo("America/Los_Angeles")) - SERVER_START_TIME).total_seconds()
    
    # Get process memory usage
    try:
        process = psutil.Process(os.getpid())
        mem_info = process.memory_info()
        memory_usage_mb = mem_info.rss / 1024 / 1024
        memory_percent = process.memory_percent()
    except Exception as e:
        logging.error(f"Error getting memory usage: {e}")
        memory_usage_mb = 0
        memory_percent = 0
    
    # Check data freshness
    data_age = 0
    if cached_metrics and cached_metrics.get("server_timestamp"):
        try:
            last_update = datetime.fromisoformat(cached_metrics["server_timestamp"])
            data_age = (datetime.now(ZoneInfo("America/Los_Angeles")) - last_update).total_seconds()
        except Exception as e:
            logging.error(f"Error calculating data age: {e}")
    
    # Determine health status
    health_status = "healthy"
    if data_age > 300:  # Data older than 5 minutes
        health_status = "degraded"
    if not cached_metrics:
        health_status = "unhealthy"
    
    # Build response with detailed diagnostics
    status = {
        "status": health_status,
        "uptime": uptime_seconds,
        "uptime_formatted": f"{int(uptime_seconds // 3600)}h {int((uptime_seconds % 3600) // 60)}m {int(uptime_seconds % 60)}s",
        "connections": active_sse_connections,
        "memory": {
            "usage_mb": round(memory_usage_mb, 2),
            "percent": round(memory_percent, 2)
        },
        "data": {
            "last_update": cached_metrics.get("server_timestamp") if cached_metrics else None,
            "age_seconds": int(data_age),
            "available": cached_metrics is not None
        },
        "scheduler": {
            "running": scheduler.running if hasattr(scheduler, "running") else False,
            "last_successful_run": scheduler_last_successful_run
        },
        "redis": {
            "connected": redis_client is not None
        },
        "timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
    }
    
    # Log health check if status is not healthy
    if health_status != "healthy":
        logging.warning(f"Health check returning {health_status} status: {status}")
    
    return jsonify(status)

# Add enhanced scheduler health check endpoint
@app.route("/api/scheduler-health")
def scheduler_health():
    try:
        scheduler_status = {
            "running": scheduler.running if hasattr(scheduler, "running") else False,
            "job_count": len(scheduler.get_jobs()) if hasattr(scheduler, "get_jobs") else 0,
            "next_run": str(scheduler.get_jobs()[0].next_run_time) if hasattr(scheduler, "get_jobs") and scheduler.get_jobs() else None,
            "last_update": last_metrics_update_time,
            "time_since_update": time.time() - last_metrics_update_time if last_metrics_update_time else None,
            "last_successful_run": scheduler_last_successful_run,
            "time_since_successful": time.time() - scheduler_last_successful_run if scheduler_last_successful_run else None
        }
        return jsonify(scheduler_status)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Add a health check route that can attempt to fix the scheduler if needed
@app.route("/api/fix-scheduler", methods=["POST"])
def fix_scheduler():
    try:
        with scheduler_recreate_lock:
            new_scheduler = create_scheduler()
            if new_scheduler:
                global scheduler
                scheduler = new_scheduler
                return jsonify({"status": "success", "message": "Scheduler recreated successfully"})
            else:
                return jsonify({"status": "error", "message": "Failed to recreate scheduler"}), 500
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.errorhandler(404)
def page_not_found(e):
    return render_template("error.html", message="Page not found."), 404

@app.errorhandler(500)
def internal_server_error(e):
    logging.error("Internal server error: %s", e)
    return render_template("error.html", message="Internal server error."), 500

@app.route("/api/force-refresh", methods=["POST"])
def force_refresh():
    """Emergency endpoint to force metrics refresh."""
    logging.warning("Emergency force-refresh requested")
    try:
        # Force fetch new metrics
        metrics = dashboard.fetch_metrics()
        if metrics:
            global cached_metrics, scheduler_last_successful_run
            cached_metrics = metrics
            scheduler_last_successful_run = time.time()
            logging.info(f"Force refresh successful, new timestamp: {metrics['server_timestamp']}")
            return jsonify({"status": "success", "message": "Metrics refreshed", "timestamp": metrics['server_timestamp']})
        else:
            return jsonify({"status": "error", "message": "Failed to fetch metrics"}), 500
    except Exception as e:
        logging.error(f"Force refresh error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

class RobustMiddleware:
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        try:
            return self.app(environ, start_response)
        except Exception as e:
            logging.exception("Unhandled exception in WSGI app")
            start_response("500 Internal Server Error", [("Content-Type", "text/html")])
            return [b"<h1>Internal Server Error</h1>"]

app.wsgi_app = RobustMiddleware(app.wsgi_app)

# Initialize the dashboard and background scheduler
config = load_config()
dashboard = MiningDashboardWeb(
    config.get("power_cost", 0.0),
    config.get("power_usage", 0.0),
    config.get("wallet")
)

# Initialize the scheduler using our new function
scheduler = create_scheduler()

# Graceful shutdown handler for clean termination
def graceful_shutdown(signum, frame):
    """Handle shutdown signals gracefully"""
    logging.info(f"Received shutdown signal {signum}, shutting down gracefully")
    
    # Save state before shutting down
    save_graph_state()
    
    # Stop the scheduler
    if scheduler:
        try:
            scheduler.shutdown(wait=True) # wait for running jobs to complete
            logging.info("Scheduler shutdown complete")
        except Exception as e:
            logging.error(f"Error shutting down scheduler: {e}")
    
    # Log connection info before exit
    logging.info(f"Active SSE connections at shutdown: {active_sse_connections}")
    
    # Exit with success code
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT, graceful_shutdown)

# Worker pre and post fork hooks to handle Gunicorn worker cycling
def worker_exit(server, worker):
    """Handle worker shutdown gracefully"""
    logging.info("Worker exit detected, shutting down scheduler")
    if 'scheduler' in globals() and scheduler:
        try:
            scheduler.shutdown(wait=False)
            logging.info("Scheduler shutdown on worker exit")
        except Exception as e:
            logging.error(f"Error shutting down scheduler on worker exit: {e}")

# Handle worker initialization
def on_starting(server):
    """Initialize shared resources before workers start"""
    logging.info("Gunicorn server starting")

# Add this near the end of App.py, after scheduler initialization
logging.info("Signal handlers registered for graceful shutdown")

# --- Critical state recovery function ---
def load_critical_state():
    """Recover critical state variables after a worker restart"""
    global cached_metrics, scheduler_last_successful_run, last_metrics_update_time
    if redis_client:
        try:
            state_json = redis_client.get("critical_state")
            if state_json:
                state = json.loads(state_json.decode('utf-8'))
                if state.get("last_successful_run"):
                    scheduler_last_successful_run = state.get("last_successful_run")
                if state.get("last_update_time"):
                    last_metrics_update_time = state.get("last_update_time")
                logging.info(f"Loaded critical state from Redis, last run: {scheduler_last_successful_run}")
                
                # We don't restore cached_metrics itself, as we'll fetch fresh data
                # Just note that we have state to recover from
                logging.info(f"Last metrics timestamp from Redis: {state.get('cached_metrics_timestamp')}")
        except Exception as e:
            logging.error(f"Error loading critical state: {e}")

# Register signal handlers
signal.signal(signal.SIGTERM, graceful_shutdown)
signal.signal(signal.SIGINT, graceful_shutdown)

# Add this near the end of App.py, after scheduler initialization
logging.info("Signal handlers registered for graceful shutdown")

# Load critical state if available
load_critical_state()

# Run once at startup.
update_metrics_job(force=True)

if __name__ == "__main__":
    # When deploying with Gunicorn in Docker, run with --workers=1 --threads=8 to ensure global state is shared.
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
