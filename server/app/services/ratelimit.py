"""Tiny in-process sliding-window rate limiter.

Note: state is per-process. With a single API worker (the default here) this is
sufficient; a multi-worker / multi-instance deployment should move this to Redis.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

_buckets: dict[str, deque[float]] = defaultdict(deque)


def allow(key: str, limit: int, window_seconds: float) -> bool:
    """Return True if an event under `key` is allowed within the window, else False."""
    now = time.monotonic()
    bucket = _buckets[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    return True
