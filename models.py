"""
Data models for the Bitcoin Mining Dashboard.
"""
from dataclasses import dataclass
import logging

@dataclass
class OceanData:
    """Data structure for Ocean.xyz pool mining data."""
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
    last_block_earnings: str = None
    pool_fees_percentage: float = None  # Added missing attribute

@dataclass
class WorkerData:
    """Data structure for individual worker information."""
    name: str = None
    status: str = "offline"
    type: str = "ASIC"  # ASIC or Bitaxe
    model: str = "Unknown"
    hashrate_60sec: float = 0
    hashrate_60sec_unit: str = "TH/s"
    hashrate_3hr: float = 0
    hashrate_3hr_unit: str = "TH/s"
    efficiency: float = 0
    last_share: str = "N/A"
    earnings: float = 0
    acceptance_rate: float = 0
    power_consumption: float = 0
    temperature: float = 0

def convert_to_ths(value, unit):
    """
    Convert any hashrate unit to TH/s equivalent.
    
    Args:
        value (float): The numerical value of the hashrate
        unit (str): The unit of measurement (e.g., 'PH/s', 'EH/s', etc.)
    
    Returns:
        float: The hashrate value in TH/s
    """
    if value is None or value == 0:
        return 0
        
    try:
        unit = unit.lower() if unit else 'th/s'
        
        if 'ph/s' in unit:
            return value * 1000  # 1 PH/s = 1000 TH/s
        elif 'eh/s' in unit:
            return value * 1000000  # 1 EH/s = 1,000,000 TH/s
        elif 'gh/s' in unit:
            return value / 1000  # 1 TH/s = 1000 GH/s
        elif 'mh/s' in unit:
            return value / 1000000  # 1 TH/s = 1,000,000 MH/s
        elif 'kh/s' in unit:
            return value / 1000000000  # 1 TH/s = 1,000,000,000 KH/s
        elif 'h/s' in unit and not any(prefix in unit for prefix in ['th/s', 'ph/s', 'eh/s', 'gh/s', 'mh/s', 'kh/s']):
            return value / 1000000000000  # 1 TH/s = 1,000,000,000,000 H/s
        elif 'th/s' in unit:
            return value
        else:
            # Log unexpected unit
            logging.warning(f"Unexpected hashrate unit: {unit}, defaulting to treating as TH/s")
            return value
    except Exception as e:
        logging.error(f"Error in convert_to_ths: {e}")
        return value  # Return original value as fallback
