"""
Integration module for Ocean.xyz API v1 with the existing Bitcoin Mining Dashboard.
This enhances data_service.py with direct API access instead of web scraping.
"""
import logging
import requests
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from models import OceanData, convert_to_ths

class OceanAPIClient:
    """Client for interacting with Ocean.xyz API."""
    
    def __init__(self, wallet):
        """
        Initialize the Ocean API client.
        
        Args:
            wallet (str): Bitcoin wallet address for Ocean.xyz
        """
        self.wallet = wallet
        self.base_url = "https://api.ocean.xyz/v1"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Bitcoin-Mining-Dashboard/1.0',
            'Accept': 'application/json'
        })
        
    def get_user_info(self):
        """
        Get comprehensive user information from the API.
        
        Returns:
            dict: User data or None if request failed
        """
        url = f"{self.base_url}/userinfo_full/{self.wallet}"
        
        try:
            response = self.session.get(url, timeout=10)
            if response.ok:
                return response.json()
            else:
                logging.error(f"Ocean API error: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            logging.error(f"Error fetching Ocean API data: {e}")
            return None
            
    def convert_to_ocean_data(self, api_data):
        """
        Convert API response to OceanData model for compatibility.
        
        Args:
            api_data (dict): Raw API data
            
        Returns:
            OceanData: Converted data object
        """
        if not api_data:
            return None
            
        data = OceanData()
        
        try:
            # Extract hashrate data
            if 'hashrate' in api_data:
                hashrates = api_data['hashrate']
                
                # 24 hour hashrate
                if 'hr_24' in hashrates:
                    data.hashrate_24hr = hashrates['hr_24']['hashrate']
                    data.hashrate_24hr_unit = self._normalize_unit(hashrates['hr_24']['unit'])
                
                # 3 hour hashrate
                if 'hr_3' in hashrates:
                    data.hashrate_3hr = hashrates['hr_3']['hashrate']
                    data.hashrate_3hr_unit = self._normalize_unit(hashrates['hr_3']['unit'])
                
                # 10 minute hashrate
                if 'min_10' in hashrates:
                    data.hashrate_10min = hashrates['min_10']['hashrate']
                    data.hashrate_10min_unit = self._normalize_unit(hashrates['min_10']['unit'])
                
                # 5 minute hashrate
                if 'min_5' in hashrates:
                    data.hashrate_5min = hashrates['min_5']['hashrate']
                    data.hashrate_5min_unit = self._normalize_unit(hashrates['min_5']['unit'])
                
                # 60 second hashrate
                if 'sec_60' in hashrates:
                    data.hashrate_60sec = hashrates['sec_60']['hashrate']
                    data.hashrate_60sec_unit = self._normalize_unit(hashrates['sec_60']['unit'])
            
            # Extract worker information
            if 'workers' in api_data:
                data.workers_hashing = api_data['workers'].get('active', 0)
            
            # Extract earnings information
            if 'earnings' in api_data:
                earnings = api_data['earnings']
                
                # Unpaid earnings (total_unpaid)
                if 'total_unpaid' in earnings:
                    data.unpaid_earnings = earnings['total_unpaid']
                
                # Estimated earnings per day
                if 'per_day' in earnings:
                    data.estimated_earnings_per_day = earnings['per_day']
                
                # Next block earnings estimation
                if 'next_block' in earnings:
                    data.estimated_earnings_next_block = earnings['next_block']
                
                # Rewards in window
                if 'in_window' in earnings:
                    data.estimated_rewards_in_window = earnings['in_window']
                
                # Time to payout
                if 'est_time_to_payout' in earnings:
                    data.est_time_to_payout = earnings['est_time_to_payout']
            
            # Extract pool information
            if 'pool' in api_data:
                pool = api_data['pool']
                
                # Pool hashrate
                if 'hashrate' in pool:
                    data.pool_total_hashrate = pool['hashrate']['hashrate']
                    data.pool_total_hashrate_unit = self._normalize_unit(pool['hashrate']['unit'])
                
                # Last block
                if 'last_block' in pool:
                    last_block = pool['last_block']
                    data.last_block_height = str(last_block.get('height', ''))
                    data.last_block_time = last_block.get('time', '')
                    data.last_block_earnings = str(last_block.get('earnings_sats', ''))
                
                # Blocks found
                if 'blocks_found' in pool:
                    data.blocks_found = str(pool['blocks_found'])
            
            # Extract last share time
            if 'last_share' in api_data:
                # API returns date in ISO format, convert to local time
                try:
                    utc_dt = datetime.fromisoformat(api_data['last_share'].replace('Z', '+00:00'))
                    la_dt = utc_dt.astimezone(ZoneInfo("America/Los_Angeles"))
                    data.total_last_share = la_dt.strftime("%Y-%m-%d %I:%M %p")
                except Exception as e:
                    logging.error(f"Error converting last share time: {e}")
                    data.total_last_share = api_data['last_share']
            
            return data
            
        except Exception as e:
            logging.error(f"Error converting API data to OceanData: {e}")
            return None
    
    def _normalize_unit(self, unit):
        """
        Normalize hashrate unit format.
        
        Args:
            unit (str): Raw unit string from API
            
        Returns:
            str: Normalized unit string
        """
        if not unit:
            return "TH/s"
            
        # Ensure lowercase for consistency
        unit = unit.lower()
        
        # Add "/s" if missing
        if "/s" not in unit:
            unit = f"{unit}/s"
        
        # Map to standard format
        unit_map = {
            "th/s": "TH/s",
            "gh/s": "GH/s",
            "mh/s": "MH/s",
            "ph/s": "PH/s",
            "eh/s": "EH/s"
        }
        
        return unit_map.get(unit, unit.upper())
    
    def get_workers_data(self):
        """
        Get detailed worker information from the API.
        
        Returns:
            dict: Worker data dictionary with stats and list of workers
        """
        api_data = self.get_user_info()
        if not api_data or 'workers' not in api_data:
            return None
            
        workers_api_data = api_data['workers']
        worker_list = workers_api_data.get('list', [])
        
        # Prepare result structure
        result = {
            'workers': [],
            'workers_total': len(worker_list),
            'workers_online': workers_api_data.get('active', 0),
            'workers_offline': len(worker_list) - workers_api_data.get('active', 0),
            'total_hashrate': 0,
            'hashrate_unit': 'TH/s',
            'total_earnings': api_data.get('earnings', {}).get('total_unpaid', 0),
            'daily_sats': int(api_data.get('earnings', {}).get('per_day', 0) * 100000000),
            'avg_acceptance_rate': 98.5,  # Default value
            'timestamp': datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
        }
        
        # Process each worker
        for worker_data in worker_list:
            worker = {
                "name": worker_data.get('name', 'Unknown'),
                "status": "online" if worker_data.get('active', False) else "offline",
                "type": "ASIC",  # Default type
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
            
            # Extract hashrate data
            if 'hashrate' in worker_data:
                hashrates = worker_data['hashrate']
                
                # 60 second hashrate
                if 'sec_60' in hashrates:
                    worker["hashrate_60sec"] = hashrates['sec_60']['hashrate']
                    worker["hashrate_60sec_unit"] = self._normalize_unit(hashrates['sec_60']['unit'])
                
                # 3 hour hashrate
                if 'hr_3' in hashrates:
                    worker["hashrate_3hr"] = hashrates['hr_3']['hashrate']
                    worker["hashrate_3hr_unit"] = self._normalize_unit(hashrates['hr_3']['unit'])
                    
                    # Add to total hashrate (normalized to TH/s)
                    if worker["status"] == "online":
                        result['total_hashrate'] += convert_to_ths(
                            worker["hashrate_3hr"], 
                            worker["hashrate_3hr_unit"]
                        )
            
            # Extract last share time
            if 'last_share' in worker_data:
                try:
                    utc_dt = datetime.fromisoformat(worker_data['last_share'].replace('Z', '+00:00'))
                    la_dt = utc_dt.astimezone(ZoneInfo("America/Los_Angeles"))
                    worker["last_share"] = la_dt.strftime("%Y-%m-%d %H:%M")
                except Exception as e:
                    logging.error(f"Error converting worker last share time: {e}")
                    worker["last_share"] = worker_data['last_share']
            
            # Extract earnings if available
            if 'earnings' in worker_data:
                worker["earnings"] = worker_data['earnings'].get('total', 0)
            
            # Try to determine worker type and model based on name
            name_lower = worker["name"].lower()
            if 'antminer' in name_lower:
                worker["type"] = 'ASIC'
                worker["model"] = 'Bitmain Antminer'
            elif 'whatsminer' in name_lower:
                worker["type"] = 'ASIC'
                worker["model"] = 'MicroBT Whatsminer'
            elif 'bitaxe' in name_lower or 'nerdqaxe' in name_lower:
                worker["type"] = 'Bitaxe'
                worker["model"] = 'BitAxe Gamma 601'
            
            # Add worker to result
            result['workers'].append(worker)
        
        return result
