import html2pdf from 'html2pdf.js';
import JSZip from 'jszip';

// Helper to clean and format name strings cleanly (removes prefixes like S/O, D/O, W/O, Mr.)
const formatCleanName = (str, fallback = '-') => {
  if (!str || typeof str !== 'string') return fallback;
  const cleaned = str.trim().replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim();
  return cleaned || fallback;
};

export const buildCandidateReportHtml = (candidate, companyName = '') => {
  const currentCompanyName = candidate.company_name || companyName || 'Candidate Verification Portal';
  const isVerified = candidate.verification_status === 'VERIFIED';
  const isFailed = candidate.verification_status === 'FAILED' || candidate.face_match_status === 'MISMATCH';

  const candidateFullName = formatCleanName(candidate.full_name || candidate.verified_name || candidate.name, 'Candidate');
  const regFather = formatCleanName(candidate.reg_father_name || candidate.father_name, 'Not Provided');
  const verName = formatCleanName(candidate.verified_name || candidate.full_name || candidate.name, 'Not Verified');
  const verFather = formatCleanName(candidate.verified_father_name || candidate.reg_father_name || candidate.father_name, 'Not Provided');
  const verDob = candidate.verified_dob || candidate.reg_dob || '-';
  const verGender = candidate.verified_gender || candidate.reg_gender || '-';
  const verAddress = candidate.verified_address || candidate.reg_address || '-';

  const defaultFaceImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><rect width='100%' height='100%' fill='%23ffffff' stroke='%23000000' stroke-width='1.5'/><text x='50%' y='50%' font-size='10' font-weight='bold' fill='%23000000' text-anchor='middle' dy='.3em'>NO PHOTO</text></svg>";
  const defaultAadhaarImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='220' viewBox='0 0 500 220'><rect width='100%' height='100%' fill='%23ffffff' stroke='%23000000' stroke-width='1.5'/><text x='50%' y='50%' font-size='12' font-weight='bold' fill='%23000000' text-anchor='middle'>NO AADHAAR CARD IMAGE</text></svg>";

  const liveSelfie = candidate.face_photo_base64 || candidate.photo_base64 || defaultFaceImg;
  const vaultPhoto = candidate.photo_base64 || candidate.face_photo_base64 || defaultFaceImg;
  const aadhaarFront = candidate.aadhaar_front_base64 || defaultAadhaarImg;
  const aadhaarBack = candidate.aadhaar_back_base64 || defaultAadhaarImg;

  const companyLogo = candidate.company_logo || '';

  // Field match helpers matching PdfReportModal exactly
  const getNameMatch = () => {
    const reg = (candidateFullName || '').toUpperCase();
    const ver = (verName || '').toUpperCase();
    if (!reg || !ver || ver === 'NOT VERIFIED') return 'NO DATA';
    return reg === ver ? 'MATCH ✓' : 'MISMATCH ✕';
  };

  const getFatherMatch = () => {
    const regRaw = (regFather || '').toUpperCase();
    const verRaw = (verFather || '').toUpperCase();
    if (!regRaw || !verRaw || regRaw === 'NOT PROVIDED' || verRaw === 'NOT PROVIDED') return 'NO DATA';
    return regRaw === verRaw ? 'MATCH ✓' : 'MISMATCH ✕';
  };

  const getFaceMatch = () => {
    const status = candidate.face_match_status;
    const score = candidate.face_match_score;
    if (!liveSelfie || !vaultPhoto) return 'NO DATA';
    if (status === 'MISMATCH' || (score !== undefined && score !== null && score > 0 && score < 55)) {
      return `MISMATCH ✕ (${score ? score + '%' : 'Mismatch'})`;
    }
    if (status === 'MATCH' || (score !== undefined && score !== null && score >= 55) || isVerified) {
      return `MATCH ✓ (${score ? score + '%' : 'Match'})`;
    }
    return 'MISMATCH ✕';
  };

  const getDobMatch = () => {
    const reg = (candidate.reg_dob || '').trim();
    const ver = (candidate.verified_dob || '').trim();
    if (!reg || !ver) return 'NO DATA';
    return reg === ver ? 'MATCH ✓' : 'MISMATCH ✕';
  };

  const getCardMatch = () => {
    const status = (candidate.card_ocr_status || '').toUpperCase();
    if (status === 'MATCH') return 'MATCH ✓';
    if (status === 'MISMATCH') return `MISMATCH ✕ (OCR: ${candidate.card_ocr_name || '?'})`;
    if (status === 'BLUR' || status === 'BLANK') return 'BLUR / BLANK ⚠';
    if (status === 'NO_CARD') return 'NO CARD';
    const hasFront = candidate.aadhaar_front_base64;
    const hasBack = candidate.aadhaar_back_base64;
    if (!hasFront && !hasBack) return 'NO CARD';
    return 'UNREADABLE ✕';
  };

  const nameStatus = getNameMatch();
  const fatherStatus = getFatherMatch();
  const faceStatus = getFaceMatch();
  const dobStatus = getDobMatch();
  const cardStatus = getCardMatch();

  return `
    <div style="width: 820px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000000; background-color: #ffffff; margin: 0 auto; box-sizing: border-box; font-size: 11px; line-height: 1.4;">

      <!-- ================= PAGE 1 ================= -->
      <div class="pdf-page-container" style="box-sizing: border-box; min-height: 940px; padding: 24px; border: 2px solid #000000; background: #ffffff; position: relative;">
        <div>
          <!-- 1. DOCUMENT HEADER WITH COMPANY LOGO & NAME -->
          <div style="text-align: center; border-bottom: 2px solid #000000; padding-bottom: 8px;">
            ${companyLogo ? `<div style="width: 64px; height: 64px; margin: 0 auto 4px auto; display: flex; align-items: center; justify-content: center;"><img src="${companyLogo}" alt="Logo" style="max-height: 100%; max-width: 100%; object-fit: contain;" /></div>` : ''}
            <h1 style="font-size: 20px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; color: #000000; margin: 0;">
              ${currentCompanyName}
            </h1>
            <p style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #000000; letter-spacing: 0.03em; margin: 2px 0 0 0; font-family: 'Courier New', monospace;">
              Candidate Identity &amp; Aadhaar e-KYC Verification Report
            </p>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px; font-size: 10px; font-family: 'Courier New', monospace; border-top: 1px solid #94a3b8; padding-top: 4px;">
              <span><strong>CANDIDATE ID:</strong> ${candidate.candidate_id || '-'}</span>
              <span><strong>STATUS:</strong> ${isVerified ? 'VERIFIED e-KYC ✓' : isFailed ? 'FAILED ✕' : 'PENDING ⚠'}</span>
              <span><strong>DATE:</strong> ${new Date().toLocaleDateString('en-GB')}</span>
            </div>
          </div>

          <!-- 2. CANDIDATE IDENTITY PHOTOS -->
          <div style="border: 1px solid #000000; background: #ffffff; margin-top: 8px;">
            <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 9px; font-weight: bold; padding: 2px 10px; text-transform: uppercase; display: flex; justify-content: space-between; align-items: center;">
              <span>1. Candidate Identity Photos</span>
              <span style="font-size: 8px;">Live vs e-KYC</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; justify-items: center; padding: 6px; background: #ffffff;">
              <div style="text-align: center;">
                <span style="font-size: 9px; font-weight: bold; font-family: 'Courier New', monospace; color: #000000; display: block; text-transform: uppercase; margin-bottom: 4px;">
                  LIVE CAPTURED SELFIE
                </span>
                <div style="width: 112px; height: 112px; overflow: hidden; border: 1px solid #000000; background: #ffffff;">
                  <img src="${liveSelfie}" style="width: 100%; height: 100%; object-fit: cover;" alt="Live Selfie" />
                </div>
              </div>

              <div style="text-align: center;">
                <span style="font-size: 9px; font-weight: bold; font-family: 'Courier New', monospace; color: #000000; display: block; text-transform: uppercase; margin-bottom: 4px;">
                  AADHAAR e-KYC VAULT PHOTO
                </span>
                <div style="width: 112px; height: 112px; overflow: hidden; border: 1px solid #000000; background: #ffffff;">
                  <img src="${vaultPhoto}" style="width: 100%; height: 100%; object-fit: cover;" alt="Aadhaar Vault Photo" />
                </div>
              </div>
            </div>
          </div>

          <!-- 3. PERSONAL REGISTRATION & VERIFIED AADHAAR DETAILS -->
          <div style="margin-top: 6px;">
            <h3 style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; color: #000000; font-family: 'Courier New', monospace; border-bottom: 1px solid #000000; padding-bottom: 2px; margin: 0 0 4px 0; text-align: center;">
              2. Personal Registration &amp; Verified Aadhaar Details
            </h3>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 10px;">
              <div style="border: 1px solid #000000; background: #ffffff;">
                <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 8px; font-weight: bold; padding: 2px 8px; text-transform: uppercase; display: flex; justify-content: space-between;">
                  <span>Registered Candidate Info</span>
                  <span>Form Entry</span>
                </div>
                <div style="padding: 6px; font-size: 9px; color: #000000; line-height: 1.35;">
                  <p style="margin: 0;"><strong>Company:</strong> ${currentCompanyName}</p>
                  ${(candidate.reg_project_name || candidate.project_name) ? `<p style="margin: 0;"><strong>Project:</strong> ${candidate.reg_project_name || candidate.project_name}</p>` : ''}
                  <p style="margin: 0;"><strong>Full Name:</strong> ${candidateFullName}</p>
                  <p style="margin: 0;"><strong>Father's Name:</strong> ${regFather}</p>
                  <p style="margin: 0;"><strong>Designation:</strong> ${candidate.reg_designation || candidate.designation || '-'}</p>
                  <p style="margin: 0;"><strong>State:</strong> ${candidate.reg_state || candidate.state || '-'}</p>
                  <p style="margin: 0;"><strong>District:</strong> ${candidate.reg_district || candidate.district || '-'}</p>
                  <p style="margin: 0;"><strong>Mobile Phone:</strong> ${candidate.phone || '-'}</p>
                  <p style="margin: 0;"><strong>Aadhaar No:</strong> XXXX-XXXX-${(candidate.aadhaar_number || '').slice(-4)}</p>
                  <p style="margin: 0;"><strong>Date of Birth:</strong> ${candidate.reg_dob || '-'}</p>
                  <p style="margin: 0; word-break: break-word;"><strong>Address:</strong> ${candidate.reg_address || '-'}</p>
                </div>
              </div>

              <div style="border: 1px solid #000000; background: #ffffff;">
                <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 8px; font-weight: bold; padding: 2px 8px; text-transform: uppercase; display: flex; justify-content: space-between;">
                  <span>Aadhaar Vault Record</span>
                  <span>Verified e-KYC</span>
                </div>
                <div style="padding: 6px; font-size: 9px; color: #000000; line-height: 1.35;">
                  <p style="margin: 0;"><strong>Verified Name:</strong> ${verName}</p>
                  <p style="margin: 0;"><strong>Verified Father:</strong> ${verFather}</p>
                  <p style="margin: 0;"><strong>Verified DOB:</strong> ${verDob}</p>
                  <p style="margin: 0;"><strong>Gender:</strong> ${verGender}</p>
                  <p style="margin: 0;"><strong>Masked Aadhaar:</strong> XXXX-XXXX-${(candidate.aadhaar_number || '').slice(-4)}</p>
                  <p style="margin: 0; word-break: break-word;"><strong>Aadhaar Address:</strong> ${verAddress}</p>
                  <p style="margin: 0;"><strong>Verified At:</strong> ${candidate.verified_at ? new Date(candidate.verified_at).toLocaleDateString('en-GB') : 'Verified'}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 4. OFFICIAL AADHAAR CARD DOCUMENT ATTACHMENTS -->
          <div style="margin-top: 6px;">
            <h3 style="font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; color: #000000; font-family: 'Courier New', monospace; border-bottom: 1px solid #000000; padding-bottom: 2px; margin: 0 0 4px 0; text-align: center;">
              3. Official Aadhaar Card Document Attachments (High Resolution Print)
            </h3>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding-top: 2px;">
              <div style="text-align: center;">
                <span style="font-size: 8px; font-weight: bold; font-family: 'Courier New', monospace; color: #000000; display: block; text-transform: uppercase; margin-bottom: 2px;">
                  Aadhaar Card - Front View
                </span>
                <div style="width: 100%; display: flex; align-items: center; justify-content: center; border: 1px solid #94a3b8; padding: 4px; background: #ffffff;">
                  <img src="${aadhaarFront}" style="max-height: 380px; width: 100%; object-fit: contain;" alt="Aadhaar Front" />
                </div>
              </div>

              <div style="text-align: center;">
                <span style="font-size: 8px; font-weight: bold; font-family: 'Courier New', monospace; color: #000000; display: block; text-transform: uppercase; margin-bottom: 2px;">
                  Aadhaar Card - Back View / Address
                </span>
                <div style="width: 100%; display: flex; align-items: center; justify-content: center; border: 1px solid #94a3b8; padding: 4px; background: #ffffff;">
                  <img src="${aadhaarBack}" style="max-height: 380px; width: 100%; object-fit: contain;" alt="Aadhaar Back" />
                </div>
              </div>
            </div>
          </div>

          <!-- 5. ATTRIBUTE MATCH MATRIX -->
          <div style="border: 1px solid #000000; background: #ffffff; margin-top: 6px;">
            <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 8px; font-weight: bold; padding: 2px 8px; text-transform: uppercase; display: flex; justify-content: space-between;">
              <span>4. Attribute Match Matrix</span>
              <span>Field-by-Field Verification</span>
            </div>
            <table style="width: 100%; border-collapse: collapse; font-family: 'Courier New', monospace; font-size: 8px; text-align: left;">
              <thead style="background: #f8fafc; font-weight: bold; border-bottom: 1px solid #000000;">
                <tr>
                  <th style="padding: 4px; border-right: 1px solid #000000; text-align: left;">Name Match</th>
                  <th style="padding: 4px; border-right: 1px solid #000000; text-align: center;">Father's Name Match</th>
                  <th style="padding: 4px; border-right: 1px solid #000000; text-align: center;">Face Match</th>
                  <th style="padding: 4px; border-right: 1px solid #000000; text-align: center;">DOB Match</th>
                  <th style="padding: 4px; border-right: 1px solid #000000; text-align: center;">Uploaded Card Match</th>
                  <th style="padding: 4px; text-align: center;">Aadhaar Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style="padding: 4px; border-right: 1px solid #000000; font-weight: bold;">${nameStatus}</td>
                  <td style="padding: 4px; border-right: 1px solid #000000; text-align: center; font-weight: bold;">${fatherStatus}</td>
                  <td style="padding: 4px; border-right: 1px solid #000000; text-align: center; font-weight: bold;">${faceStatus}</td>
                  <td style="padding: 4px; border-right: 1px solid #000000; text-align: center; font-weight: bold;">${dobStatus}</td>
                  <td style="padding: 4px; border-right: 1px solid #000000; text-align: center; font-weight: bold;">${cardStatus}</td>
                  <td style="padding: 4px; text-align: center; font-weight: bold; color: #000000;">${isVerified ? 'VERIFIED ✓' : 'PENDING'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- PAGE 1 FOOTER -->
        <div style="padding-top: 6px; border-top: 1px solid #000000; display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-family: 'Courier New', monospace; color: #000000; margin-top: 6px;">
          <span>${currentCompanyName} &bull; Candidate Verification Report (${candidate.candidate_id || '-'})</span>
          <span style="font-weight: bold;">Page 1 of 2</span>
        </div>
      </div>

      <!-- HARD PAGE BREAK -->
      <div class="pdf-page-break" style="page-break-before: always; clear: both; height: 0; margin: 0; padding: 0;"></div>

      <!-- ================= PAGE 2 ================= -->
      <div class="pdf-page-container" style="box-sizing: border-box; min-height: 940px; height: 940px; padding: 24px; border: 2px solid #000000; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; position: relative; margin-top: 24px;">

        <div style="display: flex; flex-direction: column; flex: 1; gap: 12px;">
          <!-- PAGE 2 HEADER -->
          <div style="border-bottom: 2px solid #000000; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div style="display: flex; align-items: center; gap: 12px;">
              ${companyLogo ? `<div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;"><img src="${companyLogo}" alt="Logo" style="max-height: 100%; max-width: 100%; object-fit: contain;" /></div>` : ''}
              <div>
                <h2 style="font-size: 18px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.03em; color: #000000; margin: 0;">
                  ${currentCompanyName}
                </h2>
                <p style="font-size: 10px; font-weight: bold; color: #000000; text-transform: uppercase; font-family: 'Courier New', monospace; letter-spacing: 0.03em; margin: 2px 0 0 0;">
                  OFFLINE POLICE VERIFICATION &amp; BACKGROUND CLEARANCE RECORD
                </p>
              </div>
            </div>
            <div style="text-align: right; font-family: 'Courier New', monospace; font-size: 9px;">
              <p style="font-weight: bold; margin: 0; color: #000000;">CANDIDATE ID: ${candidate.candidate_id || '-'}</p>
              <p style="margin: 0; color: #000000;">DATE: ${new Date().toLocaleDateString('en-GB')}</p>
            </div>
          </div>

          <!-- CANDIDATE OVERVIEW BOX -->
          <div style="border: 1px solid #000000; padding: 10px; background: #ffffff; font-family: 'Courier New', monospace; font-size: 10px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <p style="margin: 0;"><strong>Candidate Name:</strong> ${candidateFullName}</p>
              <p style="margin: 0;"><strong>Father's Name:</strong> ${regFather}</p>
              <p style="margin: 0;"><strong>Mobile Phone:</strong> ${candidate.phone || '-'}</p>
              <p style="margin: 0;"><strong>Aadhaar No:</strong> XXXX-XXXX-${(candidate.aadhaar_number || '').slice(-4)}</p>
            </div>
            <p style="margin: 0; padding-top: 4px; border-top: 1px solid #000000; margin-top: 4px;">
              <strong>Permanent Address:</strong> ${verAddress !== '-' ? verAddress : candidate.reg_address || 'Not Provided'}
            </p>
          </div>

          <!-- 1. PHYSICAL POLICE CLEARANCE STATUS -->
          <div style="border: 1px solid #000000; background: #ffffff;">
            <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 9px; font-weight: bold; padding: 4px 12px; text-transform: uppercase;">
              Physical Police Clearance Status
            </div>
            <div style="padding: 12px; background: #ffffff; font-family: 'Courier New', monospace; font-size: 10px; color: #000000;">
              <p style="font-weight: bold; margin: 0 0 6px 0;">Clearance Result:</p>
              <div style="padding-left: 8px;">
                <p style="font-weight: bold; margin: 0 0 6px 0;">[ &nbsp;&nbsp; ] CLEAR (0 Criminal FIRs)</p>
                <p style="font-weight: bold; margin: 0;">[ &nbsp;&nbsp; ] FLAGGED (FIRs On Record)</p>
              </div>
            </div>
          </div>

          <!-- 2. POLICE OFFICER HANDWRITING NOTES & REMARKS -->
          <div style="border: 1px solid #000000; background: #ffffff; flex: 1; display: flex; flex-direction: column; min-height: 460px;">
            <div style="background: #f1f5f9; color: #000000; border-bottom: 1px solid #000000; font-family: 'Courier New', monospace; font-size: 9px; font-weight: bold; padding: 4px 12px; text-transform: uppercase;">
              Police Officer Physical Handwriting Notes &amp; Remarks
            </div>
            <div style="padding: 16px; background: #ffffff; flex: 1; min-height: 420px; background-image: repeating-linear-gradient(transparent, transparent 31px, #e2e8f0 31px, #e2e8f0 32px); background-attachment: local;"></div>
          </div>
        </div>

        <!-- BOTTOM SIGNATURE & FOOTER -->
        <div style="padding-top: 16px;">
          <div style="font-family: 'Courier New', monospace; font-size: 10px; display: flex; justify-content: space-between; align-items: flex-end;">
            <p style="font-weight: bold; color: #000000; margin: 0;">Verifying Officer Name &amp; Badge ID: ____________________________________</p>
            <p style="font-weight: bold; color: #000000; margin: 0;">Date: _____ / _____ / 2026</p>
          </div>

          <div style="padding-top: 8px; border-top: 1px solid #000000; display: flex; justify-content: space-between; align-items: center; font-size: 9px; font-family: 'Courier New', monospace; color: #000000; margin-top: 8px;">
            <span>${currentCompanyName} &bull; Police Clearance Record (${candidate.candidate_id || '-'})</span>
            <span style="font-weight: bold;">Page 2 of 2</span>
          </div>
        </div>
      </div>

    </div>
  `;
};

// Helper to prepare DOM element for html2canvas matching PdfReportModal
const prepareReportElement = async (candidate, companyName) => {
  const tempContainer = document.createElement('div');
  tempContainer.style.position = 'fixed';
  tempContainer.style.left = '-9999px';
  tempContainer.style.top = '0px';
  tempContainer.style.width = '820px';
  tempContainer.style.backgroundColor = '#ffffff';
  tempContainer.style.color = '#000000';
  tempContainer.style.zIndex = '99999';

  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildCandidateReportHtml(candidate, companyName);
  tempContainer.appendChild(wrapper);
  document.body.appendChild(tempContainer);

  const images = Array.from(tempContainer.querySelectorAll('img'));
  await Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalHeight !== 0) resolve();
          else {
            img.onload = resolve;
            img.onerror = resolve;
          }
        })
    )
  );

  return { tempContainer, wrapper };
};

const getPdfOptions = (fileName) => ({
  margin: 0,
  filename: fileName,
  image: { type: 'jpeg', quality: 1.0 },
  html2canvas: {
    scale: 3,
    useCORS: true,
    allowTaint: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: 820,
    width: 820,
    dpi: 300,
    letterRendering: true,
  },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
  pagebreak: { mode: ['css', 'legacy'], before: '.pdf-page-break', avoid: '.pdf-page-container' },
});

export const generatePdfFilename = (candidate) => {
  if (!candidate) return 'Candidate_Verification_Report.pdf';
  const name = (candidate.full_name || candidate.verified_name || candidate.name || 'Candidate')
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '_');
  const phone = (candidate.phone || '').toString().trim().replace(/\D/g, '');
  const aadhaar = (candidate.aadhaar_number || candidate.aadhaar_raw || '').toString().trim().replace(/\D/g, '');

  const parts = [name];
  if (phone) parts.push(phone);
  if (aadhaar) parts.push(aadhaar);

  return `${parts.join('_')}.pdf`;
};

export const downloadCandidatePdf = async (candidate, companyName = '', token = '') => {
  if (!candidate) return;

  const targetId = candidate.candidate_id || candidate.id;
  const authToken = token || sessionStorage.getItem('token') || '';
  const fileName = generatePdfFilename(candidate);

  try {
    const queryComp = encodeURIComponent(candidate.company_name || companyName || '');
    const res = await fetch(`/api/candidates/download-pdf/${targetId}?company=${queryComp}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
  } catch (err) {
    console.error('Backend PDF download error:', err);
  }
};

export const downloadBulkPdfsZip = async (candidatesList = [], companyName = '', onProgress = () => { }, districtName = 'ALL', token = '') => {
  const authToken = token || sessionStorage.getItem('token') || '';

  try {
    onProgress(1, 1, 'Downloading bulk ZIP package from backend...');
    const compParam = encodeURIComponent(companyName || 'ALL');
    const distParam = encodeURIComponent(districtName || 'ALL');

    const res = await fetch(`/api/candidates/download-bulk-zip?company=${compParam}&district=${distParam}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });

    if (res.ok) {
      const zipBlob = await res.blob();
      const distLabel = districtName && districtName !== 'ALL' ? `${districtName.trim().replace(/\s+/g, '_')}_` : 'All_Districts_';
      const zipFileName = `${distLabel}Candidate_Verification_Reports_${new Date().toISOString().slice(0, 10)}.zip`;

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
  } catch (err) {
    console.error('Backend ZIP download error:', err);
  }
};