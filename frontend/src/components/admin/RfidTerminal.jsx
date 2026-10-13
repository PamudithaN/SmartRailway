import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Ban } from 'lucide-react';
import { api, errorMessage } from '../../api';

const STATUS_STYLE = {
  open: 'bg-blue-50 text-blue-700',
  ended: 'bg-amber-50 text-amber-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const RfidTerminal = ({ routes, onTapDone }) => {
  const [form, setForm] = useState({ userId: '', routeId: '', stationId: '', action: 'start' });
  const [status, setStatus] = useState(null);
  const [trips, setTrips] = useState([]);
  const [tripFilter, setTripFilter] = useState('open');

  const activeRoutes = routes.filter((r) => r.status === 'active');
  const selectedRoute = routes.find((r) => String(r.id) === form.routeId);

  const loadTrips = async () => {
    try {
      const res = await api.get('/api/trips', { params: { status: tripFilter } });
      if (res.data.success) setTrips(res.data.trips);
    } catch (e) {
      console.error('Failed to fetch trips');
    }
  };

  useEffect(() => {
    loadTrips();
  }, [tripFilter]);

  const handleTap = async (e) => {
    e.preventDefault();
    setStatus({ loading: true });
    try {
      const res = await api.post('/api/rfid/tap', {
        userId: form.userId,
        routeId: Number(form.routeId),
        stationId: Number(form.stationId),
        action: form.action,
      });
      const fare = res.data.trip?.fare;
      setStatus({
        type: 'success',
        msg: form.action === 'start'
          ? `Trip started. Fare of Rs.${fare} will be charged at the end tap.`
          : `Trip completed. Rs.${fare} debited. New balance Rs.${res.data.newBalance}.`,
      });
      onTapDone();
      loadTrips();
    } catch (err) {
      setStatus({ type: 'error', msg: errorMessage(err, 'Error processing RFID tap') });
    }
  };

  const cancelTrip = async (trip) => {
    const reason = window.prompt(`Cancel ${trip.username}'s open trip on ${trip.routeName}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    try {
      await api.put(`/api/trips/${trip.id}/cancel`, { reason });
      loadTrips();
    } catch (err) {
      alert(errorMessage(err, 'Failed to cancel trip.'));
    }
  };

  return (
    <motion.div key="rfid" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold outfit">RFID Terminal Emulator</h1>
        <p className="text-slate-500 text-sm mt-1">Simulate a Card tap at the start or end of a trip. The Route's fixed Fare is charged at the end tap.</p>
      </div>

      <div className="glass-card max-w-2xl">
        <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
          <div className="w-12 h-12 bg-slate-900 rounded-sm flex items-center justify-center text-white"><Zap className="w-6 h-6" /></div>
          <div>
            <h3 className="font-bold outfit text-lg">Station Module</h3>
            <p className="text-xs text-slate-400 font-mono">ID: TERM-FORT-01</p>
          </div>
        </div>

        <form onSubmit={handleTap} className="space-y-4">
          {status && (
            <div className={`p-3 text-sm font-medium border-l-2 ${status.type === 'error' ? 'bg-red-50 text-red-600 border-red-500' : 'bg-green-50 text-green-600 border-green-500'}`}>
              {status.loading ? 'Scanning via hardware...' : status.msg}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Passenger ID (Integer)</label>
              <input type="number" inputMode="numeric" required placeholder="e.g. 1" className="input-field" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Tap type</label>
              <select className="input-field" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                <option value="start">Start of trip</option>
                <option value="end">End of trip</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Route</label>
              <select required className="input-field" value={form.routeId} onChange={(e) => setForm({ ...form, routeId: e.target.value, stationId: '' })}>
                <option value="">Select Route</option>
                {(form.action === 'start' ? activeRoutes : routes).map((r) => (
                  <option key={r.id} value={r.id}>{r.name} (Rs. {r.fare})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-slate-500 mb-1 block">Station</label>
              <select required className="input-field" value={form.stationId} disabled={!selectedRoute} onChange={(e) => setForm({ ...form, stationId: e.target.value })}>
                <option value="">Select Station</option>
                {selectedRoute?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <button type="submit" className="w-full bg-slate-900 hover:bg-rail-blue text-white font-bold py-3 rounded-sm transition-colors uppercase tracking-widest text-sm flex justify-center items-center gap-2">
            Simulate Smart Card Tap
          </button>
        </form>
      </div>

      <div className="glass-card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold outfit">Trips</h3>
          <select className="px-3 py-1.5 bg-white border border-slate-200 rounded-sm text-sm" value={tripFilter} onChange={(e) => setTripFilter(e.target.value)}>
            <option value="open">Open</option>
            <option value="ended">Ended (awaiting scan)</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">Passenger</th>
              <th className="px-6 py-3">Route</th>
              <th className="px-6 py-3">From → To</th>
              <th className="px-6 py-3 text-right">Fare</th>
              <th className="px-6 py-3">Started</th>
              <th className="px-6 py-3">Source</th>
              <th className="px-6 py-3 text-center">Status</th>
              <th className="px-6 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {trips.length === 0 ? (
              <tr><td colSpan="8" className="text-center py-8 text-slate-400">No {tripFilter} trips.</td></tr>
            ) : trips.map((t) => (
              <tr key={t.id}>
                <td className="px-6 py-3 font-semibold">{t.username} <span className="text-xs text-slate-400 font-mono">#{t.userId}</span></td>
                <td className="px-6 py-3">{t.routeName}</td>
                <td className="px-6 py-3 text-slate-500">{t.startStation} → {t.endStation || '...'}</td>
                <td className="px-6 py-3 text-right font-mono">Rs. {t.fare}</td>
                <td className="px-6 py-3 text-xs text-slate-500">{new Date(t.startedAt).toLocaleString()}</td>
                <td className="px-6 py-3 text-[10px] uppercase font-bold tracking-widest text-slate-400" title="Start / end tap source">{t.startSource}{t.endSource ? ` / ${t.endSource}` : ''}</td>
                <td className="px-6 py-3 text-center">
                  <span className={`px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest ${STATUS_STYLE[t.status]}`} title={t.cancelReason || ''}>{t.status}</span>
                </td>
                <td className="px-6 py-3 text-right">
                  {t.status === 'open' && (
                    <button title="Cancel trip" onClick={() => cancelTrip(t)} className="text-slate-400 hover:text-rail-red"><Ban size={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.div>
  );
};

export default RfidTerminal;
