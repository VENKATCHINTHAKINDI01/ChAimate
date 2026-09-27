import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Brain: LiteLLM gateway in front of open models (Groq by default). Names use LiteLLM's provider/model format.
LLM_MODEL = os.getenv("LLM_MODEL", "groq/openai/gpt-oss-120b")
LLM_REASONING_EFFORT = os.getenv("LLM_REASONING_EFFORT", "low")
# Tried instantly when the main model is rate-limited or down; also runs background chat summaries.
LLM_FALLBACK_MODEL = os.getenv("LLM_FALLBACK_MODEL", "groq/openai/gpt-oss-20b")
# Optional third option on a different provider, e.g. openrouter/openai/gpt-oss-120b (+ OPENROUTER_API_KEY)
LLM_BACKUP_MODEL = os.getenv("LLM_BACKUP_MODEL", "")
LLM_COOLDOWN_SECONDS = float(os.getenv("LLM_COOLDOWN_SECONDS", "30"))
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "20"))

# Usage metering & billing (Redis)
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
AI_FREE_MINUTES = int(os.getenv("AI_FREE_MINUTES", "10"))
AI_PRICE_PER_MINUTE = float(os.getenv("AI_PRICE_PER_MINUTE", "2"))
# Show short chat snippets in the manager's live monitor (off = metadata only, better for privacy)
MONITOR_CHAT_TEXT = os.getenv("MONITOR_CHAT_TEXT", "false").lower() in ("1", "true", "yes")

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "").strip()
SARVAM_STT_MODEL = os.getenv("SARVAM_STT_MODEL", "saaras:v3")
SARVAM_TTS_MODEL = os.getenv("SARVAM_TTS_MODEL", "bulbul:v3")

CAFE_NAME = os.getenv("CAFE_NAME", "Deccan House")
# The AI companion's name. COMPANION_NAME is how it's shown (styled); the spoken form is plain, so text-to-speech
# says "chai-mate" instead of spelling out a capital letter.
COMPANION_NAME = os.getenv("COMPANION_NAME", "ChAimate").strip() or "ChAimate"
COMPANION_SPOKEN = COMPANION_NAME[:1].upper() + COMPANION_NAME[1:].lower()
CAFE_CITY = os.getenv("CAFE_CITY", "Hyderabad")
CURRENCY = os.getenv("CURRENCY", "₹")
STAFF_PIN = os.getenv("STAFF_PIN", "1234")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")

# Project layout
BASE_DIR = Path(__file__).resolve().parents[2]          # the repository root
WEB_DIR = BASE_DIR / "web"
TEMPLATES_DIR = WEB_DIR / "templates"                    # table.html, staff.html
STATIC_DIR = WEB_DIR / "static"                          # served at /static
FRONTEND_DIST = BASE_DIR / "frontend" / "out"           # the Deccan House website (next build)
DATA_DIR = BASE_DIR / "data"                             # local SQLite database (git-ignored)

DB_PATH = os.getenv("DB_PATH", str(DATA_DIR / "cafe.db"))
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)   # e.g. data/ on a fresh clone

# Supabase / PostgreSQL. When DATABASE_URL is set the app uses Postgres instead of the local SQLite file.
# Use the *Session pooler* connection string from Supabase (Connect → Session pooler, port 5432) — it works on
# IPv4 networks and keeps per-connection settings. Tables live in their own schema, hidden from Supabase's public API.
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_SCHEMA = os.getenv("DB_SCHEMA", "cafe")
# Optional: live change feed from Supabase Realtime (Project Settings → API). The service key is a secret —
# keep it in .env only, never in the browser.
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
