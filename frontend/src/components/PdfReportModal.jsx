import React, { useRef, useState, useEffect } from 'react';
import { X, Download, Printer, FileText, Eye } from 'lucide-react';
import ImageModal from './ImageModal';
import { getCachedCandidate, fetchAndCacheCandidate } from '../utils/candidateCache';

const PdfReportModal = ({ candidate, onClose }) => {
  const printRef = useRef(null);
  const [downloading, setDownloading] = useState(false);
  const [, setLoadingDetails] = useState(true);
  const [previewImage, setPreviewImage] = useState(null);

  // Synchronously initialize from cache for instant 0ms render
  const [fullCandidate, setFullCandidate] = useState(() => {
    const targetId = candidate?.id || candidate?.candidate_id;
    return getCachedCandidate(targetId) || candidate;
  });

  const activeCandidate = fullCandidate || candidate;

  useEffect(() => {
    let isMounted = true;
    const targetId = candidate?.id || candidate?.candidate_id;
    const cached = getCachedCandidate(targetId);

    if (cached && (cached.photo_base64 || cached.face_photo_base64 || cached.aadhaar_front_base64)) {
      setFullCandidate(cached);
      setLoadingDetails(false);
      return;
    }

    setLoadingDetails(true);
    fetchAndCacheCandidate(candidate).then((updated) => {
      if (isMounted && updated) {
        setFullCandidate(updated);
      }
      if (isMounted) setLoadingDetails(false);
    });

    return () => {
      isMounted = false;
    };
  }, [candidate]);

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
        .catch(() => { });
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
    if (!reg || !ver) return { label: 'NO DATA' };
    if (reg === ver) return { label: 'MATCH ✓' };
    return { label: 'MISMATCH ✕' };
  };

  const getFatherMatch = () => {
    const regRaw = (activeCandidate.reg_father_name || activeCandidate.father_name || '').trim().toUpperCase();
    const verRaw = (activeCandidate.verified_father_name || '').trim().toUpperCase();
    if (!regRaw || !verRaw || regRaw === 'NOT PROVIDED' || verRaw === 'NOT PROVIDED') {
      return { label: 'NO DATA' };
    }
    const cleanReg = regRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    const cleanVer = verRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    if (cleanReg === cleanVer) {
      return { label: 'MATCH ✓' };
    }
    return { label: 'MISMATCH ✕' };
  };

  const getFaceMatch = () => {
    const status = activeCandidate.face_match_status;
    const score = activeCandidate.face_match_score;
    const facePhoto = activeCandidate.face_photo_base64 || activeCandidate.photo_base64;
    const vaultPhoto = activeCandidate.photo_base64 || activeCandidate.face_photo_base64;

    if (!facePhoto || !vaultPhoto) {
      return { label: 'NO DATA' };
    }

    if (status === 'MISMATCH' || (score !== undefined && score !== null && score > 0 && score < 55)) {
      return { label: `MISMATCH ✕ (${score ? score + '%' : 'Mismatch'})` };
    }
    if (status === 'MATCH' || (score !== undefined && score !== null && score >= 55)) {
      return { label: `MATCH ✓ (${score ? score + '%' : 'Match'})` };
    }

    return { label: 'MISMATCH ✕' };
  };

  const getDobMatch = () => {
    const reg = (activeCandidate.reg_dob || '').trim();
    const ver = (activeCandidate.verified_dob || '').trim();
    if (!reg || !ver) return { label: 'NO DATA' };
    if (reg === ver) return { label: 'MATCH ✓' };
    return { label: 'MISMATCH ✕' };
  };

  const getCardMatch = () => {
    const status = (activeCandidate.card_ocr_status || '').toUpperCase();
    if (status === 'MATCH') return { label: 'MATCH ✓' };
    if (status === 'MISMATCH') return { label: 'MISMATCH ✕' };
    if (status === 'BLUR' || status === 'BLANK') return { label: 'BLUR / BLANK ⚠' };
    if (status === 'NO_CARD') return { label: 'NO CARD' };
    const hasFront = activeCandidate.aadhaar_front_base64;
    const hasBack = activeCandidate.aadhaar_back_base64;
    if (!hasFront && !hasBack) return { label: 'NO CARD' };
    return { label: 'UNREADABLE ✕' };
  };

  const pdfNameStatus = getNameMatch();
  const pdfFatherStatus = getFatherMatch();
  const pdfFaceStatus = getFaceMatch();
  const pdfDobStatus = getDobMatch();
  const pdfCardStatus = getCardMatch();

  const defaultFaceImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'><rect width='100%' height='100%' fill='%2372f772'/></svg>";
  const defaultAadhaarImg = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='500' height='220' viewBox='0 0 500 220'><rect width='100%' height='100%' fill='%2372f772'/></svg>";

  const liveSelfie = activeCandidate.face_photo_base64 || defaultFaceImg;
  const vaultPhoto = activeCandidate.photo_base64 || defaultFaceImg;
  const aadhaarFront = activeCandidate.aadhaar_front_base64 || defaultAadhaarImg;
  const aadhaarBack = activeCandidate.aadhaar_back_base64 || defaultAadhaarImg;

  const currentCompanyName = companyName.trim() || 'Keen Sighted Workforce Services';
  const aadhaarLast4 = activeCandidate.aadhaar_number ? activeCandidate.aadhaar_number.slice(-4) : '9012';

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
                <span className="text-xs text-slate-500 font-medium">Exact 2-Page Official Print Format &bull; {activeCandidate.full_name}</span>
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
          <div className="p-6 bg-slate-500 max-h-[82vh] overflow-y-auto flex flex-col items-center space-y-8">
            <div id="printable-pdf-report" ref={printRef} className="w-[210mm] flex flex-col items-center gap-8">

              {/* ================= PAGE 1 ================= */}
              <div className="pdf-page bg-white p-[10mm] text-black font-sans relative flex flex-col justify-between shadow-2xl w-[210mm] h-[285mm] box-border">

                {/* TOP CONTENT WRAPPER */}
                <div className="flex flex-col space-y-2.5">
                  {/* TOP HEADER */}
                  <div className="text-center">
                    {companyLogo ? (
                      <div className="w-14 h-14 mx-auto mb-1 flex items-center justify-center">
                        <img src={companyLogo} alt={currentCompanyName} className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : null}
                    <h1 className="text-xl font-bold uppercase tracking-wide text-black font-sans mb-1">
                      {currentCompanyName}
                    </h1>
                    <div className="border-t border-b border-black py-1 mb-1">
                      <p className="text-xs font-bold uppercase text-black tracking-wide font-sans">
                        Candidate Identity &amp; Aadhaar e-KYC Verification Report
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold border-b border-black pb-1.5 text-black">
                      <span><strong>Candidate ID:</strong> {activeCandidate.candidate_id || 'ID0001'}</span>
                      <span>
                        <strong>Status:</strong>{' '}
                        {activeCandidate.verification_status === 'VERIFIED' ? (
                          <span>VERIFIED e-KYC ✓</span>
                        ) : activeCandidate.verification_status === 'FAILED' ? (
                          <span>FAILED ✕</span>
                        ) : (
                          <span>PENDING ⚠</span>
                        )}
                      </span>
                      <span><strong>Date:</strong> {new Date().toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* 1. CANDIDATE IDENTITY PHOTOS */}
                  <div className="space-y-1 pt-1">
                    <div className="bg-black text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 font-sans">
                      1. Candidate Identity Photos
                    </div>

                    <div className="bg-white p-1 grid grid-cols-2 gap-4 justify-items-center">
                      {/* LIVE CAPTURED SELFIE */}
                      <div className="text-center space-y-1">
                        <span className="text-[10px] font-bold font-sans text-black block uppercase">
                          LIVE CAPTURED SELFIE
                        </span>
                        <div
                          className="w-[135px] h-[155px] overflow-hidden border border-black bg-white cursor-pointer group relative shadow-xs"
                          onClick={() => setPreviewImage({ src: liveSelfie, title: `Live Selfie - ${activeCandidate.full_name}` })}
                          title="Click to view image"
                        >
                          <img
                            src={liveSelfie}
                            alt="Live Selfie"
                            loading="eager"
                            decoding="sync"
                            className="w-full h-full object-cover"
                          />
                          <div className="no-print-overlay absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      </div>

                      {/* AADHAAR e-KYC VAULT PHOTO */}
                      <div className="text-center space-y-1">
                        <span className="text-[10px] font-bold font-sans text-black block uppercase">
                          AADHAAR e-KYC VAULT PHOTO
                        </span>
                        <div
                          className="w-[135px] h-[155px] overflow-hidden border border-black bg-white cursor-pointer group relative shadow-xs"
                          onClick={() => setPreviewImage({ src: vaultPhoto, title: `Aadhaar Vault Photo - ${activeCandidate.full_name}` })}
                          title="Click to view image"
                        >
                          <img
                            src={vaultPhoto}
                            alt="Aadhaar Vault Photo"
                            loading="eager"
                            decoding="sync"
                            className="w-full h-full object-cover"
                          />
                          <div className="no-print-overlay absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <Eye className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. PERSONAL REGISTRATION & VERIFIED AADHAAR DETAILS */}
                  <div className="space-y-1">
                    <div className="bg-black text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 font-sans">
                      2. Personal Registration &amp; Verified Aadhaar Details
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-sans">
                      {/* LEFT: REGISTERED CANDIDATE INFO */}
                      <div className="border border-slate-600 bg-white p-2.5 space-y-1">
                        <div className="bg-white text-black border-b border-slate-600 font-sans text-[10px] font-bold pb-1 text-center uppercase">
                          Registered Candidate Info
                        </div>
                        <div className="pt-1 space-y-1 text-[10px] text-black leading-snug">
                          <p><strong>Company Name:</strong> {currentCompanyName}</p>
                          <p><strong>Project Name:</strong> {activeCandidate.reg_project_name || activeCandidate.project_name || 'Site Verification Project'}</p>
                          <p><strong>Full Name:</strong> {activeCandidate.full_name || 'Ramesh Kumar'}</p>
                          <p><strong>Father&apos;s Name:</strong> {regFather}</p>
                          <p><strong>Mobile Phone:</strong> {activeCandidate.phone || '9876543210'}</p>
                          <p><strong>Aadhaar No:</strong> XXXX-XXXX-{aadhaarLast4}</p>
                          <p><strong>Date of Birth:</strong> {activeCandidate.reg_dob || '15/08/1995'}</p>
                          <p className="break-words"><strong>Address:</strong> {activeCandidate.reg_address || 'Flat 402, Greenfield Apartments, Sector 62, Noida, UP - 201301'}</p>
                        </div>
                      </div>

                      {/* RIGHT: AADHAAR VAULT RECORD */}
                      <div className="border border-slate-600 bg-white p-2.5 space-y-1">
                        <div className="bg-white text-black border-b border-slate-600 font-sans text-[10px] font-bold pb-1 text-center uppercase">
                          Aadhaar Vault Record
                        </div>
                        <div className="pt-1 space-y-1 text-[10px] text-black leading-snug">
                          <p><strong>Verified Name:</strong> {verName}</p>
                          <p><strong>Verified Father&apos;s Name:</strong> {verFather}</p>
                          <p><strong>Verified DOB:</strong> {verDob}</p>
                          <p><strong>Gender:</strong> {verGender}</p>
                          <p><strong>Masked Aadhaar:</strong> XXXX-XXXX-{aadhaarLast4}</p>
                          <p className="break-words"><strong>Aadhaar Address:</strong> {verAddress}</p>
                          <p><strong>Verified At:</strong> {activeCandidate.verified_at ? new Date(activeCandidate.verified_at).toLocaleString() : '2026-08-06 21:45:00'}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 3. OFFICIAL AADHAAR CARD DOCUMENT ATTACHMENTS */}
                  <div className="space-y-1">
                    <div className="bg-black text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 font-sans">
                      3. Official Aadhaar Card Document Attachments
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-0.5">
                      {/* FRONT CARD VIEW */}
                      <div className="p-1 text-center space-y-1">
                        <span className="text-[10px] font-bold font-sans text-black block uppercase">
                          AADHAAR CARD - FRONT VIEW
                        </span>
                        <div
                          className="w-full flex items-center justify-center cursor-pointer group relative h-[190px]"
                          onClick={() => setPreviewImage({ src: aadhaarFront, title: `Aadhaar Front - ${activeCandidate.full_name}` })}
                        >
                          <img
                            src={aadhaarFront}
                            alt="Aadhaar Front Document"
                            loading="eager"
                            decoding="sync"
                            className="max-h-[185px] w-auto max-w-full object-contain"
                          />
                        </div>
                      </div>

                      {/* BACK CARD VIEW */}
                      <div className="p-1 text-center space-y-1">
                        <span className="text-[10px] font-bold font-sans text-black block uppercase">
                          AADHAAR CARD - BACK VIEW / ADDRESS
                        </span>
                        <div
                          className="w-full flex items-center justify-center cursor-pointer group relative h-[190px]"
                          onClick={() => setPreviewImage({ src: aadhaarBack, title: `Aadhaar Back - ${activeCandidate.full_name}` })}
                        >
                          <img
                            src={aadhaarBack}
                            alt="Aadhaar Back Document"
                            loading="eager"
                            decoding="sync"
                            className="max-h-[185px] w-auto max-w-full object-contain"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4. ATTRIBUTE MATCH MATRIX */}
                  <div className="space-y-1">
                    <div className="bg-black text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 font-sans">
                      4. Attribute Match Matrix
                    </div>
                    <table className="w-full text-center font-sans text-[10px] border-collapse border border-black">
                      <thead className="bg-white text-black font-bold border-b border-black">
                        <tr>
                          <th className="p-1 border-r border-black w-[15%]">Name Match</th>
                          <th className="p-1 border-r border-black w-[18%]">Father's Name Match</th>
                          <th className="p-1 border-r border-black w-[15%]">Face Match</th>
                          <th className="p-1 border-r border-black w-[15%]">DOB Match</th>
                          <th className="p-1 border-r border-black w-[20%]">Uploaded Card Match</th>
                          <th className="p-1 w-[17%]">Aadhaar Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="p-1.5 border-r border-black font-bold text-black">{pdfNameStatus.label}</td>
                          <td className="p-1.5 border-r border-black font-bold text-black">{pdfFatherStatus.label}</td>
                          <td className="p-1.5 border-r border-black font-bold text-black">{pdfFaceStatus.label}</td>
                          <td className="p-1.5 border-r border-black font-bold text-black">{pdfDobStatus.label}</td>
                          <td className="p-1.5 border-r border-black font-bold text-black">{pdfCardStatus.label}</td>
                          <td className="p-1.5 font-bold text-black">
                            {activeCandidate.verification_status === 'VERIFIED' ? 'VERIFIED ✓' : activeCandidate.verification_status === 'FAILED' ? 'FAILED ✕' : 'PENDING ⚠'}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* PAGE 1 FOOTER */}
                <div className="pt-2 border-t border-slate-400 flex justify-between items-center text-[9px] font-sans text-black">
                  <span>{currentCompanyName} • Verification Report ({activeCandidate.candidate_id || 'ID0001'})</span>
                  <span className="font-bold">Page 1 of 2</span>
                </div>
              </div>

              {/* PAGE BREAK MARKER */}
              <div className="html2pdf__page-break pdf-page-break" style={{ height: '0px', margin: '0', padding: '0', pageBreakBefore: 'always' }} />

              {/* ================= PAGE 2 ================= */}
              <div className="pdf-page bg-white p-[10mm] text-black font-sans relative flex flex-col justify-between shadow-2xl w-[210mm] h-[285mm] box-border">

                {/* TOP CONTENT WRAPPER */}
                <div className="flex flex-col flex-1 space-y-2">
                  {/* TOP HEADER */}
                  <div className="text-center">
                    {companyLogo ? (
                      <div className="w-14 h-14 mx-auto mb-1 flex items-center justify-center">
                        <img src={companyLogo} alt={currentCompanyName} className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : null}
                    <h2 className="text-xl font-bold uppercase tracking-wide text-black font-sans mb-1">
                      {currentCompanyName}
                    </h2>
                    <div className="border-t border-b border-black py-1 mb-1">
                      <p className="text-xs font-bold uppercase text-black tracking-wide font-sans">
                        Candidate Identity &amp; Aadhaar e-KYC Verification Report
                      </p>
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold border-b border-black pb-1.5 text-black">
                      <span><strong>Candidate ID:</strong> {activeCandidate.candidate_id || 'ID0001'}</span>
                      <span>
                        <strong>Status:</strong>{' '}
                        {activeCandidate.verification_status === 'VERIFIED' ? (
                          <span>VERIFIED e-KYC ✓</span>
                        ) : activeCandidate.verification_status === 'FAILED' ? (
                          <span>FAILED ✕</span>
                        ) : (
                          <span>PENDING ⚠</span>
                        )}
                      </span>
                      <span><strong>Date:</strong> {new Date().toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* DETAILS SUMMARY BOX ABOVE SECTION 5 */}
                  <div className="border border-black bg-slate-50 p-2.5 my-1 text-[10px] font-sans">
                    <div className="grid grid-cols-2 gap-2">
                      <p><strong>Full Name:</strong> {activeCandidate.full_name || 'Ramesh Kumar'}</p>
                      <p><strong>Father&apos;s Name:</strong> {regFather}</p>
                      <p><strong>Mobile Number:</strong> {activeCandidate.phone || '9876543210'}</p>
                      <p><strong>Aadhaar Number:</strong> XXXX-XXXX-{aadhaarLast4}</p>
                    </div>
                  </div>

                  {/* 5. POLICE OFFICER HANDWRITTEN NOTES & REMARKS */}
                  <div className="bg-black text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 font-sans">
                    5. Police Officer Handwritten Notes &amp; Remarks
                  </div>

                  {/* REMARKS BOX */}
                  <div className="border border-black bg-white flex-1 min-h-[170mm]"></div>
                </div>

                {/* BOTTOM SIGNATURE & FOOTER WRAPPER */}
                <div className="pt-2 space-y-2 shrink-0">
                  <div className="text-[11px] flex justify-between items-end font-sans font-bold text-black pt-2">
                    <div className="flex items-end space-x-2">
                      <span>Verifying Officer Name &amp; Badge ID:</span>
                      <div className="border-b border-black w-[250px]"></div>
                    </div>
                    <div>
                      <p>Date: ______ / ______ / 2026</p>
                    </div>
                  </div>

                  {/* PAGE 2 FOOTER */}
                  <div className="pt-2 border-t border-slate-400 flex justify-between items-center text-[9px] font-sans text-black">
                    <span>{currentCompanyName} • Verification Report ({activeCandidate.candidate_id || 'ID0001'})</span>
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