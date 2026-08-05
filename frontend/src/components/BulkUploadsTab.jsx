import React, { useState } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, FileText, Send, Link2, Mail, Save, Copy, Check, Loader2 } from 'lucide-react';

const BulkUploadsTab = ({ token, activeCompany, onUploadSuccess }) => {
  const [file, setFile] = useState(null);
  const [parsedCandidates, setParsedCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [sendingRowMap, setSendingRowMap] = useState({});
  const [sentRowMap, setSentRowMap] = useState({});
  const [sendingSmsMap, setSendingSmsMap] = useState({});
  const [sentSmsMap, setSentSmsMap] = useState({});
  const [sendingAllSms, setSendingAllSms] = useState(false);

  // Helper to copy verification link to clipboard
  const copyLink = (phone, name, candidateId, idx) => {
    const comp = activeCompany && activeCompany !== 'ALL' ? activeCompany : 'Company';
    const link = `${window.location.origin}/?candidate_id=${candidateId || ''}&company=${encodeURIComponent(comp)}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link).catch(() => fallbackCopyText(link));
    } else {
      fallbackCopyText(link);
    }
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
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

  // Dispatch SMS Link directly for a single candidate (One-at-a-time)
  const handleSendSmsSingle = async (c, idx) => {
    const phone = c.phone || c.mobile;
    if (!phone) {
      alert('Missing mobile phone number for this candidate row.');
      return;
    }

    setSendingSmsMap((prev) => ({ ...prev, [idx]: true }));
    try {
      const res = await fetch('/api/candidates/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          candidate_id: c.candidate_id || '',
          company_name: c.company_name || (activeCompany !== 'ALL' ? activeCompany : ''),
          phone: phone,
          full_name: c.full_name || 'Candidate',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Failed to dispatch SMS link.');
      }

      setSentSmsMap((prev) => ({ ...prev, [idx]: true }));
    } catch (err) {
      alert(`SMS Error: ${err.message}`);
    } finally {
      setSendingSmsMap((prev) => ({ ...prev, [idx]: false }));
    }
  };

  // Dispatch SMS Link to ALL saved candidates in sequence
  const handleSendSmsAllSaved = async () => {
    if (!result?.dispatched_notifications || result.dispatched_notifications.length === 0) return;
    setSendingAllSms(true);
    let successCount = 0;

    for (let idx = 0; idx < result.dispatched_notifications.length; idx++) {
      const c = result.dispatched_notifications[idx];
      const phone = c.phone || c.mobile;
      if (!phone) continue;

      setSendingSmsMap((prev) => ({ ...prev, [idx]: true }));
      try {
        const res = await fetch('/api/candidates/send-sms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            candidate_id: c.candidate_id || '',
            company_name: c.company_name || (activeCompany !== 'ALL' ? activeCompany : ''),
            phone: phone,
            full_name: c.full_name || 'Candidate',
          }),
        });

        const data = await res.json();
        if (res.ok && data.success) {
          setSentSmsMap((prev) => ({ ...prev, [idx]: true }));
          successCount++;
        }
      } catch (err) {
        console.error(`SMS dispatch error for row ${idx}:`, err);
      } finally {
        setSendingSmsMap((prev) => ({ ...prev, [idx]: false }));
      }
    }
    setSendingAllSms(false);
    alert(`Successfully dispatched SMS registration links to ${successCount} candidates!`);
  };

  // Dispatch Email Link directly for a single candidate
  const handleSendEmailSingle = async (c, idx) => {
    if (!c.candidate_id) return;
    setSendingRowMap((prev) => ({ ...prev, [idx]: true }));

    try {
      const res = await fetch('/api/candidates/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          candidate_id: c.candidate_id,
          company_name: activeCompany !== 'ALL' ? activeCompany : '',
          email: c.email,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Failed to dispatch email link.');
      }

      setSentRowMap((prev) => ({ ...prev, [idx]: true }));
    } catch (err) {
      alert(`Email Error: ${err.message}`);
    } finally {
      setSendingRowMap((prev) => ({ ...prev, [idx]: false }));
    }
  };

  // Sample CSV template generator & download
  const handleDownloadSample = () => {
    const csvContent =
      'full_name,phone,company_name\n' +
      'Rajesh Kumar,9876543210,Keen Sighted\n' +
      'Priya Sharma,9876543211,Keen Sighted\n' +
      'Suresh Verma,9876543212,Keen Sighted\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'candidate_bulk_upload_template.csv';
    link.click();
  };

  // Helper to normalize extracted object keys
  const normalizeRowKeys = (row) => {
    const keys = Object.keys(row);
    const getVal = (possibleKeys) => {
      for (const pk of possibleKeys) {
        const foundKey = keys.find((k) => k.trim().toLowerCase() === pk.toLowerCase());
        if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null) {
          return String(row[foundKey]).trim();
        }
      }
      return '';
    };

    return {
      full_name: getVal(['full_name', 'fullname', 'full name', 'name', 'candidate_name', 'candidate name']),
      phone: getVal(['phone', 'phone_number', 'phone number', 'mobile', 'mobile_number', 'mobile number']),
      company_name: getVal(['company_name', 'company', 'company name', 'org', 'organization']),
      aadhaar_number: getVal(['aadhaar_number', 'aadhaar', 'aadhaar number', 'aadhaar_no', 'aadhaar no']),
      email: getVal(['email', 'email_address', 'email address']),
    };
  };

  // Handle File Selection (CSV & XLSX)
  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError('');
    setResult(null);

    const filename = selectedFile.name.toLowerCase();

    if (filename.endsWith('.csv')) {
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.data && results.data.length > 0) {
            const normalized = results.data.map(normalizeRowKeys);
            setParsedCandidates(normalized);
          } else {
            setError('The CSV file is empty or invalid.');
            setParsedCandidates([]);
          }
        },
        error: (err) => {
          setError(`CSV Parsing Error: ${err.message}`);
          setParsedCandidates([]);
        },
      });
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target.result;
          const wb = XLSX.read(bstr, { type: 'binary' });
          const wsname = wb.SheetNames[0];
          const ws = wb.Sheets[wsname];
          const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
          if (data && data.length > 0) {
            const normalized = data.map(normalizeRowKeys);
            setParsedCandidates(normalized);
          } else {
            setError('The Excel spreadsheet is empty.');
            setParsedCandidates([]);
          }
        } catch (err) {
          setError(`Excel Parsing Error: ${err.message}`);
          setParsedCandidates([]);
        }
      };
      reader.readAsBinaryString(selectedFile);
    } else {
      setError('Please upload a valid .csv, .xlsx, or .xls file.');
      setParsedCandidates([]);
    }
  };

  // Upload candidates to API (dispatchNotifications: true or false)
  const handleUploadSubmit = async (dispatchNotifications = false) => {
    if (!parsedCandidates || parsedCandidates.length === 0) {
      setError('No parsed candidates available to upload.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const payload = {
        dispatch_notifications: dispatchNotifications,
        candidates: parsedCandidates.map((c) => ({
          company_name: c.company_name || (activeCompany && activeCompany !== 'ALL' ? activeCompany : ''),
          full_name: c.full_name,
          phone: c.phone,
          aadhaar_number: c.aadhaar_number || '',
          email: c.email || '',
          dob: c.dob || '',
          gender: c.gender || '',
          address: c.address || '',
        })),
      };

      const response = await fetch('/api/candidates/bulk-upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || 'Bulk upload process failed.');
      }

      setResult(data);
      if (onUploadSuccess) {
        onUploadSuccess();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* TITLE & HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <FileSpreadsheet className="w-6 h-6 text-slate-800" />
            <span>Candidate CSV Upload</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Upload candidate CSV file with 3 columns: <code className="bg-slate-100 text-slate-900 px-1 py-0.5 rounded font-mono font-bold">full_name, phone, company_name</code>
          </p>
        </div>

        <button
          onClick={handleDownloadSample}
          className="px-3.5 py-2 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
        >
          <Download className="w-4 h-4 text-indigo-600" />
          <span>Download 4-Column Template</span>
        </button>
      </div>

      {/* UPLOAD CONTAINER */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="border-2 border-dashed border-indigo-200 hover:border-indigo-400 bg-slate-50/50 hover:bg-indigo-50/20 rounded-2xl p-8 text-center transition-all cursor-pointer relative">
          <input
            type="file"
            accept=".csv, .xlsx, .xls"
            onChange={handleFileChange}
            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
          />
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center mx-auto shadow-xs">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                {file ? file.name : 'Click to select CSV or Excel (.xlsx) file'}
              </p>
              <p className="text-xs text-slate-500 mt-1 font-medium">
                Supports Excel (.xlsx, .xls) and CSV format with 3 columns: <span className="font-bold text-slate-700">full_name, phone, company_name</span>
              </p>
            </div>
          </div>
        </div>

        {/* ERROR NOTICE */}
        {error && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 flex items-start space-x-2 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* PARSED PREVIEW & DUAL SUBMIT BUTTONS */}
        {parsedCandidates.length > 0 && (
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span className="text-xs font-bold text-slate-800">
                  Ready to process {parsedCandidates.length} candidate rows
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* 1. SAVE CANDIDATES ONLY */}
                <button
                  onClick={() => handleUploadSubmit(false)}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 text-emerald-400" />}
                  <span>1. Save Candidates</span>
                </button>

                {/* 2. SAVE & DISPATCH SMS LINKS */}
                <button
                  onClick={() => handleUploadSubmit(true)}
                  disabled={loading}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center space-x-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>2. Save & Dispatch SMS Links to All</span>
                </button>
              </div>
            </div>

            {/* PREVIEW TABLE (STRICTLY 3 COLUMNS) */}
            <div className="overflow-x-auto border border-slate-200 rounded-2xl max-h-60 overflow-y-auto">
              <table className="w-full text-left text-xs text-slate-700">
                <thead className="bg-slate-100 border-b border-slate-200 font-semibold text-[11px] text-slate-500 uppercase">
                  <tr>
                    <th className="px-3.5 py-2.5">#</th>
                    <th className="px-3.5 py-2.5">Full Name</th>
                    <th className="px-3.5 py-2.5">Mobile Phone</th>
                    <th className="px-3.5 py-2.5">Company Name</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {parsedCandidates.map((c, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3.5 py-2 font-mono text-slate-400">{i + 1}</td>
                      <td className="px-3.5 py-2 font-bold text-slate-800">{c.full_name || '-'}</td>
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900">{c.phone || '-'}</td>
                      <td className="px-3.5 py-2 font-semibold text-slate-800">{c.company_name || activeCompany || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* BULK UPLOAD DISPATCH RESULTS */}
        {result && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 space-y-4 animate-fade-in">
            <div className="flex items-center space-x-2 text-emerald-800 font-bold text-sm">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{result.message}</span>
            </div>

            {result.dispatched_notifications && result.dispatched_notifications.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase text-slate-800 tracking-wider flex items-center space-x-2">
                    <span>Saved Candidates Directory ({result.dispatched_notifications.length})</span>
                  </h4>

                  <button
                    onClick={handleSendSmsAllSaved}
                    disabled={sendingAllSms}
                    className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center space-x-1.5 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  >
                    {sendingAllSms ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>{sendingAllSms ? 'Dispatching SMS...' : '📱 Dispatch SMS to All Saved Candidates'}</span>
                  </button>
                </div>

                <div className="overflow-x-auto border border-emerald-200 rounded-2xl bg-white">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-emerald-100/50 border-b border-emerald-200 font-semibold text-[11px] text-emerald-900 uppercase">
                      <tr>
                        <th className="px-3.5 py-2.5">Candidate ID</th>
                        <th className="px-3.5 py-2.5">Full Name</th>
                        <th className="px-3.5 py-2.5">Mobile Phone</th>
                        <th className="px-3.5 py-2.5 text-center">SMS Dispatch Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {result.dispatched_notifications.map((n, idx) => {
                        const isSendingSms = sendingSmsMap[idx];
                        const isSmsSent = sentSmsMap[idx] || n.status === 'SENT';

                        return (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="px-3.5 py-2.5 font-mono font-bold text-slate-950">
                              {n.candidate_id}
                            </td>
                            <td className="px-3.5 py-2.5 font-bold text-slate-900">
                              {n.full_name}
                            </td>
                            <td className="px-3.5 py-2.5 font-mono text-slate-900 font-bold">
                              {n.phone}
                            </td>
                            <td className="px-3.5 py-2.5 text-center">
                              <div className="flex items-center justify-center space-x-2">
                                {/* SEND SMS BUTTON */}
                                <button
                                  onClick={() => handleSendSmsSingle(n, idx)}
                                  disabled={isSendingSms}
                                  className={`inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl font-bold text-[11px] shadow-xs cursor-pointer disabled:opacity-50 ${
                                    isSmsSent
                                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  }`}
                                  title="Send SMS registration link to candidate phone"
                                >
                                  {isSendingSms ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Send className="w-3.5 h-3.5" />
                                  )}
                                  <span>{isSendingSms ? 'Sending...' : isSmsSent ? 'SMS Sent ✓' : 'Send SMS'}</span>
                                </button>


                                {/* COPY LINK BUTTON */}
                                <button
                                  onClick={() => copyLink(n.phone, n.full_name, n.candidate_id, idx)}
                                  className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                                  title="Copy Registration Link"
                                >
                                  {copiedIndex === idx ? (
                                    <Check className="w-4 h-4 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-4 h-4" />
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default BulkUploadsTab;
