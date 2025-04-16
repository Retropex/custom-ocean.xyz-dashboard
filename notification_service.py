# notification_service.py
import logging
import json
import time
import uuid
from datetime import datetime, timedelta
from enum import Enum
from collections import deque

class NotificationLevel(Enum):
    INFO = "info"
    SUCCESS = "success"
    WARNING = "warning"
    ERROR = "error"

class NotificationCategory(Enum):
    HASHRATE = "hashrate"
    BLOCK = "block"
    WORKER = "worker"
    EARNINGS = "earnings"
    SYSTEM = "system"

class NotificationService:
    """Service for managing mining dashboard notifications."""
    
    def __init__(self, state_manager):
        """Initialize with state manager for persistence."""
        self.state_manager = state_manager
        self.notifications = []
        self.daily_stats_time = "00:00:00"  # When to post daily stats (midnight)
        self.last_daily_stats = None
        self.max_notifications = 100  # Maximum number to store
        self.last_block_height = None  # Track the last seen block height
        self.last_payout_notification_time = None  # Track the last payout notification time
        self.last_estimated_payout_time = None  # Track the last estimated payout time
        
        # Load existing notifications from state
        self._load_notifications()
        
        # Load last block height from state
        self._load_last_block_height()
    
    def _load_notifications(self):
        """Load notifications from persistent storage."""
        try:
            stored_notifications = self.state_manager.get_notifications()
            if stored_notifications:
                self.notifications = stored_notifications
                logging.info(f"Loaded {len(self.notifications)} notifications from storage")
        except Exception as e:
            logging.error(f"Error loading notifications: {e}")
    
    def _load_last_block_height(self):
        """Load last block height from persistent storage."""
        try:
            if hasattr(self.state_manager, 'redis_client') and self.state_manager.redis_client:
                # Use Redis if available
                last_height = self.state_manager.redis_client.get("last_block_height")
                if last_height:
                    self.last_block_height = last_height.decode('utf-8')
                    logging.info(f"Loaded last block height from storage: {self.last_block_height}")
            else:
                logging.info("Redis not available, starting with no last block height")
        except Exception as e:
            logging.error(f"Error loading last block height: {e}")
    
    def _save_last_block_height(self):
        """Save last block height to persistent storage."""
        try:
            if hasattr(self.state_manager, 'redis_client') and self.state_manager.redis_client and self.last_block_height:
                self.state_manager.redis_client.set("last_block_height", str(self.last_block_height))
                logging.info(f"Saved last block height to storage: {self.last_block_height}")
        except Exception as e:
            logging.error(f"Error saving last block height: {e}")
    
    def _save_notifications(self):
        """Save notifications to persistent storage."""
        try:
            # Prune to max size before saving
            if len(self.notifications) > self.max_notifications:
                self.notifications = self.notifications[-self.max_notifications:]
                
            self.state_manager.save_notifications(self.notifications)
        except Exception as e:
            logging.error(f"Error saving notifications: {e}")
    
    def add_notification(self, message, level=NotificationLevel.INFO, category=NotificationCategory.SYSTEM, data=None):
        """
        Add a new notification.
        
        Args:
            message (str): Notification message text
            level (NotificationLevel): Severity level
            category (NotificationCategory): Classification category
            data (dict, optional): Additional data for the notification
            
        Returns:
            dict: The created notification
        """
        notification = {
            "id": str(uuid.uuid4()),
            "timestamp": datetime.now().isoformat(),
            "message": message,
            "level": level.value,
            "category": category.value,
            "read": False
        }
        
        if data:
            notification["data"] = data
        
        self.notifications.append(notification)
        self._save_notifications()
        
        logging.info(f"Added notification: {message}")
        return notification
    
    def get_notifications(self, limit=50, offset=0, unread_only=False, category=None, level=None):
        """
        Get filtered notifications.
        
        Args:
            limit (int): Maximum number to return
            offset (int): Starting offset for pagination
            unread_only (bool): Only return unread notifications
            category (str): Filter by category
            level (str): Filter by level
            
        Returns:
            list: Filtered notifications
        """
        filtered = self.notifications
        
        # Apply filters
        if unread_only:
            filtered = [n for n in filtered if not n.get("read", False)]
            
        if category:
            filtered = [n for n in filtered if n.get("category") == category]
            
        if level:
            filtered = [n for n in filtered if n.get("level") == level]
        
        # Sort by timestamp (newest first)
        filtered = sorted(filtered, key=lambda n: n.get("timestamp", ""), reverse=True)
        
        # Apply pagination
        paginated = filtered[offset:offset + limit]
        
        return paginated
    
    def get_unread_count(self):
        """Get count of unread notifications."""
        return sum(1 for n in self.notifications if not n.get("read", False))
    
    def mark_as_read(self, notification_id=None):
        """
        Mark notification(s) as read.
        
        Args:
            notification_id (str, optional): ID of specific notification to mark read,
                                            or None to mark all as read
        
        Returns:
            bool: True if successful
        """
        if notification_id:
            # Mark specific notification as read
            for n in self.notifications:
                if n.get("id") == notification_id:
                    n["read"] = True
                    break
        else:
            # Mark all as read
            for n in self.notifications:
                n["read"] = True
        
        self._save_notifications()
        return True
    
    def delete_notification(self, notification_id):
        """
        Delete a specific notification.
        
        Args:
            notification_id (str): ID of notification to delete
            
        Returns:
            bool: True if successful
        """
        self.notifications = [n for n in self.notifications if n.get("id") != notification_id]
        self._save_notifications()
        return True
    
    def clear_notifications(self, category=None, older_than_days=None):
        """
        Clear notifications.
        
        Args:
            category (str, optional): Only clear specific category
            older_than_days (int, optional): Only clear notifications older than this
            
        Returns:
            int: Number of notifications cleared
        """
        original_count = len(self.notifications)
        
        if category and older_than_days:
            cutoff_date = datetime.now() - timedelta(days=older_than_days)
            self.notifications = [
                n for n in self.notifications 
                if n.get("category") != category or 
                datetime.fromisoformat(n.get("timestamp", datetime.now().isoformat())) >= cutoff_date
            ]
        elif category:
            self.notifications = [n for n in self.notifications if n.get("category") != category]
        elif older_than_days:
            cutoff_date = datetime.now() - timedelta(days=older_than_days)
            self.notifications = [
                n for n in self.notifications 
                if datetime.fromisoformat(n.get("timestamp", datetime.now().isoformat())) >= cutoff_date
            ]
        else:
            self.notifications = []
        
        self._save_notifications()
        return original_count - len(self.notifications)
    
    def check_and_generate_notifications(self, current_metrics, previous_metrics):
        """
        Check metrics and generate notifications for significant events.
        """
        new_notifications = []
    
        try:
            # Skip if no metrics
            if not current_metrics:
                logging.warning("No current metrics available, skipping notification checks")
                return new_notifications
        
            # Check for block updates (using persistent storage)
            last_block_height = current_metrics.get("last_block_height")
            if last_block_height and last_block_height != "N/A":
                if self.last_block_height is not None and self.last_block_height != last_block_height:
                    logging.info(f"Block change detected: {self.last_block_height} -> {last_block_height}")
                    block_notification = self._generate_block_notification(current_metrics)
                    if block_notification:
                        new_notifications.append(block_notification)
            
                # Always update the stored last block height when it changes
                if self.last_block_height != last_block_height:
                    self.last_block_height = last_block_height
                    self._save_last_block_height()
        
            # Regular comparison with previous metrics
            if previous_metrics:
                # Check for daily stats
                if self._should_post_daily_stats():
                    stats_notification = self._generate_daily_stats(current_metrics)
                    if stats_notification:
                        new_notifications.append(stats_notification)
            
                # Check for significant hashrate drop
                hashrate_notification = self._check_hashrate_change(current_metrics, previous_metrics)
                if hashrate_notification:
                    new_notifications.append(hashrate_notification)
            
                # Check for earnings and payout progress
                earnings_notification = self._check_earnings_progress(current_metrics, previous_metrics)
                if earnings_notification:
                    new_notifications.append(earnings_notification)
        
            return new_notifications
            
        except Exception as e:
            logging.error(f"Error generating notifications: {e}")
            error_notification = self.add_notification(
                f"Error generating notifications: {str(e)}",
                level=NotificationLevel.ERROR,
                category=NotificationCategory.SYSTEM
            )
            return [error_notification]
    
    def _should_post_daily_stats(self):
        """Check if it's time to post daily stats (once per day at 12 PM)."""
        now = datetime.now()
    
        # Target time is 12 PM (noon)
        target_hour = 12
        current_hour = now.hour
        current_minute = now.minute
    
        # If we have a last_daily_stats timestamp
        if self.last_daily_stats:
            # Check if it's a different day
            is_different_day = now.date() > self.last_daily_stats.date()
        
            # Only post if:
            # 1. It's a different day AND
            # 2. It's the target hour (12 PM) AND
            # 3. It's within the first 5 minutes of that hour
            if is_different_day and current_hour == target_hour and current_minute < 5:
                logging.info(f"Posting daily stats at {current_hour}:{current_minute}")
                self.last_daily_stats = now
                return True
        else:
            # First time - post if we're at the target hour
            if current_hour == target_hour and current_minute < 5:
                logging.info(f"First time posting daily stats at {current_hour}:{current_minute}")
                self.last_daily_stats = now
                return True
    
        return False
    
    def _generate_daily_stats(self, metrics):
        """Generate daily stats notification."""
        try:
            if not metrics:
                logging.warning("No metrics available for daily stats")
                return None
                
            # Format hashrate with appropriate unit
            hashrate_24hr = metrics.get("hashrate_24hr", 0)
            hashrate_unit = metrics.get("hashrate_24hr_unit", "TH/s")
            
            # Format daily earnings
            daily_mined_sats = metrics.get("daily_mined_sats", 0)
            daily_profit_usd = metrics.get("daily_profit_usd", 0)
            
            # Build message
            message = f"Daily Mining Summary: {hashrate_24hr} {hashrate_unit} average hashrate, {daily_mined_sats} SATS mined (${daily_profit_usd:.2f})"
            
            # Add notification
            logging.info(f"Generating daily stats notification: {message}")
            return self.add_notification(
                message,
                level=NotificationLevel.INFO,
                category=NotificationCategory.HASHRATE,
                data={
                    "hashrate": hashrate_24hr,
                    "unit": hashrate_unit,
                    "daily_sats": daily_mined_sats,
                    "daily_profit": daily_profit_usd
                }
            )
        except Exception as e:
            logging.error(f"Error generating daily stats notification: {e}")
            return None
    
    def _generate_block_notification(self, metrics):
        """Generate notification for a new block found."""
        try:
            last_block_height = metrics.get("last_block_height", "Unknown")
            last_block_earnings = metrics.get("last_block_earnings", "0")
            
            logging.info(f"Generating block notification: height={last_block_height}, earnings={last_block_earnings}")
            
            message = f"New block found by the pool! Block #{last_block_height}, earnings: {last_block_earnings} SATS"
            
            return self.add_notification(
                message,
                level=NotificationLevel.SUCCESS,
                category=NotificationCategory.BLOCK,
                data={
                    "block_height": last_block_height,
                    "earnings": last_block_earnings
                }
            )
        except Exception as e:
            logging.error(f"Error generating block notification: {e}")
            return None
    
    def _check_hashrate_change(self, current, previous):
        """Check for significant hashrate changes using 10-minute average."""
        try:
            # Change from 3hr to 10min hashrate values
            current_10min = current.get("hashrate_10min", 0)
            previous_10min = previous.get("hashrate_10min", 0)
    
            # Log what we're comparing
            logging.debug(f"Comparing 10min hashrates - current: {current_10min}, previous: {previous_10min}")
    
            # Skip if values are missing
            if not current_10min or not previous_10min:
                logging.debug("Skipping hashrate check - missing values")
                return None
    
            # Handle strings with units (e.g., "10.5 TH/s")
            if isinstance(current_10min, str):
                current_10min = float(current_10min.split()[0])
            else:
                current_10min = float(current_10min)
        
            if isinstance(previous_10min, str):
                previous_10min = float(previous_10min.split()[0])
            else:
                previous_10min = float(previous_10min)
        
            logging.debug(f"Converted 10min hashrates - current: {current_10min}, previous: {previous_10min}")
    
            # Skip if previous was zero (prevents division by zero)
            if previous_10min == 0:
                logging.debug("Skipping hashrate check - previous was zero")
                return None
        
            # Calculate percentage change
            percent_change = ((current_10min - previous_10min) / previous_10min) * 100
            logging.debug(f"10min hashrate change: {percent_change:.1f}%")
    
            # Significant decrease (more than 25%)
            if percent_change <= -25:
                message = f"Significant 10min hashrate drop detected: {abs(percent_change):.1f}% decrease"
                logging.info(f"Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_10min,
                        "current": current_10min,
                        "change": percent_change,
                        "timeframe": "10min"  # Add timeframe to the data
                    }
                )
    
            # Significant increase (more than 25%)
            elif percent_change >= 25:
                message = f"10min hashrate increase detected: {percent_change:.1f}% increase"
                logging.info(f"Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.SUCCESS,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_10min,
                        "current": current_10min,
                        "change": percent_change,
                        "timeframe": "10min"  # Add timeframe to the data
                    }
                )
    
            return None
        except Exception as e:
            logging.error(f"Error checking hashrate change: {e}")
            return None
    
    def _check_earnings_progress(self, current, previous):
        """Check for significant earnings progress or payout approach."""
        try:
            current_unpaid = float(current.get("unpaid_earnings", "0").split()[0]) if isinstance(current.get("unpaid_earnings"), str) else current.get("unpaid_earnings", 0)
            
            # Check if approaching payout
            if current.get("est_time_to_payout"):
                est_time = current.get("est_time_to_payout")
                
                # If estimated time is a number of days
                if est_time.isdigit() or (est_time[0] == '-' and est_time[1:].isdigit()):
                    days = int(est_time)
                    if 0 < days <= 1:
                        if self._should_send_payout_notification():
                            message = f"Payout approaching! Estimated within 1 day"
                            self.last_payout_notification_time = datetime.now()
                            return self.add_notification(
                                message,
                                level=NotificationLevel.SUCCESS,
                                category=NotificationCategory.EARNINGS,
                                data={"days_to_payout": days}
                            )
                # If it says "next block"
                elif "next block" in est_time.lower():
                    if self._should_send_payout_notification():
                        message = f"Payout expected with next block!"
                        self.last_payout_notification_time = datetime.now()
                        return self.add_notification(
                            message,
                            level=NotificationLevel.SUCCESS,
                            category=NotificationCategory.EARNINGS,
                            data={"payout_imminent": True}
                        )
            
            # Check for payout (unpaid balance reset)
            if previous.get("unpaid_earnings"):
                previous_unpaid = float(previous.get("unpaid_earnings", "0").split()[0]) if isinstance(previous.get("unpaid_earnings"), str) else previous.get("unpaid_earnings", 0)
                
                # If balance significantly decreased, likely a payout occurred
                if previous_unpaid > 0 and current_unpaid < previous_unpaid * 0.5:
                    message = f"Payout received! Unpaid balance reset from {previous_unpaid} to {current_unpaid} BTC"
                    return self.add_notification(
                        message,
                        level=NotificationLevel.SUCCESS,
                        category=NotificationCategory.EARNINGS,
                        data={
                            "previous_balance": previous_unpaid,
                            "current_balance": current_unpaid,
                            "payout_amount": previous_unpaid - current_unpaid
                        }
                    )
            
            return None
        except Exception as e:
            logging.error(f"Error checking earnings progress: {e}")
            return None

    def _should_send_payout_notification(self):
        """Check if enough time has passed since the last payout notification."""
        if self.last_payout_notification_time is None:
            return True
        time_since_last_notification = datetime.now() - self.last_payout_notification_time
        return time_since_last_notification.total_seconds() > 86400  # 1 Day