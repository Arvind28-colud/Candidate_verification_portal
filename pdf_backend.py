import os
import sys

# Sanitize PATH to remove Tesseract-OCR directory which contains incompatible GLib/GObject DLLs
# that conflict with GTK/WeasyPrint and cause Windows entry point errors (libgobject-2.0-0.dll).
if "PATH" in os.environ:
    paths = os.environ["PATH"].split(os.pathsep)
    cleaned = [p for p in paths if "tesseract-ocr" not in p.lower()]
    os.environ["PATH"] = os.pathsep.join(cleaned)

import io
import re
import datetime
import zipfile

try:
    from jinja2 import Environment, FileSystemLoader
    HAS_JINJA = True
except Exception:
    HAS_JINJA = False

try:
    from weasyprint import HTML
    HAS_WEASYPRINT = True
except Exception:
    HAS_WEASYPRINT = False

try:
    from xhtml2pdf import pisa
    HAS_XHTML2PDF = True
except Exception:
    HAS_XHTML2PDF = False

gtk_path = r"C:\Program Files\GTK3-Runtime Win64\bin"
if os.path.exists(gtk_path):
    try:
        os.add_dll_directory(gtk_path)
    except Exception:
        pass

def format_clean_name(name_str, fallback="-"):
    if not name_str or not isinstance(name_str, str):
        return fallback
    cleaned = name_str.strip()
    cleaned = re.sub(r'^(MR|SRI|S|D|W)/O\s*', '', cleaned, flags=re.IGNORECASE).strip()
    return cleaned or fallback


def build_candidate_report_html(candidate, company_name=""):
    current_company_name = candidate.get("company_name") or company_name or "Candidate Verification Portal"
    is_verified = candidate.get("verification_status") == "VERIFIED"
    is_failed = candidate.get("verification_status") == "FAILED" or candidate.get("face_match_status") == "MISMATCH"

    cand_full_name = format_clean_name(candidate.get("full_name") or candidate.get("verified_name") or candidate.get("name"), "Candidate")
    reg_father = format_clean_name(candidate.get("reg_father_name") or candidate.get("father_name"), "Not Provided")
    ver_name = format_clean_name(candidate.get("verified_name") or candidate.get("full_name") or candidate.get("name"), "Not Verified")
    ver_father = format_clean_name(candidate.get("verified_father_name") or candidate.get("reg_father_name") or candidate.get("father_name"), "Not Provided")
    ver_dob = candidate.get("verified_dob") or candidate.get("reg_dob") or "-"
    ver_gender = candidate.get("verified_gender") or candidate.get("reg_gender") or "-"
    ver_address = candidate.get("verified_address") or candidate.get("reg_address") or "-"

    default_face_img = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><rect width='100%' height='100%' fill='%2372f772'/></svg>"
    default_aadhaar_img = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='220' viewBox='0 0 500 220'><rect width='100%' height='100%' fill='%2372f772'/></svg>"

    live_selfie = candidate.get("face_photo_base64") or default_face_img
    vault_photo = candidate.get("photo_base64") or default_face_img
    aadhaar_front = candidate.get("aadhaar_front_base64") or default_aadhaar_img
    aadhaar_back = candidate.get("aadhaar_back_base64") or default_aadhaar_img

    def get_name_match_text():
        reg = (cand_full_name or "").upper()
        ver = (ver_name or "").upper()
        if not reg or not ver or ver == "NOT VERIFIED":
            return 'NO DATA'
        if reg == ver:
            return 'MATCH ✓'
        return 'MISMATCH ✕'

    def get_father_match_text():
        reg_raw = (reg_father or "").upper()
        ver_raw = (ver_father or "").upper()
        if not reg_raw or not ver_raw or reg_raw == "NOT PROVIDED" or ver_raw == "NOT PROVIDED":
            return 'NO DATA'
        if reg_raw == ver_raw:
            return 'MATCH ✓'
        return 'MISMATCH ✕'

    def get_face_match_text():
        status = candidate.get("face_match_status")
        score = candidate.get("face_match_score")
        if not live_selfie or not vault_photo or live_selfie == default_face_img:
            return 'NO DATA'
        if status == "MISMATCH" or (score is not None and score > 0 and score < 55):
            return f"MISMATCH ✕ ({score}%)" if score else "MISMATCH ✕"
        if status == "MATCH" or (score is not None and score >= 55) or is_verified:
            return f"MATCH ✓ ({score}%)" if score else "MATCH ✓"
        return 'MISMATCH ✕'

    def get_dob_match_text():
        reg = (candidate.get("reg_dob") or "").strip()
        ver = (candidate.get("verified_dob") or "").strip()
        if not reg or not ver:
            return 'NO DATA'
        if reg == ver:
            return 'MATCH ✓'
        return 'MISMATCH ✕'

    def get_card_match_text():
        status = (candidate.get("card_ocr_status") or "").upper()
        if status == "MATCH":
            return 'MATCH ✓'
        if status == "MISMATCH":
            return 'MISMATCH ✕'
        if status in ("BLUR", "BLANK"):
            return 'BLUR / BLANK ⚠'
        if status == "NO_CARD":
            return 'NO CARD'
        has_front = candidate.get("aadhaar_front_base64")
        has_back = candidate.get("aadhaar_back_base64")
        if not has_front and not has_back:
            return 'NO CARD'
        return 'UNREADABLE ✕'

    aadhaar_num = str(candidate.get("aadhaar_number") or "")
    masked_aadhaar = f"XXXX-XXXX-{aadhaar_num[-4:]}" if len(aadhaar_num) >= 4 else "XXXX-XXXX-XXXX"
    date_str = datetime.datetime.now().strftime("%d/%m/%Y")

    if is_verified:
        status_text = 'VERIFIED ✓'
        status_badge = 'VERIFIED e-KYC ✓'
    elif is_failed:
        status_text = 'FAILED ✕'
        status_badge = 'FAILED ✕'
    else:
        status_text = 'PENDING ⚠'
        status_badge = 'PENDING ⚠'

    template_dir = os.path.join(os.path.dirname(__file__), "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template.html")

    render_data = {
        "company_header": current_company_name,
        "candidate_id": str(candidate.get("candidate_id") or candidate.get("id") or "-"),
        "verification_status": status_badge,
        "report_date": date_str,
        "selfie_url": live_selfie,
        "vault_photo_url": vault_photo,
        "reg_company": current_company_name,
        "reg_project": str(candidate.get("reg_project_name") or candidate.get("project_name") or "-"),
        "reg_name": cand_full_name,
        "reg_father_name": reg_father,
        "reg_mobile": str(candidate.get("phone") or "-"),
        "reg_aadhaar": masked_aadhaar,
        "reg_dob": str(candidate.get("reg_dob") or "-"),
        "reg_address": str(candidate.get("reg_address") or "-"),
        "vault_name": ver_name,
        "vault_father_name": ver_father,
        "vault_dob": str(ver_dob),
        "vault_gender": str(ver_gender),
        "vault_aadhaar": masked_aadhaar,
        "vault_address": str(ver_address),
        "vault_verified_at": str(candidate.get("verified_at") or "Verified"),
        "card_front_url": aadhaar_front,
        "card_back_url": aadhaar_back,
        "matrix": {
            "name_match": get_name_match_text(),
            "father_match": get_father_match_text(),
            "face_match": get_face_match_text(),
            "dob_match": get_dob_match_text(),
            "card_match": get_card_match_text(),
            "aadhaar_status": status_text,
        }
    }

    return template.render(**render_data)


def generate_candidate_pdf_bytes(candidate_data, company_name=""):
    html_content = build_candidate_report_html(candidate_data, company_name)
    if HAS_WEASYPRINT:
        return HTML(string=html_content).write_pdf()
    
    out_buf = io.BytesIO()
    if HAS_XHTML2PDF:
        pisa.CreatePDF(io.StringIO(html_content), dest=out_buf)
        return out_buf.getvalue()
        
    raise RuntimeError("No PDF generation engine (WeasyPrint / xhtml2pdf) available.")


def generate_bulk_pdfs_zip_bytes(candidates_list, company_name="", district_name="ALL"):
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for cand in candidates_list:
            try:
                clean_name = re.sub(r'[^a-zA-Z0-9]', '_', (cand.get("full_name") or cand.get("verified_name") or "Candidate").strip())
                clean_phone = re.sub(r'\D', '', str(cand.get("phone") or ""))
                clean_aadhaar = re.sub(r'\D', '', str(cand.get("aadhaar_number") or ""))
                parts = [clean_name]
                if clean_phone:
                    parts.append(clean_phone)
                if clean_aadhaar:
                    parts.append(clean_aadhaar)
                filename = f"{'_'.join(parts)}.pdf"
                pdf_bytes = generate_candidate_pdf_bytes(cand, company_name)
                zip_file.writestr(filename, pdf_bytes)
            except Exception as e:
                print(f"Error adding candidate {cand.get('candidate_id')} to ZIP: {e}")

    return zip_buffer.getvalue()