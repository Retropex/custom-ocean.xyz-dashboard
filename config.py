"""
Configuration management module for the Bitcoin Mining Dashboard.
Responsible for loading and managing application settings.
"""
import os
import json
import logging

# Default configuration file path
CONFIG_FILE = "config.json"

def load_config():
    """
    Load configuration from file or return defaults if file doesn't exist.
    """
    default_config = {
        "power_cost": 0.0,
        "power_usage": 0.0,
        "wallet": "yourwallethere",
        "timezone": "America/Los_Angeles",
        "network_fee": 0.0,  # Add default network fee
        "currency": "USD" # Default currency
    }
    
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r") as f:
                config = json.load(f)
            logging.info(f"Configuration loaded from {CONFIG_FILE}")
            
            # Ensure network_fee is present even in existing config files
            if "network_fee" not in config:
                config["network_fee"] = default_config["network_fee"]
                logging.info("Added missing network_fee to config with default value")
                
            return config
        except Exception as e:
            logging.error(f"Error loading config: {e}")
    else:
        logging.warning(f"Config file {CONFIG_FILE} not found, using defaults")
        
    return default_config

def get_timezone():
    """
    Get the configured timezone with fallback to default.
    
    Returns:
        str: Timezone identifier
    """
    # First check environment variable (for Docker)
    import os
    env_timezone = os.environ.get("TIMEZONE")
    if env_timezone:
        return env_timezone
    
    # Then check config file
    config = load_config()
    timezone = config.get("timezone")
    if timezone:
        return timezone
    
    # Default to Los Angeles
    return "America/Los_Angeles"

def save_config(config):
    """
    Save configuration to file.
    
    Args:
        config (dict): Configuration dictionary to save
    
    Returns:
        bool: True if save was successful, False otherwise
    """
    try:
        with open(CONFIG_FILE, "w") as f:
            json.dump(config, f, indent=2)
        logging.info(f"Configuration saved to {CONFIG_FILE}")
        return True
    except Exception as e:
        logging.error(f"Error saving config: {e}")
        return False

def get_value(key, default=None):
    """
    Get a configuration value by key with fallback to default.
    
    Args:
        key (str): Configuration key to look up
        default: Default value if key is not found
    
    Returns:
        Value for the key or default if not found
    """
    config = load_config()
    return config.get(key, default)

def get_currency():
    """
    Get the configured currency with fallback to default.
    
    Returns:
        str: Currency code (e.g., 'USD', 'EUR', etc.)
    """
    # First check environment variable (for Docker)
    import os
    env_currency = os.environ.get("CURRENCY")
    if env_currency:
        return env_currency
    
    # Then check config file
    config = load_config()
    currency = config.get("currency")
    if currency:
        return currency
    
    # Default to USD
    return "USD"
