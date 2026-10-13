import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CreditCard, History, MapPin, Zap, LogOut, ArrowRight, TrainFront, CheckCircle2, KeyRound, QrCode } from 'lucide-react';
import { api, getStoredUser, setSession, clearSession, errorMessage } from '../api';
import TopUpModal from '../components/TopUpModal';
import TripQrModal from '../components/TripQrModal';
import OfflineBanner from '../components/OfflineBanner';
import InstallPrompt from '../components/InstallPrompt';
import { useSessionStatus } from '../components/RequireAuth';
import useOnlineStatus from '../hooks/useOnlineStatus';
import { isOnline, isOfflineError, subscribe } from '../lib/network';
import { loadSnapshot, saveSnapshot } from '../lib/offlineCache';

// The 12 MB hero video only plays online, and not when the user asked for less motion or data.
const canPlayHeroVideo = () =>
  !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches && !navigator.connection?.saveData;

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);
  const [topUpNotice, setTopUpNotice] = useState(null);
  const [topups, setTopups] = useState([]);
  const [history, setHistory] = useState([]);
  const [trips, setTrips] = useState([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '' });
  const [pwMessage, setPwMessage] = useState(null);
  const [isSavingPw, setIsSavingPw] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [qrTrip, setQrTrip] = useState(null);
  const [isEnding, setIsEnding] = useState(false);
  const [tripNotice, setTripNotice] = useState(null);
  const online = useOnlineStatus();
  const sessionStatus = useSessionStatus();
  const offline = !online || sessionStatus === 'offline';
  const wasOffline = useRef(offline);

  useEffect(() => {
    const parsedUser = getStoredUser();
    if (!parsedUser) {
      navigate('/login');
      return;
    }
    setUser(parsedUser);
    if (isOnline()) {
      fetchHistory(parsedUser.id);
      fetchTrips();
      fetchTopups();
    } else {
      showSnapshot(parsedUser.id);
    }
  }, [navigate]);

  // Back online: refresh the Balance and every list without a manual reload.
  useEffect(() => {
    if (wasOffline.current && !offline) refreshAll();
    wasOffline.current = offline;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  // Returning from PayHere: the return page is not proof of payment, so ask the server for the outcome.
  useEffect(() => {
    const outcome = searchParams.get('topup');
    const id = searchParams.get('id');
    if (!outcome || !id) return undefined;
    setSearchParams({}, { replace: true });

    let stopped = false;
    let unsubscribe = () => {};
    const settle = async () => {
      try {
        if (outcome === 'cancelled') {
          await api.post(`/api/topups/${id}/cancel`).catch(() => {});
        }
        for (let attempt = 0; attempt < 8 && !stopped; attempt += 1) {
          const res = await api.get(`/api/topups/${id}`);
          const { topup, balance } = res.data;
          if (topup.status === 'succeeded') {
            const current = getStoredUser();
            if (current) {
              const updated = { ...current, balance };
              setUser(updated);
              setSession({ user: updated });
            }
            setTopUpNotice({ type: 'success', text: `Payment successful. Rs. ${topup.amount} added to your balance.` });
            setTopUpSuccess(true);
            setTimeout(() => setTopUpSuccess(false), 2000);
            break;
          }
          if (topup.status === 'cancelled') {
            setTopUpNotice({ type: 'info', text: 'Payment cancelled. Your balance was not changed.' });
            break;
          }
          if (topup.status === 'review') {
            setTopUpNotice({ type: 'error', text: 'Your payment needs review by an administrator. Your balance has not changed yet.' });
            break;
          }
          if (topup.status === 'failed' || topup.status === 'expired') {
            const reason = topup.failureReason ? `: ${topup.failureReason}` : '';
            setTopUpNotice({ type: 'error', text: `Payment ${topup.status}${reason}. Your balance was not changed.` });
            break;
          }
          if (attempt === 7) {
            setTopUpNotice({ type: 'info', text: 'Payment is still being confirmed. Your balance will update shortly.' });
            break;
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
      } catch (e) {
        setTopUpNotice({ type: 'error', text: 'Could not confirm the payment status. Refresh to check your balance.' });
      } finally {
        const stored = getStoredUser();
        if (stored && !stopped) fetchHistory(stored.id);
        fetchTopups();
      }
    };
    // Offline on return: wait for the connection; the server decides the outcome, never the device.
    if (isOnline()) {
      settle();
    } else {
      setTopUpNotice({ type: 'info', text: "You're offline. We'll confirm your payment as soon as you reconnect." });
      unsubscribe = subscribe((nowOnline) => {
        if (!nowOnline || stopped) return;
        unsubscribe();
        setTopUpNotice(null);
        settle();
      });
    }
    return () => { stopped = true; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshAll = async () => {
    const stored = getStoredUser();
    if (!stored) return;
    try {
      const res = await api.get('/api/me');
      const fresh = { ...stored, ...res.data.user };
      setSession({ user: fresh });
      setUser(fresh);
    } catch {
      // a 401 is handled by the interceptor; a network error keeps the offline view
    }
    fetchHistory(stored.id);
    fetchTrips();
    fetchTopups();
  };

  // Last-known lists for offline viewing; the Balance shown is the one on the stored user.
  const showSnapshot = (userId) => {
    const snapshot = loadSnapshot(userId);
    setIsLoadingHistory(false);
    if (!snapshot) return;
    if (snapshot.history) setHistory(snapshot.history);
    if (snapshot.trips) setTrips(snapshot.trips);
    if (snapshot.topups) setTopups(snapshot.topups);
    setSavedAt(snapshot.savedAt);
  };

  const fetchTopups = async () => {
    try {
      const res = await api.get('/api/topups/mine');
      if (res.data.success) {
        setTopups(res.data.topups);
        saveSnapshot(getStoredUser()?.id, 'topups', res.data.topups);
      }
    } catch (e) {
      if (!isOfflineError(e)) console.error("Failed to fetch top-ups");
    }
  };

  const fetchHistory = async (userId) => {
    setIsLoadingHistory(true);
    try {
      const res = await api.get(`/api/history/${userId}`);
      if (res.data.success) {
        setHistory(res.data.history);
        saveSnapshot(userId, 'history', res.data.history);
        setSavedAt(null);
      }
    } catch (e) {
      if (isOfflineError(e)) showSnapshot(userId);
      else console.error("Failed to fetch history");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const fetchTrips = async () => {
    try {
      const res = await api.get('/api/trips/mine');
      if (res.data.success) {
        setTrips(res.data.trips);
        saveSnapshot(getStoredUser()?.id, 'trips', res.data.trips);
      }
    } catch (e) {
      if (!isOfflineError(e)) console.error("Failed to fetch trips");
    }
  };

  const openTrip = trips.find((t) => t.status === 'open');

  // Ends the trip: the full fare is debited now and a QR code is issued for the Station Master.
  const handleEndTrip = async () => {
    if (!openTrip || isEnding) return;
    const ok = window.confirm(
      `End your trip now?\n\nThe full fare of Rs. ${openTrip.fare} will be charged, even if you have not reached your destination.`
    );
    if (!ok) return;

    setIsEnding(true);
    setTripNotice(null);
    try {
      const res = await api.post(`/api/trips/${openTrip.id}/end`);
      const { trip, newBalance } = res.data;
      const current = getStoredUser();
      if (current) {
        const updated = { ...current, balance: newBalance };
        setUser(updated);
        setSession({ user: updated });
      }
      setQrTrip({ ...trip, routeName: openTrip.routeName, startStation: openTrip.startStation });
      fetchTrips();
      fetchHistory(getStoredUser()?.id);
    } catch (err) {
      setTripNotice({ type: 'error', text: errorMessage(err, 'Could not end the trip.') });
    } finally {
      setIsEnding(false);
    }
  };

  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (isSavingPw) return;
    setIsSavingPw(true);
    setPwMessage(null);
    try {
      const res = await api.put('/api/me/password', pwForm);
      if (res.data.success) {
        setSession({ token: res.data.token, user: getStoredUser() });
        setPwForm({ currentPassword: '', newPassword: '' });
        setPwMessage({ type: 'success', text: 'Password updated.' });
      }
    } catch (err) {
      setPwMessage({ type: 'error', text: errorMessage(err, 'Could not update password.') });
    } finally {
      setIsSavingPw(false);
    }
  };

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar Minimalist */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50 pt-safe">
        <div className="px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <TrainFront className="text-rail-blue w-6 h-6" />
          <span className="font-outfit font-bold text-lg tracking-tight">SmartRail</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-6">
          <span className="text-sm font-medium text-slate-500 hidden md:block">
            Passenger ID: SR-{user.id.toString().padStart(4, '0')}
          </span>
          <button
            onClick={() => { setShowPassword(true); setPwMessage(null); }}
            disabled={offline}
            title={offline ? "You're offline" : undefined}
            aria-label="Change password"
            className="text-slate-400 hover:text-rail-blue transition-colors flex items-center gap-2 text-sm font-medium p-2.5 sm:p-0 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <KeyRound size={16} />
            <span className="hidden sm:block">Password</span>
          </button>
          <button
            onClick={handleLogout}
            aria-label="Sign out"
            className="text-slate-400 hover:text-rail-red transition-colors flex items-center gap-2 text-sm font-medium p-2.5 sm:p-0"
          >
            <LogOut size={16} />
            <span className="hidden sm:block">Sign Out</span>
          </button>
        </div>
        </div>
      </nav>

      {showTopUp && <TopUpModal onClose={() => setShowTopUp(false)} />}
      {qrTrip && <TripQrModal trip={qrTrip} onClose={() => setQrTrip(null)} />}

      {showPassword && (
        <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4" onClick={() => setShowPassword(false)}>
          <form
            onSubmit={handleChangePassword}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm p-6 space-y-4 modal-max-h overflow-y-auto"
          >
            <h2 className="text-lg font-bold outfit text-slate-900">Change Password</h2>
            {pwMessage && (
              <div className={`p-2 border-l-2 text-xs font-medium ${pwMessage.type === 'success' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-red-50 border-red-500 text-red-600'}`}>
                {pwMessage.text}
              </div>
            )}
            <input
              type="password" required autoComplete="current-password" placeholder="Current password"
              className="input-field py-2.5 text-sm"
              value={pwForm.currentPassword}
              onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
            />
            <input
              type="password" required autoComplete="new-password" placeholder="New password (8+ chars, letter & number)"
              className="input-field py-2.5 text-sm"
              value={pwForm.newPassword}
              onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            />
            <div className="flex flex-wrap gap-3 justify-end">
              <button type="button" onClick={() => setShowPassword(false)} className="text-sm text-slate-500 hover:text-slate-900 font-medium px-3 min-h-[44px] sm:min-h-0">Close</button>
              <button type="submit" disabled={isSavingPw || offline} className="btn-primary py-2 px-4 text-sm min-h-[44px] sm:min-h-0">{isSavingPw ? 'Saving...' : 'Update'}</button>
            </div>
          </form>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 lg:p-12">
        
        {/* Hero Video Section */}
        <motion.section 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative h-[220px] sm:h-[300px] md:h-[450px] w-full overflow-hidden mb-8 md:mb-12 rounded-2xl shadow-2xl border-4 border-white bg-gradient-to-br from-rail-dark via-slate-800 to-rail-blue"
        >
          {!offline && canPlayHeroVideo() && (
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="absolute top-0 left-0 w-full h-full object-cover"
            >
              <source src="/edit.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent flex flex-col justify-center px-6 sm:px-8 md:px-12">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
            >
              <h1 className="text-3xl sm:text-4xl md:text-6xl font-black text-white outfit uppercase tracking-tighter leading-none">
                SmartRail <br />
                <span className="text-rail-blue">Innovators</span>
              </h1>
              <div className="h-1 w-24 bg-rail-blue mt-4 mb-4 sm:mb-6"></div>
              <p className="text-white/80 text-base sm:text-lg md:text-xl font-medium max-w-md leading-relaxed">
                Experience the next generation of railway ticketing. Seamless, fast, and secure.
              </p>
            </motion.div>
          </div>
          
          {/* Decorative Overlay */}
          <div className="absolute bottom-0 right-0 p-6 hidden sm:flex gap-4">
             <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center border border-white/20">
                <TrainFront className="text-white w-6 h-6" />
             </div>
          </div>
        </motion.section>

        {offline && <OfflineBanner savedAt={savedAt} />}

        <InstallPrompt className="mb-6" />

        {topUpNotice && (
          <div className={`mb-6 p-3 border-l-2 text-sm font-medium flex justify-between items-start gap-4 ${topUpNotice.type === 'success' ? 'bg-green-50 border-green-500 text-green-700' : topUpNotice.type === 'error' ? 'bg-red-50 border-red-500 text-red-600' : 'bg-blue-50 border-blue-500 text-blue-700'}`}>
            <span>{topUpNotice.text}</span>
            <button onClick={() => setTopUpNotice(null)} className="text-xs uppercase font-bold tracking-widest px-2 -my-2 min-h-[44px] sm:min-h-0">Dismiss</button>
          </div>
        )}

        {/* Header Greeting */}
        <header className="mb-8 md:mb-10">
          <motion.h1 
            initial={{ opacity: 0, y: -10 }} 
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl sm:text-3xl md:text-4xl font-bold outfit text-slate-900"
          >
            Good Morning, <span className="text-rail-blue capitalize">{user.username}</span>
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            transition={{ delay: 0.1 }}
            className="text-slate-500 mt-2"
          >
            Your smart card is active and ready for travel.
          </motion.p>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 md:gap-8">
          
          {/* Left Column (Primary Tools - Card & Actions) */}
          <div className="lg:col-span-5 space-y-8">
            
            {/* The Smart Card Visual */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 }}
              className="bg-slate-900 rounded-sm p-6 sm:p-8 text-white relative overflow-hidden shadow-2xl group"
            >
              {/* Accents */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-rail-blue opacity-20 blur-[50px] group-hover:bg-blue-400 transition-colors duration-700"></div>
              
              <div className="relative z-10 flex justify-between items-start">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1">Current Balance</p>
                  <h2 className="text-4xl sm:text-5xl font-bold outfit tracking-tight flex items-center gap-2">
                    <span className="text-2xl font-normal text-slate-400">Rs.</span>
                    {user.balance || 0}
                    {topUpSuccess && <CheckCircle2 className="w-5 h-5 text-green-400 ml-2" />}
                  </h2>
                </div>
                <Zap className="text-rail-blue w-6 h-6" />
              </div>

              <div className="relative z-10 mt-8 sm:mt-12 flex items-end justify-between">
                <div>
                  <p className="text-xs text-slate-400 font-mono mb-1">UID: SR-{user.id.toString().padStart(4, '0')}-CARD</p>
                  <p className="text-sm font-medium uppercase tracking-wider">{user.username}</p>
                </div>
                <CreditCard className="w-8 h-8 opacity-50" />
              </div>
            </motion.div>

            {/* Active trip: end it here to pay and get the QR code */}
            {tripNotice && (
              <div className="p-3 border-l-2 bg-red-50 border-red-500 text-red-600 text-sm font-medium">{tripNotice.text}</div>
            )}
            {openTrip && (
              <div className="glass-card border-rail-blue">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-rail-blue">Trip in progress</p>
                <p className="font-semibold text-slate-900 mt-2">{openTrip.routeName}</p>
                <p className="text-xs text-slate-500 mt-1">From {openTrip.startStation} · Fare Rs. {openTrip.fare}</p>
                <button
                  onClick={handleEndTrip}
                  disabled={isEnding || offline}
                  title={offline ? "You're offline. Ending a trip needs a connection." : undefined}
                  className="btn-primary w-full mt-4 py-2.5 min-h-[44px] flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <QrCode size={16} />
                  {isEnding ? 'Ending...' : 'End Trip'}
                </button>
              </div>
            )}

            {/* Quick Actions */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="grid grid-cols-2 gap-4"
            >
              <button 
                onClick={() => setShowTopUp(true)}
                disabled={offline}
                title={offline ? "You're offline. Top-up needs a connection." : undefined}
                className="glass-card hover:border-rail-blue hover:shadow-md transition-all flex flex-col items-center justify-center p-6 gap-3 group text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-100"
              >
                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                  <CreditCard className="text-rail-blue w-5 h-5" />
                </div>
                <span className="font-semibold text-sm">{offline ? 'Top up (offline)' : 'Top up'}</span>
              </button>
              
              <button 
                onClick={() => navigate('/routes')}
                className="glass-card hover:border-rail-blue transition-colors flex flex-col items-center justify-center p-6 gap-3 group text-left"
              >
                <div className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                  <MapPin className="text-rail-blue w-5 h-5" />
                </div>
                <span className="font-semibold text-sm">View Routes</span>
              </button>
            </motion.div>

          </div>

          {/* Right Column (History & Logs) */}
          <div className="lg:col-span-7">
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="glass-card"
            >
              <div className="flex items-center justify-between gap-2 mb-6 sm:mb-8">
                <div className="flex items-center gap-2">
                  <History className="text-slate-400 w-5 h-5" />
                  <h3 className="text-lg font-bold outfit">Recent Journeys</h3>
                </div>
                <button className="text-sm font-medium text-rail-blue hover:underline flex items-center gap-1">
                  View All <ArrowRight size={14} />
                </button>
              </div>

              <div className="space-y-4">
                {isLoadingHistory ? (
                   <div className="py-12 text-center text-slate-400 motion-safe:animate-pulse font-bold uppercase tracking-widest text-xs">Fetching Logs...</div>
                ) : history.length === 0 ? (
                  <div className="py-12 text-center text-slate-400">
                    <History className="w-12 h-12 mx-auto mb-4 opacity-20" />
                    <p className="text-xs font-bold uppercase tracking-widest">No recent journeys found.</p>
                  </div>
                ) : (
                  history.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-sm border border-slate-100 hover:border-slate-200 transition-colors">
                      <div className="flex items-start gap-3 sm:gap-4 min-w-0">
                        <div className={`w-2 h-2 mt-2 shrink-0 rounded-full ${item.type === 'credit' ? 'bg-green-500' : 'bg-rail-blue'}`}></div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 break-words">{item.title}</p>
                          <p className="text-[10px] text-slate-400 font-mono mt-1 uppercase">{item.date}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-bold font-mono whitespace-nowrap ${item.type === 'credit' ? 'text-green-600' : 'text-slate-900'}`}>
                          {item.type === 'credit' ? '+' : '-'}Rs. {item.amount}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="glass-card mt-6 md:mt-8"
            >
              <div className="flex items-center gap-2 mb-6">
                <CreditCard className="text-slate-400 w-5 h-5" />
                <h3 className="text-lg font-bold outfit">Recent Top-ups</h3>
              </div>
              {topups.length === 0 ? (
                <p className="py-6 text-center text-xs font-bold uppercase tracking-widest text-slate-400">No top-ups yet.</p>
              ) : (
                <div className="space-y-3">
                  {topups.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-sm border border-slate-100">
                      <div>
                        <p className="font-semibold text-slate-900">Rs. {t.amount}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-1 uppercase">{new Date(t.createdAt).toLocaleString()}</p>
                      </div>
                      <span className={`text-[10px] uppercase font-bold tracking-widest ${t.status === 'succeeded' ? 'text-green-600' : t.status === 'pending' ? 'text-rail-blue' : t.status === 'review' ? 'text-amber-600' : t.status === 'failed' ? 'text-rail-red' : 'text-slate-400'}`} title={t.failureReason || ''}>
                        {t.status === 'review' ? 'Under review' : t.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="glass-card mt-6 md:mt-8"
            >
              <div className="flex items-center gap-2 mb-6">
                <TrainFront className="text-slate-400 w-5 h-5" />
                <h3 className="text-lg font-bold outfit">My Trips</h3>
              </div>
              {trips.length === 0 ? (
                <p className="py-6 text-center text-xs font-bold uppercase tracking-widest text-slate-400">No trips yet. Tap in at the start of your journey.</p>
              ) : (
                <div className="space-y-3">
                  {trips.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 p-3 sm:p-4 rounded-sm border border-slate-100">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 break-words">{t.routeName}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {t.startStation} → {t.endStation || '...'}
                        </p>
                        <p className="text-[10px] text-slate-400 font-mono mt-1 uppercase">{new Date(t.startedAt).toLocaleString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold font-mono text-slate-900 whitespace-nowrap">Rs. {t.fare}</p>
                        <span className={`text-[10px] uppercase font-bold tracking-widest ${t.status === 'open' ? 'text-rail-blue' : t.status === 'completed' || t.status === 'ended' ? 'text-green-600' : 'text-slate-400'}`}>
                          {t.status === 'open' ? 'In progress' : t.status === 'ended' ? 'Paid' : t.status}
                        </span>
                        {t.status === 'ended' && t.qrToken && (
                          <button
                            onClick={() => setQrTrip(t)}
                            className="mt-1 flex items-center gap-1 ml-auto text-xs font-medium text-rail-blue hover:underline"
                          >
                            <QrCode size={12} /> Show QR
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default Dashboard;
