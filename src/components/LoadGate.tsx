import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { mockAPI, type PageResource } from '../api';
import { Button } from './UI';
export function LoadGate({ page, children }: { page: PageResource; children: ReactNode; }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading'); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let cancelled = false; setStatus('loading'); mockAPI.pageReady(page).then(() => { if (!cancelled) setStatus('ready'); }).catch(() => { if (!cancelled) setStatus('error'); }); return () => { cancelled = true; }; }, [page, attempt]);
  if (status === 'loading') return <div className="page skeleton-page" role="status" aria-live="polite"><span className="sr-only">Loading {page}...</span><div className="skeleton skeleton-title" /><div className="skeleton skeleton-subtitle" /><div className="skeleton-row">{[1, 2, 3, 4, 5].map(n => <div className="skeleton skeleton-card" key={n} />)}</div><div className="skeleton skeleton-main" /></div>;
  if (status === 'error') return <div className="state-page"><span className="state-icon"><AlertCircle size={29} /></span><h2>Unable to load demonstration data</h2><p>The local synthetic data-access layer encountered an error. You can retry without losing your changes.</p><Button onClick={() => setAttempt(n => n + 1)}><RefreshCw size={16} /> Retry</Button></div>;
  return <>{children}</>;
}
