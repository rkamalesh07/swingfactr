"""Seed a minimal demo dataset (5 games) for quick testing without full ETL."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.etl.db import init_pool, execute_sql_file
from src.etl.run_pipeline import run_pipeline

if __name__ == "__main__":
    print("Seeding demo dataset (5 games)...")
    init_pool()
    execute_sql_file("sql/schema.sql")
    run_pipeline(season="2023-24", limit=5)
    print("Demo seed complete. Run: python -m src.models.train_all --season 2023-24")
