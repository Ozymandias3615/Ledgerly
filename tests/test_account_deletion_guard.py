import pytest

from .conftest import auth_headers, register_and_login

pytestmark = pytest.mark.asyncio

OWNER_PASSWORD = "owner-password-123"
STAFF_PASSWORD = "staff-password-123"


async def _make_owner_with_staff(client):
    owner_token, owner = await register_and_login(client, email="owner@example.com", password=OWNER_PASSWORD)
    owner_headers = auth_headers(owner_token)

    r = await client.post("/api/invites", json={"role": "staff"}, headers=owner_headers)
    assert r.status_code == 200, r.text
    invite_code = r.json()["code"]

    staff_token, staff = await register_and_login(
        client, email="staff@example.com", password=STAFF_PASSWORD, invite_code=invite_code,
    )
    return owner_token, owner, staff_token, staff


async def test_owner_cannot_delete_account_while_other_members_remain(client):
    owner_token, owner, staff_token, staff = await _make_owner_with_staff(client)
    owner_headers = auth_headers(owner_token)

    r = await client.request(
        "DELETE", "/api/account", json={"password": OWNER_PASSWORD}, headers=owner_headers,
    )
    assert r.status_code == 409
    assert "other members" in r.json()["detail"]

    # Owner and business must still exist afterward.
    r = await client.get("/api/auth/me", headers=owner_headers)
    assert r.status_code == 200


async def test_staff_member_can_delete_own_account_and_business_survives(client):
    owner_token, owner, staff_token, staff = await _make_owner_with_staff(client)
    owner_headers = auth_headers(owner_token)
    staff_headers = auth_headers(staff_token)

    r = await client.request(
        "DELETE", "/api/account", json={"password": STAFF_PASSWORD}, headers=staff_headers,
    )
    assert r.status_code == 200, r.text

    # Staff account is gone.
    r = await client.get("/api/auth/me", headers=staff_headers)
    assert r.status_code == 401

    # Owner and business are untouched.
    r = await client.get("/api/auth/me", headers=owner_headers)
    assert r.status_code == 200
    r = await client.get("/api/memberships", headers=owner_headers)
    assert len(r.json()) == 1


async def test_sole_owner_can_delete_account_and_business_is_wiped(client):
    token, _ = await register_and_login(client, email="solo@example.com", password="solo-password-123")
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json={
        "client_name": "Acme Co", "issue_date": "2026-08-01", "due_date": "2026-08-15",
        "items": [{"description": "Work", "quantity": 1, "unit_price": 10.0}],
    }, headers=headers)
    assert r.status_code == 200, r.text

    r = await client.request(
        "DELETE", "/api/account", json={"password": "solo-password-123"}, headers=headers,
    )
    assert r.status_code == 200, r.text

    r = await client.get("/api/auth/me", headers=headers)
    assert r.status_code == 401


async def test_owner_deletion_blocked_with_wrong_password(client):
    token, _ = await register_and_login(client, email="pwtest@example.com", password="correct-password-123")
    headers = auth_headers(token)

    r = await client.request(
        "DELETE", "/api/account", json={"password": "wrong-password"}, headers=headers,
    )
    assert r.status_code == 401

    r = await client.get("/api/auth/me", headers=headers)
    assert r.status_code == 200
