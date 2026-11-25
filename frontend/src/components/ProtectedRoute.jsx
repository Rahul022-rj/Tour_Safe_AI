// Wraps a page so only logged-in users with the right role can open it. (The server enforces the same rules.)
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, homeFor } from '../AuthContext';
import { Spinner } from './ui';

export default function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />; // wrong role -> own home

  return children;
}
