# Common tasks. `make help` lists them.
PY ?= .venv/bin/python
PORT ?= 8000

.PHONY: help install dev run https demo seed test lint format screenshots clean web web-dev

help:            ## show this help
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'

install:         ## create .venv and install app + dev dependencies
	python3 -m venv .venv && $(PY) -m pip install -U pip && $(PY) -m pip install -r requirements-dev.txt
	@test -f .env || (cp .env.example .env && echo "Created .env — add your GROQ_API_KEY (and SARVAM_API_KEY)")

dev:             ## run with auto-reload on http://localhost:$(PORT)
	$(PY) -m uvicorn app.main:app --reload --port $(PORT)

run:             ## run on your network (http) — the phone microphone needs `make https`
	$(PY) -m uvicorn app.main:app --host 0.0.0.0 --port $(PORT)

https:           ## run over HTTPS on your Wi-Fi so phones allow the microphone
	scripts/https.sh

demo:            ## run with a scripted companion (no Groq key or quota needed)
	$(PY) scripts/run_demo.py

seed:            ## fill a separate demo database with 90 days of history (DB_PATH=data/demo.db)
	DB_PATH=$${DB_PATH:-data/demo.db} $(PY) -m app.seed

test:            ## run the test suite (needs a local Redis)
	$(PY) -m pytest

lint:            ## static checks
	$(PY) -m ruff check app tests scripts

format:          ## auto-fix what ruff can
	$(PY) -m ruff check --fix app tests scripts

screenshots:     ## regenerate docs/screenshots (seeds a throw-away demo café)
	$(PY) scripts/take_screenshots.py

web:             ## build the Deccan House website (served at / by the app)
	cd frontend && npm install && npm run build

web-dev:         ## website with hot reload on :3000 (API from `make dev` on :8000)
	cd frontend && NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev

clean:           ## remove caches
	find . -name __pycache__ -prune -exec rm -rf {} + ; rm -rf .pytest_cache .ruff_cache
