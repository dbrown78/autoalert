"""
core/config.py
Writer configuration. Loaded from environment variables with sensible defaults.
"""

from __future__ import annotations
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class WriterConfig:
    batch_size: int        # Rows per execute_values call
    max_retries: int       # Retry attempts on OperationalError
    log_level: str         # DEBUG | INFO | WARNING
    pool_min: int          # Min connections in pool
    pool_max: int          # Max connections in pool

    @classmethod
    def from_env(cls) -> "WriterConfig":
        return cls(
            batch_size=int(os.getenv("WRITER_BATCH_SIZE", "5000")),
            max_retries=int(os.getenv("WRITER_MAX_RETRIES", "3")),
            log_level=os.getenv("WRITER_LOG_LEVEL", "INFO"),
            pool_min=int(os.getenv("WRITER_POOL_MIN", "2")),
            pool_max=int(os.getenv("WRITER_POOL_MAX", "10")),
        )

    @classmethod
    def default(cls) -> "WriterConfig":
        return cls(
            batch_size=5000,
            max_retries=3,
            log_level="INFO",
            pool_min=2,
            pool_max=10,
        )

    @classmethod
    def fast(cls) -> "WriterConfig":
        """Aggressive settings for bulk bootstrap. Higher batch size, fewer retries."""
        return cls(
            batch_size=10_000,
            max_retries=2,
            log_level="WARNING",
            pool_min=2,
            pool_max=10,
        )
