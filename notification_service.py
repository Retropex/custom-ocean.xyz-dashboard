# notification_service.py
import logging
import json
import time
import uuid
from datetime import datetime, timedelta
from enum import Enum
from collections import deque
from typing import List, Dict, Any, Optional, Union

# Constants to replace magic values
ONE_DAY_SECONDS = 86400
DEFAULT_TARGET_HOUR = 12
SIGNIFICANT_HASHRATE_CHANGE_PERCENT = 25
NOTIFICATION_WINDOW_MINUTES = 5

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
    
    def _get_redis_value(self, key: str, default: Any = None) -> Any:
        """Generic method to retrieve values from Redis."""
        try:
            if hasattr(self.state_manager, 'redis_client') and self.state_manager.redis_client:
                value = self.state_manager.redis_client.get(key)
                if value:
                    return value.decode('utf-8')
            return default
        except Exception as e:
            logging.error(f"[NotificationService] Error retrieving {key} from Redis: {e}")
            return default

    def _set_redis_value(self, key: str, value: Any) -> bool:
        """Generic method to set values in Redis."""
        try:
            if hasattr(self.state_manager, 'redis_client') and self.state_manager.redis_client:
                self.state_manager.redis_client.set(key, str(value))
                logging.info(f"[NotificationService] Saved {key} to Redis: {value}")
                return True
            return False
        except Exception as e:
            logging.error(f"[NotificationService] Error saving {key} to Redis: {e}")
            return False
    
    def _load_notifications(self) -> None:
        """Load notifications with enhanced error handling."""
        try:
            stored_notifications = self.state_manager.get_notifications()
            if stored_notifications:
                self.notifications = stored_notifications
                logging.info(f"[NotificationService] Loaded {len(self.notifications)} notifications from storage")
            else:
                self.notifications = []
                logging.info("[NotificationService] No notifications found in storage, starting with empty list")
        except Exception as e:
            logging.error(f"[NotificationService] Error loading notifications: {e}")
            self.notifications = []  # Ensure we have a valid list
    
    def _load_last_block_height(self) -> None:
        """Load last block height from persistent storage."""
        try:
            self.last_block_height = self._get_redis_value("last_block_height")
            if self.last_block_height:
                logging.info(f"[NotificationService] Loaded last block height from storage: {self.last_block_height}")
            else:
                logging.info("[NotificationService] No last block height found, starting with None")
        except Exception as e:
            logging.error(f"[NotificationService] Error loading last block height: {e}")
    
    def _save_last_block_height(self) -> None:
        """Save last block height to persistent storage."""
        if self.last_block_height:
            self._set_redis_value("last_block_height", self.last_block_height)
    
    def _save_notifications(self) -> None:
        """Save notifications with improved pruning."""
        try:
            # Sort by timestamp before pruning to ensure we keep the most recent
            if len(self.notifications) > self.max_notifications:
                self.notifications.sort(key=lambda n: n.get("timestamp", ""), reverse=True)
                self.notifications = self.notifications[:self.max_notifications]
                
            self.state_manager.save_notifications(self.notifications)
            logging.info(f"[NotificationService] Saved {len(self.notifications)} notifications")
        except Exception as e:
            logging.error(f"[NotificationService] Error saving notifications: {e}")
    
    def add_notification(self, 
                        message: str, 
                        level: NotificationLevel = NotificationLevel.INFO, 
                        category: NotificationCategory = NotificationCategory.SYSTEM, 
                        data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
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
        
        logging.info(f"[NotificationService] Added notification: {message}")
        return notification
    
    def get_notifications(self, 
                         limit: int = 50, 
                         offset: int = 0, 
                         unread_only: bool = False, 
                         category: Optional[str] = None, 
                         level: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get filtered notifications with optimized filtering.
        
        Args:
            limit (int): Maximum number to return
            offset (int): Starting offset for pagination
            unread_only (bool): Only return unread notifications
            category (str): Filter by category
            level (str): Filter by level
            
        Returns:
            list: Filtered notifications
        """
        # Apply all filters in a single pass
        filtered = [
            n for n in self.notifications
            if (not unread_only or not n.get("read", False)) and
               (not category or n.get("category") == category) and
               (not level or n.get("level") == level)
        ]
        
        # Sort by timestamp (newest first)
        filtered = sorted(filtered, key=lambda n: n.get("timestamp", ""), reverse=True)
        
        # Apply pagination
        return filtered[offset:offset + limit]
    
    def get_unread_count(self) -> int:
        """Get count of unread notifications."""
        return sum(1 for n in self.notifications if not n.get("read", False))
    
    def mark_as_read(self, notification_id: Optional[str] = None) -> bool:
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
                    logging.info(f"[NotificationService] Marked notification {notification_id} as read")
                    break
        else:
            # Mark all as read
            for n in self.notifications:
                n["read"] = True
            logging.info(f"[NotificationService] Marked all {len(self.notifications)} notifications as read")
        
        self._save_notifications()
        return True
    
    def delete_notification(self, notification_id: str) -> bool:
        """
        Delete a specific notification.
        
        Args:
            notification_id (str): ID of notification to delete
            
        Returns:
            bool: True if successful
        """
        original_count = len(self.notifications)
        self.notifications = [n for n in self.notifications if n.get("id") != notification_id]
        deleted = original_count - len(self.notifications)
        
        if deleted > 0:
            logging.info(f"[NotificationService] Deleted notification {notification_id}")
            self._save_notifications()
        
        return deleted > 0
    
    def clear_notifications(self, category: Optional[str] = None, older_than_days: Optional[int] = None) -> int:
        """
        Clear notifications with optimized filtering.
        
        Args:
            category (str, optional): Only clear specific category
            older_than_days (int, optional): Only clear notifications older than this
            
        Returns:
            int: Number of notifications cleared
        """
        original_count = len(self.notifications)
        
        cutoff_date = None
        if older_than_days:
            cutoff_date = datetime.now() - timedelta(days=older_than_days)
            
        # Apply filters in a single pass
        self.notifications = [
            n for n in self.notifications
            if (not category or n.get("category") != category) and
               (not cutoff_date or datetime.fromisoformat(n.get("timestamp", datetime.now().isoformat())) >= cutoff_date)
        ]
        
        cleared_count = original_count - len(self.notifications)
        if cleared_count > 0:
            logging.info(f"[NotificationService] Cleared {cleared_count} notifications")
            self._save_notifications()
        
        return cleared_count
    
    def check_and_generate_notifications(self, current_metrics: Dict[str, Any], previous_metrics: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Check metrics and generate notifications for significant events.
        
        Args:
            current_metrics: Current system metrics
            previous_metrics: Previous system metrics for comparison
            
        Returns:
            list: Newly created notifications
        """
        new_notifications = []
    
        try:
            # Skip if no metrics
            if not current_metrics:
                logging.warning("[NotificationService] No current metrics available, skipping notification checks")
                return new_notifications
        
            # Check for block updates (using persistent storage)
            last_block_height = current_metrics.get("last_block_height")
            if last_block_height and last_block_height != "N/A":
                if self.last_block_height is not None and self.last_block_height != last_block_height:
                    logging.info(f"[NotificationService] Block change detected: {self.last_block_height} -> {last_block_height}")
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
            logging.error(f"[NotificationService] Error generating notifications: {e}")
            error_notification = self.add_notification(
                f"Error generating notifications: {str(e)}",
                level=NotificationLevel.ERROR,
                category=NotificationCategory.SYSTEM
            )
            return [error_notification]
    
    def _should_post_daily_stats(self) -> bool:
        """Check if it's time to post daily stats with improved clarity."""
        now = datetime.now()
        
        # Only proceed if we're in the target hour and within first 5 minutes
        if now.hour != DEFAULT_TARGET_HOUR or now.minute >= NOTIFICATION_WINDOW_MINUTES:
            return False
            
        # If we have a last_daily_stats timestamp, check if it's a different day
        if self.last_daily_stats and now.date() <= self.last_daily_stats.date():
            return False
            
        # All conditions met, update timestamp and return True
        logging.info(f"[NotificationService] Posting daily stats at {now.hour}:{now.minute}")
        self.last_daily_stats = now
        return True
    
    def _generate_daily_stats(self, metrics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Generate daily stats notification."""
        try:
            if not metrics:
                logging.warning("[NotificationService] No metrics available for daily stats")
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
            logging.info(f"[NotificationService] Generating daily stats notification: {message}")
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
            logging.error(f"[NotificationService] Error generating daily stats notification: {e}")
            return None
    
    def _generate_block_notification(self, metrics: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Generate notification for a new block found."""
        try:
            last_block_height = metrics.get("last_block_height", "Unknown")
            last_block_earnings = metrics.get("last_block_earnings", "0")
            
            logging.info(f"[NotificationService] Generating block notification: height={last_block_height}, earnings={last_block_earnings}")
            
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
            logging.error(f"[NotificationService] Error generating block notification: {e}")
            return None
    
    def _parse_numeric_value(self, value_str: Any) -> float:
        """Parse numeric values from strings that may include units."""
        if isinstance(value_str, (int, float)):
            return float(value_str)
            
        if isinstance(value_str, str):
            # Extract just the numeric part
            parts = value_str.split()
            try:
                return float(parts[0])
            except (ValueError, IndexError):
                pass
        
        return 0.0
    
    def _check_hashrate_change(self, current: Dict[str, Any], previous: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Check for significant hashrate changes using 10-minute average."""
        try:
            # Get 10min hashrate values
            current_10min = current.get("hashrate_10min", 0)
            previous_10min = previous.get("hashrate_10min", 0)
    
            # Log what we're comparing
            logging.debug(f"[NotificationService] Comparing 10min hashrates - current: {current_10min}, previous: {previous_10min}")
    
            # Skip if values are missing
            if not current_10min or not previous_10min:
                logging.debug("[NotificationService] Skipping hashrate check - missing values")
                return None
    
            # Parse values consistently
            current_value = self._parse_numeric_value(current_10min)
            previous_value = self._parse_numeric_value(previous_10min)
            
            logging.debug(f"[NotificationService] Converted 10min hashrates - current: {current_value}, previous: {previous_value}")
    
            # Skip if previous was zero (prevents division by zero)
            if previous_value == 0:
                logging.debug("[NotificationService] Skipping hashrate check - previous was zero")
                return None
        
            # Calculate percentage change
            percent_change = ((current_value - previous_value) / previous_value) * 100
            logging.debug(f"[NotificationService] 10min hashrate change: {percent_change:.1f}%")
    
            # Significant decrease
            if percent_change <= -SIGNIFICANT_HASHRATE_CHANGE_PERCENT:
                message = f"Significant 10min hashrate drop detected: {abs(percent_change):.1f}% decrease"
                logging.info(f"[NotificationService] Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_value,
                        "current": current_value,
                        "change": percent_change,
                        "timeframe": "10min"
                    }
                )
    
            # Significant increase
            elif percent_change >= SIGNIFICANT_HASHRATE_CHANGE_PERCENT:
                message = f"10min hashrate increase detected: {percent_change:.1f}% increase"
                logging.info(f"[NotificationService] Generating hashrate notification: {message}")
                return self.add_notification(
                    message,
                    level=NotificationLevel.SUCCESS,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_value,
                        "current": current_value,
                        "change": percent_change,
                        "timeframe": "10min"
                    }
                )
    
            return None
        except Exception as e:
            logging.error(f"[NotificationService] Error checking hashrate change: {e}")
            return None
    
    def _check_earnings_progress(self, current: Dict[str, Any], previous: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Check for significant earnings progress or payout approach."""
        try:
            current_unpaid = self._parse_numeric_value(current.get("unpaid_earnings", "0"))
            
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
                previous_unpaid = self._parse_numeric_value(previous.get("unpaid_earnings", "0"))
                
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
            logging.error(f"[NotificationService] Error checking earnings progress: {e}")
            return None

    def _should_send_payout_notification(self) -> bool:
        """Check if enough time has passed since the last payout notification."""
        if self.last_payout_notification_time is None:
            return True
        time_since_last_notification = datetime.now() - self.last_payout_notification_time
        return time_since_last_notification.total_seconds() > ONE_DAY_SECONDS