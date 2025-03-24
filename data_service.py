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

from models import OceanData, convert_to_ths

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
