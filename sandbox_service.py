import os
import requests
import uuid
import logging
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("sandbox_service")

# Sandbox.co.in Credentials
SANDBOX_API_KEY = os.getenv("SANDBOX_API_KEY", "")
SANDBOX_API_SECRET = os.getenv("SANDBOX_API_SECRET", "")
SANDBOX_BASE_URL = os.getenv("SANDBOX_BASE_URL", "https://api.sandbox.co.in")


def normalize_masked_mobile(raw: str, msg: str = "") -> str:
    """Normalize any masked mobile number format from Sandbox API into XXXXXX-{last4}.
    Inspects both explicit raw field and response message string.
    Examples:
      'XXXXXXX7689'   -> 'XXXXXX-7689'
      'ending with 9313' -> 'XXXXXX-9313'
      ''              -> ''
    """
    import re
    # 1. Try raw field first
    if raw:
        digits = ''.join(c for c in str(raw) if c.isdigit())
        if len(digits) >= 4:
            return f'XXXXXX-{digits[-4:]}'

    # 2. Try parsing message string for 4-digit suffix patterns
    if msg:
        # Match 'ending with 9313', 'ending in 9313', 'XXXXXX9313', 'XXXX-XXXX-9313'
        match = re.search(r'(?:ending\s+(?:with|in)\s*|x+|[*\-]+)(\d{4})\b', str(msg), re.IGNORECASE)
        if match:
            return f'XXXXXX-{match.group(1)}'
        # Match any 4 digits following 'mobile' or 'phone' or 'number'
        match_any = re.search(r'(?:mobile|phone|number)[^\d]*(\d{4})', str(msg), re.IGNORECASE)
        if match_any:
            return f'XXXXXX-{match_any.group(1)}'

    return ''


import threading
import time

_CACHED_TOKEN = None
_CACHED_TOKEN_EXPIRY = 0  # Unix timestamp when token expires
_SANDBOX_LOCK = threading.Lock()
_LAST_CALL_TIME = 0.0

class SandboxService:

    _SANDBOX_LOCK = threading.Lock()
    _LAST_CALL_TIME = 0.0

    @staticmethod
    def _rate_limit_stagger():
        """Guarantees at least 600ms gap between calls to Sandbox API to prevent 503 Source Unavailable burst errors."""
        now = time.time()
        elapsed = now - SandboxService._LAST_CALL_TIME
        if elapsed < 0.6:
            time.sleep(0.6 - elapsed)
        SandboxService._LAST_CALL_TIME = time.time()

    @staticmethod
    def _get_sandbox_access_token(force_refresh: bool = False) -> str:
        """Authenticates with Sandbox.co.in API and returns cached access token (refreshes after 25 min)."""
        global _CACHED_TOKEN, _CACHED_TOKEN_EXPIRY
        with SandboxService._SANDBOX_LOCK:
            # Return cached token if still valid (expire after 25 minutes) unless force_refresh is requested
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
                        _CACHED_TOKEN_EXPIRY = time.time() + (25 * 60)  # Cache for 25 minutes
                        return token
                logger.error(f"Sandbox.co.in Auth failed ({res.status_code}): {res.text}")
            except Exception as e:
                logger.error(f"Sandbox.co.in Auth exception: {e}")
            return ""

    @staticmethod
    def generate_otp(aadhaar_number: str) -> dict:
        """Generates real Aadhaar e-KYC OTP using Sandbox.co.in API with auto-retry on 503."""
        import time
        api_key = os.getenv("SANDBOX_API_KEY", "")
        has_sandbox = bool(api_key and "your_sandbox" not in api_key)

        if not has_sandbox:
            return {
                "success": False,
                "message": "Sandbox API key is not configured in .env. Please add a valid SANDBOX_API_KEY."
            }

        max_attempts = 2
        for attempt in range(1, max_attempts + 1):
            try:
                token = SandboxService._get_sandbox_access_token(force_refresh=(attempt > 1))
                if not token:
                    return {"success": False, "message": "Failed to authenticate with Sandbox.co.in API. Check SANDBOX_API_KEY in .env."}

                headers = {
                    "Authorization": token,
                    "x-api-key": SANDBOX_API_KEY,
                    "x-api-version": "1.0",
                    "Content-Type": "application/json"
                }
                payload = {
                    "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
                    "aadhaar_number": aadhaar_number,
                    "consent": "y",
                    "reason": "Candidate Aadhaar e-KYC Verification"
                }

                # Try Primary OKYC Endpoint first, then Fallback V2 Endpoint on attempt 2
                endpoint_url = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp" if attempt == 1 else f"{SANDBOX_BASE_URL}/kyc/aadhaar/v2/otp"
                if attempt > 1:
                    payload["@entity"] = "in.co.sandbox.kyc.aadhaar.v2.otp.request"

                SandboxService._rate_limit_stagger()

                response = requests.post(
                    endpoint_url,
                    json=payload,
                    headers=headers,
                    timeout=12
                )

                res_json = response.json()
                logger.info(f"Sandbox.co.in generate_otp response attempt #{attempt} ({response.status_code}): {res_json}")

                data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else {}
                msg = data_obj.get("message") or res_json.get("message") or ""
                msg_lower = msg.lower()

                # If 503 Source Unavailable occurs on attempt 1, sleep 1.2s and retry with failover endpoint
                if (response.status_code == 503 or res_json.get("code") == 503 or "source unavailable" in msg_lower) and attempt < max_attempts:
                    logger.warning(f"[Sandbox] Got 503 Source Unavailable on generate_otp attempt #{attempt}. Retrying with failover endpoint in 1.2 seconds...")
                    time.sleep(1.2)
                    continue

                negative_keywords = [
                    "invalid", "not linked", "no mobile", "not registered", "unlinked",
                    "try after", "already generated", "wait", "error", "failed", "denied",
                    "unavailable", "limit", "rejected", "duplicate", "expired"
                ]
                has_error_msg = any(kw in msg_lower for kw in negative_keywords)

                if response.status_code in (200, 201) and not has_error_msg:
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

                if response.status_code == 503 or res_json.get("code") == 503 or "Source Unavailable" in str(res_json):
                    return {
                        "success": False,
                        "is_gateway_down": True,
                        "message": "UIDAI Govt Gateway is currently undergoing temporary maintenance (503 Source Unavailable). Please click 'Resend Aadhaar OTP' to receive a fresh OTP."
                    }

                return {"success": False, "message": f"Gateway Notice: {msg or 'Failed to verify OTP.'}"}

            except requests.exceptions.Timeout:
                if attempt < max_attempts:
                    logger.warning(f"Timeout in generate_otp on attempt #{attempt}. Retrying...")
                    time.sleep(1)
                    continue
                return {
                    "success": False,
                    "message": "Gateway Connection Timeout: UIDAI Sandbox server took longer than expected to respond. Please click [ VERIFY OTP ] again."
                }
            except Exception as e:
                logger.error(f"Error in generate_otp attempt #{attempt}: {e}", exc_info=True)
                if attempt < max_attempts:
                    time.sleep(1)
                    continue
                clean_err = str(e)
                if "Read timed out" in clean_err or "timeout" in clean_err.lower():
                    clean_err = "UIDAI Sandbox server took longer than expected to respond. Please try again."
                return {"success": False, "message": f"Sandbox API connection error: {clean_err}"}

        return {"success": False, "message": "UIDAI server temporary disruption. Please click [Resend Aadhaar OTP] for a fresh code."}

    @staticmethod
    def submit_otp(client_id: str, otp: str, candidate_name: str = "", aadhaar_number: str = "", **kwargs) -> dict:
        """Verifies Aadhaar OTP using Sandbox.co.in API with auto-retry on 503 Source Unavailable."""
        import time
        api_key = os.getenv("SANDBOX_API_KEY", "")
        has_sandbox = bool(api_key and "your_sandbox" not in api_key)

        if not has_sandbox:
            return {"success": False, "message": "Sandbox API key is not configured in .env."}

        max_attempts = 2
        for attempt in range(1, max_attempts + 1):
            try:
                token = SandboxService._get_sandbox_access_token(force_refresh=(attempt > 1))
                if not token:
                    return {"success": False, "message": "Failed to authenticate with Sandbox.co.in API."}

                headers = {
                    "Authorization": token,
                    "x-api-key": SANDBOX_API_KEY,
                    "x-api-version": "1.0",
                    "Content-Type": "application/json"
                }

                ref_id = str(client_id).strip()

                payload = {
                    "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
                    "reference_id": ref_id,
                    "otp": str(otp).strip()
                }

                # Primary OKYC Verify Endpoint
                endpoint_url = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp/verify"
                if attempt > 1:
                    payload["@entity"] = "in.co.sandbox.kyc.aadhaar.v2.request"
                    endpoint_url = f"{SANDBOX_BASE_URL}/kyc/aadhaar/v2/otp/verify"

                SandboxService._rate_limit_stagger()

                response = requests.post(
                    endpoint_url,
                    json=payload,
                    headers=headers,
                    timeout=30
                )

                res_json = response.json()
                logger.info(f"Sandbox.co.in submit_otp response attempt #{attempt} ({response.status_code}): {res_json}")

                data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else (res_json.get("result") if isinstance(res_json.get("result"), dict) else {})
                msg_str = str(data_obj.get("message") or res_json.get("message") or res_json.get("detail") or "")

                # If 503 Source Unavailable occurs on attempt #1, sleep 1.2s and retry with failover endpoint
                if (response.status_code == 503 or res_json.get("code") == 503 or "source unavailable" in msg_str.lower()) and attempt < max_attempts:
                    logger.warning(f"[Sandbox] Got 503 Source Unavailable on submit_otp attempt #{attempt}. Retrying with failover endpoint in 1.2 seconds...")
                    time.sleep(1.2)
                    continue

                if response.status_code in (200, 201):
                    code = res_json.get("code")

                    # Check for Invalid / Incorrect OTP or Status Failed
                    if "invalid" in msg_str.lower() or "incorrect" in msg_str.lower() or "failed" in msg_str.lower() or data_obj.get("status") in ("INVALID", "FAILED"):
                        return {"success": False, "message": f"Verification Failed: {msg_str or 'Invalid OTP code. Please enter the correct 6-digit OTP.'}"}

                    if (code == 200 or str(code) == "200" or code is None) and data_obj and (data_obj.get("name") or data_obj.get("full_name") or data_obj.get("photo")):
                        # Extract verified details
                        name = data_obj.get("name") or data_obj.get("full_name") or ""
                        raw_dob = data_obj.get("dob") or data_obj.get("date_of_birth") or data_obj.get("dateOfBirth") or ""
                        
                        # Extract Father Name / Care Of
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

                        # Standardize DOB to DD-MM-YYYY
                        dob = ""
                        if raw_dob:
                            clean_dob = str(raw_dob).strip().replace("/", "-")
                            parts = clean_dob.split("-")
                            if len(parts) == 3:
                                if len(parts[0]) == 4:  # YYYY-MM-DD -> DD-MM-YYYY
                                    dob = f"{parts[2].zfill(2)}-{parts[1].zfill(2)}-{parts[0]}"
                                elif len(parts[2]) == 4:  # DD-MM-YYYY
                                    dob = f"{parts[0].zfill(2)}-{parts[1].zfill(2)}-{parts[2]}"
                                else:
                                    dob = clean_dob
                            else:
                                dob = clean_dob

                        # Standardize Gender (M -> MALE, F -> FEMALE)
                        raw_gender = str(data_obj.get("gender") or "").strip().upper()
                        if raw_gender in ("M", "MALE"):
                            gender = "MALE"
                        elif raw_gender in ("F", "FEMALE"):
                            gender = "FEMALE"
                        elif raw_gender in ("O", "OTHER"):
                            gender = "OTHER"
                        else:
                            gender = raw_gender

                        photo_raw = data_obj.get("photo_link") or data_obj.get("photo") or data_obj.get("profile_image") or ""
                        
                        # Ensure base64 data URI format for image tag rendering safely
                        if isinstance(photo_raw, str) and photo_raw and not photo_raw.startswith("data:image"):
                            photo_base64 = f"data:image/jpeg;base64,{photo_raw}"
                        elif isinstance(photo_raw, str) and photo_raw:
                            photo_base64 = photo_raw
                        else:
                            photo_base64 = SAMPLE_BASE64_PHOTO

                        # Clean address formatting
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
                elif response.status_code in (400, 422) or res_json.get("code") in (400, 422):
                    msg = res_json.get("message") or "Invalid reference_id"
                    if "Invalid reference_id" in msg or "invalid" in msg.lower():
                        msg = "The OTP reference session has expired or is invalid. Please click 'Resend Aadhaar OTP' below to get a new OTP."
                    return {"success": False, "message": f"Sandbox API ({response.status_code}): {msg}"}
                elif response.status_code == 503 or res_json.get("code") == 503 or "Source Unavailable" in str(res_json):
                    if attempt < max_attempts:
                        logger.warning(f"[Sandbox] Got 503 Source Unavailable on submit_otp attempt #{attempt}. Retrying in 1.2s...")
                        time.sleep(1.2)
                        continue
                    return {
                        "success": False,
                        "message": "UIDAI Govt Aadhaar Gateway is currently undergoing temporary maintenance (503 Source Unavailable). Please retry in a few minutes."
                    }
                else:
                    msg = res_json.get("message") or "Sandbox API returned error."
                    return {"success": False, "message": f"Sandbox API error ({response.status_code}): {msg}"}

            except requests.exceptions.Timeout:
                if attempt < max_attempts:
                    logger.warning(f"Timeout in submit_otp attempt #{attempt}. Retrying in 1s...")
                    time.sleep(1)
                    continue
                return {
                    "success": False,
                    "message": "Gateway Connection Timeout: UIDAI Sandbox server took longer than expected to respond. Please click [ VERIFY OTP ] again."
                }
            except Exception as e:
                logger.error(f"Sandbox API submit_otp exception attempt #{attempt}: {e}")
                if attempt < max_attempts:
                    time.sleep(1)
                    continue
                clean_err = str(e)
                if "Read timed out" in clean_err or "timeout" in clean_err.lower():
                    clean_err = "UIDAI Sandbox server took longer than expected to respond. Please click [ VERIFY OTP ] again."
                return {"success": False, "message": f"Sandbox API connection error: {clean_err}"}

        return {"success": False, "message": "UIDAI server temporary disruption. Please click [Resend Aadhaar OTP] for a fresh code."}

    @staticmethod
    def submit_biometric_kyc(aadhaar_number: str, pid_xml: str) -> dict:
        """Verifies Aadhaar e-KYC using Biometric Fingerprint PID Data via Sandbox API."""
        api_key = os.getenv("SANDBOX_API_KEY", "")
        has_sandbox = bool(api_key and "your_sandbox" not in api_key)

        if not has_sandbox:
            return {"success": False, "message": "Sandbox API key is not configured in .env."}

        try:
            token = SandboxService._get_sandbox_access_token()
            if not token:
                return {"success": False, "message": "Failed to authenticate with Sandbox API."}

            headers = {
                "Authorization": token,
                "x-api-key": SANDBOX_API_KEY,
                "x-api-version": "1.0",
                "Content-Type": "application/json"
            }
            payload = {
                "@entity": "in.co.sandbox.kyc.aadhaar.okyc.biometric.request",
                "aadhaar_number": aadhaar_number,
                "biometric_data": pid_xml,
                "consent": "y",
                "reason": "Biometric Aadhaar e-KYC Verification"
            }

            # Try primary biometric endpoint first: /kyc/aadhaar/okyc/biometric/verify
            endpoint = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/biometric/verify"
            response = requests.post(endpoint, json=payload, headers=headers, timeout=18)
            
            # If 404 Not Found, try fallback endpoint /kyc/aadhaar/okyc/biometric
            if response.status_code == 404:
                endpoint = f"{SANDBOX_BASE_URL}/kyc/aadhaar/okyc/biometric"
                response = requests.post(endpoint, json=payload, headers=headers, timeout=18)

            logger.info(f"Sandbox.co.in submit_biometric_kyc ({endpoint}) response ({response.status_code}): {response.text}")

            res_json = response.json() if response.text else {}
            data_obj = res_json.get("data") if isinstance(res_json.get("data"), dict) else {}
            msg_str = str(data_obj.get("message") or res_json.get("message") or "")

            if response.status_code in (200, 201) and (data_obj.get("name") or data_obj.get("photo") or data_obj.get("full_name")):
                name = data_obj.get("name") or data_obj.get("full_name") or ""
                raw_dob = data_obj.get("dob") or data_obj.get("date_of_birth") or ""
                raw_care_of = data_obj.get("father_name") or data_obj.get("care_of") or ""
                raw_address = data_obj.get("address") or ""
                raw_gender = data_obj.get("gender") or ""
                photo_raw = data_obj.get("photo_link") or data_obj.get("photo") or ""

                father_name = str(raw_care_of).replace("C/O:", "").replace("S/O:", "").replace("D/O:", "").strip()
                dob = str(raw_dob).strip().replace("/", "-")
                gender = "Male" if str(raw_gender).lower() in ("m", "male") else ("Female" if str(raw_gender).lower() in ("f", "female") else str(raw_gender))
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

        except Exception as e:
            logger.error(f"Error in submit_biometric_kyc: {e}", exc_info=True)
            return {"success": False, "message": f"Biometric Gateway Error: {str(e)}"}
