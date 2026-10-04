from datetime import timedelta

import pytest

import server as app_module

from .conftest import auth_headers, register_and_login

pytestmark = pytest.mark.asyncio


async def _make_admin(client, monkeypatch):
    monkeypatch.setattr(app_module, "ADMIN_EMAILS", {"admin@example.com"})
    token, _ = await register_and_login(client, email="admin@example.com")
    return auth_headers(token)


async def _start_thread(client):
    token, _ = await register_and_login(client, email="user@example.com")
    headers = auth_headers(token)
    r = await client.post("/api/support/threads", json={"body": "Hi, my budget looks wrong"}, headers=headers)
    assert r.status_code == 200, r.text
    return headers, r.json()["thread"]["thread_id"], r.json()["messages"][0]["created_at"]


async def test_after_returns_only_newer_messages(client):
    headers, thread_id, first_at = await _start_thread(client)
    await client.post(f"/api/support/threads/{thread_id}/messages", json={"body": "Second"}, headers=headers)

    r = await client.get(f"/api/support/threads/{thread_id}/messages", headers=headers)
    assert [m["body"] for m in r.json()["messages"]] == ["Hi, my budget looks wrong", "Second"]

    r = await client.get(f"/api/support/threads/{thread_id}/messages", params={"after": first_at}, headers=headers)
    assert [m["body"] for m in r.json()["messages"]] == ["Second"]


async def test_typing_shows_to_the_other_side_and_clears_on_send(client):
    user_headers, thread_id, _ = await _start_thread(client)

    r = await client.get(f"/api/support/threads/{thread_id}/messages", headers=user_headers)
    assert r.json()["thread"]["admin_typing"] is False
    assert "user_typing_at" not in r.json()["thread"]

    r = await client.post(f"/api/support/threads/{thread_id}/typing", headers=user_headers)
    assert r.status_code == 200
    thread = await app_module.db.support_threads.find_one({"thread_id": thread_id})
    assert app_module._is_typing(thread["user_typing_at"])

    # Sending a message ends the typing state right away.
    await client.post(f"/api/support/threads/{thread_id}/messages", json={"body": "Done typing"}, headers=user_headers)
    thread = await app_module.db.support_threads.find_one({"thread_id": thread_id})
    assert not app_module._is_typing(thread["user_typing_at"])


async def test_typing_expires(client):
    stale = (app_module.now_utc() - timedelta(seconds=app_module.SUPPORT_TYPING_TTL_SECONDS + 1)).isoformat()
    fresh = app_module.now_utc().isoformat()
    assert not app_module._is_typing(stale)
    assert app_module._is_typing(fresh)
    assert not app_module._is_typing(None)


async def test_typing_is_scoped_to_the_thread_owner(client):
    _, thread_id, _ = await _start_thread(client)
    other_token, _ = await register_and_login(client, email="other@example.com")
    r = await client.post(f"/api/support/threads/{thread_id}/typing", headers=auth_headers(other_token))
    assert r.status_code == 404


async def test_admin_and_user_see_each_other_typing(client, monkeypatch):
    user_headers, thread_id, first_at = await _start_thread(client)
    admin_headers = await _make_admin(client, monkeypatch)

    await client.post(f"/api/support/threads/{thread_id}/typing", headers=user_headers)
    r = await client.get(f"/api/admin/support/threads/{thread_id}/messages", params={"after": first_at}, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["thread"]["user_typing"] is True
    assert r.json()["messages"] == []

    r = await client.post(f"/api/admin/support/threads/{thread_id}/typing", headers=admin_headers)
    assert r.status_code == 200
    r = await client.get(f"/api/support/threads/{thread_id}/messages", headers=user_headers)
    assert r.json()["thread"]["admin_typing"] is True

    await client.post(f"/api/admin/support/threads/{thread_id}/messages", json={"body": "On it"}, headers=admin_headers)
    r = await client.get(f"/api/support/threads/{thread_id}/messages", headers=user_headers)
    assert r.json()["thread"]["admin_typing"] is False

    # Non-admins can't fake the admin's typing state.
    r = await client.post(f"/api/admin/support/threads/{thread_id}/typing", headers=user_headers)
    assert r.status_code == 403
