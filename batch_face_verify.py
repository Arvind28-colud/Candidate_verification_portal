import os
import sys
import logging
from urllib.parse import urlparse
import db
from db import execute_query, init_db
from face_verifier import compare_faces

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("batch_face_verify")

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
        logger.info(f"Connected to Railway DB: {db.DB_HOST}:{db.DB_PORT}/{db.DB_NAME} (User: {db.DB_USER})")
    except Exception as e:
        logger.warning(f"Could not parse MySQL URL: {e}")

def run_batch_face_verification(mysql_url: str = None):
    url_to_use = mysql_url or os.getenv("MYSQL_URL") or os.getenv("DATABASE_URL") or os.getenv("MYSQL_PRIVATE_URL")
    if url_to_use:
        parse_mysql_url(url_to_use)
    init_db()

    try:
        candidates = execute_query(
            "SELECT id, candidate_id, full_name, face_photo_base64, photo_base64 FROM candidates",
            fetch_all=True
        )
        if not candidates:
            logger.info("No candidates found in Railway database.")
            return {"processed": 0, "matches": 0, "mismatches": 0, "failed": 0}

        logger.info(f"Running ArcFace Facial Verification for all {len(candidates)} candidates in Railway DB...")
        
        matches = 0
        mismatches = 0
        failed_count = 0

        for c in candidates:
            cid = c.get("candidate_id")
            name = c.get("full_name")
            live = c.get("face_photo_base64")
            vault = c.get("photo_base64")

            res = compare_faces(live, vault)
            status = res.get("status", "FAILED")
            score = res.get("score", 0)

            execute_query(
                "UPDATE candidates SET face_match_status = %s, face_match_score = %s WHERE candidate_id = %s",
                (status, score, cid)
            )

            if status == "MATCH":
                matches += 1
                icon = "MATCH [OK]"
            elif status == "MISMATCH":
                mismatches += 1
                icon = "MISMATCH [X]"
            else:
                failed_count += 1
                icon = "FAILED [!]"

            print(f"[{cid}] {name:<30} | {icon:<12} ({score}%) | Live Pic: {len(live or '')}b | Vault Pic: {len(vault or '')}b")

        logger.info("ArcFace Railway Batch Verification Complete!")
        logger.info(f"Summary: {matches} Matches, {mismatches} Mismatches, {failed_count} Failed/No Photo.")
        return {
            "processed": len(candidates),
            "matches": matches,
            "mismatches": mismatches,
            "failed": failed_count
        }

    except Exception as e:
        logger.error(f"Error running batch ArcFace verification: {e}")
        return {"error": str(e)}

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else None
    run_batch_face_verification(mysql_url=url)
