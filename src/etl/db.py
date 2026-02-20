"""Database connection and utility functions for SwingFactr ETL."""

import os
import logging
from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

logger = logging.getLogger(__name__)

_pool: ThreadedConnectionPool | None = None

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/swingfactr"
)


def init_pool(minconn: int = 1, maxconn: int = 10) -> None:
    """Initialize the connection pool. Call once at startup."""
    global _pool
    _pool = ThreadedConnectionPool(minconn, maxconn, dsn=DATABASE_URL)
    logger.info("DB connection pool initialized")


def get_pool() -> ThreadedConnectionPool:
    if _pool is None:
        init_pool()
    return _pool  # type: ignore


@contextmanager
def get_conn() -> Generator[psycopg2.extensions.connection, None, None]:
    """Context manager that yields a connection from the pool."""
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@contextmanager
def get_cursor(dict_cursor: bool = True) -> Generator[psycopg2.extensions.cursor, None, None]:
    """Context manager that yields a cursor."""
    with get_conn() as conn:
        cur_factory = psycopg2.extras.RealDictCursor if dict_cursor else None
        with conn.cursor(cursor_factory=cur_factory) as cur:
            yield cur


def execute_sql_file(path: str) -> None:
    """Execute a .sql file against the database (e.g. schema.sql)."""
    with open(path, "r") as f:
        sql = f.read()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
    logger.info(f"Executed SQL file: {path}")


def upsert_many(table: str, rows: list[dict], conflict_cols: list[str]) -> int:
    """Generic upsert helper. Returns number of rows affected."""
    if not rows:
        return 0
    cols = list(rows[0].keys())
    col_str = ", ".join(cols)
    placeholder_str = ", ".join([f"%({c})s" for c in cols])
    conflict_str = ", ".join(conflict_cols)
    update_str = ", ".join(
        [f"{c} = EXCLUDED.{c}" for c in cols if c not in conflict_cols]
    )
    sql = (
        f"INSERT INTO {table} ({col_str}) VALUES ({placeholder_str}) "
        f"ON CONFLICT ({conflict_str}) DO UPDATE SET {update_str}"
    )
    with get_conn() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, rows, page_size=500)
    return len(rows)
