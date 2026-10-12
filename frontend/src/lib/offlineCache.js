// Last-known Passenger data for offline viewing only; never the source of truth.
// One localStorage key per user. Contact details (NIC, email, phone) are never stored here.
const PREFIX = 'offline:';

const keyFor = (userId) => `${PREFIX}${userId}`;

export const loadSnapshot = (userId) => {
  if (!userId) return null;
  try {
    return JSON.parse(localStorage.getItem(keyFor(userId)));
  } catch {
    return null;
  }
};

export const saveSnapshot = (userId, slice, data) => {
  if (!userId) return;
  try {
    const current = loadSnapshot(userId) || {};
    localStorage.setItem(keyFor(userId), JSON.stringify({ ...current, [slice]: data, savedAt: new Date().toISOString() }));
  } catch {
    // storage full or unavailable; offline view just has less to show
  }
};

export const clearSnapshots = ({ exceptUserId } = {}) => {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX) && k !== keyFor(exceptUserId))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // storage unavailable
  }
};
