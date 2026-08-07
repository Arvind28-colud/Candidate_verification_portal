import React, { useState, useEffect } from 'react';
import {
  Users,
  Search,
  RefreshCw,
  Mail,
  Link2,
  Smartphone,
  Check,
  Copy,
  Send,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Trash2,
  FileSpreadsheet,
  FileText,
  Download,
  CheckSquare,
  Square,
  Filter,
  MapPin,
} from 'lucide-react';
import { exportCandidatesToExcel } from '../utils/excelExporter';
import { downloadCandidatePdf, downloadBulkPdfsZip } from '../utils/pdfGenerator';
import { fetchAndCacheCandidate } from '../utils/candidateCache';

const UploadedCandidatesTab = ({ token, activeCompany, onOpenVerifyModal }) => {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'COMPLETED' | 'PENDING' | 'FAILED'
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [selectedCandidateIds, setSelectedCandidateIds] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  // Background API sending & export states
  const [sendingIdMap, setSendingIdMap] = useState({});
  const [sentSuccessMap, setSentSuccessMap] = useState({});
  const [batchSending, setBatchSending] = useState(false);
  const [downloadingPdfId, setDownloadingPdfId] = useState(null);
  const [bulkPdfProgress, setBulkPdfProgress] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [runningFaceVerify, setRunningFaceVerify] = useState(false);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const handleRunBatchFaceVerify = async () => {
    if (!window.confirm(`Run ArcFace AI facial verification on all ${candidates.length} candidates in database?`)) return;
    setRunningFaceVerify(true);
    try {
      const res = await fetch('/api/batch-face-verify', {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const s = data.data || {};
        setToastMessage(`Batch AI Face Verification Complete: ${s.processed || 0} Processed (${s.matches || 0} Matches, ${s.mismatches || 0} Mismatches, ${s.failed || 0} Failed)`);
        fetchCandidates();
      } else {
        alert(data.detail || data.message || "Face verification error");
      }
    } catch (err) {
      console.error("Batch face verify error:", err);
      alert("Error running facial verification.");
    } finally {
      setRunningFaceVerify(false);
    }
  };

  const fetchCandidates = async () => {
    setLoading(true);
    try {
      let url = '/api/candidates';
      if (activeCompany && activeCompany !== 'ALL') {
        url += `?company=${encodeURIComponent(activeCompany)}`;
      }
      const res = await fetch(url, { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setCandidates(data.candidates || []);
      }
    } catch (err) {
      console.error('Error fetching uploaded candidates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCandidates();
  }, [activeCompany]);

  const handleDeleteCandidate = async (cand) => {
    if (!window.confirm(`Are you sure you want to delete candidate "${cand.full_name}" (${cand.candidate_id})?\n\nThis will completely remove their record from the database so they can re-register.`)) {
      return;
    }

    try {
      const targetId = cand.id || cand.candidate_id;
      const compParam = cand.company_name ? `?company=${encodeURIComponent(cand.company_name)}` : '';

      let res = await fetch(`/api/candidate/${targetId}${compParam}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (res.status === 405) {
        res = await fetch(`/api/candidate/delete/${targetId}${compParam}`, {
          method: 'POST',
          headers: authHeaders(),
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to delete candidate.');
      }
      alert(`Candidate ${cand.full_name} (${cand.candidate_id}) has been deleted. They can now re-register.`);
      fetchCandidates();
    } catch (err) {
      alert(`Delete Error: ${err.message}`);
    }
  };

  // Dispatch Email Link directly for a single candidate
  const handleSendEmailSingle = async (cand) => {
    const candId = cand.candidate_id;
    setSendingIdMap((prev) => ({ ...prev, [candId]: true }));
    setToastMessage('');

    try {
      const res = await fetch('/api/candidates/send-email', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          candidate_id: cand.candidate_id,
          company_name: cand.company_name,
          email: cand.email,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to send verification email.');
      }
      setSentSuccessMap((prev) => ({ ...prev, [candId]: true }));
      setToastMessage(`Email link sent to ${cand.email} (${cand.full_name})`);
      setTimeout(() => setToastMessage(''), 4000);
    } catch (err) {
      alert(`Email Notice: ${err.message}`);
    } finally {
      setSendingIdMap((prev) => ({ ...prev, [candId]: false }));
    }
  };

  // Batch action: Dispatch Email links to all candidates in background
  const handleSendAllEmail = async () => {
    if (!candidates || candidates.length === 0) return;

    setBatchSending(true);
    setToastMessage('');

    let sentCount = 0;
    for (const cand of candidates) {
      try {
        setSendingIdMap((prev) => ({ ...prev, [cand.candidate_id]: true }));
        const res = await fetch('/api/candidates/send-email', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            candidate_id: cand.candidate_id,
            company_name: cand.company_name,
            email: cand.email,
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setSentSuccessMap((prev) => ({ ...prev, [cand.candidate_id]: true }));
          sentCount++;
        }
      } catch (err) {
        console.error(`Batch email send failed for ${cand.candidate_id}:`, err);
      } finally {
        setSendingIdMap((prev) => ({ ...prev, [cand.candidate_id]: false }));
      }
    }

    setBatchSending(false);
    setToastMessage(`Batch complete: e-KYC verification emails dispatched to ${sentCount} candidates!`);
    setTimeout(() => setToastMessage(''), 5000);
  };

  // Helper to copy candidate verification link
  const copyVerificationLink = (cand) => {
    const comp = cand.company_name || activeCompany || 'Company';
    const compParam = encodeURIComponent(comp);
    const link = `${window.location.origin}/?candidate_id=${cand.candidate_id}&company=${compParam}`;
    
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link).catch(() => fallbackCopyText(link));
    } else {
      fallbackCopyText(link);
    }
    setCopiedId(cand.candidate_id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const fallbackCopyText = (text) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('Fallback copy failed:', err);
    }
  };

  // Single Candidate PDF Download with full photo retrieval
  const handleDownloadSinglePdf = async (cand) => {
    setDownloadingPdfId(cand.candidate_id);
    try {
      let fullCand = cand;
      if (!cand.photo_base64 && !cand.face_photo_base64) {
        const compParam = cand.company_name ? `?company=${encodeURIComponent(cand.company_name)}` : '';
        const targetId = cand.id || cand.candidate_id;
        const res = await fetch(`/api/candidate/${targetId}${compParam}`, { headers: authHeaders() });
        const data = await res.json();
        if (data.success && data.candidate) {
          fullCand = data.candidate;
        }
      }
      await downloadCandidatePdf(fullCand, activeCompany, token);
      setToastMessage(`Downloaded PDF report for ${cand.full_name}`);
      setTimeout(() => setToastMessage(''), 3500);
    } catch (err) {
      alert(`PDF Generation Error: ${err.message}`);
    } finally {
      setDownloadingPdfId(null);
    }
  };

  // Bulk PDF Download packaged into a single ZIP file
  const handleBulkPdfDownload = async () => {
    const listToDownload = selectedCandidateIds.length > 0
      ? filteredCandidates.filter((c) => selectedCandidateIds.includes(c.candidate_id))
      : filteredCandidates;

    if (listToDownload.length === 0) {
      alert('No candidates available to download PDFs.');
      return;
    }

    setBulkPdfProgress(true);
    setToastMessage('Fetching candidate data for bulk PDF export...');

    const fullCandidatesList = [];
    for (const cand of listToDownload) {
      let fullCand = cand;
      if (!cand.photo_base64 && !cand.face_photo_base64) {
        try {
          const compParam = cand.company_name ? `?company=${encodeURIComponent(cand.company_name)}` : '';
          const res = await fetch(`/api/candidate/${cand.candidate_id}${compParam}`, { headers: authHeaders() });
          const data = await res.json();
          if (data.success && data.candidate) {
            fullCand = data.candidate;
          }
        } catch (e) {
          console.error(`Error fetching candidate ${cand.candidate_id}:`, e);
        }
      }
      fullCandidatesList.push(fullCand);
    }

    await downloadBulkPdfsZip(
      fullCandidatesList,
      activeCompany,
      (current, total, name) => {
        setToastMessage(`Zipping candidate PDF ${current} of ${total}: ${name}...`);
      },
      districtFilter,
      token
    );

    setBulkPdfProgress(false);
    setToastMessage(`Bulk ZIP Download Complete! All candidate report PDFs saved in one ZIP archive.`);
    setTimeout(() => setToastMessage(''), 5000);
  };

  // Excel Export Handler
  const handleExportExcel = (filterStatus = statusFilter) => {
    exportCandidatesToExcel(candidates, filterStatus);
  };

  // Select / Deselect All Checkboxes
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedCandidateIds(filteredCandidates.map((c) => c.candidate_id));
    } else {
      setSelectedCandidateIds([]);
    }
  };

  const handleToggleSelect = (candId) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candId) ? prev.filter((id) => id !== candId) : [...prev, candId]
    );
  };

  // Unique Districts list for District Filter Dropdown
  const uniqueDistricts = Array.from(
    new Set(candidates.map((c) => c.reg_district || c.district).filter((d) => d && d.trim() !== '' && d.trim() !== '-'))
  ).sort();

  // Filter candidates by search query, status filter & district filter
  const filteredCandidates = candidates.filter((c) => {
    const q = searchTerm.trim().toLowerCase();
    const isVerified = c.verification_status === 'VERIFIED';
    const isFailed = c.face_match_status === 'MISMATCH' || c.face_match_status === 'FAILED';
    const isPending = !isVerified && !isFailed;

    if (statusFilter === 'COMPLETED' && !isVerified) return false;
    if (statusFilter === 'PENDING' && !isPending) return false;
    if (statusFilter === 'FAILED' && !isFailed) return false;

    if (districtFilter !== 'ALL') {
      const candDist = (c.reg_district || c.district || '').trim().toLowerCase();
      if (candDist !== districtFilter.trim().toLowerCase()) return false;
    }

    if (!q) return true;
    return (
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.aadhaar_number || '').includes(q) ||
      (c.candidate_id || '').toLowerCase().includes(q) ||
      (c.company_name || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <Users className="w-6 h-6 text-indigo-600" />
            <span>Uploaded Candidates Directory</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            All registered candidates saved with Name, Mobile, Aadhaar, and e-KYC Reports
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* EXCEL EXPORT BUTTON */}
          <div className="relative inline-block text-left">
            <button
              onClick={() => handleExportExcel(statusFilter)}
              className="px-3.5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-emerald-200 transition-all cursor-pointer"
              title="Export candidate records to Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export Excel ({statusFilter})</span>
            </button>
          </div>

          {/* BULK PDF DOWNLOAD BUTTON */}
          <button
            onClick={handleBulkPdfDownload}
            disabled={filteredCandidates.length === 0 || bulkPdfProgress}
            className="px-3.5 py-2.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-purple-200 transition-all cursor-pointer disabled:opacity-50"
            title="Download individual PDFs saved with Candidate Full Names"
          >
            {bulkPdfProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{bulkPdfProgress ? 'Generating PDFs...' : `Download ${selectedCandidateIds.length ? selectedCandidateIds.length : 'All'} PDFs`}</span>
          </button>

          {/* SEND EMAIL TO ALL BUTTON */}
          <button
            onClick={handleSendAllEmail}
            disabled={candidates.length === 0 || batchSending}
            className="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
          >
            {batchSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            <span>{batchSending ? 'Sending...' : 'Send All Emails'}</span>
          </button>

          <button
            onClick={fetchCandidates}
            className="p-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs"
            title="Refresh Candidate List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* TOAST MESSAGE BANNER */}
      {toastMessage && (
        <div className="p-4 rounded-2xl bg-indigo-600 text-white flex items-center space-x-2.5 text-xs font-bold shadow-md animate-fade-in">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* METRICS & SUMMARY */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-600">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase">Total Saved Candidates</p>
            <p className="text-lg font-extrabold text-slate-900">{candidates.length}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-600">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase">Aadhaar Verified</p>
            <p className="text-lg font-extrabold text-emerald-700">
              {candidates.filter((c) => c.verification_status === 'VERIFIED').length}
            </p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex items-center space-x-3">
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-600">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase">Pending e-KYC Links</p>
            <p className="text-lg font-extrabold text-amber-700">
              {candidates.filter((c) => c.verification_status !== 'VERIFIED').length}
            </p>
          </div>
        </div>
      </div>

      {/* SEARCH INPUT & STATUS FILTER BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search candidate by Name, Mobile, Email, Aadhaar Number..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
          {/* DISTRICT FILTER */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <MapPin className="w-4 h-4 text-slate-500 shrink-0" />
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Districts ({uniqueDistricts.length})</option>
              {uniqueDistricts.map((dist) => (
                <option key={dist} value={dist}>
                  {dist}
                </option>
              ))}
            </select>
          </div>

          {/* STATUS FILTER */}
          <div className="flex items-center space-x-1.5 shrink-0">
            <Filter className="w-4 h-4 text-slate-500 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Statuses ({candidates.length})</option>
              <option value="COMPLETED">Completed (Verified)</option>
              <option value="PENDING">Pending Verification</option>
              <option value="FAILED">Failed / Mismatched</option>
            </select>
          </div>
        </div>
      </div>

      {/* CANDIDATES TABLE WITH EMAIL & PDF ACTION BUTTONS */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-xs font-bold uppercase text-slate-800 flex items-center space-x-2">
            <Users className="w-4 h-4 text-indigo-600" />
            <span>Uploaded Candidates List ({filteredCandidates.length})</span>
          </h3>

          {selectedCandidateIds.length > 0 && (
            <span className="text-xs font-extrabold text-purple-700 bg-purple-50 border border-purple-200 px-3 py-1 rounded-full">
              {selectedCandidateIds.length} Candidates Selected
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-[11px] text-slate-500 uppercase tracking-wider">
              <tr>
                <th className="px-3 py-3.5 text-center">
                  <input
                    type="checkbox"
                    onChange={handleSelectAll}
                    checked={filteredCandidates.length > 0 && selectedCandidateIds.length === filteredCandidates.length}
                    className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3.5">Candidate ID</th>
                <th className="px-4 py-3.5">Full Name</th>
                <th className="px-4 py-3.5">Mobile Number</th>
                <th className="px-4 py-3.5">Email Address</th>
                <th className="px-4 py-3.5">Aadhaar Number</th>
                <th className="px-4 py-3.5">Company Name</th>
                <th className="px-4 py-3.5">Registered District</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5 text-center">Actions & Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium">
              {loading ? (
                <tr>
                  <td colSpan="10" className="px-4 py-8 text-center text-slate-500">
                    Loading uploaded candidates...
                  </td>
                </tr>
              ) : filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan="10" className="px-4 py-8 text-center text-slate-500">
                    No candidate records found matching filter "{statusFilter}".
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((cand) => {
                  const isVerified = cand.verification_status === 'VERIFIED';
                  const isFailed = cand.face_match_status === 'MISMATCH' || cand.face_match_status === 'FAILED';
                  const isSending = sendingIdMap[cand.candidate_id];
                  const isSent = sentSuccessMap[cand.candidate_id];
                  const isDownloadingPdf = downloadingPdfId === cand.candidate_id;
                  const isSelected = selectedCandidateIds.includes(cand.candidate_id);

                  return (
                    <tr key={cand.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                      <td className="px-3 py-3.5 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(cand.candidate_id)}
                          className="rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3.5 font-mono font-bold text-indigo-600">
                        {cand.candidate_id}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-slate-900">
                        {cand.full_name}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-900 font-semibold">
                        {cand.phone}
                      </td>
                      <td className="px-4 py-3.5 text-indigo-600 font-medium">
                        {cand.email || '-'}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-slate-800 font-medium">
                        {cand.aadhaar_number}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-slate-900">
                        {cand.reg_project_name || cand.project_name || cand.company_name}
                      </td>
                      <td className="px-4 py-3.5 text-slate-800 font-semibold">
                        {cand.reg_district || cand.district || '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        {isVerified ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Verified ✓
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            Failed ✕
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Pending e-KYC
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center space-x-1.5">
                          {/* SINGLE PDF DOWNLOAD BUTTON */}
                          <button
                            onMouseEnter={() => fetchAndCacheCandidate(cand, token)}
                            onClick={() => handleDownloadSinglePdf(cand)}
                            disabled={isDownloadingPdf}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                            title={`Download PDF report for ${cand.full_name}`}
                          >
                            {isDownloadingPdf ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-purple-600" />
                            )}
                            <span>{isDownloadingPdf ? 'PDF...' : 'PDF Report'}</span>
                          </button>

                          {/* SEND EMAIL LINK BUTTON */}
                          <button
                            onClick={() => handleSendEmailSingle(cand)}
                            disabled={isSending}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-xl font-bold text-[11px] shadow-xs transition-all cursor-pointer disabled:opacity-50 ${
                              isSent
                                ? 'bg-indigo-100 text-indigo-800 border border-indigo-300 hover:bg-indigo-200'
                                : 'bg-indigo-600 hover:bg-indigo-700 text-white'
                            }`}
                            title={`Send automated e-KYC link to ${cand.email || 'candidate'}`}
                          >
                            {isSending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : isSent ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                            ) : (
                              <Mail className="w-3.5 h-3.5" />
                            )}
                            <span>{isSending ? '...' : isSent ? 'Sent ✓' : 'Email'}</span>
                          </button>

                          {/* COPY LINK BUTTON */}
                          <button
                            onClick={() => copyVerificationLink(cand)}
                            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                            title="Copy Verification Link"
                          >
                            {copiedId === cand.candidate_id ? (
                              <Check className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>

                          {/* DELETE CANDIDATE BUTTON */}
                          <button
                            onClick={() => handleDeleteCandidate(cand)}
                            className="p-1.5 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors cursor-pointer"
                            title={`Delete candidate ${cand.full_name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-600" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default UploadedCandidatesTab;
