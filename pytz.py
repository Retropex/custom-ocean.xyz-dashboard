"""A lightweight subset of the ``pytz`` API used for tests.
This module provides a minimal ``timezone`` function and ``utc`` object so
imports from third-party libraries such as APScheduler succeed even when the
real ``pytz`` package is not installed.
"""
from zoneinfo import ZoneInfo
from datetime import tzinfo

class _ZoneInfo(tzinfo):
    """Simple wrapper around :class:`zoneinfo.ZoneInfo` that also provides
    a ``localize`` method similar to ``pytz`` timezones."""
    def __init__(self, name: str):
        self._zone = ZoneInfo(key=name)
        self.zone = name

    def utcoffset(self, dt):
        return self._zone.utcoffset(dt)

    def dst(self, dt):
        return self._zone.dst(dt)

    def tzname(self, dt):
        return self._zone.tzname(dt)

    def localize(self, dt):
        return dt.replace(tzinfo=self)

    def __repr__(self):
        return f"<SimpleTZ {self.zone}>"


def timezone(name: str) -> tzinfo:
    """Return a timezone object for ``name``."""
    return _ZoneInfo(name)

utc = timezone("UTC")

__all__ = ["timezone", "utc"]
