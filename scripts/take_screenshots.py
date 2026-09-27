"""Regenerate the README screenshots in docs/screenshots/.

Seeds a throw-away demo café (90 days of history + a few live orders), starts it with the scripted companion
(scripts/run_demo.py — no API quota used) and captures the customer and staff apps with Playwright.

    pip install -r requirements-dev.txt && playwright install chromium
    python scripts/take_screenshots.py
"""
import asyncio
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots")
PORT = 8790
BASE = f"http://127.0.0.1:{PORT}"
TMP = tempfile.mkdtemp(prefix="cafe-shots-")
ENV = {**os.environ, "DB_PATH": os.path.join(TMP, "demo.db"), "DATABASE_URL": "", "SUPABASE_URL": "", "LOG_DIR": "",
       "REDIS_URL": "redis://localhost:6379/14", "PORT": str(PORT), "PYTHONPATH": ROOT}


def seed() -> None:
    subprocess.run([sys.executable, "-m", "app.seed", "--days", "90"], cwd=ROOT, env=ENV, check=True,
                   stdout=subprocess.DEVNULL)
    live_orders = """
from app.core import db
menu = {m['name']: m['id'] for m in db.list_menu()}
tickets = [(2, 'Ananya', [('Masala Chai', 2), ('Samosa (2 pcs)', 1)]), (4, 'Ravi', [('Chicken Biryani', 1), ('Irani Chai', 1)]),
           (5, 'Meera', [('Masala Maggi', 1), ('Cold Coffee', 2)]), (7, 'Arjun', [('Vada Pav', 2), ('Filter Coffee', 1)])]
for table, name, items in tickets:
    order = db.create_order(table, name, [{'menu_item_id': menu[n], 'qty': q, 'notes': ''} for n, q in items])
    if table == 4:
        db.update_station_status(order['id'], 'kitchen', 'preparing')
"""
    subprocess.run([sys.executable, "-c", live_orders], cwd=ROOT, env=ENV, check=True)


def silent_mic() -> str:
    path = os.path.join(TMP, "silence.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(48000), w.writeframes(b"\0\0" * 48000 * 3)
    return path


async def capture() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        args = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={silent_mic()}"]
        try:
            browser = await p.chromium.launch(args=args)
        except Exception:  # noqa: BLE001 — Playwright's Chromium not downloaded: use the installed Google Chrome
            browser = await p.chromium.launch(channel="chrome", args=args)

        async def page(width, height, mobile=False):
            ctx = await browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=2 if mobile else 1,
                                            is_mobile=mobile, has_touch=mobile, permissions=["microphone"])
            return await ctx.new_page()

        async def shot(pg, name):
            await pg.screenshot(path=os.path.join(OUT, name), type="jpeg", quality=82)
            print("  ✓", name)

        # ---- Deccan House website (frontend/out, served at / when built)
        if os.path.exists(os.path.join(ROOT, "frontend", "out", "index.html")):
            async def scroll_to(pg, sel, extra=0):
                await pg.evaluate(f"""(()=>{{const el=document.querySelector("{sel}"); if(!el) return;
                  const y=el.getBoundingClientRect().top+scrollY+{extra};
                  window.__lenis ? window.__lenis.scrollTo(y,{{immediate:true}}) : scrollTo(0,y);}})()""")
                await pg.wait_for_timeout(2800)
            pg = await page(1440, 900)
            await pg.goto(f"{BASE}/")
            await pg.wait_for_timeout(8000)
            await pg.mouse.move(1000, 380)
            await pg.wait_for_timeout(1000)
            await shot(pg, "web-hero.jpg")
            for sel, name, extra in [("section[aria-labelledby=coffee-h]", "web-coffee.jpg", 0), ("#chaimate", "web-chaimate.jpg", 60),
                                     ("section[aria-labelledby=inside-h]", "web-walkthrough.jpg", 120), ("section[aria-labelledby=story-h]", "web-story.jpg", 0),
                                     ("section[aria-labelledby=rooted-h]", "web-rooted.jpg", 380), ("section[aria-labelledby=loc-h]", "web-location.jpg", 0)]:
                await scroll_to(pg, sel, extra)
                if "inside" in sel or "loc" in sel:
                    await pg.wait_for_timeout(5000)
                await shot(pg, name)
            await pg.goto(f"{BASE}/menu/")
            await pg.wait_for_timeout(3500)
            await scroll_to(pg, "[role=tablist]", -40)
            await shot(pg, "web-menu.jpg")
            await pg.goto(f"{BASE}/gallery/")
            await pg.wait_for_timeout(3500)
            await pg.click("button[aria-label^='Open photo']")
            await pg.wait_for_timeout(1500)
            await shot(pg, "web-lightbox.jpg")
            await pg.keyboard.press("Escape")
            await pg.goto(f"{BASE}/reservations/")
            await pg.wait_for_timeout(3500)
            await pg.locator("fieldset button[aria-pressed]").nth(2).click()
            await pg.locator("button:has-text('7:00 PM'), button:has-text('7:00 pm')").first.click()
            await scroll_to(pg, "ol[aria-label='Booking steps']", -120)
            await shot(pg, "web-reserve.jpg")
            await pg.click("button:has-text('Continue')")
            await pg.wait_for_timeout(900)
            await pg.click("button:has-text('Continue')")
            await pg.wait_for_timeout(900)
            await pg.fill("#r-name", "Ananya Rao")
            await pg.fill("#r-phone", "+91 98765 43210")
            await pg.fill("#r-email", "ananya@example.com")
            await pg.click("button:has-text('Reserve your table')")
            await pg.mouse.move(1430, 890)          # park the custom cursor out of the shot
            await pg.wait_for_timeout(4000)
            await shot(pg, "web-reserved.jpg")
            pg = await page(390, 844, mobile=True)
            await pg.goto(f"{BASE}/")
            await pg.wait_for_timeout(7000)
            await shot(pg, "web-mobile-hero.jpg")
            await pg.click("button[aria-label='Open menu']", force=True)
            await pg.wait_for_timeout(1600)
            await shot(pg, "web-mobile-nav.jpg")

        # ---- customer app, desktop
        pg = await page(1440, 900)
        await pg.goto(f"{BASE}/table?t=3")
        await pg.wait_for_timeout(3500)
        await shot(pg, "customer-landing.jpg")
        await pg.evaluate("window.scrollTo(0, document.querySelector('#cats').offsetTop - 70)")
        await pg.wait_for_timeout(1500)
        await shot(pg, "customer-landing-menu.jpg")
        await pg.evaluate("window.scrollTo(0, 0)")
        await pg.wait_for_timeout(500)
        await pg.click("#btnHeroStart")
        await pg.wait_for_timeout(4500)
        await pg.fill("#textInput", "add one irani chai")
        await pg.click("#btnSend")
        await pg.wait_for_timeout(2500)
        await shot(pg, "customer-call.jpg")
        await pg.click("#btnMenu")
        await pg.wait_for_timeout(1200)
        await pg.click("#menu [data-add]")
        await pg.wait_for_timeout(900)
        await shot(pg, "customer-menu.jpg")
        await pg.click("#menuOverlay [data-close]")
        await pg.wait_for_timeout(1500)
        await pg.click("#cartBar")
        await pg.wait_for_timeout(1200)
        await shot(pg, "customer-cart.jpg")

        # ---- customer app, phone
        pg = await page(390, 844, mobile=True)
        await pg.goto(f"{BASE}/table?t=6")
        await pg.wait_for_timeout(3500)
        await shot(pg, "mobile-landing.jpg")
        await pg.click("#btnHeroStart")
        await pg.wait_for_timeout(4500)
        await shot(pg, "mobile-call.jpg")
        await pg.click("#btnMenu")
        await pg.wait_for_timeout(1200)
        await pg.click("#menu [data-add]")
        await pg.wait_for_timeout(900)
        await shot(pg, "mobile-menu.jpg")

        # ---- staff app
        async def staff(username, pin, tabs, login_shot=None):
            pg = await page(1440, 900)
            await pg.goto(f"{BASE}/staff")
            await pg.wait_for_timeout(3500)
            if login_shot:
                await shot(pg, login_shot)
            await pg.fill("#username", username)
            await pg.fill("#pin", pin)
            await pg.click("#btnLogin")
            await pg.wait_for_timeout(2500)
            for tab, name in tabs:
                if tab:
                    await pg.click(f"#tabs [data-tab='{tab}']")
                    await pg.wait_for_timeout(3500)
                await shot(pg, name)

        await staff("kitchen", "1111", [(None, "staff-kitchen.jpg")], login_shot="staff-login.jpg")
        await staff("manager", "1234", [("overview", "staff-overview.jpg"), ("analytics", "staff-analytics.jpg"),
                                        ("agent", "staff-ai-manager.jpg"), ("floor", "staff-floor.jpg")])
        await browser.close()


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    print("Seeding a demo café …")
    seed()
    server = subprocess.Popen([sys.executable, os.path.join(ROOT, "scripts", "run_demo.py")], cwd=ROOT, env=ENV)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"{BASE}/api/health", timeout=1)
                break
            except OSError:
                time.sleep(0.5)
        print("Capturing screenshots …")
        asyncio.run(capture())
    finally:
        server.terminate()
        subprocess.run(["redis-cli", "-n", "14", "flushdb"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
