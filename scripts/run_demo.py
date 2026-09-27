"""Run the full app with a scripted companion instead of the LLM — for UI work, demos and screenshots.

No Groq key or quota needed; voice still uses Sarvam if SARVAM_API_KEY is set (the browser voice otherwise).

    python scripts/run_demo.py                     # http://localhost:8000/table?t=1
    PORT=8790 DB_PATH=/tmp/demo.db python scripts/run_demo.py
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import uvicorn  # noqa: E402

from app.agents import companion  # noqa: E402
from app.main import app  # noqa: E402

LINES = {
    "order": ["Done — ", "one Irani chai is in your cart. ", "Want an Osmania biscuit with it?"],
    "menu": ["Nice pick, ", "that one's a favourite here."],
    "default": ["Arre, good evening! ", "Chai weather, honestly. ", "What should I call you?"],
}


async def scripted_respond(self):
    last = self.history[-1]["content"].split(self.CONTEXT_MARK)[0].lower() if self.history else ""
    if "chai" in last and ("add" in last or "one" in last):
        await self.run_tool("add_to_cart", {"item": "Irani Chai", "qty": 1})
        lines = LINES["order"]
    elif "used the menu" in last:
        lines = LINES["menu"]
    else:
        lines = LINES["default"]
    for piece in lines:
        await asyncio.sleep(0.05)
        yield piece


companion.TableSession.respond = scripted_respond

if __name__ == "__main__":
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")), log_level="warning")
