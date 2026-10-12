import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, errorMessage } from '../../api';

const errorText = errorMessage;

const CardsDevices = ({ routes, passengers }) => {
  const [cards, setCards] = useState([]);
  const [devices, setDevices] = useState([]);
  const [events, setEvents] = useState([]);
  const [cardForm, setCardForm] = useState({ userId: '', uid: '' });
  const [deviceForm, setDeviceForm] = useState({ name: '', routeId: '', stationId: '' });
  const [message, setMessage] = useState(null);
  const [newKey, setNewKey] = useState(null); // { name, key } shown once

  const selectedRoute = routes.find((r) => String(r.id) === deviceForm.routeId);

  const load = async () => {
    try {
      const [c, d, e] = await Promise.all([
        api.get('/api/cards'),
        api.get('/api/devices'),
        api.get('/api/rfid/events'),
      ]);
      setCards(c.data.cards);
      setDevices(d.data.devices);
      setEvents(e.data.events);
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Failed to load readers and cards.') });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCard = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/cards', { userId: Number(cardForm.userId), uid: cardForm.uid });
      setCardForm({ userId: '', uid: '' });
      setMessage({ type: 'success', text: 'Card registered.' });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not register the card.') });
    }
  };

  const setCardStatus = async (card, status) => {
    try {
      await api.put(`/api/cards/${card.id}/status`, { status });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not update the card.') });
    }
  };

  const addDevice = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/api/devices', {
        name: deviceForm.name,
        routeId: Number(deviceForm.routeId),
        stationId: Number(deviceForm.stationId),
      });
      setNewKey({ name: res.data.device.name, key: res.data.key });
      setDeviceForm({ name: '', routeId: '', stationId: '' });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not create the reader.') });
    }
  };

  const setDeviceStatus = async (device, status) => {
    try {
      await api.put(`/api/devices/${device.id}/status`, { status });
      load();
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not update the reader.') });
    }
  };

  const rotateKey = async (device) => {
    if (!window.confirm(`Replace the key for ${device.name}? The old key stops working immediately.`)) return;
    try {
      const res = await api.post(`/api/devices/${device.id}/rotate-key`);
      setNewKey({ name: device.name, key: res.data.key });
    } catch (err) {
      setMessage({ type: 'error', text: errorText(err, 'Could not rotate the key.') });
    }
  };

  return (
    <motion.div key="cards" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold outfit">Readers & Cards</h1>
        <p className="text-slate-500 text-sm mt-1">Register physical Cards to Passengers and authorise reader devices. Each reader is fixed to one Route and Station.</p>
      </div>

      {message && (
        <div className={`p-3 text-sm font-medium border-l-2 ${message.type === 'error' ? 'bg-red-50 text-red-600 border-red-500' : 'bg-green-50 text-green-600 border-green-500'}`}>
          {message.text}
        </div>
      )}

      {newKey && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-sm text-sm space-y-2">
          <p className="font-semibold text-amber-800">Device key for {newKey.name} (shown once, copy it now)</p>
          <code className="block break-all bg-white border border-amber-200 p-2 text-xs">{newKey.key}</code>
          <button onClick={() => setNewKey(null)} className="text-xs font-bold uppercase tracking-widest text-amber-800 hover:underline">I have saved it</button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="glass-card space-y-4">
          <h3 className="font-bold outfit">Cards</h3>
          <form onSubmit={addCard} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select required className="input-field" value={cardForm.userId} onChange={(e) => setCardForm({ ...cardForm, userId: e.target.value })}>
              <option value="">Passenger</option>
              {passengers.filter((p) => p.role === 'user' && p.status !== 'deleted').map((p) => (
                <option key={p.id} value={p.id}>{p.username}</option>
              ))}
            </select>
            <input required placeholder="Card UID (hex)" className="input-field font-mono" value={cardForm.uid} onChange={(e) => setCardForm({ ...cardForm, uid: e.target.value })} />
            <button type="submit" className="btn-primary py-2 text-sm">Register</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                <tr><th className="px-4 py-2">UID</th><th className="px-4 py-2">Passenger</th><th className="px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {cards.length === 0 ? (
                  <tr><td colSpan="4" className="text-center py-6 text-slate-400">No cards registered.</td></tr>
                ) : cards.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono text-xs">{c.uid}</td>
                    <td className="px-4 py-2">{c.username}</td>
                    <td className="px-4 py-2 text-xs uppercase font-bold tracking-widest">{c.status}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setCardStatus(c, c.status === 'active' ? 'blocked' : 'active')} className="text-xs font-medium text-rail-blue hover:underline">
                        {c.status === 'active' ? 'Block' : 'Unblock'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-card space-y-4">
          <h3 className="font-bold outfit">Reader devices</h3>
          <form onSubmit={addDevice} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input required placeholder="Device name" className="input-field" value={deviceForm.name} onChange={(e) => setDeviceForm({ ...deviceForm, name: e.target.value })} />
            <select required className="input-field" value={deviceForm.routeId} onChange={(e) => setDeviceForm({ ...deviceForm, routeId: e.target.value, stationId: '' })}>
              <option value="">Route</option>
              {routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <select required className="input-field" value={deviceForm.stationId} disabled={!selectedRoute} onChange={(e) => setDeviceForm({ ...deviceForm, stationId: e.target.value })}>
              <option value="">Station</option>
              {selectedRoute?.stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button type="submit" className="btn-primary py-2 text-sm">Create reader</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Route / Station</th><th className="px-4 py-2">Last seen</th><th className="px-4 py-2">Status</th><th className="px-4 py-2"></th></tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {devices.length === 0 ? (
                  <tr><td colSpan="5" className="text-center py-6 text-slate-400">No readers yet.</td></tr>
                ) : devices.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2 font-semibold">{d.name}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{d.routeName} / {d.stationName}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}</td>
                    <td className="px-4 py-2 text-xs uppercase font-bold tracking-widest">{d.status}</td>
                    <td className="px-4 py-2 text-right space-x-3">
                      <button onClick={() => setDeviceStatus(d, d.status === 'active' ? 'disabled' : 'active')} className="text-xs font-medium text-rail-blue hover:underline">
                        {d.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => rotateKey(d)} className="text-xs font-medium text-slate-500 hover:underline">New key</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="glass-card p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-slate-100">
          <h3 className="font-bold outfit">Rejected taps</h3>
          <button onClick={load} className="text-sm font-medium text-rail-blue hover:underline">Refresh</button>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
            <tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">Reader</th><th className="px-6 py-3">Card UID</th><th className="px-6 py-3">Reason</th><th className="px-6 py-3">HTTP</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {events.length === 0 ? (
              <tr><td colSpan="5" className="text-center py-8 text-slate-400">No rejected taps.</td></tr>
            ) : events.map((e) => (
              <tr key={e.id}>
                <td className="px-6 py-3 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="px-6 py-3">{e.deviceName || '-'}</td>
                <td className="px-6 py-3 font-mono text-xs">{e.cardUid || '-'}</td>
                <td className="px-6 py-3 text-xs">{e.outcome}</td>
                <td className="px-6 py-3 font-mono text-xs">{e.httpStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.div>
  );
};

export default CardsDevices;
