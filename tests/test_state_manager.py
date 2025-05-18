import json
import gzip
from state_manager import StateManager

class DummyRedis:
    def __init__(self):
        self.storage = {}
    def set(self, key, value):
        self.storage[key] = value
    def get(self, key):
        return self.storage.get(key)
    def ping(self):
        pass

def test_save_and_load_graph_state_gzip():
    mgr = StateManager()
    mgr.redis_client = DummyRedis()
    mgr.arrow_history = {"hashrate_60sec": [{"time": "00:00:01", "value": 1, "arrow": "", "unit": "th/s"}]}
    mgr.hashrate_history = [1]
    mgr.metrics_log = [{"timestamp": "t", "metrics": {"hashrate_60sec": 1, "hashrate_60sec_unit": "th/s"}}]

    mgr.save_graph_state()
    raw = mgr.redis_client.get(mgr.STATE_KEY)
    assert isinstance(raw, (bytes, bytearray))
    data = json.loads(gzip.decompress(raw).decode("utf-8"))
    assert "arrow_history" in data

    new_mgr = StateManager()
    new_mgr.redis_client = mgr.redis_client
    new_mgr.load_graph_state()
    assert new_mgr.arrow_history == mgr.arrow_history
    assert new_mgr.metrics_log[0]["metrics"]["hashrate_60sec"] == 1
