import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# server.py reads these once at import time (JWT_SECRET/MONGO_URL are
# required, no default). Locally they'd come from backend/.env, but that
# file is gitignored and won't exist in CI - set fallbacks so the suite
# never depends on it. MONGO_URL is never actually dialed: _fresh_db below
# swaps the real client out for an in-memory mock before any request runs.
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production-use-only")
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "ledgerly_test")
# Never let the test suite talk to the real Sentry project - must be set
# before `import server`, which reads it once at module load time.
os.environ["SENTRY_DSN"] = ""

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

import server as app_module


@pytest_asyncio.fixture(autouse=True)
async def _fresh_db():
    """Every test gets its own empty in-memory Mongo - real MongoDB is never
    touched, and tests can't see each other's data."""
    app_module.db = AsyncMongoMockClient()["ledgerly_test"]
    await app_module.app.router.startup()
    yield


@pytest_asyncio.fixture
async def client():
    transport = ASGITransport(app=app_module.app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def register_and_login(client, email="owner@example.com", password="password123",
                              name="Owner", business_name="Test Biz", invite_code=None):
    """Registers a user (optionally redeeming an invite to join an existing
    business) then logs in to get a Bearer token - login's response body is
    what the mobile PWA uses instead of the httpOnly cookie, and it's what
    lets tests avoid dealing with a cookie jar entirely."""
    payload = {"email": email, "password": password, "name": name}
    if invite_code:
        payload["invite_code"] = invite_code
    else:
        payload["business_name"] = business_name
    r = await client.post("/api/auth/register", json=payload)
    assert r.status_code == 200, r.text

    r = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()
    return data["token"], data


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}
