import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';
type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};
const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'wethaq.theme';
const getStoredTheme = (): ThemePreference => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  } catch { return 'system'; }
};
const systemTheme = (): ResolvedTheme =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(getStoredTheme);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);
  const resolved = preference === 'system' ? system : preference;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystem(media.matches ? 'dark' : 'light');
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#101B28' : '#F7F8FA';
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* restricted storage */ }
  }, [preference, resolved]);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be inside ThemeProvider');
  return value;
}

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();
  const Icon = preference === 'dark' ? Moon : preference === 'light' ? Sun : Monitor;
  return (
    <label className={'theme-control ' + (compact ? 'theme-control-compact' : '')}>
      <Icon size={17} aria-hidden="true" />
      <span className="sr-only">Color theme</span>
      <select aria-label="Color theme" value={preference} onChange={e => setPreference(e.target.value as ThemePreference)}>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </select>
    </label>
  );
}