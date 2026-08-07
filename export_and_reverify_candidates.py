"""
Candidate Verification Portal — Photo Exporter & ArcFace Neural Re-verification Utility
--------------------------------------------------------------------------------------
This script performs two major operations:
  1. Exports & downloads all high-resolution candidate photos (Selfie, Aadhaar Vault, Front Card, Back Card) into local folder `downloaded_candidate_photos/`.
  2. Runs ArcFace facial recognition on live selfie vs official Aadhaar vault photo for every existing candidate, printing exact neural similarity scores and updating MySQL DB records.
"""

import os
import sys
import io
import base64
import re
from PIL import Image

# Ensure UTF-8 output on Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Ensure local workspace import
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import execute_query
from face_verifier import compare_faces, clean_b64

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "downloaded_candidate_photos")

def save_b64_image(b64_str: str, output_filepath: str) -> bool:
    """Helper to decode base64 string and save as JPEG image file."""
    if not b64_str or len(b64_str) < 100:
        return False
    try:
        raw_bytes = clean_b64(b64_str)
        if not raw_bytes:
            return False
        img = Image.open(io.BytesIO(raw_bytes))
        if img.mode != "RGB":
            img = img.convert("RGB")
        img.save(output_filepath, "JPEG", quality=95)
        return True
    except Exception as e:
        print(f"   ⚠️ Image save error ({os.path.basename(output_filepath)}): {e}")
        return False

def run_export_and_reverification():
    print("==========================================================================")
    print("🚀 STARTING CANDIDATE PHOTO EXPORTER & ARCFACE RE-VERIFICATION UTILITY")
    print("==========================================================================")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"📁 Photos will be saved to: {OUTPUT_DIR}\n")

    candidates = execute_query(
        "SELECT * FROM candidates ORDER BY id ASC",
        fetch_all=True
    )

    if not candidates:
        print("❌ No candidate records found in MySQL database.")
        return

    print(f"📊 Found {len(candidates)} candidate(s) in database. Processing...\n")

    processed = 0
    updated = 0
    photos_downloaded = 0

    for idx, c in enumerate(candidates, start=1):
        cid = c.get("candidate_id") or f"ID{idx:04d}"
        raw_name = c.get("full_name") or c.get("verified_name") or "Candidate"
        clean_name = re.sub(r'[^a-zA-Z0-9]', '_', raw_name.strip())
        folder_name = f"{cid}_{clean_name}"
        cand_dir = os.path.join(OUTPUT_DIR, folder_name)
        os.makedirs(cand_dir, exist_ok=True)

        print(f"--------------------------------------------------------------------------")
        print(f"[{idx}/{len(candidates)}] Candidate: {raw_name} ({cid})")
        print(f"   Company: {c.get('company_name') or 'N/A'} | Phone: {c.get('phone') or 'N/A'}")

        # 1. Download and Save High-Resolution Photos
        face_live_b64 = c.get("face_photo_base64")
        photo_vault_b64 = c.get("photo_base64")
        card_front_b64 = c.get("aadhaar_front_base64")
        card_back_b64 = c.get("aadhaar_back_base64")

        live_saved = save_b64_image(face_live_b64, os.path.join(cand_dir, "1_live_captured_selfie.jpg"))
        vault_saved = save_b64_image(photo_vault_b64, os.path.join(cand_dir, "2_aadhaar_vault_photo.jpg"))
        front_saved = save_b64_image(card_front_b64, os.path.join(cand_dir, "3_aadhaar_card_front.jpg"))
        back_saved = save_b64_image(card_back_b64, os.path.join(cand_dir, "4_aadhaar_card_back.jpg"))

        saved_count = sum([live_saved, vault_saved, front_saved, back_saved])
        photos_downloaded += saved_count
        print(f"   📸 Saved {saved_count}/4 High-Res Images -> {folder_name}/")

        # 2. Run ArcFace Neural Facial Verification
        if face_live_b64 and photo_vault_b64:
            res = compare_faces(face_live_b64, photo_vault_b64)
            match_status = res.get("status", "FAILED")
            match_score = res.get("score", 0)
            model_used = res.get("model", "ArcFace")

            print(f"   🤖 ArcFace Verification Result:")
            print(f"      • Model Used   : {model_used}")
            print(f"      • Match Status : {match_status} {'✓' if match_status == 'MATCH' else '✕'}")
            print(f"      • Similarity   : {match_score}%")

            # Update DB with real ArcFace neural status and score
            execute_query(
                "UPDATE candidates SET face_match_status = %s, face_match_score = %s WHERE candidate_id = %s",
                (match_status, match_score, cid)
            )
            updated += 1
        else:
            print(f"   ⚠️ Facial verification skipped (Missing Live Selfie or Vault Photo)")

        processed += 1

    print("\n==========================================================================")
    print("✅ RE-VERIFICATION & PHOTO EXPORT COMPLETE!")
    print(f"   • Total Candidates Processed : {processed}")
    print(f"   • DB Records Updated in MySQL: {updated}")
    print(f"   • Total High-Res Photos Saved: {photos_downloaded}")
    print(f"   • Photos Folder Location    : {OUTPUT_DIR}")
    print("==========================================================================")

if __name__ == "__main__":
    run_export_and_reverification()
