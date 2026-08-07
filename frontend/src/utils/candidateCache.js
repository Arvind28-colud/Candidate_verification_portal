// Global in-memory cache for candidate full details & decoded images
const candidateCache = new Map();

export const getCachedCandidate = (id) => {
  if (!id) return null;
  return candidateCache.get(id) || candidateCache.get(String(id)) || null;
};

export const setCachedCandidate = (id, candidate) => {
  if (!id || !candidate) return;
  candidateCache.set(id, candidate);
  candidateCache.set(String(id), candidate);
  if (candidate.candidate_id) {
    candidateCache.set(candidate.candidate_id, candidate);
  }

  // Pre-decode base64 photos directly into browser GPU memory cache
  const photoSources = [
    candidate.photo_base64,
    candidate.face_photo_base64,
    candidate.aadhaar_front_base64,
    candidate.aadhaar_back_base64,
    candidate.company_logo
  ];

  photoSources.forEach((src) => {
    if (src && typeof src === 'string' && src.startsWith('data:')) {
      const img = new Image();
      img.src = src;
    }
  });
};

export const fetchAndCacheCandidate = async (cand, token) => {
  if (!cand) return cand;
  const targetId = cand.id || cand.candidate_id;
  if (!targetId) return cand;

  // Return instantly from cache if available
  const existing = getCachedCandidate(targetId);
  if (existing && (existing.photo_base64 || existing.face_photo_base64 || existing.aadhaar_front_base64)) {
    return existing;
  }

  try {
    const authToken = token || sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || localStorage.getItem('token');
    const compParam = cand.company_name ? `?company=${encodeURIComponent(cand.company_name)}` : '';
    const res = await fetch(`/api/candidate/${targetId}${compParam}`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      }
    });
    const data = await res.json();
    if (data.success && data.candidate) {
      setCachedCandidate(targetId, data.candidate);
      return data.candidate;
    }
  } catch (err) {
    console.error('Candidate prefetch error:', err);
  }
  return cand;
};

export const preloadAllCandidatePhotos = async (token, activeCompany) => {
  try {
    const authToken = token || sessionStorage.getItem('auth_token') || localStorage.getItem('auth_token') || localStorage.getItem('token');
    if (!authToken) return;

    let url = '/api/candidates/photos-batch';
    if (activeCompany && activeCompany !== 'ALL') {
      url += `?company=${encodeURIComponent(activeCompany)}`;
    }

    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      }
    });

    const data = await res.json();
    if (data.success && Array.isArray(data.photos)) {
      data.photos.forEach((p) => {
        const id = p.id || p.candidate_id;
        if (!id) return;
        const existing = getCachedCandidate(id) || {};
        const merged = {
          ...existing,
          ...p
        };
        setCachedCandidate(id, merged);
      });
    }
  } catch (err) {
    console.error('Batch photo pre-cache notice:', err);
  }
};
