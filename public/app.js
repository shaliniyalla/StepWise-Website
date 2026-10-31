const $ = (s, e = document) => e.querySelector(s), $$ = (s, e = document) => [...e.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let me = null, token = localStorage.sw_t, draft = {}, wz = null, curSvc = null, timer = null, unread = 0, activeReq = 0, waiting = 0, svcCache = [];
const ST = { 'Action Needed': 'act', Submitted: 'sub', 'Under Verification': 'rev', 'Pending Approval': 'pen', Approved: 'app', Rejected: 'rej', Completed: 'com' };
const badge = s => `<span class="b ${ST[s] || ''}">${esc(s === 'Action Needed' ? 'Action Needed: More Info' : s)}</span>`;
const FLOW = ['Submitted', 'Under Verification', 'Pending Approval', 'Approved', 'Completed'];
const ICON = { Certificate: '🎓', Scholarship: '💎', Permission: '🗓️', Card: '🪪', Records: '📜' };
const ini = n => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const dt = s => new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
const HOME = { student: '#/dashboard', staff: '#/work/queue', authority: '#/work/queue', admin: '#/admin/services' };
const NAV = {
  student: [['dashboard', 'Dashboard'], ['services', 'Services'], ['new', 'New request'], ['requests', 'My requests'], ['assistant', 'AI Assistant'], ['notifications', 'Notifications'], ['profile', 'Profile']],
  staff: [['work/queue', 'Verification queue'], ['work/forwarded', 'Forwarded'], ['work/approved', 'Approved'], ['work/rejected', 'Rejected'], ['notifications', 'Notifications'], ['profile', 'Profile']],
  authority: [['work/queue', 'Pending approval'], ['work/approved', 'Approved'], ['work/rejected', 'Rejected'], ['notifications', 'Notifications'], ['profile', 'Profile']],
  admin: [['admin/services', 'Services & workflows'], ['admin/users', 'Users & roles'], ['admin/requests', 'All requests'], ['admin/depts', 'Departments'], ['admin/reports', 'Reports'], ['notifications', 'Notifications'], ['profile', 'Profile']]
};
const ROLE = { student: 'Student', staff: 'Department Staff', authority: 'Approving Authority', admin: 'Administrator' };
const stepLabel = (s, svc) => s.kind === 'staff' ? `${svc.dept} verification` : `${svc.approver || 'Approving authority'} approval`;

function toast(m, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = m; $('#toasts').append(t); setTimeout(() => t.remove(), 3600); }
function confetti() { for (let i = 0; i < 60; i++) { const p = document.createElement('i'); p.className = 'cf'; p.style.cssText = `left:${Math.random() * 100}vw;background:hsl(${Math.random() * 360} 90% 60%);--x:${(Math.random() - .5) * 240}px;animation-delay:${Math.random() * .5}s`; document.body.append(p); setTimeout(() => p.remove(), 3000); } }
async function api(p, o = {}) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; let b = o.body;
  if (b && !(b instanceof FormData)) { h['Content-Type'] = 'application/json'; b = JSON.stringify(b); }
  const r = await fetch('/api' + p, { method: o.method || (b ? 'POST' : 'GET'), headers: h, body: b });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && me) logout(); throw new Error(d.error || 'Something went wrong'); }
  return d;
}
function logout() { localStorage.removeItem('sw_t'); token = null; me = null; draft = {}; wz = null; closeModal(); location.hash = ''; route(); }
window.logout = logout;
document.addEventListener('pointermove', e => { const c = e.target.closest && e.target.closest('.tilt'); if (!c) return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; c.style.setProperty('--ry', (x - .5) * 8 + 'deg'); c.style.setProperty('--rx', (.5 - y) * 8 + 'deg'); c.style.setProperty('--mx', x * 100 + '%'); c.style.setProperty('--my', y * 100 + '%'); });
document.addEventListener('pointerout', e => { const c = e.target.closest && e.target.closest('.tilt'); if (c) { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); } });

/* ---------- shell ---------- */
function V(html, active) {
  const nav = NAV[me.role];
  if (me.role === 'student') {
    $('#app').innerHTML = `<header class="top glass"><a class="logo" href="#/dashboard">StepWise</a><nav>${nav.map(([h, l]) => `<a href="#/${h}" class="${active === h ? 'on' : ''}">${l}${h === 'notifications' && unread ? `<em>${unread}</em>` : ''}${h === 'requests' && activeReq ? `<em>${activeReq}</em>` : ''}</a>`).join('')}</nav>${demoBar()}<div class="who"><span class="av">${ini(me.name)}</span><div><b>${esc(me.name)}</b><small>Student</small></div><button class="ghost sm" onclick="logout()">Log out</button></div></header><main class="wrap">${html}</main><button class="orb" id="orb" title="Ask StepWise AI">✦</button>`;
    $('#orb').onclick = toggleDrawer;
  } else {
    $('#app').innerHTML = `<aside class="side"><a class="logo" href="${HOME[me.role]}">StepWise</a><nav>${nav.map(([h, l]) => `<a href="#/${h}" class="${active === h ? 'on' : ''}">${l}${h === 'notifications' && unread ? `<em>${unread}</em>` : ''}${h === 'work/queue' && waiting ? `<em>${waiting}</em>` : ''}</a>`).join('')}</nav>${demoBar()}<div class="who"><span class="av">${ini(me.name)}</span><div><b>${esc(me.name)}</b><small>${ROLE[me.role]}</small></div></div><button class="ghost sm" onclick="logout()">Log out</button></aside><main class="main">${html}</main>`;
  }
  const wk = $('#wk'); if (wk) wk.onclick = () => walkthrough();
  $$('.who').forEach(w => { w.style.cursor = 'pointer'; w.title = 'View my profile'; w.onclick = e => { if (!e.target.closest('button')) location.hash = '#/profile'; }; });
  $('#drawer').classList.remove('open'); $('#drawer').innerHTML = '';
}
function toggleDrawer() { const d = $('#drawer'); if (d.classList.contains('open')) return d.classList.remove('open'); d.innerHTML = '<div class="chat"></div>'; mountChat($('.chat', d), curSvc ? curSvc.id : null, curSvc); d.classList.add('open'); }
const POP = ['How do I apply for a bonafide certificate?', 'What documents are required for an academic transcript?', 'How can I check my request status?', 'Which department handles an institutional no-dues certificate?', 'What should I do if my documents are incomplete?', 'How do I replace a lost student ID card?'];
function mountChat(el, sid, svc, o = {}) {
  const first = me.name.split(' ')[0], tm = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const qs = svc ? ['Which documents do I need?', 'What is the fee?', 'How long will it take?', 'Who approves it?'] : POP;
  el.innerHTML = `<div class="chat-h"><span class="ai"></span><div><b>StepWise Assistant</b><small>${svc ? 'Guidance for ' + esc(svc.name) : 'Verified answers to guided questions'}</small></div></div><div class="msgs"></div><div class="chips"><small style="width:100%">SUGGESTIONS</small>${qs.map(c => `<button>${esc(c)}</button>`).join('')}</div><form class="ask"><input placeholder="Pick a suggestion or ask about a service…"><button>➤</button></form><small class="note">Verified Knowledge Mode: answers come only from the college service data. Ask from the suggestions above.</small>`;
  const box = $('.msgs', el); let cur = sid;
  const add = (t, u) => { const d = document.createElement('div'); d.className = 'm ' + (u ? 'u' : 'a'); const p = document.createElement('div'); p.textContent = t; d.append(p); if (!u) { const f = document.createElement('div'); f.className = 'mf'; f.innerHTML = `<span>${tm()}</span><span>Verified Knowledge Mode</span>`; d.append(f); } box.append(d); box.scrollTop = 1e9; return d; };
  add(svc ? `Hi ${first}! I can walk you through ${svc.name} step by step. Choose a suggestion below.` : `Hi ${first}! I am your StepWise AI Administrative Advisor. I can guide you through service procedures, required documents, responsible departments and request tracking. Choose one of the suggested prompts below.`);
  async function send(t) {
    if (!t.trim()) return; add(t, 1);
    const w = add('Looking that up…'); w.classList.add('typing');
    try { const r = await api('/assistant', { body: { service_id: cur, message: t } }); w.classList.remove('typing'); w.firstChild.textContent = r.reply; if (r.service_id) { cur = r.service_id; if (o.onCtx) o.onCtx(r.service_id); } }
    catch (e) { w.classList.remove('typing'); w.firstChild.textContent = 'Sorry, I could not answer right now. Please try again.'; }
    box.scrollTop = 1e9;
  }
  $$('.chips button', el).forEach(b => b.onclick = () => send(b.textContent));
  $('form', el).onsubmit = e => { e.preventDefault(); const i = $('input', el); send(i.value); i.value = ''; };
  return { send };
}
/* ---------- demo walkthrough + role switcher ---------- */
const demoBar = () => `<div class="demobar"><button class="ghost sm" id="wk">▶ Demo Walkthrough</button></div>`;
function closeModal() { const m = $('#modal'); if (m) m.remove(); }
const SCEN = 'StepWise connects 4 college roles (Student, Department Staff, Approving Authority, Admin) over a single centralized data model. Any state update immediately propagates across all dashboards.';
const WK = [
  { r: 'student', h: '#/assistant', t: 'The student asks the AI Advisor', d: 'A student asks which documents a service needs. Answers come only from verified college service data, and the suggested questions show exactly what can be asked.' },
  { r: 'student', h: '#/new', t: 'The student submits a request', d: 'Select a service, fill in the application details, upload the checklist documents, review and submit. A unique request ID (SW-2026-xxxxx) is created and the request is routed to the right department automatically. Submit one now, then continue.' },
  { r: 'staff', h: '#/work/queue', t: 'Department staff verify the documents', d: 'The request is already in the staff Verification queue. Staff open each file, mark it Verified or Unclear scan, then approve and forward, ask for more documents, or reject with a reason.' },
  { r: 'authority', h: '#/work/queue', t: 'The approving authority approves', d: 'After forwarding, the request appears under Pending approval with the staff remarks. One click approves or rejects it.' },
  { r: 'staff', h: '#/work/approved', t: 'Staff mark it completed', d: 'Approved requests return to the department, which marks them Completed when the document is ready to collect.' },
  { r: 'student', h: '#/requests', t: 'The student sees every update', d: 'The tracker, status history and notifications have changed at each step. Same data, different dashboards.' },
  { r: 'admin', h: '#/admin/reports', t: 'The admin stays in control', d: 'Admin configures services, documents and approval steps, manages users, and sees live reports. Changes apply to new requests immediately.' }
];
function walkthrough(i) {
  i = i == null ? +(sessionStorage.wk || 0) : i; sessionStorage.wk = i; closeModal();
  const s = WK[i], m = document.createElement('div'); m.id = 'modal';
  m.innerHTML = `<div class="mb"><div class="md"><button class="x" id="mx">×</button><small class="cd">PROTOTYPE SCENARIO</small><p class="scn">${SCEN}</p><div class="dots">${WK.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'dn' : ''}"></i>`).join('')}</div><small class="cd" style="margin-top:16px">STEP ${i + 1} OF ${WK.length} · ${ROLE[s.r].toUpperCase()}</small><h2>${esc(s.t)}</h2><p class="mut">${esc(s.d)}</p><div class="acts">${me && me.role === s.r ? '<button class="btn" id="wgo">Go to this page →</button>' : `<button class="ghost" id="wgo" disabled>Log in as a ${ROLE[s.r]} to ${me ? 'view' : 'try'} this</button>`}</div><div class="foot2"><button class="ghost sm" id="wb" ${i ? '' : 'disabled'}>‹ Back</button><button class="ghost sm" id="wn">${i < WK.length - 1 ? 'Next ›' : 'Finish'}</button></div></div></div>`;
  document.body.append(m);
  $('#mx').onclick = closeModal; $('.mb', m).onclick = e => { if (e.target.classList.contains('mb')) closeModal(); };
  const g = $('#wgo'); if (g && !g.disabled) g.onclick = () => { closeModal(); location.hash = s.h; };
  $('#wb').onclick = () => walkthrough(i - 1); $('#wn').onclick = () => i < WK.length - 1 ? walkthrough(i + 1) : closeModal();
}

/* ---------- auth ---------- */
const ROLEHINT = { student: 'Browse services, upload documents and track your requests.', staff: 'Verify documents and forward requests for approval.', authority: 'Review forwarded requests and approve or reject.', admin: 'Manage services, workflows, users and reports.' };
function authView() {
  let mode = 'login', role = 'student';
  $('#app').innerHTML = `<div class="auth"><section class="hero"><a class="logo">StepWise</a><div class="hc"><h1>College paperwork,<br>one clear step at a time.</h1><p>Pick a service, get guidance, upload your documents and follow your request until it is done.</p><ol class="flow"><li><b>Choose a service</b><span>Read the procedure, fees and required documents</span></li><li><b>Upload your documents</b><span>The checklist shows exactly what is missing</span></li><li><b>Submit and get a request ID</b><span>It is routed to the right office automatically</span></li><li><b>Track it live</b><span>Verification and approval, with a notification at every step</span></li></ol></div><span class="hf">Academic Office · Accounts · Department Office · Student Services · Examination Cell</span></section><section class="panelwrap"><div class="panel" id="panel"></div></section></div>`;
  function draw() {
    const L = mode === 'login';
    $('#panel').innerHTML = `<h2>${L ? 'Welcome back' : 'Create your account'}</h2><p class="sub">${L ? 'Sign in to continue to StepWise.' : 'Students can register here. Staff accounts are created by the admin.'}</p><div class="tabs"><button class="${L ? 'on' : ''}" data-m="login">Log in</button><button class="${L ? '' : 'on'}" data-m="register">Register</button></div>
    <form id="af">${L ? `<label>Sign in as</label><div class="roles">${Object.keys(ROLE).map(r => `<button type="button" data-r="${r}" class="${role === r ? 'on' : ''}">${ROLE[r]}</button>`).join('')}</div><p class="mut" style="font-size:13px;margin-top:8px">${ROLEHINT[role]}</p>` : '<label>Full name</label><input name="name" required placeholder="Ravi Teja"><label>Roll number</label><input name="roll" placeholder="CS-2023-042">'}
    <label>College email</label><input name="email" type="email" required placeholder="name@student.campus.edu"><label>Password</label><div class="pw"><input name="password" type="password" required placeholder="Enter password"><button type="button" class="eye" id="eye">Show</button></div>
    ${L ? '' : '<label>Branch and year (optional)</label><input name="detail" placeholder="B.Tech CSE, Year 3">'}
    <div class="err" id="err"></div><button class="btn" style="width:100%">${L ? 'Log in' : 'Create student account'}</button></form>
    <p class="demo"><b id="wk2">▶ View demo walkthrough</b></p>`;
    $$('.tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
    $$('.roles button').forEach(b => b.onclick = () => { role = b.dataset.r; draw(); });
    $('#wk2').onclick = () => walkthrough();
    $('#eye').onclick = () => { const i = $('[name=password]'), s = i.type === 'password'; i.type = s ? 'text' : 'password'; $('#eye').textContent = s ? 'Hide' : 'Show'; };
    $('#af').onsubmit = async e => {
      e.preventDefault(); const d = Object.fromEntries(new FormData(e.target));
      try { const r = await api(L ? '/login' : '/register', { body: L ? { ...d, role } : d }); token = r.token; localStorage.sw_t = token; me = r.user; location.hash = HOME[me.role]; route(); }
      catch (er) { $('#err').textContent = er.message; }
    };
  }
  draw();
}

/* ---------- student ---------- */
async function showService(id) {
  const s = await api('/services/' + id); closeModal();
  const m = document.createElement('div'); m.id = 'modal';
  const proc = s.proc && s.proc.length ? s.proc : ['Fill in the application details.', 'Upload the required documents.', 'Staff verify your documents.', 'The request is approved and you collect the document.'];
  m.innerHTML = `<div class="mb"><div class="md wide"><button class="x" id="mx">×</button><small class="cd">${esc(s.category)} · ${esc(s.code || '')}</small><h2>${esc(s.name)}</h2><small class="cd" style="margin-top:14px;color:var(--mut)">OVERVIEW</small><p style="font-size:14px">${esc(s.description)}</p>
  <div class="sinfo"><div><small>DEPARTMENT</small><b>${esc(s.dept)}</b><small>${esc(s.dept_location || '')}</small></div><div><small>EST. TURNAROUND</small><b>~${s.days || 2} Business Days</b><small>*Illustrative estimate</small></div><div><small>APPROVER AUTHORITY</small><b>${esc(s.approver || 'Not required')}</b><small>${s.approver ? '' : 'Issued directly by ' + esc(s.dept) + ' · '}Fee: ${s.fee ? 'Rs. ' + s.fee : 'Free of Charge'}</small></div></div>
  <small class="cd" style="color:var(--mut)">OFFICIAL ADMINISTRATIVE PROCEDURE</small><div class="vs" style="margin-top:12px">${proc.map(t => `<div><b style="font-weight:500;font-size:14px">${esc(t)}</b></div>`).join('')}</div>
  <small class="cd" style="color:var(--mut);margin:6px 0 8px">REQUIRED DOCUMENT CHECKLIST</small>${s.docs.map(d => `<div class="dl"><span class="ck">▤</span><div><b>${esc(d.name)} <span class="b rej" style="font-size:10px;padding:1px 8px">Mandatory</span></b><small>${esc(d.hint || '')}</small></div><small class="mono" style="margin-left:auto;text-align:right">${esc(d.formats || 'PDF, JPG, PNG')}<br>Max ${d.max_mb || 5}MB</small></div>`).join('')}
  <div class="elig"><b>Eligibility Criteria:</b><br>${esc(s.eligibility || 'All currently enrolled students.')}</div>
  <div class="foot2" style="align-items:center;gap:10px;flex-wrap:wrap"><small>* All documents are processed securely under college guidelines.</small><div class="acts" style="margin:0"><button class="ghost" id="cl">Close</button><button class="btn" id="st">Start Request →</button></div></div></div></div>`;
  document.body.append(m);
  $('#mx').onclick = $('#cl').onclick = closeModal; $('.mb', m).onclick = e => { if (e.target.classList.contains('mb')) closeModal(); };
  $('#st').onclick = () => { wz = { sid: s.id, step: 2, details: {}, files: {} }; closeModal(); if (location.hash === '#/new') route(); else location.hash = '#/new'; };
}
async function vDashboard() {
  const list = await api('/requests'), act = list.filter(r => r.status === 'Action Needed'), prog = list.filter(r => ['Submitted', 'Under Verification', 'Pending Approval', 'Action Needed', 'Approved'].includes(r.status)), done = list.filter(r => r.status === 'Completed');
  V(`<div class="hd"><h1>Welcome, <span class="g">${esc(me.name.split(' ')[0])}</span></h1><p>Here is what is happening with your requests.</p></div>
  <div class="stats"><div class="stat glass"><small>TOTAL REQUESTS</small><b>${list.length}</b></div><div class="stat glass"><small>IN PROGRESS</small><b>${prog.length}</b></div><div class="stat glass"><small>ACTION NEEDED</small><b style="color:#be123c">${act.length}</b></div><div class="stat glass"><small>COMPLETED</small><b style="color:#16a34a">${done.length}</b></div></div>
  ${act.map(r => `<div class="banner">⚠ <b>${esc(r.service)}</b> (${r.code}) needs more information. <a href="#/request/${r.id}" style="text-decoration:underline">Fix it now →</a></div>`).join('')}
  ${list.filter(r => r.status === 'Approved' && r.pay_status === 'pending').map(r => `<div class="banner" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:#92400e">💳 Pay <b>Rs. ${r.fee}</b> for <b>${esc(r.service)}</b> (${r.code}) to receive your document. <a href="#/request/${r.id}" style="text-decoration:underline">Pay now →</a></div>`).join('')}
  <div class="two" style="grid-template-columns:1.6fr 1fr"><div class="box glass"><h3>Recent requests</h3>${list.slice(0, 5).map(r => `<a class="drow" href="#/request/${r.id}" style="color:inherit"><span><b>${esc(r.service)}</b><small>${r.code} · ${dt(r.created_at)}</small></span>${badge(r.status)}</a>`).join('') || '<div class="empty">No requests yet. Start your first one below.</div>'}</div>
  <div class="box glass"><h3>Quick actions</h3><div class="acts" style="flex-direction:column"><a class="btn" href="#/new">+ New request</a><a class="ghost btn" href="#/services">Browse services</a><a class="ghost btn" href="#/assistant">Ask the AI Advisor</a></div></div></div>`, 'dashboard');
}
async function vProfile() {
  const p = await api('/me'), isS = me.role === 'student';
  const list = isS ? await api('/requests') : [], n = f => list.filter(f).length;
  const w = !isS && me.role !== 'admin' ? await api('/work?tab=queue') : null;
  const rows = [['Name', p.name], ['Role', ROLE[p.role]], ['College email', p.email]];
  if (isS) rows.push(['Roll number', p.roll || '—'], ['Branch and year', p.detail || '—']);
  if (p.role === 'staff') rows.push(['Department', p.dept_name || '—']);
  if (p.role === 'authority') rows.push(['Approving authority title', p.detail || '—']);
  if (p.since) rows.push(['Member since', new Date(p.since).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })]);
  const stats = isS ? [['Total requests', list.length], ['In progress', n(r => ['Submitted', 'Under Verification', 'Pending Approval', 'Action Needed', 'Approved'].includes(r.status))], ['Completed', n(r => r.status === 'Completed')], ['Rejected', n(r => r.status === 'Rejected')]] : w ? [['Waiting for you', w.waiting], ['Processed today', w.processed], ['Delayed', w.delayed]] : [];
  V(`<div class="title"><h1>My <span class="g">profile</span></h1></div><div class="two" style="grid-template-columns:1fr 1fr"><div class="box glass"><div style="display:flex;gap:14px;align-items:center;margin-bottom:12px"><span class="av" style="width:56px;height:56px;font-size:20px">${ini(p.name)}</span><div><h3 style="margin:0">${esc(p.name)}</h3><small>${ROLE[p.role]}</small></div></div>${rows.map(r => `<div class="row"><span>${r[0]}</span><b style="text-align:right">${esc(r[1])}</b></div>`).join('')}</div>${stats.length ? `<div class="box glass"><h3>${isS ? 'Your activity' : 'Your workload'}</h3>${stats.map(r => `<div class="row"><span>${r[0]}</span><b>${r[1]}</b></div>`).join('')}</div>` : ''}</div>`, 'profile');
}
async function vServices() {
  svcCache = await api('/services'); const cats = ['All', ...new Set(svcCache.map(s => s.category))]; let cat = 'All', q = '';
  V(`<section class="hd"><h1>What do you need <span class="g">today?</span></h1><p>Choose a college service to see its procedure, documents and fees.</p><div class="bar"><div class="chipsrow">${cats.map(c => `<button class="chip ${c === 'All' ? 'on' : ''}" data-c="${c}">${c === 'All' ? 'All services' : c}</button>`).join('')}</div><input class="search" id="q" placeholder="⌕  Search services"></div></section><div class="grid" id="grid"></div>`, 'services');
  const draw = () => {
    const l = svcCache.filter(s => (cat === 'All' || s.category === cat) && (s.name + s.description).toLowerCase().includes(q));
    $('#grid').innerHTML = l.map(s => `<div class="card tilt" data-s="${s.id}" style="cursor:pointer"><span class="ic">${ICON[s.category] || '📄'}</span><span class="tag">${esc(s.category)}</span><small class="cd" style="margin-top:14px">${esc(s.code || '')}</small><h3 style="margin-top:2px">${esc(s.name)}</h3><p>${esc(s.description)}</p><div class="foot"><div><small>Handled by</small><b>${esc(s.dept)}</b></div><div><small>Fee</small><b>${s.fee ? 'Rs. ' + s.fee : 'Free'}</b></div><div><small>Time</small><b>~${s.days || 2} days</b></div><span class="go">View procedure →</span></div></div>`).join('') || '<div class="empty">No services match your search.</div>';
    $$('.card[data-s]').forEach(c => c.onclick = () => showService(+c.dataset.s));
  };
  $$('.chip').forEach(b => b.onclick = () => { cat = b.dataset.c; $$('.chip').forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('#q').oninput = e => { q = e.target.value.toLowerCase(); draw(); }; draw();
}
async function vService(id) {
  const s = curSvc = await api('/services/' + id);
  const apr = s.steps.find(t => t.kind === 'authority');
  const next = [['Submit your request', 'Upload the documents and receive a unique request ID.'], ...s.steps.map(t => [stepLabel(t, s), t.kind === 'staff' ? `${s.dept} checks your details and documents.` : 'Approved requests are forwarded to the Head of Department.']), ['Collect your document', 'You are notified when it is ready to download or collect.']];
  V(`<p class="crumb"><a href="#/services">Services</a> / ${esc(s.name)}</p><div class="title"><h1>${esc(s.name)}</h1><button class="btn" id="go">Start request →</button></div>
  <div class="two"><div><div class="pills"><div class="glass"><small>Department</small><b>${esc(s.dept)}</b></div><div class="glass"><small>Approval authority</small><b>${apr ? esc(s.approver || 'Approving authority') : 'Department staff'}</b></div><div class="glass"><small>Fee</small><b>${s.fee ? 'Rs. ' + s.fee : 'Free'}</b></div></div>
  <div class="box glass"><h3>Required documents</h3>${s.docs.map(d => `<div class="dl"><span class="ck">✓</span><div><b>${esc(d.name)}</b><small>${esc(d.hint)}</small></div></div>`).join('')}</div>
  <div class="box glass"><h3>Next steps</h3><div class="vs">${next.map(n => `<div><b>${esc(n[0])}</b><small>${esc(n[1])}</small></div>`).join('')}</div></div></div>
  <div class="glass chat" id="chat"></div></div>`, 'services');
  mountChat($('#chat'), s.id, s);
  $('#go').onclick = () => { wz = { sid: s.id, step: 2, details: {}, files: {} }; if (location.hash === '#/new') route(); else location.hash = '#/new'; };
}
const WSTEPS = ['Select Service', 'Fill Details', 'Upload Documents', 'Review & Submit'];
const fieldHTML = (f, v) => `<label>${esc(f.l)}${f.r ? ' <span style="color:#e11d48">*</span>' : ' <span style="text-transform:none;font-weight:400">(optional)</span>'}</label>${f.t === 'select' ? `<select data-k="${f.k}"><option value="">-- Select an option --</option>${(f.o || []).map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : f.t === 'textarea' ? `<textarea data-k="${f.k}" rows="3" placeholder="${esc(f.p || '')}">${esc(v)}</textarea>` : `<input data-k="${f.k}" type="${f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : 'text'}" ${f.t === 'number' ? 'min="1"' : ''} value="${esc(v)}" placeholder="${esc(f.p || '')}">`}${f.h ? `<small style="margin-top:4px">${esc(f.h)}</small>` : ''}`;
const collectBox = r => {
  if (r.status === 'Approved' && r.pay_status === 'pending') return `<div class="box glass payb"><h3>💳 Payment due</h3><div class="row"><span>Fee</span><b>Rs. ${r.fee}</b></div><p class="mut" style="margin:10px 0;font-size:13px">Your request is approved. Pay the fee to unlock your digital copy and the collection details.</p><button class="btn" id="payNow" style="width:100%">Pay Rs. ${r.fee} now</button><small style="margin-top:8px">Demo payment: no real money is charged.</small></div>`;
  if (!['Approved', 'Completed'].includes(r.status)) return '';
  return `<div class="box glass done"><h3>📍 Collect your document</h3><div class="row"><span>Office</span><b>${esc(r.dept)}</b></div><div class="row"><span>Location</span><b style="text-align:right">${esc(r.dept_location || 'Visit the ' + r.dept + ' office')}</b></div><div class="row"><span>Timings</span><b>Mon-Sat, 10:00 AM - 4:00 PM</b></div><p class="mut" style="margin-top:10px;font-size:13px">${r.status === 'Completed' ? 'Your document is ready.' : 'It will be ready soon.'} Bring your college ID card and show request ID <b style="color:var(--ink)">${esc(r.code)}</b>.</p><a class="btn" style="display:block;text-align:center;margin-top:12px" target="_blank" href="/api/requests/${r.id}/certificate?t=${token}">📄 View / Print Sample Certificate</a>${r.pay_status === 'paid' ? `<a class="ghost btn" style="display:block;text-align:center;margin-top:8px" target="_blank" href="/api/requests/${r.id}/receipt?t=${token}">🧾 Payment receipt (Rs. ${r.paid_amount})</a>` : ''}</div>`;
};
const payTag = r => r.pay_status === 'paid' ? `<span class="b app">Paid Rs. ${r.paid_amount}</span>` : r.pay_status === 'pending' ? '<span class="b pen">Payment due</span>' : '<span class="mut">-</span>';
function payModal(r) {
  closeModal(); let method = 'upi';
  const BANKS = ['State Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Other Bank'];
  const m = document.createElement('div'); m.id = 'modal'; document.body.append(m);
  const draw = () => {
    m.innerHTML = `<div class="mb"><div class="md"><button class="x" id="mx">×</button><small class="cd">DEMO PAYMENT GATEWAY · NO REAL MONEY</small><h2>Pay Rs. ${r.fee}</h2><p class="mut" style="margin:0 0 12px">${esc(r.service)} · ${esc(r.code)}</p>
    <div class="tabs" style="grid-template-columns:repeat(3,1fr)">${[['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net Banking']].map(([k, l]) => `<button type="button" class="${method === k ? 'on' : ''}" data-m="${k}">${l}</button>`).join('')}</div>
    <form id="pf">${method === 'upi' ? '<label>UPI ID</label><input name="upi" placeholder="yourname@bank" autocomplete="off"><small>Demo: any ID with an @ works, like ravi@upi</small>' : method === 'card' ? '<label>Card number</label><input name="card" id="cn" inputmode="numeric" placeholder="4242 4242 4242 4242" maxlength="19" autocomplete="off"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label>Expiry (MM/YY)</label><input name="exp" placeholder="12/29" maxlength="5" autocomplete="off"></div><div><label>CVV</label><input name="cvv" type="password" inputmode="numeric" maxlength="3" placeholder="123" autocomplete="off"></div></div><small>Demo: use 4242 4242 4242 4242. A number ending in 0000 is declined.</small>' : `<label>Choose your bank</label><select name="bank">${BANKS.map(b => `<option>${b}</option>`).join('')}</select><small>Demo bank page: no login needed.</small>`}
    <div class="err" id="perr"></div><button class="btn" style="width:100%;margin-top:6px" id="pbtn">Pay Rs. ${r.fee}</button></form></div></div>`;
    $('#mx').onclick = closeModal; $('.mb', m).onclick = e => { if (e.target.classList.contains('mb')) closeModal(); };
    $$('.tabs button', m).forEach(b => b.onclick = () => { method = b.dataset.m; draw(); });
    const cn = $('#cn'); if (cn) cn.oninput = () => { cn.value = cn.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim(); };
    $('#pf').onsubmit = async e => {
      e.preventDefault(); const b = $('#pbtn'); b.disabled = true; b.textContent = 'Processing payment…';
      try {
        await new Promise(r => setTimeout(r, 1200));
        const res = await api(`/requests/${r.id}/pay`, { body: { method, ...Object.fromEntries(new FormData(e.target)) } });
        confetti();
        m.innerHTML = `<div class="mb"><div class="md" style="text-align:center"><h2 style="color:#16a34a">✓ Payment successful</h2><p class="mut">Rs. ${res.amount} paid via ${esc(res.method)}</p><span class="rid g" style="font-size:22px">${esc(res.ref)}</span><div class="acts" style="justify-content:center"><a class="ghost btn" target="_blank" href="/api/requests/${r.id}/receipt?t=${token}">🧾 View receipt</a><button class="btn" id="pdone">Done</button></div></div></div>`;
        $('#pdone').onclick = () => { closeModal(); vRequest(r.id); };
      } catch (er) { $('#perr').textContent = er.message; b.disabled = false; b.textContent = 'Pay Rs. ' + r.fee; }
    };
  };
  draw();
}
const detRows = r => (r.fields || []).filter(f => r.details && r.details[f.k]).map(f => `<div class="row"><span>${esc(f.l)}</span><b style="text-align:right;max-width:60%">${esc(r.details[f.k])}</b></div>`).join('') || '<span class="mut" style="font-size:13px">No extra details.</span>';
function pickFile(doc, f) {
  if (!f) return;
  const s = svcCache.find(x => x.id === wz.sid), d = s.docs.find(x => x.name === doc), mx = d.max_mb || 5;
  const kind = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' }[f.type];
  if (!kind || !(d.formats || 'PDF, JPG, PNG').toUpperCase().includes(kind)) return toast(`${doc} must be ${d.formats || 'PDF, JPG, PNG'}`, 1);
  if (f.size > mx * 1048576) return toast(`${doc} must be under ${mx} MB`, 1);
  wz.files[doc] = f; vWizard();
}
async function vWizard() {
  svcCache = await api('/services');
  if (!wz) wz = { sid: null, step: 1, details: {}, files: {} };
  const s = svcCache.find(x => x.id === wz.sid); curSvc = s || null;
  if (!s) wz.step = 1;
  const go = n => { wz.step = n; vWizard(); };
  let body = '';
  if (wz.step === 1) {
    body = `<div class="box glass"><h3>Step 1: Choose Institutional Service</h3><p class="mut" style="margin-bottom:14px">Select the service you wish to apply for from the college directory.</p><div class="grid2">${svcCache.map(x => `<div class="sc ${wz.sid === x.id ? 'sel' : ''}" data-id="${x.id}">${wz.sid === x.id ? '<i class="ck2">✓</i>' : ''}<small class="cd">${esc(x.code || 'SV')} · ${esc(x.category)}</small><b>${esc(x.name)}</b><p>${esc(x.description)}</p><div class="sf"><span>${esc(x.dept)}</span><span>~${x.days || 2} days</span></div></div>`).join('')}</div><div class="acts" style="justify-content:flex-end"><button class="btn" id="nx" ${s ? '' : 'disabled'}>Continue →</button></div></div>`;
  } else if (wz.step === 2) {
    body = `<div class="box glass"><small class="cd">${esc(s.code || '')} · ${esc(s.category)}</small><h3>Step 2: Enter Application Details for ${esc(s.name)}</h3><p class="mut">Please provide accurate details required by ${esc(s.dept)}.</p><div class="sinfo"><div><small>Student</small><b>${esc(me.name)}</b></div><div><small>Roll No</small><b>${esc(me.roll || '—')}</b></div><div><small>Department</small><b>${esc(me.detail || '—')}</b></div></div>${s.fields.map(f => fieldHTML(f, wz.details[f.k] || '')).join('')}<div class="err" id="err"></div><div class="foot2"><button class="ghost" id="bk">‹ Back</button><button class="btn" id="nx">Continue →</button></div></div>`;
  } else if (wz.step === 3) {
    const have = s.docs.filter(d => wz.files[d.name]).length;
    body = `<div class="box glass"><h3>Step 3: Upload Required Documents</h3><p class="mut" style="margin-bottom:12px">Attach clear PDF or image scans for verification by ${esc(s.dept)}.</p><div class="prog" style="margin:0 0 14px"><i style="width:${have / s.docs.length * 100}%"></i></div>${s.docs.map(d => { const f = wz.files[d.name]; return `<div class="up ${f ? '' : 'miss'}" data-d="${esc(d.name)}"><span class="st">${f ? '✓' : '!'}</span><div class="nm"><b>${esc(d.name)} <span class="b rej" style="font-size:10px;padding:1px 8px">Mandatory</span></b><small>${f ? esc(f.name) + ', ' + kb(f.size) : esc(d.hint || 'Clear scan or photo')}</small><small class="mono">Formats: ${esc(d.formats || 'PDF, JPG, PNG')} · Max ${d.max_mb || 5}MB</small></div>${f ? '<span class="b app">Uploaded</span><button class="ghost sm">Replace</button>' : '<button class="ghost sm">⇪ Select file</button>'}<input type="file" accept=".pdf,.jpg,.jpeg,.png"></div>`; }).join('')}<div class="foot2"><button class="ghost" id="bk">‹ Back</button><button class="btn" id="nx">Continue →</button></div></div>`;
  } else {
    body = `<div class="two" style="grid-template-columns:1.4fr 1fr"><div class="box glass"><h3>Step 4: Review & Submit</h3><div class="row"><span>Service</span><b>${esc(s.name)}</b></div><div class="row"><span>Applicant</span><b>${esc(me.name)} ${me.roll ? '· ' + esc(me.roll) : ''}</b></div><div class="row"><span>Department</span><b>${esc(s.dept)}</b></div><div class="row"><span>Fee</span><b>${s.fee ? 'Rs. ' + s.fee : 'Free'}</b></div>${s.fields.filter(f => wz.details[f.k]).map(f => `<div class="row"><span>${esc(f.l)}</span><b style="text-align:right;max-width:60%">${esc(wz.details[f.k])}</b></div>`).join('')}<h4 class="mut" style="font-size:11px;letter-spacing:.1em;margin:16px 0 8px">DOCUMENTS (${s.docs.length} OF ${s.docs.length})</h4>${s.docs.map(d => `<div class="dl"><span class="ck">✓</span><div><b>${esc(d.name)}</b><small>${esc(wz.files[d.name].name)}</small></div></div>`).join('')}<div class="foot2"><button class="ghost" id="bk">‹ Back</button><button class="btn" id="sub">Submit request</button></div></div><div class="box glass" id="after"><small class="cd">AFTER YOU SUBMIT</small><p class="mut" style="margin-top:8px">You get a unique request ID, the request is routed to <b style="color:var(--ink)">${esc(s.dept)}</b> automatically, and you are notified at every step. About ${s.days || 2} working days.</p></div></div>`;
  }
  V(`<h1 style="font-size:32px;font-weight:800">New Administrative Service Request</h1><p class="mut" style="margin-bottom:16px">Step-by-step verified submission wizard with document checklist validation.</p><div class="wzs glass">${WSTEPS.map((n, i) => { const k = i + 1; return `<div class="ws ${k < wz.step ? 'done' : k === wz.step ? 'cur' : ''}"><span>${k < wz.step ? '✓' : k}</span><small>${n}</small></div>`; }).join('')}</div><div id="wzb">${body}</div>`, 'new');
  const bk = $('#bk'); if (bk) bk.onclick = () => go(wz.step - 1);
  if (wz.step === 1) {
    $$('.sc').forEach(c => c.onclick = () => { if (wz.sid !== +c.dataset.id) { wz.sid = +c.dataset.id; wz.details = {}; wz.files = {}; } vWizard(); });
    $('#nx').onclick = () => go(2);
  } else if (wz.step === 2) {
    $('#nx').onclick = () => {
      $$('[data-k]').forEach(e => wz.details[e.dataset.k] = e.value.trim());
      const miss = s.fields.filter(f => f.r && !wz.details[f.k]);
      if (miss.length) return $('#err').textContent = 'Please fill: ' + miss.map(f => f.l).join(', ');
      go(3);
    };
  } else if (wz.step === 3) {
    $$('.up').forEach(r => {
      const inp = $('input', r), d = r.dataset.d; r.onclick = e => { if (e.target !== inp) inp.click(); };
      inp.onchange = () => pickFile(d, inp.files[0]);
      r.ondragover = e => { e.preventDefault(); r.classList.add('drag'); }; r.ondragleave = () => r.classList.remove('drag');
      r.ondrop = e => { e.preventDefault(); r.classList.remove('drag'); pickFile(d, e.dataTransfer.files[0]); };
    });
    $('#nx').onclick = () => { const m = s.docs.filter(d => !wz.files[d.name]).length; m ? toast(`Upload the ${m} missing document${m > 1 ? 's' : ''} first`, 1) : go(4); };
  } else {
    $('#sub').onclick = async e => {
      e.target.disabled = true; e.target.textContent = 'Submitting…';
      const fd = new FormData(); fd.append('service_id', s.id); fd.append('names', JSON.stringify(s.docs.map(d => d.name))); fd.append('details', JSON.stringify(wz.details)); s.docs.forEach(d => fd.append('files', wz.files[d.name]));
      try {
        const r = await api('/requests', { body: fd }); wz = null; confetti();
        $('#wzb').innerHTML = `<div class="box glass done" style="max-width:520px;margin:0 auto"><h3>✓ Request submitted</h3><small class="cd" style="margin-top:12px">YOUR REQUEST ID</small><span class="rid g">${r.code}</span><p class="mut">Routed to <b style="color:var(--ink)">${esc(r.dept)}</b> for document verification. You will be notified at each step.</p><div class="acts"><a class="btn" href="#/request/${r.id}">Track request</a><a class="ghost btn" href="#/requests">My requests</a></div></div>`;
        $$('.ws').forEach(x => { x.className = 'ws done'; x.firstChild.textContent = '✓'; });
      } catch (er) { toast(er.message, 1); e.target.disabled = false; e.target.textContent = 'Submit request'; }
    };
  }
}
async function vAssistant() {
  svcCache = await api('/services');
  V(`<div class="glass box" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap"><div style="display:flex;gap:12px;align-items:center"><span class="ai"></span><div><b style="font-size:18px">StepWise AI Administrative Advisor</b> <span class="b app">Verified Knowledge Mode</span><small>Ask about procedure checklists, department rules, required forms, or request routing.</small></div></div><button class="ghost sm" id="cc">↺ Clear Chat</button></div>
  <div class="two" style="grid-template-columns:1.8fr 1fr"><div class="glass chat" id="chat" style="position:static;height:580px"></div><div><div class="box glass"><small class="cd">ACTIVE SERVICE CONTEXT</small><div id="ctx" class="mut" style="font-size:13px;margin-top:8px">Mention or ask about any service (e.g., "Bonafide Certificate" or "Transcript") to pin its workflow and checklist here.</div></div><div class="box glass"><small class="cd">POPULAR QUESTIONS</small><div>${POP.map(q => `<a href="#" class="pq">• ${esc(q)}</a>`).join('')}</div></div></div></div>`, 'assistant');
  const setCtx = id => {
    const s = svcCache.find(x => x.id === id); if (!s) return;
    $('#ctx').innerHTML = `<b style="color:var(--ink);font-size:15px">${esc(s.name)}</b><small>${esc(s.code || '')} · ${esc(s.dept)} · ${s.fee ? 'Rs. ' + s.fee : 'Free'} · ~${s.days || 2} days</small><h4 style="font-size:11px;letter-spacing:.1em;margin:12px 0 6px">CHECKLIST</h4>${s.docs.map(d => `<div>✓ ${esc(d.name)}</div>`).join('')}<h4 style="font-size:11px;letter-spacing:.1em;margin:12px 0 6px">WORKFLOW</h4>${s.steps.map((t, i) => `<div>${i + 1}. ${esc(stepLabel(t, s))}</div>`).join('')}<a class="btn sm" style="margin-top:12px;display:inline-block" href="#/service/${s.id}">Open procedure</a>`;
  };
  let chat = mountChat($('#chat'), null, null, { onCtx: setCtx });
  $('#cc').onclick = () => { $('#ctx').innerHTML = 'Mention or ask about any service to pin its workflow and checklist here.'; chat = mountChat($('#chat'), null, null, { onCtx: setCtx }); };
  $$('.pq').forEach(l => l.onclick = e => { e.preventDefault(); chat.send(l.textContent.slice(2)); });
}
async function vRequests() {
  clearInterval(timer);
  const list = await api('/requests'); let q = '', fs = '', fv = '', newest = true;
  const STS = [['Submitted', 'Submitted'], ['Under Verification', 'Under Verification'], ['Action Needed', 'Additional Info Required'], ['Pending Approval', 'Pending Approval'], ['Approved', 'Approved'], ['Completed', 'Completed'], ['Rejected', 'Rejected']];
  const svcs = (await api('/services')).map(x => x.name);
  V(`<div class="glass box"><div class="title" style="margin-bottom:14px"><div><h1 style="font-size:30px">My Service Requests <span class="b sub" style="font-size:12px;vertical-align:middle">${list.length} Total</span></h1><p class="mut">Track the progress, document verifications, and approvals of your administrative submissions.</p></div><a class="btn" href="#/new">+ New Request</a></div><div class="filters"><input id="q" placeholder="⌕  Search by Request ID (e.g. SW-2026-00004) or service…"><select id="fs"><option value="">All Statuses</option>${STS.map(x => `<option value="${x[0]}">${x[1]}</option>`).join('')}</select><select id="fv"><option value="">All Services</option>${svcs.map(x => `<option>${esc(x)}</option>`).join('')}</select><button class="ghost" id="so">⇅ Newest First</button></div></div><div class="glass scroll"><table class="tbl"><thead><tr><th>Request ID</th><th>Service Details</th><th>Submitted On</th><th>Assigned Department</th><th>Current Status</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`, 'requests');
  const draw = () => {
    let l = list.filter(r => (!fs || r.status === fs) && (!fv || r.service === fv) && (!q || (r.code + ' ' + r.service).toLowerCase().includes(q)));
    if (!newest) l = l.slice().reverse();
    $('#tb').innerHTML = l.map(r => `<tr class="hv"><td><a href="#/request/${r.id}" class="mono">${r.code}</a></td><td><b>${esc(r.service)}</b><small class="mono">${esc(r.svc_code || '')} · ${r.docs} document${r.docs === 1 ? '' : 's'}</small></td><td class="mono">${dt(r.created_at)}</td><td>${esc(r.dept)}</td><td>${badge(r.status)}${r.status === 'Approved' && r.pay_status === 'pending' ? ' <span class="b pen">Payment due</span>' : ''}</td><td><a class="ghost sm btn" href="#/request/${r.id}">Track Workflow</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No requests found.</td></tr>';
  };
  $('#q').oninput = e => { q = e.target.value.toLowerCase(); draw(); };
  $('#fs').onchange = e => { fs = e.target.value; draw(); }; $('#fv').onchange = e => { fv = e.target.value; draw(); };
  $('#so').onclick = e => { newest = !newest; e.target.textContent = newest ? '⇅ Newest First' : '⇅ Oldest First'; draw(); };
  draw();
  timer = setInterval(async () => { if (location.hash !== '#/requests') return clearInterval(timer); try { const n = await api('/requests'); if (n.map(x => x.id + x.status).join() !== list.map(x => x.id + x.status).join()) vRequests(); } catch { } }, 8000);
}
async function vRequest(id) {
  const r = await api('/requests/' + id); const an = r.status === 'Action Needed', idx = FLOW.indexOf(an ? 'Under Verification' : r.status), rej = r.status === 'Rejected';
  const rejNote = (r.history.find(h => h.status === 'Rejected') || {}).note;
  const stage = i => { const t = r.history.slice().reverse().find(h => h.status === FLOW[i]); return t ? dt(t.created_at) : 'Not started'; };
  const nextS = r.steps[r.current_step], open = !['Approved', 'Rejected', 'Completed'].includes(r.status);
  V(`<p class="crumb"><a href="#/requests">My requests</a> / ${r.code}</p><div class="title"><div><small style="letter-spacing:.1em">REQUEST ${r.code}</small><h1>${esc(r.service)}</h1></div>${badge(r.status)}</div>
  <div class="glass box sinfo4"><div><small>Applicant</small><b>${esc(r.student)}</b><small>${esc(r.roll || '')}</small></div><div><small>Department</small><b>${esc(r.dept)}</b><small>${esc(r.dept_location || '')}</small></div><div><small>Submission Date</small><b>${dt(r.created_at)}</b></div><div><small>Approving Authority</small><b>${esc(r.approved_by || r.approver || ('Issued by ' + r.dept))}</b><small>${r.approved_by ? 'Approved' : ''}</small></div></div>
  ${an ? `<div class="banner">⚠ <b>Action needed.</b> ${esc((r.history.find(h => h.actor_role === 'staff') || {}).note || 'Staff asked for more information.')} Replace the document below and it goes straight back to verification.</div>` : ''}
  ${rej ? `<div class="banner"><b>Rejected.</b> Reason: ${esc(rejNote || 'See status history')}. You can fix the issue and apply again.</div>` : ''}
  <div class="glass trk">${FLOW.map((n, i) => `<div class="tk ${!rej && i < idx ? 'd' : !rej && i === idx ? 'c' : ''}"><i style="height:${36 + i * 22}px"></i><b>${n}</b><small>${i <= idx && !rej ? stage(i) : 'Not started'}</small></div>`).join('')}</div>
  <div class="two" style="margin-top:20px"><div class="box glass"><h3>Workflow Tracking Timeline</h3><small style="margin-bottom:12px">Verifiable event log with department audit timestamps · ${r.history.length} events recorded</small><div class="hist">${r.history.map(h => `<div><b>${esc(h.status)}</b><small>${dt(h.created_at)} · ${esc(h.actor || 'System')}${h.actor_role && h.actor_role !== 'system' ? ` <span class="b sub" style="font-size:10px;padding:1px 8px">${h.actor_role.toUpperCase()}</span>` : ''}</small><span class="mut" style="font-size:13px">${esc(h.note)}</span></div>`).join('')}</div></div>
  <div>${collectBox(r)}<div class="box glass"><h3>Application details</h3>${detRows(r)}</div><div class="box glass"><small>HANDLED BY</small><b>${esc(r.dept)}</b><small style="margin-top:12px">NEXT APPROVAL</small><b>${nextS && open ? esc(stepLabel(nextS, r)) : '—'}</b><small style="margin-top:12px">FEE</small><b>${r.fee ? 'Rs. ' + r.fee : 'Free'}</b></div>
  <div class="box glass"><h3>Your documents</h3>${r.docs.map(d => `<div class="drow"><span>${esc(d.doc_name)}</span><a target="_blank" href="/api/files/${d.id}?t=${token}">Open</a>${open ? `<label class="ghost sm" style="margin:0;cursor:pointer;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink)">Replace<input type="file" hidden data-d="${esc(d.doc_name)}" accept=".pdf,.jpg,.jpeg,.png"></label>` : ''}</div>`).join('')}</div>
  <a class="ghost btn" style="display:block;text-align:center" href="#/notifications">View notifications</a></div></div>`, 'requests');
  const pn = $('#payNow'); if (pn) pn.onclick = () => payModal(r);
  $$('input[type=file]').forEach(i => i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    const fd = new FormData(); fd.append('doc_name', i.dataset.d); fd.append('file', f);
    try { await api(`/requests/${id}/docs`, { body: fd }); toast('Document replaced'); vRequest(id); } catch (e) { toast(e.message, 1); }
  });
  if (open) timer = setInterval(() => { if (location.hash === '#/request/' + id) api('/requests/' + id).then(n => { if (n.status !== r.status || n.history.length !== r.history.length) { toast('Your request was updated'); vRequest(id); } }).catch(() => { }); }, 8000);
}
async function vNotes() {
  const n = await api('/notifications'); unread = n.unread;
  const col = { 'Documents needed': 'pen', Approved: 'app', Rejected: 'rej', Delayed: 'sub', Completed: 'com', Submitted: 'sub', 'Under Verification': 'rev', 'Pending Approval': 'pen', 'Document replaced': 'rev', 'New user': 'sub' };
  V(`<div class="title"><h1><span class="g">Notifications</span></h1><button class="ghost" id="ra">Mark all as read</button></div><div class="glass">${n.list.map(x => `<div class="nt" data-id="${x.id}" data-r="${x.request_id || ''}"><span class="dot ${x.is_read ? '' : 'u'}"></span><div><span class="b ${col[x.type] || 'sub'}">${esc(x.type)}</span> <small style="display:inline">${esc(x.code || '')}</small><h4>${esc(x.title)}</h4><p>${esc(x.body)}</p></div><time>${dt(x.created_at)}</time></div>`).join('') || '<div class="empty">Nothing yet. Your updates will show up here.</div>'}</div>`, 'notifications');
  $('#ra').onclick = async () => { await api('/notifications/read', { body: {} }); unread = 0; vNotes(); };
  $$('.nt').forEach(e => e.onclick = async () => { await api('/notifications/read', { body: { id: +e.dataset.id } }); if (e.dataset.r) location.hash = me.role === 'student' ? '#/request/' + e.dataset.r : '#/work/queue'; });
}

/* ---------- staff + approving authority ---------- */
async function vWork(tab, keep) {
  clearInterval(timer);
  const hash = location.hash;
  const d = await api('/work?tab=' + tab), isS = me.role === 'staff'; let sel = null;
  const sigOf = list => list.map(r => r.id + ':' + r.status).sort().join('|');
  let sig = sigOf(d.list);
  const title = { queue: isS ? 'Verification queue' : 'Pending approval', forwarded: 'Forwarded', approved: 'Approved', rejected: 'Rejected' }[tab];
  V(`<h1>${title}</h1><div class="stats"><div class="stat glass"><small>WAITING</small><b>${d.waiting}</b></div><div class="stat glass"><small>PROCESSED TODAY</small><b>${d.processed}</b></div><div class="stat glass"><small>DELAYED</small><b style="color:#b45309">${d.delayed}</b></div></div>
  <div class="split"><div class="glass" style="overflow:hidden">${d.list.map(r => `<a class="li" data-id="${r.id}"><small><span style="color:var(--a2)">${r.code}</span><span>${dt(r.updated_at)}</span></small><b>${esc(r.service)}</b><small>${esc(r.student)}</small></a>`).join('') || '<div class="empty">Nothing here right now 🎉</div>'}</div><div class="glass box" id="det"><div class="empty">Select a request to review it.</div></div></div>`, 'work/' + tab);
  async function open(id) {
    sel = id; $$('.li').forEach(x => x.classList.toggle('on', +x.dataset.id === id));
    const r = await api('/requests/' + id), step = r.steps[r.current_step];
    try { sig = sigOf((await api('/work?tab=' + tab)).list); } catch { }
    const mine = step && step.kind === (isS ? 'staff' : 'authority') && !['Approved', 'Rejected', 'Completed'].includes(r.status);
    const lbl = { pending: 'Check', verified: 'Verified', unclear: 'Unclear scan' };
    const sr = (r.history.find(h => h.actor_role === 'staff' && !h.note.includes('started')) || {}).note;
    $('#det').innerHTML = `<div class="dh"><div><small>${r.code}</small><h2>${esc(r.service)}</h2><span class="mut">${esc(r.student)}${r.roll ? ' · ' + esc(r.roll) : ''}${r.detail ? ', ' + esc(r.detail) : ''}</span></div>${badge(r.status)}</div>
    ${!isS && sr ? `<div class="sr"><small>STAFF REMARKS</small>${esc(sr)}</div>` : ''}${r.fee ? `<div class="sr"><small>FEE</small>Rs. ${r.fee} · ${r.pay_status === 'paid' ? 'Paid via ' + esc(r.pay_method) + ' (' + esc(r.pay_ref) + ')' : r.pay_status === 'pending' ? 'Awaiting payment from the student' : 'Payable after approval'}</div>` : ''}<h4>APPLICATION DETAILS</h4>${detRows(r)}<h4>DOCUMENTS</h4>
    ${r.docs.map(x => `<div class="drow"><span>${esc(x.doc_name)}</span><a target="_blank" href="/api/files/${x.id}?t=${token}">Open file</a>${isS && mine ? `<button class="vb ${x.status}" data-d="${x.id}" data-s="${x.status}">${lbl[x.status]}</button>` : x.status !== 'pending' ? `<span class="vb ${x.status}">${lbl[x.status]}</span>` : ''}</div>`).join('')}
    ${mine ? `<h4>REMARKS FOR THE STUDENT</h4><textarea id="rm" rows="3" placeholder="Explain your decision"></textarea><div class="acts"><button class="btn green" data-a="approve">${isS ? 'Approve and forward' : 'Approve'}</button>${isS ? '<button class="ghost" data-a="more_docs">Request more documents</button>' : ''}<button class="btn red" data-a="reject">Reject</button></div>` : isS && r.status === 'Approved' ? (r.pay_status === 'pending' ? `<div class="banner" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:#92400e">Waiting for the student to pay Rs. ${r.fee}. You can mark it completed after payment.</div>` : '<div class="acts"><button class="btn green" id="cp">Mark as completed</button></div>') : ''}
    ${['Approved', 'Completed'].includes(r.status) && r.pay_status !== 'pending' ? `<div class="acts"><a class="ghost btn" target="_blank" href="/api/requests/${r.id}/certificate?t=${token}">📄 View sample certificate</a>${r.pay_status === 'paid' ? `<a class="ghost btn" target="_blank" href="/api/requests/${r.id}/receipt?t=${token}">🧾 Payment receipt</a>` : ''}</div>` : ''}
    <h4>HISTORY</h4><div class="hist">${r.history.slice(0, 5).map(h => `<div><b>${esc(h.status)}</b><small>${dt(h.created_at)} · ${esc(h.actor || '')}</small><span class="mut" style="font-size:13px">${esc(h.note)}</span></div>`).join('')}</div>`;
    $$('.vb[data-d]').forEach(b => b.onclick = async () => { const n = b.dataset.s === 'verified' ? 'unclear' : 'verified'; await api('/docs/' + b.dataset.d, { method: 'PATCH', body: { status: n } }); open(id); });
    $$('[data-a]').forEach(b => b.onclick = async () => { try { await api(`/requests/${id}/action`, { body: { action: b.dataset.a, remarks: $('#rm').value } }); toast('Done. The student has been notified.'); vWork(tab); } catch (e) { toast(e.message, 1); } });
    const cp = $('#cp'); if (cp) cp.onclick = async () => { await api(`/requests/${id}/complete`, { method: 'POST', body: {} }); toast('Marked as completed'); vWork(tab); };
  }
  $$('.li').forEach(x => x.onclick = () => open(+x.dataset.id));
  if (keep && d.list.some(r => r.id === keep)) open(keep);
  timer = setInterval(async () => {
    if (location.hash !== hash) return clearInterval(timer);
    try { const n = await api('/work?tab=' + tab); if (sigOf(n.list) !== sig && !($('#rm') && $('#rm').value)) { sig = sigOf(n.list); if (Date.now() - (window.lastWorkToast || 0) > 30000) { window.lastWorkToast = Date.now(); toast('Your list has new activity'); } vWork(tab, sel); } } catch { }
  }, 8000);
}

/* ---------- admin ---------- */
async function vAdmin(tab) {
  if (tab === 'services') {
    const [list, deps, us0] = await Promise.all([api('/admin/services'), api('/admin/departments'), api('/admin/users')]); let ed = null; const titles = [...new Set(us0.filter(u => u.role === 'authority').map(u => u.detail).filter(Boolean))];
    V(`<div class="title"><h1>Services and <span class="g">workflows</span></h1><button class="btn" id="add">Add service</button></div><div class="split" style="grid-template-columns:1.2fr 1fr"><div class="glass scroll"><table class="tbl"><thead><tr><th>Service</th><th>Department</th><th>Approvals</th><th>Status</th><th></th></tr></thead><tbody>${list.map(s => `<tr><td><b>${esc(s.name)}</b></td><td class="mut">${esc(s.dept)}</td><td>${s.steps.length} step${s.steps.length > 1 ? 's' : ''}</td><td>${s.active ? '<span class="b app">Active</span>' : '<span class="b sub">Inactive</span>'}</td><td><a href="#" data-e="${s.id}">Edit</a> · <a href="#" data-x="${s.id}" style="color:#be123c">Remove</a></td></tr>`).join('')}</tbody></table></div><div class="glass box edit" id="ep"><div class="empty">Pick a service to edit, or add a new one.</div></div></div>`, 'admin/services');
    const form = () => {
      $('#ep').innerHTML = `<h3>${ed.id ? 'Edit: ' + esc(ed.name) : 'New service'}</h3><label>Service name</label><input id="n" value="${esc(ed.name)}"><label>Approver authority (pick an existing title)</label><input id="ap" list="ttl2" value="${esc(ed.approver || '')}" placeholder="Dean of Academic Affairs"><datalist id="ttl2">${titles.map(t => `<option value="${esc(t)}">`).join('')}</datalist><label>Eligibility criteria</label><input id="el" value="${esc(ed.eligibility || '')}"><label>Procedure steps (one per line)</label><textarea id="pr" rows="4">${esc((ed.proc || []).join('\n'))}</textarea><label>Service code</label><input id="cd" value="${esc(ed.code || '')}" placeholder="BC-101"><label>Processing time (days)</label><input id="dy" type="number" min="1" value="${ed.days || 2}"><label>Category</label><input id="c" value="${esc(ed.category)}" placeholder="Certificate, Permission…"><label>Description</label><input id="ds" value="${esc(ed.description)}"><label>Responsible department</label><select id="dp">${deps.map(d => `<option value="${d.id}" ${d.id === ed.department_id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select><label>Fee (Rs.)</label><input id="f" type="number" min="0" value="${ed.fee}"><label>Required documents</label>${ed.docs.map((d, i) => `<div class="rowx"><input data-di="${i}" value="${esc(d.name)}" placeholder="Document name"><button class="ghost sm danger" data-dr="${i}">Remove</button></div>`).join('')}<button class="ghost sm" id="ad">+ Add document</button><label>Approval steps</label>${ed.steps.map((k, i) => `<div class="rowx"><select data-si="${i}"><option value="staff" ${k === 'staff' ? 'selected' : ''}>Staff verification</option><option value="authority" ${k === 'authority' ? 'selected' : ''}>Approving authority</option></select><button class="ghost sm danger" data-sr="${i}">Remove</button></div>`).join('')}<button class="ghost sm" id="as">+ Add step</button><label><input type="checkbox" id="ac" style="width:auto" ${ed.active ? 'checked' : ''}> Active (visible to students)</label><button class="btn" style="width:100%;margin-top:14px" id="sv">Save changes</button>`;
      const sync = () => { ed.name = $('#n').value; ed.approver = $('#ap').value; ed.eligibility = $('#el').value; ed.proc = $('#pr').value.split('\n').map(x => x.trim()).filter(Boolean); ed.code = $('#cd').value; ed.days = +$('#dy').value || 2; ed.category = $('#c').value; ed.description = $('#ds').value; ed.department_id = +$('#dp').value; ed.fee = +$('#f').value || 0; ed.active = $('#ac').checked; $$('[data-di]').forEach(i => ed.docs[+i.dataset.di].name = i.value); $$('[data-si]').forEach(i => ed.steps[+i.dataset.si] = i.value); };
      $('#ad').onclick = () => { sync(); ed.docs.push({ name: '', hint: '' }); form(); }; $('#as').onclick = () => { sync(); ed.steps.push('staff'); form(); };
      $$('[data-dr]').forEach(b => b.onclick = () => { sync(); ed.docs.splice(+b.dataset.dr, 1); form(); }); $$('[data-sr]').forEach(b => b.onclick = () => { sync(); ed.steps.splice(+b.dataset.sr, 1); form(); });
      $('#sv').onclick = async () => { sync(); try { await api(ed.id ? '/admin/services/' + ed.id : '/admin/services', { method: ed.id ? 'PUT' : 'POST', body: ed }); toast('Service saved'); vAdmin('services'); } catch (e) { toast(e.message, 1); } };
    };
    $('#add').onclick = () => { ed = { name: '', approver: '', eligibility: '', proc: [], code: '', days: 2, category: '', description: '', department_id: deps[0].id, fee: 0, active: 1, docs: [{ name: '', hint: '' }], steps: ['staff', 'authority'] }; form(); };
    $$('[data-e]').forEach(a => a.onclick = e => { e.preventDefault(); const s = list.find(x => x.id === +a.dataset.e); ed = { ...s, docs: s.docs.map(d => ({ ...d })), steps: s.steps.map(t => t.kind) }; form(); });
    $$('[data-x]').forEach(a => a.onclick = async e => { e.preventDefault(); if (!confirm('Remove this service? (If it has requests it will be deactivated instead.)')) return; const r = await api('/admin/services/' + a.dataset.x, { method: 'DELETE' }); toast(r.deactivated ? 'Service deactivated (it has requests)' : 'Service removed'); vAdmin('services'); });
  } else if (tab === 'users') {
    const [us, deps] = await Promise.all([api('/admin/users'), api('/admin/departments')]);
    const dsel = (v, a = '') => `<select ${a}><option value="">—</option>${deps.map(d => `<option value="${d.id}" ${d.id === v ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
    const rsel = (v, a = '') => `<select ${a}>${Object.keys(ROLE).map(r => `<option value="${r}" ${r === v ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>`;
    V(`<h1>Users and <span class="g">roles</span></h1><div class="glass box"><h3>Add a user</h3><div class="rowx" style="display:flex;gap:8px;flex-wrap:wrap"><input id="un" placeholder="Name" style="flex:1;min-width:130px"><input id="ue" placeholder="Email" style="flex:1;min-width:160px"><input id="up" type="password" placeholder="Password" style="flex:1;min-width:120px">${rsel('staff', 'id="ur" style="flex:1;min-width:140px"')}${dsel(1, 'id="ud" style="flex:1;min-width:140px"')}<input id="ut" list="ttl" placeholder="Title (authority only)" style="flex:1;min-width:150px"><datalist id="ttl">${[...new Set(us.filter(u => u.role === 'authority').map(u => u.detail).filter(Boolean))].map(t => `<option value="${esc(t)}">`).join('')}</datalist><button class="btn" id="ua">Add</button></div></div><div class="glass scroll"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department (staff)</th><th>Title</th></tr></thead><tbody>${us.map(u => `<tr><td><b>${esc(u.name)}</b></td><td class="mut">${esc(u.email)}</td><td>${rsel(u.role, `data-u="${u.id}" data-k="r"`)}</td><td>${dsel(u.department_id, `data-u="${u.id}" data-k="d"`)}</td><td class="mut">${esc(u.role === 'authority' ? (u.detail || '—') : '')}</td></tr>`).join('')}</tbody></table></div>`, 'admin/users');
    $('#ua').onclick = async () => { try { await api('/admin/users', { body: { name: $('#un').value, email: $('#ue').value, password: $('#up').value, role: $('#ur').value, department_id: $('#ud').value || null, detail: $('#ut').value } }); toast('User added'); vAdmin('users'); } catch (e) { toast(e.message, 1); } };
    $$('[data-u]').forEach(s => s.onchange = async () => { const id = s.dataset.u, row = $$(`[data-u="${id}"]`); try { await api('/admin/users/' + id, { method: 'PUT', body: { role: row[0].value, department_id: row[1].value || null } }); toast('Updated'); } catch (e) { toast(e.message, 1); } });
  } else if (tab === 'requests') {
    const list = await api('/admin/requests'); let q = '';
    V(`<div class="title"><h1>All <span class="g">requests</span></h1><input id="q" style="max-width:320px" placeholder="⌕  Search by ID, student or service"></div><div class="glass scroll"><table class="tbl"><thead><tr><th>Request ID</th><th>Student</th><th>Service</th><th>Department</th><th>Submitted</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody id="tb"></tbody></table></div>`, 'admin/requests');
    const draw = () => { const l = list.filter(r => (r.code + ' ' + r.student + ' ' + r.email + ' ' + r.service).toLowerCase().includes(q)); $('#tb').innerHTML = l.map(r => `<tr><td class="mono">${r.code}</td><td><b>${esc(r.student)}</b><small>${esc(r.email)}${r.roll ? ' · ' + esc(r.roll) : ''}</small></td><td>${esc(r.service)}</td><td>${esc(r.dept)}</td><td class="mono">${dt(r.created_at)}</td><td>${badge(r.status)}</td><td>${payTag(r)}</td><td>${['Approved', 'Completed'].includes(r.status) && r.pay_status !== 'pending' ? `<a class="ghost sm btn" target="_blank" href="/api/requests/${r.id}/certificate?t=${token}">Certificate</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No requests yet.</td></tr>'; };
    $('#q').oninput = e => { q = e.target.value.toLowerCase(); draw(); }; draw();
  } else if (tab === 'depts') {
    const deps = await api('/admin/departments');
    V(`<h1><span class="g">Departments</span></h1><div class="glass box"><div style="display:flex;gap:8px"><input id="dn" placeholder="New department name"><button class="btn" id="da">Add department</button></div></div><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(230px,1fr))">${deps.map(d => `<div class="card"><span class="ic">🏛️</span><h3 style="font-size:18px">${esc(d.name)}</h3></div>`).join('')}</div>`, 'admin/depts');
    $('#da').onclick = async () => { try { await api('/admin/departments', { body: { name: $('#dn').value } }); toast('Department added'); vAdmin('depts'); } catch (e) { toast(e.message, 1); } };
  } else {
    const days = +(sessionStorage.days || 30), r = await api('/admin/reports?days=' + days), c = k => r.counts.filter(x => k.includes(x.status)).reduce((a, x) => a + x.n, 0), max = Math.max(1, ...r.by.map(x => x.n));
    V(`<div class="title"><h1><span class="g">Reports</span></h1><div style="display:flex;gap:8px"><select id="rg" style="width:auto">${[7, 30, 90].map(n => `<option value="${n}" ${n === days ? 'selected' : ''}>Last ${n} days</option>`).join('')}</select><button class="ghost" id="ex">Export CSV</button></div></div>
    <div class="stats">${[['PENDING', c(['Submitted', 'Under Verification', 'Action Needed', 'Pending Approval']), '#b45309'], ['APPROVED', c(['Approved']), '#16a34a'], ['REJECTED', c(['Rejected']), '#be123c'], ['COMPLETED', c(['Completed']), '#0891b2'], ['FEES COLLECTED', 'Rs. ' + (r.revenue || 0), '#16a34a']].map(x => `<div class="stat glass"><small style="color:${x[2]}">● ${x[0]}</small><b>${x[1]}</b></div>`).join('')}</div>
    <div class="split" style="grid-template-columns:1.4fr 1fr"><div class="glass box bars"><h3>Requests by service</h3>${r.by.map(x => `<div class="r"><span>${esc(x.name)}</span><div class="t"><i style="width:${x.n / max * 100}%"></i></div><b>${x.n}</b></div>`).join('') || '<div class="empty">No requests in this period.</div>'}</div><div class="glass box"><h3>Average time to complete</h3>${r.avg.map(x => `<div class="row"><span>${esc(x.name)}</span><b>${x.d} days</b></div>`).join('') || '<div class="empty">No completed requests yet.</div>'}</div></div>`, 'admin/reports');
    $('#rg').onchange = e => { sessionStorage.days = e.target.value; vAdmin('reports'); };
    $('#ex').onclick = () => { const csv = 'Service,Requests\n' + r.by.map(x => `"${x.name}",${x.n}`).join('\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'sw-report.csv'; a.click(); };
  }
}

/* ---------- router ---------- */
let routing = false, again = false;
async function route() {
  if (routing) { again = true; return; }
  routing = true;
  try { do { again = false; await doRoute(); } while (again); } finally { routing = false; }
}
async function doRoute() {
  clearInterval(timer);
  if (!me) return authView();
  const [a = '', b, c] = location.hash.slice(2).split('/');
  try {
    const [n, rq] = await Promise.all([api('/notifications'), me.role === 'student' ? api('/requests') : Promise.resolve([])]);
    if (me.role === 'staff' || me.role === 'authority') waiting = (await api('/work?tab=queue')).waiting;
    unread = n.unread; activeReq = rq.filter(r => !['Completed', 'Rejected'].includes(r.status)).length;
    if (me.role === 'student') {
      if (!['service', 'new'].includes(a)) curSvc = null;
      const m = { dashboard: vDashboard, profile: vProfile, services: vServices, service: () => vService(b), new: vWizard, upload: vWizard, review: vWizard, assistant: vAssistant, requests: vRequests, request: () => vRequest(b), notifications: vNotes };
      return await (m[a] || vDashboard)();
    }
    if (a === 'notifications') return await vNotes();
    if (a === 'profile') return await vProfile();
    if (me.role === 'admin' && a === 'admin') return await vAdmin(b || 'services');
    if (me.role !== 'admin' && a === 'work') return await vWork(b || 'queue');
    location.hash = HOME[me.role];
  } catch (e) { toast(e.message, 1); }
}
window.addEventListener('hashchange', route);
setInterval(async () => {
  if (!me) return;
  try { const n = await api('/notifications'); if (n.unread !== unread) { unread = n.unread; const l = $('nav a[href="#/notifications"]'); if (l) { let em = $('em', l); if (unread) { if (!em) { em = document.createElement('em'); l.append(em); } em.textContent = unread; } else if (em) em.remove(); } } } catch { }
  try { if (me.role === 'staff' || me.role === 'authority') { const w = (await api('/work?tab=queue')).waiting; if (w !== waiting) { waiting = w; const l = $('nav a[href="#/work/queue"]'); if (l) { let em = $('em', l); if (waiting) { if (!em) { em = document.createElement('em'); l.append(em); } em.textContent = waiting; } else if (em) em.remove(); } } } } catch { }
}, 10000);
(async () => {
  if (token) { try { me = await api('/me'); } catch { token = null; localStorage.removeItem('sw_t'); } }
  if (me && !location.hash) location.hash = HOME[me.role];
  route();
})();