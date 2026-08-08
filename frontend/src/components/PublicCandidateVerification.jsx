import React, { useState, useEffect, useRef } from 'react';
import Webcam from 'react-webcam';
import {
  ShieldCheck,
  User,
  Camera,
  Upload,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Smartphone,
  RefreshCw,
  Clock,
  Fingerprint,
  Lock,
} from 'lucide-react';
import { STATES_LIST, DISTRICTS_BY_STATE, DESIGNATION_LIST } from '../config/dropdownData';
import { detectRdServiceDevice, captureFingerprintPid } from '../utils/rdService';
import { compressImageBase64 } from '../utils/imageCompressor';

const PublicCandidateVerification = ({ candidateId: initialCandidateId, companyName: initialCompanyName }) => {
  const [candidateId, setCandidateId] = useState(initialCandidateId || '');
  const [companyName, setCompanyName] = useState(initialCompanyName || '');
  const [candidate, setCandidate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [currentStep, setCurrentStep] = useState(1); // 1: Personal Details, 2: Photos, 3: Aadhaar e-KYC

  // Step 1 Form Inputs
  const [fullName, setFullName] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [aadhaarNumber, setAadhaarNumber] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [address, setAddress] = useState('');
  const [state, setState] = useState('');
  const [district, setDistrict] = useState('');
  const [designation, setDesignation] = useState('');
  const [customDesignation, setCustomDesignation] = useState('');
  const [projectName, setProjectName] = useState('');
  const [hideCompanyName, setHideCompanyName] = useState(false);

  // Detect project-based registration form mode from URL
  const urlSearchParams = new URLSearchParams(window.location.search);
  const isProjectMode = urlSearchParams.get('form_type') === 'project' || urlSearchParams.get('mode') === 'project';

  // Step 2 Photos (Base64)
  const [facePhoto, setFacePhoto] = useState(null);
  const [aadhaarFront, setAadhaarFront] = useState(null);
  const [aadhaarBack, setAadhaarBack] = useState(null);
  const [activeWebcam, setActiveWebcam] = useState(null); // 'face', 'front', 'back'
  const webcamRef = useRef(null);

  // Step 3 Verification States (OTP vs Biometric)
  const [verificationMethod, setVerificationMethod] = useState('otp'); // 'otp' | 'biometric'
  const [otpLocked, setOtpLocked] = useState(false);
  const [rdDevice, setRdDevice] = useState({ connected: false, port: null, devName: '' });
  const [detectingDevice, setDetectingDevice] = useState(false);
  const [capturingFingerprint, setCapturingFingerprint] = useState(false);

  // Step 3 OTP Verification
  const [clientId, setClientId] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [verifiedSuccess, setVerifiedSuccess] = useState(false);
  const [maskedMobile, setMaskedMobile] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    fetchCandidateInfo();
  }, [candidateId, companyName]);

  const fetchCandidateInfo = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      // 1. Check Company Link Status if companyName is passed in URL
      if (companyName) {
        const compRes = await fetch(`/api/company/info?company=${encodeURIComponent(companyName)}`);
        const compData = await compRes.json();
        if (compData.success) {
          if (compData.link_enabled === false) {
            throw new Error(`The registration link for '${companyName}' has been disabled by the administrator. Please contact your company HR.`);
          }
          if (compData.hide_company_name) {
            setHideCompanyName(true);
          }
        }
      }

      // 2. Fetch Candidate Info if candidateId exists, or initialize profile for company self-registration link
      if (candidateId && candidateId !== 'NEW') {
        let url = `/api/public/candidate-info?candidate_id=${encodeURIComponent(candidateId)}`;
        if (companyName) {
          url += `&company=${encodeURIComponent(companyName)}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.detail || 'Invalid or expired candidate link.');
        }
        if (data.hide_company_name) {
          setHideCompanyName(true);
        }
        const cand = data.candidate;
        setCandidate(cand);
        setFullName(cand.full_name || '');
        setFatherName(cand.father_name || '');
        setPhone(cand.phone || '');
        setEmail(cand.email || '');
        setAadhaarNumber(cand.aadhaar_raw || '');
        setDob(cand.dob || '');
        setGender(cand.gender || '');
        setAddress(cand.address || '');
        setState(cand.state || '');
        setDistrict(cand.district || '');
        setDesignation(cand.designation || '');
        setProjectName(cand.project_name || '');

        if (cand.face_photo_base64) setFacePhoto(cand.face_photo_base64);
        if (cand.aadhaar_front_base64) setAadhaarFront(cand.aadhaar_front_base64);
        if (cand.aadhaar_back_base64) setAadhaarBack(cand.aadhaar_back_base64);

        if (cand.verification_status === 'VERIFIED') {
          setVerifiedSuccess(true);
        }
      } else if (companyName) {
        // Company Self-Registration Link
        setCandidate({ company_name: companyName, candidate_id: 'NEW' });
      } else if (isProjectMode) {
        // Dedicated Project-Based Self-Registration Link (no company name, no state/district, required Project Name)
        setCandidate({ company_name: 'Candidate Verification', candidate_id: 'NEW' });
      } else {
        throw new Error('Invalid verification link. Missing company or candidate parameters.');
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Convert File Upload to Base64
  const handleFileUpload = (e, setPhotoState) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoState(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Step 1 Validation -> Proceed to Step 2 (Live Camera Photo Capture)
  const handleNextToStep2 = (e) => {
    if (e && e.preventDefault) e.preventDefault();

    if (!fullName.trim()) {
      alert('Full Name is required.');
      return;
    }
    if (!fatherName.trim()) {
      alert("Father's Name is required.");
      return;
    }
    if (!phone.trim() || phone.replace(/\D/g, '').length !== 10) {
      alert('Mobile phone number must be exactly 10 digits.');
      return;
    }
    if (!aadhaarNumber.trim() || aadhaarNumber.replace(/\D/g, '').length !== 12) {
      alert('Aadhaar number must be exactly 12 digits.');
      return;
    }
    if (!gender.trim()) {
      alert('Please select your Gender.');
      return;
    }
    if (!dob.trim()) {
      alert('Date of Birth (DOB) is required in DD-MM-YYYY format.');
      return;
    }

    setCurrentStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Step 2 Save Details & Camera Photos -> Proceed to Step 3 (Aadhaar OTP)
  const handleSaveAndProceedToOtp = async () => {
    if (!facePhoto || !aadhaarFront || !aadhaarBack) {
      alert('Mandatory camera photos missing! Please capture Face Selfie, Aadhaar Front, and Aadhaar Back photos using your camera.');
      return;
    }

    setSavingDetails(true);
    try {
      const compressedFace = await compressImageBase64(facePhoto);
      const compressedFront = await compressImageBase64(aadhaarFront);
      const compressedBack = await compressImageBase64(aadhaarBack);

      const res = await fetch('/api/public/candidate-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId || 'NEW',
          company_name: companyName || candidate?.company_name,
          full_name: fullName.trim(),
          father_name: fatherName.trim(),
          email: email.trim(),
          phone: phone.replace(/\D/g, ''),
          aadhaar_number: aadhaarNumber.replace(/\D/g, ''),
          dob: dob.trim(),
          gender: gender,
          address: address.trim(),
          state: state,
          district: isProjectMode ? '' : district,
          designation: designation === 'Other' ? customDesignation : designation,
          project_name: isProjectMode ? projectName.trim() : '',
          face_photo_base64: compressedFace,
          aadhaar_front_base64: compressedFront,
          aadhaar_back_base64: compressedBack,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Failed to save registration details.');
      }

      const assignedId = data.candidate_id || candidateId;
      setCandidateId(assignedId);
      setCandidate((prev) => ({ ...prev, candidate_id: assignedId }));

      setCurrentStep(3); // Move to OTP Step
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert(`Registration Notice: ${err.message}`);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleDetectBiometricDevice = async () => {
    setDetectingDevice(true);
    try {
      const info = await detectRdServiceDevice();
      setRdDevice(info);
    } catch (e) {
      setRdDevice({ connected: false, port: null, devName: '' });
    } finally {
      setDetectingDevice(false);
    }
  };

  const handleCaptureBiometricKyc = async () => {
    setCapturingFingerprint(true);
    try {
      const pidRes = await captureFingerprintPid(rdDevice.baseUrl || rdDevice.port || 11100);
      if (!pidRes.success) {
        throw new Error('Failed to capture fingerprint PID data.');
      }

      const res = await fetch('/api/public/verify/biometric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          company_name: companyName || candidate?.company_name,
          aadhaar_number: aadhaarNumber.replace(/\D/g, ''),
          pid_xml: pidRes.pidXml,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || data.message || 'Biometric e-KYC verification failed.');
      }

      setVerifiedSuccess(true);
    } catch (err) {
      alert(`Biometric Verification Notice: ${err.message}`);
    } finally {
      setCapturingFingerprint(false);
    }
  };

  // Helper to trigger OTP directly with unlinked fallback to biometric
  const handleSendOtpDirect = async (candId, cleanAadhaar) => {
    setSendingOtp(true);
    try {
      const res = await fetch('/api/public/verify/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candId || candidateId,
          company_name: companyName || candidate?.company_name,
          aadhaar_number: cleanAadhaar || aadhaarNumber.replace(/\D/g, ''),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const errStr = (data.detail || data.message || '').toLowerCase();
        if (errStr.includes('not linked') || errStr.includes('no mobile') || errStr.includes('unlinked')) {
          setOtpLocked(true);
          setVerificationMethod('biometric');
          handleDetectBiometricDevice();
          alert('⚠️ UIDAI Notice: Mobile number is NOT linked with this Aadhaar card.\n\nThe OTP option is now locked. Please use the Fingerprint Biometric Scanner option below.');
          return;
        }
        throw new Error(data.detail || data.message || 'Failed to generate Aadhaar OTP.');
      }

      // 1. Overwrite client_id with newly returned client_id
      setClientId(data.client_id);

      // 2. Reset OTP input box for fresh 6-digit code
      setOtpCode('');

      if (data.masked_mobile) {
        setMaskedMobile(data.masked_mobile);
      }
      setOtpSent(true);

      // 3. Disable Resend button for 45s cooldown after click
      setResendCooldown(45);
    } catch (err) {
      alert(`OTP Notice: ${err.message}`);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleSendOtp = () => handleSendOtpDirect(candidateId, aadhaarNumber.replace(/\D/g, ''));

  // Step 3: Submit OTP
  const handleConfirmOtp = async () => {
    if (!otpCode || otpCode.length < 4) {
      alert('Please enter the 6-digit OTP code received on your phone.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const res = await fetch('/api/public/verify/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidate_id: candidateId,
          company_name: companyName || candidate?.company_name,
          client_id: clientId,
          otp: otpCode,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.detail || 'Invalid OTP code. Please try again.');
      }

      setVerifiedSuccess(true);
    } catch (err) {
      alert(`Verification Error: ${err.message}`);
    } finally {
      setVerifyingOtp(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4 text-slate-800">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-4" />
        <p className="text-sm font-bold text-slate-700">Loading Candidate Registration Portal...</p>
      </div>
    );
  }

  if (errorMsg || !candidate) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-300 p-8 rounded-3xl text-center space-y-4 shadow-xl">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-extrabold text-slate-900">Verification Link Notice</h2>
          <p className="text-xs text-slate-600 font-semibold">{errorMsg || 'Candidate link is invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col items-center justify-center p-4 font-sans">
      <div className="max-w-xl w-full space-y-6 my-6">
        
        {/* HEADER BRANDING */}
        <div className="text-center space-y-2 px-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white border border-slate-300 text-indigo-600 shadow-sm mb-1">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-950 tracking-tight leading-snug break-words">
            {isProjectMode ? 'Candidate Verification' : (hideCompanyName ? 'Candidate Verification Portal' : candidate.company_name)}
          </h1>
          <p className="text-xs text-indigo-600 font-bold uppercase tracking-wider">
            Candidate e-KYC Registration & Verification Portal
          </p>
        </div>

        {/* STEP PROGRESS BAR */}
        {!verifiedSuccess && (
          <div className="bg-white border border-slate-300 p-3.5 rounded-2xl flex items-center justify-between text-xs font-bold text-slate-600 shadow-sm">
            <div className={`flex items-center space-x-1.5 ${currentStep === 1 ? 'text-indigo-600 font-extrabold' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${currentStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>1</span>
              <span>1. Details</span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <div className={`flex items-center space-x-1.5 ${currentStep === 2 ? 'text-indigo-600 font-extrabold' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${currentStep === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>2</span>
              <span>2. Camera Photos</span>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400" />
            <div className={`flex items-center space-x-1.5 ${currentStep === 3 ? 'text-emerald-600 font-extrabold' : 'text-slate-400'}`}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] ${currentStep === 3 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>3</span>
              <span>3. Aadhaar e-KYC</span>
            </div>
          </div>
        )}

        {/* VERIFIED SUCCESS SCREEN */}
        {verifiedSuccess ? (
          <div className="bg-white border border-emerald-300 p-8 rounded-3xl shadow-xl text-center space-y-5">
            <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600 border border-emerald-200">
              <CheckCircle2 className="w-12 h-12" />
            </div>
            <h2 className="text-2xl font-extrabold text-slate-950">Registration & Verification Complete! ✓</h2>
            <p className="text-xs text-slate-600 leading-relaxed font-semibold">
              Thank you, <strong className="text-emerald-700">{fullName}</strong>! Your registration details, photos, and Aadhaar e-KYC verification have been successfully recorded{!hideCompanyName && ` for ${candidate.company_name}`}.
            </p>
            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 text-left space-y-2 text-xs text-slate-700 font-semibold">
              <div className="flex justify-between">
                <span className="text-slate-500">Candidate ID:</span>
                <span className="font-mono font-extrabold text-indigo-600">{candidate.candidate_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Full Name:</span>
                <span className="font-bold text-slate-900">{fullName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Mobile Phone:</span>
                <span className="font-mono text-slate-900">{phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Aadhaar Status:</span>
                <span className="font-extrabold text-emerald-600 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Verified via e-KYC</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* FORM CONTAINER */
          <div className="bg-white p-6 sm:p-8 rounded-3xl border border-slate-300 shadow-xl space-y-6">
            
            {/* STEP 1: PERSONAL DETAILS FORM */}
            {currentStep === 1 && (
              <form onSubmit={handleNextToStep2} className="space-y-4">
                <div className="border-b border-slate-200 pb-3">
                  <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <User className="w-4 h-4 text-indigo-600" />
                    <span>Step 1: Candidate Personal Registration Details</span>
                  </h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Full Name *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Full Name as per Aadhaar"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Father's Name *</label>
                    <input
                      type="text"
                      required
                      value={fatherName}
                      onChange={(e) => setFatherName(e.target.value)}
                      placeholder="Father's / Husband's Name"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Designation / Role</label>
                    <select
                      value={designation}
                      onChange={(e) => {
                        setDesignation(e.target.value);
                        if (e.target.value !== 'Other') setCustomDesignation('');
                      }}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    >
                      <option value="">-- Select Designation --</option>
                      {DESIGNATION_LIST.map((des) => (
                        <option key={des} value={des}>{des}</option>
                      ))}
                    </select>
                    {designation === 'Other' && (
                      <input
                        type="text"
                        value={customDesignation}
                        onChange={(e) => setCustomDesignation(e.target.value)}
                        placeholder="Type Custom Designation..."
                        className="w-full mt-2 bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none font-semibold"
                      />
                    )}
                  </div>

                  {!isProjectMode && (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">State</label>
                      <select
                        value={state}
                        onChange={(e) => {
                          setState(e.target.value);
                          setDistrict(''); // Reset district when state changes
                        }}
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                      >
                        <option value="">-- Select State --</option>
                        {STATES_LIST.map((st) => (
                          <option key={st} value={st}>{st}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {isProjectMode ? (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Project Name *</label>
                      <input
                        type="text"
                        required
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="Enter Project Name (e.g. Metro Line 1 / Site A)"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">District</label>
                      {state && DISTRICTS_BY_STATE[state] && DISTRICTS_BY_STATE[state].length > 0 ? (
                        <select
                          value={district}
                          onChange={(e) => setDistrict(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                        >
                          <option value="">-- Select District --</option>
                          {DISTRICTS_BY_STATE[state].map((dist) => (
                            <option key={dist} value={dist}>{dist}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={district}
                          onChange={(e) => setDistrict(e.target.value)}
                          placeholder={state ? "Type District Name..." : "Select State First"}
                          className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Mobile Phone (10 Digits) *</label>
                    <input
                      type="text"
                      required
                      maxLength={10}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                      placeholder="10-digit Mobile Number"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                      Email Address <span className="text-slate-400 font-normal lowercase">(Optional)</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="candidate@example.com (Optional)"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">12-Digit Aadhaar Number *</label>
                    <input
                      type="text"
                      required
                      maxLength={12}
                      value={aadhaarNumber}
                      onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, ''))}
                      placeholder="12-digit Aadhaar Number"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Date of Birth (DD-MM-YYYY) *</label>
                    <input
                      type="text"
                      required
                      maxLength={10}
                      value={dob}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 8);
                        let formatted = raw;
                        if (raw.length > 4) {
                          formatted = `${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4)}`;
                        } else if (raw.length > 2) {
                          formatted = `${raw.slice(0, 2)}-${raw.slice(2)}`;
                        }
                        setDob(formatted);
                      }}
                      placeholder="DD-MM-YYYY (e.g. 15-08-1995)"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Gender *</label>
                    <select
                      required
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    >
                      <option value="">Select Gender *</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Full Address</label>
                    <textarea
                      rows={2}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Residential Address..."
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-semibold"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer mt-4"
                >
                  <span>Next Step: Live Camera Photo Capture</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            )}

            {/* STEP 2: LIVE CAMERA PHOTO CAPTURE (NO FILE UPLOADS - CAMERA ONLY WITH FRONT/BACK SWITCH) */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <Camera className="w-4 h-4 text-indigo-600" />
                    <span>Step 2: Live Camera Photo Capture (Camera Only)</span>
                  </h3>
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="text-xs font-bold text-indigo-600 hover:underline flex items-center space-x-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Details</span>
                  </button>
                </div>

                {/* 1. Candidate Face Selfie Photo */}
                <div className="p-4 bg-slate-50 border border-slate-300 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-slate-900 uppercase">1. Candidate Face Selfie Photo *</p>
                      <p className="text-[11px] text-slate-500 font-semibold">Front Selfie Camera automatically activated</p>
                    </div>
                    {facePhoto && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                  </div>

                  {activeWebcam === 'face' ? (
                    <div className="space-y-3">
                      <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: "user" }}
                        className="w-full max-h-64 object-cover rounded-xl border border-slate-300 bg-black"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const imageSrc = webcamRef.current.getScreenshot();
                            if (imageSrc) {
                              setFacePhoto(imageSrc);
                              setActiveWebcam(null);
                            }
                          }}
                          className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                        >
                          <Camera className="w-4 h-4" />
                          <span>Snap Photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveWebcam(null)}
                          className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-4">
                      {facePhoto ? (
                        <img src={facePhoto} alt="Face Selfie" className="w-20 h-20 rounded-xl object-cover border border-slate-300" />
                      ) : (
                        <div className="w-20 h-20 rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-400">
                          <User className="w-8 h-8" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveWebcam('face')}
                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{facePhoto ? 'Retake Selfie' : 'Open Camera'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Aadhaar Front Card Photo */}
                <div className="p-4 bg-slate-50 border border-slate-300 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-slate-900 uppercase">2. Aadhaar Front Card Photo *</p>
                      <p className="text-[11px] text-slate-500 font-semibold">Back Document Camera automatically activated</p>
                    </div>
                    {aadhaarFront && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                  </div>

                  {activeWebcam === 'front' ? (
                    <div className="space-y-3">
                      <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: "environment" }}
                        className="w-full max-h-64 object-cover rounded-xl border border-slate-300 bg-black"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const imageSrc = webcamRef.current.getScreenshot();
                            if (imageSrc) {
                              setAadhaarFront(imageSrc);
                              setActiveWebcam(null);
                            }
                          }}
                          className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                        >
                          <Camera className="w-4 h-4" />
                          <span>Snap Photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveWebcam(null)}
                          className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-4">
                      {aadhaarFront ? (
                        <img src={aadhaarFront} alt="Aadhaar Front" className="w-24 h-16 rounded-xl object-cover border border-slate-300" />
                      ) : (
                        <div className="w-24 h-16 rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-400">
                          <Camera className="w-6 h-6" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveWebcam('front')}
                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{aadhaarFront ? 'Retake Front Photo' : 'Open Camera'}</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* 3. Aadhaar Back Card Photo */}
                <div className="p-4 bg-slate-50 border border-slate-300 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-extrabold text-slate-900 uppercase">3. Aadhaar Back Card Photo *</p>
                      <p className="text-[11px] text-slate-500 font-semibold">Back Document Camera automatically activated</p>
                    </div>
                    {aadhaarBack && <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />}
                  </div>

                  {activeWebcam === 'back' ? (
                    <div className="space-y-3">
                      <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: "environment" }}
                        className="w-full max-h-64 object-cover rounded-xl border border-slate-300 bg-black"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const imageSrc = webcamRef.current.getScreenshot();
                            if (imageSrc) {
                              setAadhaarBack(imageSrc);
                              setActiveWebcam(null);
                            }
                          }}
                          className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                        >
                          <Camera className="w-4 h-4" />
                          <span>Snap Photo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveWebcam(null)}
                          className="px-4 py-2.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-4">
                      {aadhaarBack ? (
                        <img src={aadhaarBack} alt="Aadhaar Back" className="w-24 h-16 rounded-xl object-cover border border-slate-300" />
                      ) : (
                        <div className="w-24 h-16 rounded-xl bg-white border border-slate-300 flex items-center justify-center text-slate-400">
                          <Camera className="w-6 h-6" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveWebcam('back')}
                        className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs flex items-center space-x-1.5 shadow-xs cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        <span>{aadhaarBack ? 'Retake Back Photo' : 'Open Camera'}</span>
                      </button>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSaveAndProceedToOtp}
                  disabled={savingDetails || !facePhoto || !aadhaarFront || !aadhaarBack}
                  className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-emerald-200 transition-all cursor-pointer disabled:opacity-50"
                >
                  {savingDetails ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ShieldCheck className="w-4 h-4" />
                  )}
                  <span>{savingDetails ? 'Saving Candidate Profile...' : 'Complete Registration & Proceed to Aadhaar e-KYC'}</span>
                </button>
              </div>
            )}

            {/* STEP 3: AADHAAR OTP VERIFICATION */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                  <h3 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Step 3: UIDAI Aadhaar OTP e-KYC Verification</span>
                  </h3>
                  <button
                    onClick={() => setCurrentStep(2)}
                    className="text-xs font-bold text-indigo-600 hover:underline flex items-center space-x-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Photos</span>
                  </button>
                </div>

                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-2xl space-y-1 text-xs text-slate-700 font-semibold">
                  <p className="font-extrabold text-indigo-900">Registered Candidate Profile:</p>
                  <p>• Name: <strong>{fullName}</strong></p>
                  <p>• Phone: <strong>{phone}</strong></p>
                  <p>• Aadhaar: <strong>XXXX-XXXX-{aadhaarNumber.slice(-4)}</strong></p>
                </div>

                {/* VERIFICATION METHOD SWITCHER TABS */}
                <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => !otpLocked && setVerificationMethod('otp')}
                    disabled={otpLocked}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                      verificationMethod === 'otp'
                        ? 'bg-white text-indigo-700 shadow-sm border border-slate-200'
                        : otpLocked
                        ? 'text-slate-400 opacity-60 cursor-not-allowed'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {otpLocked ? <Lock className="w-3.5 h-3.5 text-rose-500" /> : <Smartphone className="w-3.5 h-3.5" />}
                    <span>{otpLocked ? 'OTP (Locked)' : '1. Aadhaar OTP'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setVerificationMethod('biometric');
                      handleDetectBiometricDevice();
                    }}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center space-x-2 transition-all cursor-pointer ${
                      verificationMethod === 'biometric'
                        ? 'bg-white text-emerald-700 shadow-sm border border-slate-200'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Fingerprint className="w-3.5 h-3.5 text-emerald-600" />
                    <span>2. Fingerprint Scanner</span>
                  </button>
                </div>

                {/* TAB 1: AADHAAR OTP VERIFICATION */}
                {verificationMethod === 'otp' && (
                  <>
                    {!otpSent ? (
                      <div className="space-y-4">
                        <button
                          onClick={handleSendOtp}
                          disabled={sendingOtp}
                          className="w-full py-3.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {sendingOtp ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Smartphone className="w-4 h-4" />
                          )}
                          <span>{sendingOtp ? 'Generating Aadhaar OTP...' : 'Send Aadhaar OTP'}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* UIDAI OFFICIAL NOTICE BANNER */}
                        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl text-xs text-emerald-950 font-semibold space-y-1 shadow-xs">
                          <div className="flex items-center space-x-2 text-emerald-800 font-extrabold">
                            <CheckCircle2 className="w-4.5 h-4.5 text-emerald-600 shrink-0" />
                            <span>Aadhaar OTP Dispatched by UIDAI</span>
                          </div>
                          <p className="text-[11px] text-emerald-900 leading-relaxed font-medium">
                            Aadhaar OTP sent to registered mobile number{' '}
                            <strong className="font-mono text-emerald-950 font-extrabold">
                              {maskedMobile || '(Aadhaar-linked mobile)'}
                            </strong>
                          </p>
                          <p className="text-[10px] text-emerald-800 font-semibold pt-1 border-t border-emerald-200/60 mt-1">
                            📌 Note: UIDAI delivers SMS OTPs exclusively to the SIM card linked to your Aadhaar card at UIDAI. This might be different from your form contact number.
                          </p>
                        </div>


                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                            <span>Enter 6-Digit OTP Code</span>
                          </label>
                          <input
                            type="text"
                            maxLength={6}
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value)}
                            placeholder="XXXXXX"
                            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-3 text-center text-xl font-mono font-extrabold text-indigo-700 tracking-widest focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          />
                        </div>

                        <button
                          onClick={handleConfirmOtp}
                          disabled={verifyingOtp}
                          className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-emerald-200 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {verifyingOtp ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ShieldCheck className="w-4 h-4" />
                          )}
                          <span>{verifyingOtp ? 'Verifying OTP...' : 'Submit OTP & Complete e-KYC'}</span>
                        </button>

                        {/* Resend OTP Button */}
                        <div className="pt-2 flex justify-between items-center text-xs text-slate-600 border-t border-slate-200 font-semibold">
                          <span>Didn't receive OTP?</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (resendCooldown > 0) return;
                              setOtpCode('');
                              handleSendOtp();
                            }}
                            disabled={sendingOtp || resendCooldown > 0}
                            className="font-extrabold text-indigo-600 hover:text-indigo-800 cursor-pointer transition-colors disabled:opacity-50"
                          >
                            {resendCooldown > 0 ? `↻ Resend OTP in ${resendCooldown}s` : '↻ Resend Aadhaar OTP'}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* TAB 2: BIOMETRIC FINGERPRINT SCANNER SECTION */}
                {verificationMethod === 'biometric' && (
                  <div className="space-y-4 bg-slate-50 border border-slate-200 p-5 rounded-2xl">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-extrabold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                        <Fingerprint className="w-4 h-4 text-emerald-600" />
                        <span>Biometric Fingerprint Scanner (RD Service)</span>
                      </h4>
                      <button
                        type="button"
                        onClick={handleDetectBiometricDevice}
                        disabled={detectingDevice}
                        className="text-[11px] font-bold text-indigo-600 hover:underline flex items-center space-x-1 cursor-pointer"
                      >
                        <RefreshCw className={`w-3 h-3 ${detectingDevice ? 'animate-spin' : ''}`} />
                        <span>Scan Device</span>
                      </button>
                    </div>

                    {/* DEVICE CONNECTION STATUS CARD */}
                    <div className={`p-3.5 rounded-xl text-xs font-semibold border flex items-center justify-between ${
                      rdDevice.connected
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : 'bg-amber-50 border-amber-200 text-amber-900'
                    }`}>
                      <div className="flex items-center space-x-2">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${rdDevice.connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                        <span>{rdDevice.connected ? `Device Connected: ${rdDevice.devName} (READY)` : 'No USB Scanner Found'}</span>
                      </div>
                      <span className="text-[10px] font-mono font-bold">
                        {rdDevice.connected ? `Port: ${rdDevice.port}` : 'Connect USB Scanner'}
                      </span>
                    </div>

                    {!rdDevice.connected && (
                      <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
                        * Connect your <strong>Mantra MFS100</strong>, <strong>Morpho MSO1300 E3</strong>, or <strong>Startek USB Fingerprint Scanner</strong> to your computer and make sure the Mantra / Morpho RD Service software is running on your computer.
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={handleCaptureBiometricKyc}
                      disabled={capturingFingerprint}
                      className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center space-x-2 shadow-md shadow-emerald-200 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {capturingFingerprint ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Fingerprint className="w-4 h-4" />
                      )}
                      <span>{capturingFingerprint ? 'Place Finger on Red Light...' : 'Capture Fingerprint & Complete e-KYC'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicCandidateVerification;
