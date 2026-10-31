const bcrypt = require('bcryptjs'), path = require('path'), fs = require('fs'), crypto = require('node:crypto');
/* Built-in database by default (no install, no password). Set DB_TYPE=mysql in .env to use MySQL instead. */
const LITE = (process.env.DB_TYPE || 'sqlite').toLowerCase() !== 'mysql';
let pool, lite;
const tr = sql => sql
  .replace(/NOW\(\)-INTERVAL \? DAY/g, "datetime('now','-'||?||' days')")
  .replace(/NOW\(\)-INTERVAL (\d+) HOUR/g, "datetime('now','-$1 hours')")
  .replace(/NOW\(\)/g, "datetime('now')")
  .replace(/CURDATE\(\)/g, "date('now','localtime')")
  .replace(/DATE\(created_at\)/g, "date(created_at,'localtime')")
  .replace(/TIMESTAMPDIFF\(MINUTE,([\w.]+),([\w.]+)\)/g, '((julianday($2)-julianday($1))*1440)')
  .replace(/INSERT IGNORE/g, 'INSERT OR IGNORE');
const iso = r => { for (const k in r) if (/_at$/.test(k) && typeof r[k] === 'string') r[k] = r[k].replace(' ', 'T') + 'Z'; return r; };
function liteQ(sql, params = []) {
  const flat = []; let i = 0;
  sql = tr(sql).replace(/\?/g, () => { const p = params[i++]; if (Array.isArray(p)) { flat.push(...p); return p.map(() => '?').join(','); } flat.push(p === undefined ? null : typeof p === 'boolean' ? +p : p); return '?'; });
  const st = lite.prepare(sql);
  if (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql)) return st.all(...flat).map(r => iso({ ...r }));
  const r = st.run(...flat); return { insertId: Number(r.lastInsertRowid), affectedRows: r.changes };
}
const q = (s, p) => LITE ? Promise.resolve().then(() => liteQ(s, p)) : pool.query(s, p).then(r => r[0]);
const ddl = t => LITE ? t.replace(/INT AUTO_INCREMENT PRIMARY KEY/g, 'INTEGER PRIMARY KEY AUTOINCREMENT').replace(/ENUM\([^)]*\)/g, 'TEXT').replace(/TINYINT/g, 'INTEGER').replace('name VARCHAR(100) UNIQUE NOT NULL', 'name VARCHAR(100) UNIQUE NOT NULL COLLATE NOCASE') : t;
const T = [
`CREATE TABLE IF NOT EXISTS meta(k VARCHAR(40) PRIMARY KEY, v VARCHAR(40))`,
`CREATE TABLE IF NOT EXISTS departments(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) UNIQUE NOT NULL)`,
`CREATE TABLE IF NOT EXISTS users(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, email VARCHAR(120) UNIQUE NOT NULL, password VARCHAR(100) NOT NULL,
  role ENUM('student','staff','authority','admin') NOT NULL, department_id INT NULL, detail VARCHAR(120) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(department_id) REFERENCES departments(id))`,
`CREATE TABLE IF NOT EXISTS services(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, category VARCHAR(40), description VARCHAR(300),
  department_id INT NOT NULL, fee INT DEFAULT 0, active TINYINT DEFAULT 1, FOREIGN KEY(department_id) REFERENCES departments(id))`,
`CREATE TABLE IF NOT EXISTS service_docs(id INT AUTO_INCREMENT PRIMARY KEY, service_id INT NOT NULL, name VARCHAR(120) NOT NULL, hint VARCHAR(200),
  FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS service_steps(id INT AUTO_INCREMENT PRIMARY KEY, service_id INT NOT NULL, step_order INT NOT NULL, kind ENUM('staff','authority') NOT NULL,
  FOREIGN KEY(service_id) REFERENCES services(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS requests(id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(30) UNIQUE NOT NULL, student_id INT NOT NULL, service_id INT NOT NULL,
  status VARCHAR(20) NOT NULL, current_step INT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(student_id) REFERENCES users(id), FOREIGN KEY(service_id) REFERENCES services(id))`,
`CREATE TABLE IF NOT EXISTS request_docs(id INT AUTO_INCREMENT PRIMARY KEY, request_id INT NOT NULL, doc_name VARCHAR(120), file_name VARCHAR(200), orig_name VARCHAR(200),
  size INT, status VARCHAR(12) DEFAULT 'pending', FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS status_history(id INT AUTO_INCREMENT PRIMARY KEY, request_id INT NOT NULL, status VARCHAR(20), note VARCHAR(500), actor VARCHAR(100),
  actor_role VARCHAR(12) DEFAULT 'system', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE)`,
`CREATE TABLE IF NOT EXISTS notifications(id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, request_id INT NULL, type VARCHAR(30), title VARCHAR(160), body VARCHAR(400),
  is_read TINYINT DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`
];
/* adds a column to an existing database (so old data is kept). returns true if it was just added */
async function addCol(t, c, def) {
  const have = LITE ? (await q(`PRAGMA table_info(${t})`)).some(x => x.name === c) : (await q(`SHOW COLUMNS FROM \`${t}\` LIKE ?`, [c])).length > 0;
  if (have) return false;
  await q(`ALTER TABLE \`${t}\` ADD COLUMN \`${c}\` ${def}`); return true;
}
const F = (k, l, t, r, extra = {}) => ({ k, l, t, r, ...extra });
const NOTE = F('note', 'Specific requirements / note', 'textarea', false, { p: 'Anything the office should know (optional)' });
// name, code, category, description, department, fee, days, documents, workflow (s = staff verification, a = approving authority), form fields
const C = [
{ name:'Bonafide Certificate', code:'BC-101', cat:'Certificate', desc:'Official letter certifying that you are a bonafide enrolled student, for visa, passport, education loan or scholarship use.', dept:'Academic Office', fee:50, days:2,
  docs:[['College ID card (copy)','Front and back, clearly readable'],['Latest fee receipt','Current semester, PDF or image'],['Passport-size photograph','Recent, plain background'],['Purpose letter','Why you need the certificate, signed']], flow:'sa',
  fields:[F('purpose','Purpose of Certificate','select',true,{o:['Passport Application / Renewal','Education Loan / Bank Requirement','Government / State Scholarship','Public Transit Concession Pass','Internship / Industry Project Application','Other Administrative Purpose'],h:'Specify where this certificate will be submitted.'}),
    F('year','Current Academic Year & Semester','text',true,{p:'e.g., Year 3, Semester 6'}), F('note','Specific Requirements / Addressee Note','textarea',false,{p:'e.g., "To the Regional Passport Officer" or "State Bank of India"'})] },
{ name:'Transcript Request', code:'TR-201', cat:'Records', desc:'Certified semester-wise grade record with the college seal, for higher studies or employment.', dept:'Examination Cell', fee:200, days:5,
  docs:[['College ID card (copy)','Front and back'],['Fee receipt','Rs. 200 payment proof'],['Application letter','Signed']], flow:'sa',
  fields:[F('copies','Number of Sealed Copies Needed','number',true,{p:'1'}), F('recipient','Recipient University / Organization','text',true,{p:'e.g., Graduate Admissions, University of Toronto / WES Evaluation'}),
    F('delivery','Delivery Mode','select',true,{o:['Digital PDF + In-Person Campus Pickup','Digital PDF Only','Express Courier Dispatch']})] },
{ name:'Fee Receipt / Statement of Accounts', code:'FA-301', cat:'Records', desc:'Itemised breakdown of tuition, lab and hostel fees with the institutional stamp.', dept:'Accounts', fee:0, days:2,
  docs:[['College ID card (copy)','Front and back'],['Application letter','Mention semester and purpose, signed']], flow:'s',
  fields:[F('term','Semester / Academic Year','text',true,{p:'e.g., 2025-26, Semester 5'}), F('type','Statement Type','select',true,{o:['Tuition fee receipt','Hostel fee receipt','Exam fee receipt','Full statement of accounts']}), NOTE] },
{ name:'ID Card (new or duplicate)', code:'SC-401', cat:'Card', desc:'Apply for a new card or replace a lost or damaged one.', dept:'Student Services', fee:100, days:3,
  docs:[['Passport-size photograph','Recent, plain background'],['Fee receipt','Rs. 100 payment proof']], flow:'s',
  fields:[F('reason','Reason for Request','select',true,{o:['New ID card','Lost card (duplicate)','Damaged card (replacement)']}), NOTE] },
{ name:'Hostel Permission & Outpass', code:'HP-501', cat:'Permission', desc:'Authorisation for hostel residents to leave campus overnight, attend family events or travel on weekends.', dept:'Hostel Office', fee:0, days:1,
  docs:[['Parent consent letter','Signed by parent or guardian'],['College ID card (copy)','Front and back']], flow:'sa',
  fields:[F('from','Leaving Campus On','date',true), F('to','Returning On','date',true), F('dest','Destination','text',true,{p:'City / address'}), F('reason','Reason','select',true,{o:['Family event','Medical','Weekend travel','Other']})] },
{ name:'Leave Permission', code:'AL-601', cat:'Permission', desc:'Request approval for planned absence from classes.', dept:'Department Office', fee:0, days:2,
  docs:[['Leave application letter','Dates and reason, signed'],['Supporting document','Medical certificate or parent consent']], flow:'sa',
  fields:[F('from','Leave From','date',true), F('to','Leave To','date',true), F('reason','Reason','select',true,{o:['Medical','Family event','Sports / university event','Other']}), NOTE] },
{ name:'No-Dues Certificate', code:'ND-701', cat:'Certificate', desc:'Clearance from library, hostel, lab and accounts for graduating students or course transfer.', dept:'Academic Office', fee:0, days:4,
  docs:[['Library clearance slip',''],['Hostel clearance slip',''],['Lab clearance slip','']], flow:'sa',
  fields:[F('reason','Reason for No-Dues','select',true,{o:['Graduation','Course transfer','Other']}), F('year','Graduating Year','text',true,{p:'e.g., 2027'}), NOTE] },
{ name:'Address / Contact Detail Update', code:'AC-801', cat:'Records', desc:'Update your residential address, emergency contact or personal email in the student records.', dept:'Academic Office', fee:0, days:1,
  docs:[['Address proof','Aadhaar, utility bill or rental agreement'],['College ID card (copy)','Front and back']], flow:'s',
  fields:[F('type','What do you want to update?','select',true,{o:['Residential address','Emergency contact','Personal email','Phone number']}), F('value','New value','text',true,{p:'Enter the new details exactly'})] },
{ name:'Scholarship Document', code:'SD-901', cat:'Scholarship', desc:'Fee and income verification papers for scholarship forms.', dept:'Accounts', fee:0, days:3,
  docs:[['Income certificate','Issued within the last 6 months'],['Latest fee receipt','Current semester'],['Aadhaar card (copy)','Both sides']], flow:'sa',
  fields:[F('scheme','Scholarship Name','text',true,{p:'e.g., State Post-Matric Scholarship'}), F('year','Academic Year','text',true,{p:'e.g., 2025-26'}), NOTE] }
];
async function ensureCatalog() {
  const [h] = await q("SELECT id FROM departments WHERE name='Hostel Office'");
  if (!h) { const r = await q("INSERT INTO departments(name) VALUES('Hostel Office')");
    await q('INSERT IGNORE INTO users(name,email,password,role,department_id,detail) VALUES(?,?,?,?,?,?)', ['Hostel Staff', 'hostel@campus.edu', bcrypt.hashSync(crypto.randomBytes(18).toString('base64url'), 10), 'staff', r.insertId, 'Hostel Office']); }
  const deps = Object.fromEntries((await q('SELECT id,name FROM departments')).map(d => [d.name, d.id]));
  for (const s of C) {
    const [ex] = await q('SELECT id,fields FROM services WHERE name=?', [s.name]);
    if (ex) { if (!ex.fields) await q('UPDATE services SET code=?,days=?,fields=? WHERE id=?', [s.code, s.days, JSON.stringify(s.fields), ex.id]); continue; }
    const r = await q('INSERT INTO services(name,category,description,department_id,fee,code,days,fields) VALUES(?,?,?,?,?,?,?,?)', [s.name, s.cat, s.desc, deps[s.dept], s.fee, s.code, s.days, JSON.stringify(s.fields)]);
    for (const d of s.docs) await q('INSERT INTO service_docs(service_id,name,hint) VALUES(?,?,?)', [r.insertId, d[0], d[1]]);
    for (const [i, k] of [...s.flow].entries()) await q('INSERT INTO service_steps(service_id,step_order,kind) VALUES(?,?,?)', [r.insertId, i, k === 's' ? 'staff' : 'authority']);
  }
  await q("UPDATE users SET roll_no='CS-2023-042' WHERE email='ravi@student.campus.edu' AND roll_no IS NULL");
  await q("UPDATE users SET roll_no='CS-2024-017' WHERE email='meghana@student.campus.edu' AND roll_no IS NULL");
}
const DEMO_USERS = [
  {"role": "student", "name": "Ravi Teja", "email": "ravi@student.campus.edu", "dept": null, "detail": "B.Tech CSE (AI and ML), Year 3", "roll": "CS-2023-042"},
  {"role": "student", "name": "Meghana P", "email": "meghana@student.campus.edu", "dept": null, "detail": "B.Tech CSE, Year 2", "roll": "CS-2024-017"},
  {"role": "student", "name": "Arjun S", "email": "arjun.s@student.campus.edu", "dept": null, "detail": "B.Tech ECE, Year 4", "roll": "EC-2022-031"},
  {"role": "student", "name": "Divya N", "email": "divya.n@student.campus.edu", "dept": null, "detail": "B.Tech IT, Year 3", "roll": "IT-2023-058"},
  {"role": "student", "name": "Karthik R", "email": "karthik.r@student.campus.edu", "dept": null, "detail": "B.Tech Mechanical, Year 2", "roll": "ME-2024-009"},
  {"role": "student", "name": "Sneha K", "email": "sneha.k@student.campus.edu", "dept": null, "detail": "B.Tech CSE (Data Science), Year 1", "roll": "CS-2025-120"},
  {"role": "staff", "name": "S. Kumari", "email": "kumar@campus.edu", "dept": "Academic Office", "detail": "Academic Office", "roll": null},
  {"role": "staff", "name": "Anita M", "email": "anita.m@campus.edu", "dept": "Academic Office", "detail": "Academic Office", "roll": null},
  {"role": "staff", "name": "Accounts Staff", "email": "accounts@campus.edu", "dept": "Accounts", "detail": "Accounts", "roll": null},
  {"role": "staff", "name": "Dept Office Staff", "email": "deptoffice@campus.edu", "dept": "Department Office", "detail": "Department Office", "roll": null},
  {"role": "staff", "name": "Student Services Staff", "email": "studentservices@campus.edu", "dept": "Student Services", "detail": "Student Services", "roll": null},
  {"role": "staff", "name": "Exam Cell Staff", "email": "exam@campus.edu", "dept": "Examination Cell", "detail": "Examination Cell", "roll": null},
  {"role": "staff", "name": "Hostel Staff", "email": "hostel@campus.edu", "dept": "Hostel Office", "detail": "Hostel Office", "roll": null},
  {"role": "authority", "name": "Dr. R. Rao", "email": "dean.academic@campus.edu", "dept": null, "detail": "Dean of Academic Affairs", "roll": null, "legacy": "hod@campus.edu"},
  {"role": "authority", "name": "Dr. S. Mehta", "email": "controller@campus.edu", "dept": null, "detail": "Controller of Examinations", "roll": null, "legacy": "dean@campus.edu"},
  {"role": "authority", "name": "Mr. K. Prasad", "email": "finance@campus.edu", "dept": null, "detail": "Senior Finance Officer", "roll": null},
  {"role": "authority", "name": "Dr. P. Lakshmi", "email": "warden@campus.edu", "dept": null, "detail": "Chief Warden", "roll": null},
  {"role": "authority", "name": "Dr. V. Sharma", "email": "registrar@campus.edu", "dept": null, "detail": "Registrar & Dean", "roll": null},
  {"role": "authority", "name": "Dr. M. Reddy", "email": "hod@campus.edu", "dept": null, "detail": "Head of Department", "roll": null},
  {"role": "admin", "name": "Admin", "email": "admin@campus.edu", "dept": null, "detail": "Administrator", "roll": null}
];
const LOC = { 'Academic Office': 'Administrative Block, Room 104', 'Accounts': 'Administrative Block, Room 112', 'Department Office': 'Main Academic Block, Room 205', 'Student Services': 'Student Centre, Room 12', 'Examination Cell': 'Examination Block, Room 3', 'Hostel Office': 'Hostel Block A, Room 1' };
async function upgradeDemo() {
  await q('CREATE TABLE IF NOT EXISTS meta(k VARCHAR(40) PRIMARY KEY, v VARCHAR(40))');
  if ((await q("SELECT 1 FROM meta WHERE k='demo_v6'")).length) return;
  const deps = Object.fromEntries((await q('SELECT id,name FROM departments')).map(x => [x.name, x.id]));
  const newDemoCredentials = [];
  for (const u of DEMO_USERS) {
    const [ex] = await q('SELECT id,password FROM users WHERE email=? OR email=?', [u.email, u.legacy || u.email.replace('campus.edu', 'gitam.edu')]);
    if (ex) {
      if (u.legacy) await q('UPDATE users SET email=?,name=?,detail=? WHERE id=?', [u.email, u.name, u.detail, ex.id]);
      if (!u.legacy) await q('UPDATE users SET email=? WHERE id=?', [u.email, ex.id]);
    } else {
      const demoPassword = crypto.randomBytes(18).toString('base64url');
      await q('INSERT INTO users(name,email,password,role,department_id,detail,roll_no) VALUES(?,?,?,?,?,?,?)', [u.name, u.email, bcrypt.hashSync(demoPassword, 10), u.role, u.dept ? deps[u.dept] : null, u.detail, u.roll]);
      newDemoCredentials.push(`${u.email}: ${demoPassword}`);
    }
  }
  await q("DELETE FROM users WHERE email IN ('security@campus.edu','records@campus.edu')");
  await q("INSERT INTO meta VALUES('demo_v6','1')");
  if (newDemoCredentials.length) console.log('Generated local demo passwords (keep private):\n' + newDemoCredentials.join('\n'));
}
async function seed() {
  for (const d of ['Academic Office','Accounts','Department Office','Student Services','Examination Cell']) await q('INSERT INTO departments(name) VALUES(?)', [d]);
  await ensureCatalog();
  console.log('Database seeded with demo data.');
}
const DET = {
  'Bonafide Certificate': { a: 'Dean of Academic Affairs', e: 'Must be a currently registered full-time or part-time student with cleared semester enrollment.', p: ['Fill in application details specifying the certificate purpose and academic semester.', 'Upload a valid student ID card scan and proof of current semester tuition clearance.', 'Department verification officer validates enrollment records and absence penalties.', 'Dean of Academic Affairs reviews and endorses the signed certificate.', 'Collect the stamped certificate from the office shown after approval.'] },
  'Transcript Request': { a: 'Controller of Examinations', e: 'Open to current students and alumni with no academic discipline holds.', p: ['Submit the request with the number of official sealed copies needed.', 'Attach your ID card copy, fee receipt and application letter.', 'Examinations audit desk reconciles grade records and tabulations.', 'Controller of Examinations grants authorization and applies the seal.', 'Sealed copies are prepared for collection from the Examination Cell.'] },
  'Fee Receipt / Statement of Accounts': { a: '', e: 'Enrolled students who need financial certificates for tax rebate or sponsor reimbursement.', p: ['Select the academic year and the payment you need a receipt for.', 'Attach your ID card copy and a signed application letter.', 'Accounts office cross-checks ledger entries with the college bank account.', 'Accounts staff issue and stamp the official receipt.'] },
  'ID Card (new or duplicate)': { a: '', e: 'Enrolled students who need a new card or whose previous card was lost or broken.', p: ['Specify the reason (new card, loss, damage or wear and tear).', 'Upload a recent passport-size photo on a plain background.', 'Pay the card fee and upload the payment receipt.', 'Student Services verifies your details and deactivates the old card.', 'The new card is prepared and available for collection at the office.'] },
  'Hostel Permission & Outpass': { a: 'Chief Warden', e: 'Must be an active hostel resident in good disciplinary standing.', p: ['Specify departure and return dates, destination and reason.', 'Upload the parent or guardian written consent.', 'Hostel supervisor verifies guardian consent and floor log records.', 'Chief Warden approves the outpass.'] },
  'Leave Permission': { a: 'Head of Department', e: 'Students with documented illness or an official college representation sanction.', p: ['Enter the dates of absence and the reason.', 'Upload the leave letter and a medical certificate or sanction letter.', 'Department office validates attendance records and faculty input.', 'Head of Department approves; the attendance register is credited with excused absence.'] },
  'No-Dues Certificate': { a: 'Registrar & Dean', e: 'Final semester students preparing for graduation, or students withdrawing enrollment.', p: ['Submit the clearance request with roll number and program completion details.', 'Upload the library, hostel and lab clearance slips.', 'Officers confirm zero library fines, returned lab equipment and settled tuition.', 'Registrar & Dean approves and the consolidated No-Dues Certificate is issued with the official seal.'] },
  'Address / Contact Detail Update': { a: '', e: 'All currently enrolled students.', p: ['Enter the new address or contact details exactly as they should appear.', 'Upload a government address proof (passport, driving licence or utility bill).', 'Records staff validate the proof and update the student record.'] },
  'Scholarship Document': { a: 'Senior Finance Officer', e: 'Students applying for a government or institutional scholarship.', p: ['Enter the scholarship name and academic year.', 'Upload the income certificate, fee receipt and ID proof.', 'Accounts verifies fee and income details.', 'Senior Finance Officer approves and the papers are issued for collection.'] }
};
async function applyDetails() {
  for (const [name, x] of Object.entries(DET)) await q('UPDATE services SET approver=?,eligibility=?,proc_steps=? WHERE name=? AND proc_steps IS NULL', [x.a, x.e, JSON.stringify(x.p), name]);
  await q("UPDATE requests SET pay_status=CASE WHEN status='Approved' AND (SELECT fee FROM services s WHERE s.id=requests.service_id)>0 THEN 'pending' ELSE 'na' END WHERE pay_status IS NULL");
  await q("UPDATE service_docs SET formats='JPG, PNG', max_mb=4 WHERE name LIKE '%photograph%' AND formats='PDF, JPG, PNG' AND max_mb=5");
}
async function fixFlows() {
  if ((await q("SELECT 1 FROM meta WHERE k='flow_v2'")).length) return;
  for (const name of ['ID Card (new or duplicate)', 'Hostel Permission & Outpass', 'Fee Receipt / Statement of Accounts', 'Address / Contact Detail Update', 'No-Dues Certificate']) {
    const [s] = await q('SELECT id FROM services WHERE name=?', [name]); if (!s) continue;
    await q('DELETE FROM service_steps WHERE service_id=?', [s.id]);
    await q("INSERT INTO service_steps(service_id,step_order,kind) VALUES(?,0,'staff')", [s.id]);
    await q("INSERT INTO service_steps(service_id,step_order,kind) VALUES(?,1,'authority')", [s.id]);
  }
  await q("UPDATE requests SET current_step=1 WHERE current_step=2 AND status='Pending Approval' AND service_id IN (SELECT id FROM services WHERE name='No-Dues Certificate')");
  for (const name of ['ID Card (new or duplicate)', 'Hostel Permission & Outpass', 'Fee Receipt / Statement of Accounts', 'Address / Contact Detail Update', 'No-Dues Certificate', 'Leave Permission', 'Scholarship Document']) if (DET[name]) await q('UPDATE services SET proc_steps=? WHERE name=?', [JSON.stringify(DET[name].p), name]);
  await q("INSERT INTO meta VALUES('flow_v2','1')");
}
async function fixFlows3() {
  if ((await q("SELECT 1 FROM meta WHERE k='flow_v3'")).length) return;
  for (const name of ['ID Card (new or duplicate)', 'Fee Receipt / Statement of Accounts', 'Address / Contact Detail Update']) {
    const [s] = await q('SELECT id FROM services WHERE name=?', [name]); if (!s) continue;
    await q('DELETE FROM service_steps WHERE service_id=?', [s.id]);
    await q("INSERT INTO service_steps(service_id,step_order,kind) VALUES(?,0,'staff')", [s.id]);
    await q("UPDATE services SET approver='' WHERE id=?", [s.id]);
    await q("UPDATE requests SET status='Approved',current_step=1,pay_status=CASE WHEN (SELECT fee FROM services x WHERE x.id=requests.service_id)>0 THEN 'pending' ELSE 'na' END WHERE status='Pending Approval' AND service_id=?", [s.id]);
  }
  await q("UPDATE services SET approver='Head of Department' WHERE name='Leave Permission'");
  for (const name of ['ID Card (new or duplicate)', 'Fee Receipt / Statement of Accounts', 'Address / Contact Detail Update', 'Leave Permission']) if (DET[name]) await q('UPDATE services SET proc_steps=? WHERE name=?', [JSON.stringify(DET[name].p), name]);
  await q("INSERT INTO meta VALUES('flow_v3','1')");
}
async function statusV2() {
  if ((await q("SELECT 1 FROM meta WHERE k='status_v2'")).length) return;
  if (!LITE) { await q('ALTER TABLE requests MODIFY status VARCHAR(30) NOT NULL'); await q('ALTER TABLE status_history MODIFY status VARCHAR(30)'); }
  await q("UPDATE requests SET status='Under Verification' WHERE status='Under Review'");
  await q("UPDATE status_history SET status='Under Verification' WHERE status='Under Review'");
  await q("UPDATE notifications SET type='Under Verification' WHERE type='Under Review'");
  await q("INSERT INTO meta VALUES('status_v2','1')");
}
async function init() {
  if (LITE) {
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { throw new Error('This Node.js is too old for the built-in database. Please install the LTS version from https://nodejs.org (version 22.13 or newer).'); }
    const dir = path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
    lite = new DatabaseSync(path.join(dir, 'sw.db')); lite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
  } else {
    const mysql = require('mysql2/promise');
    const c = { host: process.env.DB_HOST||'localhost', port: +process.env.DB_PORT||3306, user: process.env.DB_USER||'root', password: process.env.DB_PASSWORD||'' };
    const name = process.env.DB_NAME || 'sw_db';
    const k = await mysql.createConnection(c);
    await k.query('CREATE DATABASE IF NOT EXISTS `' + name + '`'); await k.end();
    pool = mysql.createPool({ ...c, database: name, waitForConnections: true, connectionLimit: 10 });
  }
  for (const t of T) await q(ddl(t));
  await addCol('users', 'roll_no', 'VARCHAR(30) NULL');
  await addCol('services', 'days', 'INT DEFAULT 2');
  await addCol('services', 'fields', 'TEXT NULL');
  await addCol('requests', 'details', 'TEXT NULL');
  await addCol('departments', 'location', 'VARCHAR(120) NULL');
  await addCol('services', 'approver', 'VARCHAR(80) NULL');
  await addCol('services', 'eligibility', 'VARCHAR(300) NULL');
  await addCol('services', 'proc_steps', 'TEXT NULL');
  await addCol('service_docs', 'formats', "VARCHAR(30) DEFAULT 'PDF, JPG, PNG'");
  await addCol('service_docs', 'max_mb', 'INT DEFAULT 5');
  await addCol('requests', 'pay_status', 'VARCHAR(10) NULL');
  await addCol('requests', 'pay_ref', 'VARCHAR(30) NULL');
  await addCol('requests', 'pay_method', 'VARCHAR(40) NULL');
  await addCol('requests', 'paid_amount', 'INT NULL');
  await addCol('requests', 'paid_at', 'TIMESTAMP NULL');
  const first = await addCol('services', 'code', 'VARCHAR(20) NULL');
  const [{ n }] = await q('SELECT COUNT(*) n FROM users');
  if (!n) await seed(); else if (first) { await ensureCatalog(); console.log('Database upgraded: new service forms and services added.'); }
  for (const [k, v] of Object.entries(LOC)) await q('UPDATE departments SET location=? WHERE name=? AND location IS NULL', [v, k]);
  await upgradeDemo();
  await statusV2();
  await applyDetails();
  await fixFlows();
  await fixFlows3();
}
module.exports = { init, q };