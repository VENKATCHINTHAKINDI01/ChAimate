"""Request ids, friendly error bodies, health, browser error reporting, redaction and transactions."""
import logging

from fastapi.testclient import TestClient

from app.core import db
from app.main import app
from app.services import analytics
from tests.conftest import login_staff, read_log


def test_request_id_is_echoed_or_generated(client):
    assert client.get("/api/menu", headers={"X-Request-ID": "trace-abc123"}).headers["x-request-id"] == "trace-abc123"
    assert len(client.get("/api/options").headers["x-request-id"]) == 12
    assert "[trace-abc123]" in read_log() and "GET /api/menu -> 200" in read_log()


def test_validation_error_is_friendly(client):
    r = client.post("/api/customer/auth", json={"pin": 12})
    body = r.json()
    assert r.status_code == 422 and body["code"] == "validation_error" and body["problems"] and body["request_id"]


def test_http_errors_carry_code_and_request_id(client):
    body = client.get("/api/staff/overview").json()
    assert body["code"] == "http_401" and "request_id" in body


def test_crash_becomes_clean_500_with_traceback_in_error_log(client, monkeypatch):
    manager = TestClient(app, raise_server_exceptions=False)
    manager.post("/api/staff/login", json={"username": "manager", "pin": "1234"})
    monkeypatch.setattr(analytics, "dashboard", lambda period: 1 / 0)
    r = manager.get("/api/staff/analytics")
    body = r.json()
    assert r.status_code == 500 and body["code"] == "internal_error" and "ZeroDivision" not in body["detail"]
    errors = read_log("errors.log")
    assert "ZeroDivisionError" in errors and f"[{body['request_id']}]" in errors


def test_health_reports_database(client):
    h = client.get("/api/health").json()
    assert h["status"] in ("ok", "degraded") and h["checks"]["database"] == "ok"


def test_browser_errors_are_logged_and_rate_limited(client):
    codes = {client.post("/api/client-log", json={"message": f"boom {i}", "page": "table"}).status_code for i in range(12)}
    log = read_log()
    assert codes == {204} and "boom 0" in log and "boom 11" not in log


def test_secrets_are_redacted_from_logs(client):
    logging.getLogger("test").warning("leaked gsk_ABCDEFGHIJKLMNOP123 and api-subscription-key: sk_9wry0k7l_secret")
    log = read_log()
    assert "gsk_ABCDEFGH" not in log and "sk_9wry0k7l_secret" not in log and "gsk_***" in log


def test_failed_transaction_rolls_back(client):
    try:
        with db.db() as conn:
            conn.execute("INSERT INTO promotions (title, created_at) VALUES ('should-rollback', 1)")
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    with db.db() as conn:
        assert conn.execute("SELECT COUNT(*) FROM promotions WHERE title='should-rollback'").fetchone()[0] == 0


def test_manager_login_works(client):
    assert login_staff("manager", "1234").get("/api/staff/overview").status_code == 200


def test_options_expose_the_companion_name(client):
    assert client.get("/api/options").json()["companion_name"] == "ChAimate"
