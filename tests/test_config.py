import json
import importlib
import types
from pathlib import Path
import config as config_module

def test_load_config_defaults(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    cfg = importlib.reload(config_module).load_config()
    assert cfg["currency"] == "USD"
    assert "EXCHANGE_RATE_API_KEY" in cfg


def test_load_config_file(tmp_path, monkeypatch):
    temp_file = tmp_path / "cfg.json"
    with open(temp_file, "w") as fh:
        json.dump({"currency": "EUR"}, fh)
    monkeypatch.setattr(config_module, "CONFIG_FILE", str(temp_file))
    cfg = importlib.reload(config_module).load_config()
    assert cfg["currency"] == "EUR"
    assert "network_fee" in cfg
    assert "EXCHANGE_RATE_API_KEY" in cfg
