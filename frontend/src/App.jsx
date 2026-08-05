import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Login from './components/Login';
import OverviewTab from './components/OverviewTab';
import CompanyManagementTab from './components/CompanyManagementTab';
import CandidatesTab from './components/CandidatesTab';
import RegistrationTab from './components/RegistrationTab';
import AnalyticsTab from './components/AnalyticsTab';
import OtpModal from './components/OtpModal';
import ComparisonModal from './components/ComparisonModal';
import PdfReportModal from './components/PdfReportModal';
import { Building2, ShieldCheck, Lock } from 'lucide-react';

import PublicCandidateVerification from './components/PublicCandidateVerification';

function App() {
  const urlParams = new URLSearchParams(window.location.search);
  const publicCandidateId = urlParams.get('candidate_id');
  const publicCompanyName = urlParams.get('company') || urlParams.get('org');
  const isProjectMode = urlParams.get('form_type') === 'project' || urlParams.get('mode') === 'project';

  if (publicCandidateId || isProjectMode || (publicCompanyName && !sessionStorage.getItem('auth_token'))) {
    return <PublicCandidateVerification candidateId={publicCandidateId} companyName={publicCompanyName} />;
  }
  const [token, setToken] = useState(sessionStorage.getItem('auth_token'));
  const [user, setUser] = useState(() => {
    const raw = sessionStorage.getItem('auth_user');
    return raw ? JSON.parse(raw) : null;
  });

  const [activeTab, setActiveTab] = useState('overview');

  // Multi-Tenant Company Context (URL query parameter ?company=... or user company)
  const [activeCompany, setActiveCompany] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlComp = params.get('company') || params.get('org');
    if (urlComp) return urlComp;
    const rawUser = sessionStorage.getItem('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      if (parsed.company_name) return parsed.company_name;
    }
    return 'ALL';
  });

  // Modals state
  const [targetCandidate, setTargetCandidate] = useState(null);
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [showCompareModal, setShowCompareModal] = useState(false);
  const [showPdfModal, setShowPdfModal] = useState(false);

  // Sync activeCompany if user logs in with tenant account
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlComp = params.get('company') || params.get('org');
    if (urlComp) {
      setActiveCompany(urlComp);
    } else if (user?.company_name) {
      setActiveCompany(user.company_name);
    }
  }, [user]);

  // Check auth session validity on mount
  useEffect(() => {
    if (token) {
      fetch('/api/auth/verify', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.success) {
            handleLogout();
          } else if (data.user?.company_name) {
            setActiveCompany(data.user.company_name);
          }
        })
        .catch(() => handleLogout());
    }
  }, [token]);

  const handleLoginSuccess = (userData, authToken) => {
    setUser(userData);
    setToken(authToken);
    if (userData.company_name) {
      setActiveCompany(userData.company_name);
    }
    setActiveTab('overview');
  };

  const handleLogout = () => {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
  };

  // Open OTP Verify Modal
  const handleOpenVerifyModal = (cand) => {
    setTargetCandidate(cand);
    setShowVerifyModal(true);
  };

  // Open Comparison Modal
  const handleOpenCompareModal = (cand) => {
    setTargetCandidate(cand);
    setShowCompareModal(true);
  };

  // Open PDF Modal
  const handleOpenPdfModal = (cand) => {
    setTargetCandidate(cand);
    setShowPdfModal(true);
  };

  // Callback when candidate registration completes
  const handleRegistrationComplete = (newCandidate) => {
    setTargetCandidate(newCandidate);
    setShowVerifyModal(true);
  };

  // Callback when OTP verification succeeds
  const handleOtpVerificationSuccess = (verifiedCandidate) => {
    setShowVerifyModal(false);
    setTargetCandidate(verifiedCandidate);
    setShowCompareModal(true);
  };

  if (!token) {
    return (
      <div className="min-h-screen font-sans relative overflow-hidden">
        <div className="ambient-glow-bg">
          <div className="ambient-orb ambient-orb-1"></div>
          <div className="ambient-orb ambient-orb-2"></div>
          <div className="ambient-orb ambient-orb-3"></div>
        </div>
        <Login onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 font-sans flex relative overflow-x-hidden">
      {/* AMBIENT GLOW BACKGROUND */}
      <div className="ambient-glow-bg">
        <div className="ambient-orb ambient-orb-1"></div>
        <div className="ambient-orb ambient-orb-2"></div>
        <div className="ambient-orb ambient-orb-3"></div>
      </div>

      {/* LEFT SIDEBAR */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        user={user}
        onLogout={handleLogout}
      />

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-6 md:p-8 relative z-10 overflow-y-auto max-h-screen space-y-6">

        {(activeTab === 'overview' || activeTab === 'dashboard') && (
          <OverviewTab
            token={token}
            onNavigateToCandidates={() => setActiveTab('candidates')}
            onNavigateToCompanies={() => setActiveTab('companies')}
          />
        )}

        {activeTab === 'companies' && (
          <CompanyManagementTab token={token} />
        )}

        {activeTab === 'candidates' && (
          <CandidatesTab
            token={token}
            activeCompany={activeCompany}
            onNavigateToReg={() => setActiveTab('register_candidate')}
            onOpenVerifyModal={handleOpenVerifyModal}
            onOpenCompareModal={handleOpenCompareModal}
            onRegistrationComplete={handleRegistrationComplete}
          />
        )}

        {activeTab === 'register_candidate' && (
          <RegistrationTab
            token={token}
            activeCompany={activeCompany}
            onRegistrationComplete={(cand) => {
              handleRegistrationComplete(cand);
              setActiveTab('candidates');
            }}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsTab
            token={token}
            activeCompany={activeCompany}
          />
        )}
      </main>

      {/* MODALS */}
      {showVerifyModal && targetCandidate && (
        <OtpModal
          candidate={targetCandidate}
          token={token}
          onClose={() => setShowVerifyModal(false)}
          onSuccess={handleOtpVerificationSuccess}
        />
      )}

      {showCompareModal && targetCandidate && (
        <ComparisonModal
          candidate={targetCandidate}
          onClose={() => setShowCompareModal(false)}
          onOpenPdfModal={(cand) => {
            setShowCompareModal(false);
            handleOpenPdfModal(cand);
          }}
        />
      )}

      {showPdfModal && targetCandidate && (
        <PdfReportModal
          candidate={targetCandidate}
          onClose={() => setShowPdfModal(false)}
        />
      )}
    </div>
  );
}

export default App;
