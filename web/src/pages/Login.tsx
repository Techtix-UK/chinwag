import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrf } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { resetSocket } from '@/lib/socket';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { AuthLayout } from './AuthLayout';

function safeNext(n: string | null) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

export function LoginPage() {
  const { me } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me) {
    if (next.startsWith('/api/docs')) {
      location.assign(next);
      return null;
    }
    return <Navigate to={next} replace />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ csrf_token: string }>('/auth/login', { email, password });
      setCsrf(r.csrf_token);
      resetSocket();
      await qc.invalidateQueries({ queryKey: ['me'] });
      if (next.startsWith('/api/docs')) location.assign(next);
      else navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <CardContent className="p-5">
          <h1 className="text-base font-semibold">Sign in</h1>
          <p className="mt-1 text-[13px] text-muted">Use your Techtix WhatsApp administrator account.</p>
          <form onSubmit={submit} className="mt-5 grid gap-4">
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
            <Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
