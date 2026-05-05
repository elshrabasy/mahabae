import 'dotenv/config';
import express from 'express';
import PDFDocument from 'pdfkit';
import bidiFactory from 'bidi-js';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { randomUUID, timingSafeEqual, createHash } from 'crypto';
import { WebSocketServer } from 'ws';
import { uploadAvatar, validateAvatarMagicBytes } from './middleware/uploadAvatar.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bidi = bidiFactory();
const app = express();
app.set('trust proxy', 1);
const PORT = Number(process.env.PORT || 5050);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 5443);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

const JWT_SECRET = process.env.JWT_SECRET || (IS_PROD ? '' : 'dev-only-jwt-secret-change-before-production-32chars');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (IS_PROD ? '' : 'dev-only-admin-token-change-before-production-32chars');

if(IS_PROD && (!JWT_SECRET || JWT_SECRET.length < 32 || !ADMIN_TOKEN || ADMIN_TOKEN.length < 32)){
  console.error('FATAL: JWT_SECRET and ADMIN_TOKEN must be set to secure random values >= 32 chars in production.');
  process.exit(1);
}
if(!IS_PROD && (!process.env.JWT_SECRET || !process.env.ADMIN_TOKEN)){
  console.warn('DEV WARNING: JWT_SECRET / ADMIN_TOKEN are using development-only fallbacks.');
}
const dbPath = path.join(__dirname,'data','attendance-db.json');


app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https:"],
      "connect-src": ["'self'", "https:", "ws:", "wss:"]
    }
  }
}));
app.use(compression());
app.use(cookieParser());
const CORS_ALLOWED = String(process.env.CORS_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean);
if(IS_PROD && CORS_ALLOWED.length === 0){
  console.error('FATAL: CORS_ORIGINS must be set in production.');
  process.exit(1);
}
app.use(cors({
  origin(origin, callback){
    if(!origin) return callback(null, true);
    if(!IS_PROD && CORS_ALLOWED.length === 0) return callback(null, true);
    if(CORS_ALLOWED.includes(origin)) return callback(null, true);
    return callback(new Error('CORS blocked'));
  },
  credentials:true
}));
// PATCH v16.7.2-hotfix: do NOT rate-limit the portal/static assets.
// The previous global limiter ran before express.static, so refreshing the portal
// or loading assets could return a blank "Too many requests" page.
// Limit API calls only, and keep login protected with its own stricter limiter.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  // PATCH v16.7.3: higher default + per-employee key to avoid CGNAT lockouts.
  max: Number(process.env.API_RATE_LIMIT_MAX || 6000),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    try {
      const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.token || '');
      if (tok) {
        const decoded = jwt.decode(tok);
        if (decoded?.employeeCode) return 'emp:' + String(decoded.employeeCode).toUpperCase();
      }
    } catch {}
    return 'ip:' + (req.ip || '0.0.0.0');
  },
  skip: (req) => {
    if (!req.path.startsWith('/api/')) return true;
    if (req.path === '/api/health') return true;
    if (req.path.startsWith('/api/sync/since')) return true;
    if (req.path.startsWith('/api/admin/sync/since')) return true;
    return false;
  },
  message: { ok: false, message: 'طلبات كثيرة، حاول مرة أخرى بعد قليل' }
});
app.use(apiLimiter);

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'محاولات دخول كثيرة، حاول بعد دقيقة' }
});
app.use((req,res,next)=>{ if(req.path.startsWith('/api/')) res.setHeader('Cache-Control','no-store'); next(); });
app.use(express.json({limit:'2mb'}));
app.use('/uploads', (req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; img-src 'self' data: https:");
  next();
}, express.static(path.join(__dirname, 'public', 'uploads')));
app.use((req,res,next)=>{
  if(req.path==='/' || req.path.endsWith('.html') || req.path.endsWith('sw.js') || req.path.endsWith('manifest.json')){
    res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Expires','0');
  }
  next();
});
app.use(express.static(path.join(__dirname,'public'), { etag:false, maxAge:0 }));

const defaultDb = () => ({
  settings:{ companyName:'Mahabat Alfan', companyLatitude:24.624057, companyLongitude:46.773938, allowedRadiusMeters:250, minGpsAccuracy:100, allowCheckoutOutsideRange:false, workStart:'08:00', workEnd:'17:00', lateAfterMinutes:15, enabled:true, overtimeEnabled:true, overtimeMinMinutes:30 },
  employees:[
    {employeeCode:'EMP-001',name:'أحمد محمد',passwordHash:bcrypt.hashSync(cryptoRandomPassword(),12),active:true,department:'الإدارة',jobTitle:'مدير عام',overtimeRate:0,avatarUrl:''},
    {employeeCode:'EMP-002',name:'محمد علي',passwordHash:bcrypt.hashSync(cryptoRandomPassword(),12),active:true,department:'التصميم',jobTitle:'مصمم',overtimeRate:0,avatarUrl:''},
    {employeeCode:'EMP-003',name:'سارة خالد',passwordHash:bcrypt.hashSync(cryptoRandomPassword(),12),active:true,department:'الموارد البشرية',jobTitle:'مسؤول HR',overtimeRate:0,avatarUrl:''}
  ],
  records:[], attempts:[], liveEvents:[], _eventSeq:0, leaveRequests:[], loanRequests:[], payrollSlips:[], notifications:[], whatsappSettings:{enabled:false,provider:'',instanceId:'',token:'',phone:'',templates:{late:'تنبيه تأخير',leave:'تم تحديث طلب الإجازة',loan:'تم تحديث طلب السلفة',salary:'تم إصدار كشف الراتب'}}, companies:[{id:'main',name:'Mahabat Alfan',domain:'mahabae-production.up.railway.app',status:'Active',createdAt:new Date().toISOString()}], currentCompanyId:'main'
});
function readDb(){ if(!fs.existsSync(dbPath)){fs.mkdirSync(path.dirname(dbPath),{recursive:true});fs.writeFileSync(dbPath,JSON.stringify(defaultDb(),null,2));} return JSON.parse(fs.readFileSync(dbPath,'utf8')); }
function writeDb(d){
  try{
    fs.mkdirSync(path.dirname(dbPath), {recursive:true});
    const tmp = dbPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(d,null,2));
    fs.renameSync(tmp, dbPath);
    return true;
  }catch(err){
    console.error('DB write error:', err);
    throw err;
  }
}


// =========================================================================
// JSON DB serializer — single in-process FIFO write queue.
// Every write reads the latest snapshot, mutates it, bumps _revision, then
// atomically writes it back. Reads wait behind the queue for consistency.
// =========================================================================
let dbMutationQueue = Promise.resolve();
let inFlightLabel = null;

async function withDbWrite(mutator, label = 'db-write') {
  const job = dbMutationQueue.catch(() => {}).then(async () => {
    inFlightLabel = label;
    const db = readDb();
    ensureArrays(db);
    db._revision = Number(db._revision || 0);
    const result = await mutator(db);
    db._revision += 1;
    db._lastMutation = { label, time: new Date().toISOString(), revision: db._revision };
    writeDb(db);
    inFlightLabel = null;
    return result;
  });

  dbMutationQueue = job.catch((err) => {
    console.error(`[DB MUTATION FAILED] ${label}:`, err);
    inFlightLabel = null;
  });

  return job;
}

async function withDbRead(reader, label = 'db-read') {
  return dbMutationQueue.catch(() => {}).then(async () => {
    const db = readDb();
    ensureArrays(db);
    return reader(db);
  }).catch((err) => {
    console.error(`[DB READ FAILED] ${label}:`, err);
    throw err;
  });
}

async function drainAndExit(signal) {
  console.log(`[shutdown] ${signal} received, draining DB queue (in-flight: ${inFlightLabel || 'none'})...`);
  try { await dbMutationQueue; } catch {}
  process.exit(0);
}
process.once('SIGTERM', () => drainAndExit('SIGTERM'));
process.once('SIGINT', () => drainAndExit('SIGINT'));

async function ackHashFor(value){
  const { createHash } = await import('crypto');
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function cryptoRandomPassword(){
  return randomUUID().replace(/-/g,'').slice(0,18);
}

function isValidImageMagic(filePath){
  try{
    const b = fs.readFileSync(filePath);
    if(b.length < 12) return false;
    const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;
    const webp = b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP';
    return jpg || png || webp;
  }catch{ return false; }
}

function htmlEsc(v){
  return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function ensureArrays(db){
  db.settings ||= {};
  db.employees ||= [];
  db.records ||= [];
  db.attempts ||= [];
  db.liveEvents ||= [];
  db.leaveRequests ||= [];
  db.loanRequests ||= [];
  db.payrollSlips ||= [];
  db.notifications ||= [];
  db.liveEvents ||= [];
  db._eventSeq = Number(db._eventSeq || 0);
  db._revision = Number(db._revision || 0);
  db.allowances ||= [];
  db.penalties ||= [];
  db.whatsappSettings ||= {enabled:false,provider:'',instanceId:'',token:'',phone:'',templates:{}};
  db.whatsappLog ||= [];
  db.companies ||= [{id:'main',name:db.settings?.companyName||'Mahabat Alfan',domain:'',status:'Active',createdAt:new Date().toISOString()}];
  db.currentCompanyId ||= 'main';
  db.employees.forEach(e=>{ e.companyId ||= 'main'; });
  db.records.forEach(r=>{ r.companyId ||= 'main'; });
  db.leaveRequests.forEach(r=>{ r.companyId ||= 'main'; });
  db.loanRequests.forEach(r=>{ r.companyId ||= 'main'; });
  db.payrollSlips.forEach(r=>{ r.companyId ||= 'main'; });
  db.notifications.forEach(r=>{ r.companyId ||= 'main'; });
  db.allowances.forEach(r=>{ r.companyId ||= 'main'; });
  return db;
}

function companyScope(req, db){
  ensureArrays(db);
  const id = req.headers['x-company-id']?.toString() || req.query.companyId?.toString() || db.currentCompanyId || 'main';
  const company = db.companies.find(c=>c.id===id) || db.companies[0];
  return company?.id || 'main';
}
function employeeOfCompany(db, code, companyId='main'){
  ensureArrays(db);
  const wanted = normalizeEmpCode(code);
  return db.employees.find(e=>(normalizeEmpCode(e.employeeCode)===wanted || normalizeEmpCode(e.code)===wanted || normalizeEmpCode(e.id)===wanted) && (e.companyId||'main')===companyId);
}
function calcPortalLeaveBalance(db, employeeCode){
  ensureArrays(db);
  const annualBalance=21;
  const used=db.leaveRequests.filter(x=>x.employeeCode===employeeCode && x.status==='Approved').reduce((s,x)=>s+Number(x.days||0),0);
  return {annualBalance, usedLeaves:used, remainingLeaves:Math.max(0, annualBalance-used)};
}
function demoPayrollSlip(db, emp){
  ensureArrays(db);
  const month = new Date().toISOString().slice(0,7);
  const existing = db.payrollSlips.find(
    x => String(x.employeeCode).toUpperCase() === String(emp.employeeCode).toUpperCase() && x.month === month
  );
  const basic = employeeBasicSalary(emp);
  const allowances = employeeFixedAllowances(emp);
  if (existing) return existing;
  // PATCH v16.7.3: GET routes are read-only; synthesize draft without mutating db.
  return {
    id: randomUUID(),
    employeeCode: emp.employeeCode,
    employeeName: emp.name,
    month,
    basicSalary: basic,
    allowances,
    additionalAllowances: 0,
    bonuses: 0,
    overtimeAmount: 0,
    loans: 0,
    penalties: 0,
    deductions: 0,
    absenceDeduction: 0,
    netSalary: basic + allowances,
    status: 'Draft',
    createdAt: new Date().toISOString()
  };
}
function notificationDisplayTitle(title,type){
  const map={allowance:'بدل',bonus:'مكافأة',reward:'مكافأة',leave:'إجازة',loan:'سلفة',penalty:'جزاء',deduction:'خصم',salary:'راتب',payroll:'راتب',security:'الأمان'};
  const t=map[String(type||'').toLowerCase()]||title||'إشعار';
  if(String(title||'').includes('بدل') && String(title||'').includes('مكافأة')) return t;
  return t;
}
function addNotification(db, employeeCode, title, body, type='info'){
  ensureArrays(db);
  const displayTitle=notificationDisplayTitle(title,type);
  const n={id:randomUUID(),employeeCode,title:displayTitle,body,type,read:false,createdAt:new Date().toISOString()};
  db.notifications.push(n);
  if(db.whatsappSettings?.enabled){
    const emp=db.employees.find(e=>String(e.employeeCode||'').toUpperCase()===String(employeeCode||'').toUpperCase());
    db.whatsappLog.push({id:randomUUID(),phone:emp?.phone||db.whatsappSettings?.phone||'',message:`${displayTitle}: ${body}`,status:'Queued',provider:db.whatsappSettings?.provider||'',meta:{type,employeeCode},createdAt:new Date().toISOString()});
  }
  return n;
}


function normalizeDeviceFp(value){
  const raw = String(value || '').trim();
  if(!raw) return '';
  if(/^[a-f0-9]{64}$/i.test(raw)) return raw.toLowerCase();
  return createHash('sha256').update(raw).digest('hex');
}
function getRequestDeviceFp(req){
  return normalizeDeviceFp(
    req.headers['x-device-fp'] ||
    req.headers['x-device-fingerprint'] ||
    req.body?.deviceFp ||
    req.body?.deviceFingerprint ||
    req.query?.deviceFp ||
    req.query?.deviceFingerprint ||
    req.body?.deviceId ||
    req.query?.deviceId ||
    ''
  );
}
function getBearerOrQueryToken(req){
  return (req.headers.authorization || '').replace(/^Bearer\s+/i,'') || String(req.query.token || '');
}
async function verifyBoundEmployeeToken(req){
  const token = getBearerOrQueryToken(req);
  if(!token) throw new Error('missing-token');
  const payload = jwt.verify(token, JWT_SECRET);
  if(!payload?.employeeCode) throw new Error('invalid-token');
  const requestFp = getRequestDeviceFp(req);
  if(!requestFp) throw new Error('missing-device-fingerprint');
  // PATCH v16.7.3: claim is mandatory; claim-less legacy/replayed JWTs are refused.
  if(!payload.deviceFp || payload.deviceFp !== requestFp) throw new Error('device-fingerprint-mismatch');
  // PATCH v16.7.3: wait behind the DB queue so reset-device/tokenVersion revocation is visible.
  const emp = await withDbRead((db) => {
    return employeeOfCompany(db, payload.employeeCode, payload.companyId || 'main') || findEmployeeLoose(db, payload.employeeCode);
  }, 'authBound-employee-lookup');
  if(!emp || emp.active === false || emp.status === 'Archived' || emp.archivedAt) throw new Error('employee-disabled');
  if(Number(emp.tokenVersion || 1) !== Number(payload.ver || 1)) throw new Error('token-version-revoked');
  const storedFp = normalizeDeviceFp(emp.deviceFingerprint || emp.deviceFp || emp.deviceId || '');
  if(!storedFp || storedFp !== requestFp) throw new Error('device-not-trusted');
  return payload;
}
function auth(req,res,next){
  try{ req.user=jwt.verify(getBearerOrQueryToken(req),JWT_SECRET); next(); }
  catch{ res.status(401).json({message:'انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى'}); }
}
function alertAdmins(type, payload = {}) {
  broadcast(type, { ...payload, time: new Date().toISOString() });
}

function authBound(req,res,next){
  verifyBoundEmployeeToken(req).then(user => {
    req.user = user;
    next();
  }).catch((err) => {
    const msg = String(err?.message || '');
    const status = msg.includes('device') || msg.includes('fingerprint') ? 403 : 401;
    if(status === 403){
      try{
        const rawToken = getBearerOrQueryToken(req);
        const decoded = rawToken ? jwt.decode(rawToken) : null;
        alertAdmins('security:device-mismatch', {
          employeeCode: decoded?.employeeCode || '',
          boundDevice: decoded?.deviceFp ? String(decoded.deviceFp).slice(0,12) : '',
          attemptedDevice: getRequestDeviceFp(req).slice(0,12),
          ip: ip(req),
          userAgent: req.headers['user-agent'] || '',
          path: req.path,
          reason: msg
        });
      }catch{}
    }
    res.status(status).json({message: status === 403 ? 'هذا الحساب مرتبط بجهاز آخر أو لم يتم إرسال بصمة الجهاز الموثقة' : 'انتهت الجلسة، برجاء تسجيل الدخول مرة أخرى'});
  });
}
function admin(req,res,next){
  const token=(req.headers.authorization||'').replace('Bearer ','');
  const a=Buffer.from(String(token));
  const b=Buffer.from(String(ADMIN_TOKEN));
  const ok = !!token && a.length===b.length && timingSafeEqual(a,b);
  if(!ok) return res.status(401).json({message:'غير مصرح'});
  next();
}
function ip(req){ return req.headers['x-forwarded-for']?.toString().split(',')[0] || req.socket.remoteAddress || ''; }
function haversine(lat1, lon1, lat2, lon2){ const R=6371000, p=Math.PI/180; const a=0.5-Math.cos((lat2-lat1)*p)/2+Math.cos(lat1*p)*Math.cos(lat2*p)*(1-Math.cos((lon2-lon1)*p))/2; return R*2*Math.asin(Math.sqrt(a)); }
function todayKey(d=new Date()){ return d.toISOString().slice(0,10); }
function minutes(t){ const [h,m]=String(t||'08:00').split(':').map(Number); return (h||0)*60+(m||0); }
function localTimeParts(date = new Date(), timeZone = process.env.TIMEZONE || 'Asia/Riyadh'){
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).formatToParts(date).reduce((acc,p)=>{acc[p.type]=p.value; return acc;}, {});
  return { hour:Number(parts.hour||0), minute:Number(parts.minute||0) };
}
function localMinutesOfDay(date = new Date(), settings = {}){
  const t = localTimeParts(date, settings.timeZone || process.env.TIMEZONE || 'Asia/Riyadh');
  return t.hour * 60 + t.minute;
}
function isLate(now, settings){
  return localMinutesOfDay(now, settings) > minutes(settings.workStart || '08:00') + Number(settings.lateAfterMinutes||15);
}
function maxCheckInDelayHours(settings){
  return Number(settings.maxCheckInDelayHours ?? settings.maxCheckInAfterHours ?? 3);
}
function isCheckInWindowExpired(now, settings){
  const maxHours = maxCheckInDelayHours(settings || {});
  if(maxHours <= 0) return false;
  const currentMinutes = localMinutesOfDay(now, settings || {});
  const startMinutes = minutes(settings.workStart || '08:00');
  return currentMinutes > startMinutes + (maxHours * 60);
}
function checkInWindowMessage(settings){
  const maxHours = maxCheckInDelayHours(settings || {});
  return `انتهى وقت تسجيل الحضور. الحد الأقصى للتسجيل هو خلال ${maxHours} ساعات من بداية الدوام الرسمي`;
}
function calcOvertime(emp, checkOut, settings){
  if(!checkOut || settings.overtimeEnabled === false) return { overtimeHours:0, overtimeAmount:0 };
  const outM = checkOut.getHours()*60 + checkOut.getMinutes();
  const endM = minutes(settings.workEnd || '17:00');
  const raw = Math.max(0, outM - endM);
  const min = Number(settings.overtimeMinMinutes || 30);
  const counted = raw >= min ? raw : 0;
  const overtimeHours = Math.round((counted/60)*100)/100;
  const overtimeAmount = Math.round(overtimeHours * Number(emp?.overtimeRate||0) * 100)/100;
  return { overtimeHours, overtimeAmount };
}
function validateLocation(db, lat, lng, accuracy, type){
  const s=db.settings;
  if(!s.enabled) return {ok:false,status:'Rejected',reason:'بوابة الحضور الإلكتروني غير مفعلة'};
  if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)) {
    return {ok:false,status:'Rejected',reason:'يجب السماح باستخدام الموقع GPS'};
  }

  const companyLat = Number(s.companyLatitude);
  const companyLng = Number(s.companyLongitude);
  const radius = Number(s.allowedRadiusMeters || 250);
  const minAccuracy = Number(s.minGpsAccuracy || 100);
  const gpsAccuracy = Number(accuracy || 9999);
  const distance = haversine(lat,lng,companyLat,companyLng);

  // قاعدة عملية لتقليل الرفض الخاطئ: نقبل داخل النطاق، ونقبل هامش GPS للمراجعة إذا كان الموظف قريبًا.
  const hardAccuracyLimit = Math.max(minAccuracy, 150);
  const tolerance = Math.min(Math.max(gpsAccuracy, 20), 150) + 20;

  if(!accuracy || gpsAccuracy > hardAccuracyLimit) {
    return {ok:false,status:'Suspicious',reason:`دقة الموقع غير كافية. الدقة الحالية: ${Math.round(gpsAccuracy)} متر، والمطلوب أقل من ${hardAccuracyLimit} متر`,distance};
  }

  const outside = distance > radius;
  const outsideWithTolerance = distance > (radius + tolerance);
  const checkoutAllowed = type==='check-out' && s.allowCheckoutOutsideRange;

  if(outsideWithTolerance && !checkoutAllowed) {
    return {ok:false,status:'Rejected',reason:`لا يمكنك تسجيل الحضور لأنك خارج نطاق العمل. المسافة الحالية: ${Math.round(distance)} متر، النطاق: ${radius} متر`,distance};
  }

  if(outside && !checkoutAllowed) {
    return {ok:true,status:'Suspicious',reason:`تم التسجيل داخل هامش دقة GPS وسيظهر للمراجعة. المسافة: ${Math.round(distance)} متر`,distance};
  }

  return {ok:true,status:'Accepted',distance};
}
function deviceInfo(req, body){
  return JSON.stringify({
    userAgent:req.headers['user-agent']||'',
    device:body.deviceType||'', platform:body.platform||'', language:body.language||'',
    deviceFingerprint:getDeviceId(body, req)
  });
}
function getDeviceId(body, req){
  const fromBody = normalizeDeviceFp(body?.deviceFp || body?.deviceFingerprint || body?.deviceId || '');
  if(fromBody) return fromBody;
  return req ? getRequestDeviceFp(req) : '';
}
function normalizeEmpCode(v){ return String(v||'').trim().toUpperCase(); }
function findEmployeeLoose(db, employeeCode){
  ensureArrays(db);
  const code = normalizeEmpCode(employeeCode);
  return db.employees.find(e => normalizeEmpCode(e.employeeCode) === code || normalizeEmpCode(e.code) === code || normalizeEmpCode(e.id) === code);
}
function checkDeviceLock(db, employeeCode, deviceId){
  const emp = findEmployeeLoose(db, employeeCode);
  const deviceFp = normalizeDeviceFp(deviceId);
  if(!emp) return {ok:false, status:'Rejected', reason:`الموظف غير موجود على سيرفر البوابة بالكود: ${normalizeEmpCode(employeeCode)}. أعد مزامنة حسابات البوابة من البرنامج.`};
  if(emp.active === false || emp.status === 'Archived' || emp.archivedAt) return {ok:false, status:'Rejected', reason:'حساب الموظف غير مفعل في البوابة'};
  if(!deviceFp) return {ok:false, status:'Rejected', reason:'تعذر قراءة بصمة الجهاز، أعد فتح البوابة من نفس المتصفح'};
  const storedFp = normalizeDeviceFp(emp.deviceFingerprint || emp.deviceFp || emp.deviceId || '');
  if(!storedFp){
    emp.deviceFingerprint = deviceFp;
    emp.deviceFp = deviceFp;
    emp.deviceId = deviceFp;
    emp.deviceLockedAt = new Date().toISOString();
    emp.deviceStatus = 'Trusted';
    emp.tokenVersion = Number(emp.tokenVersion || 1);
    return {ok:true, firstBind:true, status:'Accepted', employee:emp};
  }
  if(storedFp !== deviceFp){
    return {ok:false, status:'Rejected', reason:'هذا الحساب مرتبط بجهاز آخر. تواصل مع الإدارة لإعادة ربط الجهاز'};
  }
  emp.deviceFingerprint = storedFp;
  emp.deviceFp = storedFp;
  return {ok:true, status:'Accepted', employee:emp};
}
let wsServer = null;


function findArabicPdfFont(){
  const candidates=[
    process.env.ARABIC_FONT_PATH,
    path.join(__dirname,'assets','fonts','Amiri-Regular.ttf'),
    path.join(__dirname,'fonts','Amiri-Regular.ttf'),
    path.join(__dirname,'public','Amiri-Regular.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf',
    '/usr/share/fonts/opentype/noto/NotoNaskhArabic-Regular.ttf'
  ].filter(Boolean);
  for(const f of candidates){ try{ if(fs.existsSync(f)) return f; }catch{} }
  return null;
}
if (!findArabicPdfFont()) {
  console.error('FATAL: Arabic PDF font not found. Bundled font missing from server/assets/fonts/Amiri-Regular.ttf.');
  if (IS_PROD) process.exit(1);
}
function pdfMoney(v){ return `${new Intl.NumberFormat('en-US').format(Math.round(Number(v)||0))} ريال`; }
function pdfRow(doc, y, label, value, x=50, w=495){
  doc.rect(x,y,w,28).strokeColor('#D8E7EA').stroke();
  doc.fillColor('#063241').fontSize(10).text(String(label), x+w-230, y+8, {width:220, align:'right'});
  doc.fillColor('#0f172a').fontSize(10).text(String(value), x+10, y+8, {width:w-250, align:'right'});
}

function monthMatches(a,b){ return String(a||'').slice(0,7) === String(b||'').slice(0,7); }
function sameDayKey(v){ return new Date(v||Date.now()).toISOString().slice(0,10); }
function sameMonthKey(v){ return new Date(v||Date.now()).toISOString().slice(0,7); }
function requestLimitCheck(rows, employeeCode, typeLabel){
  const code=String(employeeCode||'').toUpperCase();
  const today=sameDayKey();
  const month=sameMonthKey();
  const active=(rows||[]).filter(x=>{
    const c=String(x.employeeCode||'').toUpperCase()===code;
    const status=String(x.status||'Pending');
    return c && !['Rejected','Cancelled','Canceled','Archived'].includes(status);
  });
  const todayCount=active.filter(x=>sameDayKey(x.createdAt)===today).length;
  const monthCount=active.filter(x=>sameMonthKey(x.createdAt)===month).length;
  if(todayCount>=1) return {ok:false,message:`لا يمكن إرسال أكثر من طلب ${typeLabel} واحد في نفس اليوم`};
  if(monthCount>=2) return {ok:false,message:`لا يمكن إرسال أكثر من طلبين ${typeLabel} في نفس الشهر`};
  return {ok:true};
}
function allowanceKindText(x){
  const raw=String(x.kind||x.type||x.category||'Allowance').toLowerCase();
  if(raw.includes('bonus')||raw.includes('reward')||raw.includes('مكاف')) return 'مكافأة إضافية';
  return 'بدل إضافي';
}

function moneyValue(v){
  if(v === null || v === undefined || v === '') return 0;
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[٬,\s]/g,'').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function firstMoney(...values){
  for(const value of values){
    const n = moneyValue(value);
    if(n) return n;
  }
  return 0;
}
function employeeBasicSalary(emp={}){
  return firstMoney(emp.basicSalary, emp.baseSalary, emp.salaryBasic, emp.monthlySalary, emp.salary, emp.grossSalary, emp.totalSalary, emp.netSalary);
}
function employeeFixedAllowances(emp={}){
  return firstMoney(emp.allowances, emp.fixedAllowances, emp.baseAllowances, emp.monthlyAllowances, emp.allowance, emp.housingAllowance, emp.transportAllowance);
}
function payrollMonth(v){ return String(v||new Date().toISOString()).slice(0,7); }
function isApprovedStatus(v, defaults='Approved'){
  const s=String(v||defaults);
  return !['Rejected','Cancelled','Canceled','Archived','Draft'].includes(s);
}
function sumByMonthAndEmployee(rows, code, month, amountKeys=['amount']){
  code=String(code||'').toUpperCase();
  return (rows||[])
    .filter(x=>String(x.employeeCode||'').toUpperCase()===code && monthMatches(x.month||x.createdAt||x.date,month) && isApprovedStatus(x.status))
    .reduce((sum,x)=>{
      for(const k of amountKeys){ if(x[k]!==undefined && x[k]!==null) return sum+moneyValue(x[k]); }
      return sum;
    },0);
}
function allowanceIsBonus(x){
  const raw=String(x?.kind||x?.type||x?.category||x?.title||'').toLowerCase();
  return raw.includes('bonus') || raw.includes('reward') || raw.includes('مكاف');
}
function employeeAdditionalAllowancesForMonth(db, code, month){
  return sumByMonthAndEmployee([...(db.allowances||[]).filter(x=>!allowanceIsBonus(x))],code,month,['amount','value']);
}
function employeeBonusesForMonth(db, code, month){
  const all=[
    ...(db.bonuses||[]),
    ...(db.rewards||[]),
    ...(db.allowances||[]).filter(x=>allowanceIsBonus(x))
  ];
  return sumByMonthAndEmployee(all,code,month,['amount','value']);
}
function employeeAllowancesForMonth(db, code, month){
  const all=[...(db.allowances||[]),...(db.bonuses||[]),...(db.rewards||[])];
  return sumByMonthAndEmployee(all,code,month,['amount','value']);
}
function employeePenaltiesForMonth(db, code, month){
  const all=[...(db.penalties||[]),...(db.disciplineActions||[]),...(db.disciplinaryActions||[])];
  return sumByMonthAndEmployee(all,code,month,['amount','deduction','value']);
}
function employeeLoansForMonth(db, code, month){
  code=String(code||'').toUpperCase();
  return (db.loanRequests||[])
    .filter(x=>String(x.employeeCode||'').toUpperCase()===code && monthMatches(x.month||x.createdAt,month) && ['Approved','Paid','Deducted','Active'].includes(String(x.status||'Pending')))
    .reduce((sum,x)=>sum+moneyValue(x.installment||x.monthlyInstallment||x.deduction||x.amount),0);
}
function employeeOvertimeForMonth(db, code, month, emp){
  code=String(code||'').toUpperCase();
  const rate=moneyValue(emp?.overtimeRate||0);
  return (db.records||[])
    .filter(x=>String(x.employeeCode||'').toUpperCase()===code && monthMatches(x.date||x.createdAt,month) && !['Rejected','Cancelled'].includes(String(x.status||'')))
    .reduce((sum,x)=>{
      const direct=moneyValue(x.overtimeAmount);
      if(direct) return sum+direct;
      return sum+(moneyValue(x.overtimeHours)*rate);
    },0);
}
function employeeAbsenceDeductionForMonth(db, code, month, emp){
  code=String(code||'').toUpperCase();
  const daily=moneyValue(emp?.dailyRate || ((moneyValue(emp?.basicSalary)+moneyValue(emp?.allowances))/30));
  return (db.leaveRequests||[])
    .filter(x=>String(x.employeeCode||'').toUpperCase()===code && monthMatches(x.month||x.startDate||x.from||x.createdAt,month) && ['Approved'].includes(String(x.status||'')) && (x.paid===false || String(x.isPaid||'true')==='false' || String(x.type||'').includes('بدون')))
    .reduce((sum,x)=>sum+(moneyValue(x.days||1)*daily),0);
}
function enrichedPayrollSlip(db, slip){
  ensureArrays(db);
  const code=String(slip.employeeCode||'').toUpperCase();
  const emp=(db.employees||[]).find(e=>String(e.employeeCode||'').toUpperCase()===code)||{};
  const month=payrollMonth(slip.month);
  const basicSalary=firstMoney(slip.basicSalary, slip.baseSalary, slip.salaryBasic, slip.monthlySalary, slip.salary, emp.basicSalary, emp.baseSalary, emp.salaryBasic, emp.monthlySalary, emp.salary);
  const fixedAllowances=firstMoney(slip.allowances, slip.fixedAllowances, slip.baseAllowances, slip.monthlyAllowances, emp.allowances, emp.fixedAllowances, emp.baseAllowances, emp.monthlyAllowances);

  const liveAdditionalAllowances=employeeAdditionalAllowancesForMonth(db,code,month);
  const liveBonuses=employeeBonusesForMonth(db,code,month);
  const liveOvertime=employeeOvertimeForMonth(db,code,month,emp);
  const liveLoans=employeeLoansForMonth(db,code,month);
  const livePenalties=employeePenaltiesForMonth(db,code,month);
  const liveAbsence=employeeAbsenceDeductionForMonth(db,code,month,emp);

  const additionalAllowances=Math.max(moneyValue(slip.additionalAllowances), liveAdditionalAllowances);
  const bonuses=Math.max(moneyValue(slip.bonuses), liveBonuses);
  const overtimeAmount=Math.max(moneyValue(slip.overtimeAmount), liveOvertime);
  const loans=Math.max(moneyValue(slip.loans), liveLoans);
  const penalties=Math.max(moneyValue(slip.penalties ?? slip.deductions), livePenalties);
  const absenceDeduction=Math.max(moneyValue(slip.absenceDeduction), liveAbsence);

  const earnings=basicSalary+fixedAllowances+additionalAllowances+bonuses+overtimeAmount;
  const totalDeductions=loans+penalties+absenceDeduction;
  const netSalary=Math.max(0,earnings-totalDeductions);

  return {
    ...slip,
    month,
    employeeCode:code,
    employeeName:slip.employeeName||emp.name||emp.fullName||code,
    basicSalary,
    allowances:fixedAllowances,
    additionalAllowances,
    monthlyAllowances:additionalAllowances+bonuses,
    bonuses,
    overtimeAmount,
    loans,
    penalties,
    deductions:penalties,
    absenceDeduction,
    grossSalary:earnings,
    totalDeductions,
    netSalary
  };
}

function publicEmployee(emp){ return {
  employeeCode:emp.employeeCode,
  name:emp.name,
  fullName:emp.name,
  active:emp.active,
  department:emp.department||'',
  jobTitle:emp.jobTitle||'',
  phone:emp.phone||'',
  email:emp.email||'',
  avatarUrl:emp.avatarUrl||emp.profileImage||'',
  profileImage:emp.profileImage||emp.avatarUrl||'',
  deviceLocked:!!emp.deviceId,
  deviceLockedAt:emp.deviceLockedAt||null,
  deviceStatus:emp.deviceStatus||'',
  passwordUpdatedAt:emp.passwordUpdatedAt||null,
  avatarUpdatedAt:emp.avatarUpdatedAt||emp.updatedAt||null,
  updatedAt:emp.updatedAt||null,
  status:emp.status||'',
  archivedAt:emp.archivedAt||null,
  terminatedAt:emp.terminatedAt||null,
  archiveReason:emp.archiveReason||'',
  version:emp.version||1,
  serverVersion:emp.serverVersion||emp.version||1
}; }

const employeeSockets = new Map();
const adminSockets = new Set();

function sendWs(socket, message) {
  try { if (socket.readyState === 1) socket.send(message); }
  catch (error) { console.error('WebSocket send failed:', error); }
}

function getWsToken(req) {
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const protocol = req.headers['sec-websocket-protocol'];
  if (protocol) {
    const parts = String(protocol).split(',').map((x) => x.trim());
    const bearerIndex = parts.findIndex((x) => x.toLowerCase() === 'bearer');
    if (bearerIndex >= 0 && parts[bearerIndex + 1]) return parts[bearerIndex + 1];
    const directToken = parts.find((x) => x.length > 20);
    if (directToken) return directToken;
  }
  return '';
}

async function authenticateWsRequest(req) {
  const url = new URL(req.url, 'http://localhost');
  const adminToken = url.searchParams.get('adminToken');
  if (adminToken && adminToken === ADMIN_TOKEN) return { role: 'admin', employeeCode: null, lastSeq:Number(url.searchParams.get('lastSeq')||0) };

  const token = getWsToken(req);
  if (!token) throw new Error('Missing WebSocket token');
  req.query = Object.fromEntries(url.searchParams.entries());
  req.headers['x-device-fp'] = req.headers['x-device-fp'] || url.searchParams.get('deviceFp') || url.searchParams.get('deviceFingerprint') || '';
  const payload = await verifyBoundEmployeeToken(req);
  return { role: 'employee', employeeCode: String(payload.employeeCode).toUpperCase(), payload, lastSeq:Number(url.searchParams.get('lastSeq')||0) };
}

function filterEventsForUser(events, user) {
  if(user?.role === 'admin') return events;
  const code = String(user?.employeeCode || '').toUpperCase();
  return (events || []).filter(ev => {
    const target = getTargetEmployeeCode(ev.payload || {});
    if(!ev.private) return true;
    return target && target === code;
  });
}

function attachAuthenticatedWs(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws') return;
      const user = await authenticateWsRequest(req);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.user = user;
        wss.emit('connection', ws, req);
      });
    } catch (err) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  });

  const heartbeat = setInterval(() => {
    const sockets = [...adminSockets, ...[...employeeSockets.values()].flatMap(set => [...set])];
    for (const socket of sockets) {
      if (socket.isAlive === false) { try { socket.terminate(); } catch {} continue; }
      socket.isAlive = false;
      try { socket.ping(); } catch {}
    }
  }, 30_000);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    const user = socket.user || { role: 'unknown' };
    if (user.role === 'admin') adminSockets.add(socket);
    if (user.role === 'employee') {
      const code = String(user.employeeCode || '').toUpperCase();
      if (!employeeSockets.has(code)) employeeSockets.set(code, new Set());
      employeeSockets.get(code).add(socket);
    }

    socket.send(JSON.stringify({
      type: 'connected',
      seq: null,
      payload: { message: 'WebSocket authenticated', role: user.role, employeeCode: user.employeeCode || null },
      time: new Date().toISOString(),
    }));

    const lastSeq = Number(user.lastSeq || 0);
    if(lastSeq > 0){
      withDbRead((db)=>filterEventsForUser((db.liveEvents||[]).filter(ev=>Number(ev.seq||0)>lastSeq), user), 'ws-replay')
        .then(events => events.forEach(ev => sendWs(socket, JSON.stringify({type:ev.type, seq:ev.seq, payload:ev.payload, time:ev.time, replay:true}))))
        .catch(err => console.error('WS replay failed:', err));
    }

    socket.on('close', () => {
      adminSockets.delete(socket);
      if (user.role === 'employee') {
        const set = employeeSockets.get(user.employeeCode);
        if (set) {
          set.delete(socket);
          if (set.size === 0) employeeSockets.delete(user.employeeCode);
        }
      }
    });
  });

  return wss;
}

function getTargetEmployeeCode(payload) {
  return String(payload?.employeeCode || payload?.targetEmployeeCode || payload?.record?.employeeCode || '').toUpperCase();
}

function isPrivateHrEvent(type) {
  const t = String(type || '').toLowerCase();
  return ['payroll','salary','penalty','deduction','allowance','bonus','loan','leave','employee:avatar-updated','employee:password-changed','employee:salary-updated','employee:allowance-added','employee:penalty-added'].some((key) => t.includes(key));
}

async function persistLiveEvent(eventType, payload, privateEvent, targetEmployeeCode){
  return withDbWrite(async (db) => {
    db.liveEvents ||= [];
    db._eventSeq = Number(db._eventSeq || 0) + 1;
    const event = {
      id: randomUUID(),
      seq: db._eventSeq,
      type: eventType,
      payload: privateEvent ? { employeeCode: targetEmployeeCode, private: true } : payload,
      private: !!privateEvent,
      time: new Date().toISOString(),
    };
    db.liveEvents.push(event);
    db.liveEvents = db.liveEvents.slice(-500);
    return event;
  }, `event:${eventType}`);
}

function sendEventToSockets(event, fullPayload, targetEmployeeCode, privateEvent){
  const adminMessage = JSON.stringify({ type: event.type, seq: event.seq, payload: fullPayload, time: event.time });
  for (const socket of adminSockets) sendWs(socket, adminMessage);

  const employeeMessage = JSON.stringify({ type: event.type, seq: event.seq, payload: privateEvent ? event.payload : fullPayload, time: event.time });
  if (targetEmployeeCode && employeeSockets.has(targetEmployeeCode)) {
    for (const socket of employeeSockets.get(targetEmployeeCode)) sendWs(socket, employeeMessage);
  } else if (!privateEvent) {
    for (const set of employeeSockets.values()) for (const socket of set) sendWs(socket, employeeMessage);
  }
}

function broadcast(type, payload = {}) {
  if (typeof type === 'object' && type !== null) {
    payload = type.payload || type.record || type;
    type = type.type || 'event';
  }
  const eventType = String(type);
  const targetEmployeeCode = getTargetEmployeeCode(payload);
  const privateEvent = isPrivateHrEvent(eventType);
  persistLiveEvent(eventType, payload, privateEvent, targetEmployeeCode)
    .then(event => sendEventToSockets(event, payload, targetEmployeeCode, privateEvent))
    .catch((err) => console.error('broadcast failed:', err));
}

function safeApiBase(req){
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/api/health',(req,res)=>{
  res.json({ ok:true, service:'Mahabat Online Attendance API', httpPort:PORT, httpsPort:HTTPS_PORT, secure:req.secure, time:new Date().toISOString() });
});

app.get('/api/status',(req,res)=>{
  const db=readDb();
  res.json({ ok:true, url:safeApiBase(req), employees:db.employees.length, records:db.records.length, settings:db.settings });
});

app.get('/api/sync/since', authBound, async (req,res)=>{
  const since = Number(req.query.seq || 0);
  const user = {role:'employee', employeeCode:String(req.user.employeeCode||'').toUpperCase()};
  const {events, latestSeq} = await withDbRead(async (db)=>{
    const visible = filterEventsForUser((db.liveEvents||[]).filter(ev=>Number(ev.seq||0)>since), user);
    return {events: visible, latestSeq: Number(db._eventSeq||0)};
  }, 'sync-since');
  res.json({ok:true, since, latest:latestSeq, latestSeq, events});
});

app.get('/api/admin/sync/since', admin, async (req,res)=>{
  const since = Number(req.query.seq || 0);
  const {events, latestSeq} = await withDbRead(async (db)=>({
    events:(db.liveEvents||[]).filter(ev=>Number(ev.seq||0)>since),
    latestSeq:Number(db._eventSeq||0)
  }), 'admin-sync-since');
  res.json({ok:true, since, latest:latestSeq, latestSeq, events});
});


app.get('/api/cert/info',(req,res)=>{
  res.json({
    ok:true,
    message:'لتشغيل HTTPS بدون تحذير على الجوال يجب تثبيت شهادة Mahabat Root CA مرة واحدة على الهاتف.',
    caUrl:`${safeApiBase(req)}/mahabat-root-ca.crt`,
    httpsUrl:`https://${req.hostname}:5443`
  });
});

app.get('/install-cert',(req,res)=>{
  const host=req.hostname || '192.168.8.36';
  res.type('html').send(`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تثبيت شهادة مهابة الفن</title><style>body{font-family:Arial;background:#0f172a;color:#fff;padding:24px;line-height:1.9}.card{background:#1e293b;border-radius:20px;padding:22px;max-width:720px;margin:auto}.btn{display:block;background:#f59e0b;color:#0f172a;text-decoration:none;text-align:center;padding:14px;border-radius:14px;font-weight:bold;margin:12px 0}code{background:#020617;padding:3px 6px;border-radius:8px}</style></head><body><div class="card"><h1>تثبيت شهادة HTTPS</h1><p>هذه الخطوة تُعمل مرة واحدة فقط حتى تفتح بوابة الحضور بدون تحذير SSL.</p><a class="btn" href="/mahabat-root-ca.crt" download>تحميل شهادة Mahabat Root CA</a><p>بعد التحميل على Android: الإعدادات ← الأمان والخصوصية ← التشفير وبيانات الاعتماد ← تثبيت شهادة CA.</p><p>بعد التثبيت افتح:</p><code>https://${host}:5443</code><p>لو لا تريد تثبيت شهادة على الهاتف، سيظهر تحذير المتصفح وهذا طبيعي مع السيرفر المحلي.</p></div></body></html>`);
});

app.get('/portal-status',(req,res)=>{
  res.type('html').send(`<html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Mahabat Portal</title><style>body{font-family:Arial;background:#0f172a;color:#fff;padding:30px} .card{background:#1e293b;padding:24px;border-radius:16px;max-width:620px;margin:auto} code{background:#020617;padding:4px 8px;border-radius:8px}</style></head><body><div class="card"><h1>بوابة حضور الموظف تعمل بنجاح ✅</h1><p>API يعمل على: <code>${safeApiBase(req)}</code></p><p>اختبار الصحة: <code>${safeApiBase(req)}/api/health</code></p><p>افتح الصفحة الرئيسية لتسجيل الدخول.</p></div></body></html>`);
});

app.post('/api/auth/login', loginLimiter, async (req,res)=>{
  try{
    const companyIdHint = req.headers['x-company-id']?.toString() || req.query.companyId?.toString() || 'main';
    const {employeeId,password}=req.body || {};
    const code=String(employeeId||'').trim().toUpperCase();
    const deviceFp = getRequestDeviceFp(req);
    if(!deviceFp) return res.status(400).json({message:'تعذر إنشاء بصمة الجهاز. أعد تحميل الصفحة أو استخدم متصفحًا حديثًا.'});

    const result = await withDbWrite(async (db)=>{
      const companyId=companyScope({headers:{'x-company-id':companyIdHint},query:{companyId:companyIdHint}},db);
      const emp=employeeOfCompany(db,code,companyId);
      if(!emp||!emp.active||emp.status==='Archived'||!!emp.archivedAt){
        return {status:401, body:{message:'بيانات الدخول غير صحيحة أو الحساب غير مفعل'}};
      }
      if(emp.lockedUntil && new Date(emp.lockedUntil) > new Date()){
        return {status:429, body:{message:'الحساب مقفل مؤقتًا بسبب محاولات دخول خاطئة'}};
      }
      const ok = bcrypt.compareSync(String(password||''), String(emp.passwordHash||emp.portalPasswordHash||''));
      if(!ok){
        emp.failedAttempts = Number(emp.failedAttempts||0)+1;
        if(emp.failedAttempts >= 5) emp.lockedUntil = new Date(Date.now()+15*60*1000).toISOString();
        return {status:401, body:{message:'بيانات الدخول غير صحيحة أو الحساب غير مفعل'}};
      }

      const storedFp = normalizeDeviceFp(emp.deviceFingerprint || emp.deviceFp || emp.deviceId || '');
      if(storedFp && storedFp !== deviceFp){
        const alertPayload = {
          employeeCode: emp.employeeCode,
          name: emp.name,
          ip: ip(req),
          userAgent: req.headers['user-agent'] || '',
          attemptedAt: new Date().toISOString()
        };
        db.attempts ||= [];
        db.attempts.push({id:randomUUID(), type:'security:device-mismatch', status:'Rejected', rejectionReason:'Device fingerprint mismatch', ...alertPayload});
        return {status:403, alert:alertPayload, body:{message:'هذا الحساب مرتبط بجهاز آخر. تم إرسال تنبيه للإدارة.'}};
      }

      if(!storedFp){
        emp.deviceFingerprint = deviceFp;
        emp.deviceFp = deviceFp;
        emp.deviceId = deviceFp;
        emp.deviceLockedAt = new Date().toISOString();
        emp.deviceStatus = 'Trusted';
      }
      emp.failedAttempts = 0;
      emp.lockedUntil = null;
      emp.tokenVersion = Number(emp.tokenVersion || 1);
      emp.lastLogin = new Date().toISOString();
      const token=jwt.sign({employeeCode:emp.employeeCode,name:emp.name,companyId,ver:emp.tokenVersion,deviceFp},JWT_SECRET,{expiresIn:'8h'});
      return {status:200, body:{token,employee:publicEmployee(emp),deviceBound:!storedFp}};
    }, 'auth-login-device-bind');

    if(result.alert) broadcast('security:device-mismatch', result.alert);
    return res.status(result.status).json(result.body);
  }catch(err){
    console.error('login failed:', err);
    return res.status(500).json({message:'تعذر تسجيل الدخول الآن'});
  }
});

// QR Login: يفتح بوابة الحضور مباشرة من QR بدون كلمة مرور.
// الحماية الأساسية: Device Lock + GPS عند تسجيل الحضور.
app.post('/api/auth/qr-login', loginLimiter, async (req,res)=>{
  try{
    const employeeCode=String(req.body.employeeCode||req.body.emp||'').trim().toUpperCase();
    const deviceFp=getRequestDeviceFp(req);
    if(!deviceFp) return res.status(400).json({message:'تعذر إنشاء بصمة الجهاز'});
    const result = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===employeeCode&&e.active&&e.status!=='Archived'&&!e.archivedAt);
      if(!emp) return {status:404, body:{message:'هذا الموظف غير موجود أو غير مفعل في بوابة الحضور'}};
      const dlock=checkDeviceLock(db, employeeCode, deviceFp);
      if(!dlock.ok) return {status:403, alert:{employeeCode:emp.employeeCode,name:emp.name,ip:ip(req),userAgent:req.headers['user-agent']||'',attemptedAt:new Date().toISOString()}, body:{message:dlock.reason}};
      emp.tokenVersion = Number(emp.tokenVersion || 1);
      const companyId=emp.companyId||'main';
      const token=jwt.sign({employeeCode:emp.employeeCode,name:emp.name,companyId,ver:emp.tokenVersion,deviceFp},JWT_SECRET,{expiresIn:'8h'});
      return {status:200, body:{token,employee:{employeeCode:emp.employeeCode,name:emp.name},message:'تم فتح بوابة الحضور من QR',deviceBound:!!dlock.firstBind}};
    }, 'qr-login-device-bind');
    if(result.alert) broadcast('security:device-mismatch', result.alert);
    return res.status(result.status).json(result.body);
  }catch(err){
    console.error('qr login failed:', err);
    return res.status(500).json({message:'تعذر فتح بوابة QR الآن'});
  }
});
app.get('/api/employee/me',authBound,(req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
  res.json({employee:emp?publicEmployee(emp):req.user});
});
app.get('/api/attendance/my-records',authBound,(req,res)=>{const db=readDb(); res.json({records:db.records.filter(r=>r.employeeCode===req.user.employeeCode).slice(-30).reverse()});});

app.get('/api/admin/employees',admin,(req,res)=>{ const db=readDb(); res.json({employees:db.employees.map(publicEmployee)}); });

app.get('/api/admin/employees/pull', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  res.json({ok:true, employees:db.employees.map(publicEmployee)});
});


app.post('/api/admin/sync/batch', admin, async (req,res)=>{
  try{
    const operations = Array.isArray(req.body.operations) ? req.body.operations.slice(0,50) : [];
    const response = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const results = [];
      for(const op of operations){
        try{
          if(!op || !op.endpoint || !op.method) throw new Error('Invalid operation');
          const allowed = ['/api/admin/employees/sync','/api/admin/payroll/push','/api/admin/allowances/push','/api/admin/penalties/push','/api/admin/employee-portal/notify'];
          if(!allowed.includes(op.endpoint)) throw new Error('Endpoint not allowed for batch sync');
          if(op.endpoint === '/api/admin/employees/sync'){
            const incoming=Array.isArray(op.payload?.employees)?op.payload.employees:[];
            let added=0,updated=0,skipped=0,serverRecord=null;
            incoming.forEach(emp=>{
              const code=String(emp.employeeCode||'').trim().toUpperCase(); const name=String(emp.name||emp.fullName||'').trim();
              if(!code || !name){ skipped++; return; }
              let row=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
              if(!row){ row={employeeCode:code,name,passwordHash:bcrypt.hashSync(emp.password||cryptoRandomPassword(),12),active:emp.active!==false,status:emp.active===false?'Archived':'Active',department:emp.department||'',jobTitle:emp.jobTitle||'',basicSalary:Number(emp.basicSalary||0),allowances:Number(emp.allowances||0),overtimeRate:Number(emp.overtimeRate||0),phone:emp.phone||'',email:emp.email||'',avatarUrl:emp.avatarUrl||emp.profileImage||'',profileImage:emp.profileImage||emp.avatarUrl||'',deviceId:'',deviceFp:'',deviceFingerprint:'',deviceLockedAt:null,deviceStatus:'',tokenVersion:Number(emp.tokenVersion||1),version:Number(emp.clientVersion||emp.version||1),serverVersion:Number(emp.clientVersion||emp.version||1),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; db.employees.push(row); added++; }
              else { row.name=name; row.active=emp.active!==false; row.status=emp.active===false?'Archived':'Active'; row.department=emp.department||row.department||''; row.jobTitle=emp.jobTitle||row.jobTitle||''; row.basicSalary=Number(emp.basicSalary||row.basicSalary||0); row.allowances=Number(emp.allowances||row.allowances||0); row.overtimeRate=Number(emp.overtimeRate||row.overtimeRate||0); row.phone=emp.phone||row.phone||''; row.email=emp.email||row.email||''; if(emp.avatarUrl||emp.profileImage){row.avatarUrl=emp.avatarUrl||emp.profileImage||row.avatarUrl||''; row.profileImage=emp.profileImage||emp.avatarUrl||row.profileImage||'';} if(emp.resetDevice){ row.deviceId=''; row.deviceFp=''; row.deviceFingerprint=''; row.deviceLockedAt=null; row.deviceStatus='ResetByAdmin'; row.tokenVersion=Number(row.tokenVersion||1)+1; } row.version=Number(row.version||row.serverVersion||1)+1; row.serverVersion=row.version; row.updatedAt=new Date().toISOString(); updated++; }
              serverRecord=publicEmployee(row);
            });
            const r={ok:true,added,updated,skipped,serverRecord}; r.ackHash=await ackHashFor(r); results.push({ok:true,operationId:op.id||null,ackHash:r.ackHash,serverVersion:serverRecord?.serverVersion||serverRecord?.version||0,response:r}); continue;
          }
          if(op.endpoint === '/api/admin/payroll/push'){
            db.payrollSlips ||= []; const slips=Array.isArray(op.payload?.slips)?op.payload.slips:[]; let count=0;
            slips.forEach(s=>{ if(!s.employeeCode||!s.month) return; const idx=db.payrollSlips.findIndex(x=>String(x.employeeCode).toUpperCase()===String(s.employeeCode).toUpperCase()&&x.month===s.month); const clean={...s,id:s.id||randomUUID(),employeeCode:String(s.employeeCode).toUpperCase(),updatedAt:new Date().toISOString()}; if(idx>=0) db.payrollSlips[idx]={...db.payrollSlips[idx],...clean}; else db.payrollSlips.push(clean); count++; });
            const r={ok:true,count}; r.ackHash=await ackHashFor(r); results.push({ok:true,operationId:op.id||null,ackHash:r.ackHash,response:r}); continue;
          }
          if(op.endpoint === '/api/admin/allowances/push'){
            db.allowances ||= []; const rows=Array.isArray(op.payload?.allowances)?op.payload.allowances:[]; let count=0;
            rows.forEach(a=>{ if(!a.employeeCode||!a.month) return; const idx=db.allowances.findIndex(x=>x.id===a.id); const clean={...a,id:a.id||randomUUID(),employeeCode:String(a.employeeCode).toUpperCase(),updatedAt:new Date().toISOString()}; if(idx>=0) db.allowances[idx]={...db.allowances[idx],...clean}; else db.allowances.push(clean); count++; });
            const r={ok:true,count}; r.ackHash=await ackHashFor(r); results.push({ok:true,operationId:op.id||null,ackHash:r.ackHash,response:r}); continue;
          }
          if(op.endpoint === '/api/admin/penalties/push'){
            db.penalties ||= []; const rows=Array.isArray(op.payload?.penalties)?op.payload.penalties:[]; let count=0;
            rows.forEach(p=>{ if(!p.employeeCode||!p.month) return; const idx=db.penalties.findIndex(x=>x.id===p.id); const clean={...p,id:p.id||randomUUID(),employeeCode:String(p.employeeCode).toUpperCase(),amount:Number(p.amount??p.deduction??0),deduction:Number(p.deduction??p.amount??0),updatedAt:new Date().toISOString()}; if(idx>=0) db.penalties[idx]={...db.penalties[idx],...clean}; else db.penalties.push(clean); count++; });
            const r={ok:true,count}; r.ackHash=await ackHashFor(r); results.push({ok:true,operationId:op.id||null,ackHash:r.ackHash,response:r}); continue;
          }
          if(op.endpoint === '/api/admin/employee-portal/notify'){
            const employeeCode=String(op.payload?.employeeCode||'').toUpperCase(); if(!employeeCode) throw new Error('employeeCode is required'); addNotification(db,employeeCode,op.payload?.title||'إشعار',op.payload?.body||'',op.payload?.type||'general'); const r={ok:true,message:'تم إرسال الإشعار'}; r.ackHash=await ackHashFor(r); results.push({ok:true,operationId:op.id||null,ackHash:r.ackHash,response:r}); continue;
          }
        }catch(err){ results.push({ok:false,operationId:op?.id||null,error:String(err?.message||err)}); break; }
      }
      const out={ok:results.length===operations.length && results.every(r=>r.ok),results}; out.ackHash=await ackHashFor(out); return out;
    }, 'admin-sync-batch');
    res.status(response.ok?200:409).json(response);
  }catch(err){ console.error('batch sync failed:', err); res.status(500).json({message:'تعذر تنفيذ المزامنة المجمعة'}); }
});


app.post('/api/admin/employees/sync', admin, async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const incoming=Array.isArray(req.body.employees)?req.body.employees:[];
      let added=0,updated=0,skipped=0;
      incoming.forEach(emp=>{
        const code=String(emp.employeeCode||'').trim().toUpperCase();
        const name=String(emp.name||emp.fullName||'').trim();
        if(!code || !name){ skipped++; return; }
        let row=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
        if(!row){
          row={employeeCode:code,name,passwordHash:bcrypt.hashSync(emp.password||cryptoRandomPassword(),12),active:emp.active!==false,status:emp.active===false?'Archived':'Active',archivedAt:emp.archivedAt||null,terminatedAt:emp.terminatedAt||null,archiveReason:emp.archiveReason||'',department:emp.department||'',jobTitle:emp.jobTitle||'',basicSalary:Number(emp.basicSalary||0),allowances:Number(emp.allowances||0),overtimeRate:Number(emp.overtimeRate||0),phone:emp.phone||'',email:emp.email||'',avatarUrl:emp.avatarUrl||emp.profileImage||'',profileImage:emp.profileImage||emp.avatarUrl||'',deviceId:'',deviceFp:'',deviceFingerprint:'',deviceLockedAt:null,deviceStatus:'',tokenVersion:Number(emp.tokenVersion||1),version:Number(emp.clientVersion||emp.version||1),serverVersion:Number(emp.clientVersion||emp.version||1),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
          db.employees.push(row); added++;
        }else{
          row.name=name;
          row.active=emp.active!==false;
          if(emp.active===false){ row.status='Archived'; row.archivedAt=emp.archivedAt||new Date().toISOString(); row.terminatedAt=emp.terminatedAt||row.archivedAt; row.archiveReason=emp.archiveReason||'Archived from desktop'; }
          else { row.status='Active'; if(emp.restoreArchived){ row.archivedAt=null; row.terminatedAt=null; row.archiveReason=''; } }
          row.department=emp.department||row.department||'';
          row.jobTitle=emp.jobTitle||row.jobTitle||'';
          row.basicSalary=Number(emp.basicSalary||row.basicSalary||0);
          row.allowances=Number(emp.allowances||row.allowances||0);
          row.overtimeRate=Number(emp.overtimeRate||row.overtimeRate||0);
          row.phone=emp.phone||row.phone||'';
          row.email=emp.email||row.email||'';
          if(emp.avatarUrl || emp.profileImage){ row.avatarUrl=emp.avatarUrl||emp.profileImage||row.avatarUrl||row.profileImage||''; row.profileImage=emp.profileImage||emp.avatarUrl||row.profileImage||row.avatarUrl||''; row.avatarUpdatedAt=emp.avatarUpdatedAt||row.avatarUpdatedAt||row.updatedAt; }
          if(emp.password && emp.forcePasswordReset){ row.passwordHash=bcrypt.hashSync(emp.password,10); row.passwordUpdatedAt=new Date().toISOString(); row.tokenVersion=Number(row.tokenVersion||1)+1; }
          if(emp.resetDevice){ row.deviceId=''; row.deviceFp=''; row.deviceFingerprint=''; row.deviceLockedAt=null; row.deviceStatus='ResetByAdmin'; row.tokenVersion=Number(row.tokenVersion||1)+1; }
          const clientVersion = Number(emp.clientVersion || emp.version || 0);
          const currentVersion = Number(row.version || row.serverVersion || 1);
          row.version = Math.max(currentVersion + 1, clientVersion || currentVersion + 1);
          row.serverVersion = row.version;
          row.updatedAt=new Date().toISOString(); updated++;
        }
      });
      return {added,updated,skipped,total:db.employees.length,employees:db.employees.map(publicEmployee)};
    }, 'admin-employees-sync');
    broadcast('employees-sync',{added:result.added,updated:result.updated,skipped:result.skipped,total:result.total});
    const response={ok:true,message:`تمت مزامنة مستخدمي البوابة: ${result.added} جديد / ${result.updated} تحديث`,...result,serverRecord:null};
    response.ackHash=await ackHashFor(response);
    res.json(response);
  }catch(err){ console.error('employees sync failed:', err); res.status(500).json({message:'تعذر مزامنة الموظفين'}); }
});
app.post('/api/admin/employees/reset-password',admin,async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    const row=db.employees.find(e=>e.employeeCode===req.body.employeeCode);
    if(!row) return {status:404, body:{message:'الموظف غير موجود'}};
    if(!req.body.password || String(req.body.password).length<8) return {status:400, body:{message:'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف'}};
    row.passwordHash=bcrypt.hashSync(req.body.password,12);
    row.portalPasswordHash=row.passwordHash;
    delete row.portalPassword;
    row.tokenVersion=Number(row.tokenVersion||1)+1;
    row.passwordUpdatedAt=new Date().toISOString();
    row.updatedAt=new Date().toISOString();
    return {status:200, body:{message:'تم تغيير كلمة مرور الموظف'}};
  }, 'admin-reset-password');
  res.status(result.status).json(result.body);
});
app.post('/api/admin/employees/reset-portal-password', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    const employeeCode=String(req.body.employeeCode||'').trim().toUpperCase();
    const password=String(req.body.password||'').trim();
    if(!employeeCode) return {status:400, body:{message:'employeeCode مطلوب'}};
    if(!password || password.length<4) return {status:400, body:{message:'كلمة المرور يجب ألا تقل عن 4 أحرف'}};
    const emp=db.employees.find(e=>String(e.employeeCode||'').toUpperCase()===employeeCode);
    if(!emp) return {status:404, body:{message:'الموظف غير موجود'}};
    emp.passwordHash=bcrypt.hashSync(password,12);
    emp.portalPasswordHash=emp.passwordHash;
    emp.active=true;
    emp.status=emp.status==='Archived'?'Active':emp.status;
    emp.tokenVersion=Number(emp.tokenVersion||1)+1;
    emp.passwordUpdatedAt=new Date().toISOString();
    emp.updatedAt=new Date().toISOString();
    addNotification(db, employeeCode, 'تم تحديث كلمة مرور البوابة', 'تم تغيير كلمة مرور دخولك إلى بوابة الموظف.', 'security');
    return {status:200, body:{ok:true,message:'تم تحديث كلمة مرور بوابة الموظف'}};
  }, 'admin-reset-portal-password');
  res.status(result.status).json(result.body);
});


app.post('/api/admin/employees/reset-device',admin,async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      const row=db.employees.find(e=>String(e.employeeCode).toUpperCase()===String(req.body.employeeCode||'').toUpperCase());
      if(!row) return {status:404, body:{message:'الموظف غير موجود'}};
      row.deviceId='';
      row.deviceFingerprint='';
      row.deviceFp='';
      row.deviceLockedAt=null;
      row.deviceStatus='ResetByAdmin';
      row.tokenVersion=Number(row.tokenVersion||1)+1;
      row.updatedAt=new Date().toISOString();
      return {status:200, event:{employeeCode:row.employeeCode,name:row.name}, body:{message:'تم فك ربط جهاز الموظف وإلغاء جلساته القديمة، يستطيع ربط جهاز جديد عند أول تسجيل دخول',employee:publicEmployee(row)}};
    }, 'admin-reset-device');
    if(result.event) broadcast('device-reset', result.event);
    return res.status(result.status).json(result.body);
  }catch(err){
    console.error('reset-device failed:', err);
    return res.status(500).json({message:'تعذر فك ربط الجهاز'});
  }
});
app.post('/api/admin/employees/toggle',admin,async (req,res)=>{ const result=await withDbWrite(async (db)=>{ ensureArrays(db); const row=db.employees.find(e=>e.employeeCode===req.body.employeeCode); if(!row) return {status:404,body:{message:'الموظف غير موجود'}}; row.active=!!req.body.active; row.updatedAt=new Date().toISOString(); return {status:200,body:{message:row.active?'تم تفعيل دخول الموظف':'تم تعطيل دخول الموظف'}}; }, 'admin-employees-toggle'); res.status(result.status).json(result.body); });

app.get('/api/admin/attendance',admin,(req,res)=>{const db=readDb(); res.json({records:db.records,settings:db.settings});});
app.get('/api/admin/settings',admin,(req,res)=>res.json(readDb().settings));
app.post('/api/admin/settings',admin,async (req,res)=>{const result=await withDbWrite(async (db)=>{ensureArrays(db); db.settings={...db.settings,...req.body}; return {message:'تم حفظ إعدادات الحضور الإلكتروني',settings:db.settings};}, 'admin-settings'); res.json(result);});


app.post('/api/attendance/check', authBound, (req,res,next)=>{
  const type = String(req.body?.type || '').toLowerCase();
  req.url = type === 'out' ? '/api/attendance/check-out' : '/api/attendance/check-in';
  return app._router.handle(req,res,next);
});

app.post('/api/attendance/check-in',authBound,async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      const now=new Date();
      const {lat,lng,accuracy}=req.body;
      const deviceId=getDeviceId(req.body, req);
      const dlock=checkDeviceLock(db,req.user.employeeCode,deviceId);
      const v=dlock.ok?validateLocation(db,lat,lng,accuracy,'check-in'):dlock;
      const base={id:randomUUID(),employeeCode:req.user.employeeCode,employeeName:(dlock.employee?.name||req.user.name),date:todayKey(now),checkIn:null,checkOut:null,checkInLat:lat,checkInLng:lng,distance:v.distance||0,accuracy:Number(accuracy||0),deviceId,deviceFingerprint:deviceId,deviceTrusted:!!dlock.ok,deviceInfo:deviceInfo(req,req.body||{}),ipAddress:ip(req),status:v.status,rejectionReason:v.reason||'',overtimeHours:0,overtimeAmount:0,createdAt:now.toISOString(),updatedAt:now.toISOString()};
      const existing=db.records.find(r=>r.employeeCode===req.user.employeeCode&&r.date===todayKey(now));
      if(existing&&existing.checkIn) return {status:400, body:{message:'تم تسجيل حضورك مسبقًا اليوم',record:existing}};
      if(isCheckInWindowExpired(now, db.settings||{})){
        const rejected={...base,status:'Rejected',rejectionReason:checkInWindowMessage(db.settings||{}),updatedAt:now.toISOString()};
        db.attempts.push(rejected); db.records.push(rejected);
        return {status:400, event:['attendance-rejected',rejected], body:{message:checkInWindowMessage(db.settings||{}),record:rejected}};
      }
      if(!v.ok){
        db.attempts.push(base); db.records.push(base);
        return {status:dlock.ok?400:403, event:['attendance-rejected',base], body:{message:v.reason,record:base}};
      }
      const record=existing||base;
      record.checkIn=now.toISOString();
      record.status=v.status==='Suspicious'?'Suspicious':(isLate(now,db.settings)?'Late':'Accepted');
      record.rejectionReason=v.status==='Suspicious'?(v.reason||'سجل يحتاج مراجعة'):'';
      record.deviceId=deviceId;
      record.deviceFingerprint=deviceId;
      record.deviceTrusted=true;
      record.updatedAt=now.toISOString();
      if(!existing) db.records.push(record);
      return {status:200, event:['attendance-check-in',record], body:{message:(dlock.firstBind?'تم ربط هذا الجهاز بحسابك بنجاح. ':'')+(record.status==='Suspicious'?'تم تسجيل الحضور مع وضعه للمراجعة بسبب هامش GPS ✅':(record.status==='Late'?'تم تسجيل الحضور بنجاح مع احتساب تأخير ✅':'تم تسجيل الحضور بنجاح ✅')),record,deviceBound:!!dlock.firstBind}};
    }, 'attendance-check-in');
    if(result.event) broadcast(result.event[0], result.event[1]);
    return res.status(result.status).json(result.body);
  }catch(err){
    console.error('check-in failed:', err);
    return res.status(500).json({message:'تعذر تسجيل الحضور الآن'});
  }
});

app.post('/api/attendance/check-out',authBound,async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      const now=new Date();
      const {lat,lng,accuracy}=req.body;
      const deviceId=getDeviceId(req.body, req);
      const dlock=checkDeviceLock(db,req.user.employeeCode,deviceId);
      if(!dlock.ok){
        const attempt={id:randomUUID(),employeeCode:req.user.employeeCode,employeeName:(dlock.employee?.name||req.user.name),date:todayKey(now),checkIn:null,checkOut:null,checkOutLat:lat,checkOutLng:lng,distance:0,accuracy:Number(accuracy||0),deviceId,deviceFingerprint:deviceId,deviceTrusted:false,deviceInfo:deviceInfo(req,req.body||{}),ipAddress:ip(req),status:dlock.status,rejectionReason:dlock.reason,createdAt:now.toISOString(),updatedAt:now.toISOString()};
        db.attempts.push(attempt); db.records.push(attempt);
        return {status:403, event:['attendance-rejected',attempt], body:{message:dlock.reason,record:attempt}};
      }
      const record=db.records.find(r=>r.employeeCode===req.user.employeeCode&&r.date===todayKey(now)&&r.checkIn);
      if(!record) return {status:400, body:{message:'لا يمكن تسجيل الانصراف قبل تسجيل الحضور'}};
      if(record.checkOut) return {status:400, body:{message:'تم تسجيل الانصراف مسبقًا اليوم'}};
      const v=validateLocation(db,lat,lng,accuracy,'check-out');
      if(!v.ok){
        const attempt={...record,id:randomUUID(),checkOutLat:lat,checkOutLng:lng,distance:v.distance||record.distance,accuracy:Number(accuracy||0),status:v.status,rejectionReason:v.reason,updatedAt:now.toISOString()};
        db.attempts.push(attempt); db.records.push(attempt);
        return {status:400, event:['attendance-rejected',attempt], body:{message:v.reason,record:attempt}};
      }
      record.checkOut=now.toISOString();
      record.checkOutLat=lat;
      record.checkOutLng=lng;
      record.deviceId=deviceId;
      record.deviceFingerprint=deviceId;
      record.deviceTrusted=true;
      record.distance=v.distance;
      record.accuracy=Number(accuracy||0);
      if(v.status==='Suspicious'){
        record.status='Suspicious';
        record.rejectionReason=v.reason||'سجل يحتاج مراجعة';
      }
      const emp=findEmployeeLoose(db, req.user.employeeCode);
      const ot=calcOvertime(emp, now, db.settings||{});
      record.overtimeHours=ot.overtimeHours;
      record.overtimeAmount=ot.overtimeAmount;
      record.updatedAt=now.toISOString();
      return {status:200, event:['attendance-check-out',record], body:{message:v.status==='Suspicious'?'تم تسجيل الانصراف مع وضعه للمراجعة بسبب هامش GPS ✅':'تم تسجيل الانصراف بنجاح ✅',record}};
    }, 'attendance-check-out');
    if(result.event) broadcast(result.event[0], result.event[1]);
    return res.status(result.status).json(result.body);
  }catch(err){
    console.error('check-out failed:', err);
    return res.status(500).json({message:'تعذر تسجيل الانصراف الآن'});
  }
});

const certPath = path.join(__dirname, 'certs', 'mahabat-local.crt');
const keyPath = path.join(__dirname, 'certs', 'mahabat-local.key');

const httpServer = http.createServer(app);
wsServer = attachAuthenticatedWs(httpServer);
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Mahabat Online Attendance API running on http://0.0.0.0:${PORT}`);
  console.log(`Local test: http://localhost:${PORT}/api/health`);
});

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsServer = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  }, app);
  attachAuthenticatedWs(httpsServer);
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`Mahabat HTTPS Attendance Portal running on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`Mobile URL example: https://192.168.8.36:${HTTPS_PORT}`);
  });
} else {
  console.warn('HTTPS certificate files not found. HTTPS portal is disabled.');
}


// Employee Full Portal APIs
app.get('/api/employee/profile', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
  if(!emp) return res.status(404).json({message:'الموظف غير موجود'});
  res.json({employee:publicEmployee(emp), leaveBalance:calcPortalLeaveBalance(db, emp.employeeCode)});
});

app.get('/api/employee/leaves', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const rows=(db.leaveRequests||[]).filter(x=>String(x.employeeCode).toUpperCase()===code).slice().reverse();
  res.json({requests:rows, balance:calcPortalLeaveBalance(db, code)});
});

app.post('/api/employee/leaves', authBound, async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const code=String(req.user.employeeCode||'').toUpperCase();
      const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
      if(!emp) return {status:404, body:{message:'الموظف غير موجود'}};
      const limit=requestLimitCheck(db.leaveRequests, emp.employeeCode, 'إجازة');
      if(!limit.ok) return {status:429, body:{message:limit.message}};
      const startDate = req.body.startDate || req.body.from || new Date().toISOString().slice(0,10);
      const endDate = req.body.endDate || req.body.to || startDate;
      const start=new Date(startDate); const end=new Date(endDate);
      const days=Number(req.body.days || Math.max(1, Math.ceil((end-start)/86400000)+1));
      const row={id:randomUUID(),employeeCode:emp.employeeCode,employeeName:emp.name || emp.fullName || req.user.name || emp.employeeCode,type:req.body.type||'Annual',startDate,endDate,days,reason:req.body.reason||'',status:'Pending',companyId:emp.companyId||'main',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      db.leaveRequests.push(row);
      addNotification(db, emp.employeeCode, 'إجازة', `طلب إجازة ${days} يوم قيد المراجعة`, 'leave');
      return {status:200, event:{record:row, employeeCode:emp.employeeCode}, body:{ok:true,message:'تم إرسال طلب الإجازة بنجاح',request:row}};
    }, 'employee-leave-request');
    if(result.status===200) broadcast('employee:leave', result.event);
    res.status(result.status).json(result.body);
  }catch(err){ console.error('leave request failed:', err); res.status(500).json({message:'تعذر حفظ طلب الإجازة'}); }
});

app.get('/api/employee/loans', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const rows=(db.loanRequests||[]).filter(x=>String(x.employeeCode).toUpperCase()===code).slice().reverse();
  res.json({requests:rows});
});

app.post('/api/employee/loans', authBound, async (req,res)=>{
  try{
    const result = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const code=String(req.user.employeeCode||'').toUpperCase();
      const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===code);
      if(!emp) return {status:404, body:{message:'الموظف غير موجود'}};
      const limit=requestLimitCheck(db.loanRequests, emp.employeeCode, 'سلفة');
      if(!limit.ok) return {status:429, body:{message:limit.message}};
      const amount=Number(req.body.amount||0);
      if(!amount || amount<=0) return {status:400, body:{message:'قيمة السلفة غير صحيحة'}};
      const installment=Number(req.body.installment||amount||0);
      const row={id:randomUUID(),employeeCode:emp.employeeCode,employeeName:emp.name || emp.fullName || req.user.name || emp.employeeCode,amount,installment,reason:req.body.reason||'',status:'Pending',companyId:emp.companyId||'main',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      db.loanRequests.push(row);
      addNotification(db, emp.employeeCode, 'سلفة', `طلب سلفة بقيمة ${amount} قيد المراجعة`, 'loan');
      return {status:200, event:{record:row, employeeCode:emp.employeeCode}, body:{ok:true,message:'تم إرسال طلب السلفة بنجاح',request:row}};
    }, 'employee-loan-request');
    if(result.status===200) broadcast('employee:loan', result.event);
    res.status(result.status).json(result.body);
  }catch(err){ console.error('loan request failed:', err); res.status(500).json({message:'تعذر حفظ طلب السلفة'}); }
});

app.get('/api/employee/payroll', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const emp=(typeof findEmployeeLoose==='function'?findEmployeeLoose(db,code):db.employees.find(e=>String(e.employeeCode).toUpperCase()===code));
  if(!emp) return res.status(404).json({message:'الموظف غير موجود'});

  // PATCH v16.7.3-salary-hotfix:
  // The portal renders state.payroll[0]. v16.7.3 returned the pure demo slip
  // only as `latest`, while `slips` could be empty; the UI therefore showed 0.
  // Keep GET read-only, but always include the computed latest slip as the first
  // item so the salary page and home KPI display the real current salary.
  const latest=enrichedPayrollSlip(db, demoPayrollSlip(db, emp));
  const history=(db.payrollSlips||[])
    .filter(x=>String(x.employeeCode).toUpperCase()===code)
    .map(x=>enrichedPayrollSlip(db,x))
    .slice().sort((a,b)=>String(b.month||'').localeCompare(String(a.month||'')));
  const hasLatestInHistory=history.some(x=>String(x.month||'')===String(latest.month||''));
  const slips=hasLatestInHistory ? history : [latest, ...history];
  res.json({slips, latest});
});




function salarySlipHtml(db, slip, emp, req){
  slip=enrichedPayrollSlip(db, slip);
  const logoUrl = `${safeApiBase(req)}/logo.png`;
  const money = v => `${new Intl.NumberFormat('en-US').format(Math.round(Number(v)||0))} ريال`;
  const e = htmlEsc;
  const row = (label,value,type='') => `<tr class="${e(type)}"><th>${e(label)}</th><td>${e(value)}</td></tr>`;
  const earnRows=[
    ['الراتب الأساسي', money(slip.basicSalary)],
    ['البدلات الأساسية', money(slip.allowances)],
    ['البدلات الإضافية', money(slip.additionalAllowances)],
    ['المكافآت', money(slip.bonuses)],
    ['الساعات الإضافية', money(slip.overtimeAmount)]
  ].map(x=>row(x[0],x[1])).join('');
  const dedRows=[
    ['خصم السلف', money(slip.loans)],
    ['الجزاءات / المخالفات', money(slip.penalties)],
    ['الخصومات', money(slip.deductions)],
    ['خصم الغياب / الإجازات غير المدفوعة', money(slip.absenceDeduction)]
  ].map(x=>row(x[0],x[1])).join('');
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>كشف راتب ${e(slip.month||'')}</title>
<style>
@page{size:A4;margin:12mm}
*{box-sizing:border-box}
body{margin:0;background:#eef7f8;color:#0f172a;font-family:Tahoma,Arial,sans-serif}
.page{max-width:920px;margin:20px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px #06324122}
.head{background:linear-gradient(135deg,#063241,#087F8C);color:#fff;padding:30px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand{display:flex;align-items:center;gap:14px}.brand img{width:76px;height:76px;border-radius:20px;background:#fff;padding:6px;object-fit:contain}.brand h1{margin:0;color:#FDBA35;font-size:30px}.brand p{margin:4px 0 0;color:#d9f7fb}
.month{border:1px solid #ffffff44;border-radius:20px;padding:12px 18px;text-align:center;font-weight:900;min-width:150px}
.content{padding:28px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.box{border:1px solid #D8E7EA;border-radius:18px;padding:16px;background:#FBFEFF}.box .label{color:#64748b;font-size:13px;font-weight:700}.box .value{color:#063241;font-size:24px;font-weight:900;margin-top:6px}.box.gold{background:#FDBA35;color:#332100;border:0}.box.gold .label,.box.gold .value{color:#332100}
.section{margin:22px 0}.section h2{color:#063241;margin:0 0 10px;font-size:19px}
.tbl{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #D8E7EA;border-radius:16px;overflow:hidden}.tbl th,.tbl td{border-bottom:1px solid #D8E7EA;padding:13px 15px;font-size:14px}.tbl tr:last-child th,.tbl tr:last-child td{border-bottom:0}.tbl th{background:#F2FAFB;color:#063241;text-align:right;width:48%}.tbl td{text-align:right;font-weight:800}.tbl tr:nth-child(even) td{background:#FBFEFF}.total th,.total td{background:#FDBA35!important;color:#332100!important;font-size:18px;font-weight:900}
.actions{position:sticky;bottom:0;background:#ffffffee;backdrop-filter:blur(12px);padding:12px;display:flex;gap:8px;justify-content:center;border-top:1px solid #D8E7EA}.btn{border:0;border-radius:14px;background:#063241;color:#fff;padding:12px 18px;font-weight:900;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}.btn.gold{background:#FDBA35;color:#332100}
.foot{text-align:center;color:#64748b;margin-top:24px;font-size:12px}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;border-radius:0}.actions{display:none}.content{padding:18px}.head{padding:20px}}
@media(max-width:700px){.page{margin:0;border-radius:0}.summary{grid-template-columns:1fr}.head{align-items:flex-start;flex-direction:column}}
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div class="brand"><img src="${e(logoUrl)}"/><div><h1>مهابة الفن</h1><p>كشف راتب الموظف</p></div></div>
    <div class="month">الشهر<br>${e(slip.month||'-')}</div>
  </div>
  <div class="content">
    <div class="summary">
      <div class="box"><div class="label">إجمالي المستحقات</div><div class="value">${money(slip.grossSalary)}</div></div>
      <div class="box"><div class="label">إجمالي الاستقطاعات</div><div class="value">${money(slip.totalDeductions)}</div></div>
      <div class="box gold"><div class="label">صافي الراتب</div><div class="value">${money(slip.netSalary)}</div></div>
    </div>

    <div class="section"><h2>بيانات الموظف</h2><table class="tbl">
      ${row('كود الموظف', emp.employeeCode||slip.employeeCode)}
      ${row('اسم الموظف', emp.name||emp.fullName||slip.employeeName)}
      ${row('القسم', emp.department||'-')}
      ${row('الوظيفة', emp.jobTitle||'-')}
      ${row('الشهر', slip.month||'-')}
    </table></div>

    <div class="section"><h2>المستحقات</h2><table class="tbl">${earnRows}</table></div>
    <div class="section"><h2>الاستقطاعات</h2><table class="tbl">${dedRows}</table></div>
    <div class="section"><h2>الصافي</h2><table class="tbl">${row('صافي الراتب المستحق', money(slip.netSalary),'total')}</table></div>
    <div class="foot">هذا الكشف صادر إلكترونيًا من نظام Mahabat HR Pro</div>
  </div>
  <div class="actions">
    <button class="btn gold" type="button" onclick="window.print()">طباعة</button>
    <a class="btn" href="/?v=from-payslip" target="_self">رجوع للبوابة</a>
  </div>
</div>
</body>
</html>`;
}


app.get('/api/employee/payroll/html', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const month=String(req.query.month||new Date().toISOString().slice(0,7));
  const emp=(typeof findEmployeeLoose==='function'?findEmployeeLoose(db,code):db.employees.find(e=>String(e.employeeCode).toUpperCase()===code));
  if(!emp) return res.status(404).send('الموظف غير موجود');
  let slip=(db.payrollSlips||[]).find(x=>String(x.employeeCode).toUpperCase()===code && (!month || x.month===month));
  if(!slip) slip=demoPayrollSlip(db,emp);
  slip=enrichedPayrollSlip(db,slip);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Content-Disposition',`inline; filename=salary-${htmlEsc(slip.month)}.html`);
  res.send(salarySlipHtml(db,slip,emp,req));
});




async function shapeArabicText(value){
  const text = String(value ?? '');
  if(!text) return '';
  let shaped = text;
  try{
    const mod = await import('arabic-reshaper');
    const reshaper = mod.default || mod;
    if(typeof reshaper.reshape === 'function') shaped = reshaper.reshape(text);
    else if(typeof reshaper === 'function') shaped = reshaper(text);
    else if(typeof reshaper.convertArabic === 'function') shaped = reshaper.convertArabic(text);
  }catch{}
  try{
    const embeddingLevels = bidi.getEmbeddingLevels(shaped, 'rtl');
    return bidi.getReorderedString(shaped, embeddingLevels);
  }catch{
    return shaped;
  }
}
async function pdfText(value){ return await shapeArabicText(value); }

async function renderPayslipPdfKitBuffer(db, slip, emp){
  slip=enrichedPayrollSlip(db, slip);
  const doc = new PDFDocument({size:'A4', margin:36, bufferPages:true, autoFirstPage:true});
  const chunks=[];
  doc.on('data', c => chunks.push(c));
  const done = new Promise((resolve,reject)=>{
    doc.on('end',()=>resolve(Buffer.concat(chunks)));
    doc.on('error',reject);
  });
  const fontPath = findArabicPdfFont();
  if(fontPath){
    doc.registerFont('Arabic', fontPath);
    doc.font('Arabic');
  }
  const W = doc.page.width;
  const rightX = 36;
  const usable = W - 72;
  const money = pdfMoney;
  const ar = async (x)=> await pdfText(x);

  doc.rect(0,0,W,112).fill('#063241');
  doc.fillColor('#FDBA35').fontSize(24).text(await ar('مهابة الفن'), 36, 30, {width:usable, align:'right'});
  doc.fillColor('#ffffff').fontSize(13).text(await ar('كشف راتب الموظف'), 36, 64, {width:usable, align:'right'});
  doc.roundedRect(36, 124, usable, 72, 16).fill('#F8FDFF').strokeColor('#D8E7EA').stroke();
  doc.fillColor('#063241').fontSize(13).text(await ar(`الشهر: ${slip.month || '-'}`), 54, 144, {width:usable-36, align:'right'});
  doc.fillColor('#0f172a').fontSize(11).text(await ar(`الموظف: ${emp.name || emp.fullName || slip.employeeName || '-'}`), 54, 166, {width:usable-36, align:'right'});

  const boxes=[
    [await ar('إجمالي المستحقات'), await ar(money(slip.grossSalary))],
    [await ar('إجمالي الاستقطاعات'), await ar(money(slip.totalDeductions))],
    [await ar('صافي الراتب'), await ar(money(slip.netSalary))]
  ];
  const boxW=(usable-20)/3;
  for(let i=0;i<3;i++){
    const x=36+i*(boxW+10);
    doc.roundedRect(x,214,boxW,70,14).fill(i===2?'#FDBA35':'#FBFEFF').strokeColor('#D8E7EA').stroke();
    doc.fillColor(i===2?'#332100':'#64748b').fontSize(9).text(boxes[i][0],x+10,232,{width:boxW-20,align:'center'});
    doc.fillColor(i===2?'#332100':'#063241').fontSize(15).text(boxes[i][1],x+10,254,{width:boxW-20,align:'center'});
  }

  async function section(title, rows, y){
    doc.fillColor('#063241').fontSize(15).text(await ar(title), 36, y, {width:usable, align:'right'});
    y+=26;
    for(const [label,value,total] of rows){
      doc.roundedRect(36,y,usable,30,4).fill(total?'#FDBA35':'#ffffff').strokeColor('#D8E7EA').stroke();
      doc.fillColor(total?'#332100':'#063241').fontSize(10).text(await ar(label), 316, y+9, {width:230, align:'right'});
      doc.fillColor(total?'#332100':'#0f172a').fontSize(10).text(await ar(value), 52, y+9, {width:240, align:'right'});
      y+=32;
      if(y>740){ doc.addPage(); y=46; }
    }
    return y+18;
  }

  let y=310;
  y = await section('بيانات الموظف', [
    ['كود الموظف', emp.employeeCode||slip.employeeCode],
    ['القسم', emp.department||'-'],
    ['الوظيفة', emp.jobTitle||'-']
  ], y);
  y = await section('المستحقات', [
    ['الراتب الأساسي', money(slip.basicSalary)],
    ['البدلات الأساسية', money(slip.allowances)],
    ['البدلات الإضافية', money(slip.additionalAllowances)],
    ['المكافآت', money(slip.bonuses)],
    ['الساعات الإضافية', money(slip.overtimeAmount)]
  ], y);
  y = await section('الاستقطاعات', [
    ['خصم السلف', money(slip.loans)],
    ['الجزاءات / المخالفات', money(slip.penalties)],
    ['الخصومات', money(slip.deductions)],
    ['خصم الغياب / الإجازات غير المدفوعة', money(slip.absenceDeduction)]
  ], y);
  await section('الصافي', [['صافي الراتب المستحق', money(slip.netSalary), true]], y);

  doc.fillColor('#64748b').fontSize(9).text(await ar('هذا الكشف صادر إلكترونيًا من نظام Mahabat HR Pro'), 36, 790, {width:usable, align:'center'});
  doc.end();
  return done;
}

app.get('/api/employee/payroll/pdf', authBound, async (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const month=String(req.query.month||new Date().toISOString().slice(0,7));
  const emp=(typeof findEmployeeLoose==='function'?findEmployeeLoose(db,code):db.employees.find(e=>String(e.employeeCode).toUpperCase()===code));
  if(!emp) return res.status(404).send('الموظف غير موجود');
  let slip=(db.payrollSlips||[]).find(x=>String(x.employeeCode).toUpperCase()===code && (!month || x.month===month));
  if(!slip) slip=demoPayrollSlip(db,emp);
  slip=enrichedPayrollSlip(db,slip);
  try{
    const pdfBuffer=await renderPayslipPdfKitBuffer(db,slip,emp);
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename=salary-${htmlEsc(slip.month)}.pdf`);
    res.setHeader('Content-Length',pdfBuffer.length);
    return res.end(pdfBuffer);
  }catch(err){
    console.error('PDFKit payslip fallback failed:', err);
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Disposition',`inline; filename=salary-${htmlEsc(slip.month)}.html`);
    return res.send(salarySlipHtml(db,slip,emp,req));
  }
});


app.post('/api/employee/change-password', authBound, async (req, res) => {
  try {
    const result = await withDbWrite(async (db)=>{
      ensureArrays(db);
      const employeeCode = String(req.user.employeeCode || '').toUpperCase();
      const { currentPassword, newPassword, confirmPassword } = req.body || {};
      if (!currentPassword || !newPassword || !confirmPassword) return {status:400, body:{ message: 'جميع حقول كلمة المرور مطلوبة' }};
      if (String(newPassword).length < 8) return {status:400, body:{ message: 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف' }};
      if (newPassword !== confirmPassword) return {status:400, body:{ message: 'تأكيد كلمة المرور غير مطابق' }};
      const employee = db.employees.find(emp => String(emp.employeeCode).toUpperCase() === employeeCode);
      if (!employee) return {status:404, body:{ message: 'الموظف غير موجود' }};
      const hash = employee.passwordHash || employee.portalPasswordHash || '';
      const legacyPlainPassword = employee.portalPassword || '';
      const passwordOk = hash ? bcrypt.compareSync(currentPassword, hash) : legacyPlainPassword === currentPassword;
      if (!passwordOk) return {status:401, body:{ message: 'كلمة المرور الحالية غير صحيحة' }};
      const newHash = bcrypt.hashSync(newPassword, 12);
      employee.passwordHash = newHash;
      employee.portalPasswordHash = newHash;
      delete employee.portalPassword;
      employee.passwordUpdatedAt = new Date().toISOString();
      employee.tokenVersion = Number(employee.tokenVersion || 1) + 1;
      addNotification(db, employee.employeeCode, 'تم تغيير كلمة المرور', 'تم تغيير كلمة مرور حسابك بنجاح', 'security');
      return {status:200, event:{ employeeCode: employee.employeeCode }, body:{ ok: true, message: 'تم تغيير كلمة المرور بنجاح' }};
    }, 'employee-change-password');
    if(result.status===200) broadcast('employee:password-changed', result.event);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('change-password failed:', error);
    return res.status(500).json({ message: 'تعذر تغيير كلمة المرور' });
  }
});

app.post(
  '/api/employee/upload-avatar',
  authBound,
  uploadAvatar.single('avatar'),
  validateAvatarMagicBytes,
  async (req, res) => {
    try {
      const result = await withDbWrite(async (db) => {
        ensureArrays(db);
        if (!req.file) return { status: 400, body: { message: 'لم يتم رفع صورة' } };

        const employeeCode = String(req.user.employeeCode || '').toUpperCase();
        const employee = typeof findEmployeeLoose === 'function'
          ? findEmployeeLoose(db, employeeCode)
          : db.employees.find((emp) => String(emp.employeeCode).toUpperCase() === employeeCode);

        if (!employee) {
          try { fs.unlinkSync(req.file.path); } catch {}
          return { status: 404, body: { message: 'الموظف غير موجود' } };
        }

        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        employee.avatarUrl = avatarUrl;
        employee.profileImage = avatarUrl;
        employee.updatedAt = new Date().toISOString();
        employee.avatarUpdatedAt = employee.updatedAt;

        addNotification(db, employee.employeeCode, 'الصورة الشخصية', 'تم تحديث صورتك الشخصية بنجاح', 'profile');

        return {
          status: 200,
          body: { ok: true, message: 'تم تحديث الصورة الشخصية بنجاح', avatarUrl, employee: publicEmployee(employee) },
          employeeCode: employee.employeeCode,
          avatarUrl,
        };
      }, 'employee-upload-avatar');

      broadcast('employee:avatar-updated', { employeeCode: result.employeeCode, avatarUrl: result.avatarUrl });
      return res.status(result.status).json(result.body);
    } catch (error) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
      console.error('upload-avatar failed:', error);
      return res.status(500).json({ message: 'تعذر رفع الصورة الشخصية' });
    }
  }
);


app.get('/api/employee/notifications', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const code=String(req.user.employeeCode||'').toUpperCase();
  const rows=(db.notifications||[]).filter(x=>String(x.employeeCode).toUpperCase()===code).slice().reverse().slice(0,50);
  res.json({notifications:rows});
});

app.post('/api/employee/notifications/read', authBound, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    const code=String(req.user.employeeCode||'').toUpperCase();
    db.notifications.filter(x=>String(x.employeeCode).toUpperCase()===code).forEach(x=>x.read=true);
    return {ok:true};
  }, 'employee-notifications-read');
  res.json(result);
});

app.get('/api/admin/employee-portal/requests', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  res.json({leaves:(db.leaveRequests||[]).slice().reverse(), loans:(db.loanRequests||[]).slice().reverse(), notifications:(db.notifications||[]).slice().reverse()});
});
app.post('/api/admin/employee-portal/request-status', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    const kind=req.body.kind==='loan'?'loan':'leave';
    const list=kind==='loan'?db.loanRequests:db.leaveRequests;
    const row=list.find(x=>x.id===req.body.id);
    if(!row) return {status:404, body:{message:'الطلب غير موجود'}};
    const oldStatus=row.status;
    row.status=req.body.status;
    row.reviewedAt=new Date().toISOString();
    row.reviewNote=req.body.note||'';
    row.updatedAt=new Date().toISOString();
    const label = kind==='loan'?'طلب السلفة':'طلب الإجازة';
    const arStatus = req.body.status==='Approved'?'تم الاعتماد':req.body.status==='Rejected'?'تم الرفض':req.body.status==='Cancelled'?'تم الإلغاء':req.body.status==='Paid'?'تم الإغلاق':`الحالة: ${req.body.status}`;
    addNotification(db,row.employeeCode,`تحديث ${label}`,`${arStatus}${row.reviewNote?' - '+row.reviewNote:''}`,kind);
    return {status:200, event:{kind,oldStatus,record:row,employeeCode:row.employeeCode}, body:{message:'تم تحديث الطلب وإرساله لبوابة الموظف',record:row}};
  }, 'admin-request-status');
  if(result.status===200) broadcast('employee:request-status', result.event);
  res.status(result.status).json(result.body);
});

app.post('/api/admin/employee-portal/notify', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    const employeeCode=String(req.body.employeeCode||'').trim().toUpperCase();
    if(!employeeCode) return {status:400, body:{message:'employeeCode مطلوب'}};
    const emp=db.employees.find(e=>String(e.employeeCode).toUpperCase()===employeeCode);
    if(!emp) return {status:404, body:{message:'الموظف غير موجود في السيرفر'}};
    const title=req.body.title || 'إشعار إداري';
    const body=req.body.body || '';
    const type=req.body.type || 'admin';
    const n=addNotification(db, emp.employeeCode, title, body, type);
    return {status:200, event:{type:'employee:notification',employeeCode:emp.employeeCode,notification:n,time:new Date().toISOString()}, body:{message:'تم إرسال الإشعار للموظف',notification:n}};
  }, 'admin-employee-notify');
  if(result.status===200) broadcast(result.event);
  res.status(result.status).json(result.body);
});



app.post('/api/admin/penalties/push', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    db.penalties ||= [];
    const rows=Array.isArray(req.body.penalties)?req.body.penalties:[];
    let count=0;
    rows.forEach(p=>{
      if(!p.employeeCode || !p.month) return;
      const idx=db.penalties.findIndex(x=>x.id===p.id || (String(x.employeeCode).toUpperCase()===String(p.employeeCode).toUpperCase() && x.month===p.month && String(x.title||'')===String(p.title||'')));
      const clean={...p,id:p.id||randomUUID(),employeeCode:String(p.employeeCode).toUpperCase(),amount:Number(p.amount??p.deduction??0),deduction:Number(p.deduction??p.amount??0),status:p.status||'Applied',companyId:p.companyId||'main',createdAt:p.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
      if(idx>=0) db.penalties[idx]={...db.penalties[idx],...clean}; else db.penalties.push(clean);
      count++;
      if(Number(clean.deduction||clean.amount||0)>0) addNotification(db,clean.employeeCode,'تم تسجيل خصم / جزاء',`${clean.title||'جزاء'} بقيمة ${clean.deduction||clean.amount} لشهر ${clean.month}`,'discipline');
    });
    return {count};
  }, 'admin-penalties-push');
  broadcast('penalties:updated',{count:result.count});
  res.json({ok:true,count:result.count});
});


app.post('/api/admin/payroll/push', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    db.payrollSlips ||= [];
    const slips=Array.isArray(req.body.slips)?req.body.slips:[];
    let upserted=0;
    slips.forEach(slip=>{
      if(!slip.employeeCode || !slip.month) return;
      const idx=db.payrollSlips.findIndex(x=>String(x.employeeCode).toUpperCase()===String(slip.employeeCode).toUpperCase() && x.month===slip.month);
      const clean={...slip,employeeCode:String(slip.employeeCode).toUpperCase(),companyId:slip.companyId||'main',updatedAt:new Date().toISOString()};
      if(idx>=0) db.payrollSlips[idx]={...db.payrollSlips[idx],...clean}; else db.payrollSlips.push({...clean,id:slip.id||randomUUID(),createdAt:new Date().toISOString()});
      upserted++;
      addNotification(db,clean.employeeCode,'تم تحديث كشف الراتب',`تم إصدار راتب شهر ${clean.month}`,'salary');
    });
    return {count:upserted};
  }, 'admin-payroll-push');
  broadcast('payroll:updated',{count:result.count});
  res.json({ ok:true, count:result.count });
});


// ===== ENTERPRISE ALLOWANCES / BONUSES SYNC =====
app.post('/api/admin/allowances/push', admin, async (req,res)=>{
  const result = await withDbWrite(async (db)=>{
    ensureArrays(db);
    db.allowances ||= [];
    db.penalties ||= [];
    const rows = Array.isArray(req.body.allowances) ? req.body.allowances : [];
    let count = 0;
    rows.forEach(a=>{
      if(!a.employeeCode || !a.month) return;
      const idx = db.allowances.findIndex(x => x.id === a.id || (String(x.employeeCode).toUpperCase()===String(a.employeeCode).toUpperCase() && x.month===a.month && x.title===a.title));
      const clean = {...a,employeeCode:String(a.employeeCode).toUpperCase(),id: a.id || randomUUID(),companyId: a.companyId || 'main',createdAt: a.createdAt || new Date().toISOString(),updatedAt: new Date().toISOString(),status: a.status || 'Approved'};
      const previous = idx >= 0 ? db.allowances[idx] : null;
      const isNewOrChanged = !previous || Number(previous.amount||0)!==Number(clean.amount||0) || String(previous.status||'')!==String(clean.status||'') || String(previous.title||'')!==String(clean.title||'');
      if(idx >= 0) db.allowances[idx] = { ...db.allowances[idx], ...clean }; else db.allowances.push(clean);
      count++;
      if(String(clean.status)==='Approved' && isNewOrChanged){
        const kindText=allowanceKindText(clean);
        const typeKey = kindText.includes('مكاف') ? 'bonus' : 'allowance';
        addNotification(db,clean.employeeCode,kindText,`${clean.title||kindText} بقيمة ${clean.amount} لشهر ${clean.month}. ستظهر مباشرة في كشف الراتب.`,typeKey);
      }
    });
    return {count};
  }, 'admin-allowances-push');
  broadcast('allowances:push',{count:result.count});
  res.json({ ok:true, count:result.count });
});

app.get('/api/employee/allowances', authBound, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  db.allowances ||= [];
  db.penalties ||= [];
  const code = String(req.user.employeeCode||'').toUpperCase();
  const rows = db.allowances
    .filter(x=>String(x.employeeCode).toUpperCase()===code)
    .slice().reverse();
  res.json({allowances:rows});
});

app.get('/api/admin/whatsapp-settings', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db); res.json(db.whatsappSettings);
});
app.post('/api/admin/whatsapp-settings', admin, async (req,res)=>{
  const result=await withDbWrite(async (db)=>{ ensureArrays(db); db.whatsappSettings={...db.whatsappSettings,...req.body}; return {message:'تم حفظ إعدادات واتساب',settings:db.whatsappSettings}; }, 'admin-whatsapp-settings');
  res.json(result);
});


async function sendWhatsAppNotification(db, phone, message, meta={}){
  db.whatsappLog ||= [];
  const item={id:randomUUID(),phone:phone||'',message,status:'Queued',provider:db.whatsappSettings?.provider||'',meta,createdAt:new Date().toISOString()};
  db.whatsappLog.push(item);
  // Ready for real provider integration later.
  // For now it logs the message safely without failing business operations.
  return item;
}

app.post('/api/admin/whatsapp-send-test', admin, async (req,res)=>{
  const result=await withDbWrite(async (db)=>{ ensureArrays(db); const msg=req.body.message || 'اختبار إشعارات واتساب من Mahabat HR Pro'; const phone=req.body.phone || db.whatsappSettings?.phone || ''; const item=await sendWhatsAppNotification(db, phone, msg, {type:'test'}); return {message:'تم تجهيز رسالة الاختبار في سجل واتساب. الربط الفعلي يحتاج تفعيل provider token.',providerStatus:db.whatsappSettings?.enabled?'Enabled':'Disabled',log:item}; }, 'admin-whatsapp-send-test');
  res.json(result);
});
app.get('/api/admin/whatsapp-log', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  res.json({log:(db.whatsappLog||[]).slice().reverse().slice(0,100)});
});

app.get('/api/admin/dashboard-live', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db);
  const companyId=companyScope(req,db);
  const today=todayKey();
  const employees=db.employees.filter(e=>(e.companyId||'main')===companyId && e.active!==false);
  const records=db.records.filter(r=>(r.companyId||'main')===companyId);
  const leaves=(db.leaveRequests||[]).filter(x=>(x.companyId||'main')===companyId).slice().reverse();
  const loans=(db.loanRequests||[]).filter(x=>(x.companyId||'main')===companyId).slice().reverse();
  const todayRecords=records.filter(r=>String(r.date).slice(0,10)===today);
  const present=todayRecords.filter(r=>r.checkIn).length;
  const checkedOut=todayRecords.filter(r=>r.checkOut).length;
  const late=todayRecords.filter(r=>r.status==='Late'||r.status==='متأخر').length;
  const absent=Math.max(0,employees.length-present);
  const suspicious=(db.attempts||[]).filter(a=>String(a.createdAt||'').slice(0,10)===today && a.status==='Rejected').length;
  const payrollTotal=(db.payrollSlips||[]).filter(p=>(p.companyId||'main')===companyId).reduce((s,p)=>s+Number(p.netSalary||0),0);
  const pendingLeaves=leaves.filter(x=>x.status==='Pending').length;
  const approvedLeaves=leaves.filter(x=>x.status==='Approved').length;
  const pendingLoans=loans.filter(x=>x.status==='Pending').length;
  const approvedLoans=loans.filter(x=>x.status==='Approved'||x.status==='Active').length;
  const rejectedLoans=loans.filter(x=>x.status==='Rejected'||x.status==='Cancelled').length;
  res.json({
    ok:true,time:new Date().toISOString(),companyId,
    kpis:{employees:employees.length,present,checkedOut,late,absent,suspicious,pendingLeaves,approvedLeaves,pendingLoans,approvedLoans,rejectedLoans,payrollTotal},
    recentRecords:records.slice(-10).reverse(),
    recentLeaves:leaves.slice(0,10),
    recentLoans:loans.slice(0,10),
    recentEvents:(db.liveEvents||[]).slice(-20).reverse(),
    whatsappLog:(db.whatsappLog||[]).slice(-10).reverse()
  });
});

app.get('/api/admin/companies', admin, (req,res)=>{
  const db=readDb(); ensureArrays(db); res.json({companies:db.companies,currentCompanyId:db.currentCompanyId||'main'});
});
app.post('/api/admin/companies', admin, async (req,res)=>{
  const result=await withDbWrite(async (db)=>{ ensureArrays(db); const id=String(req.body.id||req.body.name||'company').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || randomUUID(); let company=db.companies.find(c=>c.id===id); if(company) Object.assign(company,{name:req.body.name||company.name,domain:req.body.domain||company.domain,status:req.body.status||company.status}); else { company={id,name:req.body.name||id,domain:req.body.domain||'',status:req.body.status||'Active',createdAt:new Date().toISOString()}; db.companies.push(company); } return {message:'تم حفظ الشركة',company,companies:db.companies}; }, 'admin-companies-save');
  res.json(result);
});
app.post('/api/admin/companies/select', admin, async (req,res)=>{
  const result=await withDbWrite(async (db)=>{ ensureArrays(db); const id=req.body.companyId||'main'; if(!db.companies.find(c=>c.id===id)) return {status:404,body:{message:'الشركة غير موجودة'}}; db.currentCompanyId=id; return {status:200,body:{message:'تم اختيار الشركة',currentCompanyId:id}}; }, 'admin-company-select');
  res.status(result.status).json(result.body);
});

