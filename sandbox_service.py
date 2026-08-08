import os
import re
import time
import uuid
import base64
import logging
import threading
from datetime import datetime
import requests
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("sandbox_service")

# Sandbox.co.in Credentials
SANDBOX_API_KEY = os.getenv("SANDBOX_API_KEY", "")
SANDBOX_API_SECRET = os.getenv("SANDBOX_API_SECRET", "")
SANDBOX_BASE_URL = os.getenv("SANDBOX_BASE_URL", "https://api.sandbox.co.in")

# Fallback 1x1 transparent JPEG image in base64 format to prevent NameError
SAMPLE_BASE64_PHOTO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA="

_CACHED_TOKEN = None
_CACHED_TOKEN_EXPIRY = 0  # Unix timestamp
_TOKEN_LOCK = threading.Lock()
_RATE_LOCK = threading.Lock()
_LAST_CALL_TIME = 0.0


def normalize_masked_mobile(raw: str, msg: str = "") -> str:
    """Normalize any masked mobile number format from Sandbox API into XXXXXX-{last4}."""
    if raw:
        digits = ''.join(c for c in str(raw) if c.isdigit())
        if len(digits) >= 4:
            return f'XXXXXX-{digits[-4:]}'

    if msg:
        match = re.search(r'(?:ending\s+(?:with|in)\s*|x+|[*\-]+)(\d{4})\b', str(msg), re.IGNORECASE)
        if match:
            return f'XXXXXX-{match.group(1)}'
        match_any = re.search(r'(?:mobile|phone|number)[^\d]*(\d{4})', str(msg), re.IGNORECASE)
        if match_any:
            return f'XXXXXX-{match_any.group(1)}'

    return ''


def format_dob(raw_dob: str) -> str:
    """Safely normalizes various date formats to DD-MM-YYYY."""
    if not raw_dob:
        return ""
    clean_dob = str(raw_dob).strip().split("T")[0].replace("/", "-")
    
    # Try parsing common date string formats
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(clean_dob, fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue

    parts = clean_dob.split("-")
    if len(parts) == 3:
        if len(parts[0]) == 4:  # YYYY-MM-DD
            return f"{parts[2].zfill(2)}-{parts[1].zfill(2)}-{parts[0]}"
        elif len(parts[2]) == 4:  # DD-MM-YYYY
            return f"{parts[0].zfill(2)}-{parts[1].zfill(2)}-{parts[2]}"

    return clean_dob


class SandboxService:

    @staticmethod
    def _rate_limit_stagger():
        """Guarantees at least 600ms gap between calls to Sandbox API to respect throughput limits."""
        global _LAST_CALL_TIME
        with _RATE_LOCK:
            now = time.time()
            elapsed = now - _LAST_CALL_TIME
            if elapsed < 0.6:
                time.sleep(0.6 - elapsed)
            _LAST_CALL_TIME = time.time()

    @staticmethod
    def _get_sandbox_access_token(force_refresh: bool = False) -> str:
        """Authenticates with Sandbox.co.in API and returns cached access token (refreshes after 25 min)."""
        global _CACHED_TOKEN, _CACHED_TOKEN_EXPIRY

        if not force_refresh and _CACHED_TOKEN and time.time() < _CACHED_TOKEN_EXPIRY:
            return _CACHED_TOKEN

        with _TOKEN_LOCK:
            if not force_refresh and _CACHED_TOKEN and time.time() < _CACHED_TOKEN_EXPIRY:
                return _CACHED_TOKEN

            headers = {
                "x-api-key": SANDBOX_API_KEY,
                "x-api-secret": SANDBOX_API_SECRET,
                "x-api-version": "1.0"
            }
            try:
                res = requests.post(f"{SANDBOX_BASE_URL}/authenticate", headers=headers, timeout=10)
                if res.status_code == 200:
                    data = res.json()
                    token = data.get("access_token") or data.get("data", {}).get("access_token", "")
                    if token:
                        _CACHED_TOKEN = token
                        _CACHED_TOKEN_EXPIRY = time.time() + (25 * 60)
                        return token
                logger.error(f"Sandbox.co.in Auth failed ({res.status_code}): {res.text}")
            except Exception as e:
                logger.error(f"Sandbox.co.in Auth exception: {e}")
            return ""

    @staticmethod
    def _execute_with_retry(endpoint_url: str, payload: dict, timeout: int = 15, max_attempts: int = 3) -> tuple[int, dict]:
        """Unified HTTP runner with exponential backoff (2s, 4s) for 503/502/504 errors and timeouts."""
        last_status = 503
        last_json = {}

        for attempt in range(1, max_attempts + 1):
            # Only force token refresh if previous attempt failed specifically with 401 Unauthorized
            force_refresh = (attempt > 1 and last_status == 401)
            token = SandboxService._get_sandbox_access_token(force_refresh=force_refresh)

            if not token:
                return 401, {"message": "Failed to authenticate with Sandbox.co.in API."}

            headers = {
                "Authorization": token,
                "x-api-key": SANDBOX_API_KEY,
                "x-api-version": "1.0",
                "Content-Type": "application/json"
            }

            SandboxService._rate_limit_stagger()

            try:
                response = requests.post(endpoint_url, json=payload, headers=headers, timeout=timeout)
                last_status = response.status_code
                try:
                    last_json = response.json() if response.text else {}
                except Exception:
                    last_json = {}

                msg_str = str(last_json.get("message") or last_json.get("data", {}).get("message") or "").lower()
                is_503 = (
                    last_status in (502, 503, 504) or
                    last_json.get("code") == 503 or
                    "source unavailable" in msg_str or
                    "service unavailable" in msg_str
                )

                # Retry on 503 with exponential backoff (2s on attempt 1, 4s on attempt 2)
                if is_503 and attempt < max_attempts:
                    backoff = 2 ** attempt
                    logger.warning(f"[Sandbox] 503 Source Unavailable on {endpoint_url} (attempt {attempt}/{max_attempts}). Retrying in {backoff}s...")
                    time.sleep(backoff)
                    continue

                # Retry on 401 once by refreshing token
                if last_status == 401 and attempt < max_attempts:
                    logger.warning(f"[Sandbox] 401 Unauthorized on {endpoint_url} (attempt {attempt}/{max_attempts}). Refreshing token...")
                    time.sleep(1)
                    continue

                return last_status, last_json

            except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
                logger.warning(f"[Sandbox] Network Timeout/Connection Error on attempt #{attempt}: {exc}")
                if attempt < max_attempts:
                    time.sleep(2)
                    continue
                return 504, {"message": "Gateway Connection Timeout: UIDAI Sandbox server took longer than expected to respond."}

            except Exception as e:
                logger.error(f"[Sandbox] Unexpected exception on attempt #{attempt}: {e}", exc_info=True)
                if attempt < max_attempts:
                    time.sleep(1)
                    continue
                return 500, {"message": str(e)}

        return last_status, last_json

    @staticmethod
    def generate_otp(aadhaar_number: str) -> dict:
        """Generates real Aadhaar e-KYC OTP using Sandbox.co.in API with auto-retry on 503."""
        api_key = os.getenv("SANDBOX_API_KEY", "")
        if not api_key or "your_sandbox" in api_key:
            return {
                "success": False,
                "message": "Sandbox API key is not configured in .env. Please add a valid SANDBOX_API_KEY."
            }

        payload = {
            "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
            "aadhaar_number": aadhaar_number,
            "consent": "y",
            "reason": "Candidate Aadhaar e-KYC Verification"
        }
        endpoint_url = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp"

        status_code, res_json = SandboxService._execute_with_retry(endpoint_url, payload, timeout=15, max_attempts=3)
        
        data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else {}
        msg = data_obj.get("message") or res_json.get("message") or ""
        msg_lower = msg.lower()

        negative_keywords = [
            "invalid", "not linked", "no mobile", "not registered", "unlinked",
            "try after", "already generated", "wait", "error", "failed", "denied",
            "limit", "rejected", "duplicate", "expired"
        ]
        has_error_msg = any(kw in msg_lower for kw in negative_keywords)

        if status_code in (200, 201) and not has_error_msg:
            reference_id = (
                data_obj.get("reference_id") or 
                data_obj.get("client_id") or 
                data_obj.get("entity_id") or 
                res_json.get("transaction_id") or 
                res_json.get("reference_id") or
                res_json.get("client_id")
            )
            masked_mob = (
                data_obj.get("mobile_number") or 
                data_obj.get("masked_mobile") or 
                data_obj.get("phone") or 
                res_json.get("mobile_number") or 
                ""
            )
            if reference_id:
                return {
                    "success": True,
                    "message": msg or "Aadhaar OTP sent successfully to linked mobile!",
                    "client_id": str(reference_id),
                    "masked_mobile": normalize_masked_mobile(masked_mob, msg),
                    "is_mock": False
                }

        if status_code == 503 or res_json.get("code") == 503 or "source unavailable" in str(res_json).lower():
            return {
                "success": False,
                "is_gateway_down": True,
                "message": "UIDAI Govt Gateway is currently undergoing temporary maintenance (503 Source Unavailable). Please click 'Resend Aadhaar OTP' to receive a fresh OTP."
            }

        return {"success": False, "message": f"Gateway Notice: {msg or 'Failed to generate OTP.'}"}

    @staticmethod
    def submit_otp(client_id: str, otp: str, candidate_name: str = "", aadhaar_number: str = "", **kwargs) -> dict:
        """Verifies Aadhaar OTP using Sandbox.co.in API with auto-retry on 503 Source Unavailable."""
        api_key = os.getenv("SANDBOX_API_KEY", "")
        if not api_key or "your_sandbox" in api_key:
            return {"success": False, "message": "Sandbox API key is not configured in .env."}

        payload = {
            "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
            "reference_id": str(client_id).strip(),
            "otp": str(otp).strip()
        }
        endpoint_url = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp/verify"

        status_code, res_json = SandboxService._execute_with_retry(endpoint_url, payload, timeout=30, max_attempts=3)

        data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else (res_json.get("result") if isinstance(res_json.get("result"), dict) else {})
        msg_str = str(data_obj.get("message") or res_json.get("message") or res_json.get("detail") or "")

        if status_code in (200, 201):
            code = res_json.get("code")

            if "invalid" in msg_str.lower() or "incorrect" in msg_str.lower() or "failed" in msg_str.lower() or data_obj.get("status") in ("INVALID", "FAILED"):
                return {"success": False, "message": f"Verification Failed: {msg_str or 'Invalid OTP code. Please enter the correct 6-digit OTP.'}"}

            if (code == 200 or str(code) == "200" or code is None) and data_obj and (data_obj.get("name") or data_obj.get("full_name") or data_obj.get("photo")):
                name = data_obj.get("name") or data_obj.get("full_name") or ""
                raw_dob = data_obj.get("dob") or data_obj.get("date_of_birth") or data_obj.get("dateOfBirth") or ""
                
                raw_care_of = (
                    data_obj.get("father_name") or 
                    data_obj.get("care_of") or 
                    data_obj.get("co") or 
                    data_obj.get("fatherName") or ""
                )
                
                raw_address = data_obj.get("address") or data_obj.get("split_address") or data_obj.get("full_address")
                if isinstance(raw_address, dict) and not raw_care_of:
                    raw_care_of = raw_address.get("care_of") or raw_address.get("co") or ""

                father_name = str(raw_care_of).replace("C/O:", "").replace("S/O:", "").replace("D/O:", "").replace("C/O", "").replace("S/O", "").replace("D/O", "").strip()
                dob = format_dob(raw_dob)

                raw_gender = str(data_obj.get("gender") or "").strip().upper()
                if raw_gender in ("M", "MALE"):
                    gender = "MALE"
                elif raw_gender in ("F", "FEMALE"):
                    gender = "FEMALE"
                elif raw_gender in ("O", "OTHER"):
                    gender = "OTHER"
                else:
                    gender = raw_gender

                photo_raw = (
                    data_obj.get("photo") or
                    data_obj.get("photo_link") or
                    data_obj.get("profile_image") or
                    data_obj.get("image") or
                    data_obj.get("user_photo") or
                    data_obj.get("face_image") or
                    data_obj.get("aadhaar_photo") or
                    data_obj.get("photo_base64") or
                    data_obj.get("profile_photo") or
                    res_json.get("photo") or
                    res_json.get("photo_link") or
                    res_json.get("image") or ""
                )
                
                photo_base64 = ""
                if isinstance(photo_raw, str) and photo_raw.strip():
                    clean_p = photo_raw.strip()
                    if clean_p.startswith("http://") or clean_p.startswith("https://"):
                        try:
                            token = SandboxService._get_sandbox_access_token()
                            p_headers = {"x-api-key": SANDBOX_API_KEY, "Authorization": token}
                            p_res = requests.get(clean_p, headers=p_headers, timeout=8)
                            if p_res.status_code == 200:
                                p_b64 = base64.b64encode(p_res.content).decode("utf-8")
                                photo_base64 = f"data:image/jpeg;base64,{p_b64}"
                        except Exception as _pe:
                            logger.warning(f"Error fetching Sandbox photo URL: {_pe}")
                    elif clean_p.startswith("data:image"):
                        photo_base64 = clean_p
                    else:
                        photo_base64 = f"data:image/jpeg;base64,{clean_p}"

                if not photo_base64:
                    photo_base64 = SAMPLE_BASE64_PHOTO

                if isinstance(raw_address, dict):
                    filtered_parts = [
                        str(v) for k, v in raw_address.items()
                        if v and not str(k).startswith("@") and "in.co.sandbox" not in str(v)
                    ]
                    address = ", ".join(filtered_parts)
                else:
                    address = str(raw_address) if raw_address else ""

                return {
                    "success": True,
                    "message": "Aadhaar e-KYC verified successfully via Sandbox.co.in!",
                    "data": {
                        "full_name": name,
                        "father_name": father_name,
                        "dob": dob,
                        "gender": gender,
                        "address": address,
                        "photo": photo_base64
                    },
                    "is_mock": False
                }
            else:
                msg = data_obj.get("message") or res_json.get("message") or "OTP verification failed."
                if "Source Unavailable" in str(msg) or code == 503:
                    msg = "UIDAI Govt Aadhaar Gateway is currently undergoing temporary maintenance (503 Source Unavailable). Please retry in a few minutes."
                return {"success": False, "message": f"Sandbox API: {msg}"}

        elif status_code in (400, 422) or res_json.get("code") in (400, 422):
            msg = res_json.get("message") or "Invalid reference_id"
            if "Invalid reference_id" in msg or "invalid" in msg.lower():
                msg = "The OTP reference session has expired or is invalid. Please click 'Resend Aadhaar OTP' below to get a new OTP."
            return {"success": False, "message": f"Sandbox API ({status_code}): {msg}"}

        elif status_code == 503 or res_json.get("code") == 503 or "Source Unavailable" in str(res_json):
            return {
                "success": False,
                "message": "UIDAI Govt Aadhaar Gateway is currently undergoing temporary maintenance (503 Source Unavailable). Please retry in a few minutes."
            }

        else:
            msg = res_json.get("message") or "Sandbox API returned error."
            return {"success": False, "message": f"Sandbox API error ({status_code}): {msg}"}

    @staticmethod
    def submit_biometric_kyc(aadhaar_number: str, pid_xml: str) -> dict:
        """Verifies Aadhaar e-KYC using Biometric Fingerprint PID Data via Sandbox API with auto-retry on 503."""
        api_key = os.getenv("SANDBOX_API_KEY", "")
        if not api_key or "your_sandbox" in api_key:
            return {"success": False, "message": "Sandbox API key is not configured in .env."}

        payload = {
            "@entity": "in.co.sandbox.kyc.aadhaar.okyc.biometric.request",
            "aadhaar_number": aadhaar_number,
            "biometric_data": pid_xml,
            "consent": "y",
            "reason": "Biometric Aadhaar e-KYC Verification"
        }

        endpoint_primary = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/biometric/verify"
        status_code, res_json = SandboxService._execute_with_retry(endpoint_primary, payload, timeout=20, max_attempts=3)

        # Fallback endpoint if primary gives 404
        if status_code == 404:
            endpoint_fallback = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/biometric"
            status_code, res_json = SandboxService._execute_with_retry(endpoint_fallback, payload, timeout=20, max_attempts=3)

        data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else {}
        msg_str = str(data_obj.get("message") or res_json.get("message") or "")

        if status_code in (200, 201) and (data_obj.get("name") or data_obj.get("photo") or data_obj.get("full_name")):
            name = data_obj.get("name") or data_obj.get("full_name") or ""
            raw_dob = data_obj.get("dob") or data_obj.get("date_of_birth") or ""
            raw_care_of = data_obj.get("father_name") or data_obj.get("care_of") or ""
            raw_address = data_obj.get("address") or ""
            raw_gender = data_obj.get("gender") or ""
            photo_raw = data_obj.get("photo_link") or data_obj.get("photo") or ""

            father_name = str(raw_care_of).replace("C/O:", "").replace("S/O:", "").replace("D/O:", "").strip()
            dob = format_dob(raw_dob)
            gender = "MALE" if str(raw_gender).lower() in ("m", "male") else ("FEMALE" if str(raw_gender).lower() in ("f", "female") else str(raw_gender).upper())
            photo_base64 = f"data:image/jpeg;base64,{photo_raw}" if photo_raw and not photo_raw.startswith("data:image") else photo_raw

            return {
                "success": True,
                "message": "Biometric Aadhaar e-KYC verified successfully!",
                "data": {
                    "full_name": name,
                    "father_name": father_name,
                    "dob": dob,
                    "gender": gender,
                    "address": str(raw_address),
                    "photo": photo_base64 or SAMPLE_BASE64_PHOTO
                },
                "is_mock": False
            }

        return {"success": False, "message": f"Biometric e-KYC failed: {msg_str or 'UIDAI Biometric gateway error or invalid biometric PID.'}"}