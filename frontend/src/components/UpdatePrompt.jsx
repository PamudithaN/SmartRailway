import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

// Registers the service worker and offers a refresh when a new version is waiting.
// "Later" leaves it waiting; it takes over on the next launch once every window is closed.
const UpdatePrompt = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => {
        if (navigator.onLine) registration.update().catch(() => {});
      }, UPDATE_CHECK_MS);
    },
  });

  if (!needRefresh) return null;

  // workbox-window reloads once the new worker takes control, but a page opened before any worker
  // was installed is never controlled, so reload it directly.
  const refresh = () => {
    const controlled = !!navigator.serviceWorker?.controller;
    updateServiceWorker(true);
    if (!controlled) setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-4 pb-safe flex justify-center pointer-events-none">
      <div role="alert" className="pointer-events-auto w-full max-w-md bg-rail-dark text-white shadow-2xl rounded-sm p-4 flex flex-wrap items-center gap-3">
        <RefreshCw className="w-5 h-5 text-rail-blue shrink-0" />
        <span className="flex-1 text-sm font-medium min-w-[10rem]">A new version of SmartRail is available.</span>
        <div className="flex gap-2">
          <button onClick={() => setNeedRefresh(false)} className="text-sm text-slate-300 hover:text-white font-medium px-3 min-h-[44px]">Later</button>
          <button onClick={refresh} className="btn-primary text-sm px-4 min-h-[44px]">Refresh</button>
        </div>
      </div>
    </div>
  );
};

export default UpdatePrompt;
