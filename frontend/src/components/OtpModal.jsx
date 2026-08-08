import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, Send, CheckCircle2, AlertCircle, Smartphone, Clock } from 'lucide-react';

const OtpModal = ({ candidate, token, onClose, onSuccess }) => {
  const [clientId, setClientId] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpDispatched, setOtpDispatched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [maskedMobile, setMaskedMobile] = useState('');
  const [validityTimer, setValidityTimer] = useState(150); // 2.5-minute validity timer (150s) matching Sandbox server timeout
  const [resendCooldown, setResendCooldown] = useState(45); // 45s resend cooldown

  const inputRefs = useRef([]);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  });

  // 2.5-minute OTP Validity & Resend Timer Countdown
  useEffect(() => {
    let interval = null;
    if (otpDispatched) {
      interval = setInterval(() => {
        setValidityTimer((prev) => (prev > 0 ? prev - 1 : 0));
        setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [otpDispatched]);

  const formatTimer = (secs) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleDispatchOtp = async () => {
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/verify/initiate', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ candidate_id: candidate.candidate_id }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || 'Failed to dispatch OTP.');
      }

      // 1. Overwrite client_id with newly returned client_id
      setClientId(data.client_id);
      
      // 2. Reset OTP input box so candidate enters fresh 6-digit code
      setOtp(['', '', '', '', '', '']);
      if (inputRefs.current[0]) {
        inputRefs.current[0].focus();
      }

      if (data.masked_mobile) {
        setMaskedMobile(data.masked_mobile);
      }
      setMessage('Aadhaar OTP has been dispatched by UIDAI to your registered mobile number.');
      setOtpDispatched(true);
      setValidityTimer(150);
      
      // 3. Disable Resend button for 45s cooldown after click
      setResendCooldown(45);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (index, value) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);

    if (value && index < 5) {
      inputRefs.current[index + 1].focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1].focus();
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const fullOtp = otp.join('');
    if (fullOtp.length !== 6) {
      setError('Please enter complete 6-digit OTP code.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/verify/confirm', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          candidate_id: candidate.candidate_id,
          client_id: clientId,
          otp: fullOtp,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || 'Verification failed.');
      }

      onSuccess(data.candidate);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const phoneLast4 = candidate?.phone ? candidate.phone.slice(-4) : 'XXXX';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 max-w-md w-full relative space-y-5 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 border-b border-slate-200 pb-4">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Aadhaar e-KYC Verification
            </h3>
            <p className="text-[11px] text-slate-500 font-medium">
              UIDAI Aadhaar OTP Authentication
            </p>
          </div>
        </div>

        {/* Candidate Info Badge */}
        <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between">
          <div>
            <p className="text-[10px] text-slate-500 font-medium uppercase">Target Candidate</p>
            <p className="text-xs font-bold text-slate-900">{candidate?.full_name}</p>
            <p className="text-[10px] font-bold text-indigo-600">{candidate?.candidate_id}</p>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
            PENDING
          </span>
        </div>

        {error && (
          <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 flex items-center space-x-2 text-rose-700 text-xs font-medium">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-start space-x-2 text-emerald-800 text-xs font-medium">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>{message}</span>
          </div>
        )}

        {!otpDispatched ? (
          <div className="text-center space-y-4">
            <p className="text-xs text-slate-600 font-medium leading-relaxed">
              Click <strong>Send Aadhaar OTP</strong> to send the 6-digit verification code to the candidate's registered mobile number ending with <strong>XXXXXX{(candidate?.phone || '').replace(/\D/g, '').slice(-4) || 'XXXX'}</strong>.
            </p>
            <button
              onClick={handleDispatchOtp}
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-indigo-200 disabled:opacity-50 cursor-pointer"
            >
              <Smartphone className="w-4 h-4" />
              <span>{loading ? 'Sending Aadhaar OTP...' : 'Send Aadhaar OTP'}</span>
            </button>
          </div>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-2xl text-[11px] text-emerald-950 font-semibold space-y-1">
              <div className="flex items-center space-x-1.5 text-emerald-800 font-extrabold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Aadhaar OTP Dispatched by UIDAI</span>
              </div>
              <p className="text-[10px] text-emerald-900 leading-relaxed font-medium">
                Aadhaar OTP sent to registered mobile number <strong className="font-mono text-emerald-950 font-extrabold">{
                  maskedMobile 
                    ? (maskedMobile.includes('X') ? maskedMobile : `XXXXXX-${maskedMobile.slice(-4)}`) 
                    : `XXXX-XXXX-${candidate?.phone ? candidate.phone.slice(-4) : 'XXXX'}`
                }</strong>
              </p>
            </div>

            {/* OTP EXPIRY TIMER BAR */}
            <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold">
              <span className="text-slate-600 flex items-center space-x-1.5 font-bold">
                <Clock className="w-4 h-4 text-indigo-600" />
                <span>OTP Validity Countdown:</span>
              </span>
              <span className={`font-mono font-extrabold px-2.5 py-0.5 rounded-md ${
                validityTimer > 60 ? 'bg-emerald-100 text-emerald-800' : validityTimer > 0 ? 'bg-amber-100 text-amber-800 animate-pulse' : 'bg-rose-100 text-rose-800'
              }`}>
                {validityTimer > 0 ? formatTimer(validityTimer) : 'Expired ⚠️'}
              </span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700 text-center">
                Enter 6-Digit OTP Code
              </label>
              <div className="flex justify-center space-x-2">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => (inputRefs.current[idx] = el)}
                    type="text"
                    maxLength={1}
                    value={digit}
                    placeholder="X"
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-10 h-12 bg-slate-50 border border-slate-300 rounded-xl text-center text-lg font-bold text-indigo-700 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-300"
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || validityTimer === 0}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-emerald-200 disabled:opacity-50 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{loading ? 'Verifying OTP...' : 'Submit OTP & Complete e-KYC'}</span>
            </button>

            {/* Resend OTP Button */}
            <div className="pt-2 flex justify-between items-center text-[11px] font-medium text-slate-500 border-t border-slate-200">
              <span>Didn't receive OTP?</span>
              <button
                type="button"
                onClick={() => {
                  setOtp(['', '', '', '', '', '']);
                  handleDispatchOtp();
                }}
                disabled={loading || resendCooldown > 0}
                className={`font-bold cursor-pointer transition-colors ${
                  resendCooldown > 0 ? 'text-slate-400 cursor-not-allowed' : 'text-indigo-600 hover:text-indigo-800'
                }`}
              >
                {resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : '↻ Resend Aadhaar OTP'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default OtpModal;
