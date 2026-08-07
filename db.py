import os
import sys
import uuid
import pymysql
import sqlite3
import logging
import bcrypt
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db")

DB_HOST = os.getenv("MYSQLHOST") or os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("MYSQLPORT") or os.getenv("DB_PORT", 3306))
DB_USER = os.getenv("MYSQLUSER") or os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("MYSQLPASSWORD") or os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("MYSQLDATABASE") or os.getenv("DB_NAME", "candidate_db")

# Parse Railway MYSQL_URL / MYSQL_PUBLIC_URL if present
mysql_url_env = os.getenv("MYSQL_URL") or os.getenv("MYSQL_PUBLIC_URL") or os.getenv("DATABASE_URL")
if mysql_url_env and mysql_url_env.startswith("mysql"):
    try:
        from urllib.parse import urlparse
        _parsed = urlparse(mysql_url_env)
        DB_HOST = _parsed.hostname or DB_HOST
        DB_PORT = _parsed.port or DB_PORT
        DB_USER = _parsed.username or DB_USER
        DB_PASSWORD = _parsed.password or DB_PASSWORD
        DB_NAME = (_parsed.path or "").strip("/") or DB_NAME
    except Exception as _e:
        logger.warning(f"Error parsing MYSQL_URL: {_e}")

# Flag indicating if MySQL connection is active or falling back to local database
USING_MYSQL = True
_MYSQL_UNAVAILABLE = False

def get_db_connection():
    """Attempt MySQL connection; fallback to local SQLite DB if MySQL is unreachable."""
    global USING_MYSQL, _MYSQL_UNAVAILABLE

    if _MYSQL_UNAVAILABLE:
        USING_MYSQL = False
        conn = sqlite3.connect("candidate_db.sqlite")
        conn.row_factory = sqlite3.Row
        return conn, "sqlite"

    try:
        connection = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor,
            connect_timeout=2
        )
        USING_MYSQL = True
        return connection, "mysql"
    except Exception as e:
        logger.info(f"MySQL not available ({e}). Using local SQLite database candidate_db.sqlite.")
        USING_MYSQL = False
        _MYSQL_UNAVAILABLE = True
        conn = sqlite3.connect("candidate_db.sqlite")
        conn.row_factory = sqlite3.Row
        return conn, "sqlite"

def init_db():
    """Auto-initialize 'candidates' and 'users' tables in the database if they don't exist."""
    global USING_MYSQL, _MYSQL_UNAVAILABLE
    try:
        conn, db_type = get_db_connection()
        cursor = conn.cursor()
        if db_type == "mysql":
            # First create database if missing
            try:
                temp_conn = pymysql.connect(
                    host=DB_HOST, port=DB_PORT, user=DB_USER, password=DB_PASSWORD, connect_timeout=3
                )
                with temp_conn.cursor() as temp_cursor:
                    temp_cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` CHARACTER SET utf8mb4;")
                temp_conn.close()
            except Exception as _ex:
                logger.warning(f"Database pre-creation notice: {_ex}")

            # Create MySQL Tables with complete modern schema
            try:
                cursor.execute(f"USE `{DB_NAME}`;")
            except Exception as _ue:
                logger.warning(f"Database USE notice: {_ue}")

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS candidates (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    candidate_id VARCHAR(50) NOT NULL,
                    company_name VARCHAR(255) DEFAULT 'Keen Sighted Workforce Services',
                    full_name VARCHAR(255) NOT NULL,
                    email VARCHAR(255),
                    phone VARCHAR(20) NOT NULL,
                    aadhaar_number VARCHAR(12) NOT NULL,
                    reg_dob VARCHAR(50),
                    reg_gender VARCHAR(20),
                    reg_address TEXT,
                    reg_project_name VARCHAR(255) DEFAULT 'Site Verification Project',
                    reg_father_name VARCHAR(255),
                    reg_state VARCHAR(100),
                    reg_district VARCHAR(100),
                    reg_designation VARCHAR(100),
                    face_photo_base64 LONGTEXT,
                    photo_base64 LONGTEXT,
                    aadhaar_front_base64 LONGTEXT,
                    aadhaar_back_base64 LONGTEXT,
                    verification_status VARCHAR(50) DEFAULT 'PENDING',
                    verified_at DATETIME,
                    card_ocr_status VARCHAR(50) DEFAULT 'UNVERIFIED',
                    face_match_status VARCHAR(50) DEFAULT 'UNVERIFIED',
                    face_match_score INT DEFAULT 0,
                    client_ref_id VARCHAR(255),
                    verified_name VARCHAR(255),
                    verified_father_name VARCHAR(255),
                    verified_dob VARCHAR(50),
                    verified_gender VARCHAR(20),
                    verified_address TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY (candidate_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(100) UNIQUE NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    display_name VARCHAR(255) NOT NULL,
                    role VARCHAR(50) NOT NULL DEFAULT 'user',
                    company_name VARCHAR(255),
                    company_token VARCHAR(64) UNIQUE,
                    logo_base64 LONGTEXT,
                    hide_company_name TINYINT(1) DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS otp_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    candidate_id VARCHAR(50),
                    company_name VARCHAR(255),
                    candidate_name VARCHAR(255),
                    aadhaar_number VARCHAR(20),
                    phone VARCHAR(20),
                    event_type VARCHAR(50),
                    status VARCHAR(50),
                    message TEXT,
                    client_id VARCHAR(255),
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)

            conn.commit()

        else:
            # SQLite fallback schema
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS candidates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id TEXT NOT NULL UNIQUE,
                    company_name TEXT DEFAULT 'Keen Sighted Workforce Services',
                    full_name TEXT NOT NULL,
                    email TEXT,
                    phone TEXT NOT NULL,
                    aadhaar_number TEXT NOT NULL,
                    reg_dob TEXT,
                    reg_gender TEXT,
                    reg_address TEXT,
                    reg_project_name TEXT DEFAULT 'Site Verification Project',
                    reg_father_name TEXT,
                    reg_state TEXT,
                    reg_district TEXT,
                    reg_designation TEXT,
                    face_photo_base64 TEXT,
                    photo_base64 TEXT,
                    aadhaar_front_base64 TEXT,
                    aadhaar_back_base64 TEXT,
                    verification_status TEXT DEFAULT 'PENDING',
                    verified_at TEXT,
                    card_ocr_status TEXT DEFAULT 'UNVERIFIED',
                    face_match_status TEXT DEFAULT 'UNVERIFIED',
                    face_match_score INTEGER DEFAULT 0,
                    client_ref_id TEXT,
                    verified_name TEXT,
                    verified_father_name TEXT,
                    verified_dob TEXT,
                    verified_gender TEXT,
                    verified_address TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    company_name TEXT,
                    company_token TEXT UNIQUE,
                    logo_base64 TEXT,
                    hide_company_name INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)

            cursor.execute("""
                CREATE TABLE IF NOT EXISTS otp_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    candidate_id TEXT,
                    company_name TEXT,
                    candidate_name TEXT,
                    aadhaar_number TEXT,
                    phone TEXT,
                    event_type TEXT,
                    status TEXT,
                    message TEXT,
                    client_id TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
            """)

            conn.commit()

        cursor.close()
        conn.close()
        logger.info(f"Database successfully initialized ({db_type.upper()}).")

        # Run column migration checks safely
        run_column_migrations()
        seed_default_admin_user()

    except Exception as e:
        logger.error(f"Error during init_db ({e}). Falling back to local SQLite database.")
        _MYSQL_UNAVAILABLE = True
        USING_MYSQL = False
        try:
            conn = sqlite3.connect("candidate_db.sqlite")
            cursor = conn.cursor()
            cursor.execute("CREATE TABLE IF NOT EXISTS candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, candidate_id TEXT UNIQUE);")
            conn.commit()
            conn.close()
        except Exception as _sqle:
            logger.error(f"SQLite fallback error: {_sqle}")  # Safe migrations for SQLite (existing DBs)
            for migration_sql in [
                "ALTER TABLE users ADD COLUMN logo_base64 TEXT",
                "ALTER TABLE users ADD COLUMN sender_mobile TEXT",
                "ALTER TABLE users ADD COLUMN link_enabled INTEGER DEFAULT 1",
                "ALTER TABLE users ADD COLUMN hide_company_name INTEGER DEFAULT 0",
                "ALTER TABLE candidates ADD COLUMN card_ocr_status TEXT DEFAULT 'PENDING'",
                "ALTER TABLE candidates ADD COLUMN card_ocr_name TEXT",
                "ALTER TABLE candidates ADD COLUMN reg_state TEXT",
                "ALTER TABLE candidates ADD COLUMN reg_district TEXT",
                "ALTER TABLE candidates ADD COLUMN reg_designation TEXT",
                "ALTER TABLE candidates ADD COLUMN reg_project_name TEXT"
            ]:
                try:
                    cursor.execute(migration_sql)
                    conn.commit()
                except Exception:
                    pass  # Column already exists
            conn.commit()
            logger.info("SQLite fallback 'candidates' & 'users' tables verified/initialized successfully.")

        # Seed default Super Admin user from .env if missing
        _seed_default_admin(conn, db_type)

    except Exception as err:
        logger.error(f"Database initialization error: {err}")
    finally:
        conn.close()


def _seed_default_admin(conn, db_type):
    """Create Super Admin user if missing, sync username & password from .env."""
    cursor = conn.cursor()
    admin_user = os.getenv("ADMIN_USERNAME", "admin").strip()
    admin_pass = os.getenv("ADMIN_PASSWORD", "admin123").strip()
    hashed_admin = bcrypt.hashpw(admin_pass.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    find_admin_sql = "SELECT id, username FROM users WHERE role = 'admin' OR LOWER(username) = LOWER(%s) LIMIT 1"
    if db_type == "sqlite":
        find_admin_sql = find_admin_sql.replace("%s", "?")
    cursor.execute(find_admin_sql, (admin_user,))
    admin_row = cursor.fetchone()

    if admin_row:
        admin_id = admin_row["id"] if isinstance(admin_row, dict) else admin_row[0]
        update_admin_sql = "UPDATE users SET username = %s, password_hash = %s, role = 'admin' WHERE id = %s"
        if db_type == "sqlite":
            update_admin_sql = update_admin_sql.replace("%s", "?")
        cursor.execute(update_admin_sql, (admin_user, hashed_admin, admin_id))
        conn.commit()
        logger.info(f"Successfully synced Super Admin user in DB to '{admin_user}' from .env.")
    else:
        insert_admin_sql = "INSERT INTO users (username, password_hash, display_name, role, company_name) VALUES (%s, %s, %s, %s, %s)"
        if db_type == "sqlite":
            insert_admin_sql = insert_admin_sql.replace("%s", "?")
        cursor.execute(insert_admin_sql, (admin_user, hashed_admin, "System Super Administrator", "admin", None))
        conn.commit()
        logger.info(f"Created Super Admin user '{admin_user}' from .env.")

def backfill_company_tokens():
    """Assign a random UUID company_token to every company (user) that does not have one yet.
    Safe to run on every startup — only updates rows where company_token IS NULL.
    """
    import uuid as _uuid
    conn, db_type = get_db_connection()
    try:
        cursor = conn.cursor()
        if db_type == "mysql":
            # MySQL supports UUID() natively — use Python to be consistent
            if db_type == "sqlite":
                cursor.execute("SELECT id FROM users WHERE company_token IS NULL OR company_token = ''")
            else:
                cursor.execute("SELECT id FROM users WHERE company_token IS NULL OR company_token = ''")
            rows = cursor.fetchall()
            for row in rows:
                row_id = row["id"] if isinstance(row, dict) else row[0]
                new_token = str(_uuid.uuid4())
                cursor.execute(
                    "UPDATE users SET company_token = %s WHERE id = %s",
                    (new_token, row_id)
                )
        else:
            cursor.execute("SELECT id FROM users WHERE company_token IS NULL OR company_token = ''")
            rows = cursor.fetchall()
            for row in rows:
                row_id = row["id"] if isinstance(row, dict) else row[0]
                new_token = str(_uuid.uuid4())
                cursor.execute(
                    "UPDATE users SET company_token = ? WHERE id = ?",
                    (new_token, row_id)
                )
        conn.commit()
        if rows:
            logger.info(f"backfill_company_tokens: assigned tokens to {len(rows)} existing company/user row(s).")
    except Exception as e:
        logger.warning(f"backfill_company_tokens error: {e}")
    finally:
        conn.close()


def resequence_all_candidate_ids():
    """Ensure candidate IDs across all registered candidates are strictly unique and sequential (ID0001, ID0002, ID0003...) chronologically."""
    conn, db_type = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, candidate_id FROM candidates ORDER BY id ASC")
        rows = cursor.fetchall()

        mismatches = []
        for idx, r in enumerate(rows, start=1):
            target_cid = f"ID{idx:04d}"
            row_id = r["id"] if isinstance(r, dict) else r[0]
            current_cid = r["candidate_id"] if isinstance(r, dict) else r[1]
            if current_cid != target_cid:
                mismatches.append((row_id, target_cid))

        if mismatches:
            # Pass 1: Set temp candidate_id to avoid MySQL unique key collision
            for row_id, _ in mismatches:
                temp_cid = f"TEMP_{row_id}_{uuid.uuid4().hex[:6]}"
                if db_type == "mysql":
                    cursor.execute("UPDATE candidates SET candidate_id = %s WHERE id = %s", (temp_cid, row_id))
                else:
                    cursor.execute("UPDATE candidates SET candidate_id = ? WHERE id = ?", (temp_cid, row_id))

            # Pass 2: Set exact target sequential candidate_id
            for row_id, target_cid in mismatches:
                if db_type == "mysql":
                    cursor.execute("UPDATE candidates SET candidate_id = %s WHERE id = %s", (target_cid, row_id))
                else:
                    cursor.execute("UPDATE candidates SET candidate_id = ? WHERE id = ?", (target_cid, row_id))

            conn.commit()
            logger.info(f"resequence_all_candidate_ids: updated {len(mismatches)} candidate ID(s) to be strictly sequential.")
    except Exception as e:
        logger.warning(f"resequence_all_candidate_ids error: {e}")
    finally:
        conn.close()



def execute_query(sql, params=(), fetch_one=False, fetch_all=False):
    """Utility helper to execute queries seamlessly on MySQL or SQLite."""
    conn, db_type = get_db_connection()
    try:
        cursor = conn.cursor()
        # Adapt parameter placeholders if needed (%s for MySQL, ? for SQLite)
        if db_type == "sqlite":
            sql = sql.replace("%s", "?")
        
        cursor.execute(sql, params)
        
        if fetch_one:
            res = cursor.fetchone()
            conn.commit()
            return dict(res) if res else None
        if fetch_all:
            res = cursor.fetchall()
            conn.commit()
            return [dict(r) for r in res] if res else []
            
        conn.commit()
        return cursor.lastrowid
    except Exception as e:
        logger.error(f"Query error ({sql}): {e}")
        raise e
    finally:
        conn.close()
