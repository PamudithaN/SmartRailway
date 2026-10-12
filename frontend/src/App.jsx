import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AdminDashboard from './pages/AdminDashboard';
import RoutesPage from './pages/Routes';
import RequireAuth from './components/RequireAuth';
import UpdatePrompt from './components/UpdatePrompt';

function App() {
  return (
    <div className="min-h-screen bg-white">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireAuth role="user"><Dashboard /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
        <Route path="/routes" element={<RequireAuth><RoutesPage /></RequireAuth>} />
        <Route path="/" element={<Navigate to="/login" replace />} />
      </Routes>
      <UpdatePrompt />
    </div>
  );
}

export default App;
