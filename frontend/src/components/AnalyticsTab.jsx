import React, { useState, useEffect } from 'react';
import { BarChart3, CheckCircle2, ShieldAlert, Clock, Users, Building2, RefreshCw, TrendingUp, TrendingDown, PieChart, Activity } from 'lucide-react';

const AnalyticsTab = ({ token, activeCompany: parentActiveCompany }) => {
  const [stats, setStats] = useState({ total: 0, pending: 0, completed: 0, failed: 0 });
  const [companies, setCompanies] = useState([]);
  const [selectedCompany, setSelectedCompany] = useState(parentActiveCompany || 'ALL');
  const [loading, setLoading] = useState(true);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Candidates Stats filtered by company or ALL
      const statsUrl = selectedCompany && selectedCompany !== 'ALL'
        ? `/api/candidates/stats?company=${encodeURIComponent(selectedCompany)}`
        : '/api/candidates/stats?company=ALL';
      
      const statsRes = await fetch(statsUrl, { headers: authHeaders() });
      const statsData = await statsRes.json();
      if (statsData.success && statsData.stats) {
        setStats(statsData.stats);
      }

      // 2. Fetch Companies List with candidate counts
      const compRes = await fetch('/api/admin/companies', { headers: authHeaders() });
      const compData = await compRes.json();
      if (compData.success && compData.companies) {
        setCompanies(compData.companies);
      }
    } catch (err) {
      console.error('Error fetching analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
  }, [selectedCompany]);

  // Calculate Percentages
  const total = stats.total || 0;
  const verifiedCount = stats.completed || 0;
  const failedCount = stats.failed || 0;
  const pendingCount = stats.pending || 0;

  const successPercent = total > 0 ? ((verifiedCount / total) * 100).toFixed(1) : '0.0';
  const failurePercent = total > 0 ? ((failedCount / total) * 100).toFixed(1) : '0.0';
  const pendingPercent = total > 0 ? ((pendingCount / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-950 tracking-tight flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-slate-900 text-white shadow-md">
              <BarChart3 className="w-6 h-6" />
            </div>
            <span>Verification Analytics</span>
          </h2>
          <p className="text-xs text-slate-600 font-semibold mt-1">
            Real-time percentage breakdown of Aadhaar e-KYC success, failure, and pending rates
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Company Filter Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-500 uppercase">Filter:</span>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-slate-900 shadow-xs cursor-pointer"
            >
              <option value="ALL">All Companies</option>
              {companies.map((c) => (
                <option key={c.id || c.company_name} value={c.company_name}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={fetchAnalyticsData}
            className="p-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-100 text-slate-900 text-xs font-bold transition-all cursor-pointer shadow-xs"
            title="Refresh Analytics Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* TOP PERCENTAGE CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* SUCCESS RATE CARD */}
        <div className="bg-white p-5 rounded-3xl border border-emerald-200 shadow-md relative overflow-hidden flex flex-col justify-between group hover:shadow-lg transition-all">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold text-emerald-700 uppercase tracking-wider bg-emerald-50 border border-emerald-200 whitespace-nowrap">
                Success Rate
              </span>
              <h3 className="text-4xl font-black text-emerald-700 pt-1">{successPercent}%</h3>
            </div>
            <div className="p-3 rounded-2xl bg-emerald-100 text-emerald-700 shadow-xs shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-emerald-100 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600">Total Verified</span>
            <span className="font-mono font-black text-emerald-800">{verifiedCount} / {total}</span>
          </div>
        </div>

        {/* FAILURE RATE CARD */}
        <div className="bg-white p-5 rounded-3xl border border-rose-200 shadow-md relative overflow-hidden flex flex-col justify-between group hover:shadow-lg transition-all">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold text-rose-700 uppercase tracking-wider bg-rose-50 border border-rose-200 whitespace-nowrap">
                Failure Rate
              </span>
              <h3 className="text-4xl font-black text-rose-700 pt-1">{failurePercent}%</h3>
            </div>
            <div className="p-3 rounded-2xl bg-rose-100 text-rose-700 shadow-xs shrink-0">
              <TrendingDown className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-rose-100 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600">Total Failed</span>
            <span className="font-mono font-black text-rose-800">{failedCount} / {total}</span>
          </div>
        </div>

        {/* PENDING RATE CARD */}
        <div className="bg-white p-5 rounded-3xl border border-amber-200 shadow-md relative overflow-hidden flex flex-col justify-between group hover:shadow-lg transition-all">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold text-amber-800 uppercase tracking-wider bg-amber-50 border border-amber-200 whitespace-nowrap">
                Pending Rate
              </span>
              <h3 className="text-4xl font-black text-amber-800 pt-1">{pendingPercent}%</h3>
            </div>
            <div className="p-3 rounded-2xl bg-amber-100 text-amber-700 shadow-xs shrink-0">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-amber-100 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600">Total Pending</span>
            <span className="font-mono font-black text-amber-900">{pendingCount} / {total}</span>
          </div>
        </div>

        {/* TOTAL CANDIDATES PROCESSED */}
        <div className="bg-white p-5 rounded-3xl border border-slate-300 shadow-md relative overflow-hidden flex flex-col justify-between group hover:shadow-lg transition-all">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-extrabold text-slate-600 uppercase tracking-wider bg-slate-100 border border-slate-300 whitespace-nowrap">
                Total Registered
              </span>
              <h3 className="text-4xl font-black text-slate-950 pt-1">{total}</h3>
            </div>
            <div className="p-3 rounded-2xl bg-slate-100 text-slate-800 shadow-xs shrink-0">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-600">Active Filter</span>
            <span className="font-extrabold text-slate-900 truncate max-w-[120px]">{selectedCompany}</span>
          </div>
        </div>
      </div>

      {/* VISUAL RATIO PROGRESS BAR CARD */}
      <div className="bg-white rounded-3xl border border-slate-300 p-6 shadow-md space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold text-slate-950 tracking-tight flex items-center space-x-2">
            <PieChart className="w-5 h-5 text-slate-800" />
            <span>Verification Status Ratio Distribution</span>
          </h3>
          <span className="text-xs font-bold text-slate-500">Overall Ratio Metric</span>
        </div>

        {/* Multi-segmented Progress Bar */}
        <div className="space-y-2">
          <div className="w-full h-6 bg-slate-100 rounded-2xl overflow-hidden flex shadow-inner border border-slate-200 p-0.5">
            {total > 0 ? (
              <>
                <div
                  style={{ width: `${successPercent}%` }}
                  className="h-full bg-emerald-500 rounded-l-xl transition-all duration-500 flex items-center justify-center text-[10px] font-black text-white"
                  title={`Success: ${successPercent}%`}
                >
                  {Number(successPercent) > 10 ? `${successPercent}%` : ''}
                </div>
                <div
                  style={{ width: `${failurePercent}%` }}
                  className="h-full bg-rose-500 transition-all duration-500 flex items-center justify-center text-[10px] font-black text-white"
                  title={`Failed: ${failurePercent}%`}
                >
                  {Number(failurePercent) > 10 ? `${failurePercent}%` : ''}
                </div>
                <div
                  style={{ width: `${pendingPercent}%` }}
                  className="h-full bg-amber-400 rounded-r-xl transition-all duration-500 flex items-center justify-center text-[10px] font-black text-slate-900"
                  title={`Pending: ${pendingPercent}%`}
                >
                  {Number(pendingPercent) > 10 ? `${pendingPercent}%` : ''}
                </div>
              </>
            ) : (
              <div className="w-full h-full bg-slate-200 text-slate-500 text-xs font-bold flex items-center justify-center">
                No candidates registered yet
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-around pt-2 text-xs font-bold">
            <div className="flex items-center space-x-2 text-emerald-700">
              <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
              <span>Aadhaar Verified: {successPercent}% ({verifiedCount})</span>
            </div>
            <div className="flex items-center space-x-2 text-rose-700">
              <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
              <span>Verification Failed: {failurePercent}% ({failedCount})</span>
            </div>
            <div className="flex items-center space-x-2 text-amber-800">
              <span className="w-3 h-3 rounded-full bg-amber-400 inline-block"></span>
              <span>Pending e-KYC: {pendingPercent}% ({pendingCount})</span>
            </div>
          </div>
        </div>
      </div>

      {/* COMPANY-WISE ANALYTICS TABLE */}
      <div className="bg-white rounded-3xl border border-slate-300 shadow-md overflow-hidden p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-extrabold text-slate-950 tracking-tight flex items-center space-x-2.5">
              <Building2 className="w-5 h-5 text-slate-800" />
              <span>Company Performance Analytics</span>
            </h3>
            <p className="text-xs text-slate-600 font-semibold mt-0.5">
              Detailed success and failure rate percentages per registered organization
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-900">
            <thead className="bg-slate-100 border-b border-slate-200 font-extrabold text-[11px] text-slate-950 uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3.5">Company Name</th>
                <th className="px-4 py-3.5 text-center">Total Candidates</th>
                <th className="px-4 py-3.5 text-center">Verified Success</th>
                <th className="px-4 py-3.5 text-center">Failed</th>
                <th className="px-4 py-3.5 text-center">Success Rate %</th>
                <th className="px-4 py-3.5 text-center">Failure Rate %</th>
                <th className="px-4 py-3.5">Progress Visual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-semibold">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500 font-bold">
                    Loading company analytics...
                  </td>
                </tr>
              ) : companies.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500 font-bold">
                    No company profiles registered.
                  </td>
                </tr>
              ) : (
                companies.map((comp) => {
                  const compTotal = comp.total_candidates || 0;
                  const compVerified = comp.verified_candidates || 0;
                  const compFailed = comp.failed_candidates || 0;
                  const compSuccRate = compTotal > 0 ? ((compVerified / compTotal) * 100).toFixed(1) : '0.0';
                  const compFailRate = compTotal > 0 ? ((compFailed / compTotal) * 100).toFixed(1) : '0.0';

                  return (
                    <tr key={comp.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3.5 font-black text-slate-950">
                        {comp.company_name}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800">
                        {compTotal}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-extrabold text-emerald-700">
                        {compVerified}
                      </td>
                      <td className="px-4 py-3.5 text-center font-mono font-extrabold text-rose-700">
                        {compFailed}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-50 text-emerald-800 border border-emerald-200 inline-block">
                          {compSuccRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-black bg-rose-50 text-rose-800 border border-rose-200 inline-block">
                          {compFailRate}%
                        </span>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="w-32 h-3.5 bg-slate-100 rounded-full overflow-hidden flex border border-slate-200">
                          <div
                            style={{ width: `${compSuccRate}%` }}
                            className="h-full bg-emerald-500"
                            title={`Success: ${compSuccRate}%`}
                          ></div>
                          <div
                            style={{ width: `${compFailRate}%` }}
                            className="h-full bg-rose-500"
                            title={`Failed: ${compFailRate}%`}
                          ></div>
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

export default AnalyticsTab;
