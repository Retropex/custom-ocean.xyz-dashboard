import importlib
from types import SimpleNamespace
import sys
import types

if 'pytest' not in sys.modules:
    pytest = types.ModuleType('pytest')
    def fixture(func=None, **kwargs):
        if func is None:
            return lambda f: f
        return func
    pytest.fixture = fixture
    sys.modules['pytest'] = pytest
else:
    import pytest

@pytest.fixture
def client(monkeypatch):
    # Prevent scheduler from starting
    import apscheduler.schedulers.background as bg
    monkeypatch.setattr(bg.BackgroundScheduler, "start", lambda self: None)

    App = importlib.reload(importlib.import_module("App"))

    # Patch functions that interact with external systems
    monkeypatch.setattr(App, "update_metrics_job", lambda force=False: None)
    monkeypatch.setattr(App, "MiningDashboardService", lambda *a, **k: object())
    monkeypatch.setattr(App.worker_service, "set_dashboard_service", lambda *a, **k: None)

    sample_cfg = {"wallet": "w"}
    monkeypatch.setattr(App, "load_config", lambda: sample_cfg)
    monkeypatch.setattr(App, "save_config", lambda cfg: True)

    return App.app.test_client()

def test_health_endpoint(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "status" in data


def test_get_config_endpoint(client):
    resp = client.get("/api/config")
    assert resp.status_code == 200
    assert resp.get_json()["wallet"] == "w"


def test_update_config_endpoint(client):
    resp = client.post("/api/config", json={"wallet": "abc"})
    data = resp.get_json()
    assert resp.status_code == 200
    assert data["status"] == "success"


def test_payout_history_endpoint(client):
    resp = client.get("/api/payout-history")
    assert resp.status_code == 200
    assert resp.get_json()["payout_history"] == []

    record = {"timestamp": "2023-01-01T00:00:00Z", "amountBTC": "0.1"}
    resp = client.post("/api/payout-history", json={"record": record})
    assert resp.status_code == 200
    assert resp.get_json()["status"] == "success"

    resp = client.get("/api/payout-history")
    data = resp.get_json()
    assert len(data["payout_history"]) == 1
    assert data["payout_history"][0]["amountBTC"] == "0.1"

    resp = client.delete("/api/payout-history")
    assert resp.status_code == 200
    resp = client.get("/api/payout-history")
    assert resp.get_json()["payout_history"] == []


def test_block_events_endpoint(client):
    resp = client.get("/api/block-events")
    assert resp.status_code == 200
    data = resp.get_json()
    assert "events" in data

