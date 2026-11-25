import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { SocketProvider } from './SocketContext';
import ProtectedRoute from './components/ProtectedRoute';
import AlertToasts from './components/AlertToasts';
import { ConfirmProvider, ToastProvider } from './components/ui';
import { PublicLayout, TouristLayout, OperatorLayout } from './layouts/Layouts';

import { Landing, About, Features, Help, NotFound } from './pages/public/Info';
import { Login, ForgotPassword, ResetPassword } from './pages/public/Auth';
import Register from './pages/public/Register';

import TouristDashboard from './pages/tourist/Dashboard';
import TouristMap from './pages/tourist/LiveMap';
import SosPage from './pages/tourist/Sos';
import DigitalIdPage from './pages/tourist/DigitalId';
import TouristIncidents from './pages/tourist/Incidents';
import Notifications from './pages/tourist/Notifications';
import Profile from './pages/tourist/Profile';
import Safety from './pages/tourist/Safety';

import OperatorDashboard from './pages/operator/Dashboard';
import Monitor from './pages/operator/Monitor';
import OperatorIncidents from './pages/operator/Incidents';
import Zones from './pages/operator/Zones';
import Tourists, { TouristDetail } from './pages/operator/Tourists';
import VerifyId from './pages/operator/VerifyId';
import Blockchain from './pages/operator/Blockchain';
import Reports from './pages/operator/Reports';
import Settings from './pages/operator/Settings';
import SafetyCenter from './pages/operator/SafetyCenter';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/features" element={<Features />} />
        <Route path="/help" element={<Help />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
      </Route>

      <Route path="/tourist" element={<ProtectedRoute role="tourist"><TouristLayout /></ProtectedRoute>}>
        <Route index element={<TouristDashboard />} />
        <Route path="map" element={<TouristMap />} />
        <Route path="sos" element={<SosPage />} />
        <Route path="id" element={<DigitalIdPage />} />
        <Route path="incidents" element={<TouristIncidents />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
        <Route path="safety" element={<Safety />} />
      </Route>

      <Route path="/operator" element={<ProtectedRoute role="admin"><OperatorLayout /></ProtectedRoute>}>
        <Route index element={<OperatorDashboard />} />
        <Route path="monitor" element={<Monitor />} />
        <Route path="incidents" element={<OperatorIncidents />} />
        <Route path="zones" element={<Zones />} />
        <Route path="tourists" element={<Tourists />} />
        <Route path="tourists/:id" element={<TouristDetail />} />
        <Route path="verify" element={<VerifyId />} />
        <Route path="blockchain" element={<Blockchain />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
        <Route path="safety" element={<SafetyCenter />} />
      </Route>

      {/* old URLs from the first version */}
      <Route path="/admin/*" element={<Navigate to="/operator" replace />} />
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <SocketProvider>
              <AlertToasts />
              <AppRoutes />
            </SocketProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
