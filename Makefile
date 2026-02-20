# SwingFactr Makefile
# Usage: make <target>

.PHONY: help setup schema etl-train etl-live train api app test reproduce docker-up docker-down clean

# Default
help:
	@echo ""
	@echo "SwingFactr commands:"
	@echo ""
	@echo "  Setup:"
	@echo "    make setup          Install Python deps"
	@echo "    make schema         Apply DB schema (requires PGURI in .env)"
	@echo ""
	@echo "  Data:"
	@echo "    make etl-train      Load 5 training seasons (2020-21 to 2024-25)"
	@echo "    make etl-dev        Load 10 games per season (fast dev test)"
	@echo "    make etl-live       Fetch yesterday's 2025-26 games (run daily)"
	@echo ""
	@echo "  Models:"
	@echo "    make train          Train all models on historical data"
	@echo "    make train-quick    Train on 2024-25 only (5 min)"
	@echo "    make score-live     Score current season games with trained model"
	@echo ""
	@echo "  Run:"
	@echo "    make api            Start FastAPI (port 8000)"
	@echo "    make app            Start Next.js (port 3000)"
	@echo "    make test           Run unit tests"
	@echo ""
	@echo "  Docker:"
	@echo "    make docker-up      Start everything in Docker"
	@echo "    make docker-down    Stop Docker services"
	@echo ""

setup:
	pip install -r requirements.txt

schema:
	psql $$DATABASE_URL < sql/schema.sql

# Load all 5 training seasons (run once to bootstrap — takes ~2 hours for all PBP)
etl-train:
	python -m src.etl.run_pipeline --mode train

# Fast dev: 10 games per season (~5 minutes total)
etl-dev:
	python -m src.etl.run_pipeline --mode train --limit 10

# Daily cron: fetch yesterday's 2025-26 games
etl-live:
	python -m src.etl.run_pipeline --mode live

# Train all models on historical data
train:
	python -m src.models.train_all

# Train on 2024-25 only (faster, still good)
train-quick:
	python -m src.models.train_all --quick

# Score current season after training
score-live:
	python -m src.models.train_all --quick --score-live

# Full pipeline: train + score current season
reproduce:
	make etl-dev
	make train
	make score-live

api:
	uvicorn src.api.main:app --reload --port 8000

app:
	cd src/app && npm run dev

test:
	pytest tests/ -v

docker-up:
	docker compose up --build

docker-down:
	docker compose down

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
