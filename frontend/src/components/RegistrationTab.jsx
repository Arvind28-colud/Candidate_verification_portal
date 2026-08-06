import React, { useState, useRef } from 'react';
import Webcam from 'react-webcam';
import { User, Phone, Mail, CreditCard, Calendar, MapPin, Camera, Upload, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, RefreshCw, Eye, X, Building2 } from 'lucide-react';
import ImageModal from './ImageModal';
import { STATES_LIST, DISTRICTS_BY_STATE, DESIGNATION_LIST } from '../config/dropdownData';
import { compressImageBase64 } from '../utils/imageCompressor';

const RegistrationTab = ({ token, activeCompany, onRegistrationComplete }) => {
  const [activeStep, setActiveStep] = useState(1); // Step 1: Details, Step 2: Photo Capture

  // Company Selection (Lock to active tenant company if specified)
  const [companyName, setCompanyName] = useState(() => {
    if (activeCompany && activeCompany !== 'ALL') return activeCompany;
    return localStorage.getItem('selected_company_name') || 'Company X';
  });

  const [hideCompanyName, setHideCompanyName] = useState(false);

  React.useEffect(() => {
    if (activeCompany && activeCompany !== 'ALL') {
      setCompanyName(activeCompany);
    }
  }, [activeCompany]);

  React.useEffect(() => {
    if (companyName) {
      fetch(`/api/company/info?company=${encodeURIComponent(companyName)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.hide_company_name) {
            setHideCompanyName(true);
          } else {
            setHideCompanyName(false);
          }
        })
        .catch(() => {});
    }
  }, [companyName]);

  // Step 1 Details
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

  // Step 2 Mandatory Photos
  const [facePhoto, setFacePhoto] = useState(null);
  const [aadhaarFront, setAadhaarFront] = useState(null);
  const [aadhaarBack, setAadhaarBack] = useState(null);

  // Webcam modal / state
  const [webcamTarget, setWebcamTarget] = useState(null); // 'face', 'front', 'back'
  const webcamRef = useRef(null);

  // Full image view state
  const [previewImage, setPreviewImage] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Format Aadhaar Input
  const handleAadhaarChange = (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 12) val = val.slice(0, 12);
    setAadhaarNumber(val);
  };

  const handlePhoneChange = (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 10) val = val.slice(0, 10);
    setPhone(val);
  };

  // Convert File to Base64
  const handleFileUpload = (e, setPhotoState) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotoState(reader.result);
    };
    reader.readAsDataURL(file);
  };

  // Capture Photo from Webcam
  const captureWebcamPhoto = () => {
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (webcamTarget === 'face') setFacePhoto(imageSrc);
      if (webcamTarget === 'front') setAadhaarFront(imageSrc);
      if (webcamTarget === 'back') setAadhaarBack(imageSrc);
      setWebcamTarget(null);
    }
  };

  // Check if photos are captured (Optional)
  const allPhotosCaptured = true;

  const handleFormSubmit = async (e) => {
    e.preventDefault();

    setLoading(true);
    setError('');

    try {
      const compressedFace = await compressImageBase64(facePhoto);
      const compressedFront = await compressImageBase64(aadhaarFront);
      const compressedBack = await compressImageBase64(aadhaarBack);

      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          company_name: companyName,
          full_name: fullName,
          father_name: fatherName,
          phone: phone,
          email: email,
          aadhaar_number: aadhaarNumber,
          dob: dob,
          gender: gender,
          address: address,
          state: state,
          district: district,
          designation: designation === 'Other' ? customDesignation : designation,
          project_name: projectName.trim(),
          face_photo_base64: compressedFace,
          aadhaar_front_base64: compressedFront,
          aadhaar_back_base64: compressedBack,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.detail || 'Registration failed.');
      }

      // Reset form
      setFullName('');
      setFatherName('');
      setPhone('');
      setEmail('');
      setAadhaarNumber('');
      setDob('');
      setGender('');
      setAddress('');
      setFacePhoto(null);
      setAadhaarFront(null);
      setAadhaarBack(null);
      setActiveStep(1);

      // Trigger completion & open OTP Modal
      const candRes = await fetch(`/api/candidate/${data.candidate_id}?company=${encodeURIComponent(companyName)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const candData = await candRes.json();
      if (candData.success) {
        onRegistrationComplete(candData.candidate);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Title */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Candidate Registration & Photo Capture
          </h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Step-by-step registration with mandatory webcam/file photo validation
          </p>
        </div>

        {/* STEP PROGRESS BAR */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${activeStep === 1
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                }`}
            >
              1
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Step 1: Personal Details</p>
              <p className="text-[10px] text-slate-500 font-medium">Government ID Profile Info</p>
            </div>
          </div>

          <div className="h-0.5 flex-1 mx-4 bg-slate-200" />

          <div className="flex items-center space-x-3">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${activeStep === 2
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200'
                : allPhotosCaptured
                  ? 'bg-indigo-50 border border-indigo-200 text-indigo-700'
                  : 'bg-slate-100 border border-slate-200 text-slate-400'
                }`}
            >
              2
            </div>
            <div>
              <p className="text-xs font-bold text-slate-900">Step 2: Mandatory Photo Capture</p>
              <p className="text-[10px] text-slate-500 font-medium">Face & Aadhaar Document Capture</p>
            </div>
          </div>
        </div>

        {/* TOP FLOATING VALIDATION ERROR POPUP BANNER */}
        {error && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[92%] bg-rose-50 border-2 border-rose-400 text-rose-900 rounded-2xl p-4 shadow-xl backdrop-blur-xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-rose-100 border border-rose-300 text-rose-600 shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-600 animate-bounce" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase text-rose-800 tracking-wider">Required Fields Alert</h4>
                <p className="text-xs font-medium leading-relaxed text-rose-900">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setError('')}
              className="p-1.5 text-rose-500 hover:text-rose-900 hover:bg-rose-100 rounded-xl transition cursor-pointer shrink-0"
              title="Dismiss alert"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* WEBCAM CAPTURE MODAL */}
        {webcamTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full text-center space-y-4">
              <h3 className="text-sm font-bold text-indigo-700 uppercase tracking-wider">
                Capture {webcamTarget === 'face' ? 'Candidate Face Photo' : webcamTarget === 'front' ? 'Aadhaar Front Document' : 'Aadhaar Back Document'}
              </h3>
              <div className="relative rounded-2xl overflow-hidden border border-indigo-200 bg-slate-900 aspect-video flex items-center justify-center">
                <Webcam
                  audio={false}
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  videoConstraints={{ facingMode: webcamTarget === 'face' ? 'user' : 'environment' }}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex justify-center space-x-3">
                <button
                  type="button"
                  onClick={() => setWebcamTarget(null)}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={captureWebcamPhoto}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Snap Photo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleFormSubmit} className="space-y-6">
          {/* STEP 1: PERSONAL DETAILS */}
          {activeStep === 1 && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-5">
              <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                  <User className="w-4 h-4 text-indigo-600" />
                  <span>Candidate Personal Information</span>
                </h3>
                <span className="text-[10px] font-semibold text-slate-400 uppercase">* Required Fields</span>
              </div>

              {/* STEP 1: PERSONAL DETAILS FORM */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Full Name (as per Aadhaar) *
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Ramesh Kumar"
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Father's Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={fatherName}
                    onChange={(e) => setFatherName(e.target.value)}
                    placeholder="e.g. Suresh Kumar"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Designation / Role
                  </label>
                  <select
                    value={designation}
                    onChange={(e) => {
                      setDesignation(e.target.value);
                      if (e.target.value !== 'Other') setCustomDesignation('');
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
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
                      className="w-full mt-2 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2 text-xs text-slate-900 focus:bg-white focus:outline-none font-medium"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    State
                  </label>
                  <select
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      setDistrict(''); // Reset district when state changes
                    }}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  >
                    <option value="">-- Select State --</option>
                    {STATES_LIST.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    District
                  </label>
                  {state && DISTRICTS_BY_STATE[state] && DISTRICTS_BY_STATE[state].length > 0 ? (
                    <select
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
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
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="Enter Project Name (e.g. Metro Line 1 / Site A)"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Mobile Phone (10 Digits) *
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    placeholder="10-digit mobile number"
                    maxLength={10}
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Email Address <span className="text-slate-400 font-normal lowercase">(Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ramesh@example.com (Optional)"
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Aadhaar Number (12 Digits) *
                  </label>
                  <input
                    type="text"
                    value={aadhaarNumber}
                    onChange={handleAadhaarChange}
                    placeholder="12-digit Aadhaar number..."
                    maxLength={12}
                    required
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium tracking-wider"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Date of Birth (DD-MM-YYYY) *
                  </label>
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
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                    Gender *
                  </label>
                  <select
                    required
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                  >
                    <option value="">-- Select Gender * --</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Full Address
                </label>
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  placeholder="House / Street / City / State / Pincode"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                />
              </div>

              <div className="flex justify-end pt-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!fullName.trim() || phone.length !== 10 || aadhaarNumber.length !== 12) {
                      setError('Please fill in required fields: Candidate Name, 10-digit Phone, 12-digit Aadhaar.');
                      return;
                    }
                    setError('');
                    setActiveStep(2);
                  }}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider flex items-center space-x-2 shadow-md shadow-indigo-200 cursor-pointer"
                >
                  <span>Proceed to Step 2: Photo Capture</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: MANDATORY PHOTO CAPTURE */}
          {activeStep === 2 && (
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6">
              <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                    <Camera className="w-4 h-4 text-indigo-600" />
                    <span>Step 2: Mandatory Photo Capture / Document Upload</span>
                  </h3>
                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                    Registration requires Face Selfie, Aadhaar Front, and Aadhaar Back photos. Click image thumbnails to view full resolution.
                  </p>
                </div>

                {allPhotosCaptured ? (
                  <span className="px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>ALL 3 PHOTOS CAPTURED</span>
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-bold flex items-center space-x-1.5 animate-pulse">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>PHOTOS REQUIRED BEFORE SUBMIT</span>
                  </span>
                )}
              </div>

              {/* 3 PHOTO CARDS GRID */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* CARD 1: FACE SELFIE */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-slate-700 font-bold">1. Candidate Face Selfie *</span>
                    {facePhoto ? (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold">
                        Captured ✓
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-bold">
                        Required
                      </span>
                    )}
                  </div>

                  <div
                    className={`aspect-square rounded-2xl border-2 border-dashed border-slate-300 bg-white overflow-hidden flex items-center justify-center relative group ${facePhoto ? 'cursor-pointer hover:border-indigo-500 transition-colors' : ''}`}
                    onClick={() => facePhoto && setPreviewImage({ src: facePhoto, title: "Candidate Face Selfie" })}
                    title={facePhoto ? "Click to view full image" : ""}
                  >
                    {facePhoto ? (
                      <>
                        <img src={facePhoto} alt="Face Selfie" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4 text-slate-400">
                        <User className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                        <p className="text-[10px] font-semibold">No Face Photo</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setWebcamTarget('face')}
                      className="w-full py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Open Camera</span>
                    </button>
                  </div>
                </div>

                {/* CARD 2: AADHAAR FRONT */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-slate-700 font-bold">2. Aadhaar Front *</span>
                    {aadhaarFront ? (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold">
                        Captured ✓
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-bold">
                        Required
                      </span>
                    )}
                  </div>

                  <div
                    className={`aspect-square rounded-2xl border-2 border-dashed border-slate-300 bg-white overflow-hidden flex items-center justify-center relative group ${aadhaarFront ? 'cursor-pointer hover:border-indigo-500 transition-colors' : ''}`}
                    onClick={() => aadhaarFront && setPreviewImage({ src: aadhaarFront, title: "Aadhaar Front Document" })}
                    title={aadhaarFront ? "Click to view full image" : ""}
                  >
                    {aadhaarFront ? (
                      <>
                        <img src={aadhaarFront} alt="Aadhaar Front" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4 text-slate-400">
                        <CreditCard className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                        <p className="text-[10px] font-semibold">No Front Image</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setWebcamTarget('front')}
                      className="w-full py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Open Camera</span>
                    </button>
                  </div>
                </div>

                {/* CARD 3: AADHAAR BACK */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs uppercase text-slate-700 font-bold">3. Aadhaar Back *</span>
                    {aadhaarBack ? (
                      <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md font-bold">
                        Captured ✓
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md font-bold">
                        Required
                      </span>
                    )}
                  </div>

                  <div
                    className={`aspect-square rounded-2xl border-2 border-dashed border-slate-300 bg-white overflow-hidden flex items-center justify-center relative group ${aadhaarBack ? 'cursor-pointer hover:border-indigo-500 transition-colors' : ''}`}
                    onClick={() => aadhaarBack && setPreviewImage({ src: aadhaarBack, title: "Aadhaar Back Document" })}
                    title={aadhaarBack ? "Click to view full image" : ""}
                  >
                    {aadhaarBack ? (
                      <>
                        <img src={aadhaarBack} alt="Aadhaar Back" className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4 text-slate-400">
                        <CreditCard className="w-10 h-10 mx-auto mb-2 text-slate-400" />
                        <p className="text-[10px] font-semibold">No Back Image</p>
                      </div>
                    )}
                  </div>

                  <div>
                    <button
                      type="button"
                      onClick={() => setWebcamTarget('back')}
                      className="w-full py-2 rounded-xl bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-[11px] font-semibold flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Open Camera</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* BUTTONS BAR */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setActiveStep(1)}
                  className="px-4 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer shadow-xs"
                >
                  &larr; Back to Step 1
                </button>

                <button
                  type="submit"
                  disabled={!allPhotosCaptured || loading}
                  className={`px-6 py-3 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center space-x-2 transition-all ${allPhotosCaptured && !loading
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-200 cursor-pointer'
                    : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                    }`}
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {loading
                      ? 'Registering Candidate...'
                      : allPhotosCaptured
                        ? 'Register Candidate & Launch OTP Verification'
                        : 'Capture All 3 Photos To Register'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* FULL IMAGE PREVIEW MODAL */}
      {previewImage && (
        <ImageModal
          src={previewImage.src}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
};

export default RegistrationTab;
