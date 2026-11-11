import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ThemeProvider, ThemeControl, useTheme } from './theme/ThemeProvider';
import { RoleSelector } from './components/RoleSelector';
import { GuidedDemo } from './components/GuidedDemo';
import { BrowserRouter, Routes, Route, Navigate, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Boxes, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Command, LayoutDashboard, LogOut, Menu, Search, Shield, ShieldCheck, Truck, Users, CheckCircle2, X, ArrowRight, LockKeyhole, AlertCircle } from 'lucide-react';
import { Provider, useStore } from './context/Store';
import { PARTS } from './data/mock';
import { roles, identities, allowed } from './utils/core';
import { Button, Modal, Status } from './components/UI';
import { LoadGate } from './components/LoadGate';
import Login from './pages/Login'; import Overview from './pages/Overview'; import Forecasts from './pages/Forecasts'; import Inventory from './pages/Inventory'; import Shipments from './pages/Shipments'; import UsersPage from './pages/Users';
const nav = [{ path: '/overview', label: 'Overview', icon: LayoutDashboard, permission: 'overview' }, { path: '/forecasts', label: 'Demand Forecasting', icon: ChartNoAxesCombined, permission: 'forecasts' }, { path: '/inventory', label: 'Inventory & Alerts', icon: Boxes, permission: 'inventory' }, { path: '/shipments', label: 'Shipments & Ledger', icon: Truck, permission: 'shipments' }, { path: '/users', label: 'Users & Roles', icon: Users, permission: 'users' }];
function Guard({ children, permission }: { children: React.ReactNode; permission: string; }) { const { authenticated, role } = useStore(); if (!authenticated) return <Navigate to="/login" replace />; if (!allowed(role, permission)) return <Restricted />; return <>{children}</>; }
function Restricted() { return <div className="state-page"><span className="state-icon"><LockKeyhole size={30} /></span><h2>Access restricted</h2><p>This page isn't available for your current demonstration role. Switch roles from the header or return to Overview</p><Link to="/overview" className="btn btn-primary">Back to Overview <ArrowRight size={16} /></Link></div>; }
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}
function Shell({ children }: { children: React.ReactNode; }) {
  const { role, setRole, data, logout, toast, dismiss, ack, resetDemo } = useStore(); const { resolved, preference, setPreference } = useTheme(); const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('wethaq.sidebarCollapsed') === '1'; } catch { return false; } }); const [mobile, setMobile] = useState(false); const [search, setSearch] = useState(''); const [searchOpen, setSearchOpen] = useState(false); const [searchExpanded, setSearchExpanded] = useState(false); const searchInput = useRef<HTMLInputElement>(null); const searchBox = useRef<HTMLDivElement>(null); const searchTrigger = useRef<HTMLButtonElement>(null); const alertsBox = useRef<HTMLDivElement>(null); const mobileTrigger = useRef<HTMLButtonElement>(null); const mobileClose = useRef<HTMLButtonElement>(null); const mainArea = useRef<HTMLDivElement>(null); const [alertsOpen, setAlertsOpen] = useState(false); const [about, setAbout] = useState(false); const [confirmReset, setConfirmReset] = useState(false); const location = useLocation(); const navigate = useNavigate(); const activeAlerts = data.alerts.filter(a => !a.acknowledged).length;
  useEffect(() => { try { localStorage.setItem('wethaq.sidebarCollapsed', collapsed ? '1' : '0'); } catch { /* storage not available */ } }, [collapsed]);
  useEffect(() => { const handle = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchExpanded(true); setSearchOpen(true); setTimeout(() => searchInput.current?.focus(), 0); } }; window.addEventListener('keydown', handle); return () => window.removeEventListener('keydown', handle); }, []);
  useEffect(() => {
    if (!mobile) return;
    const content = mainArea.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (content) content.inert = true;
    mobileClose.current?.focus();
    const desktop = window.matchMedia('(min-width: 761px)');
    const closeMenu = () => setMobile(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    desktop.addEventListener('change', closeMenu);
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (content) content.inert = false;
      desktop.removeEventListener('change', closeMenu);
      window.removeEventListener('keydown', onKey);
      mobileTrigger.current?.focus({ preventScroll: true });
    };
  }, [mobile]);

  useEffect(() => {
    if (!searchOpen && !alertsOpen) return;
    function dismissOnOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!searchBox.current?.contains(target)) {
        setSearchOpen(false);
        setSearchExpanded(false);
      }
      if (!alertsBox.current?.contains(target)) setAlertsOpen(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (searchExpanded) searchTrigger.current?.focus();
      if (alertsOpen) alertsBox.current?.querySelector('button')?.focus();
      setSearchOpen(false);
      setSearchExpanded(false);
      setAlertsOpen(false);
    }
    document.addEventListener('pointerdown', dismissOnOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [searchOpen, searchExpanded, alertsOpen]);

  function openSearchResult(url: string) {
    navigate(url);
    setSearch('');
    setSearchOpen(false);
    setSearchExpanded(false);
  }

  const candidates = search.length > 1 ? [...PARTS.filter(p => (p.id + ' ' + p.name).toLowerCase().includes(search.toLowerCase())).slice(0, 5).map(p => ({ id: p.id, title: p.name, sub: 'Spare part', url: `/inventory?search=${p.id}` })), ...data.shipments.filter(s => s.id.toLowerCase().includes(search.toLowerCase())).slice(0, 5).map(s => ({ id: s.id, title: s.id, sub: 'Shipment', url: `/shipments?search=${s.id}` }))] : [];
  const current = nav.find(x => location.pathname.startsWith(x.path)); useEffect(() => { setMobile(false); setAlertsOpen(false); setSearchOpen(false); setSearchExpanded(false); }, [location.pathname]);
  useEffect(() => { if (!toast) return; const t = setTimeout(dismiss, 4100); return () => clearTimeout(t); }, [toast, dismiss]);
  return <div className={`app-shell ${collapsed ? 'collapsed' : ''} ${mobile ? 'mobile-open' : ''}`}>
    <a href="#main-content" className="skip-content">Skip to content</a>
    <aside className="sidebar" id="workspace-navigation" aria-label="Workspace navigation" role={mobile ? 'dialog' : undefined} aria-modal={mobile || undefined}><div className="sidebar-brand"><button ref={mobileClose} className="mobile-nav-close" type="button" aria-label="Close menu" onClick={() => setMobile(false)}><X size={21} aria-hidden="true" /></button><Link to="/overview" className="brand-expanded" aria-label="Wethaq home"><img src="/brand/wathaq-olive-logo-light.svg" alt="Wethaq" /></Link><Link to="/overview" className="brand-collapsed" aria-label="Wethaq home"><img src="/brand/wathaq-olive-icon-light.svg" alt="Wethaq" /></Link><button className="side-collapse" onClick={() => setCollapsed(x => !x)} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label="Toggle sidebar">{collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}</button></div>
      <div className="nav-section-label">WORKSPACE</div><nav className="side-nav" aria-label="Primary navigation">{nav.filter(n => allowed(role, n.permission)).map(n => <NavLink key={n.path} to={n.path} onClick={() => setMobile(false)} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} title={n.label}><n.icon size={19} strokeWidth={1.85} /><span>{n.label}</span></NavLink>)}</nav><div className="sidebar-bottom"><div className="side-proto"><span className="side-proto-icon"><ShieldCheck size={18} /></span><span><strong>Academic prototype</strong><small>Synthetic demonstration data</small></span></div><div className="sidebar-year">WETHAQ © 2026</div></div></aside>
    {mobile && <div className="mobile-overlay" aria-hidden="true" onClick={() => setMobile(false)} />}
    <div className="main-area" ref={mainArea}><header className="topbar"><div className="header-location"><button ref={mobileTrigger} className="icon-btn mobile-menu" aria-label="Open menu" aria-controls="workspace-navigation" aria-expanded={mobile} onClick={() => setMobile(true)}><Menu size={22} /></button><div><div className="breadcrumbs">Workspace <ChevronRight size={13} /> {current?.label || 'Overview'}</div><div className="header-page">{current?.label || 'Wethaq'}</div></div></div><div className="header-actions"><GuidedDemo /><div ref={searchBox} className={`global-search ${searchExpanded ? 'expanded' : ''}`}><button ref={searchTrigger} type="button" className="global-search-trigger" aria-label="Open global search" onClick={() => { setSearchExpanded(true); setSearchOpen(true); setTimeout(() => searchInput.current?.focus(), 0); }}><Search size={17} /></button><input ref={searchInput} placeholder="Search records" aria-label="Global search" value={search} onChange={e => { setSearch(e.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} onKeyDown={e => { if (e.key === 'Enter' && candidates[0]) openSearchResult(candidates[0].url); }} /><kbd>⌘ K</kbd>{searchOpen && search.length > 1 && <div className="search-popover"><div className="popover-label">SEARCH RESULTS</div>{candidates.length ? candidates.map(c => <button key={c.id} onClick={() => openSearchResult(c.url)}><Search size={15} /><span><strong>{c.title}</strong><small>{c.id} · {c.sub}</small></span><ArrowRight size={14} /></button>) : <div className="popover-empty">No matching records</div>}</div>}</div><ThemeControl compact /><div className="bell-wrap" ref={alertsBox}><button aria-expanded={alertsOpen} className="icon-btn header-icon" aria-label={`${activeAlerts} active alerts`} title="Notifications" onClick={() => setAlertsOpen(v => !v)}><Bell size={19} />{activeAlerts > 0 && <span className="bell-count">{activeAlerts}</span>}</button>{alertsOpen && <div className="alert-popover"><div className="popover-header"><strong>Notifications</strong><span>{activeAlerts} active</span></div>{data.alerts.filter(a => !a.acknowledged).slice(0, 5).map(a => <div key={a.id} className="popover-alert"><AlertCircle size={17} /><div><strong>{a.title}</strong><p>{a.detail}</p><button onClick={() => { navigate(`/inventory?tab=alerts&search=${encodeURIComponent(a.title)}`); setAlertsOpen(false); }}>View alert</button></div><button aria-label={`Acknowledge ${a.title}`} onClick={() => ack(a.id)} className="mini-close"><CheckCircle2 size={16} /></button></div>)}{!activeAlerts && <div className="popover-empty">All alerts acknowledged</div>}<button className="popover-footer" onClick={() => { navigate('/inventory?tab=alerts'); setAlertsOpen(false); }}>Open all alerts <ArrowRight size={15} /></button></div>}</div><div className="vertical-divider" /><RoleSelector value={role} onChange={setRole} /><button className="icon-btn header-icon" aria-label="Sign out" title="Sign out" onClick={() => { logout(); navigate('/login'); }}><LogOut size={18} /></button></div></header>
      <main className="page-content" id="main-content" tabIndex={-1}>{children}</main><footer className="footer"><div className="footer-inner"><div className="footer-identity"><span className="footer-brand-mark"><img src="/brand/wathaq-olive-icon-light.svg" alt="" /></span><span className="footer-title"><strong>Wethaq</strong><small>King Saud University · © 2026</small></span></div><div className="footer-meta"><span className="footer-environment"><span className="synthetic-dot" /> Synthetic academic prototype</span><button className="footer-about" onClick={() => setAbout(true)}>About this prototype <ArrowRight size={14} aria-hidden="true" /></button><span className="footer-version">v1.0</span></div></div></footer></div>
    {toast && <div className="toast" role="status"><span className="toast-icon"><CheckCircle2 size={19} /></span><div><strong>Wethaq</strong><span>{toast}</span></div><button onClick={dismiss} aria-label="Dismiss notification"><X size={16} /></button></div>}
    <Modal open={about} onClose={() => setAbout(false)} title="About this prototype" description="Scope and provenance of this academic demonstration"><div className="about-modal"><div className="about-logo-surface"><img src={resolved === 'dark' ? '/brand/wathaq-olive-lockup-light.svg' : '/brand/wathaq-olive-lockup-dark.svg'} alt="Wethaq — trust accompanies every shipment" /></div><p><strong>Wethaq</strong> is a King Saud University graduation project prototype exploring demand forecasting, inventory planning, and permissioned-blockchain transaction workflows</p><ul><li>All data, identities, and shipments shown are synthetic or simulated</li><li>Forecasts and replenishment recommendations support human decisions only. No purchases are initiated</li><li>A committed ledger record confirms a permitted submitted record, not independent proof of physical delivery or cargo condition</li><li>Lead times, stockouts, inventory policy results, and performance estimates use assumptions and simulation, not field observations</li><li>The aviation demand dataset and constructed logistics scenarios are separate synthetic sources, not real operational transfers</li></ul><p className="fine-print">Academic prototype · GP481 · Fall 2026</p><div className="about-actions">{preference !== 'system' && <Button variant="secondary" size="sm" onClick={() => setPreference('system')}>Use system appearance</Button>}<Button variant="secondary" size="sm" onClick={() => { setAbout(false); setConfirmReset(true); }}>Reset demonstration data</Button></div></div></Modal>
    <Modal open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demonstration" description="Restore original synthetic records without changing your theme or role" footer={<><Button variant="secondary" onClick={() => setConfirmReset(false)}>Keep changes</Button><Button variant="danger" onClick={() => { resetDemo(); setConfirmReset(false); }}>Reset data</Button></>}>
      <p>This clears requests, receipts, alerts and user changes made during this session — original synthetic examples will be restored</p>
    </Modal>
  </div>;
}
class Boundary extends React.Component<{ children: React.ReactNode; }, { failed: boolean; }> { state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; } render() { return this.state.failed ? <div className="state-page"><span className="state-icon"><AlertCircle size={30} /></span><h2>Something didn't load correctly</h2><p>This demonstration view encountered an error. You can reload safely without losing your session changes</p><Button onClick={() => location.reload()}>Reload application</Button></div> : this.props.children; } }
function AppRoutes() { const { authenticated } = useStore(); return <Routes><Route path="/login" element={authenticated ? <Navigate to="/overview" replace /> : <Login />} /><Route path="/overview" element={<Guard permission="overview"><Shell><LoadGate page="overview"><Overview /></LoadGate></Shell></Guard>} /><Route path="/forecasts" element={<Guard permission="forecasts"><Shell><LoadGate page="forecasts"><Forecasts /></LoadGate></Shell></Guard>} /><Route path="/inventory" element={<Guard permission="inventory"><Shell><LoadGate page="inventory"><Inventory /></LoadGate></Shell></Guard>} /><Route path="/shipments" element={<Guard permission="shipments"><Shell><LoadGate page="shipments"><Shipments /></LoadGate></Shell></Guard>} /><Route path="/users" element={<Guard permission="users"><Shell><LoadGate page="users"><UsersPage /></LoadGate></Shell></Guard>} /><Route path="/" element={<Navigate to={authenticated ? '/overview' : '/login'} replace />} /><Route path="*" element={<div className="state-page"><h2>Page not found</h2><p>The address doesn't match a Wethaq page</p><Link to="/overview" className="btn btn-primary">Return to overview</Link></div>} /></Routes>; }
export default function App() { return <ThemeProvider><Provider><BrowserRouter><ScrollToTop /><Boundary><AppRoutes /></Boundary></BrowserRouter></Provider></ThemeProvider>; }
