import pytest

from .conftest import auth_headers, register_and_login

pytestmark = pytest.mark.asyncio


def _invoice_payload(status="draft", unit_price=50.0, tax_rate=0):
    return {
        "client_name": "Acme Co",
        "issue_date": "2026-08-01",
        "due_date": "2026-08-15",
        "tax_rate": tax_rate,
        "status": status,
        "items": [{"description": "Consulting", "quantity": 2, "unit_price": unit_price}],
    }


async def test_creating_a_draft_invoice_does_not_create_a_transaction(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json=_invoice_payload(status="draft"), headers=headers)
    assert r.status_code == 200, r.text

    r = await client.get("/api/transactions", headers=headers)
    assert r.json() == []


async def test_marking_invoice_paid_creates_linked_income_transaction(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json=_invoice_payload(status="paid", unit_price=50.0), headers=headers)
    assert r.status_code == 200, r.text
    invoice = r.json()
    assert invoice["total"] == 100.0

    r = await client.get("/api/transactions", headers=headers)
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["invoice_id"] == invoice["id"]
    assert txs[0]["type"] == "income"
    assert txs[0]["amount"] == 100.0


async def test_editing_a_paid_invoice_updates_the_linked_transaction_amount_not_a_new_one(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json=_invoice_payload(status="paid", unit_price=50.0), headers=headers)
    invoice = r.json()

    r = await client.put(
        f"/api/invoices/{invoice['id']}",
        json=_invoice_payload(status="paid", unit_price=75.0),
        headers=headers,
    )
    assert r.status_code == 200, r.text
    updated = r.json()
    assert updated["total"] == 150.0

    r = await client.get("/api/transactions", headers=headers)
    txs = r.json()
    assert len(txs) == 1
    assert txs[0]["amount"] == 150.0


async def test_unmarking_paid_removes_the_linked_transaction(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json=_invoice_payload(status="paid"), headers=headers)
    invoice = r.json()

    r = await client.get("/api/transactions", headers=headers)
    assert len(r.json()) == 1

    r = await client.put(
        f"/api/invoices/{invoice['id']}",
        json=_invoice_payload(status="sent"),
        headers=headers,
    )
    assert r.status_code == 200, r.text

    r = await client.get("/api/transactions", headers=headers)
    assert r.json() == []


async def test_deleting_a_paid_invoice_removes_its_linked_transaction(client):
    token, _ = await register_and_login(client)
    headers = auth_headers(token)

    r = await client.post("/api/invoices", json=_invoice_payload(status="paid"), headers=headers)
    invoice = r.json()

    r = await client.delete(f"/api/invoices/{invoice['id']}", headers=headers)
    assert r.status_code == 200, r.text

    r = await client.get("/api/transactions", headers=headers)
    assert r.json() == []
