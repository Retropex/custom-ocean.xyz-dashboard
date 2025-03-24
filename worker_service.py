"""
Worker service module for managing workers data.
"""
import logging
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

class WorkerService:
    """Service for generating and managing worker data."""
    
    def __init__(self):
        """Initialize the worker service."""
        self.worker_data_cache = None
        self.last_worker_data_update = None
        self.WORKER_DATA_CACHE_TIMEOUT = 60  # Cache worker data for 60 seconds

    def generate_default_workers_data(self):
        """
        Generate default worker data when no metrics are available.
        
        Returns:
            dict: Default worker data structure
        """
        return {
            "workers": [],
            "workers_total": 0,
            "workers_online": 0,
            "workers_offline": 0,
            "total_hashrate": 0.0,
            "hashrate_unit": "TH/s",
            "total_earnings": 0.0,
            "daily_sats": 0,
            "avg_acceptance_rate": 0.0,
            "hashrate_history": [],
            "timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
        }

    def get_workers_data(self, cached_metrics, force_refresh=False):
        """
        Get worker data with caching for better performance.
        
        Args:
            cached_metrics (dict): Cached metrics from the dashboard
            force_refresh (bool): Whether to force a refresh of cached data
            
        Returns:
            dict: Worker data
        """
        current_time = datetime.now().timestamp()
        
        # Return cached data if it's still fresh and not forced to refresh
        if not force_refresh and self.worker_data_cache and self.last_worker_data_update and \
        (current_time - self.last_worker_data_update) < self.WORKER_DATA_CACHE_TIMEOUT:
            logging.info("Using cached worker data")
            return self.worker_data_cache
            
        try:
            # If metrics aren't available yet, return default data
            if not cached_metrics:
                return self.generate_default_workers_data()
                
            # Check if we have workers_hashing information
            workers_count = cached_metrics.get("workers_hashing", 0)
            if workers_count <= 0:
                return self.generate_default_workers_data()
                
            # Get hashrate from cached metrics - using EXACT value
            # Store this ORIGINAL value to ensure it's never changed in calculations
            original_hashrate_3hr = float(cached_metrics.get("hashrate_3hr", 0) or 0)
            hashrate_unit = cached_metrics.get("hashrate_3hr_unit", "TH/s")
            
            # Generate worker data based on the number of active workers
            workers_data = self.generate_workers_data(workers_count, original_hashrate_3hr, hashrate_unit)
            
            # Calculate basic statistics
            workers_online = len([w for w in workers_data if w['status'] == 'online'])
            workers_offline = len(workers_data) - workers_online
            
            # MODIFIED: Use unpaid_earnings from main dashboard instead of calculating from workers
            unpaid_earnings = cached_metrics.get("unpaid_earnings", 0)
            # Handle case where unpaid_earnings might be a string
            if isinstance(unpaid_earnings, str):
                try:
                    # Handle case where it might include "BTC" or other text
                    unpaid_earnings = float(unpaid_earnings.split()[0].replace(',', ''))
                except (ValueError, IndexError):
                    unpaid_earnings = 0
            
            # Use unpaid_earnings as total_earnings
            total_earnings = unpaid_earnings
            
            # Debug log
            logging.info(f"Using unpaid_earnings as total_earnings: {unpaid_earnings} BTC")
            
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
                "total_earnings": total_earnings,  # Now using unpaid_earnings
                "daily_sats": daily_sats,
                "avg_acceptance_rate": avg_acceptance_rate,
                "hashrate_history": hashrate_history,
                "timestamp": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat()
            }
            
            # Update cache
            self.worker_data_cache = result
            self.last_worker_data_update = current_time
            
            return result
        except Exception as e:
            logging.error(f"Error getting worker data: {e}")
            return self.generate_default_workers_data()

    def generate_workers_data(self, num_workers, total_hashrate, hashrate_unit, total_unpaid_earnings=None):
        """
        Generate simulated worker data based on total hashrate, ensuring total matches exactly.
        Also distributes unpaid earnings proportionally when provided.
        
        Args:
            num_workers (int): Number of workers
            total_hashrate (float): Total hashrate
            hashrate_unit (str): Hashrate unit
            total_unpaid_earnings (float, optional): Total unpaid earnings
            
        Returns:
            list: List of worker data dictionaries
        """
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
        
        # Default total unpaid earnings if not provided
        if total_unpaid_earnings is None or total_unpaid_earnings <= 0:
            total_unpaid_earnings = 0.001  # Default small amount
        
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
                "earnings": 0,  # Will be set after all workers are generated
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
                "earnings": 0,  # Minimal earnings for offline workers
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
        
        # --- NEW CODE TO DISTRIBUTE UNPAID EARNINGS PROPORTIONALLY ---
        # First calculate the total effective hashrate (only from online workers)
        total_effective_hashrate = sum(w["hashrate_3hr"] for w in workers if w["status"] == "online")
        
        # Reserve a small portion (5%) of earnings for offline workers
        online_earnings_pool = total_unpaid_earnings * 0.95
        offline_earnings_pool = total_unpaid_earnings * 0.05
        
        # Distribute earnings based on hashrate proportion for online workers
        if total_effective_hashrate > 0:
            for worker in workers:
                if worker["status"] == "online":
                    hashrate_proportion = worker["hashrate_3hr"] / total_effective_hashrate
                    worker["earnings"] = round(online_earnings_pool * hashrate_proportion, 8)
        
        # Distribute minimal earnings to offline workers
        if offline_count > 0:
            offline_per_worker = offline_earnings_pool / offline_count
            for worker in workers:
                if worker["status"] == "offline":
                    worker["earnings"] = round(offline_per_worker, 8)
        
        # Final verification - ensure total earnings match
        current_total_earnings = sum(w["earnings"] for w in workers)
        if abs(current_total_earnings - total_unpaid_earnings) > 0.00000001:
            # Adjust the first worker to account for any rounding errors
            adjustment = total_unpaid_earnings - current_total_earnings
            for worker in workers:
                if worker["status"] == "online":
                    worker["earnings"] = round(worker["earnings"] + adjustment, 8)
                    break
        
        return workers
