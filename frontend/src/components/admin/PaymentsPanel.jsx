import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, errorMessage } from '../../api';

const STATUS_STYLE = {
  pending: 'bg-blue-50 text-blue-700',
  succeeded: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-slate-100 text-slate-500',
  review: 'bg-amber-50 text-amber-700',
};

const PaymentsPanel = ({ passengers }) => {
  const [topups, setTopups] = useState([]);
  const [status, setStatus] = useState('');
  const [userId, setUserId] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api.get('/api/topups', { params: { status: status || undefined, userId: userId || undefined } });
      if (res.data.success) {
        setTopups(res.data.topups);
        setError('');
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to load top-ups.'));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, userId]);

  return (
    <motion.div key="payments" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold outfit">Payments</h1>
        <p className="text-slate-500 text-sm mt-1">PayHere top-up attempts. "Review" means money was taken but not credited and needs attention.</p>
      </div>

      <div className="glass-card p-0">
        <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-slate-100">
          <select className="px-3 py-1.5 bg-white border border-slate-200 rounded-sm text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="px-3 py-1.5 bg-white border border-slate-200 rounded-sm text-sm" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All passengers</option>
            {passengers.filter((p) => p.role === 'user').map((p) => <option key={p.id} value={p.id}>{p.username}</option>)}
          </select>
          <button onClick={load} className="text-sm font-medium text-rail-blue hover:underline">Refresh</button>
        </div>
        {error && <div className="px-6 py-3 text-sm text-red-600">{error}</div>}
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr>
              <th className="px-6 py-3">#</th>
              <th className="px-6 py-3">Passenger</th>
              <th className="px-6 py-3 text-right">Amount</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3">PayHere payment</th>
              <th className="px-6 py-3 text-center">Status</th>
              <th className="px-6 py-3">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {topups.length === 0 ? (
              <tr><td colSpan="7" className="text-center py-8 text-slate-400">No top-up attempts.</td></tr>
            ) : topups.map((t) => (
              <tr key={t.id}>
                <td className="px-6 py-3 font-mono text-xs text-slate-400">{t.id}</td>
                <td className="px-6 py-3 font-semibold">{t.username}</td>
                <td className="px-6 py-3 text-right font-mono">Rs. {t.amount}</td>
                <td className="px-6 py-3 text-xs text-slate-500">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="px-6 py-3 text-xs font-mono text-slate-500">{t.paymentId || '-'}</td>
                <td className="px-6 py-3 text-center">
                  <span className={`px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                </td>
                <td className="px-6 py-3 text-xs text-slate-500">{t.failureReason || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.div>
  );
};

export default PaymentsPanel;
