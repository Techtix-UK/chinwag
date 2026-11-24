import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from './lib/api';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout/AppShell';
import { Spinner } from './components/ui/misc';
import { LoginPage } from './pages/Login';
import { SetupPage } from './pages/Setup';
import { ConsentPage } from './pages/Consent';

const Overview = lazy(() => import('./pages/Overview'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Accounts = lazy(() => import('./pages/Accounts'));
const Scheduled = lazy(() => import('./pages/Scheduled'));
const Approvals = lazy(() => import('./pages/Approvals'));
const Mcp = lazy(() => import('./pages/Mcp'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Webhooks = lazy(() => import('./pages/Webhooks'));
const Activity = lazy(() => import('./pages/Activity'));
const Users = lazy(() => import('./pages/Users'));
const Health = lazy(() => import('./pages/Health'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Profile = lazy(() => import('./pages/Profile'));

function FullScreenSpinner() {
  return (
    <div className="flex h-dvh items-center justify-center text-muted">
      <Spinner />
    </div>
  );
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullScreenSpinner />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!me.dashboard_access) return <NoDashboard />;
  return <>{children}</>;
}

function NoDashboard() {
  const { me } = useAuth();
  return (
    <div className="flex h-dvh items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-base font-semibold">No dashboard access</h1>
        <p className="mt-2 text-sm text-muted">Signed in as {me?.email}. Your role (Integration Client) can authorise MCP clients but cannot use the administration dashboard.</p>
        <button className="mt-4 text-sm text-primary underline" onClick={() => api.post('/auth/logout').finally(() => location.assign('/login'))}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function Guard({ cap, children }: { cap: string; children: React.ReactNode }) {
  const { can } = useAuth();
  if (!can(cap)) return <div className="p-8 text-sm text-muted">You do not have permission to view this page.</div>;
  return <>{children}</>;
}

export function App() {
  const setup = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<{ setup_required: boolean }>('/setup/status'), staleTime: Infinity });
  const loc = useLocation();
  if (setup.isLoading) return <FullScreenSpinner />;
  if (setup.data?.setup_required && loc.pathname !== '/setup') return <Navigate to="/setup" replace />;
  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/oauth/consent" element={<ConsentPage />} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<Overview />} />
          <Route path="inbox" element={<Guard cap="chats:read"><Inbox /></Guard>} />
          <Route path="inbox/:accountId/:chatId" element={<Guard cap="chats:read"><Inbox /></Guard>} />
          <Route path="contacts" element={<Guard cap="contacts:read"><Contacts /></Guard>} />
          <Route path="accounts" element={<Guard cap="accounts:read"><Accounts /></Guard>} />
          <Route path="scheduled" element={<Guard cap="schedule:read"><Scheduled /></Guard>} />
          <Route path="approvals" element={<Guard cap="approvals:review"><Approvals /></Guard>} />
          <Route path="integrations/mcp" element={<Guard cap="integrations:manage"><Mcp /></Guard>} />
          <Route path="api-keys" element={<Guard cap="integrations:manage"><ApiKeys /></Guard>} />
          <Route path="webhooks" element={<Guard cap="webhooks:manage"><Webhooks /></Guard>} />
          <Route path="activity" element={<Guard cap="audit:read"><Activity /></Guard>} />
          <Route path="users" element={<Guard cap="users:manage"><Users /></Guard>} />
          <Route path="health" element={<Guard cap="system:read"><Health /></Guard>} />
          <Route path="settings" element={<Guard cap="settings:manage"><SettingsPage /></Guard>} />
          <Route path="profile" element={<Profile />} />
          <Route path="*" element={<div className="p-8 text-sm text-muted">Page not found.</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
