"""
Main application module for the Bitcoin Mining Dashboard.
"""
import os
import logging
import time
import gc
import psutil
import signal
import sys
import threading
import json
from flask import Flask, render_template, jsonify, Response, request
from datetime import datetime
from zoneinfo import ZoneInfo
from flask_caching import Cache
from apscheduler.schedulers.background import BackgroundScheduler
from notification_service import NotificationService, NotificationLevel, NotificationCategory

# Import custom modules
from config import load_config, save_config
from data_service import MiningDashboardService
from worker_service import WorkerService
from state_manager import StateManager, arrow_history, metrics_log
from config import get_timezone

# Initialize Flask app
app = Flask(__name__)

# Set up caching using a simple in-memory cache
cache = Cache(app, config={'CACHE_TYPE': 'SimpleCache', 'CACHE_DEFAULT_TIMEOUT': 10})

# Global variables for SSE connections and metrics
MAX_SSE_CONNECTIONS = 10  # Maximum concurrent SSE connections
MAX_SSE_CONNECTION_TIME = 900  # 15 minutes maximum SSE connection time
active_sse_connections = 0
sse_connections_lock = threading.Lock()

# Global variables for metrics and scheduling
cached_metrics = None
last_metrics_update_time = None
scheduler_last_successful_run = None
scheduler_recreate_lock = threading.Lock()

# Track scheduler health
scheduler = None

# Global start time
SERVER_START_TIME = datetime.now(ZoneInfo(get_timezone()))

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Initialize state manager with Redis URL from environment
redis_url = os.environ.get("REDIS_URL")
state_manager = StateManager(redis_url)

# Initialize notification service after state_manager
notification_service = NotificationService(state_manager)

# --- Disable Client Caching for All Responses ---
@app.after_request
def add_header(response):
    """Disable browser caching for all responses."""
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# --- Memory usage monitoring ---
def log_memory_usage():
    """Log current memory usage."""
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

# --- Modified update_metrics_job function ---
def update_metrics_job(force=False):
    """
    Background job to update metrics.
    
    Args:
        force (bool): Whether to force update regardless of timing
    """
    global cached_metrics, last_metrics_update_time, scheduler, scheduler_last_successful_run
    
    logging.info("Starting update_metrics_job")

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
        logging.info(f"Updated last_metrics_update_time: {last_metrics_update_time}")
        
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
            # Use the dashboard service to fetch metrics
            metrics = dashboard_service.fetch_metrics()
            if metrics:
                logging.info("Fetched metrics successfully")
    
                # First check for notifications by comparing new metrics with old cached metrics
                notification_service.check_and_generate_notifications(metrics, cached_metrics)
    
                # Then update cached metrics after comparison
                cached_metrics = metrics
    
                # Update state history (only once)
                state_manager.update_metrics_history(metrics)
    
                logging.info("Background job: Metrics updated successfully")
                job_successful = True
                
                # Mark successful run time for watchdog
                scheduler_last_successful_run = time.time()
                logging.info(f"Updated scheduler_last_successful_run: {scheduler_last_successful_run}")

                # Persist critical state
                state_manager.persist_critical_state(cached_metrics, scheduler_last_successful_run, last_metrics_update_time)
                
                # Periodically check and prune data to prevent memory growth
                if current_time % 300 < 60:  # Every ~5 minutes
                    logging.info("Pruning old data")
                    state_manager.prune_old_data()
                    
                # Only save state to Redis on a similar schedule, not every update
                if current_time % 300 < 60:  # Every ~5 minutes
                    logging.info("Saving graph state")
                    state_manager.save_graph_state()
                    
                # Periodic full memory cleanup (every 2 hours)
                if current_time % 7200 < 60:  # Every ~2 hours
                    logging.info("Performing full memory cleanup")
                    gc.collect(generation=2)  # Force full collection
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
    logging.info("Completed update_metrics_job")

# --- SchedulerWatchdog to monitor and recover ---
def scheduler_watchdog():
    """Periodically check if the scheduler is running and healthy."""
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
        scheduler = new_scheduler
        return new_scheduler
    except Exception as e:
        logging.error(f"Error creating scheduler: {e}")
        return None

# --- Custom Template Filter ---
@app.template_filter('commafy')
def commafy(value):
    """Add commas to numbers for better readability."""
    try:
        return "{:,}".format(int(value))
    except Exception:
        return value

# --- Fixed SSE Endpoint with proper request context handling ---
@app.route('/stream')
def stream():
    """SSE endpoint for real-time updates."""
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
                "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
                "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo(get_timezone())).isoformat(),
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
            current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
            return render_template("dashboard.html", metrics=default_metrics, current_time=current_time)
    
    # If we have metrics, use them
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %H:%M:%S %p")
    return render_template("dashboard.html", metrics=cached_metrics, current_time=current_time)

@app.route("/api/metrics")
def api_metrics():
    """API endpoint for metrics data."""
    if cached_metrics is None:
        update_metrics_job()
    return jsonify(cached_metrics)

@app.route("/api/available_timezones")
def available_timezones():
    """Return a list of available timezones."""
    from zoneinfo import available_timezones
    return jsonify({"timezones": sorted(available_timezones())})

@app.route('/api/timezone', methods=['GET'])
def get_timezone_config():
    from flask import jsonify
    from config import get_timezone
    return jsonify({"timezone": get_timezone()})

# Add this new route to App.py
@app.route("/blocks")
def blocks_page():
    """Serve the blocks overview page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
    return render_template("blocks.html", current_time=current_time)

# --- Workers Dashboard Route and API ---
@app.route("/workers")
def workers_dashboard():
    """Serve the workers overview dashboard page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%Y-%m-%d %I:%M:%S %p")

    # Only get minimal worker stats for initial page load
    # Client-side JS will fetch the full data via API
    workers_data = worker_service.get_workers_data(cached_metrics)
    
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
    return jsonify(worker_service.get_workers_data(cached_metrics, force_refresh=force_refresh))

# --- New Time Endpoint for Fine Syncing ---
@app.route("/api/time")
def api_time():
    """API endpoint for server time."""
    return jsonify({ # correct time
        "server_timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat(),
        "server_start_time": SERVER_START_TIME.astimezone(ZoneInfo(get_timezone())).isoformat()
    })

# --- New Config Endpoints ---
@app.route("/api/config", methods=["GET"])
def get_config():
    """API endpoint to get current configuration."""
    try:
        config = load_config()
        return jsonify(config)
    except Exception as e:
        logging.error(f"Error getting configuration: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/api/config", methods=["POST"])
def update_config():
    """API endpoint to update configuration."""
    global dashboard_service, worker_service  # Add this to access the global dashboard_service
    
    try:
        # Get the request data
        new_config = request.json
        logging.info(f"Received config update request: {new_config}")
        
        # Validate the configuration data
        if not isinstance(new_config, dict):
            logging.error("Invalid configuration format")
            return jsonify({"error": "Invalid configuration format"}), 400
            
        # Required fields and default values
        defaults = {
            "wallet": "yourwallethere",
            "power_cost": 0.0,
            "power_usage": 0.0
        }
        
        # Merge new config with defaults for any missing fields
        for key, value in defaults.items():
            if key not in new_config or new_config[key] is None:
                new_config[key] = value
                
        # Save the configuration
        logging.info(f"Saving configuration: {new_config}")
        if save_config(new_config):
            # Important: Reinitialize the dashboard service with the new configuration
            dashboard_service = MiningDashboardService(
                new_config.get("power_cost", 0.0),
                new_config.get("power_usage", 0.0),
                new_config.get("wallet")
            )
            logging.info(f"Dashboard service reinitialized with new wallet: {new_config.get('wallet')}")

            # Update worker service to use the new dashboard service (with the updated wallet)
            worker_service.set_dashboard_service(dashboard_service)
            logging.info(f"Worker service updated with the new dashboard service")
            
            # Force a metrics update to reflect the new configuration
            update_metrics_job(force=True)
            logging.info("Forced metrics update after configuration change")
            
            # Return success response with the saved configuration
            return jsonify({
                "status": "success",
                "message": "Configuration saved successfully",
                "config": new_config
            })
        else:
            logging.error("Failed to save configuration")
            return jsonify({"error": "Failed to save configuration"}), 500
    except Exception as e:
        logging.error(f"Error updating configuration: {e}")
        return jsonify({"error": str(e)}), 500

# Health check endpoint with detailed diagnostics
@app.route("/api/health")
def health_check():
    """Health check endpoint with enhanced system diagnostics."""
    # Calculate uptime
    uptime_seconds = (datetime.now(ZoneInfo(get_timezone())) - SERVER_START_TIME).total_seconds()
    
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
            data_age = (datetime.now(ZoneInfo(get_timezone())) - last_update).total_seconds()
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
            "connected": state_manager.redis_client is not None
        },
        "timestamp": datetime.now(ZoneInfo(get_timezone())).isoformat()
    }
    
    # Log health check if status is not healthy
    if health_status != "healthy":
        logging.warning(f"Health check returning {health_status} status: {status}")
    
    return jsonify(status)

# Add enhanced scheduler health check endpoint
@app.route("/api/scheduler-health")
def scheduler_health():
    """API endpoint for scheduler health information."""
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
    """API endpoint to recreate the scheduler."""
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

@app.route("/api/force-refresh", methods=["POST"])
def force_refresh():
    """Emergency endpoint to force metrics refresh."""
    logging.warning("Emergency force-refresh requested")
    try:
        # Force fetch new metrics
        metrics = dashboard_service.fetch_metrics()
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

@app.route("/api/notifications")
def api_notifications():
    """API endpoint for notification data."""
    limit = request.args.get('limit', 50, type=int)
    offset = request.args.get('offset', 0, type=int)
    unread_only = request.args.get('unread_only', 'false').lower() == 'true'
    category = request.args.get('category')
    level = request.args.get('level')
    
    notifications = notification_service.get_notifications(
        limit=limit,
        offset=offset,
        unread_only=unread_only,
        category=category,
        level=level
    )
    
    unread_count = notification_service.get_unread_count()
    
    return jsonify({
        "notifications": notifications,
        "unread_count": unread_count,
        "total": len(notifications),
        "limit": limit,
        "offset": offset
    })

@app.route("/api/notifications/unread_count")
def api_unread_count():
    """API endpoint for unread notification count."""
    return jsonify({
        "unread_count": notification_service.get_unread_count()
    })

@app.route("/api/notifications/mark_read", methods=["POST"])
def api_mark_read():
    """API endpoint to mark notifications as read."""
    notification_id = request.json.get('notification_id')
    
    success = notification_service.mark_as_read(notification_id)
    
    return jsonify({
        "success": success,
        "unread_count": notification_service.get_unread_count()
    })

@app.route("/api/notifications/delete", methods=["POST"])
def api_delete_notification():
    """API endpoint to delete a notification."""
    notification_id = request.json.get('notification_id')
    
    if not notification_id:
        return jsonify({"error": "notification_id is required"}), 400
    
    success = notification_service.delete_notification(notification_id)
    
    return jsonify({
        "success": success,
        "unread_count": notification_service.get_unread_count()
    })

@app.route("/api/notifications/clear", methods=["POST"])
def api_clear_notifications():
    """API endpoint to clear notifications."""
    category = request.json.get('category')
    older_than_days = request.json.get('older_than_days')
    
    cleared_count = notification_service.clear_notifications(
        category=category,
        older_than_days=older_than_days
    )
    
    return jsonify({
        "success": True,
        "cleared_count": cleared_count,
        "unread_count": notification_service.get_unread_count()
    })

# Add notifications page route
@app.route("/notifications")
def notifications_page():
    """Serve the notifications page."""
    current_time = datetime.now(ZoneInfo(get_timezone())).strftime("%b %d, %Y, %I:%M:%S %p")
    return render_template("notifications.html", current_time=current_time)

@app.errorhandler(404)
def page_not_found(e):
    """Error handler for 404 errors."""
    return render_template("error.html", message="Page not found."), 404

@app.errorhandler(500)
def internal_server_error(e):
    """Error handler for 500 errors."""
    logging.error("Internal server error: %s", e)
    return render_template("error.html", message="Internal server error."), 500

class RobustMiddleware:
    """WSGI middleware for enhanced error handling."""
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        try:
            return self.app(environ, start_response)
        except Exception as e:
            logging.exception("Unhandled exception in WSGI app")
            start_response("500 Internal Server Error", [("Content-Type", "text/html")])
            return [b"<h1>Internal Server Error</h1>"]

@app.route("/api/reset-chart-data", methods=["POST"])
def reset_chart_data():
    """API endpoint to reset chart data history."""
    try:
        global arrow_history, state_manager
        
        # Clear hashrate data from in-memory dictionary
        hashrate_keys = ["hashrate_60sec", "hashrate_3hr", "hashrate_10min", "hashrate_24hr"]
        for key in hashrate_keys:
            if key in arrow_history:
                arrow_history[key] = []
        
        # Force an immediate save to Redis if available
        if state_manager and hasattr(state_manager, 'redis_client') and state_manager.redis_client:
            # Force save by overriding the time check
            state_manager.last_save_time = 0
            state_manager.save_graph_state()
            logging.info("Chart data reset saved to Redis immediately")
        
        return jsonify({"status": "success", "message": "Chart data reset successfully"})
    except Exception as e:
        logging.error(f"Error resetting chart data: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

# Add the middleware
app.wsgi_app = RobustMiddleware(app.wsgi_app)

# Update this section in App.py to properly initialize services

# Initialize the dashboard service and worker service
config = load_config()
dashboard_service = MiningDashboardService(
    config.get("power_cost", 0.0),
    config.get("power_usage", 0.0),
    config.get("wallet")
)
worker_service = WorkerService()
# Connect the services
worker_service.set_dashboard_service(dashboard_service)

# Restore critical state if available
last_run, last_update = state_manager.load_critical_state()
if last_run:
    scheduler_last_successful_run = last_run
if last_update:
    last_metrics_update_time = last_update

# Initialize the scheduler
scheduler = create_scheduler()

# Graceful shutdown handler for clean termination
def graceful_shutdown(signum, frame):
    """Handle shutdown signals gracefully."""
    logging.info(f"Received shutdown signal {signum}, shutting down gracefully")
    
    # Save state before shutting down
    state_manager.save_graph_state()
    
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

# Run once at startup to initialize data
update_metrics_job(force=True)

if __name__ == "__main__":
    # When deploying with Gunicorn in Docker, run with --workers=1 --threads=8 to ensure global state is shared.
    app.run(host="0.0.0.0", port=5000, debug=False, use_reloader=False)
