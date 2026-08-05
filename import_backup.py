import json
import sys
import logging
from urllib.parse import urlparse
import db
from db import execute_query, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("import_backup")

def parse_mysql_url(url_str: str):
    """Parses mysql://user:pass@host:port/db URL and configures db.py credentials."""
    if not url_str or not url_str.startswith("mysql"):
        return
    try:
        parsed = urlparse(url_str)
        db.DB_HOST = parsed.hostname or db.DB_HOST
        db.DB_PORT = parsed.port or db.DB_PORT or 3306
        db.DB_USER = parsed.username or db.DB_USER
        db.DB_PASSWORD = parsed.password or db.DB_PASSWORD
        db.DB_NAME = (parsed.path or "").strip("/") or db.DB_NAME
        logger.info(f"Connected to MySQL: {db.DB_HOST}:{db.DB_PORT}/{db.DB_NAME} (User: {db.DB_USER})")
    except Exception as e:
        logger.warning(f"Could not parse MySQL URL: {e}")

def restore_from_json(json_filepath: str, mysql_url: str = None, clear_db: bool = False):
    """Imports candidate records and all Base64 images directly into the active database."""
    if mysql_url:
        parse_mysql_url(mysql_url)
    init_db()
    try:
        with open(json_filepath, "r", encoding="utf-8") as f:
            candidates = json.load(f)
        
        if not candidates:
            logger.info("No candidates found in backup file.")
            return

        if clear_db:
            logger.info("🧹 Clearing existing candidate records from database before import...")
            execute_query("DELETE FROM candidates;")

        logger.info(f"Importing/Updating {len(candidates)} candidate records and Base64 images into database...")
        imported = 0
        updated = 0

        for c in candidates:
            cid = c.get("candidate_id")
            comp = c.get("company_name") or "Keen Sighted Workforce Services"
            if not cid:
                continue

            face_pic = c.get("face_photo_base64") or ""
            front_pic = c.get("aadhaar_front_base64") or ""
            back_pic = c.get("aadhaar_back_base64") or ""
            vault_pic = c.get("photo_base64") or ""

            # Check if candidate already exists
            existing = execute_query(
                "SELECT id FROM candidates WHERE candidate_id = %s",
                (cid,),
                fetch_one=True
            )

            if existing:
                # Update candidate record & all Base64 photos
                update_sql = """
                    UPDATE candidates SET
                        company_name = %s,
                        full_name = %s,
                        reg_father_name = %s,
                        father_name = %s,
                        email = %s,
                        phone = %s,
                        aadhaar_number = %s,
                        reg_dob = %s,
                        reg_gender = %s,
                        reg_address = %s,
                        reg_state = %s,
                        reg_district = %s,
                        reg_designation = %s,
                        face_photo_base64 = %s,
                        aadhaar_front_base64 = %s,
                        aadhaar_back_base64 = %s,
                        photo_base64 = %s,
                        verification_status = %s,
                        client_ref_id = %s,
                        verified_name = %s,
                        verified_father_name = %s,
                        verified_dob = %s,
                        verified_gender = %s,
                        verified_address = %s,
                        card_ocr_status = %s,
                        card_ocr_name = %s
                    WHERE candidate_id = %s
                """
                execute_query(update_sql, (
                    comp,
                    c.get("full_name") or "",
                    c.get("reg_father_name") or c.get("father_name") or "",
                    c.get("father_name") or c.get("reg_father_name") or "",
                    c.get("email") or "",
                    c.get("phone") or "",
                    c.get("aadhaar_number") or "",
                    c.get("reg_dob") or "",
                    c.get("reg_gender") or "",
                    c.get("reg_address") or "",
                    c.get("reg_state") or c.get("state") or "",
                    c.get("reg_district") or c.get("district") or "",
                    c.get("reg_designation") or c.get("designation") or "",
                    face_pic,
                    front_pic,
                    back_pic,
                    vault_pic,
                    c.get("verification_status") or "PENDING",
                    c.get("client_ref_id") or "",
                    c.get("verified_name") or "",
                    c.get("verified_father_name") or "",
                    c.get("verified_dob") or "",
                    c.get("verified_gender") or "",
                    c.get("verified_address") or "",
                    c.get("card_ocr_status") or "PENDING",
                    c.get("card_ocr_name") or "",
                    cid
                ))
                updated += 1
            else:
                # Insert brand new candidate record
                insert_sql = """
                    INSERT INTO candidates (
                        candidate_id, company_name, full_name, reg_father_name, father_name,
                        email, phone, aadhaar_number, reg_dob, reg_gender, reg_address,
                        reg_state, reg_district, reg_designation,
                        face_photo_base64, aadhaar_front_base64, aadhaar_back_base64,
                        verification_status, client_ref_id, verified_name, verified_father_name,
                        verified_dob, verified_gender, verified_address, photo_base64,
                        card_ocr_status, card_ocr_name, created_at, verified_at
                    ) VALUES (
                        %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s, %s
                    )
                """
                execute_query(insert_sql, (
                    cid, comp,
                    c.get("full_name") or "",
                    c.get("reg_father_name") or c.get("father_name") or "",
                    c.get("father_name") or c.get("reg_father_name") or "",
                    c.get("email") or "",
                    c.get("phone") or "",
                    c.get("aadhaar_number") or "",
                    c.get("reg_dob") or "",
                    c.get("reg_gender") or "",
                    c.get("reg_address") or "",
                    c.get("reg_state") or c.get("state") or "",
                    c.get("reg_district") or c.get("district") or "",
                    c.get("reg_designation") or c.get("designation") or "",
                    face_pic, front_pic, back_pic,
                    c.get("verification_status") or "PENDING",
                    c.get("client_ref_id") or "",
                    c.get("verified_name") or "",
                    c.get("verified_father_name") or "",
                    c.get("verified_dob") or "",
                    c.get("verified_gender") or "",
                    c.get("verified_address") or "",
                    vault_pic,
                    c.get("card_ocr_status") or "PENDING",
                    c.get("card_ocr_name") or "",
                    c.get("created_at"),
                    c.get("verified_at")
                ))
                imported += 1

        logger.info(f"✅ Restore Complete: {imported} candidates inserted, {updated} candidate photos updated in DB.")

    except Exception as e:
        logger.error(f"Failed to restore backup: {e}")

if __name__ == "__main__":
    filepath = "candidates_backup.json"
    url = None
    clear = False

    for arg in sys.argv[1:]:
        if arg.startswith("mysql"):
            url = arg
        elif arg.endswith(".json"):
            filepath = arg
        elif arg in ["--clear", "-c", "clear", "wipe"]:
            clear = True

    restore_from_json(filepath, mysql_url=url, clear_db=clear)
