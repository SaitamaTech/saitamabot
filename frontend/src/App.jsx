import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createSupabaseClient } from './supabase.js';
import {
  Activity, ArrowDownRight, ArrowUpRight, Check, CheckCircle2, ChevronDown, ChevronRight,
  CircleDashed, Clock3, Copy, ExternalLink, Github, LayoutDashboard, LockKeyhole, LogOut,
  Menu, MessageSquare, Radio, Search, Shield, ShieldAlert, Smartphone, Sparkles, TerminalSquare,
  Users, Wifi, WifiOff, X, Zap,
} from 'lucide-react';

const GITHUB = 'https://github.com/SaitamaTech';
const initialCounts = { total: 0, implemented: 0, notImplemented: 0 };

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
  return data;
}

function Brand({ small = false }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}>
    <div className="brand-mark"><span>S</span><i /></div>
    <div className="brand-copy"><strong>SAITAMA<span>BOT</span></strong><small>POWERED BY SAITAMA TECH</small></div>
  </div>;
}

function ConnectionPill({ status }) {
  const connected = status === 'connected';
  return <span className={`connection-pill ${connected ? 'is-connected' : 'is-offline'}`}><i />{connected ? 'CONNECTED' : String(status || 'disconnected').replaceAll('_', ' ').toUpperCase()}</span>;
}

function AuthScreen({ onAuth, initialError = '', supabaseClient, googleAuthStatus, googleAuthError }) {
  const [mode, setMode] = useState('login');
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [showPassword, setShowPassword] = useState(false);
  const signInWithGoogle = async () => {
    setError(''); setBusy(true);
    if (!supabaseClient) {
      setError(googleAuthError || 'Google sign-in is not configured on the server. Please use email and password.');
      setBusy(false);
      return;
    }
    try {
      const { error: googleError } = await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (googleError) setError(googleError.message);
    } catch (googleError) {
      setError(googleError.message || 'Could not start Google sign-in.');
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api(`/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(values) });
      onAuth(result.user);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <div className="auth-page">
    <div className="auth-ambient ambient-one" /><div className="auth-ambient ambient-two" />
    <nav className="auth-nav"><Brand /><a href={GITHUB} target="_blank" rel="noreferrer" className="github-link"><Github size={16} /> View on GitHub <ExternalLink size={13} /></a></nav>
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="eyebrow"><span className="eyebrow-dot" /> PRIVATE BETA · SAITAMA TECH</div>
        <h1>Your WhatsApp.<br /><span>Your rules.</span><br />Powered by Saitama.</h1>
        <p>One secure control room for intelligent automation, helpful tools, and the communities you manage.</p>
        <div className="hero-actions"><a className="button button-primary" href="#account">Get started <ChevronRight size={16} /></a><a className="button button-ghost" href="#features">Explore features</a></div>
        <div className="hero-visual" aria-hidden="true">
          <div className="visual-orbit orbit-a" /><div className="visual-orbit orbit-b" />
          <div className="visual-core"><div className="core-glow" /><Zap size={40} fill="currentColor" strokeWidth={1.1} /></div>
          <div className="float-card float-card-top"><span className="float-icon"><Radio size={14} /></span><div><b>REAL-TIME</b><small>Live session updates</small></div><span className="signal-wave"><i /><i /><i /></span></div>
          <div className="float-card float-card-bottom"><span className="float-icon orange"><TerminalSquare size={14} /></span><div><b>COMMAND READY</b><small>Modular & searchable</small></div><span className="live-dot" /></div>
          <div className="visual-label label-left">SECURE SESSION</div><div className="visual-label label-right">ENCRYPTED</div>
        </div>
        <div className="trust-row"><span><LockKeyhole size={13} /> Encrypted session files</span><span><Shield size={13} /> Isolated account access</span></div>
      </section>
      <section className="auth-card" id="account">
        <div className="card-kicker">YOUR CONTROL ROOM</div>
        <h2>{mode === 'login' ? 'Welcome back.' : 'Create your account.'}</h2>
        <p className="muted">{mode === 'login' ? 'Sign in to manage your connected WhatsApp session.' : 'Set up an account to start configuring your bot.'}</p>
        <div className="auth-tabs"><button className={mode === 'login' ? 'selected' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button className={mode === 'register' ? 'selected' : ''} onClick={() => { setMode('register'); setError(''); }}>Create account</button></div>
        <button className="button google-auth-button" type="button" onClick={signInWithGoogle} disabled={busy || googleAuthStatus !== 'ready'}>
          {googleAuthStatus === 'loading' ? <span className="spinner" /> : <GoogleMark />}
          {googleAuthStatus === 'loading' ? 'Checking Google sign-in…' : googleAuthStatus === 'ready' ? 'Continue with Google' : 'Google sign-in unavailable'}
        </button>
        {googleAuthStatus === 'unconfigured' && <p className="google-auth-help">The server needs `SUPABASE_URL` and a public anon/publishable `SUPABASE_ANON_KEY`—not a service-role key.</p>}
        {googleAuthStatus === 'error' && <p className="google-auth-help">{googleAuthError}</p>}
        <div className="auth-divider auth-divider-compact"><span /><small>OR USE EMAIL</small><span /></div>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Display name<input autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} placeholder="Your name" maxLength={80} required /></label>}
          <label>Email address<input type="email" autoComplete="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} placeholder="you@example.com" maxLength={254} required /></label>
          <label>Password<div className="password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={values.password} onChange={(e) => setValues({ ...values, password: e.target.value })} placeholder={mode === 'login' ? 'Your password' : 'At least 12 characters'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required /><button type="button" className="text-button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
          {error && <div className="form-error"><ShieldAlert size={15} />{error}</div>}
          <button disabled={busy} className="button button-primary auth-submit" type="submit">{busy ? <><span className="spinner" /> Please wait</> : <>{mode === 'login' ? 'Sign in securely' : 'Create account'} <ChevronRight size={16} /></>}</button>
        </form>
        <div className="auth-divider"><span /> <small>BUILT FOR PRIVACY</small> <span /></div>
        <p className="security-note"><LockKeyhole size={13} /> Your WhatsApp credentials are never exposed to the browser.</p>
      </section>
    </main>
    <section className="auth-feature-row" id="features"><div><span className="feature-icon"><Smartphone size={17} /></span><b>Pair securely</b><small>Link with a WhatsApp pairing code.</small></div><div><span className="feature-icon"><TerminalSquare size={17} /></span><b>Automate clearly</b><small>Know what is implemented and what needs setup.</small></div><div><span className="feature-icon"><Activity size={17} /></span><b>Stay in control</b><small>Monitor status and delete your session any time.</small></div></section>
    <footer className="auth-footer"><span>© SAITAMA TECH</span><span>WhatsApp integration is unofficial and may be affected by platform restrictions.</span><a href={GITHUB} target="_blank" rel="noreferrer">GitHub <ExternalLink size={12} /></a></footer>
  </div>;
}

function GoogleMark() {
  return <svg aria-hidden="true" viewBox="0 0 48 48" className="google-mark">
    <path fill="#4285F4" d="M47.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h13.49c-.58 2.96-2.27 5.48-4.75 7.18l7.28 5.65c4.25-3.92 6.96-9.69 6.96-17.3Z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.28-5.65c-2.02 1.35-4.6 2.15-8.63 2.15-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z" />
    <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1 0-9.18l-7.98-6.19a24 24 0 0 0 0 21.56l7.98-6.19Z" />
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" />
  </svg>;
}

function Sidebar({ page, setPage, user, ownerAccess, onLogout, open, setOpen }) {
  const items = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'whatsapp', label: 'WhatsApp session', icon: Smartphone },
    { id: 'commands', label: 'Command library', icon: TerminalSquare, badge: '298' },
    ...(ownerAccess ? [{ id: 'admin', label: 'Owner panel', icon: Shield }] : []),
  ];
  return <>
    {open && <button aria-label="Close navigation" className="mobile-scrim" onClick={() => setOpen(false)} />}
    <aside className={`sidebar ${open ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand small /><button className="sidebar-close" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <div className="workspace-tag"><span className="workspace-mark">S</span><div><small>WORKSPACE</small><b>Personal instance</b></div><ChevronDown size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="side-nav">{items.map(({ id, label, icon: Icon, badge }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setOpen(false); }}><Icon size={17} /><span>{label}</span>{badge && <i className="nav-count">{badge}</i>}{page === id && <ChevronRight className="nav-chevron" size={14} />}</button>)}</nav>
      <div className="sidebar-spacer" />
      <div className="side-security"><span><Shield size={15} /></span><div><b>Sessions are private</b><small>Encrypted at rest</small></div><div className="security-check"><Check size={12} /></div></div>
      <div className="sidebar-bottom"><a href={GITHUB} target="_blank" rel="noreferrer" className="side-github"><Github size={15} /> Saitama Tech on GitHub <ExternalLink size={11} /></a><div className="profile-row"><div className="avatar">{(user?.name || 'S').slice(0,1).toUpperCase()}</div><div className="profile-copy"><b>{user?.name || 'Account'}</b><small>{user?.email}</small></div><button aria-label="Sign out" onClick={onLogout} className="logout-button"><LogOut size={16} /></button></div></div>
    </aside>
  </>;
}

function StatCard({ label, value, note, icon: Icon, accent = 'red', trend }) {
  return <article className={`stat-card stat-${accent}`}><div className="stat-top"><span>{label}</span><span className="stat-icon"><Icon size={17} /></span></div><div className="stat-value">{value}</div><div className="stat-bottom"><span>{note}</span>{trend && <i><ArrowUpRight size={13} /> {trend}</i>}</div></article>;
}

function Overview({ data, integrations, setPage }) {
  const connected = data?.session?.status === 'connected';
  const count = Number(data?.stats?.commands_executed || 0).toLocaleString();
  return <div className="page-content">
    <div className="welcome-line"><div><div className="page-eyebrow">CONTROL ROOM <span>·</span> PERSONAL INSTANCE</div><h1>Welcome back, {data?.user?.name?.split(' ')[0] || 'there'}.</h1><p className="muted">Your WhatsApp automation, at a glance.</p></div><button className="button button-primary connect-quick" onClick={() => setPage(connected ? 'whatsapp' : 'whatsapp')}><Smartphone size={15} /> {connected ? 'Manage session' : 'Connect WhatsApp'} <ChevronRight size={15} /></button></div>
    <div className="integration-warning"><span className="warning-icon"><ShieldAlert size={16} /></span><div><b>Configuration check</b><p>{!integrations?.pairingAvailable ? 'Pairing is disabled until SESSION_ENCRYPTION_KEY is set on the server. ' : ''}{!integrations?.channelConfigured ? 'Command replies need WHATSAPP_CHANNEL_URL to include the official channel link. ' : ''}{!integrations?.aiConfigured ? 'AI commands need an OpenAI-compatible API key.' : ''}</p></div><button onClick={() => setPage('whatsapp')}>Review setup <ChevronRight size={14} /></button></div>
    <div className="stats-grid"><StatCard label="WhatsApp status" value={connected ? 'Connected' : 'Offline'} note={connected ? `+${data?.session?.phone || 'number linked'}` : 'No active session'} icon={connected ? Wifi : WifiOff} accent={connected ? 'green':'red'} /><StatCard label="Commands executed" value={count} note="Since your account was created" icon={TerminalSquare} accent="orange" /><StatCard label="Messages received" value={Number(data?.stats?.messages_received || 0).toLocaleString()} note="Across this bot session" icon={MessageSquare} accent="violet" /><StatCard label="Command library" value={data?.catalog?.implemented || 0} note={`of ${data?.catalog?.total || 0} catalogued`} icon={Zap} accent="yellow" /></div>
    <div className="overview-grid">
      <section className="panel connection-panel"><div className="panel-heading"><div><div className="panel-kicker">SESSION</div><h2>WhatsApp connection</h2></div><ConnectionPill status={data?.session?.status} /></div><div className="connection-card"><div className={`connection-emblem ${connected ? 'emblem-live' : ''}`}><Smartphone size={24} /><span /></div><div className="connection-copy"><b>{connected ? `+${data?.session?.phone || 'WhatsApp number'}` : 'No device linked yet'}</b><small>{connected ? `Connected ${data?.session?.connected_at ? new Date(data.session.connected_at).toLocaleString() : 'now'}` : 'Link your account with a private pairing code.'}</small></div><button className="icon-button" onClick={() => setPage('whatsapp')} aria-label="Open WhatsApp settings"><ChevronRight size={17} /></button></div><div className="panel-bottom-note"><Shield size={14} /><span>Encrypted session data stays on your server.</span><button onClick={() => setPage('whatsapp')}>{connected ? 'Manage' : 'Connect'} <ArrowUpRight size={12} /></button></div></section>
      <section className="panel activity-panel"><div className="panel-heading"><div><div className="panel-kicker">LIVE FEED</div><h2>Recent activity</h2></div><span className="live-label"><i /> LIVE</span></div>{data?.activity?.length ? <div className="activity-list">{data.activity.slice(0,5).map((item,i)=><div className="activity-item" key={`${item.command}-${item.created_at}-${i}`}><span className="activity-symbol"><TerminalSquare size={14} /></span><div className="activity-info"><b>.{item.command}</b><small>{item.category}</small></div><time>{new Date(item.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><span className={`activity-result ${item.succeeded?'ok':'failed'}`}>{item.succeeded?'OK':'ERR'}</span></div>)}</div> : <div className="empty-activity"><div className="empty-icon"><Activity size={20} /></div><b>Nothing here yet</b><small>Recent command activity appears when your WhatsApp session is connected.</small><button onClick={() => setPage('commands')}>Browse commands <ChevronRight size={13} /></button></div>}</section>
    </div>
    <div className="notice-bar"><span className="notice-mark"><i /></span><p><b>Unofficial integration.</b> SAITAMA BOT uses WhatsApp Web connectivity. Platform restrictions may affect availability; use responsibly and keep a backup of your account.</p><a href="https://faq.whatsapp.com/" target="_blank" rel="noreferrer">Learn more <ExternalLink size={12} /></a></div>
  </div>;
}

function WhatsAppPage({ data, integrations, onRefresh, pairCode }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [disconnectBusy, setDisconnectBusy] = useState(false);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const status = data?.session?.status || 'disconnected';
  const connected = status === 'connected';
  const pairing = status === 'pairing' || status === 'connecting';
  useEffect(() => {
    if (pairCode) setCode(pairCode);
    else if (!pairing) setCode('');
  }, [pairCode, pairing]);
  useEffect(() => {
    api('/api/whatsapp/status')
      .then(result => { if (result.pairingCode) setCode(result.pairingCode); })
      .catch(e => setError(e.message));
  }, []);
  const requestCode = async (event) => {
    event.preventDefault(); setError(''); setNotice(''); setCode(''); setBusy(true);
    try { await api('/api/whatsapp/pair',{method:'POST',body:JSON.stringify({phone})}); setNotice('Pairing request started. Waiting for a code from WhatsApp…'); await onRefresh(); }
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  };
  const refreshCode = async () => {
    setError(''); setNotice(''); setCode(''); setRefreshBusy(true);
    try {
      await api('/api/whatsapp/pair/refresh',{method:'POST',body:'{}'});
      setNotice('A new code was requested. Enter it as soon as it appears.');
    } catch(e) { setError(e.message); }
    finally { setRefreshBusy(false); }
  };
  const disconnect = async () => {
    if(!window.confirm('Disconnect WhatsApp and permanently delete this encrypted session from this server?'))return;
    setDisconnectBusy(true);setError('');
    try {await api('/api/whatsapp/disconnect',{method:'POST',body:'{}'});setCode('');setNotice('Session disconnected and deleted.');await onRefresh();}
    catch(e){setError(e.message);}
    finally{setDisconnectBusy(false);}
  };
  const copyCode = async () => { try{await navigator.clipboard.writeText(code);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setError('Clipboard access was denied. Select and copy the code manually.');} };
  return <div className="page-content">
    <div className="page-title-row"><div><div className="page-eyebrow">CONNECTION MANAGEMENT</div><h1>WhatsApp session</h1><p className="muted">Link your WhatsApp account using a one-time pairing code.</p></div><ConnectionPill status={status} /></div>
    <div className="integration-warning"><span className="warning-icon"><ShieldAlert size={16} /></span><div><b>Unofficial WhatsApp Web integration</b><p>This connection method may be affected by WhatsApp restrictions. Pair only your own account. Never share the code.</p></div></div>
    {!integrations?.pairingAvailable && <div className="setup-blocker"><LockKeyhole size={18}/><div><b>Secure pairing is not configured</b><p>The administrator must set <code>SESSION_ENCRYPTION_KEY</code> to a random 32-byte key encoded as 64 hexadecimal characters, then restart the server.</p></div></div>}
    <div className="pair-grid">
      <section className="panel pair-panel"><div className="panel-heading"><div><div className="panel-kicker">STEP 01 — REQUEST</div><h2>Connect your device</h2></div><div className="step-count">01<span>/02</span></div></div>
        <p className="pair-intro">Enter your WhatsApp number with its country calling code. We’ll request a pairing code from WhatsApp and send it privately to this dashboard.</p>
        <form onSubmit={requestCode} className="pair-form"><label htmlFor="phone">PHONE NUMBER <span>INTERNATIONAL FORMAT</span></label><div className="phone-input"><span>+</span><input id="phone" inputMode="tel" autoComplete="tel" placeholder="2348012345678" value={phone.replace(/^\+/, '')} onChange={e=>setPhone(e.target.value.replace(/[^\d+]/g,''))} minLength={7} maxLength={16} required /></div><small>Include your country code. Example: 234… for Nigeria.</small>{error&&<div className="form-error"><ShieldAlert size={15}/>{error}</div>}{notice&&<div className="form-success"><CheckCircle2 size={15}/>{notice}</div>}<button className="button button-primary pair-submit" type="submit" disabled={busy||pairing||!integrations?.pairingAvailable||connected}>{busy?<><span className="spinner"/> Requesting…</>:pairing?<><Radio size={15}/> Code already requested</>:<><Radio size={15}/> Generate pairing code <ChevronRight size={15}/></>}</button></form>
        {code&&<div className="pair-code"><div><span className="panel-kicker">YOUR ONE-TIME CODE</span><small>Enter it in WhatsApp. Do not share it.</small></div><div className="code-display">{code.match(/.{1,4}/g)?.join(' ')}</div><div className="pair-code-actions"><button className="button button-secondary copy-button" onClick={copyCode}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Copied':'Copy code'}</button><button className="button button-secondary copy-button" onClick={refreshCode} disabled={refreshBusy||!pairing}>{refreshBusy?<><span className="spinner"/> Requesting</>:<><Radio size={14}/> Get a new code</>}</button></div></div>}
        <div className="pair-status"><span className={pairing?'pulse':'status-static'}><CircleDashed size={15}/></span><div><b>{connected?'Device connected':pairing?'Waiting for WhatsApp':'Ready when you are'}</b><small>{connected?'Your account is linked.':pairing?'Keep this page open while entering the code.':'Your session will appear here when connected.'}</small></div><span className="pair-live"><i/> LIVE STATUS</span></div>
        {connected&&<div className="danger-zone"><div><b>Disconnect this account</b><small>Revokes and deletes this server-side session.</small></div><button disabled={disconnectBusy} className="button button-danger" onClick={disconnect}>{disconnectBusy?'Disconnecting…':'Disconnect & delete'}</button></div>}
        {!connected&&data?.session?.status==='disconnected'&&data?.session?.phone&&<div className="danger-zone"><div><b>Saved session metadata</b><small>Phone ending in {data.session.phone.slice(-4)} · Session not active.</small></div><button className="button button-danger" onClick={disconnect}>Delete session</button></div>}
      </section>
      <section className="panel instructions-panel"><div className="panel-heading"><div><div className="panel-kicker">STEP 02 — LINK</div><h2>Enter the code</h2></div><Smartphone size={20} className="muted-icon" /></div><div className="instruction-steps"><div className="instruction-step"><span>1</span><div><b>Open WhatsApp</b><small>On the phone you want to link.</small></div></div><div className="instruction-step"><span>2</span><div><b>Go to Linked Devices</b><small>WhatsApp Settings → Linked Devices.</small></div></div><div className="instruction-step"><span>3</span><div><b>Choose “Link a Device”</b><small>Tap “Link with phone number instead”.</small></div></div><div className="instruction-step"><span>4</span><div><b>Enter your pairing code</b><small>Return here to see the code and live status.</small></div></div></div><div className="instruction-foot"><LockKeyhole size={15}/><p>Codes are sent only to your signed-in browser session. Authentication keys are AES-256-GCM encrypted on the server.</p></div></section>
    </div>
  </div>;
}

function CommandsPage({ commands, categories, summary, loading }) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('All categories');
  const [filter,setFilter]=useState('all');
  const filtered=useMemo(()=>commands.filter(c=>{
    const text=`${c.name} ${c.category} ${c.description} ${c.usage}`.toLowerCase();
    const ready=c.status==='implemented'&&c.configured!==false;
    return text.includes(query.trim().toLowerCase()) && (category==='All categories'||c.category===category) && (filter==='all'||(filter==='active'?ready:filter==='setup'?c.status==='implemented'&&c.configured===false:c.status!=='implemented'));
  }),[commands,query,category,filter]);
  return <div className="page-content commands-page">
    <div className="page-title-row"><div><div className="page-eyebrow">DOCUMENTATION · {summary.total || 298} COMMANDS</div><h1>Command library</h1><p className="muted">Search every requested command and see exactly what is ready.</p></div><span className="active-count"><i /> {summary.ready || 0} READY</span></div>
    <div className="commands-hero"><div className="commands-orbit"><div><TerminalSquare size={27}/></div><i/><i/><i/></div><div><div className="panel-kicker">MODULAR AUTOMATION</div><h2>Clarity before commands.</h2><p>Only commands with real handlers are marked active. Unavailable integrations and unimplemented work stay visibly labeled.</p></div><div className="command-stats"><div><b>{summary.ready||0}</b><small>READY NOW</small></div><span/><div><b>{summary.needsSetup||0}</b><small>NEEDS SETUP</small></div><span/><div><b>{summary.notImplemented||0}</b><small>NOT BUILT</small></div></div></div>
    <div className="command-toolbar"><div className="search-box"><Search size={16}/><input aria-label="Search commands" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search commands, description, usage…" />{query&&<button onClick={()=>setQuery('')} aria-label="Clear search"><X size={14}/></button>}</div><div className="select-wrap"><select aria-label="Filter by category" value={category} onChange={e=>setCategory(e.target.value)}><option>All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select><ChevronDown size={14}/></div></div>
    <div className="filter-tabs"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>All <span>{summary.total||298}</span></button><button className={filter==='active'?'selected':''} onClick={()=>setFilter('active')}>Ready <span>{summary.ready||0}</span></button><button className={filter==='setup'?'selected':''} onClick={()=>setFilter('setup')}>Needs setup <span>{summary.needsSetup||0}</span></button><button className={filter==='planned'?'selected':''} onClick={()=>setFilter('planned')}>Not built <span>{summary.notImplemented||0}</span></button><div className="results-count">{loading?'Loading…':`${filtered.length} result${filtered.length===1?'':'s'}`}</div></div>
    {loading?<div className="loading-box"><span className="spinner"/> Loading command inventory…</div>:filtered.length?<div className="command-grid">{filtered.map(command=>{const ready=command.status==='implemented'&&command.configured!==false;const needsSetup=command.status==='implemented'&&!ready;return <article className={`command-card ${ready?'command-active':''} ${needsSetup?'needs-config':''}`} key={`${command.category}-${command.name}`}><div className="command-card-top"><span className="command-name">{command.name}</span><span className={`command-status ${ready?'status-active':needsSetup?'status-setup':'status-planned'}`}>{ready?<><Check size={11}/> ACTIVE</>:needsSetup?'NEEDS SETUP':'NOT BUILT'}</span></div><p>{command.description}</p><div className="command-example"><small>USAGE</small><code>{command.usage}</code></div><div className="command-meta"><span>{command.category}</span><span className="permission-badge">{command.permission}</span></div>{needsSetup&&<div className="command-unavailable setup-note"><CircleDashed size={13}/> Handler ready; {command.apiRequirement} is not configured</div>}{command.status!=='implemented'&&<div className="command-unavailable"><CircleDashed size={13}/> No handler registered yet</div>}</article>})}</div>:<div className="empty-search"><Search size={20}/><b>No commands match that filter.</b><span>Try a different term or category.</span></div>}
  </div>;
}

function AdminPage({ data, onLoadUsers }) {
  const [users,setUsers]=useState([]);const [loading,setLoading]=useState(false);const [error,setError]=useState('');
  const load=async()=>{setLoading(true);setError('');try{const result=await onLoadUsers();setUsers(result.users||[]);}catch(e){setError(e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const totalConnections=(data?.connections||[]).reduce((a,x)=>a+Number(x.count),0);
  const connected=(data?.connections||[]).find(x=>x.status==='connected')?.count||0;
  return <div className="page-content"><div className="page-title-row"><div><div className="page-eyebrow">RESTRICTED · OWNER ACCESS</div><h1>Owner panel</h1><p className="muted">Operational metrics and registered accounts.</p></div><span className="owner-badge"><Shield size={14}/> OWNER</span></div><div className="admin-stats"><StatCard label="Registered users" value={data?.users||0} note="Total accounts" icon={Users} accent="red"/><StatCard label="Active connections" value={connected} note={`${totalConnections} session records`} icon={Wifi} accent="green"/><StatCard label="Commands executed" value={Number(data?.commands||0).toLocaleString()} note="All user accounts" icon={TerminalSquare} accent="orange"/><StatCard label="API uptime" value={`${Math.floor((data?.uptimeSeconds||0)/3600)}h`} note="Since last server start" icon={Clock3} accent="violet"/></div><section className="panel users-panel"><div className="panel-heading"><div><div className="panel-kicker">ACCOUNT MANAGEMENT</div><h2>Registered accounts</h2></div><button className="button button-secondary" onClick={load} disabled={loading}>{loading?<span className="spinner"/>:<Activity size={14}/>} Refresh</button></div>{error&&<div className="form-error">{error}</div>}{users.length?<div className="user-table-wrap"><table><thead><tr><th>ACCOUNT</th><th>CREATED</th><th>SESSION</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><b>{u.name}</b><small>{u.email}</small></td><td>{new Date(u.created_at).toLocaleDateString()}</td><td><ConnectionPill status={u.status||'disconnected'}/></td></tr>)}</tbody></table></div>:<div className="empty-activity"><div className="empty-icon"><Users size={20}/></div><b>{loading?'Loading accounts…':'No account records to display'}</b><small>Only the configured owner account can view this page.</small></div>}</section><div className="notice-bar"><span className="notice-mark"><i/></span><p><b>Limited administration scope.</b> User/session counts are live; global configuration controls, audit logs, and arbitrary session management have not been implemented.</p></div></div>;
}

export default function App() {
  const [user,setUser]=useState(null);const [page,setPage]=useState('overview');const [sidebarOpen,setSidebarOpen]=useState(false);
  const [data,setData]=useState(null);const [integrations,setIntegrations]=useState(null);const [commands,setCommands]=useState([]);const [categories,setCategories]=useState([]);const [summary,setSummary]=useState(initialCounts);const [catalogLoading,setCatalogLoading]=useState(false);const [ownerData,setOwnerData]=useState(null);const [authChecking,setAuthChecking]=useState(true);const [toast,setToast]=useState('');
  const [authError,setAuthError]=useState('');
  const [supabaseClient,setSupabaseClient]=useState(null);
  const [googleAuthStatus,setGoogleAuthStatus]=useState('loading');
  const [googleAuthError,setGoogleAuthError]=useState('');
  const authBootstrapStarted = useRef(false);
  const clearOAuthCallbackParams=()=>{
    const url=new URL(window.location.href);
    if(!url.searchParams.has('code')&&!url.searchParams.has('error'))return;
    for(const key of ['code','error','error_code','error_description'])url.searchParams.delete(key);
    window.history.replaceState({},document.title,`${url.pathname}${url.search}${url.hash}`);
  };
  const refresh=useCallback(async()=>{if(!user)return;try{const result=await api('/api/dashboard');setData(result);return result;}catch(e){if(e.message.includes('Sign in')||e.message.includes('expired'))setUser(null);throw e;}},[user]);
  const loadCatalog=useCallback(async()=>{setCatalogLoading(true);try{const result=await api('/api/catalog');setCommands(result.commands);setCategories(result.categories);setSummary(result.summary);}catch(e){setToast(e.message);}finally{setCatalogLoading(false);}},[]);
  useEffect(()=>{
    if(authBootstrapStarted.current)return;
    authBootstrapStarted.current=true;
    const initializeAuth=async()=>{
      let client=null;
      try{
        const config=await api('/api/integrations');
        setIntegrations(config);
        if(config.supabaseUrl&&config.supabaseAnonKey){
          client=await createSupabaseClient(config.supabaseUrl,config.supabaseAnonKey);
        }
        setSupabaseClient(client);
        setGoogleAuthStatus(client?'ready':'unconfigured');
      }catch(error){
        setGoogleAuthError('Could not load Google sign-in settings from the server. Please try again later.');
        setGoogleAuthStatus('error');
      }
      try{
        const oauthError=new URLSearchParams(window.location.search).get('error_description');
        if(oauthError)throw new Error(oauthError);
        const oauthCallback=new URLSearchParams(window.location.search).has('code')||window.location.hash.includes('access_token=');
        if(oauthCallback&&!client)throw new Error(googleAuthError||'Google sign-in is not configured on the server.');
        if(client){
          const {data:sessionData,error:sessionError}=await client.auth.getSession();
          if(sessionError)throw sessionError;
          if(sessionData.session){
            let result;let exchangeError;
            try{result=await api('/api/auth/google',{method:'POST',body:JSON.stringify({accessToken:sessionData.session.access_token})});}
            catch(error){exchangeError=error;}
            const {error:signOutError}=await client.auth.signOut();
            if(exchangeError)throw exchangeError;
            if(signOutError)throw signOutError;
            setUser(result.user);
            return;
          }
        }
        const result=await api('/api/auth/me');
        setUser(result.user);
      }catch(error){
        if(window.location.search.includes('error')||error.message!=='Sign in to continue.')setAuthError(error.message);
      }finally{clearOAuthCallbackParams();setAuthChecking(false);}
    };
    initializeAuth();
  },[]);
  useEffect(()=>{if(!user)return;refresh().catch(()=>{});},[user,refresh]);
  useEffect(()=>{if(page==='commands'&&!commands.length)loadCatalog();},[page,commands.length,loadCatalog]);
  useEffect(()=>{
    if(!user)return;
    const socket=io({withCredentials:true,transports:['websocket','polling']});
    socket.on('connection:status',event=>{setData(previous=>previous?{...previous,session:{...previous.session,status:event.status,...(event.phone?{phone:event.phone}:{}),...(event.message?{last_disconnect:event.message}:{})}}:previous);if(!['pairing','connecting'].includes(event.status))setPairCode('');if(event.message)setToast(event.message);});
    socket.on('pairing:code',event=>{window.dispatchEvent(new CustomEvent('saitama-pairing-code',{detail:event.code}));setToast('Pairing code received.');});
    socket.on('command:activity',()=>refresh().catch(()=>{}));
    return()=>socket.disconnect();
  },[user,refresh]);
  const [pairCode,setPairCode]=useState('');
  useEffect(()=>{const listener=e=>setPairCode(e.detail||'');window.addEventListener('saitama-pairing-code',listener);return()=>window.removeEventListener('saitama-pairing-code',listener);},[]);
  const handleAuth=(newUser)=>{setUser(newUser);setData(null);setPage('overview');};
  const handleLogout=async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'});}catch{}setUser(null);setData(null);setPage('overview');};
  const loadOwner=async()=>{const result=await api('/api/owner/overview');setOwnerData(result);return api('/api/owner/users');};
  useEffect(()=>{if(page==='admin'&&!ownerData)api('/api/owner/overview').then(setOwnerData).catch(e=>setToast(e.message));},[page,ownerData]);
  useEffect(()=>{if(toast){const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t);}},[toast]);
  if(authChecking)return <div className="boot-screen"><div className="boot-logo"><Zap size={21}/></div><span className="spinner"/><small>INITIALIZING CONTROL ROOM</small></div>;
  if(!user)return <AuthScreen onAuth={handleAuth} initialError={authError} supabaseClient={supabaseClient} googleAuthStatus={googleAuthStatus} googleAuthError={googleAuthError}/>;
  const pageLabels={overview:'Overview',whatsapp:'WhatsApp session',commands:'Command library',admin:'Owner panel'};
  const ownerAccess=Boolean(data?.ownerAccess);
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} user={user} ownerAccess={ownerAccess} onLogout={handleLogout} open={sidebarOpen} setOpen={setSidebarOpen}/><main className="main-area"><header className="topbar"><button className="mobile-menu" aria-label="Open menu" onClick={()=>setSidebarOpen(true)}><Menu size={19}/></button><div className="breadcrumb"><span>SAITAMA BOT</span><ChevronRight size={13}/><b>{pageLabels[page]||'Dashboard'}</b></div><div className="topbar-right"><span className="top-status"><i/> SYSTEM ONLINE</span><span className="top-divider"/><span className="top-avatar">{(user.name||'S')[0].toUpperCase()}</span></div></header>
    {!data?<div className="page-content loading-screen"><span className="spinner"/> Loading your workspace…</div>:page==='overview'?<Overview data={data} integrations={integrations} setPage={setPage}/>:page==='whatsapp'?<WhatsAppPage data={data} integrations={integrations} onRefresh={refresh} pairCode={pairCode}/>:page==='commands'?<CommandsPage commands={commands} categories={categories} summary={summary} loading={catalogLoading}/>:page==='admin'?<AdminPage data={ownerData} onLoadUsers={loadOwner}/>:null}
    <footer className="main-footer"><span>© SAITAMA TECH · {new Date().getFullYear()}</span><div><a href={GITHUB} target="_blank" rel="noreferrer"><Github size={13}/> GitHub <ExternalLink size={11}/></a><span>PRIVATE INSTANCE</span></div></footer></main>{toast&&<div className="toast"><CheckCircle2 size={15}/>{toast}<button onClick={()=>setToast('')}><X size={14}/></button></div>}</div>;
}
