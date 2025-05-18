from unittest.mock import MagicMock

from worker_service import WorkerService
from data_service import MiningDashboardService
from notification_service import NotificationService


def test_generate_default_workers_data(monkeypatch):
    monkeypatch.setattr('worker_service.get_timezone', lambda: 'UTC')
    svc = WorkerService()
    data = svc.generate_default_workers_data()
    assert data['workers_total'] == 0
    assert data['hashrate_unit'] == 'TH/s'
    assert data['workers'] == []


def test_fetch_url_success(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    resp = MagicMock()
    monkeypatch.setattr(svc.session, 'get', lambda url, timeout=5: resp)
    assert svc.fetch_url('http://x') is resp


def test_fetch_url_error(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    def fail(url, timeout=5):
        raise Exception('fail')
    monkeypatch.setattr(svc.session, 'get', fail)
    assert svc.fetch_url('http://x') is None


def test_notification_update_currency(monkeypatch):
    class DummyState:
        def get_notifications(self):
            return []
        def save_notifications(self, n):
            self.saved = n
            return True
    state = DummyState()
    svc = NotificationService(state)
    svc.notifications = [{
        'id': '1',
        'timestamp': '2023-01-01T00:00:00',
        'message': 'profit ($10.00)',
        'level': 'info',
        'category': 'hashrate',
        'data': {'daily_profit': 10.0, 'currency': 'USD'}
    }]
    monkeypatch.setattr('notification_service.get_exchange_rates', lambda: {'EUR': 0.5, 'USD':1})
    updated = svc.update_notification_currency('EUR')
    assert updated == 1
    notif = svc.notifications[0]
    assert notif['data']['currency'] == 'EUR'
    assert abs(notif['data']['daily_profit'] - 5.0) < 1e-6

