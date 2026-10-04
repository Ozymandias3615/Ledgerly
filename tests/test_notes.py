import pytest

from .conftest import auth_headers, register_and_login

pytestmark = pytest.mark.asyncio


async def test_create_update_list_and_delete_a_note(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/notes", json={"body": "Call the accountant\nabout Q3", "page": "/reports"}, headers=headers)
    assert r.status_code == 200, r.text
    note = r.json()
    assert note["page"] == "/reports"
    assert "user_id" not in note

    r = await client.put(f"/api/notes/{note['id']}", json={"body": "Call the accountant\nabout Q3 and Q4"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["body"].endswith("Q4")
    assert r.json()["updated_at"] >= note["updated_at"]

    await client.post("/api/notes", json={"body": "Groceries list", "page": "/personal/budgets"}, headers=headers)

    r = await client.get("/api/notes", headers=headers)
    assert len(r.json()) == 2
    r = await client.get("/api/notes", params={"page": "/reports"}, headers=headers)
    assert [n["id"] for n in r.json()] == [note["id"]]

    r = await client.delete(f"/api/notes/{note['id']}", headers=headers)
    assert r.status_code == 200
    r = await client.get("/api/notes", headers=headers)
    assert len(r.json()) == 1


async def test_notes_are_private_to_their_owner(client):
    token_a, _ = await register_and_login(client, email="a@example.com")
    token_b, _ = await register_and_login(client, email="b@example.com")

    r = await client.post("/api/notes", json={"body": "secret", "page": "/dashboard"}, headers=auth_headers(token_a))
    note_id = r.json()["id"]

    r = await client.get("/api/notes", headers=auth_headers(token_b))
    assert r.json() == []
    r = await client.put(f"/api/notes/{note_id}", json={"body": "hijacked"}, headers=auth_headers(token_b))
    assert r.status_code == 404
    r = await client.delete(f"/api/notes/{note_id}", headers=auth_headers(token_b))
    assert r.status_code == 404

    r = await client.get("/api/notes", headers=auth_headers(token_a))
    assert r.json()[0]["body"] == "secret"


async def test_note_length_is_capped(client):
    token, _ = await register_and_login(client)
    r = await client.post("/api/notes", json={"body": "x" * 20001}, headers=auth_headers(token))
    assert r.status_code == 422
