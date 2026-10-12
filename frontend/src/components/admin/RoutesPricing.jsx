import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Map, Plus, Edit3, X, ArrowUp, ArrowDown, History, Power } from 'lucide-react';
import { api, errorMessage } from '../../api';

const emptyForm = { name: '', fare: '', stations: ['', ''], status: 'active' };

const describeChange = (h) => {
  const parts = [];
  const n = h.newValues || {};
  const o = h.oldValues || {};
  if (h.action === 'create') return `Created with fare Rs. ${n.fare} and ${n.stations?.length ?? 0} Stations`;
  if (n.name !== undefined) parts.push(`name "${o.name}" → "${n.name}"`);
  if (n.fare !== undefined) parts.push(`fare Rs. ${o.fare} → Rs. ${n.fare}`);
  if (n.status !== undefined) parts.push(`status ${o.status} → ${n.status}`);
  if (n.stations !== undefined) parts.push(`stations ${o.stations.join(' → ')}  ⇒  ${n.stations.join(' → ')}`);
  return parts.join('; ') || 'No change';
};

const RoutesPricing = ({ routes, onReload }) => {
  const [modal, setModal] = useState(null); // { route? }
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  const loadHistory = async () => {
    try {
      const res = await api.get('/api/routes/history');
      if (res.data.success) setHistory(res.data.history);
    } catch (e) {
      console.error('Failed to fetch route history');
    }
  };

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory]);

  const openModal = (route = null) => {
    setModal({ route });
    setError('');
    setForm(
      route
        ? { name: route.name, fare: String(route.fare), status: route.status, stations: route.stations.map((s) => s.name) }
        : emptyForm
    );
  };

  const setStation = (i, value) => setForm({ ...form, stations: form.stations.map((s, idx) => (idx === i ? value : s)) });
  const moveStation = (i, dir) => {
    const next = [...form.stations];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setForm({ ...form, stations: next });
  };
  const removeStation = (i) => setForm({ ...form, stations: form.stations.filter((_, idx) => idx !== i) });

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name,
        fare: form.fare,
        stations: form.stations.map((s) => s.trim()),
      };
      if (modal.route) {
        await api.put(`/api/routes/${modal.route.id}`, { ...body, status: form.status, version: modal.route.version });
      } else {
        await api.post('/api/routes', body);
      }
      setModal(null);
      onReload();
      if (showHistory) loadHistory();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the Route.'));
      if (err.response?.status === 409) onReload();
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (route) => {
    const next = route.status === 'active' ? 'inactive' : 'active';
    const verb = next === 'inactive' ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${route.name}?${next === 'inactive' ? ' New trips cannot start on it.' : ''}`)) return;
    try {
      await api.put(`/api/routes/${route.id}`, { status: next, version: route.version });
      onReload();
      if (showHistory) loadHistory();
    } catch (err) {
      alert(errorMessage(err, `Failed to ${verb.toLowerCase()} Route.`));
      onReload();
    }
  };

  return (
    <motion.div key="routes" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold outfit">Routes & Pricing</h1>
          <p className="text-slate-500 text-sm mt-1">Manage Routes, their Stations and the fixed trip Fare charged per trip.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setShowHistory(!showHistory)} className="border border-slate-200 text-slate-600 hover:bg-slate-100 font-bold py-2 px-4 rounded-sm text-xs uppercase tracking-widest flex items-center gap-2">
            <History size={14} /> Change History
          </button>
          <button onClick={() => openModal()} className="btn-primary py-2 px-4 text-xs flex items-center gap-2">
            <Plus size={14} /> New Route
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="glass-card">
          <h3 className="font-bold outfit mb-4">Recent Route & Fare changes</h3>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No changes recorded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {history.map((h) => (
                <li key={h.id} className="py-2 flex flex-col md:flex-row md:justify-between gap-1">
                  <span><span className="font-semibold">{h.routeName}</span> · {describeChange(h)}</span>
                  <span className="text-xs text-slate-400 font-mono">{h.admin || 'unknown'} · {h.date}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {routes.map((r) => (
          <div key={r.id} className={`glass-card relative overflow-hidden ${r.status === 'inactive' ? 'opacity-70' : ''}`}>
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest">ID: LK-R{r.id.toString().padStart(2, '0')}</span>
                  <span className={`px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest ${r.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                    {r.status === 'active' ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <h3 className="text-xl font-bold outfit">{r.name}</h3>
              </div>
              <div className="w-10 h-10 rounded-sm bg-rail-blue/5 flex items-center justify-center text-rail-blue"><Map className="w-5 h-5" /></div>
            </div>

            <p className="text-sm font-mono text-slate-500 mb-4">
              {r.stations.length === 0 ? 'No Stations yet - edit to add them.' : r.stations.map((s) => s.name).join(' → ')}
            </p>

            <div className="flex items-end justify-between bg-slate-50 p-4 rounded-sm border border-slate-100">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Fixed trip Fare</p>
                <p className="text-2xl font-bold outfit text-rail-blue">Rs. {r.fare}</p>
              </div>
              <div className="flex gap-3 text-slate-500">
                <button title="Edit" onClick={() => openModal(r)} className="hover:text-rail-blue"><Edit3 size={16} /></button>
                <button title={r.status === 'active' ? 'Deactivate' : 'Reactivate'} onClick={() => toggleStatus(r)} className="hover:text-rail-red"><Power size={16} /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4" onClick={() => setModal(null)}>
          <form onSubmit={handleSave} onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-md p-6 space-y-4 modal-max-h overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold outfit text-slate-900">{modal.route ? `Edit ${modal.route.name}` : 'New Route'}</h2>
              <button type="button" onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-900"><X size={18} /></button>
            </div>
            {error && <div className="p-2 bg-red-50 border-l-2 border-red-500 text-red-600 text-xs font-medium">{error}</div>}

            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Route name</label>
              <input type="text" required className="input-field py-2.5 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Fixed trip Fare (Rs)</label>
              <input type="number" inputMode="decimal" required min="0" step="0.01" className="input-field py-2.5 text-sm" value={form.fare} onChange={(e) => setForm({ ...form, fare: e.target.value })} />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1 block">Stations (in order)</label>
              <div className="space-y-2">
                {form.stations.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400 w-5">{i + 1}</span>
                    <input type="text" required placeholder="Station name" className="input-field py-2 text-sm flex-1" value={s} onChange={(e) => setStation(i, e.target.value)} />
                    <button type="button" title="Move up" onClick={() => moveStation(i, -1)} disabled={i === 0} className="text-slate-400 hover:text-slate-900 disabled:opacity-30"><ArrowUp size={16} /></button>
                    <button type="button" title="Move down" onClick={() => moveStation(i, 1)} disabled={i === form.stations.length - 1} className="text-slate-400 hover:text-slate-900 disabled:opacity-30"><ArrowDown size={16} /></button>
                    <button type="button" title="Remove" onClick={() => removeStation(i)} disabled={form.stations.length <= 2} className="text-slate-400 hover:text-rail-red disabled:opacity-30"><X size={16} /></button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setForm({ ...form, stations: [...form.stations, ''] })} className="mt-3 text-xs font-bold uppercase tracking-widest text-rail-blue hover:underline flex items-center gap-1">
                <Plus size={12} /> Add Station
              </button>
            </div>

            <div className="flex flex-wrap gap-3 justify-end">
              <button type="button" onClick={() => setModal(null)} className="text-sm text-slate-500 hover:text-slate-900 font-medium px-3">Cancel</button>
              <button type="submit" disabled={saving} className="btn-primary py-2 px-4 text-sm">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </motion.div>
  );
};

export default RoutesPricing;
