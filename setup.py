"""
Setup script to prepare project structure and directories.
"""
import os
import shutil
import logging

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Directory structure to create
DIRECTORIES = [
    'static/css',
    'static/js',
    'static/img',
    'templates',
    'logs'
]

# Files to move to their correct locations
FILE_MAPPINGS = {
    # CSS files
    'common.css': 'static/css/common.css',
    'dashboard.css': 'static/css/dashboard.css',
    'workers.css': 'static/css/workers.css',
    'boot.css': 'static/css/boot.css',
    'error.css': 'static/css/error.css',
    'retro-refresh.css': 'static/css/retro-refresh.css',
    
    # JS files
    'main.js': 'static/js/main.js',
    'workers.js': 'static/js/workers.js',
    'retro-refresh.js': 'static/js/retro-refresh.js',
    
    # Template files
    'base.html': 'templates/base.html',
    'dashboard.html': 'templates/dashboard.html',
    'workers.html': 'templates/workers.html',
    'boot.html': 'templates/boot.html',
    'error.html': 'templates/error.html',
}

def create_directory_structure():
    """Create the necessary directory structure."""
    for directory in DIRECTORIES:
        os.makedirs(directory, exist_ok=True)
        logging.info(f"Created directory: {directory}")

def move_files():
    """Move files to their correct locations."""
    for source, destination in FILE_MAPPINGS.items():
        if os.path.exists(source):
            # Create the directory if it doesn't exist
            os.makedirs(os.path.dirname(destination), exist_ok=True)
            
            # Copy the file to its destination
            shutil.copy2(source, destination)
            logging.info(f"Moved {source} to {destination}")
        else:
            logging.warning(f"Source file not found: {source}")

def create_empty_config():
    """Create an empty config.json file if it doesn't exist."""
    if not os.path.exists('config.json'):
        with open('config.json', 'w') as f:
            f.write('{\n  "power_cost": 0.0,\n  "power_usage": 0.0,\n  "wallet": "bc1py5zmrtssheq3shd8cptpl5l5m3txxr5afynyg2gyvam6w78s4dlqqnt4v9"\n}')
        logging.info("Created empty config.json")

def main():
    """Main setup function."""
    logging.info("Starting setup process")
    
    # Create directory structure
    create_directory_structure()
    
    # Move files to their correct locations
    move_files()
    
    # Create empty config.json
    create_empty_config()
    
    logging.info("Setup completed successfully")

if __name__ == "__main__":
    main()
