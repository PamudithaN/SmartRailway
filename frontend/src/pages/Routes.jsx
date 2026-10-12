import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TrainTrack, ArrowLeft, MapPin, Radio, WifiOff } from 'lucide-react';
import { api, getStoredUser } from '../api';
import OfflineBanner from '../components/OfflineBanner';
import { useSessionStatus } from '../components/RequireAuth';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { isOfflineError } from '../lib/network';
import { loadSnapshot, saveSnapshot } from '../lib/offlineCache';

const POLL_MS = 10000;

const STATUS_LABEL = { running: 'Running', stopped: 'Stopped', no_signal: 'No signal' };
const STATUS_STYLE = {
  running: 'bg-green-50 text-green-700',
  stopped: 'bg-blue-50 text-blue-700',
  no_signal: 'bg-slate-100 text-slate-500',
};

const Routes = () => {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState([]);
  const [trains, setTrains] = useState([]);
  const [loadingTrains, setLoadingTrains] = useState(true);
  const [filter, setFilter] = useState('All');
  const [savedAt, setSavedAt] = useState(null);
  const online = useOnlineStatus();
  const sessionStatus = useSessionStatus();
  const offline = !online || sessionStatus === 'offline';

  // Only a Passenger's view of Routes and Fares is kept for offline use; Admin data is never cached.
  const passengerId = () => {
    const user = getStoredUser();
    return user?.role === 'user' ? user.id : null;
  };

  const showSnapshot = () => {
    const snapshot = loadSnapshot(passengerId());
    if (snapshot?.routes) {
      setRoutes(snapshot.routes);
      setSavedAt(snapshot.savedAt);
    }
  };

  useEffect(() => {
    let cancelled = false;

    // Offline: last-known Routes, and no train positions (stale positions must never look live).
    if (offline) {
      showSnapshot();
      setTrains([]);
      setLoadingTrains(false);
      return undefined;
    }

    const loadRoutes = async () => {
      try {
        const res = await api.get('/api/routes');
        if (!cancelled && res.data.success) {
          setRoutes(res.data.routes);
          setSavedAt(null);
          saveSnapshot(passengerId(), 'routes', res.data.routes);
        }
      } catch (e) {
        if (isOfflineError(e)) showSnapshot();
        else console.error('Failed to fetch routes');
      }
    };

    const loadTrains = async () => {
      try {
        const res = await api.get('/api/trains');
        if (!cancelled && res.data.success) setTrains(res.data.trains);
      } catch (e) {
        if (!isOfflineError(e)) console.error('Failed to fetch trains');
      } finally {
        if (!cancelled) setLoadingTrains(false);
      }
    };

    loadRoutes();
    loadTrains();
    const interval = setInterval(loadTrains, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  const filteredTrains = filter === 'All' ? trains : trains.filter((t) => t.routeName === filter);

  return (
    <div className="min-h-screen bg-slate-50 relative pb-20">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm pt-safe">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
        <button onClick={() => navigate('/dashboard')} aria-label="Back to dashboard" className="p-2.5 hover:bg-slate-100 rounded-full transition-colors shrink-0">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h1 className="font-outfit font-bold text-base sm:text-lg tracking-tight text-slate-900">Routes & Live Network Status</h1>
          <p className="text-xs text-slate-500 flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${offline ? 'bg-slate-400' : 'bg-green-500 motion-safe:animate-pulse'}`}></span>
            {offline ? 'Offline' : 'Sri Lanka Railways'}
          </p>
        </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto p-4 md:p-8 mt-4 space-y-10">
        {offline && <div className="-mb-4"><OfflineBanner savedAt={savedAt} /></div>}
        {/* Routes & Fares (read-only) */}
        <section>
          <h2 className="font-outfit font-bold text-xl text-slate-900 mb-1">Routes & Fares</h2>
          <p className="text-sm text-slate-500 mb-4">One fixed Fare per trip, charged when you tap out at the end of your journey.</p>
          {routes.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-sm p-8 text-center text-slate-400 text-sm">No Routes are in service right now.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {routes.map((r) => (
                <div key={r.id} className="bg-white border border-slate-200 rounded-sm p-4 sm:p-5 shadow-sm">
                  <div className="flex justify-between items-start gap-4">
                    <div className="min-w-0">
                      <h3 className="font-bold outfit text-lg text-slate-900 flex items-center gap-2">
                        <TrainTrack className="w-4 h-4 text-rail-blue" /> {r.name}
                      </h3>
                      <p className="text-sm text-slate-500 mt-2 flex flex-wrap items-center gap-x-1 gap-y-1">
                        {r.stations.map((s, i) => (
                          <React.Fragment key={s.id}>
                            {i > 0 && <span className="text-slate-300">→</span>}
                            <span>{s.name}</span>
                          </React.Fragment>
                        ))}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Fare</p>
                      <p className="text-xl font-bold outfit text-rail-blue">Rs. {r.fare}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Live tracking board */}
        <section>
          <h2 className="font-outfit font-bold text-xl text-slate-900 mb-4">Live Tracking Board</h2>

          {routes.length > 0 && !offline && (
            <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide">
              {['All', ...routes.map((r) => r.name)].map((line) => (
                <button
                  key={line}
                  onClick={() => setFilter(line)}
                  className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                    filter === line ? 'bg-rail-blue text-white' : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {line}
                </button>
              ))}
            </div>
          )}

          {offline ? (
            <div className="bg-white border border-slate-200 rounded-sm p-10 text-center">
              <WifiOff className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Offline, positions unavailable</p>
              <p className="text-sm text-slate-400 mt-1">Live train positions will appear when you reconnect.</p>
            </div>
          ) : loadingTrains ? (
            <div className="py-12 text-center text-slate-400 motion-safe:animate-pulse font-bold uppercase tracking-widest text-xs">Loading trains...</div>
          ) : filteredTrains.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-sm p-10 text-center">
              <Radio className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">Awaiting GPS</p>
              <p className="text-sm text-slate-400 mt-1">No train positions have been reported yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {filteredTrains.map((train) => (
                  <motion.div
                    key={train.trainNo}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white border border-slate-200 rounded-sm p-4 sm:p-5 shadow-sm"
                  >
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          {train.routeName && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] uppercase font-bold tracking-wider rounded-sm">{train.routeName}</span>
                          )}
                          <span className="text-xs font-mono text-slate-400">No. {train.trainNo}</span>
                        </div>
                        <h3 className="text-lg font-bold outfit text-slate-900">{train.name || `Train ${train.trainNo}`}</h3>
                      </div>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-sm text-[10px] uppercase font-bold tracking-wider self-start md:self-auto ${STATUS_STYLE[train.status]}`}>
                        {train.status === 'no_signal' && <WifiOff className="w-3 h-3" />}
                        {STATUS_LABEL[train.status]}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-x-6 sm:gap-x-8 gap-y-2 text-xs text-slate-500 font-mono">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {Number(train.latitude).toFixed(4)}, {Number(train.longitude).toFixed(4)}
                        {train.status === 'no_signal' && ' (last known)'}
                      </span>
                      {train.speedKmh !== null && train.status !== 'no_signal' && <span>{train.speedKmh} km/h</span>}
                      <span>Updated {new Date(train.reportedAt).toLocaleTimeString()}</span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Routes;
