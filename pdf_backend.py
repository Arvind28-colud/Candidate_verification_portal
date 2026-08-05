import io
import re
import datetime
import zipfile
from xhtml2pdf import pisa


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

    default_face_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    default_aadhaar_img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    live_selfie = candidate.get("face_photo_base64") or candidate.get("photo_base64") or default_face_img
    vault_photo = candidate.get("photo_base64") or candidate.get("face_photo_base64") or default_face_img
    aadhaar_front = candidate.get("aadhaar_front_base64") or default_aadhaar_img
    aadhaar_back = candidate.get("aadhaar_back_base64") or default_aadhaar_img
    company_logo = candidate.get("company_logo") or ""

    def get_name_match():
        reg = (cand_full_name or "").upper()
        ver = (ver_name or "").upper()
        if not reg or not ver or ver == "NOT VERIFIED":
            return "NO DATA"
        return "MATCH ✓" if reg == ver else "MISMATCH ✕"

    def get_father_match():
        reg_raw = (reg_father or "").upper()
        ver_raw = (ver_father or "").upper()
        if not reg_raw or not ver_raw or reg_raw == "NOT PROVIDED" or ver_raw == "NOT PROVIDED":
            return "NO DATA"
        return "MATCH ✓" if reg_raw == ver_raw else "MISMATCH ✕"

    def get_face_match():
        status = candidate.get("face_match_status")
        score = candidate.get("face_match_score")
        if not live_selfie or not vault_photo:
            return "NO DATA"
        if status == "MISMATCH" or (score is not None and score > 0 and score < 55):
            return f"MISMATCH ✕ ({score}%)" if score else "MISMATCH ✕"
        if status == "MATCH" or (score is not None and score >= 55) or is_verified:
            return f"MATCH ✓ ({score}%)" if score else "MATCH ✓"
        return "MISMATCH ✕"

    def get_dob_match():
        reg = (candidate.get("reg_dob") or "").strip()
        ver = (candidate.get("verified_dob") or "").strip()
        if not reg or not ver:
            return "NO DATA"
        return "MATCH ✓" if reg == ver else "MISMATCH ✕"

    def get_card_match():
        status = (candidate.get("card_ocr_status") or "").upper()
        if status == "MATCH":
            return "MATCH ✓"
        if status == "MISMATCH":
            return f"MISMATCH ✕ (OCR: {candidate.get('card_ocr_name') or '?'})"
        if status in ("BLUR", "BLANK"):
            return "BLUR / BLANK ⚠"
        if status == "NO_CARD":
            return "NO CARD"
        has_front = candidate.get("aadhaar_front_base64")
        has_back = candidate.get("aadhaar_back_base64")
        if not has_front and not has_back:
            return "NO CARD"
        return "UNREADABLE ✕"

    name_status = get_name_match()
    father_status = get_father_match()
    face_status = get_face_match()
    dob_status = get_dob_match()
    card_status = get_card_match()

    aadhaar_num = candidate.get("aadhaar_number") or ""
    masked_aadhaar = f"XXXX-XXXX-{aadhaar_num[-4:]}" if len(aadhaar_num) >= 4 else "XXXX-XXXX-XXXX"
    date_str = datetime.datetime.now().strftime("%d/%m/%Y")

    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8"/>
    <style>
      @page {{
        size: a4 portrait;
        margin: 8mm;
      }}
      body {{
        font-family: Helvetica, Arial, sans-serif;
        color: #000000;
        font-size: 8pt;
        line-height: 1.35;
        background-color: #ffffff;
      }}
      .page-outer-box {{
        border: 2px solid #000000;
        padding: 10px 12px;
        background-color: #ffffff;
      }}
      .header-box {{
        text-align: center;
        border-bottom: 2px solid #000000;
        padding-bottom: 5px;
        margin-bottom: 6px;
      }}
      .company-title {{
        font-size: 15pt;
        font-weight: bold;
        text-transform: uppercase;
        margin: 0;
        color: #000000;
        letter-spacing: 0.5px;
      }}
      .sub-title {{
        font-size: 9pt;
        font-weight: bold;
        text-transform: uppercase;
        color: #000000;
        margin: 2px 0 0 0;
        letter-spacing: 0.5px;
        font-family: 'Courier New', monospace;
      }}
      .meta-bar {{
        margin-top: 4px;
        font-size: 7.5pt;
        font-weight: bold;
        color: #000000;
        border-top: 1px solid #94a3b8;
        padding-top: 3px;
        width: 100%;
        font-family: 'Courier New', monospace;
      }}
      .section-heading {{
        font-size: 8pt;
        font-weight: bold;
        text-transform: uppercase;
        color: #000000;
        border-bottom: 1px solid #000000;
        padding-bottom: 2px;
        margin-top: 6px;
        margin-bottom: 4px;
        text-align: center;
        letter-spacing: 0.5px;
        font-family: 'Courier New', monospace;
      }}
      .box-card {{
        border: 1px solid #000000;
        background: #ffffff;
        margin-bottom: 6px;
      }}
      .box-header-table {{
        width: 100%;
        background: #f1f5f9;
        color: #000000;
        border-bottom: 1px solid #000000;
        font-size: 7.5pt;
        font-weight: bold;
        text-transform: uppercase;
        font-family: 'Courier New', monospace;
      }}
      .box-header-table td {{
        padding: 2px 6px;
      }}
      .box-content {{
        padding: 5px 6px;
        font-size: 8pt;
        line-height: 1.4;
        color: #000000;
      }}
      .box-content p {{
        margin: 0 0 2px 0;
        padding: 0;
        border: none;
      }}
      .photo-img {{
        width: 100px;
        height: 100px;
        border: 1px solid #000000;
        object-fit: cover;
      }}
      .card-img {{
        max-height: 230px;
        max-width: 100%;
        object-fit: contain;
      }}
      .matrix-table {{
        width: 100%;
        border-collapse: collapse;
        font-size: 7pt;
        text-align: left;
        font-family: 'Courier New', monospace;
      }}
      .matrix-table th {{
        background: #f8fafc;
        font-weight: bold;
        color: #000000;
        border: 1px solid #000000;
        padding: 3px;
        text-align: center;
      }}
      .matrix-table th:first-child {{
        text-align: left;
      }}
      .matrix-table td {{
        border: 1px solid #000000;
        padding: 4px 3px;
        font-weight: bold;
        text-align: center;
      }}
      .matrix-table td:first-child {{
        text-align: left;
      }}
      .footer-bar {{
        border-top: 1px solid #000000;
        padding-top: 4px;
        font-size: 7.5pt;
        color: #000000;
        margin-top: 6px;
        font-family: 'Courier New', monospace;
      }}
      .pdf-page-break {{
        page-break-before: always;
      }}
      .notes-line {{
        border-bottom: 1px solid #e2e8f0;
        height: 18px;
      }}
    </style>
    </head>
    <body>
      <div class="page-outer-box">

        <div class="header-box">
          {'<div style="text-align:center;"><img src="' + company_logo + '" style="max-height:40px; margin-bottom:2px;"/></div>' if company_logo else ''}
          <div class="company-title">{current_company_name}</div>
          <div class="sub-title">Candidate Identity &amp; Aadhaar e-KYC Verification Report</div>
          <table class="meta-bar">
            <tr>
              <td style="text-align:left;"><strong>CANDIDATE ID:</strong> {candidate.get('candidate_id') or '-'}</td>
              <td style="text-align:center;"><strong>STATUS:</strong> {'VERIFIED e-KYC ✓' if is_verified else ('FAILED ✕' if is_failed else 'PENDING ⚠')}</td>
              <td style="text-align:right;"><strong>DATE:</strong> {date_str}</td>
            </tr>
          </table>
        </div>

        <div class="box-card">
          <table class="box-header-table">
            <tr>
              <td style="text-align:left;">1. Candidate Identity Photos</td>
              <td style="text-align:right; font-weight:normal;">Live vs e-KYC</td>
            </tr>
          </table>
          <table style="width:100%; text-align:center; padding: 5px 0;">
            <tr>
              <td width="50%" style="text-align:center;">
                <div style="font-size:7.5pt; font-weight:bold; margin-bottom:3px; font-family:'Courier New', monospace;">LIVE CAPTURED SELFIE</div>
                <img src="{live_selfie}" class="photo-img" />
              </td>
              <td width="50%" style="text-align:center;">
                <div style="font-size:7.5pt; font-weight:bold; margin-bottom:3px; font-family:'Courier New', monospace;">AADHAAR e-KYC VAULT PHOTO</div>
                <img src="{vault_photo}" class="photo-img" />
              </td>
            </tr>
          </table>
        </div>

        <div class="section-heading">2. Personal Registration &amp; Verified Aadhaar Details</div>
        <table style="width:100%; border-spacing: 5px 0;">
          <tr>
            <td width="50%" style="vertical-align:top; padding:0;">
              <div class="box-card">
                <table class="box-header-table">
                  <tr>
                    <td style="text-align:left;">Registered Candidate Info</td>
                    <td style="text-align:right; font-weight:normal;">Form Entry</td>
                  </tr>
                </table>
                <div class="box-content">
                  <p><strong>Company:</strong> {current_company_name}</p>
                  {'<p><strong>Project:</strong> ' + (candidate.get('reg_project_name') or candidate.get('project_name') or '') + '</p>' if (candidate.get('reg_project_name') or candidate.get('project_name')) else ''}
                  <p><strong>Full Name:</strong> {cand_full_name}</p>
                  <p><strong>Father's Name:</strong> {reg_father}</p>
                  <p><strong>Designation:</strong> {candidate.get('reg_designation') or candidate.get('designation') or '-'}</p>
                  <p><strong>State:</strong> {candidate.get('reg_state') or candidate.get('state') or '-'}</p>
                  <p><strong>District:</strong> {candidate.get('reg_district') or candidate.get('district') or '-'}</p>
                  <p><strong>Mobile Phone:</strong> {candidate.get('phone') or '-'}</p>
                  <p><strong>Aadhaar No:</strong> {masked_aadhaar}</p>
                  <p><strong>Date of Birth:</strong> {candidate.get('reg_dob') or '-'}</p>
                  <p style="margin-bottom:0;"><strong>Address:</strong> {candidate.get('reg_address') or '-'}</p>
                </div>
              </div>
            </td>
            <td width="50%" style="vertical-align:top; padding:0;">
              <div class="box-card">
                <table class="box-header-table">
                  <tr>
                    <td style="text-align:left;">Aadhaar Vault Record</td>
                    <td style="text-align:right; font-weight:normal;">Verified e-KYC</td>
                  </tr>
                </table>
                <div class="box-content">
                  <p><strong>Verified Name:</strong> {ver_name}</p>
                  <p><strong>Verified Father:</strong> {ver_father}</p>
                  <p><strong>Verified DOB:</strong> {ver_dob}</p>
                  <p><strong>Gender:</strong> {ver_gender}</p>
                  <p><strong>Masked Aadhaar:</strong> {masked_aadhaar}</p>
                  <p><strong>Aadhaar Address:</strong> {ver_address}</p>
                  <p style="margin-bottom:0;"><strong>Verified At:</strong> {candidate.get('verified_at') or 'Verified'}</p>
                </div>
              </div>
            </td>
          </tr>
        </table>

        <div class="section-heading">3. Official Aadhaar Card Document Attachments (High Resolution Print)</div>
        <table style="width:100%; border-spacing: 5px 0;">
          <tr>
            <td width="50%" style="text-align:center; padding:0;">
              <div style="font-size:7.5pt; font-weight:bold; margin-bottom:2px; font-family:'Courier New', monospace;">AADHAAR CARD - FRONT VIEW</div>
              <div style="border:1px solid #94a3b8; padding:2px; height:195px;">
                <img src="{aadhaar_front}" class="card-img" />
              </div>
            </td>
            <td width="50%" style="text-align:center; padding:0;">
              <div style="font-size:7.5pt; font-weight:bold; margin-bottom:2px; font-family:'Courier New', monospace;">AADHAAR CARD - BACK VIEW / ADDRESS</div>
              <div style="border:1px solid #94a3b8; padding:2px; height:195px;">
                <img src="{aadhaar_back}" class="card-img" />
              </div>
            </td>
          </tr>
        </table>

        <div class="box-card" style="margin-top:4px;">
          <table class="box-header-table">
            <tr>
              <td style="text-align:left;">4. Attribute Match Matrix</td>
              <td style="text-align:right; font-weight:normal;">Field-by-Field Verification</td>
            </tr>
          </table>
          <table class="matrix-table">
            <thead>
              <tr>
                <th style="text-align:left;">Name Match</th>
                <th>Father's Name Match</th>
                <th>Face Match</th>
                <th>DOB Match</th>
                <th>Uploaded Card Match</th>
                <th>Aadhaar Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{name_status}</td>
                <td>{father_status}</td>
                <td>{face_status}</td>
                <td>{dob_status}</td>
                <td>{card_status}</td>
                <td>{'VERIFIED ✓' if is_verified else 'PENDING'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <table class="footer-bar" style="width:100%;">
          <tr>
            <td style="text-align:left;">{current_company_name} • Candidate Verification Report ({candidate.get('candidate_id') or '-'})</td>
            <td style="text-align:right;"><strong>Page 1 of 2</strong></td>
          </tr>
        </table>

      </div>

      <div class="pdf-page-break"></div>

      <div class="page-outer-box">

        <div class="header-box" style="margin-top:2px;">
          <div class="company-title">{current_company_name}</div>
          <div class="sub-title">Offline Police Verification &amp; Background Clearance Record</div>
          <table class="meta-bar">
            <tr>
              <td style="text-align:left;"><strong>CANDIDATE ID:</strong> {candidate.get('candidate_id') or '-'}</td>
              <td style="text-align:right;"><strong>DATE:</strong> {date_str}</td>
            </tr>
          </table>
        </div>

        <div class="box-card">
          <div class="box-content">
            <table style="width:100%; font-family:'Courier New', monospace;">
              <tr>
                <td style="width:50%;"><strong>Candidate Name:</strong> {cand_full_name}</td>
                <td style="width:50%;"><strong>Father's Name:</strong> {reg_father}</td>
              </tr>
              <tr>
                <td><strong>Mobile Phone:</strong> {candidate.get('phone') or '-'}</td>
                <td><strong>Aadhaar No:</strong> {masked_aadhaar}</td>
              </tr>
            </table>
            <div style="border-top:1px solid #000000; margin-top:4px; padding-top:4px; font-family:'Courier New', monospace;">
              <strong>Permanent Address:</strong> {ver_address if ver_address != '-' else (candidate.get('reg_address') or 'Not Provided')}
            </div>
          </div>
        </div>

        <div class="box-card">
          <table class="box-header-table">
            <tr>
              <td style="text-align:left;">Physical Police Clearance Status</td>
            </tr>
          </table>
          <div class="box-content" style="font-family:'Courier New', monospace;">
            <p style="font-weight:bold; margin:0 0 4px 0;">Clearance Result:</p>
            <p style="margin:0 0 2px 10px;">[ &nbsp;&nbsp; ] CLEAR (0 Criminal FIRs)</p>
            <p style="margin:0 0 0 10px;">[ &nbsp;&nbsp; ] FLAGGED (FIRs On Record)</p>
          </div>
        </div>

        <div class="box-card">
          <table class="box-header-table">
            <tr>
              <td style="text-align:left;">Police Officer Physical Handwriting Notes &amp; Remarks</td>
            </tr>
          </table>
          <div style="padding:4px 8px;">
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
            <div class="notes-line"></div>
          </div>
        </div>

        <table style="width:100%; margin-top:15px; font-size:8.5pt; font-family:'Courier New', monospace;">
          <tr>
            <td style="text-align:left;"><strong>Verifying Officer Name &amp; Badge ID:</strong> ____________________________________</td>
            <td style="text-align:right;"><strong>Date:</strong> _____ / _____ / 2026</td>
          </tr>
        </table>

        <table class="footer-bar" style="width:100%; margin-top:15px;">
          <tr>
            <td style="text-align:left;">{current_company_name} • Police Clearance Record ({candidate.get('candidate_id') or '-'})</td>
            <td style="text-align:right;"><strong>Page 2 of 2</strong></td>
          </tr>
        </table>

      </div>
    </body>
    </html>
    """
    return html_content


def generate_candidate_pdf_bytes(candidate_data, company_name=""):
    html_content = build_candidate_report_html(candidate_data, company_name)
    result_stream = io.BytesIO()
    pisa.CreatePDF(io.StringIO(html_content), dest=result_stream)
    return result_stream.getvalue()


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