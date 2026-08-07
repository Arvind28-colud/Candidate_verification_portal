import React, { useState, useEffect } from 'react';
import {
  Users,
  Clock,
  CheckCircle2,
  RefreshCw,
  Plus,
  Search,
  ShieldAlert,
  FileText,
  Building2,
  Trash2,
  FileSpreadsheet,
  Download,
  Loader2,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { exportCandidatesToExcel } from '../utils/excelExporter';
import { downloadCandidatePdf, downloadBulkPdfsZip } from '../utils/pdfGenerator';
import { fetchAndCacheCandidate, preloadAllCandidatePhotos } from '../utils/candidateCache';
import PdfDownloadOptionModal from './PdfDownloadOptionModal';

const DashboardTab = ({ token, activeCompany: parentActiveCompany, initialStatusFilter = 'ALL', onNavigateToReg, onOpenVerifyModal, onOpenCompareModal }) => {
  const [user] = useState(() => {
    const raw = sessionStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  });
  const isAdmin = user?.role === 'admin';

  const [candidates, setCandidates] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0, failed: 0 });
  const [companyList, setCompanyList] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(parentActiveCompany || 'ALL');
  const [districtFilter, setDistrictFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);

  const [downloadingPdfId, setDownloadingPdfId] = useState(null);
  const [bulkPdfProgress, setBulkPdfProgress] = useState(false);
  const [runningFaceVerify, setRunningFaceVerify] = useState(false);

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
        alert(`Batch AI Face Verification Complete:\n\n• Processed: ${s.processed || 0}\n• Matches: ${s.matches || 0}\n• Mismatches: ${s.mismatches || 0}\n• Failed/No Photo: ${s.failed || 0}`);
        fetchData();
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

  useEffect(() => {
    setStatusFilter(initialStatusFilter);
  }, [initialStatusFilter]);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const handleDeleteCandidate = async (cand) => {
    if (!window.confirm(`Are you sure you want to delete candidate "${cand.full_name}" (${cand.candidate_id})?\n\nThis will completely remove their record from the database so they can re-register.`)) {
      return;
    }

    try {
      let res = await fetch(`/api/candidate/${cand.candidate_id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });

      if (res.status === 405) {
        res = await fetch(`/api/candidate/delete/${cand.candidate_id}`, {
          method: 'POST',
          headers: authHeaders(),
        });
      }

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to delete candidate.');
      }
      alert(`Candidate ${cand.full_name} (${cand.candidate_id}) has been deleted. They can now re-register.`);
      fetchData();
    } catch (err) {
      alert(`Delete Error: ${err.message}`);
    }
  };

  // Fetch company directory list for Admin filter
  useEffect(() => {
    if (isAdmin) {
      fetch('/api/admin/companies', { headers: authHeaders() })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setCompanyList(data.companies || []);
        })
        .catch((err) => console.error('Error fetching admin company list:', err));
    }
  }, [isAdmin]);

  const fetchData = async () => {
    setLoading(true);
    try {
      let candUrl = '/api/candidates';
      if (selectedCompany && selectedCompany !== 'ALL') {
        candUrl += `?company=${encodeURIComponent(selectedCompany)}`;
      }

      const candRes = await fetch(candUrl, { headers: authHeaders() });
      const candData = await candRes.json();

      if (candData.success) {
        const cList = candData.candidates || [];
        setCandidates(cList);
        preloadAllCandidatePhotos(token, selectedCompany);

        const total = cList.length;
        const completed = cList.filter((c) => c.verification_status === 'VERIFIED').length;
        const failed = cList.filter((c) => c.verification_status === 'FAILED' || c.verification_status === 'REJECTED').length;
        const pending = total - completed - failed;

        setStats({ total, completed, pending, failed });
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedCompany]);

  // Extract unique Districts from candidates
  const uniqueDistricts = Array.from(
    new Set(candidates.map((c) => c.reg_district || c.district).filter((d) => d && d.trim() !== '' && d.trim() !== '-'))
  ).sort();

  // Filter & sort candidates in DESCENDING ORDER (Newest registrations first)
  const filteredCandidates = candidates
    .filter((c) => {
      const matchesSearch =
        c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.candidate_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone?.includes(searchTerm) ||
        c.aadhaar_number?.includes(searchTerm);

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'FAILED' && (c.verification_status === 'FAILED' || c.verification_status === 'REJECTED')) ||
        c.verification_status === statusFilter;

      const matchesDistrict =
        districtFilter === 'ALL' ||
        (c.reg_district || c.district || '').trim().toLowerCase() === districtFilter.trim().toLowerCase();

      return matchesSearch && matchesStatus && matchesDistrict;
    })
    .sort((a, b) => {
      if (a.id && b.id) return b.id - a.id;
      return (b.candidate_id || '').localeCompare(a.candidate_id || '', undefined, { numeric: true, sensitivity: 'base' });
    });

  // Single Candidate PDF Download helper
  const handleDownloadSinglePdf = (cand) => {
    setPdfOptionModal({ isOpen: true, type: 'single', candidate: cand });
  };

  // Bulk PDF Download packaged into a single ZIP file
  const handleBulkPdfDownload = () => {
    if (filteredCandidates.length === 0) {
      alert('No candidates available to download PDFs.');
      return;
    }
    setPdfOptionModal({ isOpen: true, type: 'bulk', candidate: null });
  };

  const handleConfirmDownloadOption = async ({ includePage2 }) => {
    if (pdfOptionModal.type === 'single' && pdfOptionModal.candidate) {
      const cand = pdfOptionModal.candidate;
      setDownloadingPdfId(cand.candidate_id);
      try {
        await downloadCandidatePdf(cand, selectedCompany, token, includePage2);
      } catch (err) {
        alert(`PDF Download Error: ${err.message}`);
      } finally {
        setDownloadingPdfId(null);
      }
    } else if (pdfOptionModal.type === 'bulk') {
      setBulkPdfProgress(true);
      try {
        await downloadBulkPdfsZip(filteredCandidates, selectedCompany, () => {}, districtFilter, token, includePage2);
      } catch (err) {
        alert(`ZIP Download Error: ${err.message}`);
      } finally {
        setBulkPdfProgress(false);
      }
    }
  };

  // Excel Export helper
  const handleExportExcel = () => {
    exportCandidatesToExcel(filteredCandidates, statusFilter);
  };

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Candidate Verification Directory
            </h2>
            {!isAdmin && user?.company_name && (
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-3 py-1 rounded-full flex items-center space-x-1.5 shadow-2xs">
                <Building2 className="w-3.5 h-3.5 text-indigo-600" />
                <span>{user.company_name}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Real-time candidate e-KYC verification status tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => fetchData()}
            className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-2 transition-all cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={onNavigateToReg}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold uppercase tracking-wider flex items-center space-x-2 shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Register Candidate</span>
          </button>
        </div>
      </div>

      {/* 4 SUMMARY METRIC BOXES */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* BOX 1: TOTAL CANDIDATES */}
        <div
          onClick={() => setStatusFilter('ALL')}
          className={`p-5 rounded-3xl bg-white border cursor-pointer transition-all ${
            statusFilter === 'ALL'
              ? 'border-slate-900 ring-2 ring-slate-900/10 shadow-md'
              : 'border-slate-300 shadow-xs hover:border-slate-400 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-slate-600 uppercase tracking-widest">
              Total Candidates
            </span>
            <div className="w-9 h-9 rounded-2xl bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-800 shadow-xs">
              <Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <h3 className="text-3xl font-extrabold text-slate-950 tracking-tight">{stats.total}</h3>
            <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-300">
              All Records
            </span>
          </div>
        </div>

        {/* BOX 2: COMPLETED / VERIFIED */}
        <div
          onClick={() => setStatusFilter('VERIFIED')}
          className={`p-5 rounded-3xl bg-white border cursor-pointer transition-all ${
            statusFilter === 'VERIFIED'
              ? 'border-emerald-600 ring-2 ring-emerald-600/15 shadow-md'
              : 'border-slate-300 shadow-xs hover:border-slate-400 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-widest">
              Aadhaar Verified
            </span>
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-emerald-700 shadow-xs">
              <CheckCircle2 className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <h3 className="text-3xl font-extrabold text-emerald-800 tracking-tight">{stats.completed}</h3>
            <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300">
              e-KYC Verified
            </span>
          </div>
        </div>

        {/* BOX 3: PENDING VERIFICATION */}
        <div
          onClick={() => setStatusFilter('PENDING')}
          className={`p-5 rounded-3xl bg-white border cursor-pointer transition-all ${
            statusFilter === 'PENDING'
              ? 'border-amber-600 ring-2 ring-amber-600/15 shadow-md'
              : 'border-slate-300 shadow-xs hover:border-slate-400 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-amber-900 uppercase tracking-widest">
              Pending e-KYC
            </span>
            <div className="w-9 h-9 rounded-2xl bg-amber-50 border border-amber-300 flex items-center justify-center text-amber-700 shadow-xs">
              <Clock className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <h3 className="text-3xl font-extrabold text-amber-900 tracking-tight">{stats.pending}</h3>
            <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-300">
              Awaiting e-KYC
            </span>
          </div>
        </div>

        {/* BOX 4: FAILED VERIFICATION */}
        <div
          onClick={() => setStatusFilter('FAILED')}
          className={`p-5 rounded-3xl bg-white border cursor-pointer transition-all ${
            statusFilter === 'FAILED'
              ? 'border-rose-600 ring-2 ring-rose-600/15 shadow-md'
              : 'border-slate-300 shadow-xs hover:border-slate-400 hover:shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-extrabold text-rose-800 uppercase tracking-widest">
              Failed Verification
            </span>
            <div className="w-9 h-9 rounded-2xl bg-rose-50 border border-rose-300 flex items-center justify-center text-rose-700 shadow-xs">
              <ShieldAlert className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <h3 className="text-3xl font-extrabold text-rose-800 tracking-tight">{stats.failed || 0}</h3>
            <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-300">
              Failed / Rejected
            </span>
          </div>
        </div>
      </div>

      {/* Directory Controls (Search, Status Filter, Excel & PDF Export) */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search candidate name, ID, phone..."
            className="w-full bg-slate-50 border border-slate-300 rounded-xl pl-10 pr-4 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 font-medium"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto justify-end">
          {/* ADMIN ONLY: SELECT COMPANY FILTER */}
          {isAdmin && (
            <div className="flex items-center space-x-2">
              <Building2 className="w-4 h-4 text-slate-700" />
              <span className="text-xs font-semibold text-slate-500 uppercase shrink-0">Company:</span>
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 cursor-pointer"
              >
                <option value="ALL">All Organizations (Global View)</option>
                {companyList.map((comp) => (
                  <option key={comp.id || comp.company_name} value={comp.company_name}>
                    {comp.company_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* DISTRICT FILTER */}
          <div className="flex items-center space-x-2">
            <MapPin className="w-4 h-4 text-slate-700 shrink-0" />
            <span className="text-xs font-semibold text-slate-500 uppercase shrink-0">District:</span>
            <select
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 cursor-pointer"
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
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-500 uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 cursor-pointer"
            >
              <option value="ALL">All Records</option>
              <option value="VERIFIED">Aadhaar Verified</option>
              <option value="PENDING">Aadhaar Pending</option>
              <option value="FAILED">Failed Verification</option>
            </select>
          </div>

          {/* EXCEL EXPORT BUTTON */}
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer"
            title="Export filtered candidates to Excel (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Excel</span>
          </button>

          {/* BULK PDF DOWNLOAD BUTTON */}
          <button
            onClick={handleBulkPdfDownload}
            disabled={filteredCandidates.length === 0 || bulkPdfProgress}
            className="px-3 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold flex items-center space-x-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
            title="Download individual PDF reports saved with Candidate Full Names"
          >
            {bulkPdfProgress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            <span>{bulkPdfProgress ? 'Downloading...' : 'Download PDFs'}</span>
          </button>
        </div>
      </div>

      {/* Candidates Data Directory Table with Scrollbar Box */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 border-b border-slate-200 font-semibold text-[11px] text-slate-500 uppercase tracking-wider sticky top-0 z-10 shadow-xs">
              <tr>
                <th className="px-4 py-3.5">Candidate ID</th>
                <th className="px-4 py-3.5">Organization / Company</th>
                <th className="px-4 py-3.5">Registered Name</th>
                <th className="px-4 py-3.5">Mobile</th>
                <th className="px-4 py-3.5">Registered District</th>
                <th className="px-4 py-3.5">Aadhaar Status</th>
                <th className="px-4 py-3.5 text-center">Actions & Reports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                    Loading candidates directory...
                  </td>
                </tr>
              ) : filteredCandidates.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                    No candidates found. Click [+ Register Candidate] above to add records.
                  </td>
                </tr>
              ) : (
                filteredCandidates.map((cand) => {
                  const isVerified = cand.verification_status === 'VERIFIED';
                  const isFailed = cand.verification_status === 'FAILED';
                  const isDownloadingPdf = downloadingPdfId === cand.candidate_id;

                  return (
                    <tr key={cand.candidate_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5 font-bold text-indigo-600">
                        {cand.candidate_id}
                      </td>
                      <td className="px-4 py-3.5 font-bold text-slate-900 text-[11px]">
                        {cand.reg_project_name || cand.project_name || cand.company_name || 'Keen Sighted Workforce Services'}
                      </td>
                      <td className="px-4 py-3.5 font-semibold text-slate-900">{cand.full_name}</td>
                      <td className="px-4 py-3.5 text-slate-600">{cand.phone}</td>
                      <td className="px-4 py-3.5 font-semibold text-slate-800">
                        {cand.reg_district || cand.district || '-'}
                      </td>
                      <td className="px-4 py-3.5">
                        {isVerified ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Aadhaar Verified ✓
                          </span>
                        ) : isFailed ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                            e-KYC Failed ✕
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            Aadhaar Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* SINGLE PDF DOWNLOAD BUTTON */}
                          <button
                            onClick={() => handleDownloadSinglePdf(cand)}
                            disabled={isDownloadingPdf}
                            className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50"
                            title={`Download PDF report for ${cand.full_name}`}
                          >
                            {isDownloadingPdf ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                            ) : (
                              <Download className="w-3.5 h-3.5 text-purple-600" />
                            )}
                            <span>Download PDF</span>
                          </button>

                          {isVerified ? (
                            <button
                              onMouseEnter={() => fetchAndCacheCandidate(cand, token)}
                              onClick={() => onOpenCompareModal(cand)}
                              className="inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold transition-all cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5 text-indigo-600" />
                              <span>View Report</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => onOpenVerifyModal(cand)}
                              className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 text-amber-800 text-[11px] font-semibold transition-all cursor-pointer"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Verify Aadhaar</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleDeleteCandidate(cand)}
                            className="inline-flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-[11px] font-semibold transition-all cursor-pointer"
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

      {/* PDF DOWNLOAD OPTIONS POPUP MODAL */}
      <PdfDownloadOptionModal
        isOpen={pdfOptionModal.isOpen}
        title={pdfOptionModal.type === 'bulk' ? 'Bulk PDF Zip Download Options' : 'PDF Report Download Options'}
        subtitle={pdfOptionModal.type === 'bulk' ? 'Select report page options for downloading all candidate PDFs as a ZIP package' : 'Select report page options before downloading PDF'}
        onConfirm={handleConfirmDownloadOption}
        onClose={() => setPdfOptionModal({ isOpen: false, type: 'single', candidate: null })}
      />
    </div>
  );
};

export default DashboardTab;
