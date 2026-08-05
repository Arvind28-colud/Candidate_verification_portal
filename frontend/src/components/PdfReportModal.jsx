import React, { useRef, useState, useEffect } from 'react';
import { X, Download, Printer, FileText, Eye, Loader2 } from 'lucide-react';
import ImageModal from './ImageModal';

const PdfReportModal = ({ candidate, onClose }) => {
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);
  const [fullCandidate, setFullCandidate] = useState(candidate);
  const activeCandidate = fullCandidate || candidate;

  useEffect(() => {
    let isMounted = true;
    const hasPhotos = Boolean(
      candidate?.photo_base64 ||
      candidate?.face_photo_base64 ||
      candidate?.aadhaar_front_base64
    );

    if (!hasPhotos && (candidate?.id || candidate?.candidate_id)) {
      setLoadingDetails(true);
      const token = sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || localStorage.getItem('token');
      const compParam = candidate?.company_name ? `?company=${encodeURIComponent(candidate.company_name)}` : '';
      const targetId = candidate?.id || candidate?.candidate_id;
      fetch(`/api/candidate/${targetId}${compParam}`, {
        headers: { 
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}` 
        }
      })
        .then((r) => r.json())
        .then((d) => {
          if (isMounted) {
            if (d.success && d.candidate) {
              setFullCandidate(d.candidate);
            }
            setLoadingDetails(false);
          }
        })
        .catch(() => {
          if (isMounted) setLoadingDetails(false);
        });
    } else {
      setFullCandidate(candidate);
      setLoadingDetails(false);
    }
    return () => {
      isMounted = false;
    };
  }, [candidate]);

  // Prioritize candidate's registered company name or organization
  const [companyName] = useState(() => {
    return (
      activeCandidate?.company_name ||
      activeCandidate?.organization ||
      localStorage.getItem('report_company_name') ||
      'Keen Sighted Workforce Services'
    );
  });

  const [companyLogo, setCompanyLogo] = useState(activeCandidate?.company_logo || '');

  useEffect(() => {
    if (activeCandidate?.company_logo) {
      setCompanyLogo(activeCandidate.company_logo);
      return;
    }
    const comp = activeCandidate?.company_name || activeCandidate?.organization || companyName;
    if (comp) {
      fetch(`/api/company/info?company=${encodeURIComponent(comp)}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && d.logo_base64) {
            setCompanyLogo(d.logo_base64);
          }
        })
        .catch(() => {});
    }
  }, [activeCandidate, companyName]);

  if (!activeCandidate) return null;

  const handleNativePrint = () => {
    const element = printRef.current;
    if (!element) return;

    let mount = document.getElementById('print-mount-root');
    if (mount) mount.remove();

    mount = document.createElement('div');
    mount.id = 'print-mount-root';

    const clone = element.cloneNode(true);
    clone.querySelectorAll('.no-print-overlay').forEach((el) => el.remove());

    mount.appendChild(clone);
    document.body.appendChild(mount);

    window.print();

    setTimeout(() => {
      if (mount && document.body.contains(mount)) {
        document.body.removeChild(mount);
      }
    }, 1000);
  };

  const handleDownloadPdf = async () => {
    const element = printRef.current;
    if (!element || downloading) return;

    setDownloading(true);
    let tempContainer = null;

    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;

      tempContainer = document.createElement('div');
      tempContainer.style.position = 'fixed';
      tempContainer.style.left = '-9999px';
      tempContainer.style.top = '0px';
      tempContainer.style.width = '820px';
      tempContainer.style.backgroundColor = '#ffffff';
      tempContainer.style.color = '#000000';

      const clone = element.cloneNode(true);
      clone.style.width = '100%';
      clone.style.maxWidth = '100%';
      clone.style.boxShadow = 'none';
      clone.style.margin = '0';
      clone.style.padding = '0';

      clone.querySelectorAll('.no-print-overlay').forEach((el) => el.remove());

      tempContainer.appendChild(clone);
      document.body.appendChild(tempContainer);

      const images = Array.from(clone.querySelectorAll('img'));
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

      const fileName = `Verification_Report_${(activeCandidate.full_name || 'Candidate').replace(/\s+/g, '_')}.pdf`;
      const opt = {
        margin: 0,
        filename: fileName,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: false,
          allowTaint: true,
          logging: false,
          backgroundColor: '#ffffff',
          width: 820,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'], before: '.pdf-page-break' },
      };

      await html2pdf().set(opt).from(clone).save();
      setDownloading(false);
    } catch (err) {
      console.warn('Auto PDF generation fallback:', err.message);
      setDownloading(false);
      handleNativePrint();
    } finally {
      if (tempContainer && document.body.contains(tempContainer)) {
        document.body.removeChild(tempContainer);
      }
    }
  };

  const regFather = activeCandidate.reg_father_name || activeCandidate.father_name || 'Not Provided';
  const verName = activeCandidate.verified_name || activeCandidate.full_name || 'Not Verified';
  const verFather = activeCandidate.verified_father_name || 'Not Provided';
  const verDob = activeCandidate.verified_dob || activeCandidate.reg_dob || '-';
  const verGender = activeCandidate.verified_gender || activeCandidate.reg_gender || '-';
  const verAddress = activeCandidate.verified_address || activeCandidate.reg_address || '-';

  const getNameMatch = () => {
    const reg = (activeCandidate.full_name || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const ver = (activeCandidate.verified_name || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!reg || !ver) return { label: 'NO DATA', isMatch: false, isNa: true };
    if (reg === ver) return { label: 'MATCH ✓', isMatch: true, isNa: false };
    return { label: 'MISMATCH ✕', isMatch: false, isNa: false };
  };

  const getFatherMatch = () => {
    const regRaw = (activeCandidate.reg_father_name || activeCandidate.father_name || '').trim().toUpperCase();
    const verRaw = (activeCandidate.verified_father_name || '').trim().toUpperCase();
    if (!regRaw || !verRaw || regRaw === 'NOT PROVIDED' || verRaw === 'NOT PROVIDED') {
      return { label: 'NO DATA', isMatch: false, isNa: true };
    }
    const cleanReg = regRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    const cleanVer = verRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    if (cleanReg === cleanVer) {
      return { label: 'MATCH ✓', isMatch: true, isNa: false };
    }
    return { label: 'MISMATCH ✕', isMatch: false, isNa: false };
  };

  const getFaceMatch = () => {
    const status = activeCandidate.face_match_status;
    const score = activeCandidate.face_match_score;
    const facePhoto = activeCandidate.face_photo_base64 || activeCandidate.photo_base64;
    const vaultPhoto = activeCandidate.photo_base64 || activeCandidate.face_photo_base64;

    if (!facePhoto || !vaultPhoto) {
      return { label: 'NO DATA', isMatch: false, isNa: true };
    }

    if (status === 'MISMATCH' || (score !== undefined && score !== null && score > 0 && score < 55)) {
      return { label: `MISMATCH ✕ (${score ? score + '%' : 'Mismatch'})`, isMatch: false, isNa: false };
    }
    if (status === 'MATCH' || (score !== undefined && score !== null && score >= 55)) {
      return { label: `MATCH ✓ (${score ? score + '%' : 'Match'})`, isMatch: true, isNa: false };
    }

    return { label: 'MISMATCH ✕', isMatch: false, isNa: false };
  };

  const getDobMatch = () => {
    const reg = (activeCandidate.reg_dob || '').trim();
    const ver = (activeCandidate.verified_dob || '').trim();
    if (!reg || !ver) return { label: 'NO DATA', isMatch: false, isNa: true };
    if (reg === ver) return { label: 'MATCH ✓', isMatch: true, isNa: false };
    return { label: 'MISMATCH ✕', isMatch: false, isNa: false };
  };

  const getCardMatch = () => {
    const status = (activeCandidate.card_ocr_status || '').toUpperCase();
    if (status === 'MATCH') return { label: 'MATCH ✓', isMatch: true, isNa: false };
    if (status === 'MISMATCH') return { label: `MISMATCH ✕ (OCR: ${activeCandidate.card_ocr_name || '?'})`, isMatch: false, isNa: false };
    if (status === 'BLUR' || status === 'BLANK') return { label: 'BLUR / BLANK ⚠', isMatch: false, isNa: false };
    if (status === 'NO_CARD') return { label: 'NO CARD', isMatch: false, isNa: true };
    const hasFront = activeCandidate.aadhaar_front_base64;
    const hasBack = activeCandidate.aadhaar_back_base64;
    if (!hasFront && !hasBack) return { label: 'NO CARD', isMatch: false, isNa: true };
    if (status === 'NO_OCR') return { label: 'UNREADABLE ✕', isMatch: false, isNa: false };
    return { label: 'UNREADABLE ✕', isMatch: false, isNa: false };
  };

  const pdfNameStatus = getNameMatch();
  const pdfFatherStatus = getFatherMatch();
  const pdfFaceStatus = getFaceMatch();
  const pdfDobStatus = getDobMatch();
  const pdfCardStatus = getCardMatch();

  const defaultFaceImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><rect width='100%' height='100%' fill='%23ffffff' stroke='%23000000' stroke-width='1.5'/><text x='50%' y='50%' font-size='10' font-weight='bold' fill='%23000000' text-anchor='middle' dy='.3em'>NO PHOTO</text></svg>";
  const defaultAadhaarImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='220' viewBox='0 0 500 220'><rect width='100%' height='100%' fill='%23ffffff' stroke='%23000000' stroke-width='1.5'/><text x='50%' y='50%' font-size='12' font-weight='bold' fill='%23000000' text-anchor='middle'>NO AADHAAR CARD IMAGE</text></svg>";

  const liveSelfie = activeCandidate.face_photo_base64 || activeCandidate.photo_base64 || defaultFaceImg;
  const vaultPhoto = activeCandidate.photo_base64 || activeCandidate.face_photo_base64 || defaultFaceImg;
  const aadhaarFront = activeCandidate.aadhaar_front_base64 || defaultAadhaarImg;
  const aadhaarBack = activeCandidate.aadhaar_back_base64 || defaultAadhaarImg;

  const currentCompanyName = companyName.trim() || 'Keen Sighted Workforce Services';

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 overflow-y-auto">
        <div className="bg-white border border-slate-200 rounded-3xl max-w-5xl w-full text-slate-900 overflow-hidden shadow-2xl relative my-6">
          
          {/* Action Bar */}
          <div className="bg-white p-4 border-b border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-900">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
                <FileText className="w-5 h-5 shrink-0" />
              </div>
              <div>
                <span className="text-sm font-bold text-slate-900 block font-sans">Verification PDF Report</span>
                <span className="text-xs text-slate-500 font-medium">Exact 2-Page Official Print Format &bull; {candidate.full_name}</span>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="flex items-center space-x-3">
              <button
                onClick={handleNativePrint}
                className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shadow-xs"
                title="Print or Save as PDF using browser dialog"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print / Save PDF</span>
              </button>

              <button
                onClick={handleDownloadPdf}
                disabled={downloading}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{downloading ? 'Generating...' : 'Download PDF'}</span>
              </button>

              <button onClick={onClose} className="text-slate-400 hover:text-slate-700 cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* PRINTABLE 2-PAGE PDF REPORT CONTAINER */}
          <div className="p-6 bg-slate-100/90 max-h-[82vh] overflow-y-auto flex flex-col items-center space-y-6">
            <div id="printable-pdf-report" ref={printRef} className="w-full max-w-[820px]">
              
              {/* ================= PAGE 1: FULL PAGE FOR ALL CANDIDATE DETAILS & LARGE AADHAAR CARD ================= */}
              <div className="pdf-page bg-white p-6 border-2 border-black shadow-lg rounded-none space-y-2 text-black font-sans relative" style={{ boxSizing: 'border-box', minHeight: '940px' }}>
                
                {/* 1. DOCUMENT HEADER WITH COMPANY LOGO & NAME */}
                <div className="text-center border-b-2 border-black pb-2">
                  {companyLogo ? (
                    <div className="w-16 h-16 mx-auto mb-1 flex items-center justify-center">
                      <img src={companyLogo} alt={currentCompanyName} className="max-h-full max-w-full object-contain" />
                    </div>
                  ) : null}
                  <h1 className="text-xl font-bold uppercase tracking-wider text-black font-sans">
                    {currentCompanyName}
                  </h1>
                  <p className="text-xs font-bold uppercase text-black tracking-wide mt-0.5 font-mono">
                    Candidate Identity & Aadhaar e-KYC Verification Report
                  </p>
                  <div className="flex items-center justify-between mt-1 text-[10px] font-mono border-t border-slate-300 pt-1">
                    <span><strong>CANDIDATE ID:</strong> {candidate.candidate_id}</span>
                    <span><strong>STATUS:</strong> VERIFIED e-KYC ✓</span>
                    <span><strong>DATE:</strong> {new Date().toLocaleDateString()}</span>
                  </div>
                </div>

                {/* 2. CANDIDATE IDENTITY PHOTOS */}
                <div className="border border-black bg-white space-y-0">
                  <div className="bg-slate-100 text-black border-b border-black font-mono text-[9px] font-bold px-2.5 py-0.5 uppercase flex justify-between items-center">
                    <span>1. Candidate Identity Photos</span>
                    <span className="text-black text-[8px]">Live vs e-KYC</span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 justify-items-center p-1.5 bg-white">
                    {/* PHOTO 1: LIVE CAPTURED SELFIE */}
                    <div className="text-center space-y-1">
                      <span className="text-[9px] font-bold font-mono text-black block uppercase">
                        LIVE CAPTURED SELFIE
                      </span>
                      <div
                        className="w-28 h-28 overflow-hidden border border-black bg-white cursor-pointer hover:opacity-90 transition-opacity group relative shadow-xs"
                        onClick={() => setPreviewImage({ src: liveSelfie, title: `Live Selfie - ${candidate.full_name}` })}
                        title="Click to view image"
                      >
                        <img
                          src={liveSelfie}
                          alt="Live Selfie"
                          className="w-full h-full object-cover"
                        />
                        <div className="no-print-overlay absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </div>

                    {/* PHOTO 2: AADHAAR VAULT PHOTO */}
                    <div className="text-center space-y-1">
                      <span className="text-[9px] font-bold font-mono text-black block uppercase">
                        AADHAAR e-KYC VAULT PHOTO
                      </span>
                      <div
                        className="w-28 h-28 overflow-hidden border border-black bg-white cursor-pointer hover:opacity-90 transition-opacity group relative shadow-xs"
                        onClick={() => setPreviewImage({ src: vaultPhoto, title: `Aadhaar Vault Photo - ${candidate.full_name}` })}
                        title="Click to view image"
                      >
                        <img
                          src={vaultPhoto}
                          alt="Aadhaar Vault Photo"
                          className="w-full h-full object-cover"
                        />
                        <div className="no-print-overlay absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-4 h-4 text-white" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. PERSONAL REGISTRATION & VERIFIED AADHAAR DETAILS */}
                <div className="space-y-0.5">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-black font-mono border-b border-black pb-0.5 text-center">
                    2. Personal Registration & Verified Aadhaar Details
                  </h3>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-sans">
                    {/* LEFT: REGISTERED CANDIDATE INFO */}
                    <div className="border border-black bg-white space-y-0">
                      <div className="bg-slate-100 text-black border-b border-black font-mono text-[8px] font-bold px-2 py-0.5 uppercase flex justify-between items-center">
                        <span>Registered Candidate Info</span>
                        <span className="text-slate-600 text-[8px]">Form Entry</span>
                      </div>
                      <div className="p-1.5 space-y-0.5 text-[9px] text-black leading-tight">
                        <p><strong>Company:</strong> {currentCompanyName}</p>
                        <p><strong>Full Name:</strong> {candidate.full_name}</p>
                        <p><strong>Father&apos;s Name:</strong> {regFather}</p>
                        <p><strong>Designation:</strong> {candidate.reg_designation || candidate.designation || '-'}</p>
                        <p><strong>State:</strong> {candidate.reg_state || candidate.state || '-'}</p>
                        <p><strong>District:</strong> {candidate.reg_district || candidate.district || '-'}</p>
                        <p><strong>Mobile Phone:</strong> {candidate.phone}</p>
                        <p><strong>Aadhaar No:</strong> XXXX-XXXX-{candidate.aadhaar_number?.slice(-4)}</p>
                        <p><strong>Date of Birth:</strong> {candidate.reg_dob || '-'}</p>
                        <p className="break-words"><strong>Address:</strong> {candidate.reg_address || '-'}</p>
                      </div>
                    </div>

                    {/* RIGHT: OFFICIAL AADHAAR VAULT RECORD */}
                    <div className="border border-black bg-white space-y-0">
                      <div className="bg-slate-100 text-black border-b border-black font-mono text-[8px] font-bold px-2 py-0.5 uppercase flex justify-between items-center">
                        <span>Aadhaar Vault Record</span>
                        <span className="text-slate-600 text-[8px]">Verified e-KYC</span>
                      </div>
                      <div className="p-1.5 space-y-0.5 text-[9px] text-black leading-tight">
                        <p><strong>Verified Name:</strong> {verName}</p>
                        <p><strong>Verified Father:</strong> {verFather}</p>
                        <p><strong>Verified DOB:</strong> {verDob}</p>
                        <p><strong>Gender:</strong> {verGender}</p>
                        <p><strong>Masked Aadhaar:</strong> XXXX-XXXX-{candidate.aadhaar_number?.slice(-4)}</p>
                        <p className="break-words"><strong>Aadhaar Address:</strong> {verAddress}</p>
                        <p><strong>Verified At:</strong> {candidate.verified_at ? new Date(candidate.verified_at).toLocaleDateString() : 'Verified'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. LARGE & CLEAR OFFICIAL AADHAAR CARD DOCUMENT ATTACHMENTS */}
                <div className="space-y-0.5">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-black font-mono border-b border-black pb-0.5 text-center">
                    3. Official Aadhaar Card Document Attachments (High Resolution Print)
                  </h3>

                  <div className="grid grid-cols-2 gap-3 pt-0.5">
                    {/* AADHAAR FRONT CARD IMAGE - ENLARGED FOR HIGH PRINT VISIBILITY */}
                    <div className="text-center space-y-0.5">
                      <span className="text-[8px] font-bold font-mono text-black block uppercase">
                        Aadhaar Card - Front View
                      </span>
                      <div
                        className="w-full flex items-center justify-center cursor-pointer hover:opacity-95 transition-opacity group relative border border-slate-300 p-1 bg-white rounded"
                        onClick={() => setPreviewImage({ src: aadhaarFront, title: `Aadhaar Front Document - ${candidate.full_name}` })}
                      >
                        <img
                          src={aadhaarFront}
                          alt="Aadhaar Front Document"
                          className="max-h-[380px] w-full object-contain rounded-sm"
                        />
                        <div className="no-print-overlay absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="bg-black text-white text-[8px] font-mono px-2 py-0.5 flex items-center">
                            <Eye className="w-3 h-3 mr-1 text-white" /> View Full
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* AADHAAR BACK CARD IMAGE - ENLARGED FOR HIGH PRINT VISIBILITY */}
                    <div className="text-center space-y-0.5">
                      <span className="text-[8px] font-bold font-mono text-black block uppercase">
                        Aadhaar Card - Back View / Address
                      </span>
                      <div
                        className="w-full flex items-center justify-center cursor-pointer hover:opacity-95 transition-opacity group relative border border-slate-300 p-1 bg-white rounded"
                        onClick={() => setPreviewImage({ src: aadhaarBack, title: `Aadhaar Back Document - ${candidate.full_name}` })}
                      >
                        <img
                          src={aadhaarBack}
                          alt="Aadhaar Back Document"
                          className="max-h-[380px] w-full object-contain rounded-sm"
                        />
                        <div className="no-print-overlay absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <span className="bg-black text-white text-[8px] font-mono px-2 py-0.5 flex items-center">
                            <Eye className="w-3 h-3 mr-1 text-white" /> View Full
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 5. ATTRIBUTE MATCH MATRIX TABLE */}
                <div className="border border-black bg-white space-y-0">
                  <div className="bg-slate-100 text-black border-b border-black font-mono text-[8px] font-bold px-2 py-0.5 uppercase flex justify-between items-center">
                    <span>4. Attribute Match Matrix</span>
                    <span className="text-slate-600 text-[8px]">Field-by-Field Verification</span>
                  </div>
                  <table className="w-full text-left font-mono text-[8px] border-collapse">
                    <thead className="bg-slate-50 text-black font-bold border-b border-black">
                      <tr>
                        <th className="p-1 border-r border-black">Name Match</th>
                        <th className="p-1 border-r border-black text-center">Father&apos;s Name Match</th>
                        <th className="p-1 border-r border-black text-center">Face Match</th>
                        <th className="p-1 border-r border-black text-center">DOB Match</th>
                        <th className="p-1 border-r border-black text-center">Uploaded Card Match</th>
                        <th className="p-1 text-center">Aadhaar Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black">
                      <tr>
                        <td className="p-1 border-r border-black font-bold">
                          <span className={pdfNameStatus.isMatch ? 'text-black font-bold' : 'text-black font-bold'}>
                            {pdfNameStatus.label}
                          </span>
                        </td>
                        <td className="p-1 border-r border-black text-center font-bold">
                          <span className={pdfFatherStatus.isMatch ? 'text-black font-bold' : 'text-black font-bold'}>
                            {pdfFatherStatus.label}
                          </span>
                        </td>
                        <td className="p-1 border-r border-black text-center font-bold">
                          <span className={pdfFaceStatus.isMatch ? 'text-black font-bold' : 'text-black font-bold'}>
                            {pdfFaceStatus.label}
                          </span>
                        </td>
                        <td className="p-1 border-r border-black text-center font-bold">
                          <span className={pdfDobStatus.isMatch ? 'text-black font-bold' : 'text-black font-bold'}>
                            {pdfDobStatus.label}
                          </span>
                        </td>
                        <td className="p-1 border-r border-black text-center font-bold">
                          <span className={pdfCardStatus.isMatch ? 'text-black font-bold' : 'text-black font-bold'}>
                            {pdfCardStatus.label}
                          </span>
                        </td>
                        <td className="p-1 text-center font-bold text-black">
                          {candidate.verification_status === 'VERIFIED' ? 'VERIFIED ✓' : 'PENDING'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* PAGE 1 FOOTER */}
                <div className="pt-1.5 border-t border-black flex justify-between items-center text-[9px] font-mono text-black">
                  <span>{currentCompanyName} • Candidate Verification Report ({candidate.candidate_id})</span>
                  <span className="font-bold">Page 1 of 2</span>
                </div>
              </div>

              {/* STRICT PAGE BREAK CLASS FOR HTML2PDF */}
              <div className="html2pdf__page-break pdf-page-break" style={{ height: '0px', margin: '0', padding: '0', pageBreakBefore: 'always' }} />

              {/* ================= PAGE 2: STRICTLY FOR PHYSICAL POLICE VERIFICATION ================= */}
              <div className="pdf-page bg-white p-6 border-2 border-black shadow-lg rounded-none text-black font-sans relative mt-6 flex flex-col justify-between" style={{ boxSizing: 'border-box', minHeight: '940px', height: '940px' }}>
                
                {/* TOP CONTENT WRAPPER */}
                <div className="flex flex-col flex-1 space-y-3">
                  {/* PAGE 2 HEADER WITH COMPANY LOGO & NAME */}
                  <div className="border-b-2 border-black pb-2 flex justify-between items-end">
                    <div className="flex items-center space-x-3">
                      {companyLogo && (
                        <div className="w-12 h-12 flex items-center justify-center shrink-0">
                          <img src={companyLogo} alt={currentCompanyName} className="max-h-full max-w-full object-contain" />
                        </div>
                      )}
                      <div>
                        <h2 className="text-lg font-bold uppercase text-black tracking-wide font-sans">
                          {currentCompanyName}
                        </h2>
                        <p className="text-[10px] font-bold text-black uppercase font-mono tracking-wide mt-0.5">
                          OFFLINE POLICE VERIFICATION & BACKGROUND CLEARANCE RECORD
                        </p>
                      </div>
                    </div>
                    <div className="text-right font-mono text-[9px]">
                      <p className="font-bold text-black">CANDIDATE ID: {candidate.candidate_id}</p>
                      <p className="text-black">DATE: {new Date().toLocaleDateString()}</p>
                    </div>
                  </div>

                  {/* CANDIDATE OVERVIEW BOX */}
                  <div className="border border-black p-2.5 bg-white font-mono text-[10px] space-y-1">
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <p><strong>Candidate Name:</strong> {candidate.full_name}</p>
                      <p><strong>Father&apos;s Name:</strong> {regFather}</p>
                      <p><strong>Mobile Phone:</strong> {candidate.phone}</p>
                      <p><strong>Aadhaar No:</strong> XXXX-XXXX-{candidate.aadhaar_number?.slice(-4)}</p>
                    </div>
                    <p className="text-[10px] pt-1 border-t border-black">
                      <strong>Permanent Address:</strong> {verAddress !== '-' ? verAddress : candidate.reg_address || 'Not Provided'}
                    </p>
                  </div>

                  {/* 1. PHYSICAL POLICE CLEARANCE STATUS */}
                  <div className="border border-black bg-white space-y-0">
                    <div className="bg-slate-100 text-black border-b border-black font-mono text-[9px] font-bold px-3 py-1 uppercase">
                      Physical Police Clearance Status
                    </div>
                    <div className="p-3 bg-white space-y-2 font-mono text-[10px] text-black">
                      <p className="font-bold">Clearance Result:</p>
                      <div className="space-y-1.5 pl-2">
                        <p className="font-bold">[ &nbsp;&nbsp; ] CLEAR (0 Criminal FIRs)</p>
                        <p className="font-bold">[ &nbsp;&nbsp; ] FLAGGED (FIRs On Record)</p>
                      </div>
                    </div>
                  </div>

                  {/* 2. POLICE OFFICER PHYSICAL HANDWRITING NOTES & REMARKS (EXPANDED TO FILL PAGE) */}
                  <div className="border border-black bg-white flex-1 flex flex-col min-h-[460px]">
                    <div className="bg-slate-100 text-black border-b border-black font-mono text-[9px] font-bold px-3 py-1 uppercase">
                      Police Officer Physical Handwriting Notes & Remarks
                    </div>
                    <div className="p-4 bg-white flex-1 min-h-[420px] relative" style={{
                      backgroundImage: 'repeating-linear-gradient(transparent, transparent 31px, #e2e8f0 31px, #e2e8f0 32px)',
                      backgroundAttachment: 'local'
                    }}>
                      {/* FULL PAGE RULED HANDWRITING LINES */}
                    </div>
                  </div>
                </div>

                {/* BOTTOM SIGNATURE & FOOTER WRAPPER */}
                <div className="pt-4 space-y-3 shrink-0">
                  {/* END SIGNATURE & DATE LINES */}
                  <div className="font-mono text-[10px] flex justify-between items-end">
                    <div>
                      <p className="font-bold text-black">Verifying Officer Name & Badge ID: ____________________________________</p>
                    </div>
                    <div>
                      <p className="font-bold text-black">Date: _____ / _____ / 2026</p>
                    </div>
                  </div>

                  {/* PAGE 2 FOOTER */}
                  <div className="pt-2 border-t border-black flex justify-between items-center text-[9px] font-mono text-black">
                    <span>{currentCompanyName} • Police Clearance Record ({candidate.candidate_id})</span>
                    <span className="font-bold">Page 2 of 2</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* FULL IMAGE PREVIEW MODAL */}
      {previewImage && (
        <ImageModal
          src={previewImage.src}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
};

export default PdfReportModal;
