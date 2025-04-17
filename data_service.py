"""
Data service module for fetching and processing mining data.
"""
import logging
import re
import time
import json
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor
import requests
from bs4 import BeautifulSoup

from models import OceanData, WorkerData, convert_to_ths

class MiningDashboardService:
    """Service for fetching and processing mining dashboard data."""
    
    def __init__(self, power_cost, power_usage, wallet):
        """
        Initialize the mining dashboard service.
        
        Args:
            power_cost (float): Cost of power in $ per kWh
            power_usage (float): Power usage in watts
            wallet (str): Bitcoin wallet address for Ocean.xyz
        """
        self.power_cost = power_cost
        self.power_usage = power_usage
        self.wallet = wallet
        self.cache = {}
        self.sats_per_btc = 100_000_000
        self.previous_values = {}
        self.session = requests.Session()
        
        # New Ocean.xyz Beta API base URL
        self.ocean_api_base = "https://api.ocean.xyz/v1"
        
        # Test API connectivity
        self.api_available = self._test_api_connectivity()
        if self.api_available:
            logging.info("Ocean.xyz Beta API is available")
        else:
            logging.warning("Ocean.xyz Beta API is not available, will use fallback methods")

    def _test_api_connectivity(self):
        """Test if the new Ocean.xyz Beta API is available."""
        try:
            # Add helpful headers to increase chances of successful connection
            headers = {
                'User-Agent': 'Mozilla/5.0 Mining Dashboard',
                'Accept': 'application/json, text/plain, */*',
                'Cache-Control': 'no-cache'
            }
            
            # Try the wallet-specific ping endpoint first (this is what works)
            wallet_ping_url = f"{self.ocean_api_base}/ping/{self.wallet}"
            logging.info(f"Testing Ocean API connectivity: {wallet_ping_url}")
            
            response = self.session.get(wallet_ping_url, headers=headers, timeout=5)
            if response.ok:
                logging.info(f"Ocean.xyz Beta API is available through wallet-specific ping: {response.text[:30]}")
                return True
                
            # Log the failed attempt details
            logging.warning(f"Wallet-specific ping failed with status: {response.status_code}, response: {response.text[:100]}")
            
            # Try a different endpoint as backup
            statsnap_url = f"{self.ocean_api_base}/statsnap/{self.wallet}"
            logging.info(f"Trying alternate endpoint: {statsnap_url}")
            
            response = self.session.get(statsnap_url, headers=headers, timeout=5)
            if response.ok:
                logging.info("Ocean.xyz Beta API is available through statsnap endpoint")
                return True
            
            # Log all failed attempts and return False
            logging.error("All Ocean.xyz API connectivity tests failed")
            logging.error(f"Last response status: {response.status_code}, text: {response.text[:200]}")
            return False
            
        except Exception as e:
            logging.error(f"Error testing Ocean.xyz Beta API connectivity: {e}")
            return False

    def _api_request_with_retry(self, endpoint, timeout=10, retries=3):
        """Make an API request with retry logic."""
        url = f"{self.ocean_api_base}/{endpoint}"
        logging.info(f"API request: {url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 Mining Dashboard',
            'Accept': 'application/json, text/plain, */*',
            'Cache-Control': 'no-cache'
        }
        
        for attempt in range(retries):
            try:
                response = self.session.get(url, headers=headers, timeout=timeout)
                if response.ok:
                    return response
                
                logging.warning(f"API request failed (attempt {attempt+1}/{retries}): {url}, status: {response.status_code}")
                if attempt < retries - 1:
                    time.sleep(1)  # Wait before retry
                    
            except Exception as e:
                logging.error(f"API request exception (attempt {attempt+1}/{retries}): {e}")
                if attempt < retries - 1:
                    time.sleep(1)  # Wait before retry
        
        return None

    def fetch_metrics(self):
        """
        Fetch metrics from Ocean.xyz and other sources.
        
        Returns:
            dict: Mining metrics data
        """
        # Add execution time tracking
        start_time = time.time()
        
        try:
            with ThreadPoolExecutor(max_workers=2) as executor:
                # Use different methods based on API availability
                if self.api_available:
                    future_ocean = executor.submit(self.get_ocean_data_from_api)
                else:
                    future_ocean = executor.submit(self.get_ocean_data)
                
                future_btc = executor.submit(self.get_bitcoin_stats)
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
                'last_block_earnings': ocean_data.last_block_earnings
            }
            metrics['estimated_earnings_per_day_sats'] = int(round(estimated_earnings_per_day * self.sats_per_btc))
            metrics['estimated_earnings_next_block_sats'] = int(round(estimated_earnings_next_block * self.sats_per_btc))
            metrics['estimated_rewards_in_window_sats'] = int(round(estimated_rewards_in_window * self.sats_per_btc))

            # --- Add server timestamps to the response in Los Angeles Time ---
            metrics["server_timestamp"] = datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            metrics["server_start_time"] = datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()

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

    def get_ocean_data_from_api(self):
        """
        Get mining data from Ocean.xyz using the Beta API.
        
        Returns:
            OceanData: Ocean.xyz mining data
        """
        data = OceanData()
        
        try:
            # First test if API connectivity is still valid
            if not self._test_api_connectivity():
                logging.warning("API connectivity test failed during data fetch, falling back to scraping")
                return self.get_ocean_data()
            
            # Fetch user hashrate data with retry logic
            hashrate_resp = self._api_request_with_retry(f"user_hashrate/{self.wallet}")
            if not hashrate_resp:
                logging.error("Error fetching hashrate data from API, falling back to scraping")
                return self.get_ocean_data()
                
            hashrate_data = hashrate_resp.json()
            logging.debug(f"Hashrate API response: {str(hashrate_data)[:200]}...")
            
            # Convert and populate hashrates
            if "hashrate_60s" in hashrate_data:
                hashrate_60s = hashrate_data["hashrate_60s"]
                data.hashrate_60sec = self._format_hashrate_value(hashrate_60s)[0]
                data.hashrate_60sec_unit = self._format_hashrate_value(hashrate_60s)[1]
            
            if "hashrate_300s" in hashrate_data:  # 5 minutes
                hashrate_300s = hashrate_data["hashrate_300s"]
                data.hashrate_5min = self._format_hashrate_value(hashrate_300s)[0]
                data.hashrate_5min_unit = self._format_hashrate_value(hashrate_300s)[1]
            
            if "hashrate_600s" in hashrate_data:  # 10 minutes
                hashrate_600s = hashrate_data["hashrate_600s"]
                data.hashrate_10min = self._format_hashrate_value(hashrate_600s)[0]
                data.hashrate_10min_unit = self._format_hashrate_value(hashrate_600s)[1]
            
            if "hashrate_10800s" in hashrate_data:  # 3 hours
                hashrate_3hr = hashrate_data["hashrate_10800s"]
                data.hashrate_3hr = self._format_hashrate_value(hashrate_3hr)[0]
                data.hashrate_3hr_unit = self._format_hashrate_value(hashrate_3hr)[1]
            
            if "hashrate_86400s" in hashrate_data:  # 24 hours
                hashrate_24hr = hashrate_data["hashrate_86400s"]
                data.hashrate_24hr = self._format_hashrate_value(hashrate_24hr)[0]
                data.hashrate_24hr_unit = self._format_hashrate_value(hashrate_24hr)[1]
            
            # Fetch pool stats for pool hashrate
            pool_resp = self._api_request_with_retry("pool_hashrate")
            if pool_resp:
                pool_data = pool_resp.json()
                if "pool_300s" in pool_data:
                    pool_hashrate = pool_data["pool_300s"]
                    data.pool_total_hashrate = self._format_hashrate_value(pool_hashrate)[0]
                    data.pool_total_hashrate_unit = self._format_hashrate_value(pool_hashrate)[1]
            
            # Fetch user's stats for earnings info
            stats_resp = self._api_request_with_retry(f"statsnap/{self.wallet}")
            if stats_resp:
                stats_data = stats_resp.json()
                logging.debug(f"Statsnap API response: {str(stats_data)[:200]}...")
                
                # Get unpaid earnings
                if "unpaid" in stats_data:
                    data.unpaid_earnings = stats_data["unpaid"] / 1e8  # Convert satoshis to BTC
                
                # Get estimated earnings for next block
                if "estimated_earn_next_block" in stats_data:
                    data.estimated_earnings_next_block = stats_data["estimated_earn_next_block"] / 1e8  # Convert satoshis to BTC
                
                # Get shares in window for estimated rewards
                if "shares_in_tides" in stats_data:
                    # This is an approximation - we'd need to calculate based on TIDES formula
                    data.estimated_rewards_in_window = stats_data["estimated_earn_next_block"] / 1e8  # Convert satoshis to BTC
                
                # Get latest share time
                if "lastest_share_ts" in stats_data:  # Note the typo in the API ("lastest" vs "latest")
                    last_share_timestamp = stats_data["lastest_share_ts"]
                    last_share_dt = datetime.fromtimestamp(last_share_timestamp, tz=ZoneInfo("UTC"))
                    la_tz = ZoneInfo("America/Los_Angeles")
                    la_dt = last_share_dt.astimezone(la_tz)
                    data.total_last_share = la_dt.strftime("%Y-%m-%d %I:%M %p")
            
            # Fetch user_hashrate_full to count active workers
            workers_resp = self._api_request_with_retry(f"user_hashrate_full/{self.wallet}")
            if workers_resp:
                workers_data = workers_resp.json()
                if "workers" in workers_data:
                    logging.info(f"Found {len(workers_data['workers'])} workers in API response")
                    # Count non-zero hashrate workers as active
                    data.workers_hashing = sum(1 for worker in workers_data["workers"] 
                                               if worker.get("hashrate_300s", 0) > 0)
                    logging.info(f"Workers currently hashing: {data.workers_hashing}")
            
            # Fetch latest block info
            latest_block_resp = self._api_request_with_retry("latest_block")
            if latest_block_resp:
                latest_block_data = latest_block_resp.json()
                if latest_block_data:
                    # Get the first block in the response
                    block = latest_block_data[0] if isinstance(latest_block_data, list) else latest_block_data
                    
                    if "height" in block:
                        data.last_block_height = str(block["height"])
                    
                    if "ts" in block:
                        # Convert timestamp to readable format
                        try:
                            block_time = datetime.fromisoformat(block["ts"].replace('Z', '+00:00'))
                            la_tz = ZoneInfo("America/Los_Angeles")
                            la_time = block_time.astimezone(la_tz)
                            data.last_block_time = la_time.strftime("%Y-%m-%d %I:%M %p")
                        except Exception as e:
                            logging.error(f"Error converting block timestamp: {e}")
            
            # Fetch blocks for blocks found count
            blocks_resp = self._api_request_with_retry("blocks")
            if blocks_resp:
                blocks_data = blocks_resp.json()
                if isinstance(blocks_data, list):
                    # Count blocks mined by this user
                    user_blocks = [block for block in blocks_data 
                                  if block.get("username") == self.wallet 
                                  and block.get("legacy", False) is False]  # Exclude legacy blocks
                    data.blocks_found = str(len(user_blocks))
            
            # Fetch earnpay for last block earnings
            earnpay_resp = self._api_request_with_retry(f"earnpay/{self.wallet}")
            if earnpay_resp:
                earnpay_data = earnpay_resp.json()
                if "earnings" in earnpay_data and earnpay_data["earnings"]:
                    # Get the latest earning entry
                    latest_earning = earnpay_data["earnings"][0]
                    if "satoshis_net_earned" in latest_earning:
                        data.last_block_earnings = str(latest_earning["satoshis_net_earned"])
            
            # Calculate estimated time to payout
            # This requires more complex logic based on current unpaid amount and payout threshold
            if data.unpaid_earnings:
                payout_threshold = 0.001  # Example threshold in BTC
                # Estimate days to payout based on daily earnings
                if data.estimated_earnings_per_day and data.estimated_earnings_per_day > 0:
                    remaining_btc = payout_threshold - data.unpaid_earnings
                    if remaining_btc <= 0:
                        data.est_time_to_payout = "next block"
                    else:
                        days_to_payout = remaining_btc / data.estimated_earnings_per_day
                        if days_to_payout < 1:
                            data.est_time_to_payout = "1 day"
                        else:
                            data.est_time_to_payout = f"{int(days_to_payout)} days"
                else:
                    data.est_time_to_payout = "unknown"
            
            # Calculate daily earnings estimate
            # This can be derived from estimated_earnings_next_block and average blocks per day
            if data.estimated_earnings_next_block:
                # Rough estimate based on 144 blocks per day average
                data.estimated_earnings_per_day = data.estimated_earnings_next_block * 144
            
            # Log successful API data retrieval
            logging.info("Successfully retrieved Ocean data from API")
            return data
            
        except Exception as e:
            logging.error(f"Error fetching Ocean data from API: {e}")
            # Fall back to scraping method
            logging.info("Falling back to web scraping method")
            return self.get_ocean_data()

    def _format_hashrate_value(self, hashrate_h_per_sec):
        """
        Format hashrate from hashes/sec to appropriate unit.
        
        Args:
            hashrate_h_per_sec (float): Hashrate in hashes per second
            
        Returns:
            tuple: (formatted_value, unit)
        """
        # Define threshold values in hashes/sec
        kh_threshold = 1_000
        mh_threshold = 1_000_000
        gh_threshold = 1_000_000_000
        th_threshold = 1_000_000_000_000
        ph_threshold = 1_000_000_000_000_000
        eh_threshold = 1_000_000_000_000_000_000
        
        if hashrate_h_per_sec < kh_threshold:
            return (hashrate_h_per_sec, "H/s")
        elif hashrate_h_per_sec < mh_threshold:
            return (hashrate_h_per_sec / kh_threshold, "KH/s")
        elif hashrate_h_per_sec < gh_threshold:
            return (hashrate_h_per_sec / mh_threshold, "MH/s")
        elif hashrate_h_per_sec < th_threshold:
            return (hashrate_h_per_sec / gh_threshold, "GH/s")
        elif hashrate_h_per_sec < ph_threshold:
            return (hashrate_h_per_sec / th_threshold, "TH/s")
        elif hashrate_h_per_sec < eh_threshold:
            return (hashrate_h_per_sec / ph_threshold, "PH/s")
        else:
            return (hashrate_h_per_sec / eh_threshold, "EH/s")

    def get_ocean_data(self):
        """
        Get mining data from Ocean.xyz.
        
        Returns:
            OceanData: Ocean.xyz mining data
        """
        base_url = "https://ocean.xyz"
        stats_url = f"{base_url}/stats/{self.wallet}"
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache'
        }
        
        # Create an empty data object to populate
        data = OceanData()
        
        try:
            response = self.session.get(stats_url, headers=headers, timeout=10)
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

    def debug_dump_table(self, table_element, max_rows=3):
        """
        Helper method to dump the structure of an HTML table for debugging.
        
        Args:
            table_element: BeautifulSoup element representing the table
            max_rows (int): Maximum number of rows to output
        """
        if not table_element:
            logging.debug("Table element is None - cannot dump structure")
            return
            
        try:
            rows = table_element.find_all('tr', class_='table-row')
            logging.debug(f"Found {len(rows)} rows in table")
            
            # Dump header row if present
            header_row = table_element.find_parent('table').find('thead')
            if header_row:
                header_cells = header_row.find_all('th')
                header_texts = [cell.get_text(strip=True) for cell in header_cells]
                logging.debug(f"Header: {header_texts}")
            
            # Dump a sample of the data rows
            for i, row in enumerate(rows[:max_rows]):
                cells = row.find_all('td', class_='table-cell')
                cell_texts = [cell.get_text(strip=True) for cell in cells]
                logging.debug(f"Row {i}: {cell_texts}")
                
                # Also look at raw HTML for problematic cells
                for j, cell in enumerate(cells):
                    logging.debug(f"Row {i}, Cell {j} HTML: {cell}")
                    
        except Exception as e:
            logging.error(f"Error dumping table structure: {e}")

    def fetch_url(self, url: str, timeout: int = 5):
        """
        Fetch URL with error handling.
        
        Args:
            url (str): URL to fetch
            timeout (int): Timeout in seconds
            
        Returns:
            Response: Request response or None if failed
        """
        try:
            return self.session.get(url, timeout=timeout)
        except Exception as e:
            logging.error(f"Error fetching {url}: {e}")
            return None

    def get_bitcoin_stats(self):
        """
        Fetch Bitcoin network statistics with improved error handling and caching.
        
        Returns:
            tuple: (difficulty, network_hashrate, btc_price, block_count)
        """
        urls = {
            "difficulty": "https://blockchain.info/q/getdifficulty",
            "hashrate": "https://blockchain.info/q/hashrate",
            "ticker": "https://blockchain.info/ticker",
            "blockcount": "https://blockchain.info/q/getblockcount"
        }
        
        # Use previous cached values as defaults if available
        difficulty = self.cache.get("difficulty")
        network_hashrate = self.cache.get("network_hashrate")
        btc_price = self.cache.get("btc_price")
        block_count = self.cache.get("block_count")
        
        try:
            with ThreadPoolExecutor(max_workers=4) as executor:
                futures = {key: executor.submit(self.fetch_url, url) for key, url in urls.items()}
                responses = {key: futures[key].result(timeout=5) for key in futures}
                
            # Process each response individually with error handling
            if responses["difficulty"] and responses["difficulty"].ok:
                try:
                    difficulty = float(responses["difficulty"].text)
                    self.cache["difficulty"] = difficulty
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing difficulty: {e}")
                    
            if responses["hashrate"] and responses["hashrate"].ok:
                try:
                    network_hashrate = float(responses["hashrate"].text) * 1e9
                    self.cache["network_hashrate"] = network_hashrate
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing network hashrate: {e}")
                    
            if responses["ticker"] and responses["ticker"].ok:
                try:
                    ticker_data = responses["ticker"].json()
                    btc_price = float(ticker_data.get("USD", {}).get("last", btc_price))
                    self.cache["btc_price"] = btc_price
                except (ValueError, TypeError, json.JSONDecodeError) as e:
                    logging.error(f"Error parsing BTC price: {e}")
                    
            if responses["blockcount"] and responses["blockcount"].ok:
                try:
                    block_count = int(responses["blockcount"].text)
                    self.cache["block_count"] = block_count
                except (ValueError, TypeError) as e:
                    logging.error(f"Error parsing block count: {e}")
                    
        except Exception as e:
            logging.error(f"Error fetching Bitcoin stats: {e}")
            
        return difficulty, network_hashrate, btc_price, block_count

    def get_worker_data(self):
        """
        Get worker data from Ocean.xyz, trying the API endpoint first.
        Falls back to the web scraping method if API isn't available.
        
        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        if self.api_available:
            result = self.get_worker_data_from_api()
            if result and result.get('workers') and len(result['workers']) > 0:
                logging.info(f"Successfully retrieved worker data from API: {len(result['workers'])} workers")
                return result
                
        # Fall back to the original methods if API fails
        logging.info("API worker data retrieval failed, falling back to web scraping methods")
        result = self.get_worker_data_alternative()
        
        # Check if alternative method succeeded and found workers with valid names
        if result and result.get('workers') and len(result['workers']) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result['workers']:
                name = worker.get('name', '').lower()
                if name and name not in ['online', 'offline', 'total', 'worker', 'status']:
                    has_valid_workers = True
                    break
                    
            if has_valid_workers:
                logging.info(f"Alternative worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("Alternative method found workers but with invalid names")
        
        # If alternative method failed, try the original method
        logging.info("Trying original worker data method")
        result = self.get_worker_data_original()
        
        # Check if original method succeeded and found workers with valid names
        if result and result.get('workers') and len(result['workers']) > 0:
            # Validate workers - check for invalid names
            has_valid_workers = False
            for worker in result['workers']:
                name = worker.get('name', '').lower()
                if name and name not in ['online', 'offline', 'total', 'worker', 'status']:
                    has_valid_workers = True
                    break
                    
            if has_valid_workers:
                logging.info(f"Original worker data method successful: {len(result['workers'])} workers with valid names")
                return result
            else:
                logging.warning("Original method found workers but with invalid names")
                
        # If all methods failed, return None
        logging.warning("All worker data fetch methods failed")
        return None

    def get_worker_data_from_api(self):
        """
        Get worker data from Ocean.xyz using the Beta API.
        
        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        try:
            # Fetch full worker hashrate information with retry
            response = self._api_request_with_retry(f"user_hashrate_full/{self.wallet}", timeout=15)
            if not response:
                logging.error("Error fetching worker data from API")
                return None
                
            data = response.json()
            if not data or "workers" not in data:
                logging.error("No worker data found in API response")
                return None
                
            logging.debug(f"Worker API response: {str(data)[:200]}...")
            workers = []
            total_hashrate = 0
            workers_online = 0
            workers_offline = 0
            
            # Process each worker in the response
            for worker_data in data["workers"]:
                worker_name = worker_data.get("name", "Unknown")
                hashrate_300s = worker_data.get("hashrate_300s", 0)  # 5-minute hashrate
                hashrate_60s = worker_data.get("hashrate_60s", 0)    # 1-minute hashrate
                hashrate_10800s = worker_data.get("hashrate_10800s", 0)  # 3-hour hashrate
                
                # Determine if worker is online based on recent hashrate
                is_online = hashrate_300s > 0
                status = "online" if is_online else "offline"
                
                # Update counters
                if is_online:
                    workers_online += 1
                else:
                    workers_offline += 1
                
                # Format hashrates with appropriate units
                hr_60s_value, hr_60s_unit = self._format_hashrate_value(hashrate_60s)
                hr_3hr_value, hr_3hr_unit = self._format_hashrate_value(hashrate_10800s)
                
                # Create worker object
                worker = {
                    "name": worker_name,
                    "status": status,
                    "type": "ASIC",  # Default type
                    "model": "Unknown",
                    "hashrate_60sec": hr_60s_value,
                    "hashrate_60sec_unit": hr_60s_unit,
                    "hashrate_3hr": hr_3hr_value,
                    "hashrate_3hr_unit": hr_3hr_unit,
                    "efficiency": 90.0,  # Default efficiency
                    "last_share": "N/A",
                    "earnings": 0,      # Would need separate API call
                    "acceptance_rate": 99.0,  # Default acceptance rate
                    "power_consumption": 0,
                    "temperature": 0
                }
                
                # Update worker last share time if available
                if "latest_share_ts" in worker_data:
                    try:
                        share_ts = worker_data["latest_share_ts"]
                        share_dt = datetime.fromtimestamp(share_ts, tz=ZoneInfo("UTC"))
                        la_tz = ZoneInfo("America/Los_Angeles")
                        la_share_time = share_dt.astimezone(la_tz)
                        worker["last_share"] = la_share_time.strftime("%Y-%m-%d %I:%M %p")
                    except Exception as e:
                        logging.error(f"Error formatting worker last share time: {e}")
                
                # Set worker type based on name (if it can be inferred)
                lower_name = worker["name"].lower()
                if 'antminer' in lower_name:
                    worker["type"] = 'ASIC'
                    worker["model"] = 'Bitmain Antminer'
                elif 'whatsminer' in lower_name:
                    worker["type"] = 'ASIC'
                    worker["model"] = 'MicroBT Whatsminer'
                elif 'bitaxe' in lower_name or 'nerdqaxe' in lower_name:
                    worker["type"] = 'Bitaxe'
                    worker["model"] = 'BitAxe Gamma 601'
                
                # Add to total hashrate (using 3hr as more stable)
                total_hashrate += convert_to_ths(hr_3hr_value, hr_3hr_unit)
                
                workers.append(worker)
            
            # Try to get earnings info from statsnap endpoint
            earnings_resp = self._api_request_with_retry(f"statsnap/{self.wallet}", timeout=10)
            daily_sats = 0
            if earnings_resp:
                stats_data = earnings_resp.json()
                if "estimated_earn_next_block" in stats_data:
                    # Approximately 144 blocks per day
                    daily_sats = int(stats_data["estimated_earn_next_block"] * 144)
            
            # Build result dictionary
            result = {
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': 0,  # Would need separate earnpay API call
                'avg_acceptance_rate': 99.0,
                'daily_sats': daily_sats,
                'timestamp': datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            }
            
            return result
            
        except Exception as e:
            logging.error(f"Error fetching worker data from API: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return None

    def get_all_worker_rows(self):
        """
        Iterate through wpage parameter values to collect all worker table rows.

        Returns:
            list: A list of BeautifulSoup row elements containing worker data.
        """
        all_rows = []
        page_num = 0
        while True:
            url = f"https://ocean.xyz/stats/{self.wallet}?wpage={page_num}#workers-fulltable"
            logging.info(f"Fetching worker data from: {url}")
            response = self.session.get(url, timeout=15)
            if not response.ok:
                logging.error(f"Error fetching page {page_num}: status code {response.status_code}")
                break

            soup = BeautifulSoup(response.text, 'html.parser')
            workers_table = soup.find('tbody', id='workers-tablerows')
            if not workers_table:
                logging.debug(f"No workers table found on page {page_num}")
                break

            rows = workers_table.find_all("tr", class_="table-row")
            if not rows:
                logging.debug(f"No worker rows found on page {page_num}, stopping pagination")
                break

            logging.info(f"Found {len(rows)} worker rows on page {page_num}")
            all_rows.extend(rows)
            page_num += 1

        return all_rows

    def get_worker_data_original(self):
        """
        Original implementation to get worker data from Ocean.xyz.
        
        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        base_url = "https://ocean.xyz"
        stats_url = f"{base_url}/stats/{self.wallet}"
        headers = {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cache-Control': 'no-cache'
        }
        
        try:
            logging.info(f"Fetching worker data from {stats_url}")
            response = self.session.get(stats_url, headers=headers, timeout=15)
            if not response.ok:
                logging.error(f"Error fetching ocean worker data: status code {response.status_code}")
                return None
                
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Parse worker data from the workers table
            workers = []
            total_hashrate = 0
            total_earnings = 0
            
            workers_table = soup.find('tbody', id='workers-tablerows')
            if not workers_table:
                logging.error("Workers table not found in Ocean.xyz page")
                return None
                
            # Debug: Dump table structure to help diagnose parsing issues
            self.debug_dump_table(workers_table)
            
            # Find total worker counts
            workers_online = 0
            workers_offline = 0
            avg_acceptance_rate = 95.0  # Default value
            
            # Iterate through worker rows in the table
            for row in workers_table.find_all('tr', class_='table-row'):
                cells = row.find_all('td', class_='table-cell')
                
                # Skip rows that don't have enough cells for basic info
                if len(cells) < 3:
                    logging.warning(f"Worker row has too few cells: {len(cells)}")
                    continue
                    
                try:
                    # Extract worker name from the first cell
                    name_cell = cells[0]
                    name_text = name_cell.get_text(strip=True)
                    
                    # Skip the total row
                    if name_text.lower() == 'total':
                        logging.debug("Skipping total row")
                        continue
                    
                    logging.debug(f"Processing worker: {name_text}")
                    
                    # Create worker object with safer extraction
                    worker = {
                        "name": name_text.strip(),
                        "status": "offline",  # Default to offline
                        "type": "ASIC",      # Default type
                        "model": "Unknown",
                        "hashrate_60sec": 0,
                        "hashrate_60sec_unit": "TH/s",
                        "hashrate_3hr": 0,
                        "hashrate_3hr_unit": "TH/s",
                        "efficiency": 90.0,   # Default efficiency
                        "last_share": "N/A",
                        "earnings": 0,
                        "acceptance_rate": 95.0,  # Default acceptance rate
                        "power_consumption": 0,
                        "temperature": 0
                    }
                    
                    # Parse status from second cell if available
                    if len(cells) > 1:
                        status_cell = cells[1]
                        status_text = status_cell.get_text(strip=True).lower()
                        worker["status"] = "online" if "online" in status_text else "offline"
                        
                        # Update counter based on status
                        if worker["status"] == "online":
                            workers_online += 1
                        else:
                            workers_offline += 1
                    
                    # Parse last share time
                    if len(cells) > 2:
                        last_share_cell = cells[2]
                        worker["last_share"] = last_share_cell.get_text(strip=True)
                    
                    # Parse 60sec hashrate if available
                    if len(cells) > 3:
                        hashrate_60s_cell = cells[3]
                        hashrate_60s_text = hashrate_60s_cell.get_text(strip=True)
                        
                        # Parse hashrate_60sec and unit with more robust handling
                        try:
                            parts = hashrate_60s_text.split()
                            if parts and len(parts) > 0:
                                # First part should be the number
                                try:
                                    numeric_value = float(parts[0])
                                    worker["hashrate_60sec"] = numeric_value
                                    
                                    # Second part should be the unit if it exists
                                    if len(parts) > 1 and 'btc' not in parts[1].lower():
                                        worker["hashrate_60sec_unit"] = parts[1]
                                except ValueError:
                                    # If we can't convert to float, it might be a non-numeric value
                                    logging.warning(f"Could not parse 60s hashrate value: {parts[0]}")
                        except Exception as e:
                            logging.error(f"Error parsing 60s hashrate '{hashrate_60s_text}': {e}")
                    
                    # Parse 3hr hashrate if available
                    if len(cells) > 4:
                        hashrate_3hr_cell = cells[4]
                        hashrate_3hr_text = hashrate_3hr_cell.get_text(strip=True)
                        
                        # Parse hashrate_3hr and unit with more robust handling
                        try:
                            parts = hashrate_3hr_text.split()
                            if parts and len(parts) > 0:
                                # First part should be the number
                                try:
                                    numeric_value = float(parts[0])
                                    worker["hashrate_3hr"] = numeric_value
                                    
                                    # Second part should be the unit if it exists
                                    if len(parts) > 1 and 'btc' not in parts[1].lower():
                                        worker["hashrate_3hr_unit"] = parts[1]
                                        
                                    # Add to total hashrate (normalized to TH/s for consistency)
                                    total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                                except ValueError:
                                    # If we can't convert to float, it might be a non-numeric value
                                    logging.warning(f"Could not parse 3hr hashrate value: {parts[0]}")
                        except Exception as e:
                            logging.error(f"Error parsing 3hr hashrate '{hashrate_3hr_text}': {e}")
                    
                    # Parse earnings if available
                    if len(cells) > 5:
                        earnings_cell = cells[5]
                        earnings_text = earnings_cell.get_text(strip=True)
                        
                        # Parse earnings with more robust handling
                        try:
                            # Remove BTC or other text, keep only the number
                            earnings_value = earnings_text.replace('BTC', '').strip()
                            try:
                                worker["earnings"] = float(earnings_value)
                                total_earnings += worker["earnings"]
                            except ValueError:
                                logging.warning(f"Could not parse earnings value: {earnings_value}")
                        except Exception as e:
                            logging.error(f"Error parsing earnings '{earnings_text}': {e}")
                    
                    # Set worker type based on name (if it can be inferred)
                    lower_name = worker["name"].lower()
                    if 'antminer' in lower_name:
                        worker["type"] = 'ASIC'
                        worker["model"] = 'Bitmain Antminer'
                    elif 'whatsminer' in lower_name:
                        worker["type"] = 'ASIC'
                        worker["model"] = 'MicroBT Whatsminer'
                    elif 'bitaxe' in lower_name or 'nerdqaxe' in lower_name:
                        worker["type"] = 'Bitaxe'
                        worker["model"] = 'BitAxe Gamma 601'
                    
                    workers.append(worker)
                    
                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue
                
            # Get daily sats from the ocean data
            daily_sats = 0
            try:
                # Try to get this from the payoutsnap card
                payout_snap = soup.find('div', id='payoutsnap-statcards')
                if payout_snap:
                    for container in payout_snap.find_all('div', class_='blocks dashboard-container'):
                        label_div = container.find('div', class_='blocks-label')
                        if label_div and "earnings per day" in label_div.get_text(strip=True).lower():
                            value_span = label_div.find_next('span')
                            if value_span:
                                value_text = value_span.get_text(strip=True)
                                try:
                                    btc_per_day = float(value_text.split()[0])
                                    daily_sats = int(btc_per_day * self.sats_per_btc)
                                except (ValueError, IndexError):
                                    pass
            except Exception as e:
                logging.error(f"Error parsing daily sats: {e}")
            
            # Check if we found any workers
            if not workers:
                logging.warning("No workers found in the table, possibly a parsing issue")
                return None
            
            # Return worker stats dictionary
            result = {
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',  # Always use TH/s for consistent display
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': total_earnings,
                'avg_acceptance_rate': avg_acceptance_rate,
                'daily_sats': daily_sats,
                'timestamp': datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            }
            
            logging.info(f"Successfully retrieved worker data: {len(workers)} workers")
            return result
                
        except Exception as e:
            logging.error(f"Error fetching Ocean worker data: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return None

    def get_worker_data_alternative(self):
        """
        Alternative implementation to get worker data from Ocean.xyz.
        This version consolidates worker rows from all pages using the wpage parameter.

        Returns:
            dict: Worker data dictionary with stats and list of workers.
        """
        try:
            logging.info("Fetching worker data across multiple pages (alternative method)")
            # Get all worker rows from every page
            rows = self.get_all_worker_rows()
            if not rows:
                logging.error("No worker rows found across any pages")
                return None

            workers = []
            total_hashrate = 0
            total_earnings = 0
            workers_online = 0
            workers_offline = 0
            invalid_names = ['online', 'offline', 'status', 'worker', 'total']

            # Process each row from all pages
            for row_idx, row in enumerate(rows):
                cells = row.find_all(['td', 'th'])
                if not cells or len(cells) < 3:
                    continue

                first_cell_text = cells[0].get_text(strip=True)
                if first_cell_text.lower() in invalid_names:
                    continue

                try:
                    worker_name = first_cell_text or f"Worker_{row_idx+1}"
                    worker = {
                        "name": worker_name,
                        "status": "online",  # Default assumption
                        "type": "ASIC",
                        "model": "Unknown",
                        "hashrate_60sec": 0,
                        "hashrate_60sec_unit": "TH/s",
                        "hashrate_3hr": 0,
                        "hashrate_3hr_unit": "TH/s",
                        "efficiency": 90.0,
                        "last_share": "N/A",
                        "earnings": 0,
                        "acceptance_rate": 95.0,
                        "power_consumption": 0,
                        "temperature": 0
                    }
                
                    # Extract status from second cell if available
                    if len(cells) > 1:
                        status_text = cells[1].get_text(strip=True).lower()
                        worker["status"] = "online" if "online" in status_text else "offline"
                        if worker["status"] == "online":
                            workers_online += 1
                        else:
                            workers_offline += 1

                    # Parse last share from third cell if available
                    if len(cells) > 2:
                        worker["last_share"] = cells[2].get_text(strip=True)

                    # Parse 60sec hashrate from fourth cell if available
                    if len(cells) > 3:
                        hashrate_60s_text = cells[3].get_text(strip=True)
                        try:
                            parts = hashrate_60s_text.split()
                            if parts:
                                worker["hashrate_60sec"] = float(parts[0])
                                if len(parts) > 1:
                                    worker["hashrate_60sec_unit"] = parts[1]
                        except ValueError:
                            logging.warning(f"Could not parse 60-sec hashrate: {hashrate_60s_text}")

                    # Parse 3hr hashrate from fifth cell if available
                    if len(cells) > 4:
                        hashrate_3hr_text = cells[4].get_text(strip=True)
                        try:
                            parts = hashrate_3hr_text.split()
                            if parts:
                                worker["hashrate_3hr"] = float(parts[0])
                                if len(parts) > 1:
                                    worker["hashrate_3hr_unit"] = parts[1]
                                # Normalize and add to total hashrate (using your convert_to_ths helper)
                                total_hashrate += convert_to_ths(worker["hashrate_3hr"], worker["hashrate_3hr_unit"])
                        except ValueError:
                            logging.warning(f"Could not parse 3hr hashrate: {hashrate_3hr_text}")

                    # Look for earnings in any cell containing 'btc'
                    for cell in cells:
                        cell_text = cell.get_text(strip=True)
                        if "btc" in cell_text.lower():
                            try:
                                earnings_match = re.search(r'([\d\.]+)', cell_text)
                                if earnings_match:
                                    worker["earnings"] = float(earnings_match.group(1))
                                    total_earnings += worker["earnings"]
                            except Exception:
                                pass

                    # Set worker type based on name
                    lower_name = worker["name"].lower()
                    if 'antminer' in lower_name:
                        worker["type"] = 'ASIC'
                        worker["model"] = 'Bitmain Antminer'
                    elif 'whatsminer' in lower_name:
                        worker["type"] = 'ASIC'
                        worker["model"] = 'MicroBT Whatsminer'
                    elif 'bitaxe' in lower_name or 'nerdqaxe' in lower_name:
                        worker["type"] = 'Bitaxe'
                        worker["model"] = 'BitAxe Gamma 601'

                    if worker["name"].lower() not in invalid_names:
                        workers.append(worker)

                except Exception as e:
                    logging.error(f"Error parsing worker row: {e}")
                    continue

            if not workers:
                logging.error("No valid worker data parsed")
                return None

            result = {
                'workers': workers,
                'total_hashrate': total_hashrate,
                'hashrate_unit': 'TH/s',
                'workers_total': len(workers),
                'workers_online': workers_online,
                'workers_offline': workers_offline,
                'total_earnings': total_earnings,
                'avg_acceptance_rate': 99.0,
                'timestamp': datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            }
            logging.info(f"Successfully retrieved {len(workers)} workers across multiple pages")
            return result

        except Exception as e:
            logging.error(f"Error in alternative worker data fetch: {e}")
            return None