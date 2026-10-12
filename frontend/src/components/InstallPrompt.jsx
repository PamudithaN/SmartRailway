import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

const DISMISS_KEY = 'installDismissedAt';
const DISMISS_DAYS = 14;

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIos = () => /iphone|ipad|ipod/i.test(window.navigator.userAgent);

const recentlyDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
};

// The browser's install event fires once per page load, possibly before this component mounts.
let deferredPrompt = null;
const promptListeners = new Set();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  promptListeners.forEach((fn) => fn(e));
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  promptListeners.forEach((fn) => fn(null));
});

// "Install SmartRail" offer: the browser prompt where supported, Add to Home Screen steps on iOS.
const InstallPrompt = ({ className = '' }) => {
  const [promptEvent, setPromptEvent] = useState(deferredPrompt);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());

  useEffect(() => {
    promptListeners.add(setPromptEvent);
    return () => promptListeners.delete(setPromptEvent);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // storage unavailable; hide for this visit only
    }
    setHidden(true);
  };

  const install = async () => {
    if (!promptEvent) return;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
    deferredPrompt = null;
    setPromptEvent(null);
    if (outcome !== 'accepted') dismiss();
  };

  if (hidden) return null;
  const ios = !promptEvent && isIos();
  if (!promptEvent && !ios) return null;

  return (
    <div className={`bg-white border border-slate-200 shadow-sm rounded-sm p-3 flex items-center gap-3 text-sm ${className}`}>
      {ios ? <Share className="w-5 h-5 text-rail-blue shrink-0" /> : <Download className="w-5 h-5 text-rail-blue shrink-0" />}
      <span className="flex-1 text-slate-700">
        {ios ? <>Install SmartRail: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</> : 'Install SmartRail on this device for quick access.'}
      </span>
      {!ios && (
        <button onClick={install} className="btn-primary text-sm px-4 py-2 min-h-[44px] sm:min-h-0">Install</button>
      )}
      <button onClick={dismiss} aria-label="Dismiss install offer" className="p-2.5 text-slate-400 hover:text-slate-700">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

export default InstallPrompt;
