import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ShieldCheck, Users, Activity, CreditCard, 
  Map, Search, Bell, LogOut, ArrowUpRight, Zap, Edit3, CheckCircle2,
  UserPlus, KeyRound, Trash2, Ban, RotateCcw, X, Menu, WifiOff
} from 'lucide-react';
import { api, getStoredUser, clearSession, errorMessage } from '../api';
import { useSessionStatus } from '../components/RequireAuth';
import useOnlineStatus from '../hooks/useOnlineStatus';
import RoutesPricing from '../components/admin/RoutesPricing';
import RfidTerminal from '../components/admin/RfidTerminal';
import PaymentsPanel from '../components/admin/PaymentsPanel';
import CardsDevices from '../components/admin/CardsDevices';

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);
  const online = useOnlineStatus();
  const sessionStatus = useSessionStatus();
  const offline = !online || sessionStatus === 'offline';

  const selectTab = (tab) => {
    setActiveTab(tab);
    setNavOpen(false);
  };

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);
  
  // Data States
  const [passengers, setPassengers] = useState([]);
  const [routes, setRoutes] = useState([]);
  
  useEffect(() => {
    const parsedUser = getStoredUser();
    if (!parsedUser) {
      navigate('/login');
      return;
    }
    if (parsedUser.role !== 'admin') {
      navigate('/dashboard');
      return;
    }
    setAdmin(parsedUser);
  }, [navigate]);

  // Admin data is always live: load (and reload after reconnecting) only while online.
  useEffect(() => {
    if (offline || !admin) return;
    fetchUsers();
    fetchRoutes();
  }, [offline, admin]);

  const fetchUsers = async () => {
    try {
      const res = await api.get('/api/users');
      if (res.data.success) {
        setPassengers(res.data.users);
      }
    } catch (e) {
      console.error("Failed to fetch users");
    }
  };

  const fetchRoutes = async () => {
    try {
      const res = await api.get('/api/routes');
      if (res.data.success) {
        setRoutes(res.data.routes);
      }
    } catch (e) {
      console.error("Failed to fetch routes");
    }
  };

  // --- User management ---
  const [userSearch, setUserSearch] = useState('');
  const [userModal, setUserModal] = useState(null); // { mode: 'create' | 'edit' | 'reset', user? }
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'user', fullName: '', phone: '', nic: '', email: '' });
  const [userModalError, setUserModalError] = useState('');
  const [isSavingUser, setIsSavingUser] = useState(false);

  const visibleUsers = passengers.filter((p) => {
    const q = userSearch.trim().toLowerCase();
    return [p.username, p.fullName, p.email, p.phone, p.nic].some((v) => (v || '').toLowerCase().includes(q));
  });

  const openUserModal = (mode, user = null) => {
    setUserModal({ mode, user });
    setUserForm({
      username: user?.username || '',
      password: '',
      role: user?.role || 'user',
      fullName: user?.fullName || '',
      phone: user?.phone || '',
      nic: user?.nic || '',
      email: user?.email || '',
    });
    setUserModalError('');
  };

  const handleUserSubmit = async (e) => {
    e.preventDefault();
    if (isSavingUser) return;
    setIsSavingUser(true);
    setUserModalError('');
    try {
      const { mode, user } = userModal;
      if (mode === 'create') {
        await api.post('/api/users', userForm);
      } else if (mode === 'edit') {
        const { password: _unused, ...details } = userForm;
        await api.put(`/api/users/${user.id}`, details);
      } else {
        await api.post(`/api/users/${user.id}/reset-password`, { newPassword: userForm.password });
      }
      setUserModal(null);
      fetchUsers();
    } catch (err) {
      setUserModalError(errorMessage(err, 'Request failed.'));
    } finally {
      setIsSavingUser(false);
    }
  };

  const handleUserStatus = async (user, status) => {
    const verb = status === 'deactivated' ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${user.username}?`)) return;
    try {
      await api.put(`/api/users/${user.id}/status`, { status });
      fetchUsers();
    } catch (err) {
      alert(errorMessage(err, `Failed to ${verb.toLowerCase()} user.`));
    }
  };

  const handleUserDelete = async (user) => {
    if (!window.confirm(`Delete ${user.username}? This cannot be undone.`)) return;
    try {
      await api.delete(`/api/users/${user.id}`);
      fetchUsers();
    } catch (err) {
      alert(errorMessage(err, 'Failed to delete user.'));
    }
  };

  const handleLogout = () => {
    clearSession();
    navigate('/login');
  };

  if (!admin) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar - Dark Utility */}
      {/* Phones: the sidebar is a drawer opened from the header menu button */}
      {navOpen && <div className="fixed inset-0 z-30 bg-slate-900/50 md:hidden" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <aside
        id="admin-nav"
        className={`w-64 bg-slate-900 border-r border-slate-800 flex flex-col fixed inset-y-0 left-0 z-40 pt-safe pl-safe transition-transform md:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="h-16 flex items-center px-6 border-b border-white/10">
          <ShieldCheck className="text-rail-blue w-6 h-6 mr-2" />
          <span className="flex-1 font-outfit font-bold text-lg tracking-tight text-white">SmartRail <span className="text-rail-blue">Control</span></span>
          <button onClick={() => setNavOpen(false)} aria-label="Close menu" className="md:hidden p-2.5 -mr-2.5 text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
          <button onClick={() => selectTab('overview')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Activity className="w-5 h-5 mr-3" /> System Overview
          </button>
          <button onClick={() => selectTab('users')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Users className="w-5 h-5 mr-3" /> Manage Users
          </button>
          <button onClick={() => selectTab('routes')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'routes' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Map className="w-5 h-5 mr-3" /> Routes & Pricing
          </button>
          <button onClick={() => selectTab('rfid')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'rfid' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <CreditCard className="w-5 h-5 mr-3" /> RFID Emulation
          </button>
          <button onClick={() => selectTab('payments')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'payments' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <CreditCard className="w-5 h-5 mr-3" /> Payments
          </button>
          <button onClick={() => selectTab('devices')} className={`w-full flex items-center px-4 py-3 rounded-sm text-sm font-medium transition-colors ${activeTab === 'devices' ? 'bg-rail-blue/10 text-rail-blue' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
            <Zap className="w-5 h-5 mr-3" /> Readers & Cards
          </button>
        </nav>

        <div className="p-4 pb-safe border-t border-white/10">
          <div className="flex items-center px-4 py-3">
            <div className={`w-2 h-2 rounded-full mr-3 ${offline ? 'bg-slate-500' : 'bg-green-500 motion-safe:animate-pulse'}`}></div>
            <span className="text-xs font-mono text-slate-400">Server: {offline ? 'OFFLINE' : 'ONLINE'}</span>
          </div>
        </div>
      </aside>

      {userModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-start sm:items-center justify-center p-4 pt-12 sm:pt-4" onClick={() => setUserModal(null)}>
          <form
            onSubmit={handleUserSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-lg shadow-2xl border border-slate-200 w-full max-w-sm p-6 space-y-4 modal-max-h overflow-y-auto"
          >
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold outfit text-slate-900">
                {userModal.mode === 'create' && 'Add User'}
                {userModal.mode === 'edit' && `Edit ${userModal.user.username}`}
                {userModal.mode === 'reset' && `Reset password for ${userModal.user.username}`}
              </h2>
              <button type="button" onClick={() => setUserModal(null)} aria-label="Close" className="p-2.5 -m-2.5 text-slate-400 hover:text-slate-900"><X size={18} /></button>
            </div>
            {userModalError && (
              <div className="p-2 bg-red-50 border-l-2 border-red-500 text-red-600 text-xs font-medium">{userModalError}</div>
            )}
            {userModal.mode !== 'reset' && (
              <input
                type="text" required placeholder="Username" className="input-field py-2.5 text-sm"
                value={userForm.username}
                onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
              />
            )}
            {userModal.mode !== 'reset' && (
              <>
                <input
                  type="text" placeholder="Full name" className="input-field py-2.5 text-sm"
                  value={userForm.fullName}
                  onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })}
                />
                <input
                  type="tel" placeholder="Phone (e.g. 0771234567)" className="input-field py-2.5 text-sm"
                  value={userForm.phone}
                  onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                />
                <input
                  type="text" placeholder="NIC" className="input-field py-2.5 text-sm"
                  value={userForm.nic}
                  onChange={(e) => setUserForm({ ...userForm, nic: e.target.value })}
                />
                <input
                  type="email" placeholder="Email" className="input-field py-2.5 text-sm"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                />
              </>
            )}
            {userModal.mode !== 'edit' && (
              <input
                type="password" required autoComplete="new-password"
                placeholder="Password (8+ chars, letter & number)" className="input-field py-2.5 text-sm"
                value={userForm.password}
                onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
              />
            )}
            {userModal.mode !== 'reset' && (
              <select
                className="input-field py-2.5 text-sm" value={userForm.role}
                onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
              >
                <option value="user">Passenger</option>
                <option value="admin">Admin</option>
                <option value="station_master">Station Master</option>
              </select>
            )}
            <div className="flex flex-wrap gap-3 justify-end">
              <button type="button" onClick={() => setUserModal(null)} className="text-sm text-slate-500 hover:text-slate-900 font-medium px-3 min-h-[44px] sm:min-h-0">Cancel</button>
              <button type="submit" disabled={isSavingUser || offline} className="btn-primary py-2 px-4 text-sm min-h-[44px] sm:min-h-0">{isSavingUser ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 md:ml-64 flex flex-col min-h-screen relative">
        <header className="bg-white border-b border-slate-200 pt-safe z-0">
          <div className="h-16 flex items-center justify-between gap-3 px-4 md:px-8">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open menu" aria-controls="admin-nav" aria-expanded={navOpen}
            className="md:hidden p-2.5 -ml-2.5 text-slate-600 hover:text-slate-900"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="sm:hidden flex-1 font-outfit font-bold tracking-tight">SmartRail <span className="text-rail-blue">Control</span></span>
          <div className="hidden sm:block flex-1 max-w-md relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" />
            <input type="text" placeholder="Search..." className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-sm text-sm focus:outline-none focus:border-rail-blue transition-all" />
          </div>
          <div className="flex items-center gap-6">
            <button onClick={handleLogout} className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors min-h-[44px]">
               Sign Out <LogOut className="w-4 h-4 ml-1 opacity-50" />
            </button>
          </div>
          </div>
        </header>

        <div className="p-4 md:p-8 lg:p-12 space-y-8 flex-1 overflow-auto">
          {offline ? (
            <div className="glass-card text-center py-12">
              <WifiOff className="w-10 h-10 mx-auto mb-3 text-slate-300" />
              <h1 className="text-xl font-bold outfit">Admin tools need a connection</h1>
              <p className="text-slate-500 text-sm mt-2">You're offline. Admin data is never stored on this device; it will load when you reconnect.</p>
            </div>
          ) : (
          <AnimatePresence mode="wait">
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-10 }} className="space-y-6">
                <div>
                  <h1 className="text-2xl font-bold outfit">System Overview</h1>
                  <p className="text-slate-500 text-sm mt-1">Live metrics from Sri Lanka Railways infrastructure.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
                  <div className="glass-card flex flex-col justify-between">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 rounded-sm bg-slate-50 flex items-center justify-center text-rail-blue"><Users className="w-5 h-5" /></div>
                      <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-1 rounded-sm">+12%</span>
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold outfit tracking-tight">{passengers.filter((p) => p.role === 'user').length || '...'}</h3>
                      <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mt-1">Total Passengers</p>
                    </div>
                  </div>
                  <div className="glass-card">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 rounded-sm bg-slate-50 flex items-center justify-center text-rail-blue"><Map className="w-5 h-5" /></div>
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold outfit tracking-tight">{routes.length ? routes.filter((r) => r.status === 'active').length : '...'}</h3>
                      <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mt-1">Active Routes</p>
                    </div>
                  </div>
                  <div className="glass-card">
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-10 h-10 rounded-sm bg-slate-50 flex items-center justify-center text-rail-blue"><Activity className="w-5 h-5" /></div>
                    </div>
                    <h3 className="text-3xl font-bold outfit tracking-tight text-green-600">Stable</h3>
                    <p className="text-sm text-slate-500 font-medium uppercase tracking-wider mt-1">API Health</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* USERS TAB */}
            {activeTab === 'users' && (
              <motion.div key="users" initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-10 }} className="space-y-6">
                <div className="flex justify-between items-center gap-4 flex-wrap">
                  <div>
                    <h1 className="text-2xl font-bold outfit">Manage Users</h1>
                    <p className="text-slate-500 text-sm mt-1">Create, edit, deactivate and reset accounts.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
                    <input
                      type="search" placeholder="Search name, username, NIC..." value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="w-full sm:w-auto px-3 py-2 min-h-[44px] sm:min-h-0 bg-white border border-slate-200 rounded-sm text-sm focus:outline-none focus:border-rail-blue"
                    />
                    <button onClick={fetchUsers} className="btn-primary py-2 px-4 text-xs flex items-center gap-2 min-h-[44px] sm:min-h-0">Refresh Data</button>
                    <button onClick={() => openUserModal('create')} className="btn-primary py-2 px-4 text-xs flex items-center gap-2 min-h-[44px] sm:min-h-0">
                      <UserPlus size={14} /> Add User
                    </button>
                  </div>
                </div>

                <div className="glass-card p-0 overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                      <tr>
                        <th className="px-6 py-4 border-b border-slate-100">ID</th>
                        <th className="px-6 py-4 border-b border-slate-100">Username</th>
                        <th className="px-6 py-4 border-b border-slate-100">Contact</th>
                        <th className="px-6 py-4 border-b border-slate-100">Role</th>
                        <th className="px-6 py-4 border-b border-slate-100 text-right">Card Balance</th>
                        <th className="px-6 py-4 border-b border-slate-100 text-center">Status</th>
                        <th className="px-6 py-4 border-b border-slate-100">Created</th>
                        <th className="px-6 py-4 border-b border-slate-100 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {visibleUsers.length === 0 ? (
                        <tr><td colSpan="8" className="text-center py-8 text-slate-400">No users found.</td></tr>
                      ) : visibleUsers.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50/50">
                          <td className="px-6 py-4 font-mono text-xs text-slate-400">SR-{p.id.toString().padStart(4, '0')}</td>
                          <td className="px-6 py-4">
                            <div className="font-semibold">{p.username}</div>
                            {p.fullName && <div className="text-xs text-slate-400">{p.fullName}</div>}
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-500">
                            <div>{p.email || '-'}</div>
                            <div className="text-slate-400">{[p.phone, p.nic].filter(Boolean).join(' · ')}</div>
                          </td>
                          <td className="px-6 py-4 text-xs uppercase tracking-widest text-slate-500">{p.role === 'admin' ? 'Admin' : p.role === 'station_master' ? 'Station Master' : 'Passenger'}</td>
                          <td className="px-6 py-4 font-bold font-mono text-right text-rail-blue">Rs. {p.balance}</td>
                          <td className="px-6 py-4 text-center">
                            {p.status === 'active' ? (
                              <span className="bg-green-50 text-green-600 px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest">Active</span>
                            ) : (
                              <span className="bg-slate-100 text-slate-500 px-2 py-1 rounded-sm text-[10px] uppercase font-bold tracking-widest">Deactivated</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-xs text-slate-500">{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ''}</td>
                          <td className="px-6 py-4">
                            <div className="flex justify-end gap-1 text-slate-400 [&>button]:p-2">
                              <button title="Edit" onClick={() => openUserModal('edit', p)} className="hover:text-rail-blue"><Edit3 size={16} /></button>
                              <button title="Reset password" onClick={() => openUserModal('reset', p)} className="hover:text-rail-blue"><KeyRound size={16} /></button>
                              {p.status === 'active' ? (
                                <button title="Deactivate" onClick={() => handleUserStatus(p, 'deactivated')} className="hover:text-rail-red"><Ban size={16} /></button>
                              ) : (
                                <button title="Reactivate" onClick={() => handleUserStatus(p, 'active')} className="hover:text-green-600"><RotateCcw size={16} /></button>
                              )}
                              <button title="Delete" onClick={() => handleUserDelete(p)} className="hover:text-rail-red"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}

            {/* ROUTES TAB */}
            {activeTab === 'routes' && <RoutesPricing key="routes" routes={routes} onReload={fetchRoutes} />}

            {/* RFID EMULATION TAB */}
            {activeTab === 'rfid' && <RfidTerminal key="rfid" routes={routes} onTapDone={fetchUsers} />}

            {/* PAYMENTS TAB */}
            {activeTab === 'payments' && <PaymentsPanel key="payments" passengers={passengers} />}

            {/* READERS & CARDS TAB */}
            {activeTab === 'devices' && <CardsDevices key="devices" routes={routes} passengers={passengers} />}

          </AnimatePresence>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;
