from unittest.mock import MagicMock

from worker_service import WorkerService
from data_service import MiningDashboardService
from notification_service import NotificationService
import data_service


def test_generate_default_workers_data(monkeypatch):
    monkeypatch.setattr('worker_service.get_timezone', lambda: 'UTC')
    svc = WorkerService()
    data = svc.generate_default_workers_data()
    assert data['workers_total'] == 0
    assert data['hashrate_unit'] == 'TH/s'
    assert data['workers'] == []


import pytest


@pytest.mark.asyncio
async def test_fetch_url_success(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    resp = MagicMock()
    async def fake_get(url, timeout=5):
        return resp
    monkeypatch.setattr(svc.async_client, 'get', fake_get)
    result = await svc.fetch_url('http://x')
    assert result is resp


@pytest.mark.asyncio
async def test_fetch_url_error(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')
    async def fail(url, timeout=5):
        raise Exception('fail')
    monkeypatch.setattr(svc.async_client, 'get', fail)
    result = await svc.fetch_url('http://x')
    assert result is None


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


@pytest.mark.asyncio
async def test_exchange_rate_caching(monkeypatch):
    svc = MiningDashboardService(0, 0, 'w')

    fake_time = [0]
    monkeypatch.setattr(data_service.time, 'time', lambda: fake_time[0])

    call_count = {'count': 0}

    async def fake_get(url, timeout=5):
        call_count['count'] += 1
        resp = MagicMock()
        resp.ok = True
        resp.json.return_value = {
            'result': 'success',
            'conversion_rates': {'EUR': 0.5, 'USD': 1}
        }
        return resp

    monkeypatch.setattr(svc.async_client, 'get', fake_get)

    rates1 = await svc.fetch_exchange_rates()
    assert rates1['EUR'] == 0.5
    assert call_count['count'] == 1

    fake_time[0] += 1000  # within TTL
    rates2 = await svc.fetch_exchange_rates()
    assert rates2 == rates1
    assert call_count['count'] == 1

    fake_time[0] += svc.exchange_rate_ttl + 1  # expire cache
    rates3 = await svc.fetch_exchange_rates()
    assert rates3 == rates1
    assert call_count['count'] == 2

