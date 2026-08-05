import React, { useState } from 'react';
import { ShieldCheck, Lock, User, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';

const Login = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || 'Invalid username or password.');
      }

      sessionStorage.setItem('auth_token', data.token);
      sessionStorage.setItem('auth_user', JSON.stringify(data.user));
      onLoginSuccess(data.user, data.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md glass-panel rounded-3xl p-8 border border-white/80 shadow-2xl shadow-indigo-900/10">
        
        {/* Header Title */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-50 to-violet-100 border border-indigo-200/80 mx-auto flex items-center justify-center text-indigo-600 shadow-md shadow-indigo-500/10 mb-3.5">
            <ShieldCheck className="w-9 h-9 text-indigo-600" />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-slate-950">
            Candidate <span className="gradient-text-indigo">Verification</span>
          </h2>
          <p className="text-xs text-slate-700 mt-1 font-semibold uppercase tracking-wider">
            Super Admin Portal — Master Control
          </p>
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-5 p-3.5 rounded-xl bg-rose-50/90 border border-rose-200 flex items-center space-x-3 text-rose-800 text-xs font-semibold">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4.5">
          <div>
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider mb-1.5">
              Super Admin Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter admin username..."
                required
                className="w-full bg-white/90 border border-slate-300 rounded-xl pl-10 pr-4 py-2.5 text-xs text-slate-950 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-semibold shadow-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-900 uppercase tracking-wider mb-1.5">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password..."
                required
                className="w-full bg-white/90 border border-slate-300 rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-950 placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-600 font-semibold shadow-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-800 transition-colors p-0.5 cursor-pointer"
                title={showPassword ? "Hide Password" : "Show Password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-700 to-indigo-800 hover:from-indigo-700 hover:to-indigo-900 text-white font-extrabold text-xs uppercase tracking-wider shadow-lg shadow-indigo-500/30 transition-all duration-200 flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            <span>{loading ? 'AUTHENTICATING...' : 'LOGIN TO PORTAL'}</span>
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
