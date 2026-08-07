import React, { useState, useEffect } from 'react';
import { X, FileText, ShieldCheck, CreditCard, Eye, Building2, Trash2 } from 'lucide-react';
import ImageModal from './ImageModal';
import { getCachedCandidate, fetchAndCacheCandidate } from '../utils/candidateCache';

const ComparisonModal = ({ candidate, onClose, onOpenPdfModal }) => {
  const [previewImage, setPreviewImage] = useState(null);
  
  // Synchronous initialization from memory cache for instant 0ms render
  const [fullCandidate, setFullCandidate] = useState(() => {
    const targetId = candidate?.id || candidate?.candidate_id;
    return getCachedCandidate(targetId) || candidate;
  });

  const activeCandidate = fullCandidate || candidate;
  
  const compName = activeCandidate?.company_name || activeCandidate?.organization || localStorage.getItem('report_company_name') || 'Keen Sighted Workforce Services';
  const [companyLogo, setCompanyLogo] = useState(activeCandidate?.company_logo || '');

  useEffect(() => {
    let isMounted = true;
    const targetId = candidate?.id || candidate?.candidate_id;
    const cached = getCachedCandidate(targetId);

    if (cached && (cached.photo_base64 || cached.face_photo_base64 || cached.aadhaar_front_base64)) {
      setFullCandidate(cached);
      return;
    }

    fetchAndCacheCandidate(candidate).then((updated) => {
      if (isMounted && updated) {
        setFullCandidate(updated);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [candidate]);

  const handleDeleteInModal = async () => {
    if (!activeCandidate) return;
    if (!window.confirm(`Are you sure you want to delete candidate "${activeCandidate.full_name}" (${activeCandidate.candidate_id})?\n\nThis will completely remove their record from the database so they can re-register.`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      const targetId = activeCandidate.id || activeCandidate.candidate_id;
      const compParam = activeCandidate.company_name ? `?company=${encodeURIComponent(activeCandidate.company_name)}` : '';

      let res = await fetch(`/api/candidate/${targetId}${compParam}`, {
        method: 'DELETE',
        headers,
      });

      if (res.status === 405) {
        res = await fetch(`/api/candidate/delete/${targetId}${compParam}`, {
          method: 'POST',
          headers,
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to delete candidate.');
      }
      alert(`Candidate ${activeCandidate.full_name} (${activeCandidate.candidate_id}) deleted successfully. They can now re-register.`);
      onClose();
      window.location.reload();
    } catch (err) {
      alert(`Delete Error: ${err.message}`);
    }
  };

  useEffect(() => {
    if (activeCandidate?.company_logo) {
      setCompanyLogo(activeCandidate.company_logo);
      return;
    }
    const comp = activeCandidate?.company_name || activeCandidate?.organization || compName;
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
  }, [activeCandidate, compName]);

  if (!activeCandidate) return null;

  // 1. Name Match Status (Strict Exact Character Matching)
  const getNameMatch = () => {
    const reg = (activeCandidate.full_name || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const ver = (activeCandidate.verified_name || '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (!reg || !ver) return { label: 'NO DATA', type: 'na' };
    if (reg === ver) return { label: 'MATCH ✓', type: 'match' };
    return { label: 'MISMATCH ✕', type: 'mismatch' };
  };

  // 2. Father's Name Match Status (Strict Exact Character Matching)
  const getFatherMatch = () => {
    const regRaw = (activeCandidate.reg_father_name || activeCandidate.father_name || '').trim().toUpperCase();
    const verRaw = (activeCandidate.verified_father_name || '').trim().toUpperCase();
    if (!regRaw || !verRaw) return { label: 'NO DATA', type: 'na' };
    
    const cleanReg = regRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    const cleanVer = verRaw.replace(/^(MR|SRI|S|D|W)\/O\s*/i, '').trim().replace(/\s+/g, ' ');
    if (cleanReg === cleanVer) return { label: 'MATCH ✓', type: 'match' };
    return { label: 'MISMATCH ✕', type: 'mismatch' };
  };

  // 3. Face Match Status (Strict Facial Feature Verification Only - Zero Fallbacks)
  const getFaceMatch = () => {
    const status = activeCandidate.face_match_status;
    const score = activeCandidate.face_match_score;
    const livePhoto = activeCandidate.face_photo_base64;
    const vaultPhoto = activeCandidate.photo_base64;

    if (!livePhoto || !vaultPhoto) {
      return { label: 'NO PHOTO', type: 'na' };
    }

    if (status === 'MISMATCH' || (score !== undefined && score !== null && score > 0 && score < 55)) {
      return { label: `MISMATCH ✕ (${score ? score + '%' : 'Mismatch'})`, type: 'mismatch' };
    }
    
    if (status === 'MATCH' || (score !== undefined && score !== null && score >= 55)) {
      return { label: `MATCH ✓ (${score ? score + '%' : 'Match'})`, type: 'match' };
    }

    return { label: 'MISMATCH ✕', type: 'mismatch' };
  };

  // 4. DOB Match Status
  const getDobMatch = () => {
    const reg = (activeCandidate.reg_dob || '').trim();
    const ver = (activeCandidate.verified_dob || '').trim();
    if (!reg || !ver) return { label: 'NO DATA', type: 'na' };
    if (reg === ver) return { label: 'MATCH ✓', type: 'match' };
    return { label: 'MISMATCH ✕', type: 'mismatch' };
  };

  const nameMatchStatus = getNameMatch();
  const fatherMatchStatus = getFatherMatch();
  const faceMatchStatus = getFaceMatch();
  const dobMatchStatus = getDobMatch();

  // Dynamic Failure Reasons Breakdown
  const getFailureReasons = () => {
    const reasons = [];
    if (nameMatchStatus.type === 'mismatch') {
      reasons.push(`Name Mismatch: Registered name "${activeCandidate.full_name || 'N/A'}" does not match UIDAI official e-KYC name "${activeCandidate.verified_name || 'N/A'}".`);
    }
    if (dobMatchStatus.type === 'mismatch') {
      reasons.push(`Date of Birth Mismatch: Registered DOB "${activeCandidate.reg_dob || 'N/A'}" does not match UIDAI official DOB "${activeCandidate.verified_dob || 'N/A'}".`);
    }
    if (fatherMatchStatus.type === 'mismatch') {
      reasons.push(`Father's Name Mismatch: Registered "${activeCandidate.reg_father_name || activeCandidate.father_name || 'N/A'}" does not match UIDAI official "${activeCandidate.verified_father_name || 'N/A'}".`);
    }
    if (faceMatchStatus.type === 'mismatch') {
      reasons.push(`Live Face Photo Mismatch: Live camera selfie does not match official UIDAI Aadhaar vault photo.`);
    }
    if (activeCandidate.verification_status === 'PENDING') {
      reasons.push(`OTP Pending: Candidate has not completed UIDAI Aadhaar OTP verification.`);
    }
    return reasons;
  };

  // Calculate Dynamic Match Score
  const calculateMatchScore = () => {
    if (activeCandidate.verification_status !== 'VERIFIED') return 0;
    let score = 0;
    if (nameMatchStatus.type === 'match') score += 35;
    else if (nameMatchStatus.type === 'mismatch') score += 10;
    if (fatherMatchStatus.type === 'match') score += 20;
    if (faceMatchStatus.type === 'match') score += 20;
    if (dobMatchStatus.type === 'match') score += 15;
    if (activeCandidate.aadhaar_number && activeCandidate.aadhaar_number.length === 12) score += 10;
    return Math.min(score, 100);
  };

  const matchScore = calculateMatchScore();
  const regFatherDisplay = activeCandidate.reg_father_name || activeCandidate.father_name || 'Not Provided';
  const verNameDisplay = activeCandidate.verified_name || activeCandidate.full_name || 'Not Verified';
  const verFatherDisplay = activeCandidate.verified_father_name || 'Not Provided';
  const verDobDisplay = activeCandidate.verified_dob || activeCandidate.reg_dob || '-';
  const verGenderDisplay = activeCandidate.verified_gender || activeCandidate.reg_gender || '-';
  const verAddressDisplay = activeCandidate.verified_address || activeCandidate.reg_address || '-';

  const renderMatchBadge = (statusObj) => {
    if (statusObj.type === 'match') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
          MATCH ✓
        </span>
      );
    }
    if (statusObj.type === 'mismatch') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
          MISMATCH ✕
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
        {statusObj.label}
      </span>
    );
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 overflow-hidden">
        <div className="bg-white rounded-3xl border border-slate-200 max-w-5xl w-full max-h-[90vh] flex flex-col shadow-2xl relative">
          
          {/* STICKY TOP HEADER - ALWAYS VISIBLE AT TOP */}
          <div className="p-5 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white rounded-t-3xl pr-14">
            <div className="flex items-center space-x-4">
              <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 flex items-center justify-center p-1 overflow-hidden shrink-0 shadow-sm">
                {companyLogo ? (
                  <img src={companyLogo} alt={compName} className="max-w-full max-h-full object-contain" />
                ) : (
                  <Building2 className="w-7 h-7 text-indigo-600" />
                )}
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight">
                    {compName}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Candidate Verification Report
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Side-by-Side Identity Comparison &bull; <strong className="text-slate-900">{candidate.full_name}</strong> ({candidate.candidate_id})
                  {(activeCandidate.reg_project_name || activeCandidate.project_name) && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200">
                      Project: {activeCandidate.reg_project_name || activeCandidate.project_name}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {onOpenPdfModal && (
              <button
                onClick={() => {
                  onClose();
                  onOpenPdfModal(candidate);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer shrink-0"
              >
                <FileText className="w-4 h-4" />
                <span>Generate Official PDF</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="absolute top-5 right-5 text-slate-400 hover:text-slate-700 p-1.5 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* SCROLLABLE MODAL BODY (STARTS AT TOP EVERY TIME) */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1">
            
            {/* MATCH CONFIDENCE SCORE BAR METER */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    Identity Match Confidence Score
                  </span>
                  <h4 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                    {matchScore}%
                  </h4>
                </div>
                {matchScore >= 80 ? (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    HIGH CONFIDENCE MATCH ✓
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                    VARIATION DETECTED ℹ️
                  </span>
                )}
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    matchScore >= 80 ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${matchScore}%` }}
                />
              </div>
            </div>

            {/* ================= 1. TWO IDENTITY PHOTOS AT TOP ================= */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                1. Candidate Identity Photos (Live vs e-KYC Vault)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* PHOTO 1: CAPTURED LIVE FACE */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <span className="text-xs uppercase text-indigo-700 block font-bold">
                    Captured Live Face
                  </span>
                  <div
                    className="w-36 h-36 mx-auto rounded-2xl overflow-hidden border-2 border-indigo-300 bg-slate-900 cursor-pointer hover:border-indigo-600 hover:scale-105 transition-all group relative shadow-sm"
                    onClick={() =>
                      activeCandidate.face_photo_base64 &&
                      setPreviewImage({ src: activeCandidate.face_photo_base64, title: `Captured Live Face - ${activeCandidate.full_name}` })
                    }
                    title="Click for full view"
                  >
                    {activeCandidate.face_photo_base64 ? (
                      <>
                        <img src={activeCandidate.face_photo_base64} alt="Captured Face" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-medium">
                        NO SELFIE
                      </div>
                    )}
                  </div>
                  <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    Live Registration Selfie
                  </span>
                </div>

                {/* PHOTO 2: AADHAAR VAULT PHOTO */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <span className="text-xs uppercase text-emerald-700 block font-bold">
                    Aadhaar Vault Photo
                  </span>
                  <div
                    className="w-36 h-36 mx-auto rounded-2xl overflow-hidden border-2 border-emerald-300 bg-slate-900 cursor-pointer hover:border-emerald-600 hover:scale-105 transition-all group relative shadow-sm"
                    onClick={() =>
                      activeCandidate.photo_base64 &&
                      setPreviewImage({ src: activeCandidate.photo_base64, title: `Aadhaar Vault Photo - ${activeCandidate.full_name}` })
                    }
                    title="Click for full view"
                  >
                    {activeCandidate.photo_base64 ? (
                      <>
                        <img src={activeCandidate.photo_base64} alt="Aadhaar Photo" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-medium">
                        NO VAULT PHOTO
                      </div>
                    )}
                  </div>
                  <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    ✓ Official e-KYC Vault
                  </span>
                </div>
              </div>
            </div>

            {/* ================= 2. SIDE-BY-SIDE DETAILS BELOW PHOTOS ================= */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                2. Personal Registration & Verified Aadhaar Details
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* LEFT: REGISTERED CANDIDATE INFO */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <span className="text-[10px] uppercase text-indigo-700 block font-bold border-b border-slate-200 pb-1">
                    REGISTERED CANDIDATE INFO
                  </span>
                  <div className="space-y-2 pt-1 text-slate-700 font-medium">
                    {!activeCandidate.hide_company_name && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Organization:</span>
                        <span className="font-bold text-indigo-700 inline-flex items-center gap-1.5">
                          {companyLogo && <img src={companyLogo} alt="Logo" className="w-4 h-4 object-contain rounded-xs" />}
                          <span>{compName}</span>
                        </span>
                      </div>
                    )}
                    <p><span className="text-slate-500">Full Name:</span> <span className="font-bold text-slate-900">{activeCandidate.full_name}</span></p>
                    <p><span className="text-slate-500">Father's Name:</span> <span className="font-semibold text-slate-800">{regFatherDisplay}</span></p>
                    <p><span className="text-slate-500">Designation / Role:</span> <span className="font-semibold text-slate-800">{activeCandidate.reg_designation || activeCandidate.designation || '-'}</span></p>
                    <p><span className="text-slate-500">State:</span> <span className="font-semibold text-slate-800">{activeCandidate.reg_state || activeCandidate.state || '-'}</span></p>
                    <p><span className="text-slate-500">District:</span> <span className="font-semibold text-slate-800">{activeCandidate.reg_district || activeCandidate.district || '-'}</span></p>
                    <p><span className="text-slate-500">Mobile Phone:</span> {activeCandidate.phone}</p>
                    <p><span className="text-slate-500">Email Address:</span> {activeCandidate.email || '-'}</p>
                    <p><span className="text-slate-500">Aadhaar Number:</span> XXXX-XXXX-{activeCandidate.aadhaar_number?.slice(-4)}</p>
                    <p><span className="text-slate-500">Registered DOB:</span> {activeCandidate.reg_dob || '-'}</p>
                    <p><span className="text-slate-500">Registered Gender:</span> {activeCandidate.reg_gender || '-'}</p>
                    <p><span className="text-slate-500">Registered Address:</span> {activeCandidate.reg_address || '-'}</p>
                  </div>
                </div>

                {/* RIGHT: OFFICIAL AADHAAR VAULT RECORD */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <span className="text-[10px] uppercase text-emerald-700 block font-bold border-b border-slate-200 pb-1">
                    OFFICIAL AADHAAR VAULT RECORD
                  </span>
                  <div className="space-y-2 pt-1 text-slate-700 font-medium">
                    <p><span className="text-slate-500">Verified Name:</span> <span className="font-bold text-emerald-700">{verNameDisplay}</span></p>
                    <p><span className="text-slate-500">Verified Father (C/O):</span> <span className="font-bold text-emerald-700">{verFatherDisplay}</span></p>
                    <p><span className="text-slate-500">Verified DOB:</span> <span className="font-semibold text-slate-800">{verDobDisplay}</span></p>
                    <p><span className="text-slate-500">Verified Gender:</span> <span className="font-semibold text-slate-800">{verGenderDisplay}</span></p>
                    <p><span className="text-slate-500">Masked Aadhaar:</span> XXXX-XXXX-{activeCandidate.aadhaar_number?.slice(-4)}</p>
                    <p><span className="text-slate-500">Aadhaar Address:</span> <span className="text-slate-800">{verAddressDisplay}</span></p>
                    <p><span className="text-slate-500">Verification Time:</span> {activeCandidate.verified_at ? new Date(activeCandidate.verified_at).toLocaleString() : 'Recently Verified'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= 3. ATTRIBUTE MATCH MATRIX BELOW DETAILS ================= */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                3. Verification Match Matrix
              </span>
              <div className="rounded-2xl border border-slate-200 overflow-hidden text-xs">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 font-semibold text-[10px] text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="p-3">Attribute Matrix</th>
                      <th className="p-3 text-center">Name Match</th>
                      <th className="p-3 text-center">Father's Name Match</th>
                      <th className="p-3 text-center">Face Match</th>
                      <th className="p-3 text-center">DOB Match</th>
                      <th className="p-3 text-center">Aadhaar Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="p-3 font-bold text-slate-800">Verification Result</td>
                      <td className="p-3 text-center">{renderMatchBadge(nameMatchStatus)}</td>
                      <td className="p-3 text-center">{renderMatchBadge(fatherMatchStatus)}</td>
                      <td className="p-3 text-center">{renderMatchBadge(faceMatchStatus)}</td>
                      <td className="p-3 text-center">{renderMatchBadge(dobMatchStatus)}</td>
                      <td className="p-3 text-center">
                        {activeCandidate.verification_status === 'VERIFIED' ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            VERIFIED ✓
                          </span>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            PENDING
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* ================= 4. AADHAAR FRONT & BACK DOCUMENTS AT BOTTOM ================= */}
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                4. Official Aadhaar Card Document Attachments
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* PHOTO 3: AADHAAR FRONT DOCUMENT */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs uppercase text-slate-800 font-extrabold flex items-center">
                      <CreditCard className="w-4 h-4 mr-1.5 text-indigo-600" />
                      Aadhaar Front Document
                    </span>
                    <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
                      Front Side
                    </span>
                  </div>
                  <div
                    className="w-full h-[450px] flex items-center justify-center cursor-pointer hover:opacity-95 transition-opacity group relative border border-slate-200 bg-white rounded-xl p-2"
                    onClick={() =>
                      activeCandidate.aadhaar_front_base64 &&
                      setPreviewImage({ src: activeCandidate.aadhaar_front_base64, title: `Aadhaar Front Document - ${activeCandidate.full_name}` })
                    }
                    title="Click to view full screen"
                  >
                    {activeCandidate.aadhaar_front_base64 ? (
                      <>
                        <img src={activeCandidate.aadhaar_front_base64} alt="Aadhaar Front" className="max-h-full max-w-full object-contain" />
                        <div className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                          <span className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center shadow-lg">
                            <Eye className="w-4 h-4 mr-1.5" /> Full Screen View
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-semibold bg-white rounded-xl border border-slate-200">
                        NO FRONT DOCUMENT IMAGE
                      </div>
                    )}
                  </div>
                </div>

                {/* PHOTO 4: AADHAAR BACK DOCUMENT */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs uppercase text-slate-800 font-extrabold flex items-center">
                      <CreditCard className="w-4 h-4 mr-1.5 text-indigo-600" />
                      Aadhaar Back Document
                    </span>
                    <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
                      Back Side / Address
                    </span>
                  </div>
                  <div
                    className="w-full h-[450px] flex items-center justify-center cursor-pointer hover:opacity-95 transition-opacity group relative border border-slate-200 bg-white rounded-xl p-2"
                    onClick={() =>
                      activeCandidate.aadhaar_back_base64 &&
                      setPreviewImage({ src: activeCandidate.aadhaar_back_base64, title: `Aadhaar Back Document - ${activeCandidate.full_name}` })
                    }
                    title="Click to view full screen"
                  >
                    {activeCandidate.aadhaar_back_base64 ? (
                      <>
                        <img src={activeCandidate.aadhaar_back_base64} alt="Aadhaar Back" className="max-h-full max-w-full object-contain" />
                        <div className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                          <span className="bg-indigo-600 text-white text-xs font-bold px-3 py-1.5 rounded-xl flex items-center shadow-lg">
                            <Eye className="w-4 h-4 mr-1.5" /> Full Screen View
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-semibold bg-white rounded-xl border border-slate-200">
                        NO BACK DOCUMENT IMAGE
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* STICKY FOOTER */}
          <div className="p-4 px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0 rounded-b-3xl">
            <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Aadhaar e-KYC Verified Security Record</span>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs transition-colors cursor-pointer"
              >
                Close Window
              </button>
              {onOpenPdfModal && (
                <button
                  onClick={() => {
                    onClose();
                    onOpenPdfModal(candidate);
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  <span>Generate Official PDF</span>
                </button>
              )}
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

export default ComparisonModal;
