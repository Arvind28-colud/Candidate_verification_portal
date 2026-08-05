import * as XLSX from 'xlsx';

export const exportCandidatesToExcel = (candidates_list = [], statusFilter = 'ALL') => {
  if (!candidates_list || candidates_list.length === 0) {
    alert('No candidate records available to export.');
    return;
  }

  let filtered = [...candidates_list];
  const filterUpper = (statusFilter || 'ALL').toUpperCase();

  if (filterUpper === 'COMPLETED' || filterUpper === 'VERIFIED') {
    filtered = candidates_list.filter((c) => c.verification_status === 'VERIFIED');
  } else if (filterUpper === 'PENDING') {
    filtered = candidates_list.filter((c) => c.verification_status !== 'VERIFIED' && (c.face_match_status !== 'MISMATCH' && c.face_match_status !== 'FAILED'));
  } else if (filterUpper === 'FAILED') {
    filtered = candidates_list.filter((c) => c.face_match_status === 'MISMATCH' || c.face_match_status === 'FAILED');
  }

  if (filtered.length === 0) {
    alert(`No candidate records found matching status filter: "${statusFilter}".`);
    return;
  }

  const exportRows = filtered.map((c, index) => {
    const isVerified = c.verification_status === 'VERIFIED';
    return {
      'S.No': index + 1,
      'Candidate ID': c.candidate_id || '',
      'Full Name': c.full_name || '',
      'Company Name': c.company_name || '',
      'Mobile Phone': c.phone || '',
      'Email Address': c.email || '',
      'Aadhaar Number': c.aadhaar_number ? `'${c.aadhaar_number}` : '',
      'Designation': c.reg_designation || '',
      'Registered Father Name': c.reg_father_name || c.father_name || '',
      'Registered DOB': c.reg_dob || '',
      'Registered Gender': c.reg_gender || '',
      'Registered Address': c.reg_address || '',
      'Verification Status': isVerified ? 'COMPLETED (VERIFIED)' : (c.face_match_status === 'MISMATCH' ? 'FAILED' : 'PENDING'),
      'Verified Name (UIDAI)': c.verified_name || '',
      'Verified Father Name': c.verified_father_name || '',
      'Verified DOB': c.verified_dob || '',
      'Verified Gender': c.verified_gender || '',
      'Verified Address': c.verified_address || '',
      'Face Match Status': c.face_match_status || (isVerified ? 'MATCH' : 'PENDING'),
      'Face Similarity Score (%)': c.face_match_score ? `${c.face_match_score}%` : '-',
      'Registration Date': c.created_at ? new Date(c.created_at).toLocaleString('en-IN') : '',
      'Verified Date': c.verified_at ? new Date(c.verified_at).toLocaleString('en-IN') : '',
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(exportRows);

  // Set column widths
  const colWidths = [
    { wch: 6 },  // S.No
    { wch: 14 }, // Candidate ID
    { wch: 24 }, // Full Name
    { wch: 25 }, // Company Name
    { wch: 15 }, // Mobile Phone
    { wch: 28 }, // Email Address
    { wch: 18 }, // Aadhaar Number
    { wch: 20 }, // Designation
    { wch: 24 }, // Reg Father Name
    { wch: 14 }, // Reg DOB
    { wch: 12 }, // Reg Gender
    { wch: 30 }, // Reg Address
    { wch: 22 }, // Verification Status
    { wch: 24 }, // Verified Name
    { wch: 24 }, // Verified Father Name
    { wch: 14 }, // Verified DOB
    { wch: 12 }, // Verified Gender
    { wch: 35 }, // Verified Address
    { wch: 18 }, // Face Match Status
    { wch: 20 }, // Face Similarity Score
    { wch: 16 }, // Card OCR Status
    { wch: 22 }, // Registration Date
    { wch: 22 }, // Verified Date
  ];
  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Candidates Report');

  const todayStr = new Date().toISOString().slice(0, 10);
  const fileName = `Candidates_${statusFilter.toUpperCase()}_Report_${todayStr}.xlsx`;
  XLSX.writeFile(workbook, fileName);
};
