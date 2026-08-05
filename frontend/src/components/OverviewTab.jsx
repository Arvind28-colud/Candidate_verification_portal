import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, CheckCircle2, Clock, ShieldAlert, Building2, RefreshCw, Activity, ArrowRight, ShieldCheck } from 'lucide-react';

const OverviewTab = ({ token, onNavigateToCandidates, onNavigateToCompanies }) => {
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0 });
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const fetchOverviewData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Global Verification Stats
      const statsRes = await fetch('/api/candidates/stats?company=ALL', { headers: authHeaders() });
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.stats);
      }

      // 2. Fetch Companies Analytics
      const compRes = await fetch('/api/admin/companies', { headers: authHeaders() });
      const compData = await compRes.json();
      if (compData.success) {
        setCompanies(compData.companies || []);
      }
    } catch (err) {
      console.error('Error fetching overview data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverviewData();
  }, []);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-white border border-slate-300 text-slate-900 shadow-xs">
              <LayoutDashboard className="w-6 h-6" />
            </div>
            <span>System Overview</span>
          </h2>
          <p className="text-xs text-slate-600 font-semibold mt-1">
            Real-time verification metrics, company performance, and platform operational status
          </p>
        </div>

        <button
          onClick={fetchOverviewData}
          className="px-4 py-2.5 rounded-2xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer shadow-xs"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Metrics</span>
        </button>
      </div>

      {/* 4 TOP METRICS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Registered Candidates */}
        <div className="bg-white p-5 rounded-3xl border border-slate-300 shadow-md shadow-slate-900/5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold text-slate-600 uppercase tracking-widest">Total Registered</p>
              <h3 className="text-3xl font-extrabold text-slate-950 mt-1">{stats.total}</h3>
            </div>
            <div className="p-3 rounded-2xl bg-slate-100 border border-slate-300 text-slate-900 shadow-xs">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-600">All Candidates</span>
            <button onClick={onNavigateToCandidates} className="text-xs font-bold text-slate-900 hover:underline flex items-center space-x-1 cursor-pointer">
              <span>View</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Aadhaar e-KYC Verified */}
        <div className="bg-white p-5 rounded-3xl border border-slate-300 shadow-md shadow-slate-900/5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold text-emerald-800 uppercase tracking-widest">Aadhaar Verified</p>
              <h3 className="text-3xl font-extrabold text-emerald-800 mt-1">{stats.completed}</h3>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-700 shadow-xs">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[10px] font-bold text-emerald-800">
              {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}% Rate
            </span>
            <button onClick={onNavigateToCandidates} className="text-xs font-bold text-emerald-800 hover:underline flex items-center space-x-1 cursor-pointer">
              <span>Verified</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Pending Verification */}
        <div className="bg-white p-5 rounded-3xl border border-slate-300 shadow-md shadow-slate-900/5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold text-amber-900 uppercase tracking-widest">Pending Verification</p>
              <h3 className="text-3xl font-extrabold text-amber-900 mt-1">{stats.pending}</h3>
            </div>
            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-300 text-amber-700 shadow-xs">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-600">e-KYC Pending</span>
            <button onClick={onNavigateToCandidates} className="text-xs font-bold text-amber-900 hover:underline flex items-center space-x-1 cursor-pointer">
              <span>Reminders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Failed Verification */}
        <div className="bg-white p-5 rounded-3xl border border-slate-300 shadow-md shadow-slate-900/5 relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-extrabold text-rose-800 uppercase tracking-widest">Failed Verification</p>
              <h3 className="text-3xl font-extrabold text-rose-800 mt-1">{stats.failed || 0}</h3>
            </div>
            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-300 text-rose-700 shadow-xs">
              <ShieldAlert className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-[10px] font-semibold text-rose-700">Verification Failed</span>
            <button onClick={onNavigateToCandidates} className="text-xs font-bold text-rose-800 hover:underline flex items-center space-x-1 cursor-pointer">
              <span>Review</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* REGISTERED COMPANIES SUMMARY (3 COLUMNS ONLY: Company Name, Total Registered, Verified Candidates) */}
      <div className="bg-white rounded-3xl border border-slate-300 shadow-lg shadow-slate-900/5 overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-950 tracking-tight flex items-center space-x-2.5">
              <Building2 className="w-5 h-5 text-slate-800" />
              <span>Registered Companies ({companies.length})</span>
            </h3>
            <p className="text-xs text-slate-600 font-semibold mt-0.5">Summary of candidate registrations per company</p>
          </div>
          <button onClick={onNavigateToCompanies} className="px-4 py-2 rounded-2xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition cursor-pointer flex items-center space-x-1.5 shadow-xs">
            <span>Manage Companies</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-900">
            <thead className="bg-slate-100/90 border-b border-slate-200 font-bold text-[11px] text-slate-950 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3.5">Company Name</th>
                <th className="px-4 py-3.5">Total Registered</th>
                <th className="px-4 py-3.5">Verified Candidates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-semibold">
              {loading ? (
                <tr>
                  <td colSpan="3" className="px-4 py-8 text-center text-slate-600 font-bold">
                    Loading overview company statistics...
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan="3" className="px-4 py-8 text-center text-slate-600 font-bold">
                    No companies created yet. Click "Manage Companies" to add your first organization.
                  </td>
                </tr>
              ) : (
                companies.map((comp) => {
                  return (
                    <tr key={comp.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center space-x-3">
                          <div className="w-8 h-8 rounded-xl border border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                            {comp.logo_base64 ? (
                              <img src={comp.logo_base64} alt={comp.company_name} className="w-full h-full object-contain p-0.5" />
                            ) : (
                              <Building2 className="w-4 h-4 text-slate-600" />
                            )}
                          </div>
                          <div>
                            <span className="font-extrabold text-slate-950 block">{comp.company_name}</span>
                            {comp.display_name && comp.display_name !== comp.company_name && (
                              <span className="text-[10px] text-slate-500 font-semibold">{comp.display_name}</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-extrabold text-slate-950">
                        {comp.total_candidates} candidates
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-bold inline-flex items-center space-x-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{comp.verified_candidates} verified</span>
                        </span>
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

export default OverviewTab;
