import React from 'react';
import { LayoutDashboard, ShieldCheck, LogOut, User, Activity, Building2, Users, UserPlus, BarChart3 } from 'lucide-react';

const Sidebar = ({ activeTab, setActiveTab, user, onLogout }) => {
  const navItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, desc: 'System & Verification Overview' },
    { id: 'candidates', label: 'Candidates', icon: Users, desc: 'Candidate Directory & Status Tracking' },
    { id: 'companies', label: 'Company', icon: Building2, desc: 'Organization Profiles & Links' },
    { id: 'register_candidate', label: 'Registration', icon: UserPlus, desc: 'Single Candidate e-KYC Registration' },
    { id: 'otp_analytics', label: 'OTP Analytics', icon: ShieldCheck, desc: 'Live OTP Dispatches & Audit Logs' },
    { id: 'analytics', label: 'Analytics', icon: BarChart3, desc: 'Success & Failure Rate Breakdown' },
  ];

  return (
    <aside className="w-72 bg-white border-r border-slate-300 flex flex-col justify-between h-screen sticky top-0 z-20 shadow-sm">
      <div>
        {/* Brand Header */}
        <div className="p-6 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-300 flex items-center justify-center text-slate-900 shadow-xs">
              <ShieldCheck className="w-6 h-6 text-slate-800" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg text-slate-950 tracking-tight leading-none">
                Identity <span className="text-slate-700">e-KYC</span>
              </h1>
              <p className="text-[10px] text-slate-500 tracking-widest uppercase font-bold mt-1">
                Verification Portal
              </p>
            </div>
          </div>
        </div>

        {/* User Badge */}
        <div className="mx-4 my-5 p-3.5 rounded-2xl bg-slate-50 border border-slate-300 flex items-center justify-between shadow-xs">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-900 font-extrabold shadow-xs">
              <User className="w-4.5 h-4.5" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-950">{user?.display_name || user?.username || 'Super Admin'}</p>
              <p className="text-[10px] text-slate-600 font-extrabold uppercase tracking-wider">Super Administrator</p>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-3 py-2 space-y-1.5">
          <p className="px-3 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2.5">
            Main Navigation
          </p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center space-x-3.5 px-4 py-3.5 rounded-2xl text-left transition-all duration-200 group cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white font-extrabold shadow-md'
                    : 'text-slate-700 hover:text-slate-950 hover:bg-slate-100 font-semibold'
                }`}
              >
                <Icon className={`w-5 h-5 transition-transform duration-200 group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <div>
                  <p className="text-sm font-extrabold leading-tight">{item.label}</p>
                  <p className={`text-[10px] ${isActive ? 'text-slate-300' : 'text-slate-500'} font-medium`}>{item.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Footer / Gateway Status & Logout */}
      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center space-x-2 text-[11px] text-emerald-900 font-bold">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <Activity className="w-3.5 h-3.5 ml-1 text-emerald-600" />
          <span>UIDAI GATEWAY: ONLINE</span>
        </div>

        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-extrabold tracking-wide transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>LOGOUT SESSION</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
