from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import json
import uuid
import string
import base64
import asyncio
import calendar
import logging
import secrets
import zipfile
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
import jwt
import httpx
import sentry_sdk
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_auth_requests
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

from groq import AsyncGroq, AuthenticationError as GroqAuthenticationError, RateLimitError as GroqRateLimitError, APIStatusError as GroqAPIStatusError
import openpyxl
from PIL import Image as PILImage
from reportlab.lib.pagesizes import LETTER
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pywebpush import webpush, WebPushException

# Re-registers the built-in Helvetica/Helvetica-Bold font names against a
# Unicode-coverage TTF (DejaVu Sans), instead of ReportLab's default base-14
# fonts which only support WinAnsi and render exotic currency symbols like
# GHS's ₵ or INR's ₹ as missing-glyph boxes. Every PDF style below already
# references "Helvetica"/"Helvetica-Bold" by name, so this swaps the glyphs
# everywhere without touching any of those call sites.
_FONTS_DIR = ROOT_DIR / "fonts"
pdfmetrics.registerFont(TTFont("Helvetica", str(_FONTS_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Helvetica-Bold", str(_FONTS_DIR / "DejaVuSans-Bold.ttf")))

# ---- Config ----
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
FIREBASE_PROJECT_ID = os.environ.get("FIREBASE_PROJECT_ID")
# Shared fallback key so AI Insights works out of the box for every business
# without each one needing their own Groq key. Businesses can still set their
# own key in Settings to bypass the shared daily cap below.
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
SHARED_AI_DAILY_LIMIT = 10
# Web Push - VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY are a matched keypair (raw
# base64url, not PEM) generated once for this deployment; push simply no-ops
# if they're unset (e.g. a fresh local checkout) rather than failing requests
# that happen to trigger a notification.
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:support@ledgerly.app")
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Error monitoring - no-ops locally if SENTRY_DSN isn't set, same as the
# VAPID keys above.
SENTRY_DSN = os.environ.get("SENTRY_DSN")
if SENTRY_DSN:
    sentry_sdk.init(dsn=SENTRY_DSN, send_default_pii=True)

# Separate from SENTRY_DSN (which only lets *this* process report errors) -
# an auth token so the admin panel can read errors back out via Sentry's API.
SENTRY_AUTH_TOKEN = os.environ.get("SENTRY_AUTH_TOKEN")
SENTRY_ORG_SLUG = os.environ.get("SENTRY_ORG_SLUG")

def _sentry_project_id() -> Optional[str]:
    # DSN shape: https://<public_key>@o<org_id>.ingest.<region>.sentry.io/<project_id>
    if not SENTRY_DSN:
        return None
    return SENTRY_DSN.rstrip("/").rsplit("/", 1)[-1]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# Render sits in front of the app as a reverse proxy, so the direct socket
# peer is always Render's edge, not the real client - X-Forwarded-For (which
# Render sets reliably) is what rate limiting needs to key on instead.
def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return get_remote_address(request)

limiter = Limiter(key_func=_client_ip)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---- Utilities ----
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": datetime.now(timezone.utc) + timedelta(days=30), "type": "access"}
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
    user["active_context"] = user.get("active_context", "business")
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
        user["onboarding_complete"] = biz.get("onboarding_complete", True)
        user["invoice_reminder_days"] = biz.get("invoice_reminder_days", DEFAULT_INVOICE_REMINDER_DAYS)
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


def _send_one_push(subscription: dict, payload: dict):
    """Runs in a worker thread (pywebpush's webpush() is a blocking call) -
    returns "expired" for a subscription the push service says is dead
    (410/404, e.g. the user uninstalled the PWA or cleared its storage) so
    the caller can clean it up, "ok" on success, or raises/returns "error"
    for anything else (transient failures aren't treated as reasons to
    delete a subscription)."""
    try:
        webpush(
            subscription_info={"endpoint": subscription["endpoint"], "keys": subscription["keys"]},
            data=json.dumps(payload),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": VAPID_SUBJECT},
        )
        return "ok"
    except WebPushException as e:
        status = e.response.status_code if e.response is not None else None
        if status in (404, 410):
            return "expired"
        logging.warning("Push send failed (status=%s): %s", status, e)
        return "error"

async def _push_to_business(business_id: str, title: str, message: str, link: Optional[str]):
    """Best-effort push to every subscribed device belonging to a member of
    this business - mirrors the in-app notification's own scope (any
    teammate can see it, so any teammate's subscribed devices get it too)."""
    if not (VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY):
        return
    member_ids = await db.memberships.find({"business_id": business_id}, {"_id": 0, "user_id": 1}).to_list(500)
    if not member_ids:
        return
    subs = await db.push_subscriptions.find(
        {"user_id": {"$in": [m["user_id"] for m in member_ids]}}, {"_id": 0}
    ).to_list(1000)
    if not subs:
        return
    payload = {"title": title, "message": message, "link": link}
    results = await asyncio.gather(
        *(asyncio.to_thread(_send_one_push, sub, payload) for sub in subs),
        return_exceptions=True,
    )
    expired_endpoints = [sub["endpoint"] for sub, result in zip(subs, results) if result == "expired"]
    if expired_endpoints:
        await db.push_subscriptions.delete_many({"endpoint": {"$in": expired_endpoints}})

async def _notify(business_id: str, type_: str, title: str, message: str = "", link: Optional[str] = None):
    """Records a business-scoped notification (shown in the app's bell menu)
    for a meaningful change or alert - not called for high-frequency actions
    like individual transactions, to keep the feed useful rather than noisy.
    Also best-effort pushes it to any subscribed devices for the business."""
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
    await _push_to_business(business_id, title, message, link)


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


# App-level admin access (not the per-business owner/admin role above) - a
# fixed allowlist of the developer's own accounts, for the internal /admin
# dashboard that lists every user across all businesses.
ADMIN_EMAILS = {"nanabanyinabbiw12@gmail.com", "n.abbiw10@gmail.com"}

async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("email") not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Not authorized")
    return user


# ---- Auth models ----
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
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

class AccountDeleteIn(BaseModel):
    password: Optional[str] = None

class BusinessUpdateIn(BaseModel):
    name: str
    currency: str = "USD"
    invoice_reminder_days: int = Field(default=7, ge=1, le=90)

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

class ContextSwitchIn(BaseModel):
    context: Literal["business", "personal"]


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
    receipt_image: Optional[str] = None  # base64, from POST /receipts/extract
    receipt_content_type: Optional[str] = None

class InvoiceItem(BaseModel):
    description: str
    quantity: float
    unit_price: float
    item_id: Optional[str] = None

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

class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys

class PushUnsubscribeIn(BaseModel):
    endpoint: str

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

class ConversationRenameIn(BaseModel):
    title: str


# ---- Business / invite helpers ----
async def _create_business(name: str, currency: str, owner_user_id: str, onboarding_complete: bool = True) -> dict:
    business_id = f"biz_{uuid.uuid4().hex[:12]}"
    doc = {
        "business_id": business_id,
        "name": name,
        "currency": currency,
        "owner_user_id": owner_user_id,
        "onboarding_complete": onboarding_complete,
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
@limiter.limit("10/hour")
async def register(request: Request, payload: RegisterIn, response: Response):
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
        business = await _create_business(
            payload.business_name or f"{payload.name}'s Business", payload.currency or "USD", user_id,
            onboarding_complete=False,
        )
        await _create_membership(user_id, business["business_id"], "owner")

    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=2592000, path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(user)

@api_router.post("/auth/login")
@limiter.limit("5/minute")
async def login(request: Request, payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash") or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["user_id"], email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=2592000, path="/")
    user.pop("_id", None)
    user.pop("password_hash", None)
    # Also returned in the body (in addition to the httpOnly cookie above) so
    # cross-origin clients like the mobile PWA - where third-party cookies are
    # unreliable on mobile Safari - can use it as a Bearer token instead.
    user_dict = await _enrich_user(user)
    return {**user_dict, "token": token}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/", secure=True, httponly=True, samesite="none")
    response.delete_cookie("session_token", path="/", secure=True, httponly=True, samesite="none")
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
        if existing.get("password_hash") and email not in ADMIN_EMAILS:
            # A password account isn't proof of email ownership, so a Google login
            # can't be silently merged into one — that would let anyone who
            # pre-registers a victim's email with a password of their own choosing
            # inherit whatever account the victim's real Google login lands on.
            # ADMIN_EMAILS is exempt: those accounts can only ever gain a
            # password_hash via the admin panel's own self-service "Set
            # password" (server-side gated on already being signed in as that
            # exact Google account), so there's no pre-registration risk to
            # guard against for them specifically.
            raise HTTPException(status_code=409, detail="This email is already registered with a password. Sign in with your password instead.")
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
        business = await _create_business(f"{name}'s Business", "USD", user_id, onboarding_complete=False)
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
        # google-auth's clock_skew_in_seconds defaults to 0, so any drift
        # between the client's clock and this server's rejects a freshly
        # issued token as "used too early" - 10s matches Firebase Admin SDK's
        # own tolerance for the same check.
        decoded = google_id_token.verify_firebase_token(
            payload.id_token, google_auth_requests.Request(), audience=FIREBASE_PROJECT_ID,
            clock_skew_in_seconds=10,
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Firebase token")
    email = decoded["email"].lower()
    name = decoded.get("name", email.split("@")[0])
    picture = decoded.get("picture", "")
    existing = await db.users.find_one({"email": email})
    if existing:
        if existing.get("password_hash") and email not in ADMIN_EMAILS:
            # See the matching guard (and its ADMIN_EMAILS exemption) in
            # google_session: a password account is not proof of email
            # ownership, so a Firebase login can't be silently merged into one.
            raise HTTPException(status_code=409, detail="This email is already registered with a password. Sign in with your password instead.")
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
        business = await _create_business(f"{name}'s Business", "USD", user_id, onboarding_complete=False)
        await _create_membership(user_id, business["business_id"], "owner")
    token = create_access_token(user_id, email)
    response.set_cookie("access_token", token, httponly=True, secure=True, samesite="none", max_age=2592000, path="/")
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    # Also returned in the body, same reason as /auth/login: the mobile PWA
    # uses this as a Bearer token instead of the cross-origin cookie.
    user_dict = await _enrich_user(user)
    return {**user_dict, "token": token}


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
    await db.businesses.update_one(
        {"business_id": user["business_id"]},
        {"$set": {"name": payload.name, "currency": payload.currency, "invoice_reminder_days": payload.invoice_reminder_days}},
    )
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    return _hide_ai_key(biz)

@api_router.post("/business/complete-onboarding")
async def complete_onboarding(user=Depends(require_role("owner", "admin"))):
    await db.businesses.update_one({"business_id": user["business_id"]}, {"$set": {"onboarding_complete": True}})
    return {"success": True}

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


# ---- Context switch (Business vs Personal) ----
# Purely presentational: picks which nav/layout the frontend renders. Every
# personal-* endpoint scopes strictly by user_id regardless of this value, so
# a stale or wrong active_context can never expose or hide the wrong data.
@api_router.post("/context/switch")
async def switch_context(payload: ContextSwitchIn, user=Depends(get_current_user)):
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"active_context": payload.context}})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0, "password_hash": 0})
    return await _enrich_user(updated)


# ---- Transactions ----
@api_router.get("/transactions")
async def list_transactions(has_receipt: Optional[bool] = None, user=Depends(get_current_user)):
    query = {"business_id": user["business_id"]}
    if has_receipt:
        query["receipt_image"] = {"$ne": None}
    cursor = db.transactions.find(query, {"_id": 0}).sort("date", -1)
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

DEFAULT_INVOICE_REMINDER_DAYS = 7

async def _check_overdue_invoices(business_id: str):
    """Runs opportunistically (see list_notifications) rather than on a
    schedule, since this deployment has no background job runner. Two things
    happen: any "sent" invoice whose due date has passed flips to "overdue"
    (that transition was previously only ever made manually), and any invoice
    that's been overdue for at least the business's configured reminder
    window gets a notification - repeated every window's worth of days so it
    keeps nagging rather than firing once and going silent."""
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "invoice_reminder_days": 1})
    reminder_days = (biz or {}).get("invoice_reminder_days") or DEFAULT_INVOICE_REMINDER_DAYS
    today = now_utc().date()

    sent_invoices = await db.invoices.find({"business_id": business_id, "status": "sent"}, {"_id": 0}).to_list(1000)
    for inv in sent_invoices:
        due = datetime.fromisoformat(inv["due_date"]).date()
        if due < today:
            await db.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "overdue"}})
            await _notify(
                business_id, "invoice_overdue", f"Invoice {inv.get('invoice_number', '')} is now overdue",
                f"{inv.get('client_name', '')} — due {_fmt_date(inv['due_date'])}", link="/invoices",
            )

    overdue_invoices = await db.invoices.find({"business_id": business_id, "status": "overdue"}, {"_id": 0}).to_list(1000)
    for inv in overdue_invoices:
        due = datetime.fromisoformat(inv["due_date"]).date()
        days_overdue = (today - due).days
        if days_overdue < reminder_days:
            continue
        last_reminder = inv.get("last_reminder_sent_at")
        should_remind = not last_reminder or (now_utc() - datetime.fromisoformat(last_reminder)).days >= reminder_days
        if should_remind:
            await db.invoices.update_one({"id": inv["id"]}, {"$set": {"last_reminder_sent_at": now_utc().isoformat()}})
            await _notify(
                business_id, "invoice_overdue_reminder", f"Reminder: Invoice {inv.get('invoice_number', '')} is {days_overdue} days overdue",
                f"{inv.get('client_name', '')} — {_fmt(inv['total'], inv.get('currency', 'USD'))} outstanding", link="/invoices",
            )

INVOICE_COMMITTED_STATUSES = ("sent", "paid", "overdue")

async def _adjust_invoice_inventory(business_id: str, invoice: dict, direction: int):
    """Applies invoice line items to inventory stock: direction=-1 deducts stock
    (invoice became sent/paid/overdue), direction=+1 restores it (invoice reverted
    to draft, its items changed, or it was deleted). Only line items linked to an
    inventory item via item_id are affected."""
    for it in invoice.get("items", []):
        item_id = it.get("item_id")
        if not item_id or not it.get("quantity"):
            continue
        inv_item = await db.inventory.find_one({"id": item_id, "business_id": business_id})
        if not inv_item:
            continue
        new_qty = max(0, inv_item["quantity"] + direction * it["quantity"])
        await db.inventory.update_one({"id": item_id, "business_id": business_id}, {"$set": {"quantity": new_qty}})
        if direction < 0:
            sold = inv_item["quantity"] - new_qty  # actual drop, accounting for the floor at 0
            if sold > 0:
                await _notify(
                    business_id, "inventory_sold", f"{inv_item['name']} stock decreased by {sold:g} {inv_item.get('unit', 'units')}",
                    f"Invoice {invoice.get('invoice_number', '')} — {new_qty:g} {inv_item.get('unit', 'units')} left", link="/inventory",
                )
            if new_qty <= inv_item.get("reorder_point", 0) and inv_item["quantity"] > inv_item.get("reorder_point", 0):
                await _notify(
                    business_id, "inventory_low", f"{inv_item['name']} is running low",
                    f"{new_qty:g} {inv_item.get('unit', 'units')} left", link="/inventory",
                )

async def _reconcile_invoice_inventory(business_id: str, invoice: dict, previous: Optional[dict] = None) -> bool:
    """Keeps inventory stock in sync with an invoice's status: deducts stock the
    moment an invoice becomes sent/paid/overdue, restores it if later reverted to
    draft or deleted, and re-applies the delta if a still-committed invoice's line
    items are edited. Returns the inventory_deducted flag to store on the invoice."""
    was_deducted = bool((previous or {}).get("inventory_deducted"))
    if was_deducted:
        await _adjust_invoice_inventory(business_id, previous, direction=1)

    now_committed = invoice.get("status") in INVOICE_COMMITTED_STATUSES
    if now_committed:
        await _adjust_invoice_inventory(business_id, invoice, direction=-1)
    return now_committed

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
    inv["inventory_deducted"] = await _reconcile_invoice_inventory(user["business_id"], inv)
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
    upd["invoice_number"] = existing.get("invoice_number")
    upd["inventory_deducted"] = await _reconcile_invoice_inventory(user["business_id"], upd, previous=existing)
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
    existing = await db.invoices.find_one({"id": inv_id, "business_id": user["business_id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")
    if existing.get("inventory_deducted"):
        await _adjust_invoice_inventory(user["business_id"], existing, direction=1)
    await db.invoices.delete_one({"id": inv_id, "business_id": user["business_id"]})
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
    await _check_overdue_invoices(user["business_id"])
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


# ---- Web push ----
@api_router.get("/push/vapid-public-key")
async def push_vapid_public_key():
    return {"key": VAPID_PUBLIC_KEY}

@api_router.post("/push/subscribe")
async def push_subscribe(payload: PushSubscriptionIn, user=Depends(get_current_user)):
    await db.push_subscriptions.update_one(
        {"endpoint": payload.endpoint},
        {"$set": {
            "id": str(uuid.uuid4()),
            "user_id": user["user_id"],
            "business_id": user["business_id"],
            "endpoint": payload.endpoint,
            "keys": {"p256dh": payload.keys.p256dh, "auth": payload.keys.auth},
            "created_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    return {"success": True}

@api_router.delete("/push/subscribe")
async def push_unsubscribe(payload: PushUnsubscribeIn, user=Depends(get_current_user)):
    await db.push_subscriptions.delete_one({"endpoint": payload.endpoint, "user_id": user["user_id"]})
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
async def dashboard_report(
    start: Optional[str] = Query(None, description="Scope Revenue/Expenses/Net Profit to this date (inclusive) onward"),
    end: Optional[str] = Query(None, description="Scope Revenue/Expenses/Net Profit through this date (inclusive)"),
    user=Depends(get_current_user),
):
    txs = await db.transactions.find({"business_id": user["business_id"]}, {"_id": 0}).to_list(5000)

    # Revenue/Expenses/Net Profit are flows, so they're scoped to the
    # optional date range. Outstanding is a current balance (invoices unpaid
    # right now) rather than a flow, so it's computed from all invoices below
    # regardless of this range - see dashboard_report's outstanding calc.
    ranged_txs = txs
    if start:
        ranged_txs = [t for t in ranged_txs if t.get("date", "") >= start]
    if end:
        ranged_txs = [t for t in ranged_txs if t.get("date", "") <= end]

    income = sum(t["amount"] for t in ranged_txs if t["type"] == "income")
    expenses = sum(t["amount"] for t in ranged_txs if t["type"] == "expense")
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

def _clients_rows(clients):
    yield ["Name", "Type", "Email", "Phone", "Address", "Notes"]
    for c in clients:
        yield [c.get("name"), c.get("type"), c.get("email", ""), c.get("phone", ""), c.get("address", ""), c.get("notes", "")]

def _employees_rows(emps):
    yield ["Name", "Email", "Position", "Salary", "Pay Frequency", "Tax Rate", "Currency"]
    for e in emps:
        yield [e.get("name"), e.get("email", ""), e.get("position", ""), e.get("salary"), e.get("pay_frequency"), e.get("tax_rate", 0), e.get("currency", "USD")]

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


# ---- Account export & deletion ----
@api_router.get("/account/export")
async def export_account_data(user=Depends(get_current_user)):
    """Bundles every record type for the caller's active business into one ZIP
    of CSVs - the same row-builders /export/{kind} uses, so the two stay in
    sync automatically as fields are added."""
    business_id = user["business_id"]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        def add_csv(name, rows_iter):
            csv_buf = io.StringIO()
            writer = csv.writer(csv_buf)
            for row in rows_iter:
                writer.writerow(row)
            zf.writestr(name, csv_buf.getvalue())

        txs = await db.transactions.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
        vendors = await db.clients.find({"business_id": business_id, "type": "vendor"}, {"_id": 0, "id": 1, "name": 1}).to_list(5000)
        vendor_names = {v["id"]: v["name"] for v in vendors}
        add_csv("transactions.csv", _txs_rows(txs, vendor_names))

        invs = await db.invoices.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
        add_csv("invoices.csv", _invoices_rows(invs))

        clients = await db.clients.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
        add_csv("clients.csv", _clients_rows(clients))

        inv_items = await db.inventory.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
        add_csv("inventory.csv", _inventory_rows(inv_items))

        emps = await db.employees.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
        add_csv("employees.csv", _employees_rows(emps))

        if user.get("role") in ("owner", "admin"):
            runs = await db.payroll_runs.find({"business_id": business_id}, {"_id": 0}).to_list(10000)
            add_csv("payroll.csv", _payroll_rows(runs))

    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
                              headers={"Content-Disposition": 'attachment; filename="ledgerly-export.zip"'})


async def _delete_user_and_data(user_id: str):
    """Wipe a user and everything scoped to them. Shared by the self-service
    /account delete and the admin panel's force-delete."""
    memberships = await db.memberships.find({"user_id": user_id}, {"_id": 0}).to_list(200)

    # An owner can only be deleted (taking their business down with them) if
    # they're the sole member - otherwise every other member would silently
    # lose access to shared business data with no warning.
    blocking_names = []
    for m in memberships:
        if m["role"] == "owner":
            other_members = await db.memberships.count_documents({"business_id": m["business_id"], "user_id": {"$ne": user_id}})
            if other_members > 0:
                biz = await db.businesses.find_one({"business_id": m["business_id"]}, {"_id": 0, "name": 1})
                blocking_names.append(biz["name"] if biz else m["business_id"])
    if blocking_names:
        raise HTTPException(
            status_code=409,
            detail=f"They're the owner of {', '.join(blocking_names)}, which still has other members. "
                   "Transfer ownership or remove all other members before deleting this account.",
        )

    for m in memberships:
        business_id = m["business_id"]
        if m["role"] == "owner":
            # Sole member of this business (guaranteed by the check above) - wipe it entirely.
            await db.transactions.delete_many({"business_id": business_id})
            await db.invoices.delete_many({"business_id": business_id})
            await db.clients.delete_many({"business_id": business_id})
            await db.inventory.delete_many({"business_id": business_id})
            await db.employees.delete_many({"business_id": business_id})
            await db.payroll_runs.delete_many({"business_id": business_id})
            await db.notifications.delete_many({"business_id": business_id})
            await db.ai_conversations.delete_many({"business_id": business_id})
            await db.invites.delete_many({"business_id": business_id})
            await db.memberships.delete_many({"business_id": business_id})
            await db.businesses.delete_one({"business_id": business_id})
        else:
            # Just leaving someone else's business - their data stays intact for the other members.
            await db.memberships.delete_one({"user_id": user_id, "business_id": business_id})

    await db.ai_conversations.delete_many({"user_id": user_id})
    await db.user_sessions.delete_many({"user_id": user_id})
    # Ledgerly Personal is user_id-scoped (not business-scoped), so it isn't
    # covered by the per-business wipe above and has to be cleared separately.
    await db.personal_transactions.delete_many({"user_id": user_id})
    await db.personal_budgets.delete_many({"user_id": user_id})
    await db.personal_bills.delete_many({"user_id": user_id})
    await db.personal_savings_goals.delete_many({"user_id": user_id})
    await db.personal_goal_contributions.delete_many({"user_id": user_id})
    await db.personal_ai_conversations.delete_many({"user_id": user_id})
    await db.personal_notifications.delete_many({"user_id": user_id})
    await db.push_subscriptions.delete_many({"user_id": user_id})
    await db.users.delete_one({"user_id": user_id})


@api_router.delete("/account")
async def delete_account(payload: AccountDeleteIn, response: Response, user=Depends(get_current_user)):
    user_id = user["user_id"]
    full_user = await db.users.find_one({"user_id": user_id})
    if full_user.get("password_hash"):
        if not payload.password or not verify_password(payload.password, full_user["password_hash"]):
            raise HTTPException(status_code=401, detail="Incorrect password")

    await _delete_user_and_data(user_id)

    response.delete_cookie("access_token", path="/", secure=True, httponly=True, samesite="none")
    response.delete_cookie("session_token", path="/", secure=True, httponly=True, samesite="none")
    return {"success": True}


# ---- AI Insights ----
async def _check_and_bump_shared_quota(business_id: str):
    """Enforce a per-business daily cap when a business is riding on the
    shared/embedded Groq key, so one heavy user can't exhaust the quota for
    everyone else using the same key."""
    today = now_utc().date().isoformat()
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "ai_shared_usage_date": 1, "ai_shared_usage_count": 1})
    count = (biz or {}).get("ai_shared_usage_count", 0) if (biz or {}).get("ai_shared_usage_date") == today else 0
    if count >= SHARED_AI_DAILY_LIMIT:
        raise HTTPException(status_code=429, detail=(
            f"The shared AI quota ({SHARED_AI_DAILY_LIMIT}/day) has been used up for today. "
            "Try again tomorrow, or add your own free Groq API key in Settings → Business → AI Insights for unlimited use."
        ))
    await db.businesses.update_one(
        {"business_id": business_id},
        {"$set": {"ai_shared_usage_date": today, "ai_shared_usage_count": count + 1}},
    )

async def _resolve_ai_key(user: dict) -> str:
    biz = await db.businesses.find_one({"business_id": user["business_id"]}, {"_id": 0})
    own_key = (biz or {}).get("ai_api_key")
    api_key = own_key or GROQ_API_KEY
    if not api_key:
        raise HTTPException(status_code=400, detail=(
            "AI Insights isn't configured. Add a free Groq API key in Settings → Business → AI Insights."
        ))
    if not own_key:
        await _check_and_bump_shared_quota(user["business_id"])
    return api_key

ALLOWED_RECEIPT_TYPES = {"image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"}
MAX_RECEIPT_BYTES = 8 * 1024 * 1024
RECEIPT_MAX_DIMENSION = 1600
RECEIPT_JPEG_QUALITY = 85

@api_router.post("/receipts/extract")
async def extract_receipt(file: UploadFile = File(...), user=Depends(get_current_user)):
    """Resizes/compresses an uploaded receipt photo and (once OCR is wired
    up) asks a vision model to pull structured fields out of it. Returns the
    compressed image alongside the extraction so the client can submit both
    together in one POST /transactions call - this endpoint never creates a
    transaction itself, it's just the preview step."""
    if file.content_type not in ALLOWED_RECEIPT_TYPES:
        raise HTTPException(status_code=400, detail="Receipt must be a PNG, JPEG, WEBP, or HEIC image")
    raw = await file.read()
    if len(raw) > MAX_RECEIPT_BYTES:
        raise HTTPException(status_code=400, detail="Receipt image must be smaller than 8MB")
    try:
        img = PILImage.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file")
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((RECEIPT_MAX_DIMENSION, RECEIPT_MAX_DIMENSION))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=RECEIPT_JPEG_QUALITY)
    encoded = base64.b64encode(out.getvalue()).decode()

    api_key = await _resolve_ai_key(user)
    client = AsyncGroq(api_key=api_key)
    prompt = (
        "Extract structured data from this receipt photo. Respond with ONLY a JSON object, no prose, "
        'matching this exact shape: {"vendor": string or null, "amount": number or null, "currency": '
        'string (ISO 4217 best guess, default "USD") or null, "date": string (YYYY-MM-DD best guess) or '
        'null, "category": string (a short free-text expense category like "Office Supplies" or "Meals") '
        'or null, "confidence": "high" or "medium" or "low", "notes": string (anything ambiguous, '
        'illegible, or missing - empty string if none)}. Use null for any field you can\'t determine '
        "from the image - never guess a value you can't support."
    )
    try:
        resp = await client.chat.completions.create(
            model="qwen/qwen3.6-27b",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}},
                ],
            }],
            max_completion_tokens=800,
            reasoning_effort="none",
            response_format={"type": "json_object"},
        )
        extracted = json.loads(resp.choices[0].message.content)
    except GroqAuthenticationError:
        raise HTTPException(status_code=400, detail="Invalid Groq API key. Update it in Settings → Business → AI Insights.")
    except GroqRateLimitError:
        raise HTTPException(status_code=429, detail="Groq API rate limit or quota exceeded. Please try again shortly.")
    except GroqAPIStatusError as e:
        logger.exception("Receipt extraction failed")
        raise HTTPException(status_code=502, detail=f"AI service error: {e.message}")
    except (json.JSONDecodeError, KeyError, IndexError, AttributeError):
        logger.exception("Receipt extraction returned unparseable output")
        extracted = {
            "vendor": None, "amount": None, "currency": user.get("currency", "USD"),
            "date": None, "category": None, "confidence": "low",
            "notes": "Couldn't read this receipt automatically - please fill in the details manually.",
        }

    return {
        "extracted": extracted,
        "receipt_image": encoded,
        "receipt_content_type": "image/jpeg",
    }

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
    messages = [{
        "role": "system",
        "content": (
            "You are a senior financial analyst helping small-business owners understand their bookkeeping data. "
            "Be direct, concrete, and cite specific numbers. Use plain markdown: paragraphs, **bold**, and bullet "
            "lists. Never use markdown tables (pipe/dash grid syntax) - the chat UI doesn't render them, so present "
            "any comparison or breakdown as a short bullet list or prose instead. Never invent numbers not provided. "
            "Keep answers focused and conversational - structure with headings/bullets only when it genuinely helps.\n\n"
            f"Current business data:\n{ctx}"
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
                # Keep hidden reasoning short so it can't eat the whole token budget
                # and leave the visible reply empty.
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
            logger.exception("Insight generation failed")
            yield sse({"type": "error", "message": f"AI service error: {e.message}"})
            return
        except Exception:
            logger.exception("Insight generation failed")
            yield sse({"type": "error", "message": "AI service temporarily unavailable. Please try again shortly."})
            return

        reply = "".join(reply_parts)
        new_messages = [
            {"role": "user", "content": message, "at": now_iso},
            {"role": "assistant", "content": reply, "at": now_iso},
        ]
        if conversation:
            await db.ai_conversations.update_one(
                {"conversation_id": conversation_id},
                {"$push": {"messages": {"$each": new_messages}}, "$set": {"updated_at": now_iso}},
            )
        else:
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
        yield sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

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

@api_router.put("/insights/conversations/{conversation_id}")
async def rename_conversation(conversation_id: str, payload: ConversationRenameIn, user=Depends(get_current_user)):
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    res = await db.ai_conversations.update_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"], "business_id": user["business_id"]},
        {"$set": {"title": title}},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}

@api_router.delete("/insights/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user=Depends(get_current_user)):
    res = await db.ai_conversations.delete_one(
        {"conversation_id": conversation_id, "user_id": user["user_id"], "business_id": user["business_id"]}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


# ---- Admin (internal, allowlisted developer accounts only) ----
class AdminUserUpdateIn(BaseModel):
    name: str = Field(min_length=1)
    email: Optional[EmailStr] = None

class AdminSetPasswordIn(BaseModel):
    password: str = Field(min_length=8)

class AdminTransferOwnershipIn(BaseModel):
    new_owner_user_id: str


async def _log_admin_action(admin: dict, action: str, target_type: str, target_id: str, target_label: Optional[str] = None, details: Optional[dict] = None):
    """Every state-changing admin endpoint records itself here - the admin
    panel has enough destructive power (delete accounts, reset passwords,
    transfer business ownership) that a "who did what, when" trail matters.
    Never log a plaintext credential in `details`."""
    await db.admin_audit_log.insert_one({
        "id": str(uuid.uuid4()),
        "timestamp": now_utc().isoformat(),
        "admin_email": admin["email"],
        "admin_name": admin.get("name"),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "target_label": target_label,
        "details": details or {},
    })


async def _last_active(user_id: str) -> Optional[str]:
    """Most recent created_at across everything this user has authored -
    business transactions/invoices plus Ledgerly Personal transactions - as a
    quick signal of whether an account is actually being used."""
    dates = []
    for coll in (db.transactions, db.invoices, db.personal_transactions):
        doc = await coll.find_one({"user_id": user_id}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        if doc and doc.get("created_at"):
            dates.append(doc["created_at"])
    return max(dates) if dates else None


@api_router.post("/admin/set-password")
async def admin_set_password(payload: AdminSetPasswordIn, admin=Depends(require_admin)):
    """Lets an admin (already authenticated via Google, since that's the only
    auth_provider ADMIN_EMAILS accounts have today) add a password to their
    own account, so /auth/login becomes a second way into the admin app -
    useful when Google sign-in isn't convenient (e.g. a shared machine)."""
    await db.users.update_one({"user_id": admin["user_id"]}, {"$set": {"password_hash": hash_password(payload.password)}})
    await _log_admin_action(admin, "set_own_password", "user", admin["user_id"], admin["email"])
    return {"success": True}


@api_router.get("/admin/users")
async def admin_list_users(admin=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(1000)
    business_ids = [u["active_business_id"] for u in users if u.get("active_business_id")]
    businesses = await db.businesses.find({"business_id": {"$in": business_ids}}, {"_id": 0}).to_list(1000)
    biz_by_id = {b["business_id"]: b for b in businesses}
    for u in users:
        biz = biz_by_id.get(u.get("active_business_id"))
        u["business_name"] = biz["name"] if biz else None
        u["last_active"] = await _last_active(u["user_id"])
    return {"total": len(users), "users": users}


@api_router.get("/admin/users/{target_user_id}")
async def admin_get_user(target_user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "password_hash": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    memberships = await db.memberships.find({"user_id": target_user_id}, {"_id": 0}).to_list(200)
    business_ids = [m["business_id"] for m in memberships]
    businesses = await db.businesses.find({"business_id": {"$in": business_ids}}, {"_id": 0}).to_list(200)
    biz_by_id = {b["business_id"]: b for b in businesses}
    memberships_out = [{**m, "business_name": biz_by_id.get(m["business_id"], {}).get("name")} for m in memberships]

    personal_counts = {
        "transactions": await db.personal_transactions.count_documents({"user_id": target_user_id}),
        "budgets": await db.personal_budgets.count_documents({"user_id": target_user_id}),
        "bills": await db.personal_bills.count_documents({"user_id": target_user_id}),
        "goals": await db.personal_savings_goals.count_documents({"user_id": target_user_id}),
    }
    active_sessions = await db.user_sessions.count_documents({"user_id": target_user_id})
    return {
        "user": target,
        "memberships": memberships_out,
        "personal_counts": personal_counts,
        "active_sessions": active_sessions,
        "last_active": await _last_active(target_user_id),
    }


@api_router.put("/admin/users/{target_user_id}")
async def admin_update_user(target_user_id: str, payload: AdminUserUpdateIn, admin=Depends(require_admin)):
    update = {"name": payload.name.strip()}
    if payload.email:
        email = payload.email.lower()
        existing = await db.users.find_one({"email": email, "user_id": {"$ne": target_user_id}})
        if existing:
            raise HTTPException(status_code=409, detail="That email is already in use by another account")
        update["email"] = email
    res = await db.users.update_one({"user_id": target_user_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1})
    await _log_admin_action(admin, "update_user", "user", target_user_id, target["email"], {"name": update["name"], "email": update.get("email")})
    return {"success": True}


@api_router.post("/admin/users/{target_user_id}/revoke-sessions")
async def admin_revoke_sessions(target_user_id: str, admin=Depends(require_admin)):
    res = await db.user_sessions.delete_many({"user_id": target_user_id})
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1})
    await _log_admin_action(admin, "revoke_sessions", "user", target_user_id, target["email"] if target else None, {"revoked": res.deleted_count})
    return {"revoked": res.deleted_count}


@api_router.post("/admin/users/{target_user_id}/reset-password")
async def admin_reset_password(target_user_id: str, admin=Depends(require_admin)):
    """Support tool for a locked-out user: generates a one-time temporary
    password and sets it on their account (works regardless of their normal
    auth_provider - Google accounts gain a password the same way "Set
    password" does for the admin's own account). Also revokes their existing
    sessions, since a lockout report is sometimes actually a compromised
    account. The plaintext password is returned once in this response and
    is not stored or logged anywhere - relay it to the user out of band."""
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0, "email": 1})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    temp_password = secrets.token_urlsafe(9)
    await db.users.update_one({"user_id": target_user_id}, {"$set": {"password_hash": hash_password(temp_password)}})
    await db.user_sessions.delete_many({"user_id": target_user_id})
    await _log_admin_action(admin, "reset_password", "user", target_user_id, target["email"])
    return {"temporary_password": temp_password}


@api_router.delete("/admin/users/{target_user_id}")
async def admin_delete_user(target_user_id: str, admin=Depends(require_admin)):
    target = await db.users.find_one({"user_id": target_user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target["email"] in ADMIN_EMAILS:
        raise HTTPException(status_code=400, detail="Refusing to delete an admin account from here")
    await _delete_user_and_data(target_user_id)
    await _log_admin_action(admin, "delete_user", "user", target_user_id, target["email"])
    return {"success": True}


@api_router.get("/admin/businesses")
async def admin_list_businesses(admin=Depends(require_admin)):
    businesses = await db.businesses.find({}, {"_id": 0, "ai_api_key": 0, "logo_data": 0}).sort("created_at", -1).to_list(1000)
    for b in businesses:
        bid = b["business_id"]
        b["member_count"] = await db.memberships.count_documents({"business_id": bid})
        b["transaction_count"] = await db.transactions.count_documents({"business_id": bid})
        b["invoice_count"] = await db.invoices.count_documents({"business_id": bid})
        owner_m = await db.memberships.find_one({"business_id": bid, "role": "owner"}, {"_id": 0})
        b["owner"] = await db.users.find_one({"user_id": owner_m["user_id"]}, {"_id": 0, "name": 1, "email": 1}) if owner_m else None
    return {"total": len(businesses), "businesses": businesses}


@api_router.get("/admin/businesses/{business_id}")
async def admin_get_business(business_id: str, admin=Depends(require_admin)):
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "ai_api_key": 0, "logo_data": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")

    memberships = await db.memberships.find({"business_id": business_id}, {"_id": 0}).to_list(200)
    user_ids = [m["user_id"] for m in memberships]
    users = await db.users.find({"user_id": {"$in": user_ids}}, {"_id": 0, "user_id": 1, "name": 1, "email": 1}).to_list(200)
    users_by_id = {u["user_id"]: u for u in users}
    members = [
        {**m, "name": users_by_id.get(m["user_id"], {}).get("name"), "email": users_by_id.get(m["user_id"], {}).get("email")}
        for m in memberships
    ]

    # Full detail (every field) rather than the trimmed set used elsewhere -
    # except the receipt image itself, which stays excluded (same reasoning
    # as the list endpoint: it's a multi-KB base64 blob nobody's viewing
    # here). has_receipt is derived from its presence instead.
    transactions = await db.transactions.find({"business_id": business_id}, {"_id": 0}).sort("date", -1).to_list(50)
    for t in transactions:
        t["has_receipt"] = bool(t.pop("receipt_image", None))
        t.pop("receipt_content_type", None)

    return {
        "business": biz,
        "members": members,
        "recent_transactions": transactions,
        "recent_invoices": await db.invoices.find({"business_id": business_id}, {"_id": 0}).sort("issue_date", -1).to_list(50),
        "inventory": await db.inventory.find({"business_id": business_id}, {"_id": 0}).to_list(200),
        "employees": await db.employees.find({"business_id": business_id}, {"_id": 0}).to_list(200),
        "invites": await db.invites.find({"business_id": business_id}, {"_id": 0}).sort("created_at", -1).to_list(200),
        "counts": {
            "transactions": await db.transactions.count_documents({"business_id": business_id}),
            "invoices": await db.invoices.count_documents({"business_id": business_id}),
        },
    }


@api_router.post("/admin/businesses/{business_id}/reset-ai-quota")
async def admin_reset_ai_quota(business_id: str, admin=Depends(require_admin)):
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "name": 1})
    if not biz:
        raise HTTPException(status_code=404, detail="Business not found")
    await db.businesses.update_one({"business_id": business_id}, {"$unset": {"ai_shared_usage_count": "", "ai_shared_usage_date": ""}})
    await _log_admin_action(admin, "reset_ai_quota", "business", business_id, biz["name"])
    return {"success": True}


@api_router.post("/admin/businesses/{business_id}/transfer-ownership")
async def admin_transfer_ownership(business_id: str, payload: AdminTransferOwnershipIn, admin=Depends(require_admin)):
    new_owner = await db.memberships.find_one({"business_id": business_id, "user_id": payload.new_owner_user_id})
    if not new_owner:
        raise HTTPException(status_code=404, detail="That user isn't a member of this business")
    if new_owner["role"] == "owner":
        return {"success": True}
    current_owner = await db.memberships.find_one({"business_id": business_id, "role": "owner"})
    if current_owner:
        await db.memberships.update_one({"membership_id": current_owner["membership_id"]}, {"$set": {"role": "admin"}})
    await db.memberships.update_one({"membership_id": new_owner["membership_id"]}, {"$set": {"role": "owner"}})
    biz = await db.businesses.find_one({"business_id": business_id}, {"_id": 0, "name": 1})
    new_owner_user = await db.users.find_one({"user_id": payload.new_owner_user_id}, {"_id": 0, "email": 1})
    await _log_admin_action(
        admin, "transfer_ownership", "business", business_id, biz["name"] if biz else None,
        {"new_owner_user_id": payload.new_owner_user_id, "new_owner_email": new_owner_user["email"] if new_owner_user else None},
    )
    return {"success": True}


@api_router.delete("/admin/invites/{code}")
async def admin_revoke_invite(code: str, admin=Depends(require_admin)):
    invite = await db.invites.find_one({"code": code.strip().upper()}, {"_id": 0})
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    await db.invites.delete_one({"code": code.strip().upper()})
    await _log_admin_action(admin, "revoke_invite", "invite", invite["code"], invite["code"], {"business_id": invite["business_id"], "role": invite["role"]})
    return {"success": True}


@api_router.get("/admin/analytics")
async def admin_analytics(admin=Depends(require_admin)):
    """Daily signup and platform-activity counts for the last 30 days, zero-
    filled so the frontend can render a bar chart without gap-handling."""
    window_start = (now_utc() - timedelta(days=29)).date()
    days = [(window_start + timedelta(days=i)).isoformat() for i in range(30)]

    def _bucket(dates):
        counts = {d: 0 for d in days}
        for iso in dates:
            day = iso[:10]
            if day in counts:
                counts[day] += 1
        return [counts[d] for d in days]

    users = await db.users.find({}, {"_id": 0, "created_at": 1}).to_list(10000)
    transactions = await db.transactions.find({}, {"_id": 0, "created_at": 1}).to_list(10000)
    invoices = await db.invoices.find({}, {"_id": 0, "created_at": 1}).to_list(10000)

    return {
        "days": days,
        "signups": _bucket(u["created_at"] for u in users if u.get("created_at")),
        "transactions": _bucket(t["created_at"] for t in transactions if t.get("created_at")),
        "invoices": _bucket(i["created_at"] for i in invoices if i.get("created_at")),
    }


@api_router.get("/admin/health")
async def admin_health(admin=Depends(require_admin)):
    today = now_utc().date().isoformat()

    sessions = await db.user_sessions.find({}, {"_id": 0, "expires_at": 1}).to_list(5000)
    now = now_utc()

    def _still_valid(expires_at) -> bool:
        if isinstance(expires_at, str):
            expires_at = datetime.fromisoformat(expires_at)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at > now

    active_sessions = sum(1 for s in sessions if _still_valid(s["expires_at"]))

    businesses_today = await db.businesses.find(
        {"ai_shared_usage_date": today}, {"_id": 0, "name": 1, "ai_shared_usage_count": 1}
    ).to_list(1000)
    ai_usage_today = sum(b.get("ai_shared_usage_count", 0) for b in businesses_today)
    businesses_at_ai_cap = [b["name"] for b in businesses_today if b.get("ai_shared_usage_count", 0) >= SHARED_AI_DAILY_LIMIT]

    return {
        "total_users": await db.users.count_documents({}),
        "total_businesses": await db.businesses.count_documents({}),
        "active_sessions": active_sessions,
        "total_sessions": len(sessions),
        "ai_shared_daily_limit": SHARED_AI_DAILY_LIMIT,
        "ai_shared_usage_today": ai_usage_today,
        "businesses_at_ai_cap_today": businesses_at_ai_cap,
        "push_subscriptions": await db.push_subscriptions.count_documents({}),
        "push_subscribed_users": len(await db.push_subscriptions.distinct("user_id")),
        "sentry_configured": bool(SENTRY_DSN),
        "sentry_api_configured": bool(SENTRY_AUTH_TOKEN and SENTRY_ORG_SLUG),
        "groq_shared_key_configured": bool(GROQ_API_KEY),
        "vapid_configured": bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY),
    }


@api_router.get("/admin/sentry/issues")
async def admin_sentry_issues(admin=Depends(require_admin)):
    if not (SENTRY_AUTH_TOKEN and SENTRY_ORG_SLUG):
        raise HTTPException(status_code=400, detail="Sentry API isn't configured (SENTRY_AUTH_TOKEN/SENTRY_ORG_SLUG)")
    project_id = _sentry_project_id()
    if not project_id:
        raise HTTPException(status_code=400, detail="SENTRY_DSN isn't configured")

    async with httpx.AsyncClient() as http_client:
        resp = await http_client.get(
            f"https://sentry.io/api/0/organizations/{SENTRY_ORG_SLUG}/issues/",
            headers={"Authorization": f"Bearer {SENTRY_AUTH_TOKEN}"},
            params={"project": project_id, "query": "is:unresolved", "statsPeriod": "14d", "sort": "freq", "limit": 25},
            timeout=10,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Sentry API error ({resp.status_code})")

    return [
        {
            "id": issue["id"],
            "title": issue.get("title"),
            "culprit": issue.get("culprit"),
            "level": issue.get("level"),
            "count": issue.get("count"),
            "user_count": issue.get("userCount"),
            "first_seen": issue.get("firstSeen"),
            "last_seen": issue.get("lastSeen"),
            "permalink": issue.get("permalink"),
        }
        for issue in resp.json()
    ]


@api_router.get("/admin/sentry-debug")
async def admin_sentry_debug(admin=Depends(require_admin)):
    """Captures a synthetic error so Sentry capture can be verified end-to-end.

    Reports the error explicitly and returns 200 rather than letting it
    propagate as an unhandled exception - Starlette's default error handler
    sends 500s from outside the CORS middleware, which the admin frontend
    (a different origin) can't read, so the button would always report
    failure even when Sentry received the event fine.
    """
    try:
        1 / 0
    except ZeroDivisionError:
        sentry_sdk.capture_exception()
    return {"sent": True}


@api_router.get("/admin/audit-log")
async def admin_audit_log(admin=Depends(require_admin)):
    entries = await db.admin_audit_log.find({}, {"_id": 0}).sort("timestamp", -1).to_list(200)
    return {"entries": entries}


class AdminBroadcastIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    message: str = Field(default="", max_length=1000)
    link: Optional[str] = None


@api_router.post("/admin/broadcast")
async def admin_broadcast(payload: AdminBroadcastIn, admin=Depends(require_admin)):
    """Platform-wide announcement - lands in every business's and every
    personal account's in-app notification bell (existing TYPE_ICON lookups
    in both frontends already fall back to a generic bell icon for an
    unrecognized type, so no frontend changes were needed), plus a best-
    effort push to any subscribed device. Push reach depends entirely on how
    many users have actually granted/subscribed - check System Health for
    that count before relying on it alone."""
    now = now_utc().isoformat()

    business_ids = [b["business_id"] for b in await db.businesses.find({}, {"_id": 0, "business_id": 1}).to_list(1000)]
    if business_ids:
        await db.notifications.insert_many([
            {"id": str(uuid.uuid4()), "business_id": bid, "type": "admin_broadcast",
             "title": payload.title, "message": payload.message, "link": payload.link,
             "read": False, "created_at": now}
            for bid in business_ids
        ])

    user_ids = [u["user_id"] for u in await db.users.find({}, {"_id": 0, "user_id": 1}).to_list(10000)]
    if user_ids:
        await db.personal_notifications.insert_many([
            {"id": str(uuid.uuid4()), "user_id": uid, "type": "admin_broadcast",
             "title": payload.title, "message": payload.message, "link": payload.link,
             "read": False, "created_at": now}
            for uid in user_ids
        ])

    push_sent = 0
    if VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY:
        subs = await db.push_subscriptions.find({}, {"_id": 0}).to_list(5000)
        if subs:
            push_payload = {"title": payload.title, "message": payload.message, "link": payload.link}
            results = await asyncio.gather(
                *(asyncio.to_thread(_send_one_push, sub, push_payload) for sub in subs), return_exceptions=True
            )
            push_sent = sum(1 for r in results if r == "ok")
            expired = [sub["endpoint"] for sub, r in zip(subs, results) if r == "expired"]
            if expired:
                await db.push_subscriptions.delete_many({"endpoint": {"$in": expired}})

    await _log_admin_action(
        admin, "broadcast", "platform", "all", payload.title,
        {"businesses_notified": len(business_ids), "users_notified": len(user_ids), "push_sent": push_sent},
    )
    return {"businesses_notified": len(business_ids), "users_notified": len(user_ids), "push_sent": push_sent}


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
    await db.admin_audit_log.create_index([("timestamp", -1)])

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

# Imported down here (not with the other imports at the top) because
# personal_router.py itself does `from server import db, get_current_user,
# now_utc` - by this point in module execution those names already exist on
# this (partially-initialized) module, so the circular import resolves fine.
from personal_router import personal_router
app.include_router(personal_router)

# CORS - allow specific origins (wildcard + credentials is rejected by browsers)
_frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
_mobile_url = os.environ.get("MOBILE_URL")
_pulse_url = os.environ.get("PULSE_URL")
_admin_url = os.environ.get("ADMIN_URL")
_cors_origins = [_frontend_url, "http://localhost:3000", "http://127.0.0.1:5050", "http://localhost:5173", "http://localhost:5174", "http://localhost:5175"]
if _mobile_url:
    _cors_origins.append(_mobile_url)
if _pulse_url:
    _cors_origins.append(_pulse_url)
if _admin_url:
    _cors_origins.append(_admin_url)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
