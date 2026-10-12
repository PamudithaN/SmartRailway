// Shared online/offline signal. navigator.onLine can claim "online" on a dead connection,
// so a request that fails with no response also marks the app offline until the next success.
const listeners = new Set();
let requestFailed = false;

export const isOnline = () => navigator.onLine && !requestFailed;

const notify = () => listeners.forEach((fn) => fn(isOnline()));

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const markRequestFailed = () => {
  if (!requestFailed) {
    requestFailed = true;
    notify();
  }
};

export const markRequestSucceeded = () => {
  if (requestFailed) {
    requestFailed = false;
    notify();
  }
};

// A network error has no HTTP response (offline, DNS failure, server unreachable).
export const isOfflineError = (err) => err?.code === 'OFFLINE' || (!!err?.request && !err?.response);

export const OFFLINE_MESSAGE = "You're offline. Connect to the internet and try again.";

window.addEventListener('online', () => {
  requestFailed = false;
  notify();
});
window.addEventListener('offline', notify);
