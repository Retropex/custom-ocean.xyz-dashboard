# Project Structure

This document outlines the structure of the Bitcoin Mining Dashboard project to help with navigation and understanding of the codebase.

## Directory Structure

```
bitcoin-mining-dashboard/
│
├── templates/                  # HTML templates
│   ├── base.html              # Base template with common elements
│   ├── boot.html              # Boot sequence animation
│   ├── dashboard.html         # Main dashboard template
│   ├── workers.html           # Workers dashboard template
│   └── error.html             # Error page template
│
├── static/                     # Static assets
│   ├── css/                   # CSS files
│   │   ├── common.css         # Shared styles across all pages
│   │   ├── dashboard.css      # Main dashboard styles
│   │   ├── workers.css        # Workers page styles
│   │   ├── boot.css           # Boot sequence styles
│   │   ├── error.css          # Error page styles
│   │   └── retro-refresh.css  # Floating refresh bar styles
│   │
│   └── js/                    # JavaScript files
│       ├── main.js            # Main dashboard functionality
│       ├── workers.js         # Workers page functionality
│       └── retro-refresh.js   # Floating refresh bar functionality
│
├── App.py                      # Main application entry point
├── models.py                   # Data models and conversion utilities
├── config.py                   # Configuration management
├── data_service.py             # Service for fetching mining data
├── worker_service.py           # Service for worker data management
├── state_manager.py            # Manager for persistent state
├── requirements.txt            # Python dependencies
├── config.json                 # Configuration file
├── Dockerfile                  # Docker configuration
├── minify.py                   # HTML minification utility
└── README.md                   # Project documentation
```

## Main Components

### Core Application Files

- **App.py**: The main Flask application with routes and initialization
- **models.py**: Data structures and type conversion utilities
- **config.py**: Configuration loading and management
- **data_service.py**: Service for fetching data from Ocean.xyz and other sources
- **worker_service.py**: Service for worker data management and simulation
- **state_manager.py**: Manager for persistent state and history tracking

### Templates

- **base.html**: Base template with shared layout and navigation
- **dashboard.html**: Main dashboard view with hashrate charts and metrics
- **workers.html**: Workers overview with individual worker cards
- **boot.html**: Retro boot sequence animation
- **error.html**: Error page with retro styling

### Static Assets

- **CSS Files**: Modularized styles for each page and component
- **JavaScript Files**: Client-side functionality for each page

## Architecture Overview

The application follows a modular architecture pattern:

1. **Models**: Define data structures and type conversions
2. **Services**: Handle specific functionality like data fetching and worker management
3. **State Management**: Track history and provide persistence
4. **Application**: Tie everything together with Flask routes

Data flows from external sources (Ocean.xyz API) through the services, gets processed and stored, and is then presented to the user through the templates.

Real-time updates are provided through Server-Sent Events (SSE) for a responsive experience without page reloads.

## Key Features

- Real-time monitoring of mining metrics
- Persistent state storage with Redis
- Worker simulation for comprehensive dashboard
- Historical tracking of metrics
- Background scheduler for regular updates
- Resilient error handling and recovery
