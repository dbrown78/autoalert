"""
core/connection.py

PostgreSQL connection pool with retry logic.
Uses psycopg2.pool.ThreadedConnectionPool for future parallelism.

The pool is a module-level singleton — initialized once on first use,
reused across all writer calls in the same process.

Retry policy:
  - Retries on psycopg2.OperationalError (connection reset, timeout)
  - Exponential backoff: 1s, 2s, 4s between retries
  - MAX_RETRIES from WriterConfig (default 3)
  - Raises after max retries exceeded
"""

from __future__ import annotations
import os
import time
import logging
import functools
from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.pool
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger(__name__)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def _get_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        raise EnvironmentError(
            "DATABASE_URL not set.\n"
            "Add it to odin-writer/.env:\n"
            "  DATABASE_URL=postgresql://user:pass@host:5432/autoalert"
        )
    return url


def init_pool(minconn: int = 2, maxconn: int = 10) -> None:
    """Initialize the connection pool. Called once at process start."""
    global _pool
    if _pool is not None:
        return
    url = _get_database_url()
    _pool = psycopg2.pool.ThreadedConnectionPool(minconn, maxconn, url)
    log.info(f"Connection pool initialized (min={minconn}, max={maxconn})")


def close_pool() -> None:
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None
        log.info("Connection pool closed")


@contextmanager
def get_conn() -> Generator:
    """
    Context manager that borrows a connection from the pool,
    commits on success, rolls back on exception, returns to pool on exit.
    """
    global _pool
    if _pool is None:
        init_pool()

    conn = _pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


def with_retry(max_retries: int = 3, backoff_base: float = 1.0):
    """
    Decorator that retries a function on psycopg2.OperationalError.
    Uses exponential backoff between retries.
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            last_err = None
            for attempt in range(max_retries + 1):
                try:
                    return fn(*args, **kwargs)
                except psycopg2.OperationalError as e:
                    last_err = e
                    if attempt < max_retries:
                        wait = backoff_base * (2 ** attempt)
                        log.warning(
                            f"{fn.__name__} failed (attempt {attempt+1}/{max_retries}): {e}. "
                            f"Retrying in {wait:.1f}s..."
                        )
                        # Reinitialize pool on connection failure
                        close_pool()
                        time.sleep(wait)
                        init_pool()
                    else:
                        log.error(f"{fn.__name__} failed after {max_retries} retries: {e}")
                        raise last_err
        return wrapper
    return decorator


def ping() -> bool:
    """Test the database connection. Returns True if healthy."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return True
    except Exception as e:
        log.error(f"DB ping failed: {e}")
        return False
