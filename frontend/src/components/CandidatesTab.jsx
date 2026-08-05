import React from 'react';
import DashboardTab from './DashboardTab';

const CandidatesTab = ({
  token,
  activeCompany,
  onNavigateToReg,
  onOpenVerifyModal,
  onOpenCompareModal,
}) => {
  return (
    <DashboardTab
      token={token}
      activeCompany={activeCompany}
      initialStatusFilter="ALL"
      onNavigateToReg={onNavigateToReg}
      onOpenVerifyModal={onOpenVerifyModal}
      onOpenCompareModal={onOpenCompareModal}
    />
  );
};

export default CandidatesTab;
