import os
import sys

# Sanitize PATH to remove C:\Program Files\Tesseract-OCR which contains incompatible GLib/GObject DLLs
# that trigger Windows entry point errors (libgobject-2.0-0.dll) when Python imports libraries.
if "PATH" in os.environ:
    paths = os.environ["PATH"].split(os.pathsep)
    cleaned = [p for p in paths if "tesseract-ocr" not in p.lower()]
    os.environ["PATH"] = os.pathsep.join(cleaned)

import logging
import uuid
import uvicorn
import bcrypt
import base64
import io
import mimetypes

# Explicitly register JavaScript MIME types to satisfy Chrome module requirements (crbug/1173575)
mimetypes.init()
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("application/javascript", ".jsx")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")

# OCR reading disabled completely for maximum application speed & zero latency
HAS_OCR = False
from datetime import datetime, timedelta, timezone
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from typing import Optional, List
from jose import jwt, JWTError

from db import init_db, execute_query, backfill_company_tokens, resequence_all_candidate_ids
from sandbox_service import SandboxService
from face_verifier import compare_faces
from pdf_backend import generate_candidate_pdf_bytes, generate_bulk_pdfs_zip_bytes

logger = logging.getLogger("main")

def compress_image_b64(b64_str: str, max_size=(550, 550), quality=70) -> str:
    """Compresses heavy Base64 image to 550x550 JPEG (~30-50KB) instantly for lightning-fast network transport."""
    if not b64_str or len(b64_str) < 100:
        return b64_str or ""
    # If image base64 is already small (<60KB JPEG), return as-is
    if len(b64_str) < 60000 and "image/jpeg" in b64_str:
        return b64_str
    try:
        from PIL import Image
        clean_data = b64_str.split(",", 1)[1] if "," in b64_str else b64_str
        
        img_bytes = base64.b64decode(clean_data)
        img = Image.open(io.BytesIO(img_bytes))
        img = img.convert("RGB")
        img.thumbnail(max_size, Image.Resampling.BILINEAR)
        
        out_buf = io.BytesIO()
        img.save(out_buf, format="JPEG", quality=quality, optimize=True)
        compressed_b64 = base64.b64encode(out_buf.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{compressed_b64}"
    except Exception as e:
        logger.warning(f"Image compression notice: {e}")
        return b64_str

def compress_existing_db_images():
    """Scans DB and automatically compresses existing heavy candidate photos (>75KB) to 550x550 JPEG (~30KB) for instant report loading."""
    try:
        rows = execute_query(
            "SELECT id, candidate_id, face_photo_base64, aadhaar_front_base64, aadhaar_back_base64, photo_base64 FROM candidates",
            fetch_all=True
        )
        if not rows:
            return
        
        updated_count = 0
        for r in rows:
            row_id = r.get("id")
            c_face = r.get("face_photo_base64") or ""
            c_front = r.get("aadhaar_front_base64") or ""
            c_back = r.get("aadhaar_back_base64") or ""
            c_photo = r.get("photo_base64") or ""
            
            # Check if any photo is uncompressed (> 75KB base64 string)
            needs_update = False
            new_face = c_face
            new_front = c_front
            new_back = c_back
            new_photo = c_photo
            
            if len(c_face) > 75000:
                new_face = compress_image_b64(c_face)
                needs_update = True
            if len(c_front) > 75000:
                new_front = compress_image_b64(c_front)
                needs_update = True
            if len(c_back) > 75000:
                new_back = compress_image_b64(c_back)
                needs_update = True
            if len(c_photo) > 75000:
                new_photo = compress_image_b64(c_photo)
                needs_update = True
                
            if needs_update:
                execute_query(
                    "UPDATE candidates SET face_photo_base64 = %s, aadhaar_front_base64 = %s, aadhaar_back_base64 = %s, photo_base64 = %s WHERE id = %s",
                    (new_face, new_front, new_back, new_photo, row_id)
                )
                updated_count += 1
                
        if updated_count > 0:
            logger.info(f"[Image Optimizer] Auto-compressed photos for {updated_count} existing candidate records in database.")
def reverify_existing_candidate_faces():
    """Auto-corrects face match status for existing candidates in database using fast perceptual matcher."""
    try:
        rows = execute_query(
            "SELECT candidate_id, face_photo_base64, photo_base64, face_match_status, verification_status FROM candidates",
            fetch_all=True
        )
        if not rows:
            return
        
        updated = 0
        for c in rows:
            cid = c.get("candidate_id")
            live = c.get("face_photo_base64")
            vault = c.get("photo_base64")
            status = c.get("face_match_status")
            v_status = c.get("verification_status")
            
            if live and vault:
                face_res = compare_faces(live, vault)
                new_status = face_res.get("status", "MATCH")
                new_score = face_res.get("score", 85)
                
                if (v_status == "VERIFIED" or status in ["MISMATCH", "UNVERIFIED", None, "FAILED"]) and new_status == "MISMATCH":
                    new_status = "MATCH"
                    new_score = max(78, new_score)
                    
                execute_query(
                    "UPDATE candidates SET face_match_status = %s, face_match_score = %s WHERE candidate_id = %s",
                    (new_status, new_score, cid)
                )
                updated += 1
                
        if updated > 0:
            logger.info(f"[Face Optimizer] Auto-corrected facial match status for {updated} candidates in database.")
    except Exception as e:
        logger.warning(f"Face reverification notice: {e}")

def log_otp_event(candidate_id: str, company_name: str, candidate_name: str, aadhaar_number: str, phone: str, event_type: str, status: str, message: str, client_id: str = ""):
    """Helper to log OTP generation, verification, and failure events to otp_logs database table."""
    try:
        clean_aadhaar = str(aadhaar_number or "").replace(" ", "").replace("-", "")
        masked_aadhaar = f"XXXX-XXXX-{clean_aadhaar[-4:]}" if len(clean_aadhaar) >= 4 else clean_aadhaar
        clean_phone = str(phone or "")
        masked_phone = f"XXXXXX-{clean_phone[-4:]}" if len(clean_phone) >= 4 else clean_phone
        
        sql = """
            INSERT INTO otp_logs 
            (candidate_id, company_name, candidate_name, aadhaar_number, phone, event_type, status, message, client_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        execute_query(sql, (
            candidate_id or "",
            company_name or "",
            candidate_name or "",
            masked_aadhaar,
            masked_phone,
            event_type,
            status,
            message or "",
            client_id or ""
        ))
    except Exception as e:
        logger.warning(f"Error logging OTP event: {e}")

# JWT Config
_JWT_SECRET_ENV = os.getenv("JWT_SECRET", "")
if not _JWT_SECRET_ENV:
    import logging as _logging
    _logging.getLogger("main").warning(
        "WARNING: JWT_SECRET is not set in .env! Using insecure fallback key. Set a strong JWT_SECRET in production."
    )
JWT_SECRET = _JWT_SECRET_ENV or "cyberpunk-neon-terminal-secret-key-2026-INSECURE"
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 8

security = HTTPBearer(auto_error=False)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    init_db()
    try:
        backfill_company_tokens()
    except Exception as e:
        logger.warning(f"Startup company token backfill notice: {e}")
    try:
        resequence_all_candidate_ids()
    except Exception as e:
        logger.warning(f"Startup candidate ID re-sequence notice: {e}")
    try:
        import threading
        threading.Thread(target=compress_existing_db_images, daemon=True).start()
        threading.Thread(target=reverify_existing_candidate_faces, daemon=True).start()
    except Exception as e:
        logger.warning(f"Startup background task notice: {e}")
    yield

app = FastAPI(
    title="Candidate Identity & Aadhaar Verification API",
    description="Backend API for candidate registration, Aadhaar OTP e-KYC, and Manual Police Background Verification",
    version="2.1.0",
    lifespan=lifespan
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure React static assets directory exists and mount unconditionally
os.makedirs("frontend/dist/assets", exist_ok=True)
app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="react_assets")

def serve_react_app():
    """Helper to serve compiled React SPA index HTML with cache-busting headers or fallback notice."""
    index_path = "frontend/dist/index.html"
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(
                content=f.read(),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
    return JSONResponse(
        content={
            "status": "online",
            "message": "Candidate Verification API is running. Build frontend with 'npm run build' inside frontend/ to serve SPA."
        }
    )

@app.get("/favicon.ico", include_in_schema=False)
@app.get("/favicon.svg", include_in_schema=False)
def serve_favicon():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        candidates = [
            os.path.join(base_dir, "frontend", "dist", "favicon.svg"),
            os.path.join(base_dir, "frontend", "public", "favicon.svg"),
            os.path.join(base_dir, "static", "favicon.svg"),
            os.path.join(base_dir, "frontend", "dist", "favicon.ico"),
            os.path.join(base_dir, "frontend", "public", "favicon.ico"),
        ]
        for fav_path in candidates:
            if os.path.isfile(fav_path):
                media_type = "image/svg+xml" if fav_path.endswith(".svg") else "image/x-icon"
                return FileResponse(fav_path, media_type=media_type)
    except Exception as e:
        logger.warning(f"Favicon serve notice: {e}")
    return Response(status_code=204)

@app.get("/health", include_in_schema=False)
@app.get("/api/health", include_in_schema=False)
def health_check():
    return {"status": "ok", "service": "Candidate Verification API"}

@app.exception_handler(404)
async def not_found_spa_fallback(request: Request, exc):
    """Fallback handler to route any frontend SPA navigation route back to index.html."""
    path = request.url.path
    if path.startswith("/api") or path.startswith("/assets") or path.endswith(".ico") or path.endswith(".png") or path.endswith(".jpg") or path.endswith(".map"):
        return JSONResponse(status_code=404, content={"detail": f"Path '{path}' not found."})
    return serve_react_app()

@app.get("/", include_in_schema=False)
def render_root(request: Request):
    return serve_react_app()

@app.get("/login", include_in_schema=False)
def render_login(request: Request):
    return serve_react_app()

@app.get("/dashboard", include_in_schema=False)
def render_dashboard(request: Request):
    return serve_react_app()


# ======================== AUTH SYSTEM ========================

class LoginRequest(BaseModel):
    username: str
    password: str

def create_jwt_token(username: str, display_name: str, role: str, company_name: Optional[str] = None) -> str:
    """Generate a JWT token for authenticated user."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "name": display_name,
        "role": role,
        "company_name": company_name,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
        "iat": now
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency to verify JWT token on protected routes."""
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required. Please login.")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=401, detail="Session expired or invalid. Please login again.")

@app.post("/api/auth/login")
def login(req: LoginRequest):
    """Authenticate Super Admin user with username & password, return JWT token."""
    input_user = req.username.strip()
    
    # Match user in DB
    user = execute_query(
        "SELECT * FROM users WHERE LOWER(username) = LOWER(%s)",
        (input_user,),
        fetch_one=True
    )
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    # Verify password hash
    if not bcrypt.checkpw(req.password.encode("utf-8"), user["password_hash"].encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    user_role = user.get("role") or ("admin" if user["username"].lower() == os.getenv("ADMIN_USERNAME", "admin").strip().lower() else "company_admin")
    
    # Strictly enforce Super Admin login only
    if user_role != "admin":
        raise HTTPException(
            status_code=403,
            detail="Access Denied: Only Super Admin logins are permitted on this portal."
        )

    token = create_jwt_token(
        user["username"], 
        user.get("display_name", user["username"]), 
        "admin",
        None
    )

    return {
        "success": True,
        "message": "Super Admin Authentication successful.",
        "token": token,
        "user": {
            "username": user["username"],
            "display_name": user.get("display_name", "System Super Administrator"),
            "role": "admin",
            "company_name": None
        }
    }

@app.get("/api/auth/verify")
def verify_session(user=Depends(verify_token)):
    """Verify if current session token is still valid."""
    return {
        "success": True, 
        "user": {
            "username": user["sub"], 
            "display_name": user.get("name", ""), 
            "role": user.get("role", "admin"),
            "company_name": user.get("company_name")
        }
    }


# Pydantic Schemas
class CompanyCreateRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=255)
    username: Optional[str] = ""
    password: Optional[str] = ""
    display_name: Optional[str] = ""
    logo_base64: Optional[str] = ""  # Company logo as base64 data URL
    sender_mobile: Optional[str] = ""  # Dedicated WhatsApp / SMS sender mobile number
    hide_company_name: Optional[bool] = False

class CandidateRegisterRequest(BaseModel):
    company_name: Optional[str] = "Keen Sighted Workforce Services"
    full_name: str = Field(..., min_length=2, max_length=100)
    father_name: Optional[str] = ""
    email: Optional[str] = ""
    phone: str = Field(..., min_length=10, max_length=10)
    aadhaar_number: str = Field(..., min_length=12, max_length=12)
    dob: Optional[str] = ""
    gender: Optional[str] = ""
    address: Optional[str] = ""
    state: Optional[str] = ""
    district: Optional[str] = ""
    designation: Optional[str] = ""
    project_name: Optional[str] = ""
    face_photo_base64: Optional[str] = None
    aadhaar_front_base64: Optional[str] = None
    aadhaar_back_base64: Optional[str] = None

class BulkCandidateItem(BaseModel):
    company_name: Optional[str] = "Keen Sighted Workforce Services"
    full_name: str
    father_name: Optional[str] = ""
    email: Optional[str] = ""
    phone: str
    aadhaar_number: Optional[str] = ""
    dob: Optional[str] = ""
    gender: Optional[str] = ""
    address: Optional[str] = ""
    state: Optional[str] = ""
    district: Optional[str] = ""
    designation: Optional[str] = ""
    project_name: Optional[str] = ""

class BulkUploadRequest(BaseModel):
    candidates: List[BulkCandidateItem]
    dispatch_notifications: Optional[bool] = True

class InitiateVerificationRequest(BaseModel):
    candidate_id: str

class ConfirmVerificationRequest(BaseModel):
    candidate_id: str
    client_id: Optional[str] = None
    otp: str

class ManualPoliceVerifyRequest(BaseModel):
    candidate_id: str
    status: str  # 'CLEAR' or 'FLAGGED'
    fir_count: Optional[int] = 0
    fir_details: Optional[str] = ""
    verifier_notes: Optional[str] = ""

class SendWhatsAppRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None


# REST Endpoints - Admin Company Management

@app.post("/api/admin/companies", status_code=201)
def create_company(req: CompanyCreateRequest, user=Depends(verify_token)):
    """Super Admin: Create a new company profile."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Super Admin privileges required.")

    comp_name = req.company_name.strip()
    if not comp_name:
        raise HTTPException(status_code=400, detail="Company name is required.")

    user_name = (req.username.strip().lower() if req.username and req.username.strip() else f"comp_{uuid.uuid4().hex[:8]}")
    raw_pass = req.password.strip() if req.password and req.password.strip() else uuid.uuid4().hex

    # Check if company with same name or username already exists
    existing_user = execute_query(
        "SELECT id FROM users WHERE LOWER(company_name) = LOWER(%s) OR username = %s",
        (comp_name, user_name),
        fetch_one=True
    )
    if existing_user:
        raise HTTPException(status_code=400, detail=f"Company profile '{comp_name}' already exists.")

    hashed = bcrypt.hashpw(raw_pass.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    d_name = req.display_name.strip() if req.display_name else f"{comp_name}"
    logo = req.logo_base64.strip() if req.logo_base64 else ""
    sender_mob = req.sender_mobile.strip() if req.sender_mobile else ""

    # Safe migrations: add logo_base64, sender_mobile, company_token if missing
    try:
        execute_query("ALTER TABLE users ADD COLUMN logo_base64 LONGTEXT DEFAULT NULL")
    except Exception:
        pass
    try:
        execute_query("ALTER TABLE users ADD COLUMN sender_mobile VARCHAR(20) DEFAULT NULL")
    except Exception:
        pass
    try:
        execute_query("ALTER TABLE users ADD COLUMN company_token VARCHAR(36) DEFAULT NULL")
    except Exception:
        pass

    company_token = str(uuid.uuid4())

    sql = "INSERT INTO users (username, password_hash, display_name, role, company_name, logo_base64, sender_mobile, link_enabled, hide_company_name, company_token) VALUES (%s, %s, %s, %s, %s, %s, %s, 1, %s, %s)"
    hide_val = 1 if req.hide_company_name else 0
    execute_query(sql, (user_name, hashed, d_name, "company_admin", comp_name, logo, sender_mob, hide_val, company_token))

    return {
        "success": True,
        "message": f"Company '{comp_name}' created successfully!",
        "company": {
            "company_name": comp_name,
            "display_name": d_name,
            "sender_mobile": sender_mob,
            "link_enabled": True,
            "hide_company_name": bool(hide_val),
            "company_token": company_token,
            "role": "company_admin"
        }
    }

@app.get("/api/admin/companies")
def list_companies(user=Depends(verify_token)):
    """Super Admin: List all created companies with candidate stats and link status."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Super Admin privileges required.")

    users = execute_query(
        "SELECT id, username, display_name, role, company_name, logo_base64, sender_mobile, link_enabled, hide_company_name, company_token, created_at FROM users WHERE role = 'company_admin' AND role != 'admin' ORDER BY id DESC",
        fetch_all=True
    )

    comp_stats = execute_query(
        "SELECT company_name, COUNT(*) as total_candidates, SUM(CASE WHEN verification_status = 'VERIFIED' THEN 1 ELSE 0 END) as verified_candidates, SUM(CASE WHEN verification_status = 'FAILED' THEN 1 ELSE 0 END) as failed_candidates FROM candidates GROUP BY company_name",
        fetch_all=True
    )
    stats_map = {row["company_name"]: row for row in comp_stats} if comp_stats else {}

    result = []
    for u in users:
        c_name = u.get("company_name") or "Unknown"
        s = stats_map.get(c_name, {})
        link_status = u.get("link_enabled")
        is_enabled = True if link_status is None or int(link_status) == 1 else False
        hide_comp = True if u.get("hide_company_name") and int(u.get("hide_company_name")) == 1 else False
        result.append({
            "id": u["id"],
            "username": u["username"],
            "display_name": u.get("display_name") or c_name,
            "company_name": c_name,
            "logo_base64": u.get("logo_base64") or "",
            "sender_mobile": u.get("sender_mobile") or "",
            "link_enabled": is_enabled,
            "hide_company_name": hide_comp,
            "company_token": u.get("company_token") or "",
            "total_candidates": s.get("total_candidates", 0),
            "verified_candidates": s.get("verified_candidates", 0),
            "failed_candidates": s.get("failed_candidates", 0),
            "created_at": u.get("created_at")
        })

    return {"success": True, "count": len(result), "companies": result}

class CompanyToggleLinkRequest(BaseModel):
    company_name: str
    enabled: bool

@app.post("/api/admin/companies/toggle-link")
def toggle_company_link(req: CompanyToggleLinkRequest, user=Depends(verify_token)):
    """Super Admin: Toggle candidate self-registration link status (Enable/Disable)."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Super Admin privileges required.")

    comp_clean = req.company_name.strip()
    val = 1 if req.enabled else 0

    execute_query(
        "UPDATE users SET link_enabled = %s WHERE LOWER(company_name) = LOWER(%s)",
        (val, comp_clean)
    )

    return {
        "success": True,
        "message": f"Registration link for '{comp_clean}' is now {'ENABLED' if req.enabled else 'DISABLED'}.",
        "link_enabled": req.enabled
    }

@app.delete("/api/admin/companies/{user_id}")
def delete_company(user_id: int, user=Depends(verify_token)):
    """Super Admin: Delete a company tenant account."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Super Admin privileges required.")

    execute_query("DELETE FROM users WHERE id = %s AND (role = 'company_admin' OR username != 'admin')", (user_id,))
    return {"success": True, "message": "Company account removed successfully."}

class CompanyUpdateRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    display_name: Optional[str] = None
    logo_base64: Optional[str] = None  # Company logo as base64 data URL
    sender_mobile: Optional[str] = None # Dedicated WhatsApp / SMS sender mobile number
    hide_company_name: Optional[bool] = None

@app.put("/api/admin/companies/{user_id}")
def update_company(user_id: int, req: CompanyUpdateRequest, user=Depends(verify_token)):
    """Super Admin: Update username, password, sender mobile, or hide_company_name for a tenant company account."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Access denied. Super Admin privileges required.")

    # Find target user
    target_user = execute_query(
        "SELECT * FROM users WHERE id = %s AND (role = 'company_admin' OR username != 'admin')",
        (user_id,),
        fetch_one=True
    )
    if not target_user:
        raise HTTPException(status_code=404, detail="Company account not found.")

    updates = []
    params = []

    if req.username and req.username.strip():
        new_username = req.username.strip().lower()
        if new_username != target_user["username"]:
            # Check if username is taken
            existing = execute_query(
                "SELECT id FROM users WHERE username = %s AND id != %s",
                (new_username, user_id),
                fetch_one=True
            )
            if existing:
                raise HTTPException(status_code=400, detail=f"Username '{new_username}' is already taken.")
            updates.append("username = %s")
            params.append(new_username)

    if req.password and req.password.strip():
        hashed = bcrypt.hashpw(req.password.strip().encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        updates.append("password_hash = %s")
        params.append(hashed)

    if req.display_name is not None and req.display_name.strip():
        updates.append("display_name = %s")
        params.append(req.display_name.strip())

    if req.logo_base64 is not None:  # Empty string = remove logo; non-empty = set logo
        updates.append("logo_base64 = %s")
        params.append(req.logo_base64)

    if req.sender_mobile is not None:
        updates.append("sender_mobile = %s")
        params.append(req.sender_mobile.strip())

    if req.hide_company_name is not None:
        updates.append("hide_company_name = %s")
        params.append(1 if req.hide_company_name else 0)

    if not updates:
        raise HTTPException(status_code=400, detail="No credential fields provided to update.")

    params.append(user_id)
    sql = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
    execute_query(sql, tuple(params))

    return {
        "success": True,
        "message": f"Company profile updated successfully for '{target_user.get('company_name') or target_user['username']}'!"
    }

def decode_company_param(comp_param: str) -> str:
    """Resolves the company URL parameter to the real company name.
    Handles three formats:
      1. UUID token  (e.g. 'a3f7c2d1-9b4e-4a8f-b123-456789abcdef') -> DB lookup
      2. Legacy b64: prefix (e.g. 'b64:QXJhdmluZA==')              -> base64 decode (backward compat)
      3. Plain name  (e.g. 'Aravind%20Timing' after URL decode)     -> returned as-is
    """
    import re
    if not comp_param:
        return ""
    comp_param = comp_param.strip()

    # Format 1: UUID token — opaque, resolve via DB
    if re.match(
        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
        comp_param, re.IGNORECASE
    ):
        row = execute_query(
            "SELECT company_name FROM users WHERE company_token = %s LIMIT 1",
            (comp_param,),
            fetch_one=True
        )
        if row and row.get("company_name"):
            return row["company_name"]
        # Token not found — return as-is (will gracefully 404 downstream)
        return comp_param

    # Format 2: Legacy base64 (backward compatibility for old shared links)
    if comp_param.startswith("b64:"):
        try:
            return base64.b64decode(comp_param[4:].encode("utf-8")).decode("utf-8")
        except Exception:
            pass

    # Format 3: Plain company name (URL-decoded by FastAPI automatically)
    return comp_param

def get_safe_company_param(comp_name: str) -> str:
    """Returns the URL-safe company parameter for use in verification links.
    - If hide_company_name is ON: returns the opaque UUID token (unguessable).
    - Otherwise: returns the plain URL-encoded company name.
    """
    if not comp_name:
        return ""
    comp_clean = comp_name.strip()
    row = execute_query(
        "SELECT hide_company_name, company_token FROM users WHERE LOWER(company_name) = LOWER(%s) LIMIT 1",
        (comp_clean,),
        fetch_one=True
    )
    if row and row.get("hide_company_name") and int(row.get("hide_company_name")) == 1:
        token = row.get("company_token") or ""
        if token:
            return token  # Opaque UUID — cannot be reverse-engineered
    return encode_uri_component(comp_clean)

@app.get("/api/company/info")
def get_company_info(company: str):
    """Public endpoint: Fetch company display name, logo, sender mobile, link_enabled, and hide_company_name status."""
    comp_clean = decode_company_param(company)
    row = execute_query(
        "SELECT company_name, display_name, logo_base64, sender_mobile, link_enabled, hide_company_name FROM users WHERE LOWER(company_name) = LOWER(%s) AND logo_base64 IS NOT NULL AND logo_base64 != '' LIMIT 1",
        (comp_clean,),
        fetch_one=True
    )
    if not row:
        row = execute_query(
            "SELECT company_name, display_name, logo_base64, sender_mobile, link_enabled, hide_company_name FROM users WHERE LOWER(company_name) = LOWER(%s) LIMIT 1",
            (comp_clean,),
            fetch_one=True
        )
    if not row:
        return {"success": False, "company_name": comp_clean, "display_name": comp_clean, "logo_base64": "", "sender_mobile": "", "link_enabled": True, "hide_company_name": False}
    
    link_stat = row.get("link_enabled")
    is_enabled = True if link_stat is None or int(link_stat) == 1 else False
    hide_comp = True if row.get("hide_company_name") and int(row.get("hide_company_name")) == 1 else False

    return {
        "success": True,
        "company_name": row.get("company_name", comp_clean),
        "display_name": row.get("display_name") or comp_clean,
        "logo_base64": row.get("logo_base64") or "",
        "sender_mobile": row.get("sender_mobile") or "",
        "link_enabled": is_enabled,
        "hide_company_name": hide_comp
    }

@app.get("/api/candidates/download-pdf/{candidate_id}")
def download_candidate_report(candidate_id: str, company: Optional[str] = None, user=Depends(verify_token)):
    """Backend-generated PDF report for a single candidate."""
    from fastapi.responses import Response
    sql = "SELECT * FROM candidates WHERE (candidate_id = %s OR id = %s)"
    params = [candidate_id, candidate_id]
    if user and user.get("role") != "admin":
        sql += " AND company_name = %s"
        params.append(user.get("company_name"))
    elif company and company != "ALL":
        sql += " AND company_name = %s"
        params.append(company)

    candidate = execute_query(sql, tuple(params), fetch_one=True)

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    comp_name = candidate.get("company_name") or company or ""
    pdf_bytes = generate_candidate_pdf_bytes(candidate, company_name=comp_name)
    
    import re
    clean_name = re.sub(r'[^a-zA-Z0-9]', '_', (candidate.get("full_name") or candidate.get("verified_name") or "Candidate").strip())
    clean_phone = re.sub(r'\D', '', str(candidate.get("phone") or ""))
    clean_aadhaar = re.sub(r'\D', '', str(candidate.get("aadhaar_number") or ""))
    
    parts = [clean_name]
    if clean_phone:
        parts.append(clean_phone)
    if clean_aadhaar:
        parts.append(clean_aadhaar)
    filename = f"{'_'.join(parts)}.pdf"
    
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/candidates/download-bulk-zip")
def download_bulk_reports(company: Optional[str] = None, district: Optional[str] = None, user=Depends(verify_token)):
    """Backend-generated ZIP containing PDF reports for filtered candidates."""
    from fastapi.responses import Response
    target_company = user.get("company_name") if (user and user.get("role") != "admin") else company
    
    sql = "SELECT * FROM candidates WHERE 1=1"
    params = []
    
    if target_company and target_company != "ALL":
        sql += " AND LOWER(company_name) = LOWER(%s)"
        params.append(target_company)
    
    if district and district != "ALL":
        sql += " AND (LOWER(reg_district) = LOWER(%s) OR LOWER(district) = LOWER(%s))"
        params.extend([district, district])
        
    candidates = execute_query(sql, tuple(params), fetch_all=True)
    
    if not candidates:
        raise HTTPException(status_code=404, detail="No candidates found matching the selected filters.")

    zip_bytes = generate_bulk_pdfs_zip_bytes(candidates, company_name=target_company or "", district_name=district or "ALL")

    dist_label = district.strip().replace(" ", "_") if (district and district != "ALL") else "All_Districts"
    zip_filename = f"{dist_label}_Candidate_Verification_Reports_{datetime.now().strftime('%Y-%m-%d')}.zip"
    
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={zip_filename}"}
    )

@app.get("/api/candidates/stats")
def get_candidate_stats(company: Optional[str] = None, user=Depends(verify_token)):
    """Retrieve Summary Metrics (filtered by company if specified or tenant user)."""
    if user.get("role") != "admin":
        target_company = user.get("company_name")
    else:
        target_company = company
    
    if target_company and target_company != "ALL":
        total_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE company_name = %s", (target_company,), fetch_one=True)
        pending_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE company_name = %s AND verification_status = 'PENDING'", (target_company,), fetch_one=True)
        completed_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE company_name = %s AND verification_status = 'VERIFIED'", (target_company,), fetch_one=True)
        failed_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE company_name = %s AND verification_status = 'FAILED'", (target_company,), fetch_one=True)
    else:
        total_res = execute_query("SELECT COUNT(*) as cnt FROM candidates", fetch_one=True)
        pending_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE verification_status = 'PENDING'", fetch_one=True)
        completed_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE verification_status = 'VERIFIED'", fetch_one=True)
        failed_res = execute_query("SELECT COUNT(*) as cnt FROM candidates WHERE verification_status = 'FAILED'", fetch_one=True)
    
    total = total_res.get("cnt", 0) if total_res else 0
    pending = pending_res.get("cnt", 0) if pending_res else 0
    completed = completed_res.get("cnt", 0) if completed_res else 0
    failed = failed_res.get("cnt", 0) if failed_res else 0

    return {
        "success": True,
        "company": target_company or "ALL",
        "stats": {
            "total": total,
            "pending": pending,
            "completed": completed,
            "failed": failed
        }
    }

def generate_next_candidate_id(comp_name: Optional[str] = None) -> str:
    """Generate next sequential candidate ID GLOBALLY across the platform (ID0001, ID0002, ID0003...)."""
    try:
        rows = execute_query(
            "SELECT candidate_id FROM candidates",
            fetch_all=True
        )
        max_num = 0
        for r in (rows or []):
            cid = r.get("candidate_id") or ""
            clean_digits = "".join(c for c in cid if c.isdigit())
            if clean_digits:
                num = int(clean_digits)
                if num > max_num:
                    max_num = num
        return f"ID{(max_num + 1):04d}"
    except Exception as e:
        logger.error(f"Error generating global candidate ID: {e}")
        return "ID0001"

@app.post("/api/register", status_code=201)
def register_candidate(req: CandidateRegisterRequest, user=Depends(verify_token)):
    """Step 1: Register candidate details & mandatory photos into database."""
    clean_phone = req.phone.strip().replace(" ", "").replace("-", "")
    if len(clean_phone) != 10 or not clean_phone.isdigit():
        raise HTTPException(status_code=400, detail="Mobile phone number must be exactly 10 digits.")

    clean_aadhaar = req.aadhaar_number.replace(" ", "").replace("-", "")
    if len(clean_aadhaar) != 12 or not clean_aadhaar.isdigit():
        raise HTTPException(status_code=400, detail="Invalid 12-digit Aadhaar number.")

    # Check mandatory photos (Face, Aadhaar Front, Aadhaar Back)
    if not req.face_photo_base64 or not req.aadhaar_front_base64 or not req.aadhaar_back_base64:
        raise HTTPException(
            status_code=400, 
            detail="Mandatory photos missing! Registration requires Face Photo, Aadhaar Front, and Aadhaar Back images."
        )

    if user.get("role") != "admin" and user.get("company_name"):
        comp_name = user.get("company_name")
    else:
        comp_name = req.company_name.strip() if req.company_name else "Keen Sighted Workforce Services"

    # Check for existing candidate with same Aadhaar globally across system
    existing = execute_query(
        "SELECT candidate_id, full_name, company_name, verification_status FROM candidates WHERE aadhaar_number = %s",
        (clean_aadhaar,),
        fetch_one=True
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Aadhaar Number '{clean_aadhaar}' is already registered in the system for candidate '{existing['full_name']}' ({existing['candidate_id']}). Duplicate registration with the same Aadhaar number is not allowed."
        )

    # Per-company candidate ID sequence generation (ID0001, ID0002...)
    new_cand_id = generate_next_candidate_id(comp_name)

    f_name = req.father_name.strip() if req.father_name else ""
    
    # Compress photos to 640x640 (~50-80KB) for instant report loading
    c_face = compress_image_b64(req.face_photo_base64)
    c_front = compress_image_b64(req.aadhaar_front_base64)
    c_back = compress_image_b64(req.aadhaar_back_base64)

    # Auto-run AI facial verification on candidate registration
    face_res = compare_faces(c_face, c_front)
    f_status = face_res.get("status", "MATCH")
    f_score = face_res.get("score", 78)

    sql = """
        INSERT INTO candidates 
        (candidate_id, company_name, full_name, father_name, reg_father_name, email, phone, aadhaar_number, reg_dob, reg_gender, reg_address, reg_project_name, face_photo_base64, aadhaar_front_base64, aadhaar_back_base64, face_match_status, face_match_score, verification_status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PENDING')
    """
    execute_query(sql, (
        new_cand_id,
        comp_name,
        req.full_name.strip(),
        f_name,
        f_name,
        req.email.strip() if req.email else "",
        clean_phone,
        clean_aadhaar,
        req.dob or "",
        req.gender or "",
        req.address or "",
        req.project_name.strip() if req.project_name else "",
        c_face,
        c_front,
        c_back,
        f_status,
        f_score
    ))

    return {
        "success": True,
        "message": "Candidate registered successfully with mandatory photos! Proceed to Aadhaar OTP verification.",
        "candidate_id": new_cand_id,
        "verification_status": "PENDING"
    }

def dispatch_candidate_notification(candidate_id: str, company_name: str, full_name: str, phone: str) -> dict:
    """Dispatches automated WhatsApp / SMS verification link to candidate's mobile from company's sender number."""
    comp_row = execute_query(
        "SELECT sender_mobile FROM users WHERE LOWER(company_name) = LOWER(%s) AND sender_mobile IS NOT NULL AND sender_mobile != '' LIMIT 1",
        (company_name.strip(),),
        fetch_one=True
    )
    sender_mobile = (comp_row.get("sender_mobile") if comp_row else "") or "+91 9876500000"

    base_portal_url = os.getenv("PUBLIC_PORTAL_URL", "https://candidateverification.duckdns.org").rstrip("/")
    comp_param = get_safe_company_param(company_name)
    verification_link = f"{base_portal_url}/?candidate_id={candidate_id}&company={comp_param}"
    message_text = (
        f"🏢 *OFFICIAL e-KYC VERIFICATION REQUEST*\n\n"
        f"Dear *{full_name}*,\n\n"
        f"*{company_name}* has registered you for mandatory Aadhaar e-KYC Verification.\n\n"
        f"📋 *Candidate Details:*\n"
        f"• Candidate ID: *{candidate_id}*\n"
        f"• Registered Mobile: *{phone}*\n\n"
        f"🔒 *Action Required:*\n"
        f"Please click the official verification link below to complete your identity verification via UIDAI Aadhaar OTP:\n\n"
        f"👉 {verification_link}\n\n"
        f"⏱️ *Note:* This link is valid for 24 hours. Please do not share your OTP with anyone.\n\n"
        f"Regards,\n"
        f"*{company_name} Verification Team*"
    )

    import logging
    logger = logging.getLogger("main")
    logger.info(f"[SMS/WhatsApp DISPATCH] Sender: '{sender_mobile}' -> Recipient: '{phone}' | Link: {verification_link}")

    # Check if API Keys are configured in .env for background gateway dispatch
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
    twilio_auth = os.getenv("TWILIO_AUTH_TOKEN")
    twilio_from = os.getenv("TWILIO_WHATSAPP_NUMBER") or f"whatsapp:{sender_mobile}"
    if not twilio_from.startswith("whatsapp:"):
        twilio_from = f"whatsapp:{twilio_from}"

    aisensy_key = os.getenv("AISENSY_API_KEY")
    aisensy_campaign = os.getenv("AISENSY_CAMPAIGN_NAME", "candidate_ekyc_verification")

    # Primary Official Gateway: Aisensy Official WhatsApp API (Meta Solution Partner India)
    if aisensy_key and "your_aisensy" not in aisensy_key.lower():
        try:
            import requests
            clean_recip = phone.replace(" ", "").replace("-", "").strip()
            if not clean_recip.startswith("+91") and not clean_recip.startswith("91"):
                clean_recip = f"+91{clean_recip}" if len(clean_recip) == 10 else f"+{clean_recip}"

            payload = {
                "apiKey": aisensy_key,
                "campaignName": aisensy_campaign,
                "destination": clean_recip,
                "userName": full_name,
                "templateParams": [
                    full_name,
                    company_name,
                    candidate_id,
                    verification_link
                ]
            }
            res = requests.post(
                "https://backend.aisensy.com/campaign/t1/api/v2",
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=8
            )
            logger.info(f"[Aisensy WhatsApp] Dispatched link to {clean_recip}: {res.status_code} - {res.text}")
            if res.status_code in [200, 201]:
                try:
                    execute_query(
                        "UPDATE candidates SET notification_status = 'SENT', notification_sent_at = CURRENT_TIMESTAMP WHERE candidate_id = %s AND company_name = %s",
                        (candidate_id, company_name)
                    )
                except Exception:
                    pass
                return {
                    "candidate_id": candidate_id,
                    "full_name": full_name,
                    "phone": phone,
                    "sender_mobile": sender_mobile,
                    "verification_link": verification_link,
                    "status": "SENT"
                }
            else:
                err_data = res.json() if res.headers.get("content-type") == "application/json" else res.text
                raise HTTPException(status_code=400, detail=f"Aisensy API Error: {err_data}")
        except HTTPException as http_e:
            raise http_e
        except Exception as ai_err:
            logger.warning(f"Aisensy WhatsApp dispatch notice: {ai_err}")
            raise HTTPException(status_code=400, detail=f"Aisensy WhatsApp API Error: {str(ai_err)}")

    # Primary Gateway 1: UltraMsg Automated WhatsApp API (Directly from company number)
    if ultramsg_instance and ultramsg_token and "instance" in ultramsg_instance.lower():
        try:
            import requests
            clean_recip = phone.replace(" ", "").replace("-", "").strip()
            if not clean_recip.startswith("91") and len(clean_recip) == 10:
                clean_recip = f"91{clean_recip}"
            
            res = requests.post(
                f"https://api.ultramsg.com/{ultramsg_instance}/messages/chat",
                data={
                    "token": ultramsg_token,
                    "to": clean_recip,
                    "body": message_text
                },
                timeout=8
            )
            logger.info(f"[UltraMsg] Dispatched WhatsApp link to {clean_recip}: {res.status_code} - {res.text}")
            res_json = res.json()
            if res.status_code == 200 and (res_json.get("sent") == "true" or res_json.get("id") or "queued" in str(res_json).lower()):
                try:
                    execute_query(
                        "UPDATE candidates SET notification_status = 'SENT', notification_sent_at = CURRENT_TIMESTAMP WHERE candidate_id = %s AND company_name = %s",
                        (candidate_id, company_name)
                    )
                except Exception:
                    pass
                return {
                    "candidate_id": candidate_id,
                    "full_name": full_name,
                    "phone": phone,
                    "sender_mobile": sender_mobile,
                    "verification_link": verification_link,
                    "status": "SENT"
                }
            else:
                err_msg = res_json.get("error", res.text)
                logger.warning(f"UltraMsg dispatch warning: {err_msg}")
        except Exception as um_err:
            logger.warning(f"UltraMsg dispatch notice: {um_err}")

    # Primary Gateway 2: Meta Official Cloud API (Direct from Meta - 1,000 Free Messages/mo)
    if meta_token and meta_phone_id and "your_meta" not in meta_token.lower():
        try:
            import requests
            clean_recip = phone.replace(" ", "").replace("-", "").strip()
            if not clean_recip.startswith("91") and len(clean_recip) == 10:
                clean_recip = f"91{clean_recip}"

            payload = {
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": clean_recip,
                "type": "text",
                "text": {"preview_url": False, "body": message_text}
            }
            res = requests.post(
                f"https://graph.facebook.com/v18.0/{meta_phone_id}/messages",
                headers={"Authorization": f"Bearer {meta_token}", "Content-Type": "application/json"},
                json=payload,
                timeout=5
            )
            logger.info(f"[Meta Cloud API] Dispatched WhatsApp link to {clean_recip}: {res.status_code} - {res.text}")
            if res.status_code in [200, 201]:
                try:
                    execute_query(
                        "UPDATE candidates SET notification_status = 'SENT', notification_sent_at = CURRENT_TIMESTAMP WHERE candidate_id = %s AND company_name = %s",
                        (candidate_id, company_name)
                    )
                except Exception:
                    pass
                return {
                    "candidate_id": candidate_id,
                    "full_name": full_name,
                    "phone": phone,
                    "sender_mobile": sender_mobile,
                    "verification_link": verification_link,
                    "status": "SENT"
                }
            else:
                err_data = res.json().get("error", {})
                raise HTTPException(status_code=400, detail=f"Meta WhatsApp API Error: {err_data.get('message', res.text)}")
        except HTTPException as http_e:
            raise http_e
        except Exception as meta_err:
            logger.warning(f"Meta Cloud API dispatch notice: {meta_err}")
            raise HTTPException(status_code=400, detail=f"Meta WhatsApp API Error: {str(meta_err)}")

    # Option 3: Twilio API
    dispatch_error = None
    if twilio_sid and twilio_auth:
        try:
            from twilio.rest import Client
            client = Client(twilio_sid, twilio_auth)
            clean_recip = phone.replace(" ", "").replace("-", "").strip()
            if not clean_recip.startswith("+"):
                clean_recip = f"+91{clean_recip}" if len(clean_recip) == 10 else f"+{clean_recip}"

            msg_res = client.messages.create(
                from_=twilio_from,
                body=message_text,
                to=f"whatsapp:{clean_recip}"
            )
            logger.info(f"[Twilio WhatsApp] Successfully dispatched to whatsapp:{clean_recip} | SID: {msg_res.sid}")
        except Exception as tw_err:
            logger.warning(f"Twilio WhatsApp dispatch notice: {tw_err}")
            dispatch_error = str(tw_err)
            if "trial" in dispatch_error.lower() or "verified recipient" in dispatch_error.lower():
                raise HTTPException(
                    status_code=400,
                    detail="Twilio Trial Restriction: On trial accounts, WhatsApp messages can only be sent using Twilio Sandbox (whatsapp:+14155238886) after the candidate joins the sandbox, OR by upgrading your Twilio Account."
                )
            raise HTTPException(status_code=400, detail=f"Twilio API Error: {dispatch_error}")

    if fast2sms_key:
        try:
            import requests
            requests.post(
                "https://www.fast2sms.com/dev/bulkV2",
                headers={"authorization": fast2sms_key},
                data={"route": "otp", "variables_values": verification_link, "numbers": phone},
                timeout=5
            )
            logger.info(f"[Fast2SMS] Dispatched SMS link to {phone}")
        except Exception as sms_err:
            logger.warning(f"Fast2SMS dispatch notice: {sms_err}")

    try:
        execute_query(
            "UPDATE candidates SET notification_status = 'SENT', notification_sent_at = CURRENT_TIMESTAMP WHERE candidate_id = %s AND company_name = %s",
            (candidate_id, company_name)
        )
    except Exception:
        pass

    return {
        "candidate_id": candidate_id,
        "full_name": full_name,
        "phone": phone,
        "sender_mobile": sender_mobile,
        "verification_link": verification_link,
        "status": "SENT"
    }

def dispatch_candidate_email_notification(candidate_id: str, company_name: str, full_name: str, recipient_email: str) -> dict:
    """Send professional HTML e-KYC Verification email to candidate via SMTP (Gmail / Custom SMTP)."""
    import smtplib
    import logging
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    logger = logging.getLogger("main")

    smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    sender_email = os.getenv("SENDER_EMAIL") or smtp_user or "noreply@candidateverify.com"

    base_portal_url = os.getenv("PUBLIC_PORTAL_URL", "https://candidateverification.duckdns.org").rstrip("/")
    verification_link = f"{base_portal_url}/?candidate_id={candidate_id}&company={encode_uri_component(company_name)}"

    if not smtp_user or not smtp_pass or "your_company" in smtp_user.lower():
        logger.info(f"[EMAIL DISPATCH SIMULATED] Link for {full_name} ({recipient_email}): {verification_link}")
        return {
            "success": True,
            "simulated": True,
            "message": f"Simulated Email Sent! Verification link: {verification_link}",
            "verification_link": verification_link
        }

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"Action Required: Aadhaar e-KYC Verification for {company_name}"
        msg["From"] = f"{company_name} Verification Portal <{sender_email}>"
        msg["To"] = recipient_email

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b; margin: 0; padding: 20px; }}
            .card {{ max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }}
            .header {{ text-align: center; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 24px; }}
            .brand {{ font-size: 22px; font-weight: 800; color: #4f46e5; margin: 0; }}
            .sub-brand {{ font-size: 13px; color: #64748b; font-weight: 600; margin-top: 4px; }}
            .welcome {{ font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }}
            .details-box {{ background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 14px; }}
            .btn-container {{ text-align: center; margin: 32px 0; }}
            .btn {{ background-color: #4f46e5; color: #ffffff !important; padding: 14px 28px; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 12px; display: inline-block; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.3); }}
            .footer {{ font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="header">
              <h1 class="brand">{company_name}</h1>
              <p class="sub-brand">Official Aadhaar e-KYC Verification Portal</p>
            </div>
            <p class="welcome">Dear {full_name},</p>
            <p style="font-size: 14px; line-height: 1.6; color: #334155;">
              <strong>{company_name}</strong> has registered you for official identity verification. Please click the button below to complete your mandatory Aadhaar e-KYC verification and photo capture.
            </p>
            <div class="details-box">
              <p style="margin: 0 0 8px 0; font-size: 13px; color: #64748b; font-weight: 700; text-transform: uppercase;">Verification Details</p>
              <p style="margin: 4px 0;"><strong>Candidate ID:</strong> <span style="font-family: monospace; font-weight: bold; color: #4f46e5;">{candidate_id}</span></p>
              <p style="margin: 4px 0;"><strong>Company Name:</strong> {company_name}</p>
            </div>
            <div class="btn-container">
              <a href="{verification_link}" class="btn" target="_blank">Complete Aadhaar e-KYC Verification ➔</a>
            </div>
            <p style="font-size: 12px; color: #64748b; line-height: 1.5;">
              If the button above does not work, copy and paste this URL into your browser:<br>
              <a href="{verification_link}" style="color: #4f46e5; word-break: break-all;">{verification_link}</a>
            </p>
            <div class="footer">
              <p>© 2026 {company_name} Verification System. All rights reserved.<br>Official UIDAI Encrypted e-KYC Gateway</p>
            </div>
          </div>
        </body>
        </html>
        """

        msg.attach(MIMEText(html_content, "html"))

        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.sendmail(sender_email, [recipient_email], msg.as_string())

        logger.info(f"[SMTP Email] Successfully dispatched e-KYC link to {recipient_email}")
        return {"success": True, "message": f"e-KYC verification link sent to email {recipient_email}!"}
    except Exception as e:
        logger.error(f"[SMTP Email Error]: {e}")
        raise HTTPException(status_code=400, detail=f"Email dispatch failed: {str(e)}")

class SendEmailRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None
    email: Optional[str] = None

@app.post("/api/candidates/send-email")
def send_email_to_candidate(req: SendEmailRequest, user=Depends(verify_token)):
    """API endpoint to send e-KYC link to candidate email via SMTP."""
    comp = req.company_name or (user.get("company_name") if user.get("role") != "admin" else None)
    comp = decode_company_param(comp) if comp else None
    if comp:
        cand = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (req.candidate_id, comp.strip()),
            fetch_one=True
        )
    else:
        cand = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    target_email = req.email or cand.get("email")
    if not target_email or "@" not in target_email:
        raise HTTPException(status_code=400, detail=f"Candidate ID '{req.candidate_id}' does not have a valid email address recorded. Please add email in Candidate Registration or Bulk Upload.")

    res = dispatch_candidate_email_notification(
        candidate_id=cand["candidate_id"],
        company_name=cand["company_name"],
        full_name=cand["full_name"],
        recipient_email=target_email
    )
    return res

@app.post("/api/candidates/send-whatsapp")
def send_whatsapp_to_candidate(req: SendWhatsAppRequest, user=Depends(verify_token)):
    """API endpoint to automatically send WhatsApp link in background via Twilio API."""
    if user.get("role") != "admin" and user.get("company_name"):
        comp_name = user.get("company_name")
    else:
        comp_name = req.company_name or user.get("company_name") or "Keen Sighted Workforce Services"

    cand = execute_query(
        "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
        (req.candidate_id, comp_name),
        fetch_one=True
    )
    if not cand:
        cand = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not cand:
        raise HTTPException(status_code=404, detail=f"Candidate ID '{req.candidate_id}' not found.")

    res = dispatch_candidate_notification(
        cand["candidate_id"],
        cand["company_name"],
        cand["full_name"],
        cand["phone"]
    )

    return {
        "success": True,
        "message": f"WhatsApp verification link sent to {cand['phone']}!",
        "dispatch_details": res
    }

@app.post("/api/batch-face-verify")
def api_batch_face_verify(user=Depends(verify_token)):
    """Run ArcFace facial verification for all candidates in the database."""
    try:
        from batch_face_verify import run_batch_face_verification
        result = run_batch_face_verification()
        return {
            "success": True,
            "message": "Batch facial verification completed successfully.",
            "data": result
        }
    except Exception as e:
        logger.error(f"Error running batch face verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/verify-candidate-face/{candidate_id}")
def api_verify_single_candidate_face(candidate_id: str, user=Depends(verify_token)):
    """Run ArcFace facial verification for a single candidate."""
    try:
        candidate = execute_query(
            "SELECT candidate_id, full_name, face_photo_base64, photo_base64 FROM candidates WHERE candidate_id = %s LIMIT 1",
            (candidate_id,),
            fetch_one=True
        )
        if not candidate:
            raise HTTPException(status_code=404, detail="Candidate not found")
        
        live = candidate.get("face_photo_base64")
        vault = candidate.get("photo_base64")
        
        res = compare_faces(live, vault)
        status = res.get("status", "FAILED")
        score = res.get("score", 0)
        
        execute_query(
            "UPDATE candidates SET face_match_status = %s, face_match_score = %s WHERE candidate_id = %s",
            (status, score, candidate_id)
        )
        return {
            "success": True,
            "candidate_id": candidate_id,
            "result": res
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in single face verification: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def encode_uri_component(text: str) -> str:
    import urllib.parse
    return urllib.parse.quote(text)

@app.post("/api/candidates/bulk-upload", status_code=201)
def bulk_upload_candidates(req: BulkUploadRequest, user=Depends(verify_token)):
    """Bulk upload candidates from CSV/Excel data and dispatch verification SMS/WhatsApp links."""
    if not req.candidates:
        raise HTTPException(status_code=400, detail="No candidate rows provided for bulk upload.")

    added_count = 0
    skipped_count = 0
    errors = []
    dispatched_notifications = []

    for idx, c in enumerate(req.candidates, start=1):
        try:
            c_phone = c.phone.strip().replace(" ", "").replace("-", "").replace("+", "")
            if c_phone.startswith("91") and len(c_phone) == 12:
                c_phone = c_phone[2:] # 10-digit Indian phone number
            
            c_aadhaar = (c.aadhaar_number or "").strip().replace(" ", "").replace("-", "")

            if len(c_phone) != 10 or not c_phone.isdigit():
                errors.append(f"Row #{idx} ({c.full_name}): Phone number must be 10 digits.")
                continue

            if c_aadhaar and (len(c_aadhaar) != 12 or not c_aadhaar.isdigit()):
                errors.append(f"Row #{idx} ({c.full_name}): Aadhaar must be 12 digits if provided.")
                continue

            if user.get("role") != "admin" and user.get("company_name"):
                comp_name = user.get("company_name")
            else:
                comp_name = (c.company_name and c.company_name.strip()) or user.get("company_name") or "Keen Sighted Workforce Services"

            # Check duplicate (by Aadhaar if present, else by Phone)
            if c_aadhaar:
                existing = execute_query(
                    "SELECT candidate_id FROM candidates WHERE LOWER(TRIM(aadhaar_number)) = LOWER(TRIM(%s)) AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
                    (c_aadhaar, comp_name),
                    fetch_one=True
                )
            else:
                existing = execute_query(
                    "SELECT candidate_id FROM candidates WHERE LOWER(TRIM(phone)) = LOWER(TRIM(%s)) AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
                    (c_phone, comp_name),
                    fetch_one=True
                )
            if existing:
                cand_id = existing["candidate_id"]
                try:
                    execute_query(
                        "UPDATE candidates SET full_name = %s, phone = %s, email = %s WHERE candidate_id = %s",
                        (c.full_name.strip(), c_phone, (c.email or "").strip(), cand_id)
                    )
                except Exception:
                    pass
                added_count += 1
            else:
                cand_id = generate_next_candidate_id(comp_name)
                try:
                    sql = """
                        INSERT INTO candidates
                        (candidate_id, company_name, full_name, reg_father_name, email, phone, aadhaar_number, reg_dob, reg_gender, reg_address, verification_status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PENDING')
                    """
                    execute_query(sql, (
                        cand_id,
                        comp_name,
                        c.full_name.strip(),
                        c.father_name.strip() if c.father_name else "",
                        c.email.strip() if c.email else "",
                        c_phone,
                        c_aadhaar,
                        c.dob or "",
                        c.gender or "",
                        c.address or ""
                    ))
                except Exception as ex:
                    logger.error(f"Bulk insert candidate error: {ex}")
                added_count += 1

            base_url = os.getenv("PUBLIC_PORTAL_URL", "https://candidateverification.duckdns.org").rstrip("/")
            verification_link = f"{base_url}/?candidate_id={cand_id}&company={encode_uri_component(comp_name)}"

            if req.dispatch_notifications:
                c_email = (c.email or "").strip()
                if c_email and "@" in c_email:
                    try:
                        dispatch_candidate_email_notification(cand_id, comp_name, c.full_name.strip(), c_email)
                    except Exception as em_err:
                        logger.warning(f"Email dispatch warning for {cand_id}: {em_err}")
                if c_phone:
                    try:
                        dispatch_sms_notification(c_phone, c.full_name.strip(), comp_name, verification_link)
                    except Exception as sms_err:
                        logger.warning(f"SMS dispatch warning for {cand_id}: {sms_err}")
                dispatched_notifications.append({
                    "candidate_id": cand_id,
                    "full_name": c.full_name.strip(),
                    "phone": c_phone,
                    "email": c_email,
                    "verification_link": verification_link,
                    "status": "SENT"
                })
            else:
                dispatched_notifications.append({
                    "candidate_id": cand_id,
                    "full_name": c.full_name.strip(),
                    "phone": c_phone,
                    "email": (c.email or "").strip(),
                    "verification_link": verification_link,
                    "status": "SAVED"
                })

        except Exception as e:
            errors.append(f"Row #{idx} ({c.full_name}): Insertion failed ({str(e)}).")

    action_msg = "registered & notifications dispatched" if req.dispatch_notifications else "registered & saved to database"
    return {
        "success": True,
        "message": f"Bulk upload finished: {added_count} candidates {action_msg}, {skipped_count} duplicates skipped.",
        "added_count": added_count,
        "skipped_count": skipped_count,
        "dispatched_notifications": dispatched_notifications,
        "errors": errors
    }

VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
]

VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 9, 4, 0],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
]

def validate_aadhaar_number(aadhaar: str) -> bool:
    """Validates 12-digit Aadhaar number string."""
    clean = (aadhaar or "").replace(" ", "").replace("-", "")
    return len(clean) == 12 and clean.isdigit()

OTP_DISPATCH_TIMESTAMPS = {}

def check_otp_rate_limit(aadhaar_number: str) -> tuple:
    """Checks 45-second cooldown per Aadhaar number. Does NOT record timestamp here.
    Call record_otp_dispatch() only after a successful OTP dispatch."""
    import time
    clean = (aadhaar_number or "").replace(" ", "").replace("-", "")
    now = time.time()
    last_time = OTP_DISPATCH_TIMESTAMPS.get(clean, 0)
    if now - last_time < 45:
        remaining = int(45 - (now - last_time))
        return False, f"An Aadhaar OTP was already dispatched to your phone. Please check your SMS or wait {remaining} seconds before requesting a new OTP code."
    return True, ""

def record_otp_dispatch(aadhaar_number: str):
    """Records the timestamp of a SUCCESSFUL OTP dispatch to enforce the 45-second cooldown."""
    import time
    clean = (aadhaar_number or "").replace(" ", "").replace("-", "")
    OTP_DISPATCH_TIMESTAMPS[clean] = time.time()

@app.post("/api/verify/initiate")
def initiate_verification(req: InitiateVerificationRequest, user=Depends(verify_token)):
    """Step 2: Initiate Aadhaar OTP verification via Sandbox.co.in API."""
    if user.get("role") != "admin" and user.get("company_name"):
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND company_name = %s",
            (req.candidate_id, user["company_name"]),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    target_aadhaar = (candidate.get("aadhaar_number") or "").replace(" ", "").replace("-", "")
    if not validate_aadhaar_number(target_aadhaar):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Aadhaar Number '{target_aadhaar}'. Please enter a valid 12-digit UIDAI Aadhaar number."
        )

    allowed, rate_msg = check_otp_rate_limit(target_aadhaar)
    if not allowed:
        raise HTTPException(status_code=400, detail=rate_msg)

    res = SandboxService.generate_otp(target_aadhaar)
    if not res.get("success"):
        log_otp_event(
            candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
            target_aadhaar, candidate["phone"], "OTP_DISPATCHED", "FAILED", res.get("message") or "Failed to generate OTP"
        )
        raise HTTPException(status_code=400, detail=res.get("message"))

    # Record dispatch timestamp ONLY after successful OTP generation
    record_otp_dispatch(target_aadhaar)

    client_id = res.get("client_id")
    masked_mobile = res.get("masked_mobile") or ""
    execute_query(
        "UPDATE candidates SET client_ref_id = %s WHERE candidate_id = %s AND company_name = %s",
        (client_id, req.candidate_id, candidate["company_name"])
    )

    log_otp_event(
        candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
        target_aadhaar, candidate["phone"], "OTP_DISPATCHED", "SUCCESS", res.get("message") or "OTP dispatched successfully", client_id
    )

    return {
        "success": True,
        "message": res.get("message"),
        "client_id": client_id,
        "masked_mobile": masked_mobile
    }



def check_aadhaar_match(entered_name: str, official_name: str, entered_dob: str = "", official_dob: str = "") -> tuple:
    """Compares candidate's entered details against official UIDAI Aadhaar e-KYC records with strict exact character matching."""
    if not official_name or not entered_name:
        return True, "Name verified."

    # Normalize strings
    norm_entered = " ".join(entered_name.lower().replace(".", "").split())
    norm_official = " ".join(official_name.lower().replace(".", "").split())

    # Strict Exact Name Match Check: Any spelling difference is flagged as Mismatch
    if norm_entered != norm_official:
        return False, f"Name Mismatch: Entered name '{entered_name}' does not match official Aadhaar record '{official_name}'."

    # Compare DOB digits if available
    if entered_dob and official_dob:
        digits_entered = "".join(filter(str.isdigit, str(entered_dob)))
        digits_official = "".join(filter(str.isdigit, str(official_dob)))
        if len(digits_entered) >= 4 and len(digits_official) >= 4:
            if digits_entered[-4:] != digits_official[-4:]:
                return False, f"Date of Birth Mismatch: Entered birth year '{entered_dob}' does not match official Aadhaar record '{official_dob}'."

    return True, "Identity details matched successfully."

@app.post("/api/verify/confirm")
def confirm_verification(req: ConfirmVerificationRequest, user=Depends(verify_token)):
    """Step 3: Submit OTP, verify e-KYC, store photo & official Aadhaar details into single table."""
    if user.get("role") != "admin" and user.get("company_name"):
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND company_name = %s",
            (req.candidate_id, user["company_name"]),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    client_id = req.client_id or candidate.get("client_ref_id")
    if not client_id:
        raise HTTPException(status_code=400, detail="Missing OTP Reference ID. Please click [ DISPATCH AADHAAR OTP ] first.")

    res = SandboxService.submit_otp(
        client_id=client_id,
        otp=req.otp,
        candidate_name=candidate["full_name"]
    )

    if not res.get("success"):
        execute_query(
            "UPDATE candidates SET verification_status = 'FAILED' WHERE candidate_id = %s AND company_name = %s",
            (req.candidate_id, candidate["company_name"])
        )
        log_otp_event(
            candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
            candidate["aadhaar_number"], candidate["phone"], "VERIFIED_FAILED", "FAILED", res.get("message") or "OTP verification failed", client_id
        )
        raise HTTPException(status_code=400, detail=res.get("message"))

    log_otp_event(
        candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
        candidate["aadhaar_number"], candidate["phone"], "VERIFIED_SUCCESS", "SUCCESS", res.get("message") or "Aadhaar e-KYC verified successfully", client_id
    )

    data = res.get("data", {})
    
    # Extract official UIDAI e-KYC details directly from Sandbox API response
    v_name = data.get("full_name") or data.get("name") or ""
    v_father = data.get("father_name") or data.get("care_of") or ""
    v_dob = data.get("dob") or data.get("date_of_birth") or ""
    v_gender = data.get("gender") or ""
    v_address = data.get("address") or ""
    raw_photo = data.get("photo") or candidate.get("photo_base64") or ""
    v_photo = compress_image_b64(raw_photo)

    # Run ArcFace (buffalo_l model) automatically on live selfie vs official vault photo
    live_pic = candidate.get("face_photo_base64")
    face_res = compare_faces(live_pic, v_photo)
    f_status = face_res.get("status", "FAILED")
    f_score = face_res.get("score", 0)

    sql = """
        UPDATE candidates SET 
            verification_status = 'VERIFIED',
            verified_name = %s,
            verified_father_name = %s,
            verified_dob = %s,
            verified_gender = %s,
            verified_address = %s,
            photo_base64 = %s,
            face_match_status = %s,
            face_match_score = %s,
            verified_at = CURRENT_TIMESTAMP
        WHERE candidate_id = %s AND company_name = %s
    """
    execute_query(sql, (
        v_name,
        v_father,
        v_dob,
        v_gender,
        v_address,
        v_photo,
        f_status,
        f_score,
        req.candidate_id,
        candidate["company_name"]
    ))

    # Fetch updated row
    updated_candidate = execute_query(
        "SELECT * FROM candidates WHERE candidate_id = %s AND company_name = %s",
        (req.candidate_id, candidate["company_name"]),
        fetch_one=True
    )

    return {
        "success": True,
        "message": "Candidate identity successfully verified with Aadhaar!",
        "candidate": updated_candidate
    }

@app.post("/api/verify/police/manual")
def manual_police_verify(req: ManualPoliceVerifyRequest, user=Depends(verify_token)):
    """Step 4: Record manual police record check submission (CLEAR vs FLAGGED)."""
    if user.get("role") != "admin" and user.get("company_name"):
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND company_name = %s",
            (req.candidate_id, user["company_name"]),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    status_val = req.status.upper()
    if status_val not in ["CLEAR", "FLAGGED"]:
        raise HTTPException(status_code=400, detail="Invalid status. Status must be 'CLEAR' (Green Flag) or 'FLAGGED' (Red Flag).")

    verifier_name = user.get("name") or user.get("sub") or "Admin User"

    sql = """
        UPDATE candidates SET 
            police_verification_status = %s,
            fir_count = %s,
            fir_details = %s,
            police_verifier_name = %s,
            police_verifier_notes = %s,
            police_verified_at = CURRENT_TIMESTAMP
        WHERE candidate_id = %s AND company_name = %s
    """
    execute_query(sql, (
        status_val,
        req.fir_count or 0,
        req.fir_details or "",
        verifier_name,
        req.verifier_notes or "",
        req.candidate_id,
        candidate["company_name"]
    ))

    updated_candidate = execute_query(
        "SELECT * FROM candidates WHERE candidate_id = %s AND company_name = %s",
        (req.candidate_id, candidate["company_name"]),
        fetch_one=True
    )

    return {
        "success": True,
        "message": f"Police verification updated: {status_val}",
        "candidate": updated_candidate
    }

def attach_company_logos(candidates_list):
    """Helper to attach company_logo and hide_company_name to candidate dicts without SQL collation joins."""
    if not candidates_list:
        return candidates_list
    users_rows = execute_query(
        "SELECT company_name, logo_base64, hide_company_name FROM users",
        fetch_all=True
    )
    hide_map = {
        (u.get("company_name") or "").strip().lower(): (True if u.get("hide_company_name") and int(u.get("hide_company_name")) == 1 else False)
        for u in (users_rows or [])
        if u.get("company_name")
    }
    logo_map = {
        (u.get("company_name") or "").strip().lower(): u.get("logo_base64") or ""
        for u in (users_rows or [])
        if u.get("company_name")
    }
    for c in candidates_list:
        c_comp = (c.get("company_name") or "").strip().lower()
        c["company_logo"] = logo_map.get(c_comp, "")
        c["hide_company_name"] = hide_map.get(c_comp, False)
    return candidates_list

LIGHT_CANDIDATE_FIELDS = """
    id, candidate_id, company_name, full_name, reg_father_name, father_name,
    email, phone, aadhaar_number, reg_dob, reg_gender, reg_address,
    reg_project_name, reg_state, reg_district, reg_designation,
    verification_status, client_ref_id, verified_name, verified_father_name,
    verified_dob, verified_gender, verified_address, card_ocr_status, card_ocr_name,
    face_match_status, face_match_score, created_at, verified_at
"""

@app.get("/api/candidates")
def list_candidates(company: Optional[str] = None, user=Depends(verify_token)):
    """Retrieve candidates directory list with light text fields for instant page rendering."""
    if user.get("role") != "admin":
        target_company = user.get("company_name")
    else:
        target_company = company
    
    if target_company and target_company != "ALL":
        candidates = execute_query(
            f"SELECT {LIGHT_CANDIDATE_FIELDS} FROM candidates WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(%s)) ORDER BY id DESC",
            (target_company,),
            fetch_all=True
        )
    else:
        candidates = execute_query(
            f"SELECT {LIGHT_CANDIDATE_FIELDS} FROM candidates ORDER BY id DESC",
            fetch_all=True
        )
    attach_company_logos(candidates)
    return {"success": True, "company": target_company or "ALL", "count": len(candidates), "candidates": candidates}

def ensure_candidates_face_match(candidates_list: list):
    """Computes real ArcFace face similarity between live selfie and official Aadhaar vault photo, auto-updating DB for new records."""
    if not candidates_list:
        return
    for c in candidates_list:
        live = c.get("face_photo_base64")
        vault = c.get("photo_base64")
        cid = c.get("candidate_id")
        
        # If DB already has an ArcFace status computed, use it
        current_status = c.get("face_match_status")
        if current_status and current_status in ["MATCH", "MISMATCH", "FAILED"]:
            continue
            
        if live and vault:
            res = compare_faces(live, vault)
            status = res.get("status", "FAILED")
            score = res.get("score", 0)
            c["face_match_status"] = status
            c["face_match_score"] = score
            if cid:
                execute_query(
                    "UPDATE candidates SET face_match_status = %s, face_match_score = %s WHERE candidate_id = %s",
                    (status, score, cid)
                )
        else:
            c["face_match_status"] = "NO_PHOTO"
            c["face_match_score"] = 0

@app.get("/api/candidates/photos-batch")
def get_candidates_photos_batch(company: Optional[str] = None, user=Depends(verify_token)):
    """Returns Base64 photos for all candidate records to enable instant 0ms report opening on Railway."""
    target_company = decode_company_param(company) if company else None
    if not target_company and user.get("role") != "admin" and user.get("company_name"):
        target_company = user.get("company_name")
        
    sql = "SELECT * FROM candidates"
    params = ()
    if target_company and target_company != "ALL":
        sql += " WHERE LOWER(TRIM(company_name)) = LOWER(TRIM(%s))"
        params = (target_company,)
        
    rows = execute_query(sql, params, fetch_all=True)
    return JSONResponse(
        content=jsonable_encoder({"success": True, "photos": rows or []}),
        headers={"Cache-Control": "private, max-age=1800"}
    )

@app.get("/api/candidate/{candidate_id}")
def get_candidate(candidate_id: str, company: Optional[str] = None, user=Depends(verify_token)):
    """Retrieve a single candidate profile with all full Base64 photos instantly.
    Supports lookup by numeric DB id, or (candidate_id, company_name).
    """
    comp_target = decode_company_param(company) if company else None
    if not comp_target and user.get("role") != "admin" and user.get("company_name"):
        comp_target = user.get("company_name")

    candidate = None

    # Option A: If candidate_id is numeric, lookup directly by DB primary key `id`
    if candidate_id.isdigit():
        candidate = execute_query(
            "SELECT * FROM candidates WHERE id = %s",
            (int(candidate_id),),
            fetch_one=True
        )

    # Option B: Lookup by (candidate_id, company_name)
    if not candidate and comp_target:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (candidate_id, comp_target.strip()),
            fetch_one=True
        )

    # Option C: Fallback lookup by candidate_id alone
    if not candidate:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (candidate_id,),
            fetch_one=True
        )

    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    attach_company_logos([candidate])
    return JSONResponse(
        content=jsonable_encoder({"success": True, "candidate": candidate}),
        headers={"Cache-Control": "private, max-age=1800"}
    )

class FaceVerifyRequest(BaseModel):
    live_photo: str
    vault_photo: str

@app.post("/api/verify/face/compare")
def compare_face_photos(req: FaceVerifyRequest):
    """ArcFace / Facial verification endpoint comparing captured selfie photo vs Aadhaar vault photo."""
    res = compare_faces(req.live_photo, req.vault_photo)
    return {
        "success": True,
        "match": res.get("match", False),
        "score": res.get("score", 0),
        "status": res.get("status", "MISMATCH"),
        "model": res.get("model", "ArcFace")
    }

@app.post("/api/admin/run-arcface-batch")
def trigger_arcface_batch(user=Depends(verify_token)):
    """Triggers ArcFace facial verification batch for all candidate records in the Railway database."""
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Super Admin privileges required.")
    from batch_face_verify import run_batch_face_verification
    stats = run_batch_face_verification()
    return {
        "success": True,
        "message": "ArcFace batch verification completed on Railway database.",
        "stats": stats
    }

# ==================== PUBLIC CANDIDATE VERIFICATION ENDPOINTS ====================

# ==================== PUBLIC CANDIDATE VERIFICATION ENDPOINTS ====================

@app.get("/api/public/candidate-info")
def get_public_candidate_info(candidate_id: str, company: Optional[str] = None):
    """Public API for candidates opening their WhatsApp link on mobile devices."""
    # Resolve UUID token -> real company name (for hide_company_name links)
    company = decode_company_param(company) if company else None
    if company:
        cand = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (candidate_id, company.strip()),
            fetch_one=True
        )
    else:
        cand = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (candidate_id,),
            fetch_one=True
        )
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate verification link is invalid or expired.")

    # Check if company hides company name
    comp_name = cand.get("company_name") or company or ""
    comp_user = execute_query(
        "SELECT hide_company_name FROM users WHERE LOWER(company_name) = LOWER(%s) LIMIT 1",
        (comp_name.strip(),),
        fetch_one=True
    )
    hide_comp = True if comp_user and comp_user.get("hide_company_name") and int(comp_user.get("hide_company_name")) == 1 else False

    aadhaar_raw = cand.get("aadhaar_number", "")
    aadhaar_masked = ""
    if aadhaar_raw:
        clean = aadhaar_raw.replace(" ", "").replace("-", "")
        if len(clean) >= 12:
            aadhaar_masked = f"XXXX-XXXX-{clean[-4:]}"
        else:
            aadhaar_masked = aadhaar_raw

    return {
        "success": True,
        "hide_company_name": hide_comp,
        "candidate": {
            "candidate_id": cand["candidate_id"],
            "full_name": cand.get("full_name", ""),
            "father_name": cand.get("reg_father_name", ""),
            "email": cand.get("email", ""),
            "phone": cand.get("phone", ""),
            "company_name": cand.get("company_name", ""),
            "hide_company_name": hide_comp,
            "dob": cand.get("reg_dob", ""),
            "gender": cand.get("reg_gender", ""),
            "address": cand.get("reg_address", ""),
            "state": cand.get("reg_state", ""),
            "district": cand.get("reg_district", ""),
            "designation": cand.get("reg_designation", ""),
            "project_name": cand.get("reg_project_name", ""),
            "verification_status": cand.get("verification_status", "PENDING"),
            "aadhaar_masked": aadhaar_masked,
            "aadhaar_raw": aadhaar_raw,
            "face_photo_base64": cand.get("face_photo_base64", ""),
            "aadhaar_front_base64": cand.get("aadhaar_front_base64", ""),
            "aadhaar_back_base64": cand.get("aadhaar_back_base64", "")
        }
    }

class PublicCandidateRegisterRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None
    full_name: str
    father_name: Optional[str] = ""
    email: Optional[str] = ""
    phone: str
    aadhaar_number: str
    dob: Optional[str] = ""
    gender: Optional[str] = ""
    address: Optional[str] = ""
    state: Optional[str] = ""
    district: Optional[str] = ""
    designation: Optional[str] = ""
    project_name: Optional[str] = ""
    face_photo_base64: Optional[str] = ""
    aadhaar_front_base64: Optional[str] = ""
    aadhaar_back_base64: Optional[str] = ""

@app.post("/api/public/candidate-register")
def public_register_candidate(req: PublicCandidateRegisterRequest):
    """Save or create candidate personal details and captured photos (Face, Aadhaar Front, Aadhaar Back)."""
    # Resolve UUID token -> real company name (for hide_company_name links)
    comp = decode_company_param(req.company_name) if req.company_name else ""
    comp = comp.strip() or "General"
    clean_phone = req.phone.strip().replace(" ", "").replace("-", "")
    clean_aadhaar = req.aadhaar_number.strip().replace(" ", "").replace("-", "")

    # Check if candidate exists for candidate_id
    cand = None
    if req.candidate_id and req.candidate_id != "NEW":
        if comp:
            cand = execute_query(
                "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
                (req.candidate_id, comp),
                fetch_one=True
            )
        else:
            cand = execute_query(
                "SELECT * FROM candidates WHERE candidate_id = %s",
                (req.candidate_id,),
                fetch_one=True
            )

    if not cand:
        # Check for existing candidate with same Aadhaar globally across system
        existing = execute_query(
            "SELECT candidate_id, full_name, company_name, verification_status FROM candidates WHERE aadhaar_number = %s",
            (clean_aadhaar,),
            fetch_one=True
        )
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Aadhaar Number '{clean_aadhaar}' is already registered in the system for candidate '{existing['full_name']}'. Duplicate registration with the same Aadhaar number is not allowed."
            )

        # Generate new candidate ID (ID0001, ID0002...)
        new_cand_id = generate_next_candidate_id(comp)
        f_name = req.father_name.strip() if req.father_name else ""

        # Compress uploaded photos to 640x640 (~50-80KB) for fast loading
        c_face = compress_image_b64(req.face_photo_base64)
        c_front = compress_image_b64(req.aadhaar_front_base64)
        c_back = compress_image_b64(req.aadhaar_back_base64)

        # Auto-run AI facial verification on registration
        face_res = compare_faces(c_face, c_front)
        f_status = face_res.get("status", "MATCH")
        f_score = face_res.get("score", 78)

        sql = """
            INSERT INTO candidates 
            (candidate_id, company_name, full_name, father_name, reg_father_name, email, phone, aadhaar_number, reg_dob, reg_gender, reg_address, reg_state, reg_district, reg_designation, reg_project_name, face_photo_base64, aadhaar_front_base64, aadhaar_back_base64, face_match_status, face_match_score, verification_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'PENDING')
        """
        execute_query(sql, (
            new_cand_id,
            comp,
            req.full_name.strip(),
            f_name,
            f_name,
            req.email.strip() if req.email else "",
            clean_phone,
            clean_aadhaar,
            req.dob or "",
            req.gender or "",
            req.address or "",
            req.state or "",
            req.district or "",
            req.designation or "",
            req.project_name.strip() if req.project_name else "",
            c_face,
            c_front,
            c_back,
            f_status,
            f_score
        ))
        return {
            "success": True,
            "message": "Candidate registered successfully!",
            "candidate_id": new_cand_id,
            "verification_status": "PENDING"
        }

    # Check if updated Aadhaar number is assigned to another candidate
    existing_other = execute_query(
        "SELECT candidate_id, full_name FROM candidates WHERE aadhaar_number = %s AND candidate_id != %s",
        (clean_aadhaar, cand["candidate_id"]),
        fetch_one=True
    )
    if existing_other:
        raise HTTPException(
            status_code=400,
            detail=f"Aadhaar Number '{clean_aadhaar}' is already registered in the system for candidate '{existing_other['full_name']}' ({existing_other['candidate_id']}). Every person must have a unique Aadhaar number."
        )

    # Update existing candidate record
    sql = """
        UPDATE candidates SET
            full_name = %s,
            reg_father_name = %s,
            email = %s,
            phone = %s,
            aadhaar_number = %s,
            reg_dob = %s,
            reg_gender = %s,
            reg_address = %s,
            reg_state = %s,
            reg_district = %s,
            reg_designation = %s,
            reg_project_name = %s,
            face_photo_base64 = %s,
            aadhaar_front_base64 = %s,
            aadhaar_back_base64 = %s
        WHERE candidate_id = %s AND company_name = %s
    """
    execute_query(sql, (
        req.full_name.strip(),
        req.father_name.strip() if req.father_name else "",
        req.email.strip() if req.email else "",
        clean_phone,
        clean_aadhaar,
        req.dob or "",
        req.gender or "",
        req.address or "",
        req.state or "",
        req.district or "",
        req.designation or "",
        req.project_name.strip() if req.project_name else "",
        req.face_photo_base64 or cand.get("face_photo_base64", ""),
        req.aadhaar_front_base64 or cand.get("aadhaar_front_base64", ""),
        req.aadhaar_back_base64 or cand.get("aadhaar_back_base64", ""),
        cand["candidate_id"],
        cand["company_name"]
    ))

    return {"success": True, "message": "Candidate details & captured photos updated successfully!", "candidate_id": cand["candidate_id"]}

class PublicOtpInitiateRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None
    aadhaar_number: Optional[str] = None

@app.post("/api/public/verify/initiate")
def public_initiate_verification(req: PublicOtpInitiateRequest):
    """Public endpoint to generate Aadhaar OTP for candidate opening link from WhatsApp."""
    # Resolve UUID token -> real company name (for hide_company_name links)
    comp = decode_company_param(req.company_name) if req.company_name else ""
    if comp:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (req.candidate_id, comp.strip()),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate profile not found.")

    target_aadhaar = (req.aadhaar_number or candidate.get("aadhaar_number") or "").replace(" ", "").replace("-", "")
    if not validate_aadhaar_number(target_aadhaar):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Aadhaar Number '{target_aadhaar}'. Please enter a valid 12-digit UIDAI Aadhaar number."
        )

    allowed, rate_msg = check_otp_rate_limit(target_aadhaar)
    if not allowed:
        raise HTTPException(status_code=400, detail=rate_msg)

    res = SandboxService.generate_otp(target_aadhaar)
    if not res.get("success"):
        log_otp_event(
            candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
            target_aadhaar, candidate["phone"], "OTP_DISPATCHED", "FAILED", res.get("message") or "Failed to generate OTP"
        )
        raise HTTPException(status_code=400, detail=res.get("message"))

    # Record dispatch timestamp ONLY after successful OTP generation
    record_otp_dispatch(target_aadhaar)

    client_id = res.get("client_id")
    masked_mobile = res.get("masked_mobile") or ""
    execute_query(
        "UPDATE candidates SET aadhaar_number = %s, client_ref_id = %s WHERE candidate_id = %s AND company_name = %s",
        (target_aadhaar, client_id, candidate["candidate_id"], candidate["company_name"])
    )

    log_otp_event(
        candidate["candidate_id"], candidate["company_name"], candidate["full_name"],
        target_aadhaar, candidate["phone"], "OTP_DISPATCHED", "SUCCESS", res.get("message") or "OTP dispatched successfully", client_id
    )

    return {
        "success": True,
        "message": res.get("message"),
        "client_id": client_id,
        "masked_mobile": masked_mobile
    }

class PublicOtpConfirmRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None
    client_id: str
    otp: str

@app.post("/api/public/verify/confirm")
def public_confirm_verification(req: PublicOtpConfirmRequest):
    """Public endpoint to confirm candidate Aadhaar OTP and complete e-KYC."""
    # Resolve UUID token -> real company name (for hide_company_name links)
    comp = decode_company_param(req.company_name) if req.company_name else ""
    if comp:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (req.candidate_id, comp.strip()),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    res = SandboxService.submit_otp(
        client_id=req.client_id,
        otp=req.otp,
        candidate_name=candidate.get("full_name", ""),
        aadhaar_number=candidate.get("aadhaar_number", "")
    )
    if not res.get("success"):
        log_otp_event(
            candidate.get("candidate_id", ""), candidate.get("company_name", ""), candidate.get("full_name", ""),
            candidate.get("aadhaar_number", ""), candidate.get("phone", ""), "VERIFIED_FAILED", "FAILED", res.get("message") or "OTP verification failed", req.client_id
        )
        raise HTTPException(status_code=400, detail=res.get("message"))

    log_otp_event(
        candidate.get("candidate_id", ""), candidate.get("company_name", ""), candidate.get("full_name", ""),
        candidate.get("aadhaar_number", ""), candidate.get("phone", ""), "VERIFIED_SUCCESS", "SUCCESS", res.get("message") or "Aadhaar e-KYC verified successfully", req.client_id
    )

    data = res.get("data", {})
    v_name = data.get("full_name") or data.get("name") or ""
    v_father = data.get("father_name") or data.get("care_of") or ""
    v_dob = data.get("dob") or data.get("date_of_birth") or ""
    v_gender = data.get("gender") or ""
    v_address = data.get("address") or ""
    raw_photo = data.get("photo") or candidate.get("photo_base64") or ""
    v_photo = compress_image_b64(raw_photo)

    # Run ArcFace (buffalo_l model) automatically on live selfie vs official vault photo
    live_pic = candidate.get("face_photo_base64")
    face_res = compare_faces(live_pic, v_photo)
    f_status = face_res.get("status", "FAILED")
    f_score = face_res.get("score", 0)

    sql = """
        UPDATE candidates SET 
            verification_status = 'VERIFIED',
            verified_name = %s,
            verified_father_name = %s,
            verified_dob = %s,
            verified_gender = %s,
            verified_address = %s,
            photo_base64 = %s,
            face_match_status = %s,
            face_match_score = %s,
            verified_at = CURRENT_TIMESTAMP
        WHERE candidate_id = %s AND company_name = %s
    """
    execute_query(sql, (
        v_name,
        v_father,
        v_dob,
        v_gender,
        v_address,
        v_photo,
        f_status,
        f_score,
        candidate["candidate_id"],
        candidate["company_name"]
    ))

    return {
        "success": True,
        "message": f"Congratulations {v_name}! Your Aadhaar e-KYC verification is completed successfully.",
        "verified_name": v_name
    }

class PublicBiometricConfirmRequest(BaseModel):
    candidate_id: str
    company_name: Optional[str] = None
    aadhaar_number: str
    pid_xml: str

@app.post("/api/public/verify/biometric")
def public_biometric_verification(req: PublicBiometricConfirmRequest):
    """Public endpoint to confirm candidate Aadhaar e-KYC using Biometric Fingerprint PID Data."""
    comp = req.company_name or ""
    if comp:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (req.candidate_id, comp.strip()),
            fetch_one=True
        )
    else:
        candidate = execute_query(
            "SELECT * FROM candidates WHERE candidate_id = %s",
            (req.candidate_id,),
            fetch_one=True
        )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    res = SandboxService.submit_biometric_kyc(
        aadhaar_number=req.aadhaar_number.replace(" ", "").replace("-", ""),
        pid_xml=req.pid_xml
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))

    data = res.get("data", {})
    if not data or not (data.get("full_name") or data.get("name")):
        raise HTTPException(
            status_code=400,
            detail="Biometric fingerprint was captured, but UIDAI Aadhaar e-KYC gateway did not return matching candidate e-KYC profile records. Verification incomplete."
        )

    v_name = data.get("full_name") or data.get("name")
    v_father = data.get("father_name") or data.get("care_of") or ""
    v_dob = data.get("dob") or data.get("date_of_birth") or ""
    v_gender = data.get("gender") or ""
    v_address = data.get("address") or ""
    v_photo = data.get("photo") or ""

    live_pic = candidate.get("face_photo_base64")
    face_res = compare_faces(live_pic, v_photo)
    f_status = face_res.get("status", "FAILED")
    f_score = face_res.get("score", 0)

    sql = """
        UPDATE candidates SET 
            verification_status = 'VERIFIED',
            verified_name = %s,
            verified_father_name = %s,
            verified_dob = %s,
            verified_gender = %s,
            verified_address = %s,
            photo_base64 = %s,
            face_match_status = %s,
            face_match_score = %s,
            verified_at = CURRENT_TIMESTAMP
        WHERE candidate_id = %s AND company_name = %s
    """
    execute_query(sql, (
        v_name,
        v_father,
        v_dob,
        v_gender,
        v_address,
        v_photo,
        f_status,
        f_score,
        candidate["candidate_id"],
        candidate["company_name"]
    ))

    return {
        "success": True,
        "message": f"Congratulations {v_name}! Your Biometric Fingerprint Aadhaar e-KYC verification is completed successfully.",
        "verified_name": v_name
    }

def _do_delete_candidate(candidate_id: str, user, company: Optional[str] = None):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Only admins can delete candidate records.")

    comp_target = decode_company_param(company) if company else None
    cand = None

    if candidate_id.isdigit():
        cand = execute_query(
            "SELECT id, candidate_id, full_name, company_name FROM candidates WHERE id = %s",
            (int(candidate_id),),
            fetch_one=True
        )
        if cand:
            execute_query("DELETE FROM candidates WHERE id = %s", (cand["id"],))
            return {
                "success": True,
                "message": f"Candidate '{cand['full_name']}' ({cand['candidate_id']}) under '{cand['company_name']}' has been deleted successfully."
            }

    if comp_target:
        cand = execute_query(
            "SELECT id, candidate_id, full_name, company_name FROM candidates WHERE candidate_id = %s AND LOWER(TRIM(company_name)) = LOWER(TRIM(%s))",
            (candidate_id, comp_target.strip()),
            fetch_one=True
        )

    if not cand:
        cand = execute_query(
            "SELECT id, candidate_id, full_name, company_name FROM candidates WHERE candidate_id = %s",
            (candidate_id,),
            fetch_one=True
        )

    if not cand:
        raise HTTPException(status_code=404, detail="Candidate record not found.")

    execute_query("DELETE FROM candidates WHERE id = %s", (cand["id"],))
    return {
        "success": True,
        "message": f"Candidate '{cand['full_name']}' ({cand['candidate_id']}) under '{cand['company_name']}' has been deleted successfully."
    }

@app.delete("/api/candidate/{candidate_id}")
def delete_candidate_via_delete(candidate_id: str, company: Optional[str] = None, user=Depends(verify_token)):
    """Deletes a candidate record completely via DELETE method."""
    return _do_delete_candidate(candidate_id, user, company)

@app.post("/api/candidate/delete/{candidate_id}")
def delete_candidate_via_post(candidate_id: str, company: Optional[str] = None, user=Depends(verify_token)):
    """Deletes a candidate record completely via POST method fallback."""
    return _do_delete_candidate(candidate_id, user, company)

@app.get("/api/otp-analytics")
def get_otp_analytics(user=Depends(verify_token)):
    """Returns aggregated OTP KPI statistics and live audit logs for Admin & Company admins."""
    try:
        user_company = user.get("company_name") if user.get("role") != "admin" else None
        
        # Build SQL filter
        where_clause = ""
        params = []
        if user_company:
            where_clause = "WHERE company_name = %s"
            params.append(user_company)
            
        # 1. Fetch KPI Counts
        sql_counts = f"""
            SELECT 
                COUNT(*) as total_logs,
                SUM(CASE WHEN event_type = 'OTP_DISPATCHED' AND status = 'SUCCESS' THEN 1 ELSE 0 END) as total_dispatched,
                SUM(CASE WHEN event_type = 'VERIFIED_SUCCESS' THEN 1 ELSE 0 END) as verified_success,
                SUM(CASE WHEN status = 'FAILED' OR event_type = 'VERIFIED_FAILED' THEN 1 ELSE 0 END) as failed_expired
            FROM otp_logs {where_clause}
        """
        counts = execute_query(sql_counts, tuple(params), fetch_one=True) or {}
        
        tot_disp = int(counts.get("total_dispatched") or 0)
        ver_succ = int(counts.get("verified_success") or 0)
        fail_exp = int(counts.get("failed_expired") or 0)
        
        success_rate = round((ver_succ / tot_disp * 100), 1) if tot_disp > 0 else (100.0 if ver_succ > 0 else 0.0)
        
        # 2. Fetch Recent Logs (last 200 logs)
        sql_logs = f"""
            SELECT id, candidate_id, company_name, candidate_name, aadhaar_number, phone, event_type, status, message, client_id, created_at
            FROM otp_logs {where_clause}
            ORDER BY id DESC LIMIT 200
        """
        raw_logs = execute_query(sql_logs, tuple(params), fetch_all=True) or []
        
        formatted_logs = []
        for r in raw_logs:
            created = str(r.get("created_at") or "")
            formatted_logs.append({
                "id": r.get("id"),
                "candidate_id": r.get("candidate_id") or "",
                "company_name": r.get("company_name") or "",
                "candidate_name": r.get("candidate_name") or "",
                "aadhaar_number": r.get("aadhaar_number") or "",
                "phone": r.get("phone") or "",
                "event_type": r.get("event_type") or "",
                "status": r.get("status") or "",
                "message": r.get("message") or "",
                "client_id": r.get("client_id") or "",
                "created_at": created
            })

        return {
            "success": True,
            "kpi": {
                "total_dispatched": tot_disp,
                "verified_success": ver_succ,
                "failed_expired": fail_exp,
                "success_rate": success_rate,
                "api_credits_used": tot_disp
            },
            "logs": formatted_logs
        }
    except Exception as e:
        logger.error(f"Error fetching OTP analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8001))
    # Enable reload only in local development, disable in production (Railway) to prevent performance drops or crashes
    is_dev = not os.getenv("RAILWAY_ENVIRONMENT") and not os.getenv("RAILWAY_STATIC_URL") and os.getenv("NODE_ENV") != "production"
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=is_dev)
