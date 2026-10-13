import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { TrainFront, LogOut, ScanLine, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { api, getStoredUser, clearSession, errorMessage } from '../api';

const SCANNER_ID = 'qr-reader';

const formatDuration = (from, to) => {
  const minutes = Math.max(0, Math.round((new Date(to) - new Date(from)) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

// Redraws the photo at a smaller size on a white background; full-size phone photos often defeat the decoder.
const resizeImage = async (file, maxSide) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { blob, canvas };
};

// Tries the browser's native detector first, then the bundled decoder at several image sizes.
const decodePhoto = async (file) => {
  const sizes = [1000, 600, 1600, 400];

  if ('BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      for (const size of sizes) {
        const { canvas } = await resizeImage(file, size);
        const found = await detector.detect(canvas);
        if (found[0]?.rawValue) return found[0].rawValue;
      }
    } catch {
      // fall through to the bundled decoder
    }
  }

  const reader = new Html5Qrcode('qr-file-reader');
  try {
    for (const size of sizes) {
      try {
        const { blob } = await resizeImage(file, size);
        return await reader.scanFile(new File([blob], 'qr.png', { type: 'image/png' }), false);
      } catch {
        // try the next size
      }
    }
  } finally {
    try { reader.clear(); } catch { /* nothing to clear */ }
  }
  throw new Error('No QR code found');
};

const Row = ({ label, children }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-slate-100 text-sm">
    <span className="text-slate-500">{label}</span>
    <span className="font-semibold text-slate-900 text-right break-words">{children}</span>
  </div>
);

const StationMaster = () => {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [result, setResult] = useState(null); // { trip, alreadyScanned } | { error }
  const scannerRef = useRef(null);
  const busyRef = useRef(false);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
      scanner.clear();
    } catch {
      // already stopped
    }
  }, []);

  const verify = useCallback(async (token) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    await stopScanner();
    setScanning(false);
    try {
      const res = await api.post('/api/trips/scan', { token });
      setResult({ trip: res.data.trip, alreadyScanned: res.data.alreadyScanned });
    } catch (err) {
      setResult({ error: errorMessage(err, 'Could not verify the QR code.') });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [stopScanner]);

  const startScanner = async () => {
    setResult(null);
    setScanning(true);
  };

  // The scanner element only exists once `scanning` is true.
  useEffect(() => {
    if (!scanning) return undefined;
    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => verify(text.trim()),
        () => {}
      )
      .catch((err) => {
        scannerRef.current = null;
        setScanning(false);
        const name = err?.name || String(err);
        let text = 'Could not open the camera. Use "Take photo of QR" below, or enter the code manually.';
        if (!window.isSecureContext) {
          text = 'The camera needs a secure (HTTPS) connection, and this page is on plain HTTP. Use "Take photo of QR" below, or open the site over HTTPS (e.g. the ngrok link).';
        } else if (/NotAllowed|Permission/i.test(name)) {
          text = 'Camera permission was denied. Allow camera access for this site in the browser settings, then try again.';
        } else if (/NotFound|Devices/i.test(name)) {
          text = 'No camera was found on this device.';
        } else if (/NotReadable|Abort/i.test(name)) {
          text = 'The camera is in use by another app. Close it and try again.';
        }
        setResult({ error: text });
      });
    return () => { stopScanner(); };
  }, [scanning, verify, stopScanner]);

  // Works without live camera access (e.g. over HTTP): the phone's camera app takes a photo, which is decoded here.
  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      verify((await decodePhoto(file)).trim());
    } catch {
      setResult({ error: 'No QR code found in that photo. Hold the phone steady, fill the frame, and try again.' });
    }
  };

  const handleManual = (e) => {
    e.preventDefault();
    if (manual.trim()) verify(manual.trim());
  };

  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 pt-safe">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <TrainFront className="text-rail-blue w-6 h-6" />
            <span className="font-outfit font-bold text-lg tracking-tight">SmartRail Station</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500 hidden sm:block">{user?.username}</span>
            <button onClick={handleLogout} aria-label="Sign out" className="text-slate-400 hover:text-rail-red flex items-center gap-2 text-sm font-medium p-2.5 sm:p-0">
              <LogOut size={16} />
              <span className="hidden sm:block">Sign Out</span>
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 w-full max-w-lg mx-auto p-4 md:p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold outfit text-slate-900">Verify Passenger Trip</h1>
          <p className="text-slate-500 mt-1 text-sm">Scan the QR code the Passenger shows after ending their trip.</p>
        </header>

        {scanning ? (
          <div className="glass-card">
            <div id={SCANNER_ID} className="w-full overflow-hidden rounded" />
            <button onClick={async () => { await stopScanner(); setScanning(false); }} className="w-full mt-4 text-sm font-medium text-slate-500 hover:text-slate-900 min-h-[44px]">
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={startScanner}
            disabled={busy}
            className="btn-primary w-full py-3 min-h-[48px] flex justify-center items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ScanLine size={18} />}
            {busy ? 'Verifying...' : 'Scan QR Code'}
          </button>
        )}

        <label className={`block text-center text-sm font-medium text-rail-blue border border-slate-200 bg-white rounded-sm py-3 min-h-[44px] cursor-pointer hover:border-rail-blue ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          Take photo of QR
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="hidden" />
        </label>
        <div id="qr-file-reader" className="hidden" />

        {result?.error && (
          <div className="glass-card border-red-300">
            <div className="flex items-start gap-3 text-red-600">
              <XCircle className="shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-bold">Verification failed</p>
                <p className="text-sm mt-1">{result.error}</p>
              </div>
            </div>
          </div>
        )}

        {result?.trip && (
          <div className={`glass-card ${result.alreadyScanned ? 'border-amber-300' : 'border-green-300'}`}>
            <div className={`flex items-center gap-3 ${result.alreadyScanned ? 'text-amber-600' : 'text-green-600'}`}>
              {result.alreadyScanned ? <AlertTriangle size={24} /> : <CheckCircle2 size={24} />}
              <div>
                <p className="font-bold text-lg outfit">{result.alreadyScanned ? 'Already verified' : 'Payment done'}</p>
                {result.alreadyScanned && (
                  <p className="text-xs">Scanned {new Date(result.trip.scannedAt).toLocaleString()}</p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <Row label="Amount paid">Rs. {result.trip.fare}</Row>
              <Row label="Passenger">{result.trip.fullName || result.trip.username}</Row>
              <Row label="Passenger ID">SR-{String(result.trip.userId ?? '').padStart(4, '0')}</Row>
              <Row label="Route">{result.trip.routeName}</Row>
              <Row label="Boarded at">{result.trip.startStation}</Row>
              <Row label="Trip started">{new Date(result.trip.startedAt).toLocaleString()}</Row>
              <Row label="Trip ended">{new Date(result.trip.endedAt).toLocaleString()}</Row>
              <Row label="Duration">{formatDuration(result.trip.startedAt, result.trip.endedAt)}</Row>
              <Row label="Receipt">TXN-{result.trip.transactionId ?? '—'}</Row>
            </div>
          </div>
        )}

        <form onSubmit={handleManual} className="glass-card space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Or enter the code manually</p>
          <input
            type="text" value={manual} onChange={(e) => setManual(e.target.value)}
            placeholder="QR code text" className="input-field py-2.5 text-sm font-mono"
          />
          <button type="submit" disabled={busy || !manual.trim()} className="btn-primary w-full py-2.5 min-h-[44px] disabled:opacity-50">
            Verify
          </button>
        </form>
      </main>
    </div>
  );
};

export default StationMaster;
