import sys
import json
import logging
from urllib.parse import urlparse
import db
from db import execute_query, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("export_backup")

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
        logger.info(f"Connected to Source DB: {db.DB_HOST}:{db.DB_PORT}/{db.DB_NAME} (User: {db.DB_USER})")
    except Exception as e:
        logger.warning(f"Could not parse MySQL URL: {e}")

def export_data(mysql_url: str = None, output_filename: str = "candidates_backup.json"):
    if mysql_url:
        parse_mysql_url(mysql_url)
    init_db()
    try:
        data = execute_query("SELECT * FROM candidates", fetch_all=True)
        if not data:
            logger.info("No candidates found in source database.")
            return
        with open(output_filename, "w", encoding="utf-8") as f:
            json.dump(data, f, default=str, indent=2)
        logger.info(f"✅ Backup of {len(data)} candidate records saved successfully to '{output_filename}'!")
    except Exception as e:
        logger.error(f"❌ Backup failed: {e}")

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else None
    outfile = sys.argv[2] if len(sys.argv) > 2 else "candidates_backup.json"
    export_data(mysql_url=url, output_filename=outfile)
