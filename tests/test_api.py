import importlib
import sys
from types import SimpleNamespace
from pathlib import Path
import pytest

@pytest.fixture
def client(monkeypatch):
    # Provide a lightweight pytz substitute if the real package is unavailable
    try:
        import pytz  # noqa: F401
    except ImportError:
        spec = importlib.util.spec_from_file_location(
            "pytz", Path(__file__).resolve().parents[1] / "pytz.py"
        )
        pytz_stub = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(pytz_stub)
        sys.modules["pytz"] = pytz_stub

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

