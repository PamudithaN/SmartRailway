import axios from 'axios';
import { isOnline, markRequestFailed, markRequestSucceeded, isOfflineError, OFFLINE_MESSAGE } from './lib/network';
import { clearSnapshots } from './lib/offlineCache';

// Empty means same origin: the Vite dev/preview server proxies /api to the backend.
const BASE_URL = import.meta.env.VITE_API_URL || '';

export const api = axios.create({ baseURL: BASE_URL });

const FLASH_KEY = 'authMessage';

export const getToken = () => localStorage.getItem('token');

export const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
};

export const setSession = ({ token, user }) => {
  // A new sign-in: drop any other user's offline data left on this device.
  if (token) {
    clearSnapshots({ exceptUserId: user?.id });
    localStorage.setItem('token', token);
  }
  if (user) localStorage.setItem('user', JSON.stringify(user));
};

export const clearSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  clearSnapshots();
};

// One-shot message shown on the login screen after a forced sign-out.
export const takeAuthMessage = () => {
  try {
    const message = sessionStorage.getItem(FLASH_KEY);
    sessionStorage.removeItem(FLASH_KEY);
    return message || '';
  } catch {
    return '';
  }
};

api.interceptors.request.use((config) => {
  // Changes are never queued: refuse them up front while offline.
  const method = (config.method || 'get').toLowerCase();
  if (method !== 'get' && !isOnline()) {
    const error = new Error(OFFLINE_MESSAGE);
    error.code = 'OFFLINE';
    return Promise.reject(error);
  }
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 on any protected call means the session is gone (expired, revoked, deactivated).
const PUBLIC_PATHS = ['/api/login', '/api/register'];

api.interceptors.response.use(
  (response) => {
    markRequestSucceeded();
    return response;
  },
  (error) => {
    if (error.response) markRequestSucceeded();
    else if (error.code !== 'OFFLINE' && isOfflineError(error)) markRequestFailed();
    const url = error.config?.url || '';
    if (error.response?.status === 401 && !PUBLIC_PATHS.some((p) => url.startsWith(p))) {
      clearSession();
      try {
        sessionStorage.setItem(FLASH_KEY, 'Your session has expired. Please log in again.');
      } catch {
        // storage unavailable; the redirect still happens
      }
      if (window.location.pathname !== '/login') window.location.assign('/login');
    }
    return Promise.reject(error);
  }
);

// User-facing message for a failed request: the offline notice, the server's message, or a fallback.
export const errorMessage = (err, fallback) =>
  err?.code === 'OFFLINE' ? OFFLINE_MESSAGE : err?.response?.data?.message || fallback;
