"""
State manager module for handling persistent state and history.
"""
import logging
import json
import time
import gc
import threading
import redis

# Global variables for arrow history, legacy hashrate history, and a log of full metrics snapshots.
arrow_history = {}    # stored per second
hashrate_history = []
metrics_log = []

# Limits for data collections to prevent memory growth
MAX_HISTORY_ENTRIES = 180  # 3 hours worth at 1 min intervals

# Lock for thread safety
state_lock = threading.Lock()

class StateManager:
    """Manager for persistent state and history data."""
    
    def __init__(self, redis_url=None):
        """
        Initialize the state manager.
        
        Args:
            redis_url (str, optional): Redis URL for persistent storage
        """
        self.redis_client = self._connect_to_redis(redis_url) if redis_url else None
        self.STATE_KEY = "graph_state"
        self.last_save_time = 0
        
        # Load state if available
        self.load_graph_state()
        
    def _connect_to_redis(self, redis_url):
        """
        Connect to Redis with retry logic.
        
        Args:
            redis_url (str): Redis URL
            
        Returns:
            redis.Redis: Redis client or None if connection failed
        """
        if not redis_url:
            logging.info("Redis URL not configured, using in-memory state only.")
            return None
        
        retry_count = 0
        max_retries = 3
        
        while retry_count < max_retries:
            try:
                client = redis.Redis.from_url(redis_url)
                client.ping()  # Test the connection
                logging.info(f"Connected to Redis at {redis_url}")
                return client
            except Exception as e:
                retry_count += 1
                if retry_count < max_retries:
                    logging.warning(f"Redis connection attempt {retry_count} failed: {e}. Retrying...")
                    time.sleep(1)  # Wait before retrying
                else:
                    logging.error(f"Could not connect to Redis after {max_retries} attempts: {e}")
                    return None
    
    def load_graph_state(self):
        """Load graph state from Redis with support for the optimized format."""
        global arrow_history, hashrate_history, metrics_log
        
        if not self.redis_client:
            logging.info("Redis not available, using in-memory state.")
            return
            
        try:
            # Check version to handle format changes
            version = self.redis_client.get(f"{self.STATE_KEY}_version")
            version = version.decode('utf-8') if version else "1.0"
            
            state_json = self.redis_client.get(self.STATE_KEY)
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
    
    def save_graph_state(self):
        """Save graph state to Redis with optimized frequency, pruning, and data reduction."""
        if not self.redis_client:
            logging.info("Redis not available, skipping state save.")
            return
            
        # Check if we've saved recently to avoid too frequent saves
        # Only save at most once every 5 minutes
        current_time = time.time()
        if hasattr(self, 'last_save_time') and current_time - self.last_save_time < 300:  # 300 seconds = 5 minutes
            logging.debug("Skipping Redis save - last save was less than 5 minutes ago")
            return
            
        # Update the last save time
        self.last_save_time = current_time
        
        # Prune data first to reduce volume
        self.prune_old_data()
        
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
            self.redis_client.set(f"{self.STATE_KEY}_version", "2.0")  
            self.redis_client.set(self.STATE_KEY, state_json)
            logging.info(f"Successfully saved graph state to Redis ({data_size_kb:.2f} KB)")
        except Exception as e:
            logging.error(f"Error saving graph state to Redis: {e}")
    
    def prune_old_data(self):
        """Remove old data to prevent memory growth with optimized strategy."""
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
    
    def persist_critical_state(self, cached_metrics, scheduler_last_successful_run, last_metrics_update_time):
        """
        Store critical state in Redis for recovery after worker restarts.
        
        Args:
            cached_metrics (dict): Current metrics
            scheduler_last_successful_run (float): Timestamp of last successful scheduler run
            last_metrics_update_time (float): Timestamp of last metrics update
        """
        if not self.redis_client:
            return
            
        try:
            # Only persist if we have valid data
            if cached_metrics and cached_metrics.get("server_timestamp"):
                state = {
                    "cached_metrics_timestamp": cached_metrics.get("server_timestamp"),
                    "last_successful_run": scheduler_last_successful_run,
                    "last_update_time": last_metrics_update_time
                }
                self.redis_client.set("critical_state", json.dumps(state))
                logging.info(f"Persisted critical state to Redis, timestamp: {cached_metrics.get('server_timestamp')}")
        except Exception as e:
            logging.error(f"Error persisting critical state: {e}")
    
    def load_critical_state(self):
        """
        Recover critical state variables after a worker restart.
        
        Returns:
            tuple: (last_successful_run, last_update_time)
        """
        if not self.redis_client:
            return None, None
            
        try:
            state_json = self.redis_client.get("critical_state")
            if state_json:
                state = json.loads(state_json.decode('utf-8'))
                last_successful_run = state.get("last_successful_run")
                last_update_time = state.get("last_update_time")
                
                logging.info(f"Loaded critical state from Redis, last run: {last_successful_run}")
                
                # We don't restore cached_metrics itself, as we'll fetch fresh data
                # Just note that we have state to recover from
                logging.info(f"Last metrics timestamp from Redis: {state.get('cached_metrics_timestamp')}")
                
                return last_successful_run, last_update_time
        except Exception as e:
            logging.error(f"Error loading critical state: {e}")
            
        return None, None
    
    def update_metrics_history(self, metrics):
        """
        Update history collections with new metrics data.
        
        Args:
            metrics (dict): New metrics data
        """
        global arrow_history, hashrate_history, metrics_log
        
        # Skip if metrics is None
        if not metrics:
            return
            
        arrow_keys = [
            "pool_total_hashrate", "hashrate_24hr", "hashrate_3hr", "hashrate_10min",
            "hashrate_60sec", "block_number", "btc_price", "network_hashrate",
            "difficulty", "daily_revenue", "daily_power_cost", "daily_profit_usd",
            "monthly_profit_usd", "daily_mined_sats", "monthly_mined_sats", "unpaid_earnings",
            "estimated_earnings_per_day_sats", "estimated_earnings_next_block_sats", "estimated_rewards_in_window_sats",
            "workers_hashing"
        ]
        
        # --- Bucket by second (Los Angeles Time) with thread safety ---
        from datetime import datetime
        from zoneinfo import ZoneInfo
        
        current_second = datetime.now(ZoneInfo("America/Los_Angeles")).strftime("%H:%M:%S")
        
        with state_lock:
            for key in arrow_keys:
                if metrics.get(key) is not None:
                    current_val = metrics[key]
                    arrow = ""
                    
                    # Get the corresponding unit key if available
                    unit_key = f"{key}_unit"
                    current_unit = metrics.get(unit_key, "")
                    
                    if key in arrow_history and arrow_history[key]:
                        try:
                            previous_val = arrow_history[key][-1]["value"]
                            previous_unit = arrow_history[key][-1].get("unit", "")
                            
                            # Use the convert_to_ths function to normalize both values before comparison
                            if key.startswith("hashrate") and current_unit:
                                from models import convert_to_ths
                                norm_curr_val = convert_to_ths(float(current_val), current_unit)
                                norm_prev_val = convert_to_ths(float(previous_val), previous_unit if previous_unit else "th/s")
                                
                                if norm_curr_val > norm_prev_val * 1.01:  # 1% threshold to avoid minor fluctuations
                                    arrow = "↑"
                                elif norm_curr_val < norm_prev_val * 0.99:  # 1% threshold
                                    arrow = "↓"
                            else:
                                # For non-hashrate values or when units are missing
                                if float(current_val) > float(previous_val) * 1.01:
                                    arrow = "↑"
                                elif float(current_val) < float(previous_val) * 0.99:
                                    arrow = "↓"
                        except Exception as e:
                            logging.error(f"Error calculating arrow for {key}: {e}")
                            
                    if key not in arrow_history:
                        arrow_history[key] = []
                        
                    if not arrow_history[key] or arrow_history[key][-1]["time"] != current_second:
                        entry = {
                            "time": current_second,
                            "value": current_val,
                            "arrow": arrow,
                        }
                        # Add unit information if available
                        if current_unit:
                            entry["unit"] = current_unit
                            
                        arrow_history[key].append(entry)
                    else:
                        arrow_history[key][-1]["value"] = current_val
                        arrow_history[key][-1]["arrow"] = arrow
                        # Update unit if available
                        if current_unit:
                            arrow_history[key][-1]["unit"] = current_unit
                            
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
                
                # Sort by time to ensure chronological order
                aggregated_history[key] = sorted(list(minute_groups.values()), 
                                                key=lambda x: x["time"])
            
            metrics["arrow_history"] = aggregated_history
            metrics["history"] = hashrate_history

            entry = {"timestamp": datetime.now().isoformat(), "metrics": metrics}
            metrics_log.append(entry)
            # Cap the metrics log to three hours worth (180 entries)
            if len(metrics_log) > MAX_HISTORY_ENTRIES:
                metrics_log = metrics_log[-MAX_HISTORY_ENTRIES:]
