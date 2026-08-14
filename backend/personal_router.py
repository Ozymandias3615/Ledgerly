"""Ledgerly Personal - user_id-scoped endpoints, kept out of server.py per
design/ledgerly-personal.md. No business_id anywhere in this file - that's
the structural guarantee against Personal/Business data mixing, not just a
filter convention.
"""
import asyncio
import calendar
import json
import uuid
from datetime import datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from groq import AsyncGroq, AuthenticationError as GroqAuthenticationError, RateLimitError as GroqRateLimitError, APIStatusError as GroqAPIStatusError
from pydantic import BaseModel

from server import db, get_current_user, now_utc, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, _send_one_push, _resolve_ai_key

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


class PersonalBudgetIn(BaseModel):
    category: str
    monthly_limit: float
    currency: str = "USD"


class PersonalBillIn(BaseModel):
    name: str
    category: str
    amount: float
    due_date: str  # ISO date
    currency: str = "USD"
    recurring: bool = True


class PersonalGoalIn(BaseModel):
    name: str
    target_amount: float
    target_date: Optional[str] = None
    currency: str = "USD"


class PersonalGoalContributionIn(BaseModel):
    amount: float
    date: str  # ISO date
    note: Optional[str] = ""


class PersonalChatIn(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class PersonalConversationRenameIn(BaseModel):
    title: str


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


# ---- Budgets ----
# Spend-vs-limit is computed live from personal_transactions matching the
# budget's category (see get_budgets_summary below) - that's the read side
# of the two-way relationship. create/update here is the write side: users
# set the limit, transactions in that category drive what fills it.
@personal_router.post("/budgets")
async def create_personal_budget(payload: PersonalBudgetIn, user=Depends(get_current_user)):
    existing = await db.personal_budgets.find_one({"user_id": user["user_id"], "category": payload.category})
    if existing:
        raise HTTPException(status_code=400, detail=f"A budget for {payload.category} already exists")
    budget = payload.model_dump()
    budget["id"] = str(uuid.uuid4())
    budget["user_id"] = user["user_id"]
    await db.personal_budgets.insert_one(budget)
    budget.pop("_id", None)
    return budget

@personal_router.put("/budgets/{budget_id}")
async def update_personal_budget(budget_id: str, payload: PersonalBudgetIn, user=Depends(get_current_user)):
    res = await db.personal_budgets.update_one(
        {"id": budget_id, "user_id": user["user_id"]}, {"$set": payload.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.personal_budgets.find_one({"id": budget_id}, {"_id": 0})

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


# ---- Bills ----
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

@personal_router.post("/bills")
async def create_personal_bill(payload: PersonalBillIn, user=Depends(get_current_user)):
    bill = payload.model_dump()
    bill["id"] = str(uuid.uuid4())
    bill["user_id"] = user["user_id"]
    bill["last_reminder_sent_at"] = None
    await db.personal_bills.insert_one(bill)
    bill.pop("_id", None)
    return bill

@personal_router.put("/bills/{bill_id}")
async def update_personal_bill(bill_id: str, payload: PersonalBillIn, user=Depends(get_current_user)):
    upd = payload.model_dump()
    # due_date may have moved - clear the one-shot reminder guard so
    # _check_bills_due_soon re-evaluates against the new date next cycle.
    upd["last_reminder_sent_at"] = None
    res = await db.personal_bills.update_one({"id": bill_id, "user_id": user["user_id"]}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.personal_bills.find_one({"id": bill_id}, {"_id": 0})

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


# ---- Savings goals ----
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

@personal_router.post("/goals")
async def create_personal_goal(payload: PersonalGoalIn, user=Depends(get_current_user)):
    goal = payload.model_dump()
    goal["id"] = str(uuid.uuid4())
    goal["user_id"] = user["user_id"]
    await db.personal_savings_goals.insert_one(goal)
    goal.pop("_id", None)
    return {**goal, "current_amount": 0}

@personal_router.put("/goals/{goal_id}")
async def update_personal_goal(goal_id: str, payload: PersonalGoalIn, user=Depends(get_current_user)):
    res = await db.personal_savings_goals.update_one(
        {"id": goal_id, "user_id": user["user_id"]}, {"$set": payload.model_dump()}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    goal = await db.personal_savings_goals.find_one({"id": goal_id}, {"_id": 0})
    contributions = await db.personal_goal_contributions.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"amount": 1}
    ).to_list(2000)
    return {**goal, "current_amount": sum(c["amount"] for c in contributions)}

@personal_router.post("/goals/{goal_id}/contributions")
async def add_goal_contribution(goal_id: str, payload: PersonalGoalContributionIn, user=Depends(get_current_user)):
    goal = await db.personal_savings_goals.find_one({"id": goal_id, "user_id": user["user_id"]}, {"_id": 0})
    if not goal:
        raise HTTPException(status_code=404, detail="Not found")
    existing = await db.personal_goal_contributions.find(
        {"goal_id": goal_id, "user_id": user["user_id"]}, {"amount": 1}
    ).to_list(2000)
    previous_amount = sum(c["amount"] for c in existing)

    contrib = payload.model_dump()
    contrib["id"] = str(uuid.uuid4())
    contrib["goal_id"] = goal_id
    contrib["user_id"] = user["user_id"]
    await db.personal_goal_contributions.insert_one(contrib)
    contrib.pop("_id", None)

    current_amount = previous_amount + contrib["amount"]
    # "just_reached" only fires on the contribution that crosses the line,
    # not on every contribution made after a goal is already complete.
    just_reached = previous_amount < goal["target_amount"] <= current_amount
    return {"contribution": contrib, "current_amount": current_amount, "just_reached": just_reached}

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


# ---- AI Insights ----
# Reuses server._resolve_ai_key (shared Groq key/quota lives on the business
# record, and get_current_user always attaches business_id regardless of
# active_context) - the quota is per-account, not per-context. Everything
# else here stays user_id-scoped like the rest of this file.
async def _personal_context(user: dict) -> str:
    user_id = user["user_id"]
    currency = user.get("currency", "USD")
    txs = await db.personal_transactions.find({"user_id": user_id}, {"_id": 0}).to_list(2000)
    income = sum(t["amount"] for t in txs if t["type"] == "income")
    expenses = sum(t["amount"] for t in txs if t["type"] == "expense")
    by_category = {}
    for t in txs:
        if t["type"] == "expense":
            by_category[t["category"]] = by_category.get(t["category"], 0) + t["amount"]

    budgets = await get_budgets_summary(month=None, user=user)
    bills = await db.personal_bills.find({"user_id": user_id}, {"_id": 0}).sort("due_date", 1).to_list(500)
    goals = await list_personal_goals(user=user)

    budgets_str = "; ".join(f"{b['category']}: {b['spent']:.2f}/{b['monthly_limit']:.2f}" for b in budgets) or "none set"
    bills_str = "; ".join(f"{b['name']} ({b['category']}) ${b['amount']:.2f} due {b['due_date']}" for b in bills) or "none"
    goals_str = "; ".join(f"{g['name']}: {g['current_amount']:.2f}/{g['target_amount']:.2f}" for g in goals) or "none"

    return f"""Currency: {currency}

Financial Summary (all time):
- Total Income: {income:.2f}
- Total Expenses: {expenses:.2f}
- Net: {income - expenses:.2f}
- Total Transactions: {len(txs)}

Expense Categories (all time): {by_category}

Budgets this month (category: spent/limit): {budgets_str}
Upcoming Bills: {bills_str}
Savings Goals (current/target): {goals_str}
"""

@personal_router.post("/insights/chat")
async def personal_insights_chat(payload: PersonalChatIn, user=Depends(get_current_user)):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    api_key = await _resolve_ai_key(user)

    conversation = None
    if payload.conversation_id:
        conversation = await db.personal_ai_conversations.find_one(
            {"conversation_id": payload.conversation_id, "user_id": user["user_id"]}, {"_id": 0}
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

    history = conversation["messages"] if conversation else []
    ctx = await _personal_context(user)
    messages = [{
        "role": "system",
        "content": (
            "You are a friendly personal finance coach helping someone understand their own money. "
            "Be direct, concrete, and cite specific numbers. Use plain markdown: paragraphs, **bold**, and bullet "
            "lists. Never use markdown tables (pipe/dash grid syntax) - the chat UI doesn't render them, so present "
            "any comparison or breakdown as a short bullet list or prose instead. Never invent numbers not provided. "
            "Keep answers focused and conversational - structure with headings/bullets only when it genuinely helps.\n\n"
            f"Current personal finance data:\n{ctx}"
        ),
    }]
    messages += [{"role": m["role"], "content": m["content"]} for m in history]
    messages.append({"role": "user", "content": message})

    conversation_id = conversation["conversation_id"] if conversation else str(uuid.uuid4())
    now_iso = now_utc().isoformat()

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    async def event_stream():
        yield sse({"type": "meta", "conversation_id": conversation_id})
        reply_parts = []
        client = AsyncGroq(api_key=api_key)
        try:
            stream = await client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=messages,
                max_completion_tokens=2048,
                reasoning_effort="low",
                stream=True,
            )
            async for chunk in stream:
                text = chunk.choices[0].delta.content
                if text:
                    reply_parts.append(text)
                    yield sse({"type": "chunk", "text": text})
        except GroqAuthenticationError:
            yield sse({"type": "error", "message": "Invalid Groq API key. Update it in Settings → Business → AI Insights."})
            return
        except GroqRateLimitError:
            yield sse({"type": "error", "message": "Groq API rate limit or quota exceeded. Please try again shortly."})
            return
        except GroqAPIStatusError as e:
            yield sse({"type": "error", "message": f"AI service error: {e.message}"})
            return
        except Exception:
            yield sse({"type": "error", "message": "AI service temporarily unavailable. Please try again shortly."})
            return

        reply = "".join(reply_parts)
        new_messages = [
            {"role": "user", "content": message, "at": now_iso},
            {"role": "assistant", "content": reply, "at": now_iso},
        ]
        if conversation:
            await db.personal_ai_conversations.update_one(
                {"conversation_id": conversation_id},
                {"$push": {"messages": {"$each": new_messages}}, "$set": {"updated_at": now_iso}},
            )
        else:
            title = message if len(message) <= 60 else message[:57] + "..."
            await db.personal_ai_conversations.insert_one({
                "conversation_id": conversation_id,
                "user_id": user["user_id"],
                "title": title,
                "messages": new_messages,
                "created_at": now_iso,
                "updated_at": now_iso,
            })
        yield sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@personal_router.get("/insights/conversations")
async def list_personal_conversations(user=Depends(get_current_user)):
    return await db.personal_ai_conversations.find(
        {"user_id": user["user_id"]}, {"_id": 0, "conversation_id": 1, "title": 1, "updated_at": 1}
    ).sort("updated_at", -1).to_list(100)

@personal_router.get("/insights/conversations/{conversation_id}")
async def get_personal_conversation(conversation_id: str, user=Depends(get_current_user)):
    convo = await db.personal_ai_conversations.find_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo

@personal_router.put("/insights/conversations/{conversation_id}")
async def rename_personal_conversation(conversation_id: str, payload: PersonalConversationRenameIn, user=Depends(get_current_user)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    res = await db.personal_ai_conversations.update_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"]}, {"$set": {"title": title}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}

@personal_router.delete("/insights/conversations/{conversation_id}")
async def delete_personal_conversation(conversation_id: str, user=Depends(get_current_user)):
    res = await db.personal_ai_conversations.delete_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


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
