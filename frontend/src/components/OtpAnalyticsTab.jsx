import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Send, 
  AlertTriangle, 
  BarChart3, 
  RefreshCw, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Smartphone,
  ChevronRight,
  TrendingUp
} from 'lucide-react';

const OtpAnalyticsTab = ({ token }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'VERIFIED_SUCCESS' | 'OTP_DISPATCHED' | 'FAILED'

  const fetchAnalytics = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/otp-analytics', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const resData = await res.json();
      if (!res.ok || !resData.success) {
        throw new Error(resData.detail || 'Failed to fetch OTP analytics.');
      }
      setData(resData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, [token]);

  const kpi = data?.kpi || {
    total_dispatched: 0,
    verified_success: 0,
    failed_expired: 0,
    success_rate: 0,
    api_credits_used: 0,
  };

  const logs = data?.logs || [];

  const filteredLogs = logs.filter((log) => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch =
      !q ||
      (log.candidate_name && log.candidate_name.toLowerCase().includes(q)) ||
      (log.candidate_id && log.candidate_id.toLowerCase().includes(q)) ||
      (log.company_name && log.company_name.toLowerCase().includes(q)) ||
      (log.aadhaar_number && log.aadhaar_number.includes(q)) ||
      (log.phone && log.phone.includes(q));

    if (statusFilter === 'VERIFIED_SUCCESS') {
      return matchSearch && log.event_type === 'VERIFIED_SUCCESS';
    }
    if (statusFilter === 'OTP_DISPATCHED') {
      return matchSearch && log.event_type === 'OTP_DISPATCHED' && log.status === 'SUCCESS';
    }
    if (statusFilter === 'FAILED') {
      return matchSearch && (log.status === 'FAILED' || log.event_type === 'VERIFIED_FAILED');
    }
    return matchSearch;
  });

  return (
    <div className="space-y-6">
      {/* HEADER BAR */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white/80 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <h2 className="text-lg font-black text-slate-900 flex items-center space-x-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            <span>Aadhaar e-KYC OTP Analytics & Audit Logs</span>
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Real-time tracking of dispatched SMS OTPs, successful e-KYC verifications, and API credit usage.
          </p>
        </div>

        <button
          onClick={fetchAnalytics}
          disabled={loading}
          className="px-4 py-2.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-extrabold text-xs flex items-center space-x-2 transition-all cursor-pointer disabled:opacity-50 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{loading ? 'Refreshing...' : 'Refresh Live Data'}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-bold flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI METRICS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* CARD 1: TOTAL DISPATCHED */}
        <div className="p-5 bg-gradient-to-br from-indigo-50/80 to-white border border-indigo-100 rounded-2xl shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider">Total OTPs Dispatched</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Send className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-slate-900">{kpi.total_dispatched}</span>
            <span className="text-xs text-slate-500 font-semibold">SMS Sent</span>
          </div>
          <p className="text-[11px] text-indigo-700/80 font-medium mt-2 flex items-center space-x-1">
            <Smartphone className="w-3 h-3" />
            <span>Sandbox.co.in Dispatches</span>
          </p>
        </div>

        {/* CARD 2: VERIFIED SUCCESS */}
        <div className="p-5 bg-gradient-to-br from-emerald-50/80 to-white border border-emerald-100 rounded-2xl shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-emerald-900 uppercase tracking-wider">Verified Successfully</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-600/10 flex items-center justify-center text-emerald-600">
              <ShieldCheck className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-emerald-600">{kpi.verified_success}</span>
            <span className="text-xs text-slate-500 font-semibold">Completed e-KYC</span>
          </div>
          <p className="text-[11px] text-emerald-700/80 font-medium mt-2 flex items-center space-x-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>100% Verified Profile Match</span>
          </p>
        </div>

        {/* CARD 3: FAILED / EXPIRED */}
        <div className="p-5 bg-gradient-to-br from-rose-50/80 to-white border border-rose-100 rounded-2xl shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-rose-900 uppercase tracking-wider">Failed / Expired</span>
            <div className="w-9 h-9 rounded-xl bg-rose-600/10 flex items-center justify-center text-rose-600">
              <XCircle className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-rose-600">{kpi.failed_expired}</span>
            <span className="text-xs text-slate-500 font-semibold">Attempts</span>
          </div>
          <p className="text-[11px] text-rose-700/80 font-medium mt-2 flex items-center space-x-1">
            <Clock className="w-3 h-3" />
            <span>Expired OTPs or Wrong Input</span>
          </p>
        </div>

        {/* CARD 4: SUCCESS RATE */}
        <div className="p-5 bg-gradient-to-br from-violet-50/80 to-white border border-violet-100 rounded-2xl shadow-xs relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-extrabold text-violet-900 uppercase tracking-wider">Success Rate</span>
            <div className="w-9 h-9 rounded-xl bg-violet-600/10 flex items-center justify-center text-violet-600">
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-3xl font-black text-violet-700">{kpi.success_rate}%</span>
            <span className="text-xs text-slate-500 font-semibold">Completion</span>
          </div>
          <div className="w-full bg-slate-100 h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div 
              className="bg-violet-600 h-full rounded-full transition-all duration-500" 
              style={{ width: `${Math.min(100, Math.max(0, kpi.success_rate))}%` }}
            />
          </div>
        </div>
      </div>

      {/* FILTER & SEARCH BAR */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3 md:space-y-0 md:flex md:items-center md:justify-between">
        {/* Status Filter Tabs */}
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 'ALL', label: 'All Logs' },
            { id: 'VERIFIED_SUCCESS', label: 'Verified' },
            { id: 'OTP_DISPATCHED', label: 'Dispatched' },
            { id: 'FAILED', label: 'Failed / Expired' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search candidate, Aadhaar..."
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all"
          />
        </div>
      </div>

      {/* AUDIT LOGS TABLE */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Date & Time</th>
                <th className="py-3.5 px-4">Candidate ID</th>
                <th className="py-3.5 px-4">Candidate Name</th>
                <th className="py-3.5 px-4">Company</th>
                <th className="py-3.5 px-4">Masked Aadhaar</th>
                <th className="py-3.5 px-4">Event Status</th>
                <th className="py-3.5 px-4">Details / Response</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading OTP analytics logs...</span>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400 font-medium">
                    <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-600 font-bold">No OTP logs found</p>
                    <p className="text-xs text-slate-400 mt-0.5">Dispatched SMS OTPs and e-KYC verification attempts will appear here automatically.</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isSuccess = log.status === 'SUCCESS' && log.event_type === 'VERIFIED_SUCCESS';
                  const isDispatched = log.status === 'SUCCESS' && log.event_type === 'OTP_DISPATCHED';
                  const isFailed = log.status === 'FAILED' || log.event_type === 'VERIFIED_FAILED';

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                        {log.created_at || '—'}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-indigo-600 whitespace-nowrap">
                        {log.candidate_id || 'N/A'}
                      </td>
                      <td className="py-3.5 px-4 font-extrabold text-slate-900 whitespace-nowrap">
                        {log.candidate_name || 'Candidate'}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-ellipsis overflow-hidden max-w-[150px] whitespace-nowrap">
                        {log.company_name || 'System'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                        {log.aadhaar_number || 'XXXX-XXXX-XXXX'}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isSuccess && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 font-extrabold text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>VERIFIED</span>
                          </span>
                        )}
                        {isDispatched && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 font-extrabold text-[11px]">
                            <Send className="w-3 h-3 text-indigo-600" />
                            <span>DISPATCHED</span>
                          </span>
                        )}
                        {isFailed && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-extrabold text-[11px]">
                            <XCircle className="w-3 h-3 text-rose-600" />
                            <span>FAILED</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs truncate max-w-xs">
                        {log.message || '—'}
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

export default OtpAnalyticsTab;
