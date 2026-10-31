require('dotenv').config();
const express = require('express'), path = require('path'), fs = require('fs'), bcrypt = require('bcryptjs'), jwt = require('jsonwebtoken'), multer = require('multer');
const db = require('./db');
const SECRET = process.env.JWT_SECRET || 'sw-dev-secret';
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const UP = path.join(__dirname, 'uploads'); fs.mkdirSync(UP, { recursive: true });
const OK = ['application/pdf', 'image/jpeg', 'image/png'];
const upload = multer({
  storage: multer.diskStorage({ destination: UP, filename: (q, f, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(f.originalname).toLowerCase()) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (q, f, cb) => cb(OK.includes(f.mimetype) ? null : new Error('Only PDF, JPG or PNG files are allowed'), OK.includes(f.mimetype))
});
const E = (s, m) => Object.assign(new Error(m), { status: s });
const wrap = fn => (req, res) => fn(req, res).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.message || 'Server error' }); });
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').slice(7) || req.query.t, SECRET); } catch { return res.status(401).json({ error: 'Please log in again' }); }
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  next();
};
const session = u => ({ token: jwt.sign({ id: u.id, role: u.role, name: u.name, dept: u.department_id }, SECRET, { expiresIn: '7d' }), user: { id: u.id, name: u.name, role: u.role, dept: u.department_id, detail: u.detail, email: u.email, roll: u.roll_no } });
const hist = (id, status, note, actor, role = 'system') => db.q('INSERT INTO status_history(request_id,status,note,actor,actor_role) VALUES(?,?,?,?,?)', [id, status, note, actor, role]);
const where = r => r.dept_location || (r.dept + ' office');
const notify = (uid, rid, type, title, body) => db.q('INSERT INTO notifications(user_id,request_id,type,title,body) VALUES(?,?,?,?,?)', [uid, rid, type, title, body]);

const notifyDept = async (deptId, ...a) => { for (const u of await db.q("SELECT id FROM users WHERE role='staff' AND department_id=?", [deptId])) await notify(u.id, ...a); };
const notifyAuth = async (title, ...a) => { const t = String(title || '').trim().toLowerCase(); for (const u of await db.q("SELECT id,detail FROM users WHERE role='authority'")) if (!t || String(u.detail || '').trim().toLowerCase() === t) await notify(u.id, ...a); };
const notifyRole = async (role, ...a) => { for (const u of await db.q('SELECT id FROM users WHERE role=?', [role])) await notify(u.id, ...a); };
const KIND = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG' };

/* ---------- auth ---------- */
app.post('/api/register', wrap(async (req, res) => {
  const { name = '', email = '', password = '', detail = '', roll = '' } = req.body;
  if (name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) throw E(400, 'Enter your name, a valid email and a password of 6+ characters');
  const [ex] = await db.q('SELECT id FROM users WHERE email=?', [email.trim().toLowerCase()]);
  if (ex) throw E(409, 'This email is already registered');
  const rollN = roll.trim().toUpperCase();
  if (rollN) { const [rx] = await db.q('SELECT id FROM users WHERE roll_no=?', [rollN]); if (rx) throw E(409, 'This roll number is already registered'); }
  const r = await db.q('INSERT INTO users(name,email,password,role,detail,roll_no) VALUES(?,?,?,?,?,?)', [name.trim(), email.trim().toLowerCase(), bcrypt.hashSync(password, 10), 'student', detail.trim() || null, rollN || null]);
  const [u] = await db.q('SELECT * FROM users WHERE id=?', [r.insertId]);
  await notifyRole('admin', null, 'New user', 'New student registered', `${u.name} (${u.email}) created an account.`);
  res.json(session(u));
}));
app.post('/api/login', wrap(async (req, res) => {
  const { email = '', password = '', role } = req.body;
  const [u] = await db.q('SELECT * FROM users WHERE email=?', [email.trim().toLowerCase()]);
  if (!u || !bcrypt.compareSync(password, u.password)) throw E(401, 'Wrong email or password');
  if (role && role !== u.role) throw E(403, `This account is not a ${role}. Pick the right role above.`);
  res.json(session(u));
}));
app.get('/api/me', auth(), wrap(async (req, res) => { const [u] = await db.q('SELECT u.*,d.name dept_name FROM users u LEFT JOIN departments d ON d.id=u.department_id WHERE u.id=?', [req.user.id]); if (!u) throw E(401, 'Gone'); res.json({ ...session(u).user, dept_name: u.dept_name, since: u.created_at }); }));

/* ---------- services ---------- */
async function services(where = '', p = []) {
  const s = await db.q(`SELECT s.*,d.name dept,d.location dept_location FROM services s JOIN departments d ON d.id=s.department_id ${where} ORDER BY s.id`, p);
  if (!s.length) return s;
  const ids = s.map(x => x.id);
  const docs = await db.q('SELECT * FROM service_docs WHERE service_id IN (?) ORDER BY id', [ids]);
  const st = await db.q('SELECT * FROM service_steps WHERE service_id IN (?) ORDER BY step_order', [ids]);
  s.forEach(x => { x.docs = docs.filter(d => d.service_id === x.id); x.steps = st.filter(d => d.service_id === x.id); try { x.fields = JSON.parse(x.fields || '[]'); } catch { x.fields = []; } try { x.proc = JSON.parse(x.proc_steps || '[]'); } catch { x.proc = []; } });
  return s;
}
app.get('/api/services', auth(), wrap(async (req, res) => res.json(await services('WHERE s.active=1'))));
app.get('/api/services/:id', auth(), wrap(async (req, res) => { const [s] = await services('WHERE s.id=?', [req.params.id]); if (!s) throw E(404, 'Service not found'); res.json(s); }));

/* ---------- AI assistant: guided, verified answers only (no free-form guessing) ---------- */
const alias = s => {
  const n = s.name.toLowerCase(), a = [n, n.split('(')[0].trim()];
  if (/bonafide/.test(n)) a.push('bonafide', 'bona fide');
  if (/transcript/.test(n)) a.push('transcript', 'grade record');
  if (/no-dues/.test(n)) a.push('no dues', 'no-dues', 'nodues');
  if (/id card/.test(n)) a.push('id card', 'student id', 'identity card');
  if (/leave/.test(n)) a.push('leave');
  if (/scholarship/.test(n)) a.push('scholarship');
  if (/fee receipt/.test(n)) a.push('fee receipt', 'statement of accounts');
  if (/hostel/.test(n)) a.push('hostel', 'outpass');
  if (/address/.test(n)) a.push('address', 'contact detail');
  return a;
};
const money = x => x.fee ? `Rs. ${x.fee}` : 'Free';
const steps = x => x.steps.map(t => t.kind === 'staff' ? `${x.dept} checks your documents` : `${x.approver || 'The approving authority'} approves`).join('\n→ ') || 'Processed directly';
const bullets = x => x.docs.map(d => `• ${d.name}${d.hint ? ' - ' + d.hint : ''}`).join('\n');
const applyText = x => `How to get ${x.name} (${x.code || 'service'}):\n\n1. Open "New request" and pick ${x.name}.\n2. Fill in the details.\n3. Upload these ${x.docs.length} documents:\n${bullets(x)}\n4. Check everything and press Submit. You will get a request ID.\n\nWhat happens next:\n${steps(x)}\n\nFee: ${money(x)}  |  Time: about ${x.days || 2} days`;
app.post('/api/assistant', auth(), wrap(async (req, res) => {
  const m = String(req.body.message || '').toLowerCase().trim().slice(0, 300);
  const all = await services('WHERE s.active=1');
  const named = all.find(x => alias(x).some(a => m.includes(a)));
  const s = named || all.find(x => x.id === +req.body.service_id) || null;
  const reply = (text, svc, ok = true) => res.json({ reply: text, service_id: svc ? svc.id : null, supported: ok });
  const need = fn => s ? reply(fn(s), s) : reply('Which service do you mean? I can help with:\n' + all.map(x => '• ' + x.name).join('\n'), null);
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(m)) return reply('Hello! Pick a question from the suggestions, or type a service name (like "Bonafide Certificate") and ask about its documents, fee, time, office or approval.', null);
  if (/status|track|where is my|check my request|request id/.test(m)) return reply('To check your request:\n\n1. Open "My requests".\n2. Click "View status" next to your request ID.\n\nYou will see:\nSubmitted → Under Verification → Pending Approval → Approved → Completed\n\nYou also get a notification at every step.', s);
  if (/incomplete|missing|do not have|don't have|dont have|not have/.test(m)) return reply('If your documents are incomplete:\n\n• Before you submit: you cannot submit until every document is uploaded. The checklist shows what is missing.\n• After you submit: if staff need a better copy, you get a "Documents needed" notification. Open the request and click Replace.\n• If you cannot get a document, ask the office first.', s);
  if (/(lost|replace|damaged|stolen).*(id|card)|(id|card).*(lost|replace|damaged|stolen)/.test(m)) { const c = all.find(x => /id card/i.test(x.name)); if (c) return reply(applyText(c) + '\n\nTip: choose "Lost card (duplicate)" as the reason.', c); }
  if (/document|upload|require|paper|checklist|bring/.test(m)) return need(x => `You need ${x.docs.length} documents for ${x.name}:\n\n${bullets(x)}\n\nCheck the format and size limit shown next to each document.`);
  if (/\bfees?\b|cost|price|charge|\bpay/.test(m)) return need(x => `${x.name} fee: ${money(x)}\nTime: about ${x.days || 2} days`);
  if (/how long|\btime\b|\bdays\b|\btake|duration|when will/.test(m)) return need(x => `${x.name} takes about ${x.days || 2} days.\n\nYou get a notification at every step, so you do not need to visit the office.`);
  if (/department|which office|who handles|handles|responsible|\boffice\b/.test(m)) return need(x => `${x.name} is handled by the ${x.dept}.\n\nWhat happens after you submit:\n${steps(x)}`);
  if (/approv|authority|\bhod\b|head of/.test(m)) return need(x => `Who approves ${x.name}:\n${steps(x)}`);
  if (/apply|how do i|how to|procedure|steps|process|get a|request a/.test(m)) return need(applyText);
  if (named) return reply(`${named.name} (${named.code || 'service'})\nOffice: ${named.dept}\nFee: ${money(named)}\nTime: about ${named.days || 2} days\n\nYou can ask me about its documents, fee, time, office or approval.`, named);
  reply('Sorry, I can only answer the questions listed on this page.\n\nPlease pick one from Suggestions or Popular questions, or type a service name (like "Bonafide Certificate") and ask about its documents, fee, time, office or approval.', s, false);
}));

/* ---------- requests ---------- */
async function getReq(id, user) {
  const [r] = await db.q(`SELECT r.*,s.name service,s.fee,s.fields,s.approver,s.code svc_code,s.department_id,d.name dept,d.location dept_location,u.name student,u.detail,u.roll_no roll FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id JOIN users u ON u.id=r.student_id WHERE r.id=?`, [id]);
  if (!r) throw E(404, 'Request not found');
  if (user.role === 'student' && r.student_id !== user.id) throw E(403, 'Not your request');
  if (user.role === 'staff' && r.department_id !== user.dept) throw E(403, 'Not your department');
  if (user.role === 'authority') { const [me] = await db.q('SELECT detail FROM users WHERE id=?', [user.id]); const t = String((me && me.detail) || '').trim().toLowerCase(), a = String(r.approver || '').trim().toLowerCase(); if (a && a !== t) throw E(403, 'This request is handled by another approving authority'); }
  try { r.fields = JSON.parse(r.fields || '[]'); } catch { r.fields = []; }
  try { r.details = JSON.parse(r.details || '{}'); } catch { r.details = {}; }
  r.docs = await db.q('SELECT id,doc_name,orig_name,size,status FROM request_docs WHERE request_id=? ORDER BY id', [id]);
  r.history = await db.q('SELECT * FROM status_history WHERE request_id=? ORDER BY id DESC', [id]);
  r.steps = await db.q('SELECT * FROM service_steps WHERE service_id=? ORDER BY step_order', [r.service_id]);
  const ap = r.history.find(h => h.actor_role === 'authority' && h.status !== 'Rejected'); r.approved_by = ap ? ap.actor : null;
  return r;
}
app.post('/api/requests', auth('student'), upload.array('files'), wrap(async (req, res) => {
  const [s] = await services('WHERE s.id=? AND s.active=1', [req.body.service_id]);
  if (!s) throw E(404, 'Service not found');
  const names = JSON.parse(req.body.names || '[]'), files = req.files || [];
  const miss = s.docs.filter(d => { const i = names.indexOf(d.name); return i < 0 || !files[i]; });
  if (miss.length) throw E(400, 'Missing documents: ' + miss.map(d => d.name).join(', '));
  for (const d of s.docs) {
    const f = files[names.indexOf(d.name)], mx = d.max_mb || 5;
    if (f.size > mx * 1048576) throw E(400, `"${d.name}" must be under ${mx} MB`);
    if (!String(d.formats || 'PDF, JPG, PNG').toUpperCase().includes(KIND[f.mimetype])) throw E(400, `"${d.name}" must be ${d.formats}`);
  }
  let det = {}; try { det = JSON.parse(req.body.details || '{}'); } catch { }
  const clean = {};
  for (const f of s.fields) {
    const v = String(det[f.k] ?? '').trim().slice(0, 500);
    if (f.r && !v) throw E(400, 'Please fill in: ' + f.l);
    if (v && f.t === 'select' && !(f.o || []).includes(v)) throw E(400, 'Invalid choice for: ' + f.l);
    if (v) clean[f.k] = v;
  }
  const [open] = await db.q("SELECT code FROM requests WHERE student_id=? AND service_id=? AND details=? AND status IN('Submitted','Under Verification','Action Needed','Pending Approval')", [req.user.id, s.id, JSON.stringify(clean)]);
  if (open) throw E(409, `You already submitted an identical request (${open.code}) that is still in progress. Change the details if you need a second one.`);
  const r = await db.q('INSERT INTO requests(code,student_id,service_id,status,current_step,details) VALUES(?,?,?,?,0,?)', ['tmp' + Date.now(), req.user.id, s.id, 'Submitted', JSON.stringify(clean)]);
  const id = r.insertId, code = `SW-${new Date().getFullYear()}-${String(id).padStart(5, '0')}`;
  await db.q('UPDATE requests SET code=? WHERE id=?', [code, id]);
  for (const d of s.docs) { const f = files[names.indexOf(d.name)]; await db.q('INSERT INTO request_docs(request_id,doc_name,file_name,orig_name,size) VALUES(?,?,?,?,?)', [id, d.name, f.filename, f.originalname, f.size]); }
  await hist(id, 'Submitted', `Request received with ${s.docs.length} documents.`, req.user.name, 'student');
  await hist(id, 'Routed to ' + s.dept, 'Request was routed automatically based on the service.', 'System');
  await notify(req.user.id, id, 'Submitted', `Request ${code} submitted`, `Routed to ${s.dept} for document verification.`);
  await notifyDept(s.department_id, id, 'Submitted', `New request ${code}`, `${req.user.name} submitted ${s.name}. Please verify the documents.`);
  res.json({ id, code, dept: s.dept });
}));
app.get('/api/requests', auth('student'), wrap(async (req, res) => res.json(await db.q('SELECT r.id,r.code,r.status,r.created_at,s.name service,s.code svc_code,d.name dept,(SELECT COUNT(*) FROM request_docs x WHERE x.request_id=r.id) docs,r.pay_status,s.fee FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id WHERE r.student_id=? ORDER BY r.id DESC', [req.user.id]))));
app.get('/api/requests/:id', auth(), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (req.user.role === 'staff' && r.status === 'Submitted') {
    await db.q("UPDATE requests SET status='Under Verification',updated_at=NOW() WHERE id=?", [r.id]);
    await hist(r.id, 'Under Verification', `${r.dept} has started verifying your documents.`, req.user.name, 'staff');
    await notify(r.student_id, r.id, 'Under Verification', 'Verification started', `${r.dept} is now checking your documents for ${r.code}.`);
    return res.json(await getReq(r.id, req.user));
  }
  res.json(r);
}));
app.post('/api/requests/:id/docs', auth('student'), upload.single('file'), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (['Approved', 'Rejected', 'Completed'].includes(r.status)) throw E(400, 'This request is closed');
  const d = r.docs.find(x => x.doc_name === req.body.doc_name);
  if (!d || !req.file) throw E(400, 'Choose a valid document and file');
  const [cfg] = await db.q('SELECT formats,max_mb FROM service_docs WHERE service_id=? AND name=?', [r.service_id, d.doc_name]);
  const mx = (cfg && cfg.max_mb) || 5;
  if (req.file.size > mx * 1048576) throw E(400, `"${d.doc_name}" must be under ${mx} MB`);
  if (cfg && !String(cfg.formats || 'PDF, JPG, PNG').toUpperCase().includes(KIND[req.file.mimetype])) throw E(400, `"${d.doc_name}" must be ${cfg.formats}`);
  await db.q("UPDATE request_docs SET file_name=?,orig_name=?,size=?,status='pending' WHERE id=?", [req.file.filename, req.file.originalname, req.file.size, d.id]);
  let st = r.status;
  if (st === 'Action Needed') { st = 'Under Verification'; await db.q('UPDATE requests SET status=?,updated_at=NOW() WHERE id=?', [st, r.id]); } else await db.q('UPDATE requests SET updated_at=NOW() WHERE id=?', [r.id]);
  await hist(r.id, st, `Student re-uploaded "${d.doc_name}".`, req.user.name, 'student');
  await notifyDept(r.department_id, r.id, 'Document replaced', `${r.code}: new copy of ${d.doc_name}`, `${req.user.name} uploaded a new copy of "${d.doc_name}". Please verify it again.`);
  res.json({ ok: true });
}));
app.patch('/api/docs/:id', auth('staff'), wrap(async (req, res) => {
  if (!['verified', 'unclear', 'pending'].includes(req.body.status)) throw E(400, 'Bad status');
  await db.q('UPDATE request_docs SET status=? WHERE id=?', [req.body.status, req.params.id]); res.json({ ok: true });
}));
app.get('/api/files/:id', auth(), wrap(async (req, res) => {
  const [d] = await db.q('SELECT d.*,r.student_id FROM request_docs d JOIN requests r ON r.id=d.request_id WHERE d.id=?', [req.params.id]);
  if (!d || (req.user.role === 'student' && d.student_id !== req.user.id)) throw E(404, 'File not found');
  res.sendFile(path.join(UP, path.basename(d.file_name)));
}));


/* ---------- sample certificate (for demo; printable / save as PDF from the browser) ---------- */
const crypto = require('crypto');
const escH = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fakeQR(seed) {
  const h = crypto.createHash('sha256').update(seed).digest(), n = 21; let cells = '';
  const fin = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#111"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" fill="#111"/>`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const inF = (i < 8 && j < 8) || (i < 8 && j > n - 9) || (i > n - 9 && j < 8); if (!inF && ((h[(i * n + j) % 32] >> ((i * 7 + j * 3) % 8)) & 1)) cells += `<rect x="${j}" y="${i}" width="1" height="1" fill="#111"/>`; }
  return `<svg viewBox="0 0 ${n} ${n}" width="92" height="92" shape-rendering="crispEdges">${cells}${fin(0, 0)}${fin(n - 7, 0)}${fin(0, n - 7)}</svg>`;
}
const tbl = rows => `<table>${rows.map((r, i) => `<tr>${r.map(c => i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
function transcriptTable(r) {
  const m = /year\s*(\d)/i.exec(r.detail || ''), yr = m ? Math.min(4, +m[1]) : 2, n = (yr - 1) * 2;
  const h = crypto.createHash('sha256').update(String(r.roll || r.student)).digest();
  if (!n) return '<p class="mut">First-year student: no semester has been completed yet, so no grades are available.</p>';
  const g = Array.from({ length: n }, (_, i) => +(6.8 + (h[i] % 260) / 100).toFixed(2));
  const cg = (g.reduce((a, b) => a + b, 0) / n).toFixed(2);
  return tbl([['Semester', 'SGPA', 'Result'], ...g.map((v, i) => ['Semester ' + (i + 1), v.toFixed(2), 'Pass']), ['<b>Cumulative (CGPA)</b>', '<b>' + cg + '</b>', '<b>' + n + ' semesters completed</b>']]) + `<p class="mut">Results shown for the ${n} completed semesters (Year ${yr}). Marks are sample data for demonstration only.</p>`;
}
const PAGE_CSS = `body{margin:0;background:#e9eefb;font-family:Georgia,'Times New Roman',serif;color:#111}.bar{text-align:center;padding:14px;font-family:Arial,sans-serif}.bar button{background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:15px;cursor:pointer}
.page{position:relative;width:760px;max-width:94%;margin:10px auto 30px;background:#fff;border:3px double #1e3a8a;padding:38px 46px;overflow:hidden}
.wm{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%) rotate(-28deg);font:bold 110px Arial;color:rgba(30,58,138,.07);white-space:nowrap;pointer-events:none}
h1{margin:0;text-align:center;font-size:24px;color:#1e3a8a;letter-spacing:.04em}.sub{text-align:center;color:#555;font-size:13px;margin:4px 0 18px}
.meta{display:flex;justify-content:space-between;font-size:13px;border-top:1px solid #999;border-bottom:1px solid #999;padding:8px 0;margin-bottom:22px}
h2{text-align:center;font-size:21px;margin:10px 0 18px;text-decoration:underline}p{line-height:1.8;font-size:15px;text-align:justify}.mut{color:#666;font-size:12px}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}th,td{border:1px solid #999;padding:6px 10px;text-align:left}th{background:#eef2ff}
.sign{display:flex;justify-content:space-between;align-items:flex-end;margin-top:36px}.sign div{font-size:13px}.line{border-top:1px solid #111;margin-top:6px;padding-top:4px;min-width:200px}
.note{margin-top:22px;border-top:1px dashed #999;padding-top:8px;font:11px Arial;color:#a00;text-align:center}
@media print{body{background:#fff}.bar{display:none}.page{border-width:3px;margin:0;width:auto;max-width:none}}`;
function certHTML(r) {
  const d = r.details || {}, f = k => `<b>${escH(d[k] || '-')}</b>`, n = r.service.toLowerCase();
  const who = `<b>${escH(r.student)}</b> (Roll No. <b>${escH(r.roll || '-')}</b>${r.detail ? ', ' + escH(r.detail) : ''})`;
  let title = r.service.toUpperCase(), body = `This is to confirm that the request <b>${escH(r.code)}</b> for <b>${escH(r.service)}</b> submitted by ${who} has been verified and approved.`, extra = '';
  if (n.includes('bonafide')) { title = 'BONAFIDE CERTIFICATE'; body = `This is to certify that ${who} is a bonafide student of this institution, currently studying in ${f('year')}. This certificate is issued on the student's request for the purpose of ${f('purpose')}.`; }
  else if (n.includes('transcript')) { title = 'OFFICIAL ACADEMIC TRANSCRIPT'; body = `This transcript is issued to ${who}. Sealed copies: ${f('copies')}. Recipient: ${f('recipient')}. Delivery mode: ${f('delivery')}.`; extra = transcriptTable(r); }
  else if (n.includes('fee receipt')) { title = 'FEE RECEIPT / STATEMENT OF ACCOUNTS'; body = `This statement is issued to ${who} for ${f('term')} (${f('type')}).`; extra = tbl([['Item', 'Amount (Rs.)'], ['Tuition fee', '60,000'], ['Laboratory fee', '5,000'], ['Library fee', '2,000'], ['<b>Total paid</b>', '<b>67,000</b>']]) + '<p class="mut">Amounts are sample data for demonstration only.</p>'; }
  else if (n.includes('id card')) { title = 'ID CARD ISSUE SLIP'; body = `A ${f('reason')} has been approved for ${who}. The card will be available for collection at the office shown on your request, against this slip and your old card (if any).`; }
  else if (n.includes('hostel')) { title = 'HOSTEL OUTPASS'; body = `${who} is permitted to leave the hostel from ${f('from')} to ${f('to')} for travel to ${f('dest')}. Reason: ${f('reason')}. Please show this pass at the hostel gate.`; }
  else if (n.includes('leave')) { title = 'LEAVE APPROVAL LETTER'; body = `Leave has been approved for ${who} from ${f('from')} to ${f('to')}. Reason: ${f('reason')}. The absence will be treated as excused in the attendance register.`; }
  else if (n.includes('no-dues')) { title = 'NO-DUES CERTIFICATE'; body = `This is to certify that ${who} has no dues pending with the following departments (reason: ${f('reason')}, graduating year ${f('year')}).`; extra = tbl([['Department', 'Status'], ['Central Library', 'No dues'], ['Hostel', 'No dues'], ['Laboratories', 'No dues'], ['Accounts', 'No dues']]); }
  else if (n.includes('address')) { title = 'RECORD UPDATE CONFIRMATION'; body = `The student record of ${who} has been updated. Updated item: ${f('type')}. New value: ${f('value')}.`; }
  else if (n.includes('scholarship')) { title = 'SCHOLARSHIP VERIFICATION CERTIFICATE'; body = `The fee and income documents of ${who} have been verified for the scholarship ${f('scheme')} (academic year ${f('year')}).`; }
  const ap = (r.history.find(h => h.status === 'Approved') || {}), by = r.approved_by || ap.actor || r.dept;
  const issued = new Date(ap.created_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const code = crypto.createHash('sha256').update(r.code + r.id + SECRET).digest('hex').slice(0, 10).toUpperCase();
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escH(title)} - ${escH(r.code)}</title><style>${PAGE_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page"><div class="wm">SAMPLE</div>
<h1>SAMPLE COLLEGE OF ENGINEERING</h1><div class="sub">Office of the ${escH(r.dept)} &middot; ${escH(r.dept_location || '')}</div>
<div class="meta"><span>Ref. No.: <b>${escH(r.code)}</b></span><span>Date of issue: <b>${issued}</b></span></div>
<h2>${escH(title)}</h2><p>${body}</p>${extra}
<div class="sign"><div>${fakeQR(code + r.code)}<br>Verification code: <b>${code}</b></div>
<div style="text-align:center"><i>Digitally signed</i><div class="line"><b>${escH(by)}</b><br>${escH(r.approver || (r.dept + ' Officer'))}</div></div></div>
<div class="note">SAMPLE CERTIFICATE - GENERATED FOR DEMONSTRATION ONLY. NOT A LEGAL OR OFFICIAL DOCUMENT.</div></div></body></html>`;
}
app.get('/api/requests/:id/certificate', auth(), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (!['Approved', 'Completed'].includes(r.status)) throw E(400, 'The certificate is available only after the request is approved.');
  if (r.pay_status === 'pending') throw E(400, 'The certificate is available after the fee is paid.');
  res.type('html').send(certHTML(r));
}));

/* ---------- demo payment (no real money) ---------- */
const BANKS = ['State Bank', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Other Bank'];
app.post('/api/requests/:id/pay', auth('student'), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (r.status !== 'Approved' || r.pay_status !== 'pending') throw E(400, 'There is nothing to pay for this request.');
  const { method, upi = '', card = '', exp = '', cvv = '', bank = '' } = req.body; let label;
  if (method === 'upi') { if (!/^[\w.\-]{2,}@\w{2,}$/.test(String(upi).trim())) throw E(400, 'Enter a valid UPI ID, for example name@bank'); label = 'UPI'; }
  else if (method === 'card') {
    const n = String(card).replace(/\s/g, '');
    if (!/^\d{16}$/.test(n)) throw E(400, 'Enter a 16-digit card number');
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(String(exp))) throw E(400, 'Enter the expiry as MM/YY');
    if (!/^\d{3}$/.test(String(cvv))) throw E(400, 'Enter the 3-digit CVV');
    if (n.endsWith('0000')) throw E(402, 'Payment declined by the demo bank. Try another card, for example 4242 4242 4242 4242.');
    label = 'Card ending ' + n.slice(-4);   // the card number itself is never stored
  } else if (method === 'netbanking') { if (!BANKS.includes(bank)) throw E(400, 'Choose a bank'); label = 'Net Banking (' + bank + ')'; }
  else throw E(400, 'Choose a payment method');
  const ref = 'TXN' + Date.now().toString().slice(-8) + Math.floor(1000 + Math.random() * 9000);
  await db.q("UPDATE requests SET pay_status='paid',pay_ref=?,pay_method=?,paid_amount=?,paid_at=NOW(),updated_at=NOW() WHERE id=?", [ref, label, r.fee, r.id]);
  await hist(r.id, 'Approved', `Fee Rs. ${r.fee} paid via ${label}. Transaction ${ref}.`, req.user.name, 'student');
  await notify(req.user.id, r.id, 'Payment', 'Payment received', `Rs. ${r.fee} received (${ref}). Collect your document from ${where(r)} (Mon-Sat, 10:00 AM to 4:00 PM), or open the digital copy from the request page.`);
  await notifyDept(r.department_id, r.id, 'Payment received', `${r.code}: fee paid`, `${req.user.name} paid Rs. ${r.fee}. You can mark the request completed when the document is ready.`);
  res.json({ ok: true, ref, amount: r.fee, method: label });
}));
function receiptHTML(r) {
  const date = new Date(r.paid_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payment receipt - ${escH(r.pay_ref)}</title><style>${PAGE_CSS}</style></head><body>
<div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page"><div class="wm">SAMPLE</div><h1>SAMPLE COLLEGE OF ENGINEERING</h1><div class="sub">Accounts &amp; Fee Counter</div>
<div class="meta"><span>Receipt No.: <b>${escH(r.pay_ref)}</b></span><span>Date: <b>${date}</b></span></div><h2>PAYMENT RECEIPT</h2>
${tbl([['Particulars', 'Details'], ['Request ID', escH(r.code)], ['Service', escH(r.service)], ['Student', escH(r.student) + (r.roll ? ' (' + escH(r.roll) + ')' : '')], ['Payment method', escH(r.pay_method)], ['Transaction ID', escH(r.pay_ref)], ['Amount paid', '<b>Rs. ' + escH(r.paid_amount) + '</b>'], ['Status', '<b>PAID</b>']])}
<p class="mut">Thank you. Keep this receipt and bring your college ID card when collecting your document.</p>
<div class="note">SAMPLE RECEIPT - DEMO TRANSACTION. NO REAL MONEY WAS CHARGED.</div></div></body></html>`;
}
app.get('/api/requests/:id/receipt', auth(), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (r.pay_status !== 'paid') throw E(400, 'No payment has been made for this request.');
  res.type('html').send(receiptHTML(r));
}));

/* ---------- staff / authority workspace ---------- */
const W = (u, tab) => {
  const staff = u.role === 'staff', dep = staff ? ' AND s.department_id=' + (+u.dept || 0) : '';
  const m = {
    queue: staff ? `st.kind='staff' AND r.status IN('Submitted','Under Verification','Action Needed')` : `st.kind='authority' AND r.status='Pending Approval'`,
    forwarded: `r.status='Pending Approval'`,
    approved: staff ? `r.status='Approved'` : `r.status IN('Approved','Completed')`,
    rejected: staff ? `r.status='Rejected'` : `r.status='Rejected' AND EXISTS(SELECT 1 FROM status_history h WHERE h.request_id=r.id AND h.actor_role='authority')`
  };
  const own = staff ? '' : " AND (COALESCE(TRIM(s.approver),'')='' OR LOWER(TRIM(s.approver))=LOWER(TRIM(?)))";
  return (m[tab] || m.queue) + dep + own;
};
const FROM = `FROM requests r JOIN services s ON s.id=r.service_id JOIN users u ON u.id=r.student_id LEFT JOIN service_steps st ON st.service_id=r.service_id AND st.step_order=r.current_step`;
app.get('/api/work', auth('staff', 'authority'), wrap(async (req, res) => {
  const [me] = await db.q('SELECT detail FROM users WHERE id=?', [req.user.id]); const P = req.user.role === 'authority' ? [(me && me.detail) || ''] : [];
  const list = await db.q(`SELECT r.id,r.code,r.status,r.created_at,r.updated_at,s.name service,u.name student,u.detail,(SELECT h.note FROM status_history h WHERE h.request_id=r.id AND h.actor_role='staff' ORDER BY h.id DESC LIMIT 1) staff_remarks ${FROM} WHERE ${W(req.user, req.query.tab)} ORDER BY r.updated_at DESC, r.id DESC`, P);
  const [c] = await db.q(`SELECT COUNT(*) n,COALESCE(SUM(r.updated_at<NOW()-INTERVAL 72 HOUR),0) d ${FROM} WHERE ${W(req.user, 'queue')}`, P);
  const [p] = await db.q("SELECT COUNT(*) n FROM status_history WHERE actor=? AND actor_role IN('staff','authority') AND DATE(created_at)=CURDATE()", [req.user.name]);
  res.json({ list, waiting: c.n, delayed: +c.d, processed: p.n });
}));
app.post('/api/requests/:id/action', auth('staff', 'authority'), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user), { action, remarks = '' } = req.body, u = req.user;
  const step = r.steps[r.current_step];
  if (!step || step.kind !== (u.role === 'staff' ? 'staff' : 'authority') || ['Approved', 'Rejected', 'Completed'].includes(r.status)) throw E(400, 'This request is not waiting for you');
  if (action !== 'approve' && !remarks.trim()) throw E(400, 'Please add remarks explaining your decision');
  let status, note = remarks.trim(), type, title, body;
  if (action === 'approve') {
    const nx = r.steps[r.current_step + 1];
    status = !nx ? 'Approved' : nx.kind === 'staff' ? 'Under Verification' : 'Pending Approval';
    await db.q('UPDATE requests SET status=?,current_step=?,updated_at=NOW() WHERE id=?', [status, r.current_step + 1, r.id]);
    if (status === 'Approved') await db.q('UPDATE requests SET pay_status=? WHERE id=?', [r.fee > 0 ? 'pending' : 'na', r.id]);
    note = note || (u.role === 'staff' ? 'Documents verified and forwarded.' : 'Approved.');
    type = status; title = status === 'Approved' ? `${r.service} approved` : 'Request forwarded for approval';
    body = status === 'Approved' ? (r.fee > 0 ? `${r.code} is approved. Please pay Rs. ${r.fee} on the request page to receive your document.` : `${r.code} is approved. Collect your document from ${where(r)} (Mon-Sat, 10:00 AM to 4:00 PM). Bring your college ID card and this request ID. You can also open the digital copy from the request page.`) : `${r.code} was verified and sent to the next authority.`;
  } else if (action === 'reject') {
    status = 'Rejected'; await db.q("UPDATE requests SET status='Rejected',updated_at=NOW() WHERE id=?", [r.id]);
    type = 'Rejected'; title = `${r.service} rejected`; body = `Reason: ${note}`;
  } else if (action === 'more_docs' && u.role === 'staff') {
    status = 'Action Needed'; await db.q("UPDATE requests SET status='Action Needed',updated_at=NOW() WHERE id=?", [r.id]);
    type = 'Documents needed'; title = 'Staff asked for one more document'; body = note;
  } else throw E(400, 'Unknown action');
  await hist(r.id, status, note, u.name, u.role);
  await notify(r.student_id, r.id, type, title, body);
  if (action === 'approve') {
    if (status === 'Pending Approval') await notifyAuth(r.approver, r.id, 'Pending Approval', `${r.service} waiting for approval`, `${r.code} was verified by ${u.name}. Please review it.`);
    else if (status === 'Under Verification') await notifyDept(r.department_id, r.id, 'Under Verification', `${r.code} needs the next verification`, `${u.name} approved the previous step of ${r.service}.`);
    else if (status === 'Approved' && u.role === 'authority') await notifyDept(r.department_id, r.id, 'Approved', `${r.code} approved`, `${u.name} approved ${r.service}. Please mark it completed when the document is ready.`);
  } else if (action === 'reject' && u.role === 'authority') await notifyDept(r.department_id, r.id, 'Rejected', `${r.code} rejected`, `${u.name} rejected ${r.service}: ${note}`);
  res.json({ ok: true, status });
}));
app.post('/api/requests/:id/complete', auth('staff'), wrap(async (req, res) => {
  const r = await getReq(req.params.id, req.user);
  if (r.status !== 'Approved') throw E(400, 'Only approved requests can be completed');
  if (r.pay_status === 'pending') throw E(400, 'The student has not paid the fee yet.');
  await db.q("UPDATE requests SET status='Completed',updated_at=NOW() WHERE id=?", [r.id]);
  await hist(r.id, 'Completed', 'Ready to download or collect.', req.user.name, 'staff');
  await notify(r.student_id, r.id, 'Completed', `${r.service} is ready`, `Your document is ready. Collect it from ${where(r)} (Mon-Sat, 10:00 AM to 4:00 PM). Bring your college ID card.`);
  res.json({ ok: true });
}));

/* ---------- notifications ---------- */
app.get('/api/notifications', auth(), wrap(async (req, res) => {
  const list = await db.q('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50', [req.user.id]);
  const rid = await db.q('SELECT n.id,r.code FROM notifications n LEFT JOIN requests r ON r.id=n.request_id WHERE n.user_id=?', [req.user.id]);
  list.forEach(n => n.code = (rid.find(x => x.id === n.id) || {}).code);
  res.json({ list, unread: list.filter(n => !n.is_read).length });
}));
app.post('/api/notifications/read', auth(), wrap(async (req, res) => { await db.q('UPDATE notifications SET is_read=1 WHERE user_id=?' + (req.body.id ? ' AND id=?' : ''), req.body.id ? [req.user.id, req.body.id] : [req.user.id]); res.json({ ok: true }); }));

/* ---------- admin ---------- */
const DEF_FIELDS = [{ k: 'note', l: 'Additional note', t: 'textarea', r: false, p: 'Anything the office should know (optional)' }];
async function saveService(id, b) {
  if (!b.name || !b.department_id) throw E(400, 'Service name and department are required');
  const [dn] = await db.q('SELECT id FROM services WHERE LOWER(name)=LOWER(?) AND id<>?', [b.name.trim(), id || 0]);
  if (dn) throw E(409, 'A service with this name already exists');
  if (b.code && b.code.trim()) { const [dc] = await db.q('SELECT id FROM services WHERE LOWER(code)=LOWER(?) AND id<>?', [b.code.trim(), id || 0]); if (dc) throw E(409, 'This service code is already used by another service'); }
  const fj = JSON.stringify(Array.isArray(b.fields) && b.fields.length ? b.fields : DEF_FIELDS);
  const v = [b.name, b.category || 'General', b.description || '', b.department_id, +b.fee || 0, (b.active === undefined || b.active) ? 1 : 0, b.code || null, Math.max(1, +b.days || 2), fj, b.approver || null, b.eligibility || null, JSON.stringify(Array.isArray(b.proc) ? b.proc.filter(x => String(x).trim()) : [])];
  if (!id) id = (await db.q('INSERT INTO services(name,category,description,department_id,fee,active,code,days,fields,approver,eligibility,proc_steps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', v)).insertId;
  else await db.q('UPDATE services SET name=?,category=?,description=?,department_id=?,fee=?,active=?,code=?,days=?,fields=?,approver=?,eligibility=?,proc_steps=? WHERE id=?', [...v, id]);
  await db.q('DELETE FROM service_docs WHERE service_id=?', [id]); await db.q('DELETE FROM service_steps WHERE service_id=?', [id]);
  for (const d of (b.docs || []).filter(d => d.name && d.name.trim())) await db.q('INSERT INTO service_docs(service_id,name,hint,formats,max_mb) VALUES(?,?,?,?,?)', [id, d.name.trim(), d.hint || '', d.formats || 'PDF, JPG, PNG', Math.min(10, Math.max(1, +d.max_mb || 5))]);
  const steps = (b.steps && b.steps.length) ? b.steps : ['staff'];
  for (const [i, k] of steps.entries()) await db.q('INSERT INTO service_steps(service_id,step_order,kind) VALUES(?,?,?)', [id, i, k === 'authority' ? 'authority' : 'staff']);
  return id;
}
app.get('/api/admin/services', auth('admin'), wrap(async (req, res) => res.json(await services())));
app.post('/api/admin/services', auth('admin'), wrap(async (req, res) => res.json({ id: await saveService(null, req.body) })));
app.put('/api/admin/services/:id', auth('admin'), wrap(async (req, res) => res.json({ id: await saveService(+req.params.id, req.body) })));
app.delete('/api/admin/services/:id', auth('admin'), wrap(async (req, res) => {
  const [c] = await db.q('SELECT COUNT(*) n FROM requests WHERE service_id=?', [req.params.id]);
  if (c.n) { await db.q('UPDATE services SET active=0 WHERE id=?', [req.params.id]); return res.json({ deactivated: true }); }
  await db.q('DELETE FROM services WHERE id=?', [req.params.id]); res.json({ deleted: true });
}));
app.get('/api/admin/users', auth('admin'), wrap(async (req, res) => res.json(await db.q('SELECT u.id,u.name,u.email,u.role,u.department_id,u.detail,d.name dept FROM users u LEFT JOIN departments d ON d.id=u.department_id ORDER BY u.id'))));
app.post('/api/admin/users', auth('admin'), wrap(async (req, res) => {
  const { name, email, password, role, department_id, detail } = req.body;
  if (!name || !email || !password || password.length < 6 || !['student', 'staff', 'authority', 'admin'].includes(role)) throw E(400, 'Fill name, email, role and a 6+ character password');
  const [ex] = await db.q('SELECT id FROM users WHERE email=?', [email.toLowerCase()]); if (ex) throw E(409, 'Email already exists');
  await db.q('INSERT INTO users(name,email,password,role,department_id,detail) VALUES(?,?,?,?,?,?)', [name, email.toLowerCase(), bcrypt.hashSync(password, 10), role, role === 'staff' ? department_id || null : null, ['staff', 'authority'].includes(role) ? (detail || null) : null]);
  res.json({ ok: true });
}));
app.put('/api/admin/users/:id', auth('admin'), wrap(async (req, res) => {
  const { role, department_id } = req.body;
  if (!['student', 'staff', 'authority', 'admin'].includes(role)) throw E(400, 'Bad role');
  await db.q('UPDATE users SET role=?,department_id=? WHERE id=?', [role, role === 'staff' ? department_id || null : null, req.params.id]); res.json({ ok: true });
}));
app.get('/api/admin/requests', auth('admin'), wrap(async (req, res) => res.json(await db.q('SELECT r.id,r.code,r.status,r.created_at,s.name service,d.name dept,u.name student,u.email,u.roll_no roll,r.pay_status,r.paid_amount FROM requests r JOIN services s ON s.id=r.service_id JOIN departments d ON d.id=s.department_id JOIN users u ON u.id=r.student_id ORDER BY r.id DESC'))));
app.get('/api/admin/departments', auth('admin', 'staff', 'student'), wrap(async (req, res) => res.json(await db.q('SELECT * FROM departments ORDER BY id'))));
app.post('/api/admin/departments', auth('admin'), wrap(async (req, res) => {
  if (!req.body.name || !req.body.name.trim()) throw E(400, 'Department name required');
  try { await db.q('INSERT INTO departments(name) VALUES(?)', [req.body.name.trim()]); } catch { throw E(409, 'Department already exists'); } res.json({ ok: true });
}));
app.get('/api/admin/reports', auth('admin'), wrap(async (req, res) => {
  const days = +req.query.days || 30;
  const counts = await db.q('SELECT status,COUNT(*) n FROM requests WHERE created_at>=NOW()-INTERVAL ? DAY GROUP BY status', [days]);
  const by = await db.q('SELECT s.name,COUNT(*) n FROM requests r JOIN services s ON s.id=r.service_id WHERE r.created_at>=NOW()-INTERVAL ? DAY GROUP BY s.id,s.name ORDER BY n DESC', [days]);
  const avg = await db.q("SELECT s.name,ROUND(AVG(TIMESTAMPDIFF(MINUTE,r.created_at,r.updated_at))/1440,1) d FROM requests r JOIN services s ON s.id=r.service_id WHERE r.status='Completed' AND r.created_at>=NOW()-INTERVAL ? DAY GROUP BY s.id,s.name", [days]);
  const [rev] = await db.q("SELECT COALESCE(SUM(paid_amount),0) total FROM requests WHERE pay_status='paid' AND paid_at>=NOW()-INTERVAL ? DAY", [days]);
  res.json({ counts, by, avg, revenue: +rev.total });
}));

app.use((e, req, res, next) => res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? 'File is too large (maximum 10 MB)' : e.message }));

/* delayed-request reminders (FR-11) */
setInterval(async () => {
  try {
    const rows = await db.q(`SELECT r.id,r.code,r.student_id FROM requests r WHERE r.status IN('Under Verification','Action Needed','Pending Approval') AND r.updated_at<NOW()-INTERVAL 72 HOUR AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.request_id=r.id AND n.type='Delayed' AND n.created_at>NOW()-INTERVAL 72 HOUR)`);
    for (const r of rows) await notify(r.student_id, r.id, 'Delayed', 'Your request is taking longer than usual', `${r.code} has been waiting for 3 days. We have reminded the approver.`);
  } catch (e) { /* ignore */ }
}, 10 * 60 * 1000);

const PORT = process.env.PORT || 3000;
db.init().then(() => app.listen(PORT, () => console.log(`\n  StepWise is running ->  http://localhost:${PORT}\n`)))
  .catch(e => { if (e.code === 'ER_ACCESS_DENIED_ERROR') { try { fs.unlinkSync(path.join(__dirname, '.setup-done')); } catch { } } console.error('\n  Could not start: ' + e.message + (process.env.DB_TYPE !== 'mysql' ? '\n' : '\n  -> Make sure MySQL is running and DB_USER / DB_PASSWORD in .env are correct.\n')); process.exit(1); });