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
        
        # Load existing notifications from state
        self._load_notifications()
    
    def _load_notifications(self):
        """Load notifications from persistent storage."""
        try:
            stored_notifications = self.state_manager.get_notifications()
            if stored_notifications:
                self.notifications = stored_notifications
                logging.info(f"Loaded {len(self.notifications)} notifications from storage")
        except Exception as e:
            logging.error(f"Error loading notifications: {e}")
    
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
        
        Args:
            current_metrics (dict): Current mining metrics
            previous_metrics (dict): Previous mining metrics
            
        Returns:
            list: Newly created notifications
        """
        new_notifications = []
        
        try:
            # Check for daily stats
            if self._should_post_daily_stats():
                stats_notification = self._generate_daily_stats(current_metrics)
                if stats_notification:
                    new_notifications.append(stats_notification)
            
            # Check for blocks found
            if previous_metrics and current_metrics:
                if self._check_blocks_found(current_metrics, previous_metrics):
                    block_notification = self._generate_block_notification(current_metrics)
                    if block_notification:
                        new_notifications.append(block_notification)
            
            # Check for significant hashrate drop
            if previous_metrics and current_metrics:
                hashrate_notification = self._check_hashrate_change(current_metrics, previous_metrics)
                if hashrate_notification:
                    new_notifications.append(hashrate_notification)
            
            # Check for worker status changes
            if previous_metrics and current_metrics:
                worker_notification = self._check_worker_status_change(current_metrics, previous_metrics)
                if worker_notification:
                    new_notifications.append(worker_notification)
            
            # Check for earnings and payout progress
            if previous_metrics and current_metrics:
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
        """Check if it's time to post daily stats."""
        now = datetime.now()
        
        # If we have a last_daily_stats timestamp
        if self.last_daily_stats:
            # Check if it's been more than a day
            if (now - self.last_daily_stats).days >= 1:
                # Check if we're past the scheduled time
                current_time_str = now.strftime("%H:%M:%S")
                if current_time_str >= self.daily_stats_time:
                    self.last_daily_stats = now
                    return True
            return False
        else:
            # First time - post if it's past the scheduled time
            current_time_str = now.strftime("%H:%M:%S")
            if current_time_str >= self.daily_stats_time:
                self.last_daily_stats = now
                return True
            return False
    
    def _generate_daily_stats(self, metrics):
        """Generate daily stats notification."""
        try:
            if not metrics:
                return None
                
            # Format hashrate with appropriate unit
            hashrate_24hr = metrics.get("hashrate_24hr", 0)
            hashrate_unit = metrics.get("hashrate_24hr_unit", "TH/s")
            
            # Format daily earnings
            daily_mined_sats = metrics.get("daily_mined_sats", 0)
            daily_profit_usd = metrics.get("daily_profit_usd", 0)
            
            # Build message
            message = f"Daily Mining Summary: {hashrate_24hr} {hashrate_unit} average hashrate, {daily_mined_sats} sats mined (${daily_profit_usd:.2f})"
            
            # Add notification
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
    
    def _check_blocks_found(self, current, previous):
        """Check if new blocks were found by the pool."""
        current_blocks = current.get("blocks_found", "0")
        previous_blocks = previous.get("blocks_found", "0")
        
        try:
            return int(current_blocks) > int(previous_blocks)
        except (ValueError, TypeError):
            return False
    
    def _generate_block_notification(self, metrics):
        """Generate notification for a new block found."""
        try:
            blocks_found = metrics.get("blocks_found", "0")
            last_block_height = metrics.get("last_block_height", "Unknown")
            last_block_earnings = metrics.get("last_block_earnings", "0")
            
            message = f"New block found by the pool! Block #{last_block_height}, earnings: {last_block_earnings} sats"
            
            return self.add_notification(
                message,
                level=NotificationLevel.SUCCESS,
                category=NotificationCategory.BLOCK,
                data={
                    "blocks_found": blocks_found,
                    "block_height": last_block_height,
                    "earnings": last_block_earnings
                }
            )
        except Exception as e:
            logging.error(f"Error generating block notification: {e}")
            return None
    
    def _check_hashrate_change(self, current, previous):
        """Check for significant hashrate changes."""
        try:
            current_3hr = current.get("hashrate_3hr", 0)
            previous_3hr = previous.get("hashrate_3hr", 0)
            
            # Skip if values are missing
            if not current_3hr or not previous_3hr:
                return None
                
            # Convert to float
            current_3hr = float(current_3hr)
            previous_3hr = float(previous_3hr)
            
            # Skip if previous was zero (prevents division by zero)
            if previous_3hr == 0:
                return None
                
            # Calculate percentage change
            percent_change = ((current_3hr - previous_3hr) / previous_3hr) * 100
            
            # Significant decrease (more than 15%)
            if percent_change <= -15:
                message = f"Significant hashrate drop detected: {abs(percent_change):.1f}% decrease"
                return self.add_notification(
                    message,
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_3hr,
                        "current": current_3hr,
                        "change": percent_change
                    }
                )
            
            # Significant increase (more than 15%)
            elif percent_change >= 15:
                message = f"Hashrate increase detected: {percent_change:.1f}% increase"
                return self.add_notification(
                    message,
                    level=NotificationLevel.SUCCESS,
                    category=NotificationCategory.HASHRATE,
                    data={
                        "previous": previous_3hr,
                        "current": current_3hr,
                        "change": percent_change
                    }
                )
            
            return None
        except Exception as e:
            logging.error(f"Error checking hashrate change: {e}")
            return None
    
    def _check_worker_status_change(self, current, previous):
        """Check for worker status changes."""
        try:
            current_workers = current.get("workers_hashing", 0)
            previous_workers = previous.get("workers_hashing", 0)
            
            # Skip if values are missing
            if current_workers is None or previous_workers is None:
                return None
                
            # Worker(s) went offline
            if current_workers < previous_workers:
                diff = previous_workers - current_workers
                message = f"{diff} worker{'s' if diff > 1 else ''} went offline"
                return self.add_notification(
                    message,
                    level=NotificationLevel.WARNING,
                    category=NotificationCategory.WORKER,
                    data={
                        "previous_count": previous_workers,
                        "current_count": current_workers,
                        "difference": diff
                    }
                )
            
            # Worker(s) came online
            elif current_workers > previous_workers:
                diff = current_workers - previous_workers
                message = f"{diff} new worker{'s' if diff > 1 else ''} came online"
                return self.add_notification(
                    message,
                    level=NotificationLevel.SUCCESS,
                    category=NotificationCategory.WORKER,
                    data={
                        "previous_count": previous_workers,
                        "current_count": current_workers,
                        "difference": diff
                    }
                )
            
            return None
        except Exception as e:
            logging.error(f"Error checking worker status change: {e}")
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
                        message = f"Payout approaching! Estimated within 1 day"
                        return self.add_notification(
                            message,
                            level=NotificationLevel.SUCCESS,
                            category=NotificationCategory.EARNINGS,
                            data={"days_to_payout": days}
                        )
                # If it says "next block"
                elif "next block" in est_time.lower():
                    message = f"Payout expected with next block!"
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
