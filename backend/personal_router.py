"""Ledgerly Personal - user_id-scoped endpoints, kept out of server.py per
design/ledgerly-personal.md. No business_id anywhere in this file - that's
the structural guarantee against Personal/Business data mixing, not just a
filter convention.
"""
import asyncio
import calendar
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from server import db, get_current_user, now_utc, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, _send_one_push

personal_router = APIRouter(prefix="/api/personal")

DUE_SOON_DAYS = 3  # matches BillsScreen.jsx's own client-side threshold


class PersonalTransactionIn(BaseModel):
    type: Literal["income", "expense"]
    amount: float
    category: str
    description: Optional[str] = ""
    date: str  # ISO date
    currency: str = "USD"
    bill_id: Optional[str] = None


# ---- Personal Transactions ----
@personal_router.get("/transactions")
async def list_personal_transactions(
    type: Optional[Literal["income", "expense"]] = None,
    category: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    query = {"user_id": user["user_id"]}
    if type:
        query["type"] = type
    if category:
        query["category"] = category
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query["$gte"] = date_from
        if date_to:
            date_query["$lte"] = date_to
        query["date"] = date_query
    cursor = db.personal_transactions.find(query, {"_id": 0}).sort("date", -1)
    return await cursor.to_list(2000)

@personal_router.post("/transactions")
async def create_personal_transaction(payload: PersonalTransactionIn, user=Depends(get_current_user)):
    tx = payload.model_dump()
    tx["id"] = str(uuid.uuid4())
    tx["user_id"] = user["user_id"]
    tx["created_at"] = now_utc().isoformat()
    await db.personal_transactions.insert_one(tx)
    tx.pop("_id", None)
    if tx.get("bill_id"):
        # This transaction *is* the payment record - advance/clear the bill
        # without inserting a second transaction (unlike POST
        # /bills/{id}/mark-paid, which has no user-entered transaction to
        # reuse and must create one itself).
        bill = await db.personal_bills.find_one({"id": tx["bill_id"], "user_id": user["user_id"]}, {"_id": 0})
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found")
        await _advance_or_clear_bill(bill)
    return tx

@personal_router.put("/transactions/{tx_id}")
async def update_personal_transaction(tx_id: str, payload: PersonalTransactionIn, user=Depends(get_current_user)):
    upd = payload.model_dump()
    res = await db.personal_transactions.update_one({"id": tx_id, "user_id": user["user_id"]}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.personal_transactions.find_one({"id": tx_id}, {"_id": 0})

@personal_router.delete("/transactions/{tx_id}")
async def delete_personal_transaction(tx_id: str, user=Depends(get_current_user)):
    res = await db.personal_transactions.delete_one({"id": tx_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Budgets (view + delete only - no create/edit UI in Pulse v1) ----
@personal_router.get("/budgets/summary")
async def get_budgets_summary(month: Optional[str] = None, user=Depends(get_current_user)):
    month = month or now_utc().date().isoformat()[:7]
    budgets = await db.personal_budgets.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(200)
    result = []
    for b in budgets:
        txs = await db.personal_transactions.find(
            {
                "user_id": user["user_id"],
                "category": b["category"],
                "type": "expense",
                "date": {"$gte": f"{month}-01", "$lt": f"{month}-32"},
            },
            {"amount": 1},
        ).to_list(2000)
        spent = sum(t["amount"] for t in txs)
        result.append({
            "id": b["id"],
            "category": b["category"],
            "monthly_limit": b["monthly_limit"],
            "currency": b.get("currency", "USD"),
            "spent": spent,
            "remaining": b["monthly_limit"] - spent,
        })
    return result

@personal_router.delete("/budgets/{budget_id}")
async def delete_personal_budget(budget_id: str, user=Depends(get_current_user)):
    res = await db.personal_budgets.delete_one({"id": budget_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Bills (view + delete + mark-paid only - no create/edit UI in Pulse v1) ----
def _advance_one_month(date_str: str) -> str:
    from datetime import date as _date
    d = _date.fromisoformat(date_str)
    month = d.month + 1
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day).isoformat()

async def _advance_or_clear_bill(bill: dict) -> None:
    if bill.get("recurring"):
        await db.personal_bills.update_one(
            {"id": bill["id"]},
            {"$set": {"due_date": _advance_one_month(bill["due_date"]), "last_reminder_sent_at": None}},
        )
    else:
        await db.personal_bills.delete_one({"id": bill["id"]})

@personal_router.get("/bills")
async def list_personal_bills(user=Depends(get_current_user)):
    cursor = db.personal_bills.find({"user_id": user["user_id"]}, {"_id": 0}).sort("due_date", 1)
    return await cursor.to_list(500)

@personal_router.delete("/bills/{bill_id}")
async def delete_personal_bill(bill_id: str, user=Depends(get_current_user)):
    res = await db.personal_bills.delete_one({"id": bill_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}

@personal_router.post("/bills/{bill_id}/mark-paid")
async def mark_bill_paid(bill_id: str, user=Depends(get_current_user)):
    bill = await db.personal_bills.find_one({"id": bill_id, "user_id": user["user_id"]}, {"_id": 0})
    if not bill:
        raise HTTPException(status_code=404, detail="Not found")
    tx = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "type": "expense",
        "amount": bill["amount"],
        "category": bill["category"],
        "description": bill["name"],
        "date": now_utc().date().isoformat(),
        "currency": bill.get("currency", "USD"),
        "bill_id": bill["id"],
        "created_at": now_utc().isoformat(),
    }
    await db.personal_transactions.insert_one(tx)
    tx.pop("_id", None)
    await _advance_or_clear_bill(bill)
    return tx


# ---- Savings goals (view + delete only - no create/edit UI in Pulse v1) ----
@personal_router.get("/goals")
async def list_personal_goals(user=Depends(get_current_user)):
    goals = await db.personal_savings_goals.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(200)
    result = []
    for g in goals:
        contributions = await db.personal_goal_contributions.find(
            {"goal_id": g["id"], "user_id": user["user_id"]}, {"amount": 1}
        ).to_list(2000)
        result.append({**g, "current_amount": sum(c["amount"] for c in contributions)})
    return result

@personal_router.delete("/goals/{goal_id}")
async def delete_personal_goal(goal_id: str, user=Depends(get_current_user)):
    res = await db.personal_savings_goals.delete_one({"id": goal_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await db.personal_goal_contributions.delete_many({"goal_id": goal_id, "user_id": user["user_id"]})
    return {"success": True}

@personal_router.get("/goals/{goal_id}/contributions")
async def list_goal_contributions(goal_id: str, user=Depends(get_current_user)):
    cursor = db.personal_goal_contributions.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"_id": 0}
    ).sort("date", -1)
    return await cursor.to_list(2000)


# ---- Notifications + push ----
async def _push_to_personal_user(user_id: str, title: str, message: str, link: Optional[str]):
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY):
        return
    subs = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(50)
    if not subs:
        return
    payload = {"title": title, "message": message, "link": link}
    results = await asyncio.gather(*(asyncio.to_thread(_send_one_push, sub, payload) for sub in subs), return_exceptions=True)
    expired = [sub["endpoint"] for sub, r in zip(subs, results) if r == "expired"]
    if expired:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": expired}})

async def _notify_personal(user_id: str, type_: str, title: str, message: str = "", link: Optional[str] = None):
    await db.personal_notifications.insert_one({
        "id": str(uuid.uuid4()), "user_id": user_id, "type": type_, "title": title,
        "message": message, "link": link, "read": False, "created_at": now_utc().isoformat(),
    })
    await _push_to_personal_user(user_id, title, message, link)

async def _check_bills_due_soon(user_id: str):
    """Runs opportunistically on GET /personal/notifications (no background
    job runner in this deployment - mirrors _check_overdue_invoices,
    server.py:963). Uses personal_bills' last_reminder_sent_at as the
    one-shot-per-cycle guard: mark-paid already clears it when a bill
    advances, so this naturally re-fires next cycle without extra state."""
    today = now_utc().date()
    bills = await db.personal_bills.find({"user_id": user_id, "last_reminder_sent_at": None}, {"_id": 0}).to_list(500)
    for b in bills:
        due = datetime.fromisoformat(b["due_date"]).date()
        if due <= today + timedelta(days=DUE_SOON_DAYS):
            days = (due - today).days
            when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
            await _notify_personal(b["user_id"], "bill_due_soon", f"{b['name']} due {when}", f"${b['amount']:.2f} due {b['due_date']}", link="/bills")
            await db.personal_bills.update_one({"id": b["id"]}, {"$set": {"last_reminder_sent_at": now_utc().isoformat()}})

@personal_router.get("/notifications")
async def list_personal_notifications(user=Depends(get_current_user)):
    await _check_bills_due_soon(user["user_id"])
    items = await db.personal_notifications.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    unread_count = await db.personal_notifications.count_documents({"user_id": user["user_id"], "read": False})
    return {"items": items, "unread_count": unread_count}

@personal_router.post("/notifications/read-all")
async def mark_all_personal_notifications_read(user=Depends(get_current_user)):
    await db.personal_notifications.update_many({"user_id": user["user_id"], "read": False}, {"$set": {"read": True}})
    return {"success": True}

@personal_router.delete("/notifications")
async def clear_personal_notifications(user=Depends(get_current_user)):
    await db.personal_notifications.delete_many({"user_id": user["user_id"]})
    return {"success": True}

@personal_router.delete("/notifications/{notif_id}")
async def delete_personal_notification(notif_id: str, user=Depends(get_current_user)):
    res = await db.personal_notifications.delete_one({"id": notif_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}
