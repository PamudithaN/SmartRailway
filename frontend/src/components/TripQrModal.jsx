import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { CheckCircle2, X } from 'lucide-react';

// Shown after the Passenger ends a trip: the QR code the Station Master scans at the destination.
const TripQrModal = ({ trip, onClose }) => (
  <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4" onClick={onClose}>
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm p-6 text-center modal-max-h overflow-y-auto"
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 size={18} />
          <span className="text-xs font-bold uppercase tracking-widest">Paid · Rs. {trip.fare}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-900 p-1 -m-1">
          <X size={18} />
        </button>
      </div>

      <h2 className="text-lg font-bold outfit text-slate-900 mt-4">Show this QR to the Station Master</h2>
      <p className="text-xs text-slate-500 mt-1">
        {trip.routeName}{trip.startStation ? ` · from ${trip.startStation}` : ''}
      </p>

      <div className="mt-5 inline-block p-3 bg-white border border-slate-200 rounded">
        <QRCodeSVG value={trip.qrToken} size={208} level="M" />
      </div>

      <p className="text-[10px] text-slate-400 font-mono mt-4 break-all">{trip.qrToken}</p>
    </div>
  </div>
);

export default TripQrModal;
