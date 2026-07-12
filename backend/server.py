from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import string
import base64
import calendar
import logging
import secrets
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
import httpx
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_auth_requests
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from google import genai
from google.genai import types as genai_types
from google.genai import errors as genai_errors
import openpyxl
from PIL import Image as PILImage
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage

# ---- Config ----
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID")
# Shared fallback key so AI Insights works out of the box for every business
# without each one needing their own Gemini key. Businesses can still set their
# own key in Settings to bypass the shared daily cap below.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
SHARED_AI_DAILY_LIMIT = 10
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")


# ---- Utilities ----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def now_utc():
    return datetime.now(timezone.utc)

def iso(dt): 
    return dt.isoformat() if isinstance(dt, datetime) else dt


async def _enrich_user(user: dict) -> dict:
    """Resolve business_id/role from the user's active membership, and merge in
    business_name/currency from the linked business doc - so every existing
    caller reading user.business_id / user.role / user.business_name / user.currency
    keeps working unchanged, now reflecting whichever business is active."""
    membership = await db.memberships.find_one(
        {"user_id": user["user_id"], "business_id": user.get("active_business_id")}, {"_id": 0}
    )
    if membership:
        user["business_id"] = membership["business_id"]
        user["role"] = membership["role"]
    biz = await db.businesses.find_one({"business_id": user.get("business_id")}, {"_id": 0})
    if biz:
        user["business_name"] = biz["name"]
        user["currency"] = biz["currency"]
        user["logo_data"] = biz.get("logo_data")
        user["logo_content_type"] = biz.get("logo_content_type")
        user["has_ai_key"] = bool(biz.get("ai_api_key"))
    return user

async def _create_membership(user_id: str, business_id: str, role: str) -> dict:
    membership = {
        "membership_id": str(uuid.uuid4()),
        "user_id": user_id,
        "business_id": business_id,
        "role": role,
        "joined_at": now_utc().isoformat(),
    }
    await db.memberships.insert_one(membership)
    await db.users.update_one({"user_id": user_id}, {"$set": {"active_business_id": business_id}})
    membership.pop("_id", None)
    return membership


async def _notify(business_id: str, type_: str, title: str, message: str = "", link: Optional[str] = None):
    """Records a business-scoped notification (shown in the app's bell menu)
    for a meaningful change or alert - not called for high-frequency actions
    like individual transactions, to keep the feed useful rather than noisy."""
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "business_id": business_id,
        "type": type_,
        "title": title,
        "message": message,
        "link": link,
        "read": False,
        "created_at": now_utc().isoformat(),
    })


async def get_current_user(request: Request) -> dict:
    # Try JWT access_token cookie
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if token:
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            if payload.get("type") == "access":
                user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return await _enrich_user(user)
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            pass
    # Try Emergent session_token cookie
    session_token = request.cookies.get("session_token")
    if not session_token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            session_token = auth_header[7:]
    if session_token:
        sess = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if sess:
            expires_at = sess["expires_at"]
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at > now_utc():
                user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return await _enrich_user(user)
    raise HTTPException(status_code=401, detail="Not authenticated")


def require_role(*roles):
    async def checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Not authorized for this action")
        return user
    return checker


# ---- Auth models ----
class RegisterIn(BaseModel):
    email: EmailStr
    password: str
    name: str
    business_name: Optional[str] = None
    currency: Optional[str] = "USD"
    invite_code: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class GoogleSessionIn(BaseModel):
    session_id: str

class FirebaseSessionIn(BaseModel):
    id_token: str

class UserUpdateIn(BaseModel):
    name: str

class BusinessUpdateIn(BaseModel):
    name: str
    currency: str = "USD"

class AiKeyIn(BaseModel):
    api_key: str

class InviteCreateIn(BaseModel):
    role: Literal["admin", "staff"]

class MemberRoleIn(BaseModel):
    role: Literal["admin", "staff"]

class InviteRedeemIn(BaseModel):
    code: str

class MembershipSwitchIn(BaseModel):
    business_id: str


# ---- Domain models ----
class TransactionIn(BaseModel):
    type: Literal["income", "expense"]
    amount: float
    category: str
    description: Optional[str] = ""
    date: str  # ISO date
    currency: str = "USD"
    tax_amount: Optional[float] = 0
    vendor_id: Optional[str] = None
    invoice_id: Optional[str] = None

class InvoiceItem(BaseModel):
    description: str
    quantity: float
    unit_price: float

class InvoiceIn(BaseModel):
    client_name: str
    client_email: Optional[str] = ""
    client_address: Optional[str] = ""
    client_id: Optional[str] = None
    issue_date: str
    due_date: str
    currency: str = "USD"
    tax_rate: float = 0
    notes: Optional[str] = ""
    items: List[InvoiceItem]
    status: Literal["draft", "sent", "paid", "overdue"] = "draft"

class ClientIn(BaseModel):
    name: str
    type: Literal["client", "vendor"] = "client"
    email: Optional[str] = ""
    phone: Optional[str] = ""
    address: Optional[str] = ""
    notes: Optional[str] = ""

class EmployeeIn(BaseModel):
    name: str
    email: Optional[str] = ""
    position: Optional[str] = ""
    salary: float
    pay_frequency: Literal["monthly", "biweekly", "weekly"] = "monthly"
    tax_rate: float = 0
    currency: str = "USD"

class PayrollRunIn(BaseModel):
    period_start: str
    period_end: str
    employee_ids: Optional[List[str]] = None

class InventoryItemIn(BaseModel):
    name: str
    category: Optional[str] = ""
    quantity: float
    unit: Optional[str] = "units"
    reorder_point: float = 0
    unit_cost: Optional[float] = 0

class InsightIn(BaseModel):
    question: Optional[str] = "Give me an overview of my business financial health."

class ChatIn(BaseModel):
    message: str
    conversation_id: Optional[str] = None


# ---- Business / invite helpers ----
async def _create_business(name: str, currency: str, owner_user_id: str) -> dict:
    business_id = f"biz_{uuid.uuid4().hex[:12]}"
    doc = {
        "business_id": business_id,
        "name": name,
        "currency": currency,
        "owner_user_id": owner_user_id,
        "created_at": now_utc().isoformat(),
    }
    await db.businesses.insert_one(doc)
    return doc

async def _generate_invite_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(8))
        if not await db.invites.find_one({"code": code}):
            return code

def _invite_expiry(expires_at):
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return expires_at


# ---- Auth endpoints ----
@api_router.post("/auth/register")
async def register(payload: RegisterIn, response: Response):
    email = payload.email.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    invite = None
    if payload.invite_code:
        invite = await db.invites.find_one({"code": payload.invite_code.strip().upper()})
        if not invite or invite.get("redeemed_at"):
            raise HTTPException(status_code=400, detail="Invalid or already-used invite code")
        if _invite_expiry(invite["expires_at"]) < now_utc():
            raise HTTPException(status_code=400, detail="This invite code has expired")

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "email": email,
        "name": payload.name,
        "password_hash": hash_password(payload.password),
        "auth_provider": "password",
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(doc)

    if invite:
        await _create_membership(user_id, invite["business_id"], invite["role"])
        await db.invites.update_one({"code": invite["code"]}, {"$set": {"redeemed_at": now_utc().isoformat(), "redeemed_by": user_id}})
    else:
        business = await _create_business(payload.business_name or payload.name, payload.currency or "USD", user_id)
        await _create_membership(user_id, business["business_id"], "owner")

    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(user)

@api_router.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["user_id"], email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    user.pop("_id", None)
    user.pop("password_hash", None)
    return await _enrich_user(user)

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("session_token", path="/")
    return {"success": True}

@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return user

@api_router.put("/users/me")
async def update_me(payload: UserUpdateIn, user=Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"name": payload.name}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(updated)

@api_router.post("/auth/google-session")
async def google_session(payload: GoogleSessionIn, response: Response):
    # REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    async with httpx.AsyncClient() as hc:
        r = await hc.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": payload.session_id},
            timeout=15.0,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    data = r.json()
    email = data["email"].lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": data.get("name", existing.get("name")), "picture": data.get("picture", "")}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        name = data.get("name", email.split("@")[0])
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": data.get("picture", ""),
            "auth_provider": "google",
            "created_at": now_utc().isoformat(),
        })
        business = await _create_business(name, "USD", user_id)
        await _create_membership(user_id, business["business_id"], "owner")
    expires_at = now_utc() + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": data["session_token"],
        "expires_at": expires_at.isoformat(),
        "created_at": now_utc().isoformat(),
    })
    response.set_cookie("session_token", data["session_token"], httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(user)

@api_router.post("/auth/firebase-session")
async def firebase_session(payload: FirebaseSessionIn, response: Response):
    if not FIREBASE_PROJECT_ID:
        raise HTTPException(status_code=500, detail="Firebase is not configured on the server")
    try:
        decoded = google_id_token.verify_firebase_token(
            payload.id_token, google_auth_requests.Request(), audience=FIREBASE_PROJECT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    email = decoded["email"].lower()
    name = decoded.get("name", email.split("@")[0])
    picture = decoded.get("picture", "")
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "auth_provider": "google",
            "created_at": now_utc().isoformat(),
        })
        business = await _create_business(name, "USD", user_id)
        await _create_membership(user_id, business["business_id"], "owner")
    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=604800, path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(user)


# ---- Business ----
def _hide_ai_key(biz: dict) -> dict:
    biz["has_ai_key"] = bool(biz.pop("ai_api_key", None))
    return biz

@api_router.get("/business")
async def get_business(user=Depends(get_current_user)):
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    return _hide_ai_key(biz)

@api_router.put("/business")
async def update_business(payload: BusinessUpdateIn, user=Depends(require_role("owner", "admin"))):
    await db.businesses.update_one({"business_id": user["business_id"]}, {"$set": {"name": payload.name, "currency": payload.currency}})
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    return _hide_ai_key(biz)

@api_router.put("/business/ai-key")
async def set_ai_key(payload: AiKeyIn, user=Depends(require_role("owner", "admin"))):
    key = payload.api_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="API key cannot be empty")
    await db.businesses.update_one({"business_id": user["business_id"]}, {"$set": {"ai_api_key": key}})
    return {"success": True}

@api_router.delete("/business/ai-key")
async def clear_ai_key(user=Depends(require_role("owner", "admin"))):
    await db.businesses.update_one({"business_id": user["business_id"]}, {"$unset": {"ai_api_key": ""}})
    return {"success": True}

@api_router.get("/business/members")
async def list_members(user=Depends(require_role("owner", "admin"))):
    memberships = await db.memberships.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(500)
    role_by_user = {m["user_id"]: m["role"] for m in memberships}
    users = await db.users.find({"user_id": {"$in": list(role_by_user)}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(500)
    return [{**u, "role": role_by_user.get(u["user_id"])} for u in users]

@api_router.put("/business/members/{member_user_id}/role")
async def change_member_role(member_user_id: str, payload: MemberRoleIn, user=Depends(require_role("owner", "admin"))):
    if member_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="You can't change your own role")
    membership = await db.memberships.find_one({"user_id": member_user_id, "business_id": user["business_id"]}, {"_id": 0})
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")
    if membership["role"] == "owner":
        raise HTTPException(status_code=400, detail="The owner's role can't be changed")
    await db.memberships.update_one(
        {"user_id": member_user_id, "business_id": user["business_id"]},
        {"$set": {"role": payload.role}},
    )
    return {"success": True, "role": payload.role}

MAX_LOGO_BYTES = 1 * 1024 * 1024
ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp"}

@api_router.post("/business/logo")
async def upload_business_logo(file: UploadFile = File(...), user=Depends(require_role("owner", "admin"))):
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Logo must be a PNG, JPEG, or WEBP image")
    raw = await file.read()
    if len(raw) > MAX_LOGO_BYTES:
        raise HTTPException(status_code=400, detail="Logo must be smaller than 1MB")
    try:
        img = PILImage.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    img.thumbnail((400, 400))
    out = io.BytesIO()
    img.save(out, format="PNG")
    encoded = base64.b64encode(out.getvalue()).decode()
    await db.businesses.update_one(
        {"business_id": user["business_id"]},
        {"$set": {"logo_data": encoded, "logo_content_type": "image/png"}},
    )
    return {"success": True}

@api_router.delete("/business/logo")
async def delete_business_logo(user=Depends(require_role("owner", "admin"))):
    await db.businesses.update_one({"business_id": user["business_id"]}, {"$unset": {"logo_data": "", "logo_content_type": ""}})
    return {"success": True}

@api_router.post("/business/relabel-currency")
async def relabel_currency(user=Depends(require_role("owner", "admin"))):
    """Relabel every existing transaction/invoice/employee/payslip to the
    business's current currency. This changes the currency code shown, not the
    amount - no exchange-rate conversion is applied."""
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    currency = biz["currency"]
    updated = {}
    for name, coll in (("transactions", db.transactions), ("invoices", db.invoices), ("employees", db.employees)):
        res = await coll.update_many({"business_id": user["business_id"]}, {"$set": {"currency": currency}})
        updated[name] = res.modified_count
    payroll_res = await db.payroll_runs.update_many(
        {"business_id": user["business_id"]},
        {"$set": {"payslips.$[].currency": currency}},
    )
    updated["payroll_runs"] = payroll_res.modified_count
    return {"success": True, "currency": currency, "updated": updated}


# ---- Invites ----
@api_router.post("/invites")
async def create_invite(payload: InviteCreateIn, user=Depends(require_role("owner", "admin"))):
    code = await _generate_invite_code()
    expires_at = now_utc() + timedelta(days=7)
    invite = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "business_id": user["business_id"],
        "role": payload.role,
        "created_by": user["user_id"],
        "created_at": now_utc().isoformat(),
        "expires_at": expires_at.isoformat(),
        "redeemed_at": None,
        "redeemed_by": None,
    }
    await db.invites.insert_one(invite)
    invite.pop("_id", None)
    return invite

@api_router.get("/invites")
async def list_invites(user=Depends(require_role("owner", "admin"))):
    return await db.invites.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(200)

@api_router.delete("/invites/{code}")
async def revoke_invite(code: str, user=Depends(require_role("owner", "admin"))):
    res = await db.invites.delete_one({"code": code.upper(), "business_id": user["business_id"], "redeemed_at": None})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Invite not found or already used")
    return {"success": True}

@api_router.get("/invites/preview/{code}")
async def preview_invite(code: str):
    invite = await db.invites.find_one({"code": code.strip().upper()}, {"_id": 0})
    if not invite or invite.get("redeemed_at") or _invite_expiry(invite["expires_at"]) < now_utc():
        raise HTTPException(status_code=404, detail="Invalid or expired invite code")
    biz = await db.businesses.find_one({"business_id": invite["business_id"]}, {"_id": 0})
    return {"business_name": biz["name"] if biz else "this business", "role": invite["role"]}

@api_router.post("/invites/redeem")
async def redeem_invite(payload: InviteRedeemIn, user=Depends(get_current_user)):
    invite = await db.invites.find_one({"code": payload.code.strip().upper()})
    if not invite or invite.get("redeemed_at"):
        raise HTTPException(status_code=400, detail="Invalid or already-used invite code")
    if _invite_expiry(invite["expires_at"]) < now_utc():
        raise HTTPException(status_code=400, detail="This invite code has expired")
    existing_membership = await db.memberships.find_one({"user_id": user["user_id"], "business_id": invite["business_id"]})
    if existing_membership:
        raise HTTPException(status_code=400, detail="You're already a member of this business")
    await _create_membership(user["user_id"], invite["business_id"], invite["role"])
    await db.invites.update_one({"code": invite["code"]}, {"$set": {"redeemed_at": now_utc().isoformat(), "redeemed_by": user["user_id"]}})
    await _notify(
        invite["business_id"], "team_joined", "New team member joined",
        f"{user['name']} joined as {invite['role']}", link="/settings",
    )
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(updated)


# ---- Memberships ----
@api_router.get("/memberships")
async def list_memberships(user=Depends(get_current_user)):
    memberships = await db.memberships.find({"user_id": user["user_id"]}, {"_id": 0}).to_list(50)
    result = []
    for m in memberships:
        biz = await db.businesses.find_one({"business_id": m["business_id"]}, {"_id": 0})
        result.append({
            "business_id": m["business_id"],
            "business_name": biz["name"] if biz else "Unknown business",
            "role": m["role"],
            "active": m["business_id"] == user.get("active_business_id"),
        })
    return result

@api_router.post("/memberships/switch")
async def switch_membership(payload: MembershipSwitchIn, user=Depends(get_current_user)):
    membership = await db.memberships.find_one({"user_id": user["user_id"], "business_id": payload.business_id})
    if not membership:
        raise HTTPException(status_code=404, detail="You're not a member of that business")
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_business_id": payload.business_id}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(updated)


# ---- Transactions ----
@api_router.get("/transactions")
async def list_transactions(user=Depends(get_current_user)):
    cursor = db.transactions.find({"business_id": user["business_id"]}, {"_id": 0}).sort("date", -1)
    return await cursor.to_list(2000)

@api_router.post("/transactions")
async def create_transaction(payload: TransactionIn, user=Depends(get_current_user)):
    tx = payload.model_dump()
    tx["id"] = str(uuid.uuid4())
    tx["user_id"] = user["user_id"]
    tx["business_id"] = user["business_id"]
    tx["created_at"] = now_utc().isoformat()
    await db.transactions.insert_one(tx)
    tx.pop("_id", None)
    return tx

@api_router.put("/transactions/{tx_id}")
async def update_transaction(tx_id: str, payload: TransactionIn, user=Depends(get_current_user)):
    upd = payload.model_dump()
    res = await db.transactions.update_one({"id": tx_id, "business_id": user["business_id"]}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    tx = await db.transactions.find_one({"id": tx_id}, {"_id": 0})
    return tx

@api_router.delete("/transactions/{tx_id}")
async def delete_transaction(tx_id: str, user=Depends(get_current_user)):
    res = await db.transactions.delete_one({"id": tx_id, "business_id": user["business_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Inventory ----
@api_router.get("/inventory")
async def list_inventory(user=Depends(get_current_user)):
    return await db.inventory.find({"business_id": user["business_id"]}, {"_id": 0}).sort("name", 1).to_list(2000)

@api_router.post("/inventory")
async def create_inventory_item(payload: InventoryItemIn, user=Depends(get_current_user)):
    item = payload.model_dump()
    item["id"] = str(uuid.uuid4())
    item["user_id"] = user["user_id"]
    item["business_id"] = user["business_id"]
    item["created_at"] = now_utc().isoformat()
    await db.inventory.insert_one(item)
    item.pop("_id", None)
    if item["quantity"] <= item["reorder_point"]:
        await _notify(
            user["business_id"], "inventory_low", f"{item['name']} is running low",
            f"{item['quantity']:g} {item.get('unit', 'units')} left", link="/inventory",
        )
    return item

@api_router.put("/inventory/{item_id}")
async def update_inventory_item(item_id: str, payload: InventoryItemIn, user=Depends(get_current_user)):
    existing = await db.inventory.find_one({"id": item_id, "business_id": user["business_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    upd = payload.model_dump()
    await db.inventory.update_one({"id": item_id, "business_id": user["business_id"]}, {"$set": upd})
    was_low = existing["quantity"] <= existing["reorder_point"]
    now_low = upd["quantity"] <= upd["reorder_point"]
    if now_low and not was_low:
        await _notify(
            user["business_id"], "inventory_low", f"{upd['name']} is running low",
            f"{upd['quantity']:g} {upd.get('unit', 'units')} left", link="/inventory",
        )
    return await db.inventory.find_one({"id": item_id}, {"_id": 0})

@api_router.delete("/inventory/{item_id}")
async def delete_inventory_item(item_id: str, user=Depends(get_current_user)):
    res = await db.inventory.delete_one({"id": item_id, "business_id": user["business_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Clients & vendors ----
@api_router.get("/clients")
async def list_clients(user=Depends(get_current_user)):
    return await db.clients.find({"business_id": user["business_id"]}, {"_id": 0}).sort("name", 1).to_list(5000)

@api_router.post("/clients")
async def create_client(payload: ClientIn, user=Depends(get_current_user)):
    doc = payload.model_dump()
    doc["id"] = str(uuid.uuid4())
    doc["user_id"] = user["user_id"]
    doc["business_id"] = user["business_id"]
    doc["created_at"] = now_utc().isoformat()
    await db.clients.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/clients/{client_id}")
async def update_client(client_id: str, payload: ClientIn, user=Depends(get_current_user)):
    res = await db.clients.update_one({"id": client_id, "business_id": user["business_id"]}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.clients.find_one({"id": client_id}, {"_id": 0})

@api_router.delete("/clients/{client_id}")
async def delete_client(client_id: str, user=Depends(get_current_user)):
    res = await db.clients.delete_one({"id": client_id, "business_id": user["business_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Invoices ----
async def _reconcile_invoice_income(business_id: str, user_id: str, invoice: dict):
    """Keeps the transactions ledger in sync with an invoice's paid status:
    creates a linked income transaction the moment an invoice becomes paid,
    removes it if the invoice is later un-marked as paid (the money isn't
    actually there), and keeps the amount in sync if a still-paid invoice is
    edited afterward."""
    is_paid = invoice.get("status") == "paid"
    existing_tx = await db.transactions.find_one({"invoice_id": invoice["id"], "business_id": business_id})

    if is_paid and not existing_tx:
        await db.transactions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "business_id": business_id,
            "type": "income",
            "amount": invoice["total"],
            "category": "Sales",
            "description": f"Invoice {invoice.get('invoice_number', '')} — {invoice['client_name']}",
            "date": now_utc().date().isoformat(),
            "currency": invoice.get("currency", "USD"),
            "tax_amount": invoice.get("tax", 0),
            "vendor_id": None,
            "invoice_id": invoice["id"],
            "created_at": now_utc().isoformat(),
        })
    elif is_paid and existing_tx:
        await db.transactions.update_one(
            {"id": existing_tx["id"]},
            {"$set": {
                "amount": invoice["total"],
                "tax_amount": invoice.get("tax", 0),
                "currency": invoice.get("currency", "USD"),
                "description": f"Invoice {invoice.get('invoice_number', '')} — {invoice['client_name']}",
            }},
        )
    elif not is_paid and existing_tx:
        await db.transactions.delete_one({"id": existing_tx["id"]})

def _calc_invoice_totals(inv: dict):
    subtotal = sum(it["quantity"] * it["unit_price"] for it in inv["items"])
    tax = subtotal * (inv.get("tax_rate", 0) / 100)
    total = subtotal + tax
    inv["subtotal"] = round(subtotal, 2)
    inv["tax"] = round(tax, 2)
    inv["total"] = round(total, 2)
    return inv

async def _next_invoice_number(business_id: str) -> str:
    count = await db.invoices.count_documents({"business_id": business_id})
    return f"INV-{count + 1:05d}"

@api_router.get("/invoices")
async def list_invoices(user=Depends(get_current_user)):
    return await db.invoices.find({"business_id": user["business_id"]}, {"_id": 0}).sort("issue_date", -1).to_list(1000)

@api_router.post("/invoices")
async def create_invoice(payload: InvoiceIn, user=Depends(get_current_user)):
    inv = payload.model_dump()
    inv["id"] = str(uuid.uuid4())
    inv["user_id"] = user["user_id"]
    inv["business_id"] = user["business_id"]
    inv["invoice_number"] = await _next_invoice_number(user["business_id"])
    inv["created_at"] = now_utc().isoformat()
    _calc_invoice_totals(inv)
    await db.invoices.insert_one(inv)
    inv.pop("_id", None)
    await _reconcile_invoice_income(user["business_id"], user["user_id"], inv)
    await _notify(
        user["business_id"], "invoice_created", f"Invoice {inv['invoice_number']} created",
        f"{inv['client_name']} — {_fmt(inv['total'], inv.get('currency', 'USD'))}", link="/invoices",
    )
    return inv

@api_router.get("/invoices/{inv_id}")
async def get_invoice(inv_id: str, user=Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": inv_id, "business_id": user["business_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Not found")
    return inv

@api_router.put("/invoices/{inv_id}")
async def update_invoice(inv_id: str, payload: InvoiceIn, user=Depends(get_current_user)):
    existing = await db.invoices.find_one({"id": inv_id, "business_id": user["business_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    upd = payload.model_dump()
    _calc_invoice_totals(upd)
    await db.invoices.update_one({"id": inv_id, "business_id": user["business_id"]}, {"$set": upd})
    updated = await db.invoices.find_one({"id": inv_id}, {"_id": 0})
    await _reconcile_invoice_income(user["business_id"], user["user_id"], updated)
    if updated.get("status") != existing.get("status"):
        await _notify(
            user["business_id"], "invoice_status", f"Invoice {updated.get('invoice_number', '')} marked {updated['status']}",
            f"{updated['client_name']} — {_fmt(updated['total'], updated.get('currency', 'USD'))}", link="/invoices",
        )
    return updated

@api_router.delete("/invoices/{inv_id}")
async def delete_invoice(inv_id: str, user=Depends(get_current_user)):
    res = await db.invoices.delete_one({"id": inv_id, "business_id": user["business_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    await db.transactions.delete_many({"invoice_id": inv_id, "business_id": user["business_id"]})
    return {"success": True}

CURRENCY_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "JMD": "J$", "GHS": "GH₵", "CAD": "C$", "INR": "₹", "AUD": "A$", "JPY": "¥"}

def _fmt(amount, cur):
    sym = CURRENCY_SYMBOLS.get(cur, cur + " ")
    return f"{sym}{amount:,.2f}"

def _fmt_date(val):
    """Render an ISO date (YYYY-MM-DD) as MM-DD-YYYY for display/exports."""
    try:
        return datetime.fromisoformat(str(val)[:10]).strftime("%m-%d-%Y")
    except (ValueError, TypeError):
        return val

# For PDF export tables: which column indices hold money amounts (right-aligned,
# formatted with the currency symbol), where the row's own currency code lives
# (None means "use the business's primary currency" - used by pnl/tax, which
# aggregate a single business rather than per-record currencies), and a nicer
# title than a mechanical kind.replace("_", " ").title().
EXPORT_MONEY_COLUMNS = {
    "transactions": [5, 6],
    "invoices": [5, 6, 7],
    "payroll": [4, 5, 6],
    "inventory": [5, 6],
    "pnl": [2],
    "tax": [1],
}
EXPORT_CURRENCY_COLUMN = {
    "transactions": 7,
    "invoices": 8,
    "payroll": 7,
}
EXPORT_TITLES = {
    "transactions": "Transactions",
    "invoices": "Invoices",
    "payroll": "Payroll",
    "inventory": "Inventory",
    "pnl": "Profit & Loss",
    "tax": "Tax Summary",
}
# Column widths as fractions of the usable page width (must sum to 1.0) - used
# to stretch the report tables (pnl/tax) across the full page instead of
# shrinking to their narrow auto-sized content width.
EXPORT_PDF_COL_WIDTHS = {
    "pnl": [0.2, 0.55, 0.25],
    "tax": [0.7, 0.3],
}

def _pdf_ledgerly_header(styles, logo_b64=None):
    """Branded header placed at the top of every generated PDF: the business's
    own uploaded logo when they have one, otherwise a generic Ledgerly mark."""
    if logo_b64:
        try:
            raw = base64.b64decode(logo_b64)
            reader_img = PILImage.open(io.BytesIO(raw))
            iw, ih = reader_img.size
            max_w, max_h = 2.2 * inch, 0.6 * inch
            ratio = min(max_w / iw, max_h / ih, 1)
            logo = RLImage(io.BytesIO(raw), width=iw * ratio, height=ih * ratio)
            return [logo, Spacer(1, 16)]
        except Exception:
            pass
    mark = Table([[""]], colWidths=[0.32*inch], rowHeights=[0.32*inch])
    mark.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#0f172a"))]))
    wordmark_style = ParagraphStyle('wordmark', parent=styles['Heading2'], fontSize=15,
                                     textColor=colors.HexColor("#0f172a"), leading=17)
    header = Table([[mark, Paragraph("<b>Ledgerly</b>", wordmark_style)]], colWidths=[0.4 * inch, 3 * inch])
    header.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (1, 0), (1, 0), 8),
        ('LEFTPADDING', (0, 0), (0, 0), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    return [header, Spacer(1, 16)]

# Styled statement layout for report PDFs, mirroring the in-app report cards:
# section labels, underlined rows with right-aligned amounts, bold totals, and
# a big color-coded net line.
_REPORT_PAGE_WIDTH = LETTER[0] - 1.2 * inch
_SLATE_LINE = colors.HexColor("#e2e8f0")

def _report_section_label(text, color):
    style = ParagraphStyle('seclabel', fontSize=8, textColor=color, spaceBefore=6, spaceAfter=4)
    return Paragraph(f"<b>{text.upper()}</b>", style)

def _report_rows_table(rows, cur, bold_last=False):
    data = [[label, _fmt(amount, cur)] for label, amount in rows]
    tbl = Table(data, colWidths=[_REPORT_PAGE_WIDTH * 0.7, _REPORT_PAGE_WIDTH * 0.3])
    style = [
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor("#0f172a")),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (-1, -1), 0.5, _SLATE_LINE),
    ]
    if bold_last:
        style.append(('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'))
    tbl.setStyle(TableStyle(style))
    return tbl

def _report_net_row(label, amount, cur, amount_color=None):
    tbl = Table([[label, _fmt(amount, cur)]], colWidths=[_REPORT_PAGE_WIDTH * 0.7, _REPORT_PAGE_WIDTH * 0.3])
    tbl.setStyle(TableStyle([
        ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 14),
        ('TEXTCOLOR', (0, 0), (0, 0), colors.HexColor("#0f172a")),
        ('TEXTCOLOR', (1, 0), (1, 0), amount_color or colors.HexColor("#0f172a")),
        ('LINEABOVE', (0, 0), (-1, 0), 1.5, colors.HexColor("#0f172a")),
        ('TOPPADDING', (0, 0), (-1, 0), 10),
    ]))
    return tbl

def _pnl_pdf_story(data, cur):
    story = []
    story.append(_report_section_label("Income", colors.HexColor("#047857")))
    income_rows = [(r["category"], r["amount"]) for r in data["income"]] + [("Total income", data["total_income"])]
    story.append(_report_rows_table(income_rows, cur, bold_last=True))
    story.append(Spacer(1, 12))
    story.append(_report_section_label("Expenses", colors.HexColor("#b91c1c")))
    expense_rows = [(r["category"], r["amount"]) for r in data["expenses"]] + [("Total expenses", data["total_expense"])]
    story.append(_report_rows_table(expense_rows, cur, bold_last=True))
    story.append(Spacer(1, 10))
    net_color = colors.HexColor("#047857") if data["net"] >= 0 else colors.HexColor("#b91c1c")
    story.append(_report_net_row("Net profit", data["net"], cur, net_color))
    return story

def _tax_pdf_story(data, cur):
    story = []
    rows = [
        ("Tax collected (on income)", data["tax_collected"]),
        ("Tax paid (on expenses)", data["tax_paid"]),
    ]
    story.append(_report_rows_table(rows, cur))
    story.append(Spacer(1, 10))
    story.append(_report_net_row("Net liability", data["net_tax_liability"], cur))
    return story

@api_router.get("/invoices/{inv_id}/pdf")
async def invoice_pdf(inv_id: str, user=Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": inv_id, "business_id": user["business_id"]}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Not found")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('title', parent=styles['Heading1'], fontSize=26, textColor=colors.HexColor("#0f172a"), spaceAfter=6)
    small = ParagraphStyle('small', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor("#64748b"))
    label = ParagraphStyle('label', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor("#64748b"), spaceAfter=2)
    body = ParagraphStyle('body', parent=styles['Normal'], fontSize=10)

    story = []
    biz = user.get("business_name") or user.get("name")
    story.extend(_pdf_ledgerly_header(styles, user.get("logo_data")))
    story.append(Paragraph(f"<b>INVOICE</b>", title_style))
    story.append(Paragraph(f"{inv['invoice_number']}", small))
    story.append(Spacer(1, 14))

    header = [[Paragraph(f"<b>{biz}</b><br/>{user.get('email','')}", body),
               Paragraph(f"<b>Issued:</b> {_fmt_date(inv['issue_date'])}<br/><b>Due:</b> {_fmt_date(inv['due_date'])}", body)]]
    t = Table(header, colWidths=[3.6*inch, 3.6*inch])
    t.setStyle(TableStyle([('VALIGN', (0,0),(-1,-1),'TOP')]))
    story.append(t)
    story.append(Spacer(1, 18))

    story.append(Paragraph("BILL TO", label))
    story.append(Paragraph(f"<b>{inv['client_name']}</b><br/>{inv.get('client_email','')}<br/>{inv.get('client_address','')}", body))
    story.append(Spacer(1, 16))

    cur = inv.get("currency", "USD")
    data = [["Description", "Qty", "Unit Price", "Amount"]]
    for it in inv["items"]:
        amt = it["quantity"] * it["unit_price"]
        data.append([it["description"], f"{it['quantity']:g}", _fmt(it["unit_price"], cur), _fmt(amt, cur)])
    tbl = Table(data, colWidths=[3.5*inch, 0.8*inch, 1.3*inch, 1.4*inch])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#0f172a")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('ALIGN', (1,0), (-1,-1), 'RIGHT'),
        ('GRID', (0,0), (-1,-1), 0.4, colors.HexColor("#e2e8f0")),
        ('FONTSIZE', (0,0), (-1,-1), 9),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 12))

    totals = [
        ["Subtotal", _fmt(inv["subtotal"], cur)],
        [f"Tax ({inv.get('tax_rate',0)}%)", _fmt(inv["tax"], cur)],
        ["TOTAL", _fmt(inv["total"], cur)],
    ]
    ttbl = Table(totals, colWidths=[5.6*inch, 1.4*inch])
    ttbl.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'RIGHT'),
        ('FONTNAME', (0,-1), (-1,-1), 'Helvetica-Bold'),
        ('LINEABOVE', (0,-1), (-1,-1), 1, colors.HexColor("#0f172a")),
        ('TOPPADDING', (0,0), (-1,-1), 4),
    ]))
    story.append(ttbl)
    story.append(Spacer(1, 20))
    if inv.get("notes"):
        story.append(Paragraph("NOTES", label))
        story.append(Paragraph(inv["notes"], body))
    doc.build(story)
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{inv["invoice_number"]}.pdf"'})


# ---- Employees & Payroll (owner/admin only - staff has no payroll access) ----
@api_router.get("/employees")
async def list_employees(user=Depends(require_role("owner", "admin"))):
    return await db.employees.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)

@api_router.post("/employees")
async def create_employee(payload: EmployeeIn, user=Depends(require_role("owner", "admin"))):
    emp = payload.model_dump()
    emp["id"] = str(uuid.uuid4())
    emp["user_id"] = user["user_id"]
    emp["business_id"] = user["business_id"]
    emp["created_at"] = now_utc().isoformat()
    await db.employees.insert_one(emp)
    emp.pop("_id", None)
    await _notify(
        user["business_id"], "employee_added", "New employee added",
        f"{emp['name']} — {emp.get('position') or 'Employee'}", link="/payroll",
    )
    return emp

@api_router.put("/employees/{emp_id}")
async def update_employee(emp_id: str, payload: EmployeeIn, user=Depends(require_role("owner", "admin"))):
    res = await db.employees.update_one({"id": emp_id, "business_id": user["business_id"]}, {"$set": payload.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.employees.find_one({"id": emp_id}, {"_id": 0})

@api_router.delete("/employees/{emp_id}")
async def delete_employee(emp_id: str, user=Depends(require_role("owner", "admin"))):
    existing = await db.employees.find_one({"id": emp_id, "business_id": user["business_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    await db.employees.delete_one({"id": emp_id, "business_id": user["business_id"]})
    await _notify(
        user["business_id"], "employee_removed", "Employee removed",
        f"{existing['name']} removed from payroll", link="/payroll",
    )
    return {"success": True}

@api_router.get("/payroll")
async def list_payroll(user=Depends(require_role("owner", "admin"))):
    return await db.payroll_runs.find({"business_id": user["business_id"]}, {"_id": 0}).sort("period_end", -1).to_list(500)

@api_router.post("/payroll/run")
async def run_payroll(payload: PayrollRunIn, user=Depends(require_role("owner", "admin"))):
    q = {"business_id": user["business_id"]}
    if payload.employee_ids:
        q["id"] = {"$in": payload.employee_ids}
    emps = await db.employees.find(q, {"_id": 0}).to_list(500)
    if not emps:
        raise HTTPException(status_code=400, detail="No employees found")

    payslips = []
    total_gross = 0.0
    total_tax = 0.0
    total_net = 0.0
    for e in emps:
        gross = float(e["salary"])
        tax = gross * float(e.get("tax_rate", 0)) / 100
        net = gross - tax
        payslips.append({
            "employee_id": e["id"],
            "employee_name": e["name"],
            "position": e.get("position", ""),
            "gross": round(gross, 2),
            "tax": round(tax, 2),
            "net": round(net, 2),
            "currency": e.get("currency", "USD"),
        })
        total_gross += gross
        total_tax += tax
        total_net += net

    run = {
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "business_id": user["business_id"],
        "period_start": payload.period_start,
        "period_end": payload.period_end,
        "payslips": payslips,
        "total_gross": round(total_gross, 2),
        "total_tax": round(total_tax, 2),
        "total_net": round(total_net, 2),
        "created_at": now_utc().isoformat(),
    }
    await db.payroll_runs.insert_one(run)

    # Auto-log a business expense
    await db.transactions.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["user_id"],
        "business_id": user["business_id"],
        "type": "expense",
        "amount": round(total_gross, 2),
        "category": "Payroll",
        "description": f"Payroll {payload.period_start} to {payload.period_end}",
        "date": payload.period_end,
        "currency": emps[0].get("currency", "USD"),
        "tax_amount": round(total_tax, 2),
        "created_at": now_utc().isoformat(),
    })
    run.pop("_id", None)
    await _notify(
        user["business_id"], "payroll_run", f"Payroll run for {payload.period_start} to {payload.period_end}",
        f"{len(emps)} employees — {_fmt(total_net, emps[0].get('currency', 'USD'))} net pay", link="/payroll",
    )
    return run


# ---- Notifications ----
@api_router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = await db.notifications.find({"business_id": user["business_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    unread_count = await db.notifications.count_documents({"business_id": user["business_id"], "read": False})
    return {"items": items, "unread_count": unread_count}

@api_router.post("/notifications/read-all")
async def mark_all_notifications_read(user=Depends(get_current_user)):
    await db.notifications.update_many({"business_id": user["business_id"], "read": False}, {"$set": {"read": True}})
    return {"success": True}

@api_router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"id": notif_id, "business_id": user["business_id"]}, {"$set": {"read": True}})
    return {"success": True}

@api_router.delete("/notifications")
async def clear_notifications(user=Depends(get_current_user)):
    await db.notifications.delete_many({"business_id": user["business_id"]})
    return {"success": True}

@api_router.delete("/notifications/{notif_id}")
async def delete_notification(notif_id: str, user=Depends(get_current_user)):
    res = await db.notifications.delete_one({"id": notif_id, "business_id": user["business_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"success": True}


# ---- Exchange rates (informational only - not used in any totals/conversion) ----
_fx_cache = {}  # base -> {"rates": {...}, "fetched_at": datetime, "last_updated": str}
FX_CACHE_TTL = timedelta(hours=1)

@api_router.get("/exchange-rates")
async def exchange_rates(base: str = Query("USD")):
    base = base.upper()
    cached = _fx_cache.get(base)
    if cached and now_utc() - cached["fetched_at"] < FX_CACHE_TTL:
        return {"base": base, "rates": cached["rates"], "last_updated": cached["last_updated"]}
    async with httpx.AsyncClient() as hc:
        try:
            r = await hc.get(f"https://open.er-api.com/v6/latest/{base}", timeout=10.0)
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Could not reach exchange rate provider")
    if r.status_code != 200 or r.json().get("result") != "success":
        raise HTTPException(status_code=502, detail="Exchange rate provider returned an error")
    data = r.json()
    rates = {code: data["rates"][code] for code in CURRENCY_SYMBOLS if code in data["rates"]}
    last_updated = data.get("time_last_update_utc", now_utc().isoformat())
    _fx_cache[base] = {"rates": rates, "fetched_at": now_utc(), "last_updated": last_updated}
    return {"base": base, "rates": rates, "last_updated": last_updated}


# ---- Reports ----
@api_router.get("/reports/dashboard")
async def dashboard_report(user=Depends(get_current_user)):
    txs = await db.transactions.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(5000)
    income = sum(t["amount"] for t in txs if t["type"] == "income")
    expenses = sum(t["amount"] for t in txs if t["type"] == "expense")
    tax = sum(t.get("tax_amount", 0) or 0 for t in txs)

    # monthly series (last 12 months)
    from collections import defaultdict
    monthly = defaultdict(lambda: {"income": 0, "expense": 0})
    for t in txs:
        try:
            d = datetime.fromisoformat(t["date"])
        except Exception:
            continue
        key = f"{d.year}-{d.month:02d}"
        monthly[key][t["type"]] += t["amount"]
    series = sorted([{"month": k, **v, "net": v["income"] - v["expense"]} for k, v in monthly.items()], key=lambda x: x["month"])[-12:]

    # category breakdown
    cats_income = defaultdict(float)
    cats_expense = defaultdict(float)
    for t in txs:
        if t["type"] == "income":
            cats_income[t["category"]] += t["amount"]
        else:
            cats_expense[t["category"]] += t["amount"]

    invoices = await db.invoices.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(1000)
    outstanding = sum(i["total"] for i in invoices if i.get("status") in ("draft", "sent", "overdue"))
    paid = sum(i["total"] for i in invoices if i.get("status") == "paid")

    return {
        "totals": {
            "income": round(income, 2),
            "expenses": round(expenses, 2),
            "net": round(income - expenses, 2),
            "tax_collected": round(tax, 2),
            "invoices_outstanding": round(outstanding, 2),
            "invoices_paid": round(paid, 2),
        },
        "monthly": series,
        "categories": {
            "income": [{"name": k, "value": round(v, 2)} for k, v in cats_income.items()],
            "expense": [{"name": k, "value": round(v, 2)} for k, v in cats_expense.items()],
        },
        "transactions_count": len(txs),
    }

def _weeks_in_month(year: int, month: int) -> int:
    return -(-calendar.monthrange(year, month)[1] // 7)  # ceil(days_in_month / 7)

@api_router.get("/reports/series")
async def dashboard_series(
    granularity: Literal["day", "week", "month", "year"] = Query("month"),
    date: Optional[str] = Query(None, description="Exact day, for granularity=day"),
    year: Optional[int] = Query(None, description="For week/month/year"),
    month: Optional[int] = Query(None, ge=1, le=12, description="For week/month"),
    week: Optional[int] = Query(None, ge=1, le=6, description="Which week of the month, for granularity=week"),
    user=Depends(get_current_user),
):
    """Bucketed cash flow / invoices / category data for one dashboard chart,
    for one exact period at the given granularity (not a range):
    day -> that single day, week -> that week-of-month (daily buckets),
    month -> that month (weekly buckets), year -> that year (monthly buckets)."""
    today = now_utc()

    if granularity == "day":
        try:
            start = datetime.fromisoformat(date) if date else today
        except Exception:
            start = today
        start = start.replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
        end = start
        buckets = [start.date().isoformat()]

        def bucket_key(d: datetime) -> str:
            return d.date().isoformat()

        label = f"{calendar.month_abbr[start.month]} {start.day}, {start.year}"
    elif granularity == "week":
        y = year or today.year
        m = month or today.month
        days_in_month = calendar.monthrange(y, m)[1]
        w = max(1, min(week or 1, _weeks_in_month(y, m)))
        start_day = (w - 1) * 7 + 1
        end_day = min(w * 7, days_in_month)
        start = datetime(y, m, start_day)
        end = datetime(y, m, end_day)
        buckets = [(start + timedelta(days=i)).date().isoformat() for i in range((end - start).days + 1)]

        def bucket_key(d: datetime) -> str:
            return d.date().isoformat()

        label = f"Week {w} of {calendar.month_name[m]} {y}"
    elif granularity == "month":
        y = year or today.year
        m = month or today.month
        start = datetime(y, m, 1)
        days_in_month = calendar.monthrange(y, m)[1]
        end = datetime(y, m, days_in_month)
        num_weeks = _weeks_in_month(y, m)
        buckets = [f"{y}-{m:02d}-W{w}" for w in range(1, num_weeks + 1)]

        def bucket_key(d: datetime) -> str:
            return f"{d.year}-{d.month:02d}-W{(d.day - 1) // 7 + 1}"

        label = f"{calendar.month_name[m]} {y}"
    else:  # year
        y = year or today.year
        start = datetime(y, 1, 1)
        end = datetime(y, 12, 31)
        buckets = [f"{y}-{mm:02d}" for mm in range(1, 13)]

        def bucket_key(d: datetime) -> str:
            return f"{d.year}-{d.month:02d}"

        label = str(y)

    start_s, end_s = start.date().isoformat(), end.date().isoformat()

    def bucket_label(b: str) -> str:
        if granularity == "day":
            return label
        if granularity == "week":
            d = datetime.fromisoformat(b)
            return calendar.day_abbr[d.weekday()]
        if granularity == "month":
            return f"Week {b.rsplit('W', 1)[1]}"
        mm = int(b.split("-")[1])
        return calendar.month_abbr[mm]

    series = {b: {"income": 0.0, "expense": 0.0, "invoices": {"draft": 0.0, "sent": 0.0, "paid": 0.0, "overdue": 0.0}} for b in buckets}

    txs = await db.transactions.find(
        {"business_id": user["business_id"], "date": {"$gte": start_s, "$lte": end_s}}, {"_id": 0}
    ).to_list(20000)
    cats_income, cats_expense = defaultdict(float), defaultdict(float)
    total_income = total_expense = tax = 0.0
    for t in txs:
        try:
            d = datetime.fromisoformat(t["date"])
        except Exception:
            continue
        key = bucket_key(d)
        if key not in series:
            continue
        amt = t["amount"]
        if t["type"] == "income":
            series[key]["income"] += amt
            total_income += amt
            cats_income[t["category"]] += amt
        else:
            series[key]["expense"] += amt
            total_expense += amt
            cats_expense[t["category"]] += amt
        tax += t.get("tax_amount", 0) or 0

    invoices = await db.invoices.find(
        {"business_id": user["business_id"], "issue_date": {"$gte": start_s, "$lte": end_s}}, {"_id": 0}
    ).to_list(5000)
    outstanding = paid_total = 0.0
    for i in invoices:
        try:
            d = datetime.fromisoformat(i["issue_date"])
        except Exception:
            continue
        key = bucket_key(d)
        status = i.get("status", "draft")
        total = i.get("total", 0) or 0
        if key in series and status in series[key]["invoices"]:
            series[key]["invoices"][status] += total
        if status == "paid":
            paid_total += total
        else:
            outstanding += total

    return {
        "window": {"start": start_s, "end": end_s, "granularity": granularity, "label": label},
        "series": [
            {
                "period": b,
                "label": bucket_label(b),
                "income": round(series[b]["income"], 2),
                "expense": round(series[b]["expense"], 2),
                "net": round(series[b]["income"] - series[b]["expense"], 2),
                "invoices": {k: round(v, 2) for k, v in series[b]["invoices"].items()},
            }
            for b in buckets
        ],
        "categories": {
            "income": [{"name": k, "value": round(v, 2)} for k, v in cats_income.items()],
            "expense": [{"name": k, "value": round(v, 2)} for k, v in cats_expense.items()],
        },
        "totals": {
            "income": round(total_income, 2),
            "expenses": round(total_expense, 2),
            "net": round(total_income - total_expense, 2),
            "tax_collected": round(tax, 2),
            "invoices_outstanding": round(outstanding, 2),
            "invoices_paid": round(paid_total, 2),
        },
        "transactions_count": len(txs),
    }

@api_router.get("/reports/pnl")
async def pnl_report(start: str = Query(...), end: str = Query(...), user=Depends(get_current_user)):
    txs = await db.transactions.find({"business_id": user["business_id"], "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    income_by_cat, expense_by_cat = {}, {}
    for t in txs:
        bucket = income_by_cat if t["type"] == "income" else expense_by_cat
        bucket[t["category"]] = bucket.get(t["category"], 0) + t["amount"]
    total_income = sum(income_by_cat.values())
    total_expense = sum(expense_by_cat.values())
    return {
        "start": start, "end": end,
        "income": [{"category": k, "amount": round(v, 2)} for k, v in income_by_cat.items()],
        "expenses": [{"category": k, "amount": round(v, 2)} for k, v in expense_by_cat.items()],
        "total_income": round(total_income, 2),
        "total_expense": round(total_expense, 2),
        "net": round(total_income - total_expense, 2),
    }

@api_router.get("/reports/tax")
async def tax_report(start: str = Query(...), end: str = Query(...), user=Depends(get_current_user)):
    txs = await db.transactions.find({"business_id": user["business_id"], "date": {"$gte": start, "$lte": end}}, {"_id": 0}).to_list(5000)
    tax_collected = sum(t.get("tax_amount", 0) or 0 for t in txs if t["type"] == "income")
    tax_paid = sum(t.get("tax_amount", 0) or 0 for t in txs if t["type"] == "expense")
    return {
        "start": start, "end": end,
        "tax_collected": round(tax_collected, 2),
        "tax_paid": round(tax_paid, 2),
        "net_tax_liability": round(tax_collected - tax_paid, 2),
    }


# ---- Export ----
def _txs_rows(txs, vendor_names=None):
    vendor_names = vendor_names or {}
    yield ["Date", "Type", "Category", "Description", "Vendor", "Amount", "Tax Amount", "Currency"]
    for t in txs:
        yield [_fmt_date(t.get("date")), t.get("type"), t.get("category"), t.get("description",""), vendor_names.get(t.get("vendor_id"), ""), t.get("amount"), t.get("tax_amount",0), t.get("currency","USD")]

def _invoices_rows(invs):
    yield ["Invoice #", "Client", "Issue Date", "Due Date", "Status", "Subtotal", "Tax", "Total", "Currency"]
    for i in invs:
        yield [i.get("invoice_number"), i.get("client_name"), _fmt_date(i.get("issue_date")), _fmt_date(i.get("due_date")), i.get("status"), i.get("subtotal"), i.get("tax"), i.get("total"), i.get("currency")]

def _payroll_rows(runs):
    yield ["Period Start", "Period End", "Employee", "Position", "Gross", "Tax", "Net", "Currency"]
    for r in runs:
        for p in r.get("payslips", []):
            yield [_fmt_date(r.get("period_start")), _fmt_date(r.get("period_end")), p.get("employee_name"), p.get("position",""), p.get("gross"), p.get("tax"), p.get("net"), p.get("currency")]

def _inventory_rows(items):
    yield ["Name", "Category", "Quantity", "Unit", "Reorder Point", "Unit Cost", "Total Value"]
    for i in items:
        qty = i.get("quantity", 0) or 0
        cost = i.get("unit_cost", 0) or 0
        yield [i.get("name"), i.get("category", ""), qty, i.get("unit", "units"), i.get("reorder_point", 0), cost, round(qty * cost, 2)]

def _pnl_rows(pnl):
    yield ["Section", "Category", "Amount"]
    for r in pnl["income"]:
        yield ["Income", r["category"], r["amount"]]
    yield ["Income", "TOTAL INCOME", pnl["total_income"]]
    for r in pnl["expenses"]:
        yield ["Expense", r["category"], r["amount"]]
    yield ["Expense", "TOTAL EXPENSES", pnl["total_expense"]]
    yield ["", "NET PROFIT", pnl["net"]]

def _tax_rows(tax):
    yield ["Metric", "Amount"]
    yield ["Tax collected (on income)", tax["tax_collected"]]
    yield ["Tax paid (on expenses)", tax["tax_paid"]]
    yield ["Net tax liability", tax["net_tax_liability"]]

@api_router.get("/export/{kind}")
async def export_data(
    kind: str,
    format: str = Query("csv"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    if kind == "transactions":
        data = await db.transactions.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(10000)
        vendors = await db.clients.find({"business_id": user["business_id"], "type": "vendor"}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
        vendor_names = {v["id"]: v["name"] for v in vendors}
        rows_iter = list(_txs_rows(data, vendor_names))
    elif kind == "invoices":
        data = await db.invoices.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(10000)
        rows_iter = list(_invoices_rows(data))
    elif kind == "payroll":
        if user.get("role") not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Not authorized for this action")
        data = await db.payroll_runs.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(10000)
        rows_iter = list(_payroll_rows(data))
    elif kind == "inventory":
        data = await db.inventory.find({"business_id": user["business_id"]}, {"_id": 0}).sort("name", 1).to_list(10000)
        rows_iter = list(_inventory_rows(data))
    elif kind == "pnl":
        if not start or not end:
            raise HTTPException(status_code=400, detail="start and end are required for this export")
        data = await pnl_report(start=start, end=end, user=user)
        rows_iter = list(_pnl_rows(data))
    elif kind == "tax":
        if not start or not end:
            raise HTTPException(status_code=400, detail="start and end are required for this export")
        data = await tax_report(start=start, end=end, user=user)
        rows_iter = list(_tax_rows(data))
    else:
        raise HTTPException(status_code=400, detail="Unknown export kind")

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        for row in rows_iter:
            writer.writerow(row)
        content = buf.getvalue().encode("utf-8")
        return StreamingResponse(io.BytesIO(content), media_type="text/csv",
                                 headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})
    elif format == "xlsx":
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = kind.capitalize()
        for row in rows_iter:
            ws.append(row)
        # bold header
        for cell in ws[1]:
            cell.font = openpyxl.styles.Font(bold=True)
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                 headers={"Content-Disposition": f'attachment; filename="{kind}.xlsx"'})
    elif format == "pdf":
        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.6*inch, rightMargin=0.6*inch, topMargin=0.5*inch, bottomMargin=0.5*inch)
        styles = getSampleStyleSheet()
        story = _pdf_ledgerly_header(styles, user.get("logo_data"))
        biz_name = user.get("business_name") or user.get("name")
        biz_currency = user.get("currency", "USD")

        if kind in ("pnl", "tax"):
            # Statement-style layout mirroring the in-app report cards.
            label_style = ParagraphStyle('rlabel', parent=styles['Normal'], fontSize=8, textColor=colors.HexColor("#64748b"))
            range_style = ParagraphStyle('rtitle', parent=styles['Heading1'], fontSize=20, textColor=colors.HexColor("#0f172a"), spaceBefore=2)
            story.append(Paragraph(f"<b>{EXPORT_TITLES[kind].upper()}</b> &middot; {biz_name}", label_style))
            story.append(Paragraph(f"{_fmt_date(start)} to {_fmt_date(end)}", range_style))
            story.append(Spacer(1, 10))
            if kind == "pnl":
                story.extend(_pnl_pdf_story(data, biz_currency))
            else:
                story.extend(_tax_pdf_story(data, biz_currency))
        else:
            money_cols = EXPORT_MONEY_COLUMNS.get(kind, [])
            currency_col = EXPORT_CURRENCY_COLUMN.get(kind)
            rows = [rows_iter[0]] if rows_iter else []
            for row in rows_iter[1:]:
                row_currency = row[currency_col] if currency_col is not None and row[currency_col] else biz_currency
                formatted = []
                for i, c in enumerate(row):
                    if i in money_cols and isinstance(c, (int, float)):
                        formatted.append(_fmt(c, row_currency))
                    else:
                        formatted.append("" if c is None else str(c))
                rows.append(formatted)

            title_style = ParagraphStyle('title2', parent=styles['Heading1'], fontSize=18, textColor=colors.HexColor("#0f172a"))
            subtitle_style = ParagraphStyle('sub2', parent=styles['Normal'], fontSize=9, textColor=colors.HexColor("#64748b"))
            story.append(Paragraph(EXPORT_TITLES.get(kind, kind.replace("_", " ").title()) + " Report", title_style))
            story.append(Paragraph(biz_name, subtitle_style))
            story.append(Spacer(1, 14))
            tbl = Table(rows, repeatRows=1)
            tbl.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor("#0f172a")),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                ('FONTSIZE', (0, 0), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
            ]))
            story.append(tbl)

        doc.build(story)
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/pdf",
                                 headers={"Content-Disposition": f'attachment; filename="{kind}.pdf"'})
    else:
        raise HTTPException(status_code=400, detail="Unknown format")


# ---- AI Insights ----
async def _check_and_bump_shared_quota(business_id: str):
    """Enforce a per-business daily cap when a business is riding on the
    shared/embedded Gemini key, so one heavy user can't exhaust the quota for
    everyone else using the same key."""
    today = now_utc().date().isoformat()
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "ai_shared_usage_date": 1, "ai_shared_usage_count": 1})
    count = (biz or {}).get("ai_shared_usage_count", 0) if (biz or {}).get("ai_shared_usage_date") == today else 0
    if count >= SHARED_AI_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail=(
            f"The shared AI quota ({SHARED_AI_DAILY_LIMIT}/day) has been used up for today. "
            "Try again tomorrow, or add your own free Gemini API key in Settings → Business → AI Insights for unlimited use."
        ))
    await db.businesses.update_one(
        {"business_id": business_id},
        {"$set": {"ai_shared_usage_date": today, "ai_shared_usage_count": count + 1}},
    )

async def _resolve_ai_key(user: dict) -> str:
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    own_key = (biz or {}).get("ai_api_key")
    api_key = own_key or GEMINI_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail=(
            "AI Insights isn't configured. Add a free Gemini API key in Settings → Business → AI Insights."
        ))
    if not own_key:
        await _check_and_bump_shared_quota(user["business_id"])
    return api_key

async def _business_context(user: dict) -> str:
    stats = await dashboard_report(user)
    return f"""Business Name: {user.get('business_name', user.get('name'))}
Currency: {user.get('currency', 'USD')}

Financial Summary:
- Total Income: {stats['totals']['income']}
- Total Expenses: {stats['totals']['expenses']}
- Net Profit: {stats['totals']['net']}
- Tax Collected: {stats['totals']['tax_collected']}
- Outstanding Invoices: {stats['totals']['invoices_outstanding']}
- Paid Invoices: {stats['totals']['invoices_paid']}
- Total Transactions: {stats['transactions_count']}

Monthly Trend (last periods): {stats['monthly']}
Income Categories: {stats['categories']['income']}
Expense Categories: {stats['categories']['expense']}
"""

@api_router.post("/insights/chat")
async def insights_chat(payload: ChatIn, user=Depends(get_current_user)):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    api_key = await _resolve_ai_key(user)

    conversation = None
    if payload.conversation_id:
        conversation = await db.ai_conversations.find_one(
            {"conversation_id": payload.conversation_id, "user_id": user["user_id"], "business_id": user["business_id"]},
            {"_id": 0},
        )
        if not conversation:
            raise HTTPException(status_code=404, detail="Conversation not found")

    history = conversation["messages"] if conversation else []
    # Fresh financial context every turn so answers reflect the current books.
    ctx = await _business_context(user)
    contents = [
        genai_types.Content(role="user" if m["role"] == "user" else "model", parts=[genai_types.Part(text=m["content"])])
        for m in history
    ]
    contents.append(genai_types.Content(role="user", parts=[genai_types.Part(text=message)]))

    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=contents,
            config=genai_types.GenerateContentConfig(
                system_instruction=(
                    "You are a senior financial analyst helping small-business owners understand their bookkeeping data. "
                    "Be direct, concrete, and cite specific numbers. Use plain markdown. Never invent numbers not provided. "
                    "Keep answers focused and conversational - structure with headings/bullets only when it genuinely helps.\n\n"
                    f"Current business data:\n{ctx}"
                ),
                max_output_tokens=2048,
            ),
        )
    except genai_errors.ClientError as e:
        # Gemini returns 400 (not 401/403) for an invalid/malformed API key.
        if e.code in (400, 401, 403) and "api key" in (e.message or "").lower():
            raise HTTPException(status_code=401, detail="Invalid Gemini API key. Update it in Settings → Business → AI Insights.")
        if e.code == 429:
            raise HTTPException(status_code=429, detail="Gemini API rate limit or quota exceeded. Please try again shortly.")
        logger.exception("Insight generation failed")
        raise HTTPException(status_code=503, detail=f"AI service error: {e.message}")
    except Exception:
        logger.exception("Insight generation failed")
        raise HTTPException(status_code=503, detail="AI service temporarily unavailable. Please try again shortly.")

    reply = response.text or ""
    now_iso = now_utc().isoformat()
    new_messages = [
        {"role": "user", "content": message, "at": now_iso},
        {"role": "assistant", "content": reply, "at": now_iso},
    ]
    if conversation:
        await db.ai_conversations.update_one(
            {"conversation_id": conversation["conversation_id"]},
            {"$push": {"messages": {"$each": new_messages}}, "$set": {"updated_at": now_iso}},
        )
        conversation_id = conversation["conversation_id"]
    else:
        conversation_id = str(uuid.uuid4())
        title = message if len(message) <= 60 else message[:57] + "..."
        await db.ai_conversations.insert_one({
            "conversation_id": conversation_id,
            "user_id": user["user_id"],
            "business_id": user["business_id"],
            "title": title,
            "messages": new_messages,
            "created_at": now_iso,
            "updated_at": now_iso,
        })
    return {"conversation_id": conversation_id, "reply": reply, "generated_at": now_iso}

@api_router.get("/insights/conversations")
async def list_conversations(user=Depends(get_current_user)):
    return await db.ai_conversations.find(
        {"user_id": user["user_id"], "business_id": user["business_id"]},
        {"_id": 0, "conversation_id": 1, "title": 1, "updated_at": 1},
    ).sort("updated_at", -1).to_list(100)

@api_router.get("/insights/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, user=Depends(get_current_user)):
    convo = await db.ai_conversations.find_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"], "business_id": user["business_id"]},
        {"_id": 0},
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return convo

@api_router.delete("/insights/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user=Depends(get_current_user)):
    res = await db.ai_conversations.delete_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"], "business_id": user["business_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


# ---- Startup ----
@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.businesses.create_index("business_id", unique=True)
    await db.invites.create_index("code", unique=True)
    await db.memberships.create_index([("user_id", 1), ("business_id", 1)], unique=True)
    await db.transactions.create_index([("business_id", 1), ("date", -1)])
    await db.invoices.create_index([("business_id", 1), ("issue_date", -1)])
    await db.employees.create_index([("business_id", 1)])
    await db.payroll_runs.create_index([("business_id", 1), ("period_end", -1)])
    await db.user_sessions.create_index("session_token")
    await db.ai_conversations.create_index([("user_id", 1), ("business_id", 1), ("updated_at", -1)])

    # Migrate any user without a membership row: convert their old flat
    # business_id/role (if present, from the earlier single-business model) into
    # a membership, or create a fresh business if they have neither. Idempotent -
    # once everyone has a membership this is a no-op on subsequent startups.
    users_without_membership = []
    async for u in db.users.find({}, {"_id": 0}):
        if not await db.memberships.find_one({"user_id": u["user_id"]}):
            users_without_membership.append(u)

    for u in users_without_membership:
        if u.get("business_id"):
            await _create_membership(u["user_id"], u["business_id"], u.get("role", "owner"))
        else:
            business = await _create_business(
                u.get("business_name") or u.get("name") or "My Business",
                u.get("currency", "USD"),
                u["user_id"],
            )
            await _create_membership(u["user_id"], business["business_id"], "owner")
            for coll in (db.transactions, db.invoices, db.employees, db.payroll_runs):
                await coll.update_many({"user_id": u["user_id"]}, {"$set": {"business_id": business["business_id"]}})
        await db.users.update_one({"user_id": u["user_id"]}, {"$unset": {"business_id": "", "role": ""}})

    if users_without_membership:
        logging.getLogger(__name__).info(f"Migrated {len(users_without_membership)} user(s) to the membership model")


@api_router.get("/")
async def root():
    return {"message": "Ledgerly API"}

app.include_router(api_router)

# CORS - allow specific origins (wildcard + credentials is rejected by browsers)
_frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[_frontend_url, "http://localhost:3000", "http://127.0.0.1:5050"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
