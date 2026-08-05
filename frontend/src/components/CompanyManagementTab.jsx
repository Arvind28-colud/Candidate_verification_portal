import React, { useState, useEffect } from 'react';
import { Building2, Plus, RefreshCw, Trash2, CheckCircle2, AlertCircle, Link2, Copy, Check, Power, ShieldCheck, ExternalLink, Loader2 } from 'lucide-react';

const CompanyManagementTab = ({ token }) => {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const fetchCompanies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/companies', { headers: authHeaders() });
      const data = await res.json();
      if (data.success) {
        setCompanies(data.companies || []);
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, []);

  const [hideCompanyName, setHideCompanyName] = useState(false);

  // Handle Simple Company Creation (Single Input: Company Name + Create Button)
  const handleCreateCompany = async (e) => {
    e.preventDefault();
    if (!companyName.trim()) return;

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const res = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          company_name: companyName.trim(),
          hide_company_name: hideCompanyName,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Failed to create company.');
      }

      setSuccessMessage(`Company '${companyName.trim()}' created successfully! Candidate self-registration link generated.`);
      setCompanyName('');
      setHideCompanyName(false);
      fetchCompanies();

      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle Hide Company Name setting
  const handleToggleHideName = async (company) => {
    const targetStatus = !company.hide_company_name;
    try {
      const res = await fetch(`/api/admin/companies/${company.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ hide_company_name: targetStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setCompanies((prev) =>
          prev.map((c) => (c.id === company.id ? { ...c, hide_company_name: targetStatus } : c))
        );
      } else {
        alert(data.detail || 'Failed to update company setting.');
      }
    } catch (err) {
      alert(`Error updating company setting: ${err.message}`);
    }
  };

  // Toggle Registration Link Status (Enable Link / Disable Link)
  const handleToggleLinkStatus = async (company) => {
    setTogglingId(company.id);
    const targetStatus = !company.link_enabled;
    try {
      const res = await fetch('/api/admin/companies/toggle-link', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          company_name: company.company_name,
          enabled: targetStatus,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Failed to update link status.');
      }

      // Optimistic update local state
      setCompanies((prev) =>
        prev.map((c) => (c.id === company.id ? { ...c, link_enabled: targetStatus } : c))
      );
    } catch (err) {
      alert(`Error toggling link status: ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  // Delete Company
  const handleDeleteCompany = async (comp) => {
    if (!window.confirm(`Are you sure you want to delete '${comp.company_name}'?`)) return;

    try {
      const res = await fetch(`/api/admin/companies/${comp.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setCompanies((prev) => prev.filter((c) => c.id !== comp.id));
      } else {
        alert(data.detail || 'Failed to delete company.');
      }
    } catch (err) {
      alert(`Error deleting company: ${err.message}`);
    }
  };

  // Copy Company Candidate Registration Link
  // Uses UUID token in URL when hide_company_name is ON, plain name otherwise
  const copyCompanyLink = (comp) => {
    const compParam = comp.hide_company_name && comp.company_token
      ? comp.company_token
      : encodeURIComponent(comp.company_name);
    const link = `${window.location.origin}/?company=${compParam}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link).catch(() => fallbackCopyText(link));
    } else {
      fallbackCopyText(link);
    }
    setCopiedId(comp.company_name);
    setTimeout(() => setCopiedId(null), 2500);
  };

  // Copy Dedicated Project Registration Link (form_type=project, displays 'Candidate Verification', omits State/District, requires Project Name)
  const copyStandaloneProjectLink = () => {
    const link = `${window.location.origin}/?form_type=project`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(link).catch(() => fallbackCopyText(link));
    } else {
      fallbackCopyText(link);
    }
    setCopiedId('standalone_project_link');
    setTimeout(() => setCopiedId(null), 2500);
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-950 tracking-tight flex items-center space-x-2.5">
            <Building2 className="w-7 h-7 text-slate-900" />
            <span>Company Management & Registration Links</span>
          </h2>
          <p className="text-xs text-slate-600 font-semibold mt-0.5">
            Create companies, generate candidate registration links, and enable or disable link access
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={copyStandaloneProjectLink}
            className={`px-4 py-2.5 rounded-xl border font-extrabold text-xs flex items-center space-x-2 transition cursor-pointer shadow-sm ${
              copiedId === 'standalone_project_link'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-violet-600 hover:bg-violet-700 text-white border-violet-700'
            }`}
            title="Copy Dedicated Project Registration Link (displays strictly 'Candidate Verification', omits State/District, requires Project Name)"
          >
            {copiedId === 'standalone_project_link' ? (
              <><Check className="w-4 h-4" /><span>Copied Project Link!</span></>
            ) : (
              <><Copy className="w-4 h-4" /><span>Project Link</span></>
            )}
          </button>

          <button
            onClick={fetchCompanies}
            className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 text-xs font-bold flex items-center space-x-2 transition cursor-pointer shadow-xs"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh List</span>
          </button>
        </div>
      </div>

      {/* SUCCESS / ERROR NOTIFICATIONS */}
      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center space-x-3 text-emerald-900 text-xs font-extrabold shadow-sm">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-300 flex items-center space-x-3 text-rose-900 text-xs font-extrabold shadow-sm">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      )}

      {/* SINGLE INPUT COMPANY CREATION CARD */}
      <div className="bg-white p-6 rounded-3xl border border-slate-300 shadow-md shadow-slate-900/5 space-y-4">
        <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-950 flex items-center space-x-2">
          <Plus className="w-4 h-4 text-slate-800" />
          <span>Create New Company</span>
        </h3>

        <form onSubmit={handleCreateCompany} className="space-y-3">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Building2 className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Enter Company Name..."
                required
                className="w-full bg-slate-50 border border-slate-300 rounded-2xl pl-10 pr-4 py-3 text-xs text-slate-950 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 font-bold shadow-xs"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !companyName.trim()}
              className="px-6 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-extrabold text-xs uppercase tracking-wider shadow-md transition flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer shrink-0"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>{submitting ? 'Creating...' : 'Create Company'}</span>
            </button>
          </div>

          <label className="flex items-center space-x-2 text-xs font-extrabold text-slate-800 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={hideCompanyName}
              onChange={(e) => setHideCompanyName(e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500 cursor-pointer"
            />
            <span>🔒 Hide Company Name on Registration Form & Reports for this company</span>
          </label>
        </form>
      </div>

      {/* CREATED COMPANIES DIRECTORY TABLE */}
      <div className="bg-white rounded-3xl border border-slate-300 shadow-lg shadow-slate-900/5 overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <h3 className="text-sm font-extrabold uppercase text-slate-950 flex items-center space-x-2">
            <Building2 className="w-4.5 h-4.5 text-slate-800" />
            <span>Created Companies ({companies.length})</span>
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-900">
            <thead className="bg-slate-100 border-b border-slate-200 font-bold text-[11px] text-slate-950 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3.5">Company Name</th>
                <th className="px-4 py-3.5">Name Visibility</th>
                <th className="px-4 py-3.5">Generated Registration Link</th>
                <th className="px-4 py-3.5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-semibold">
              {loading ? (
                <tr>
                  <td colSpan="4" className="px-4 py-8 text-center text-slate-600 font-bold">
                    Loading created companies...
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-4 py-8 text-center text-slate-600 font-bold">
                    No companies created yet. Enter a company name above and click "Create Company".
                  </td>
                </tr>
              ) : (
                companies.map((comp) => {
                  // Use UUID token in URL when company name is hidden, plain name otherwise
                  const compParam = comp.hide_company_name && comp.company_token
                    ? comp.company_token
                    : encodeURIComponent(comp.company_name);
                  const regLink = `${window.location.origin}/?company=${compParam}`;
                  const isCopied = copiedId === comp.company_name;

                  return (
                    <tr key={comp.id} className="hover:bg-slate-50 transition-colors">
                      {/* Company Name */}
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-3">
                          <div className="w-9 h-9 rounded-xl border border-slate-300 bg-slate-100 flex items-center justify-center shrink-0">
                            <Building2 className="w-4.5 h-4.5 text-slate-700" />
                          </div>
                          <span className="font-extrabold text-slate-950 text-sm block">
                            {comp.company_name}
                          </span>
                        </div>
                      </td>

                      {/* Name Visibility Toggle Badge */}
                      <td className="px-4 py-4">
                        <button
                          onClick={() => handleToggleHideName(comp)}
                          className={`px-3 py-1.5 rounded-xl border font-bold text-[11px] flex items-center space-x-1.5 cursor-pointer transition ${
                            comp.hide_company_name
                              ? 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                              : 'bg-emerald-50 text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                          }`}
                          title="Click to toggle company name visibility"
                        >
                          <span>{comp.hide_company_name ? '🔒 Hidden on Form' : '👁️ Visible on Form'}</span>
                        </button>
                      </td>

                      {/* Generated Registration Link */}
                      <td className="px-4 py-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-[11px] bg-slate-100 border border-slate-300 px-3 py-1.5 rounded-xl text-slate-900 truncate max-w-xs font-bold">
                            {regLink}
                          </span>
                          <button
                            onClick={() => copyCompanyLink(comp)}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-800 cursor-pointer transition shadow-xs"
                            title="Copy Registration Link"
                          >
                            {isCopied ? (
                              <Check className="w-4 h-4 text-emerald-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <a
                            href={regLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 cursor-pointer transition shadow-xs flex items-center justify-center"
                            title="Test & Open Public Candidate Registration Link"
                          >
                            <ExternalLink className="w-4 h-4 text-indigo-600" />
                          </a>
                        </div>
                      </td>

                      {/* Action Column: Delete */}
                      <td className="px-4 py-4 text-center">
                        <button
                          onClick={() => handleDeleteCompany(comp)}
                          className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 cursor-pointer transition shadow-xs inline-flex items-center space-x-1 font-bold text-xs"
                          title="Delete Company Profile"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span>Delete</span>
                        </button>
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

export default CompanyManagementTab;
