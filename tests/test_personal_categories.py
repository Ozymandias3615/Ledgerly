import pytest

import personal_router
import server as app_module

from .conftest import auth_headers, register_and_login

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _share_mock_db():
    # personal_router does `from server import db`, so it holds its own
    # reference - point it at the same per-test mock conftest just installed.
    personal_router.db = app_module.db


async def test_custom_category_is_listed_after_defaults(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "  Pet   care "}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Pet care"

    r = await client.get("/api/personal/categories", headers=headers)
    data = r.json()
    assert data["expense"][:len(personal_router.DEFAULT_EXPENSE_CATEGORIES)] == personal_router.DEFAULT_EXPENSE_CATEGORIES
    assert data["expense"][-1] == "Pet care"
    assert "Pet care" not in data["income"]


async def test_duplicate_and_blank_names_are_rejected(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "groceries"}, headers=headers)
    assert r.status_code == 400  # clashes with a built-in, case-insensitively

    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "Pets"}, headers=headers)
    assert r.status_code == 200
    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "PETS"}, headers=headers)
    assert r.status_code == 400

    # Same name is fine under the other type.
    r = await client.post("/api/personal/categories", json={"type": "income", "name": "Pets"}, headers=headers)
    assert r.status_code == 200

    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "   "}, headers=headers)
    assert r.status_code == 400


async def test_categories_are_per_user_and_delete_is_scoped(client):
    token_a, _ = await register_and_login(client, email="a@example.com")
    token_b, _ = await register_and_login(client, email="b@example.com")

    r = await client.post("/api/personal/categories", json={"type": "expense", "name": "Hobbies"}, headers=auth_headers(token_a))
    cat_id = r.json()["id"]

    r = await client.get("/api/personal/categories", headers=auth_headers(token_b))
    assert "Hobbies" not in r.json()["expense"]

    r = await client.delete(f"/api/personal/categories/{cat_id}", headers=auth_headers(token_b))
    assert r.status_code == 404

    r = await client.delete(f"/api/personal/categories/{cat_id}", headers=auth_headers(token_a))
    assert r.status_code == 200
    r = await client.get("/api/personal/categories", headers=auth_headers(token_a))
    assert "Hobbies" not in r.json()["expense"]


async def test_budget_spend_tracks_a_custom_category(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    await client.post("/api/personal/categories", json={"type": "expense", "name": "Pets"}, headers=headers)
    r = await client.post("/api/personal/budgets", json={"category": "Pets", "monthly_limit": 100}, headers=headers)
    assert r.status_code == 200, r.text
    r = await client.post(
        "/api/personal/transactions",
        json={"type": "expense", "amount": 30, "category": "Pets", "date": "2026-03-10"},
        headers=headers,
    )
    assert r.status_code == 200, r.text

    r = await client.get("/api/personal/budgets/summary", params={"month": "2026-03"}, headers=headers)
    [budget] = r.json()
    assert budget["category"] == "Pets"
    assert budget["spent"] == 30
