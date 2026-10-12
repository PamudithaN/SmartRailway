import React from 'react';
import { WifiOff } from 'lucide-react';

const formatTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

// Shown while offline. With savedAt, makes clear the data on screen is last-known, not live.
const OfflineBanner = ({ savedAt, message }) => {
  const when = formatTime(savedAt);
  return (
    <div role="status" className="mb-6 p-3 border-l-2 border-amber-500 bg-amber-50 text-amber-800 text-sm font-medium flex items-start gap-3">
      <WifiOff className="w-4 h-4 mt-0.5 shrink-0" />
      <span>
        {message || "You're offline."}{' '}
        {when ? `Showing data last updated ${when}.` : !message && 'Live data will load when you reconnect.'}
      </span>
    </div>
  );
};

export default OfflineBanner;
