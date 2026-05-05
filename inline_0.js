
(function(){
'use strict';

const root = document.getElementById('root');
const API = '';
let state = { tab:'home', me:null, balance:{}, records:[], leaves:[], loans:[], payroll:[], allowances:[], notes:[], msg:'', lastLoad:null };
let ws = null;
let cachedDeviceFp = '';
let reloadTimer = null;

const preferredLocale = (localStorage.getItem('portalLang') || (navigator.language || 'ar').toLowerCase().startsWith('en') ? 'en' : 'ar');
let locale = localStorage.getItem('portalLang') || preferredLocale;
const I18N = {
  ar: {
    appTitle:'بوابة موظف مهابة الفن', employeeLogin:'تسجيل دخول الموظفين', empCodePlaceholder:'كود الموظف مثل EMP-001', password:'كلمة المرور', login:'دخول', loginLoading:'جاري الدخول...', loginChecking:'جاري التحقق من بيانات الدخول...', testConnection:'اختبار اتصال البوابة', loginHint:'الدخول بكود الموظف وليس البريد الإلكتروني', missingEmp:'اكتب كود الموظف مثل EMP-001', missingPass:'اكتب كلمة المرور', loginFailed:'تعذر تسجيل الدخول', testing:'جاري اختبار الاتصال...', serverOk:'السيرفر متصل ويعمل ✅', connectionFailed:'تعذر الاتصال بالسيرفر. تحقق من الإنترنت أو أعد تحميل الصفحة.', requestFailed:'تعذر تنفيذ الطلب', sessionExpired:'انتهت الجلسة', loadFailed:'تعذر تحميل البيانات', partialLoad:'تعذر تحديث {n} من الأقسام مؤقتًا، وتم الاحتفاظ بآخر بيانات محفوظة.', hello:'مرحبًا', home:'الرئيسية', attendance:'الحضور', requests:'طلباتي', salary:'الراتب', settings:'الإعدادات', notifications:'الإشعارات', todayNotChecked:'لم يتم تسجيل الحضور اليوم', checkedIn:'تم تسجيل الحضور {time}', checkedOut:'تم تسجيل الانصراف {time}', homeTitle:'الصفحة الرئيسية', homeSubtitle:'ملخص سريع للحضور والطلبات والراتب مع أهم الإجراءات اليومية.', checkIn:'تسجيل حضور', checkOut:'تسجيل انصراف', attendanceRule:'يسمح بتسجيل الحضور خلال 3 ساعات فقط من بداية الدوام الرسمي.', lastSalary:'آخر راتب', leaveBalance:'رصيد الإجازات', pendingRequests:'طلبات معلقة', quickAccess:'الوصول السريع', attendanceLog:'سجل الحضور', newRequest:'طلب جديد', payslip:'كشف الراتب', attendanceTitle:'الحضور والانصراف', attendanceSubtitle:'سجل حضورك وانصرافك من موقع العمل المعتمد', todayStatus:'حالة اليوم', lastUpdate:'آخر تحديث', gpsHint:'سيتم استخدام GPS للتحقق من وجودك داخل نطاق العمل. تأكد من تفعيل الموقع في المتصفح.', recentAttendance:'آخر سجلات الحضور', noAttendance:'لا توجد سجلات حضور حتى الآن', requestsTitle:'طلباتي', requestsSubtitle:'تابع طلبات الإجازات والسلف من مكان واحد', leaveRequest:'طلب إجازة', loanRequest:'طلب سلفة', pendingLeaves:'إجازات معلقة', pendingLoans:'سلف معلقة', leaveRequests:'طلبات الإجازة', loanRequests:'طلبات السلفة', noLeaves:'لا توجد طلبات إجازة', noLoans:'لا توجد طلبات سلفة', leaveTitle:'طلب إجازة', leaveSubtitle:'يمكنك إرسال طلب واحد فقط في اليوم وبحد أقصى طلبين في الشهر', leaveType:'نوع الإجازة', annual:'سنوية', sick:'مرضية', emergency:'طارئة', fromDate:'من تاريخ', toDate:'إلى تاريخ', leaveReason:'سبب الإجازة', leaveReasonPh:'اكتب سبب الإجازة بوضوح', leaveHint:'سيظهر الطلب للإدارة للمراجعة، وستصلك إشعارات عند قبول أو رفض الطلب.', submitLeave:'إرسال طلب الإجازة', loanTitle:'طلب سلفة', loanSubtitle:'يمكنك إرسال طلب واحد فقط في اليوم وبحد أقصى طلبين في الشهر', loanAmount:'قيمة السلفة', loanAmountPh:'مثال: 1000', months:'عدد الأشهر', loanReason:'سبب الطلب', loanReasonPh:'اكتب سبب طلب السلفة', loanHint:'بعد موافقة الإدارة ستظهر السلفة في كشف الراتب حسب نظام الشركة.', submitLoan:'إرسال طلب السلفة', payrollTitle:'كشف الراتب', payrollSubtitle:'عرض صافي الراتب والبدلات والمكافآت والخصومات', latestNetSalary:'صافي آخر راتب', basicSalary:'الراتب الأساسي', baseAllowances:'البدلات الأساسية', extraAllowances:'البدلات الإضافية', bonuses:'المكافآت', overtime:'الساعات الإضافية', loansDeduction:'خصم السلف', penalties:'الجزاءات / الخصومات', absenceDeduction:'خصم الغياب / الإجازات', netSalary:'صافي الراتب', viewPayslip:'عرض كشف الراتب', downloadPdf:'تحميل PDF', payrollHistory:'سجل الرواتب', noPayroll:'لا توجد كشوف رواتب', profileTitle:'بياناتي', profileSubtitle:'بياناتك الأساسية المسجلة لدى الشركة', empCode:'كود الموظف', department:'القسم', jobTitle:'الوظيفة', phone:'الجوال', email:'البريد', notificationsTitle:'الإشعارات', notificationsSubtitle:'تابع تنبيهات الرواتب والبدلات والطلبات', totalNotifications:'إجمالي الإشعارات', unread:'غير مقروء', noNotifications:'لا توجد إشعارات', settingsTitle:'الإعدادات والأمان', settingsSubtitle:'تغيير كلمة المرور والخروج من البوابة', securityHint:'استخدم كلمة مرور قوية ولا تشاركها مع أي شخص. بعد التغيير سيتم تسجيل خروجك تلقائيًا.', currentPassword:'كلمة المرور الحالية', newPassword:'كلمة المرور الجديدة', changePassword:'تغيير كلمة المرور', logout:'تسجيل خروج', findingLocation:'جاري تحديد الموقع...', movementFailed:'تعذر تسجيل الحركة', movementDone:'تم التسجيل', leaveSent:'تم إرسال طلب الإجازة', loanSent:'تم إرسال طلب السلفة', passwordChanged:'تم تغيير كلمة المرور، سجل الدخول مرة أخرى', noPayslip:'لا يوجد كشف راتب متاح', pdfIssued:'هذا الكشف صادر إلكترونيًا من نظام Mahabat HR Pro', employee:'الموظف', code:'الكود', month:'الشهر', pending:'قيد المراجعة', approved:'مقبول', rejected:'مرفوض', cancelled:'ملغي', active:'نشط', record:'سجل', sar:'ريال', browserNoGps:'المتصفح لا يدعم GPS', langToggle:'English'
  },
  en: {
    appTitle:'Mahabat HR Pro Employee Portal', employeeLogin:'Employee Sign-In', empCodePlaceholder:'Employee ID, e.g. EMP-001', password:'Password', login:'Sign in', loginLoading:'Signing you in...', loginChecking:'Verifying your credentials...', testConnection:'Test portal connection', loginHint:'Use your employee ID, not your email address.', missingEmp:'Please enter your employee ID, e.g. EMP-001.', missingPass:'Please enter your password.', loginFailed:'Unable to sign in. Please try again.', testing:'Testing portal connectivity...', serverOk:'The portal is online and ready.', connectionFailed:'Unable to reach the server. Check your connection and reload the page.', requestFailed:'Unable to complete the request', sessionExpired:'Your session has expired', loadFailed:'Unable to load your portal data', partialLoad:'{n} sections could not be refreshed. Your latest saved data is still displayed.', hello:'Welcome', home:'Home', attendance:'Attendance', requests:'Requests', salary:'Payroll', settings:'Settings', notifications:'Notifications', todayNotChecked:'Attendance has not been recorded today', checkedIn:'Checked in at {time}', checkedOut:'Checked out at {time}', homeTitle:'Employee Dashboard', homeSubtitle:'A clear overview of attendance, requests, payroll, and daily actions.', checkIn:'Check in', checkOut:'Check out', attendanceRule:'Check-in is available for up to 3 hours after the official shift start time.', lastSalary:'Latest Salary', leaveBalance:'Leave Balance', pendingRequests:'Pending Requests', quickAccess:'Quick Access', attendanceLog:'Attendance Log', newRequest:'New Request', payslip:'Payslip', attendanceTitle:'Attendance & Timekeeping', attendanceSubtitle:'Record your check-in and check-out from the approved work location.', todayStatus:'Today’s Status', lastUpdate:'Last Updated', gpsHint:'GPS will be used to verify that you are within the approved work area. Please allow location access in your browser.', recentAttendance:'Recent Attendance Records', noAttendance:'No attendance records available yet.', requestsTitle:'My Requests', requestsSubtitle:'Track leave and salary advance requests from one place.', leaveRequest:'Leave Request', loanRequest:'Salary Advance', pendingLeaves:'Pending Leave', pendingLoans:'Pending Advances', leaveRequests:'Leave Requests', loanRequests:'Salary Advance Requests', noLeaves:'No leave requests found.', noLoans:'No salary advance requests found.', leaveTitle:'Submit Leave Request', leaveSubtitle:'You may submit one request per day and up to two requests per month.', leaveType:'Leave Type', annual:'Annual Leave', sick:'Sick Leave', emergency:'Emergency Leave', fromDate:'Start Date', toDate:'End Date', leaveReason:'Reason for Leave', leaveReasonPh:'Write a clear reason for your leave request', leaveHint:'Your request will be routed to management for review. You will be notified once it is approved or declined.', submitLeave:'Submit Leave Request', loanTitle:'Request Salary Advance', loanSubtitle:'You may submit one request per day and up to two requests per month.', loanAmount:'Advance Amount', loanAmountPh:'Example: 1000', months:'Repayment Period', loanReason:'Request Reason', loanReasonPh:'Write the reason for this salary advance', loanHint:'Once approved, the salary advance will appear in your payslip according to company policy.', submitLoan:'Submit Salary Advance Request', payrollTitle:'Payslip', payrollSubtitle:'Review net pay, allowances, bonuses, and deductions.', latestNetSalary:'Latest Net Pay', basicSalary:'Basic Salary', baseAllowances:'Standard Allowances', extraAllowances:'Additional Allowances', bonuses:'Bonuses', overtime:'Overtime', loansDeduction:'Salary Advance Deduction', penalties:'Penalties / Deductions', absenceDeduction:'Absence / Leave Deduction', netSalary:'Net Salary', viewPayslip:'View Payslip', downloadPdf:'Download PDF', payrollHistory:'Payroll History', noPayroll:'No payslips are available.', profileTitle:'My Profile', profileSubtitle:'Your employee information registered with the company.', empCode:'Employee ID', department:'Department', jobTitle:'Job Title', phone:'Mobile', email:'Email', notificationsTitle:'Notifications', notificationsSubtitle:'Stay updated on payroll, allowances, approvals, and requests.', totalNotifications:'Total Notifications', unread:'Unread', noNotifications:'No notifications available.', settingsTitle:'Security & Settings', settingsSubtitle:'Change your password or sign out of the portal.', securityHint:'Use a strong password and never share it. You will be signed out automatically after changing your password.', currentPassword:'Current Password', newPassword:'New Password', changePassword:'Change Password', logout:'Sign Out', findingLocation:'Detecting your location...', movementFailed:'Unable to record this attendance action.', movementDone:'Attendance action recorded.', leaveSent:'Your leave request has been submitted.', loanSent:'Your salary advance request has been submitted.', passwordChanged:'Your password has been changed. Please sign in again.', noPayslip:'No payslip is available.', pdfIssued:'This payslip was generated electronically by Mahabat HR Pro.', employee:'Employee', code:'ID', month:'Month', pending:'Pending Review', approved:'Approved', rejected:'Declined', cancelled:'Cancelled', active:'Active', record:'Record', sar:'SAR', browserNoGps:'Your browser does not support GPS/location services.', langToggle:'العربية'
  }
};
function isEn(){ return locale === 'en'; }
function t(k, vars={}){ let s=(I18N[locale]&&I18N[locale][k]) || I18N.ar[k] || k; return String(s).replace(/\{(\w+)\}/g,(_,x)=>vars[x]??''); }
function setLocale(next){ locale = next === 'en' ? 'en' : 'ar'; localStorage.setItem('portalLang', locale); document.documentElement.lang = locale; document.documentElement.dir = isEn() ? 'ltr' : 'rtl'; document.title = t('appTitle'); }
function toggleLocale(){ setLocale(isEn() ? 'ar' : 'en'); if(token()) render(); else renderLogin(); }
setLocale(locale);
function smartMessage(message){
  const m=String(message||'');
  if(!isEn()) return m;
  const map=[[/انتهت الجلسة|تسجيل الدخول مرة أخرى/i,'Your session has expired. Please sign in again.'],[/مرتبط بجهاز آخر/i,'This account is linked to another trusted device. Please contact management to reset the device lock.'],[/طلبات كثيرة|Too many requests/i,'Too many requests. Please try again shortly.'],[/الموظف غير موجود/i,'Employee record was not found.'],[/بيانات الدخول غير صحيحة|الحساب غير مفعل/i,'Invalid credentials or inactive account.'],[/تعذر الاتصال بالسيرفر/i,t('connectionFailed')],[/تعذر تنفيذ الطلب/i,t('requestFailed')],[/لا يوجد كشف راتب/i,t('noPayslip')],[/المتصفح لا يدعم GPS/i,t('browserNoGps')],[/جاري تحديد الموقع/i,t('findingLocation')]];
  for(const [rx,en] of map) if(rx.test(m)) return en;
  return m;
}


function esc(v){return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function token(){return localStorage.getItem('token') || '';}
function headers(){return authHeaders();}
function fmtMoney(v){return new Intl.NumberFormat(isEn()?'en-US':'ar-SA').format(Math.round(Number(v)||0)) + ' ' + t('sar');}
function statusText(s){return ({Pending:t('pending'),Approved:t('approved'),Rejected:t('rejected'),Cancelled:t('cancelled'),Active:t('active')}[s] || s || '-');}
function statusClass(s){return s==='Approved'||s==='Active'?'ok':(s==='Rejected'||s==='Cancelled'?'danger':'warn');}

function svgIcon(name){
  const icons={
    home:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/><path d="M9 20v-6h6v6"/></svg>',
    attendance:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
    requests:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M8 4h8l3 3v13H5V4h3Z"/><path d="M15 4v4h4"/><path d="M8 13h8M8 17h5"/></svg>',
    salary:'<svg class="iconSvg" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>',
    settings:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-2 .1 1.7 1.7 0 0 0-.8 1.6v.2H9.2V22a1.7 1.7 0 0 0-.8-1.6 1.7 1.7 0 0 0-2-.1l-.2.1-2-3.4.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.4-1.1H3v-4h.2a1.7 1.7 0 0 0 1.4-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 2-.1 1.7 1.7 0 0 0 .8-1.6V1.6h5.6V2a1.7 1.7 0 0 0 .8 1.6 1.7 1.7 0 0 0 2 .1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.4 1.1h.2v4h-.2A1.7 1.7 0 0 0 19.4 15Z"/></svg>',
    bell:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>',
    check:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
    exit:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 3v18"/></svg>',
    leave:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M4 20c7-1 12-6 16-16"/><path d="M7 17c-2-5 0-10 5-13 1 4 4 6 8 6-3 5-8 7-13 7Z"/></svg>',
    loan:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M4 7h16v10H4z"/><circle cx="12" cy="12" r="2.2"/><path d="M7 7v10M17 7v10"/></svg>',
    profile:'<svg class="iconSvg" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    calendar:'<svg class="iconSvg" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    document:'<svg class="iconSvg" viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>'
  };
  return icons[name]||icons.document;
}
function iconWrap(name){ return '<span class="ico">'+svgIcon(name)+'</span>'; }
function itemIcon(name){ return '<div class="itemIcon">'+svgIcon(name)+'</div>'; }

function deviceId(){let x=localStorage.getItem('mahabatDeviceId'); if(!x){x=(crypto.randomUUID?crypto.randomUUID():'dev-'+Date.now()); localStorage.setItem('mahabatDeviceId',x);} return x;}
async function sha256Hex(text){
  if(window.crypto?.subtle){
    const data = new TextEncoder().encode(String(text));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }
  return String(text).split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0).toString(16);
}
function canvasHash(){
  try{
    const c=document.createElement('canvas'); c.width=240; c.height=60;
    const ctx=c.getContext('2d');
    ctx.textBaseline='top'; ctx.font='16px Arial'; ctx.fillStyle='#063241';
    ctx.fillRect(0,0,240,60); ctx.fillStyle='#FDBA35'; ctx.fillText('Mahabat HR Pro بصمة الجهاز',8,18);
    return c.toDataURL();
  }catch{return 'no-canvas';}
}
async function deviceFingerprint(){
  if(cachedDeviceFp) return cachedDeviceFp;
  const raw = [deviceId(), canvasHash(), navigator.userAgent, screen.width+'x'+screen.height+'x'+screen.colorDepth, Intl.DateTimeFormat().resolvedOptions().timeZone || '', navigator.language || ''].join('|');
  cachedDeviceFp = await sha256Hex(raw);
  localStorage.setItem('mahabatDeviceFp', cachedDeviceFp);
  return cachedDeviceFp;
}
function setMsg(message,type='info'){state.msg='<div class="msg '+type+'">'+esc(smartMessage(message))+'</div>'; const el=document.getElementById('message'); if(el) el.innerHTML=state.msg;}
function clearRoot(cls='app'){root.className=cls; root.innerHTML='';}
function authHeaders(extra={}){ return { Authorization:'Bearer ' + token(), 'X-Device-Fp': cachedDeviceFp || localStorage.getItem('mahabatDeviceFp') || deviceId(), ...extra }; }

async function call(url,opt={}){
  let res;
  const h = new Headers(opt.headers || {});
  if(token() && !h.has('Authorization')) h.set('Authorization','Bearer ' + token());
  if(!h.has('X-Device-Fp')) h.set('X-Device-Fp', cachedDeviceFp || localStorage.getItem('mahabatDeviceFp') || await deviceFingerprint());
  opt = {...opt, headers:h};
  try { res = await fetch(API + url, opt); }
  catch (err) { throw new Error(t('connectionFailed')); }
  const text = await res.text().catch(()=>'');
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {message:text}; }
  if(!res.ok) throw new Error(smartMessage(data.message) || (t('requestFailed') + ' (' + res.status + ')'));
  return data;
}

async function testPortalConnection(){
  const msg = document.getElementById('loginMsg');
  if(msg) msg.innerHTML = '<div class="msg info">'+t('testing')+'</div>';
  try{
    const d = await call('/api/health');
    if(msg) msg.innerHTML = '<div class="msg ok">'+t('serverOk')+'</div>';
  }catch(e){
    if(msg) msg.innerHTML = '<div class="msg error">'+esc(smartMessage(e.message))+'</div>';
  }
}

async function doLogin(){
  const emp = document.getElementById('emp');
  const pass = document.getElementById('pass');
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  const employeeId = String(emp?.value || '').trim().toUpperCase();
  const password = String(pass?.value || '');

  if(!employeeId){ msg.innerHTML='<div class="msg error">'+t('missingEmp')+'</div>'; return; }
  if(!password){ msg.innerHTML='<div class="msg error">'+t('missingPass')+'</div>'; return; }

  btn.disabled = true;
  btn.textContent = t('loginLoading');
  msg.innerHTML = '<div class="msg info">'+t('loginChecking')+'</div>';

  try{
    const data = await call('/api/auth/login', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ employeeId, password, deviceId:deviceId(), deviceFingerprint:await deviceFingerprint() })
    });
    localStorage.setItem('token', data.token);
    state.me = data.employee;
    await loadAll();
    render();
    connectRealtime();
  }catch(e){
    localStorage.removeItem('token');
    msg.innerHTML = '<div class="msg error">'+esc(smartMessage(e.message || t('loginFailed')))+'</div>';
  }finally{
    btn.disabled = false;
    btn.textContent = t('login');
  }
}

async function loadAll(){
  const endpoints = [
    ['profile','/api/employee/profile'],
    ['records','/api/attendance/my-records'],
    ['leaves','/api/employee/leaves'],
    ['loans','/api/employee/loans'],
    ['payroll','/api/employee/payroll'],
    ['allowances','/api/employee/allowances'],
    ['notes','/api/employee/notifications']
  ];

  const safeFetch = async ([key, url]) => {
    try {
      const data = await call(url, { headers: headers() });
      return { key, ok: true, data };
    } catch (error) {
      const message = String(error?.message || '');
      return { key, ok: false, error, isAuthError: /انتهت الجلسة|401|unauthorized|غير مصرح/i.test(message) };
    }
  };

  const results = await Promise.all(endpoints.map(safeFetch));
  const authFailure = results.find((r) => r.isAuthError);
  if (authFailure) throw authFailure.error;

  for (const result of results) {
    if (!result.ok) continue;
    const d = result.data || {};
    if (result.key === 'profile') { state.me = d.employee || state.me; state.balance = d.leaveBalance || state.balance || {}; }
    if (result.key === 'records') state.records = d.records || state.records || [];
    if (result.key === 'leaves') state.leaves = d.requests || state.leaves || [];
    if (result.key === 'loans') state.loans = d.requests || state.loans || [];
    if (result.key === 'payroll') state.payroll = d.slips || state.payroll || [];
    if (result.key === 'allowances') state.allowances = d.allowances || state.allowances || [];
    if (result.key === 'notes') state.notes = d.notifications || state.notes || [];
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    state.msg = '<div class="msg info">' + esc(t('partialLoad',{n:failed.length})) + '</div>';
  }

  state.lastLoad = new Date();
  try { const { msg, ...persistable } = state; localStorage.setItem('portalCache', JSON.stringify(persistable)); } catch {}
}

function restoreCache(){try{const c=JSON.parse(localStorage.getItem('portalCache')||'{}'); if(c && c.me) Object.assign(state,c);}catch{}}


function renderLogin(prefill='',err=''){
  clearRoot('loginWrap');
  root.innerHTML =
    '<div class="loginCard">' +
      '<button id="langToggle" class="langBtn" type="button" style="float:inline-end">'+t('langToggle')+'</button>'+
      '<img src="/logo.png" class="logo"/>' +
      '<h1 class="title">'+t('appTitle')+'</h1>' +
      '<p class="sub">'+t('employeeLogin')+'</p>' +
      '<div id="loginMsg">'+(err?'<div class="msg error">'+esc(smartMessage(err))+'</div>':'')+'</div>' +
      '<form id="loginForm">' +
        '<input id="emp" class="input" placeholder="'+t('empCodePlaceholder')+'" value="'+esc(prefill)+'"/>' +
        '<input id="pass" class="input" type="password" placeholder="'+t('password')+'"/>' +
        '<button id="loginBtn" class="btn gold" type="submit">'+t('login')+'</button>' +
      '</form>' +
      '<button id="testBtn" class="btn line" type="button">'+t('testConnection')+'</button>' +
      '<div class="small" style="text-align:center;margin-top:8px">'+t('loginHint')+'</div>' +
    '</div>';

  document.getElementById('loginForm').addEventListener('submit', function(e){ e.preventDefault(); doLogin(); });
  document.getElementById('testBtn').addEventListener('click', testPortalConnection);
  document.getElementById('langToggle').addEventListener('click', toggleLocale);
}

function topShell(){
  const av = state.me?.avatarUrl || state.me?.profileImage || '';
  return '<div class="top">' +
    (av?'<img src="'+esc(av)+'"/>':'<img src="/logo.png"/>') +
    '<div class="grow"><div class="hello">'+t('hello')+'</div><div class="name">'+esc(state.me?.name||'')+'</div><div class="meta">'+esc(state.me?.department||'')+' • '+esc(state.me?.jobTitle||'')+'</div></div>' +
    '<button class="langBtn" id="langToggle" type="button">'+t('langToggle')+'</button>'+
    '<button class="iconBtn" data-tab="notifications">'+svgIcon('bell')+'</button>' +
  '</div>';
}

function todayStatus(){
  const today = new Date().toISOString().slice(0,10);
  const r = (state.records||[]).find(x => String(x.date||'').slice(0,10)===today);
  if(!r || !r.checkIn) return {txt:t('todayNotChecked'), cls:'warn'};
  if(r.checkIn && !r.checkOut) return {txt:t('checkedIn',{time:esc(r.checkIn)}), cls:'ok'};
  return {txt:t('checkedOut',{time:esc(r.checkOut)}), cls:'ok'};
}

function home(){
  const st = todayStatus(), latestPay=(state.payroll||[])[0]||{}, pending=(state.leaves||[]).filter(x=>x.status==='Pending').length+(state.loans||[]).filter(x=>x.status==='Pending').length;
  return topShell()+
  '<div class="homeActionPanel">'+
    '<div class="mainHomeCard"><span class="pill '+st.cls+'">'+st.txt+'</span><h2>'+t('homeTitle')+'</h2><p>'+t('homeSubtitle')+'</p></div>'+
    '<div class="homeActionBtns"><button class="quick green" id="checkInBtn">'+iconWrap('check')+t('checkIn')+'</button><button class="quick red" id="checkOutBtn">'+iconWrap('exit')+t('checkOut')+'</button></div>'+
  '</div>'+
  '<div class="homeAttendanceRule">'+svgIcon('attendance')+' '+t('attendanceRule')+'</div>'+
  '<div class="grid3"><div class="kpi"><div class="label">'+t('lastSalary')+'</div><div class="value">'+fmtMoney(latestPay.netSalary||0)+'</div></div><div class="kpi"><div class="label">'+t('leaveBalance')+'</div><div class="value">'+Number(state.balance?.remainingLeaves ?? state.balance?.remaining ?? 0)+'</div></div><div class="kpi"><div class="label">'+t('pendingRequests')+'</div><div class="value">'+pending+'</div></div></div>'+
  '<div id="message">'+(state.msg||'')+'</div>'+
  '<div class="sectionTitle"><h2>'+t('quickAccess')+'</h2></div>'+
  '<div class="grid2"><button class="quick gold" data-tab="att">'+iconWrap('attendance')+t('attendanceLog')+'</button><button class="quick teal" data-tab="requests">'+iconWrap('requests')+t('newRequest')+'</button><button class="quick" data-tab="pay">'+iconWrap('salary')+t('payslip')+'</button><button class="quick" data-tab="notifications">'+iconWrap('bell')+t('notifications')+'</button></div>';
}

function listItems(arr, icon, empty){
  if(!arr || !arr.length) return '<div class="emptyState"><div class="emptyIcon">'+svgIcon(icon)+'</div><div>'+esc(empty)+'</div></div>';
  return '<div class="list">'+arr.slice(0,30).map(x => {
    const title=esc(x.type||x.reason||x.title||x.month||String(x.date||'').slice(0,10)||t('record'));
    const sub=esc(x.body||x.checkIn||x.startDate||x.from||x.employeeName||'');
    const st=x.status?'<span class="pill '+statusClass(x.status)+'">'+statusText(x.status)+'</span>':'';
    return '<div class="item">'+itemIcon(icon)+'<div class="itemBody"><div class="itemTitle">'+title+'</div><div class="itemSub">'+sub+'</div></div>'+st+'</div>';
  }).join('')+'</div>';
}

function pageHero(icon,title,sub){
  return '<div class="pageHero"><div class="heroIcon">'+svgIcon(icon)+'</div><div><h2>'+esc(title)+'</h2><p>'+esc(sub||'')+'</p></div></div>';
}

function attendance(){
  const today = todayStatus();
  return topShell()+
    pageHero('attendance',t('attendanceTitle'),t('attendanceSubtitle'))+
    '<div class="statStrip"><div class="statMini"><div class="label">'+t('todayStatus')+'</div><div class="value">'+esc(today.txt)+'</div></div><div class="statMini"><div class="label">'+t('lastUpdate')+'</div><div class="value">'+(state.lastLoad?new Date(state.lastLoad).toLocaleTimeString(isEn()?'en-US':'ar-SA'):'-')+'</div></div></div>'+
    '<div class="grid2"><button class="btn green" id="checkInBtn"><span class="btnIcon">'+svgIcon('check')+'</span>'+t('checkIn')+'</button><button class="btn red" id="checkOutBtn"><span class="btnIcon">'+svgIcon('exit')+'</span>'+t('checkOut')+'</button></div>'+
    '<div class="formHint">'+t('gpsHint')+'</div>'+
    '<div id="message">'+(state.msg||'')+'</div>'+
    '<div class="sectionTitle"><h2>'+t('recentAttendance')+'</h2></div>'+
    listItems(state.records,'attendance',t('noAttendance'));
}

function requests(){
  const pendingLeaves=(state.leaves||[]).filter(x=>x.status==='Pending').length;
  const pendingLoans=(state.loans||[]).filter(x=>x.status==='Pending').length;
  return topShell()+
    pageHero('requests',t('requestsTitle'),t('requestsSubtitle'))+
    '<div class="grid2"><button class="quick teal" data-tab="leave">'+iconWrap('leave')+t('leaveRequest')+'</button><button class="quick gold" data-tab="loan">'+iconWrap('loan')+t('loanRequest')+'</button></div>'+
    '<div class="statStrip"><div class="statMini"><div class="label">'+t('pendingLeaves')+'</div><div class="value">'+pendingLeaves+'</div></div><div class="statMini"><div class="label">'+t('pendingLoans')+'</div><div class="value">'+pendingLoans+'</div></div></div>'+
    '<div class="sectionBlock"><div class="sectionTitle"><h2>'+t('leaveRequests')+'</h2></div>'+listItems(state.leaves,'leave',t('noLeaves'))+'</div>'+
    '<div class="sectionBlock"><div class="sectionTitle"><h2>'+t('loanRequests')+'</h2></div>'+listItems(state.loans,'loan',t('noLoans'))+'</div>';
}

function leaveForm(){
  return topShell()+
    pageHero('leave',t('leaveTitle'),t('leaveSubtitle'))+
    '<div class="formCard">'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('leave')+'</span>'+t('leaveType')+'</div><select id="leaveType"><option>'+t('annual')+'</option><option>'+t('sick')+'</option><option>'+t('emergency')+'</option></select>'+
      '<div class="grid2"><div><div class="fieldLabel"><span class="miniIcon">'+svgIcon('calendar')+'</span>'+t('fromDate')+'</div><input id="leaveFrom" type="date" class="input"/></div><div><div class="fieldLabel"><span class="miniIcon">'+svgIcon('calendar')+'</span>'+t('toDate')+'</div><input id="leaveTo" type="date" class="input"/></div></div>'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('document')+'</span>'+t('leaveReason')+'</div><textarea id="leaveReason" placeholder="'+t('leaveReasonPh')+'"></textarea>'+
      '<div class="formHint">'+t('leaveHint')+'</div>'+
      '<button id="submitLeaveBtn" class="btn"><span class="btnIcon">'+svgIcon('requests')+'</span>'+t('submitLeave')+'</button>'+
    '</div><div id="message">'+(state.msg||'')+'</div>';
}

function loanForm(){
  return topShell()+
    pageHero('loan',t('loanTitle'),t('loanSubtitle'))+
    '<div class="formCard">'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('loan')+'</span>'+t('loanAmount')+'</div><input id="loanAmount" type="number" class="input" placeholder="'+t('loanAmountPh')+'"/>'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('calendar')+'</span>'+t('months')+'</div><input id="loanMonths" type="number" class="input" placeholder="'+t('months')+'" value="1"/>'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('document')+'</span>'+t('loanReason')+'</div><textarea id="loanReason" placeholder="'+t('loanReasonPh')+'"></textarea>'+
      '<div class="formHint">'+t('loanHint')+'</div>'+
      '<button id="submitLoanBtn" class="btn gold"><span class="btnIcon">'+svgIcon('loan')+'</span>'+t('submitLoan')+'</button>'+
    '</div><div id="message">'+(state.msg||'')+'</div>';
}

function payroll(){
  const p=(state.payroll||[])[0]||{};
  const rows=[[t('basicSalary'),p.basicSalary],[t('baseAllowances'),p.allowances],[t('extraAllowances'),p.additionalAllowances],[t('bonuses'),p.bonuses??p.monthlyAllowances],[t('overtime'),p.overtimeAmount],[t('loansDeduction'),p.loans],[t('penalties'),p.penalties??p.deductions],[t('absenceDeduction'),p.absenceDeduction]];
  return topShell()+
    pageHero('salary',t('payrollTitle'),t('payrollSubtitle'))+
    '<div class="card salaryHero"><div class="small">'+t('latestNetSalary')+'</div><div class="salaryValue">'+fmtMoney(p.netSalary||0)+'</div><div class="muted">'+esc(p.month||'')+'</div></div>'+
    '<div class="tableLike">'+rows.map(x=>'<div class="row"><b>'+esc(x[0])+'</b><span>'+fmtMoney(x[1])+'</span></div>').join('')+'</div>'+
    '<button id="payslipBtn" class="btn gold"><span class="btnIcon">'+svgIcon('document')+'</span>'+t('viewPayslip')+'</button>'+
    '<button id="payslipPdfBtn" class="btn line"><span class="btnIcon">'+svgIcon('document')+'</span>'+t('downloadPdf')+'</button>'+
    '<div class="sectionTitle"><h2>'+t('payrollHistory')+'</h2></div>'+listItems(state.payroll,'salary',t('noPayroll'));
}

function profile(){
  const av=state.me?.avatarUrl||state.me?.profileImage||'/logo.png';
  const rows=[[t('empCode'),state.me?.employeeCode],[t('department'),state.me?.department],[t('jobTitle'),state.me?.jobTitle],[t('phone'),state.me?.phone],[t('email'),state.me?.email]];
  return topShell()+
    pageHero('profile',t('profileTitle'),t('profileSubtitle'))+
    '<div class="card profileHeader"><img class="profileAvatar" src="'+esc(av)+'"/><div class="profileName">'+esc(state.me?.name||'')+'</div><div class="profileCode">'+esc(state.me?.employeeCode||'')+'</div></div>'+
    '<div class="tableLike">'+rows.map(x=>'<div class="row"><b>'+esc(x[0])+'</b><span>'+esc(x[1]||'-')+'</span></div>').join('')+'</div>';
}

function notifications(){
  const unread=(state.notes||[]).filter(n=>!n.readAt).length;
  return topShell()+
    pageHero('bell',t('notificationsTitle'),t('notificationsSubtitle'))+
    '<div class="statStrip"><div class="statMini"><div class="label">'+t('totalNotifications')+'</div><div class="value">'+(state.notes||[]).length+'</div></div><div class="statMini"><div class="label">'+t('unread')+'</div><div class="value">'+unread+'</div></div></div>'+
    listItems(state.notes,'bell',t('noNotifications'));
}

function settings(){
  return topShell()+
    pageHero('settings',t('settingsTitle'),t('settingsSubtitle'))+
    '<div class="formCard">'+
      '<div class="securityBox">'+t('securityHint')+'</div>'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('settings')+'</span>'+t('currentPassword')+'</div><input id="oldPass" class="input" type="password" placeholder="'+t('currentPassword')+'"/>'+
      '<div class="fieldLabel"><span class="miniIcon">'+svgIcon('check')+'</span>'+t('newPassword')+'</div><input id="newPass" class="input" type="password" placeholder="'+t('newPassword')+'"/>'+
      '<button id="changePassBtn" class="btn"><span class="btnIcon">'+svgIcon('settings')+'</span>'+t('changePassword')+'</button>'+
      '<button id="logoutBtn" class="btn red"><span class="btnIcon">'+svgIcon('exit')+'</span>'+t('logout')+'</button>'+
    '</div><div id="message">'+(state.msg||'')+'</div>';
}

function bottomNav(){
  const items=[['home','home',t('home')],['att','attendance',t('attendance')],['requests','requests',t('requests')],['pay','salary',t('salary')],['settings','settings',t('settings')]];
  return '<div class="bottomNav"><div class="bottomInner">'+items.map(x=>'<button class="navItem '+(state.tab===x[0]?'active':'')+'" data-tab="'+x[0]+'"><span class="nIco">'+svgIcon(x[1])+'</span>'+x[2]+'</button>').join('')+'</div></div>';
}

async function geo(){return new Promise((res,rej)=>navigator.geolocation?navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:12000}):rej(Error(t('browserNoGps'))));}
async function punch(type){
  try{
    setMsg(t('findingLocation'),'info');
    const p=await geo();
    const d=await call(type==='in'?'/api/attendance/check-in':'/api/attendance/check-out',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({type,lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,deviceId:deviceId(),deviceFingerprint:await deviceFingerprint()})});
    setMsg(d.message||t('movementDone'),'ok'); await loadAll(); render();
  }catch(e){setMsg(e.message||t('movementFailed'),'error');}
}
async function submitLeave(){try{await call('/api/employee/leaves',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({type:document.getElementById('leaveType').value,from:document.getElementById('leaveFrom').value,to:document.getElementById('leaveTo').value,reason:document.getElementById('leaveReason').value})});state.tab='requests';setMsg(t('leaveSent'),'ok');await loadAll();render();}catch(e){setMsg(e.message,'error');}}
async function submitLoan(){try{await call('/api/employee/loans',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({amount:document.getElementById('loanAmount').value,months:document.getElementById('loanMonths').value,reason:document.getElementById('loanReason').value})});state.tab='requests';setMsg(t('loanSent'),'ok');await loadAll();render();}catch(e){setMsg(e.message,'error');}}
async function changePassword(){try{await call('/api/employee/change-password',{method:'POST',headers:{...headers(),'Content-Type':'application/json'},body:JSON.stringify({currentPassword:document.getElementById('oldPass').value,newPassword:document.getElementById('newPass').value})});setMsg(t('passwordChanged'),'ok');setTimeout(logout,1200);}catch(e){setMsg(e.message,'error');}}
function logout(){localStorage.removeItem('token');location.reload();}
async function openPayslip(){
  const p=(state.payroll||[])[0]||{};
  if(!p.month){setMsg(t('noPayslip'),'error');return;}
  setMsg(t('loadingPayslip') || 'جاري تحميل كشف الراتب...', 'info');
  try{
    const res = await fetch('/api/employee/payroll/html?month=' + encodeURIComponent(p.month || new Date().toISOString().slice(0,7)), {headers:headers()});
    if(!res.ok) throw new Error(await res.text() || t('openPayslipFailed') || 'تعذر فتح كشف الراتب');
    const html = await res.text();
    const sanitized = html.replace(/<div class="actions">[\s\S]*?<\/div>/, '');
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if(!win){setMsg(t('allowPopups') || 'السماح بالنوافذ المنبثقة لعرض كشف الراتب','error');return;}
    win.document.open();
    win.document.write(sanitized);
    win.document.close();
    setMsg('', 'ok');
  }catch(e){setMsg(e.message || t('openPayslipFailed') || 'تعذر فتح كشف الراتب','error');}
}

function payslipPdfElement(){
  const p=(state.payroll||[])[0]||{};
  const me=state.me||{};
  const div=document.createElement('div');
  div.dir=isEn()?'ltr':'rtl';
  div.style.cssText='width:780px;padding:28px;background:#fff;color:#0f172a;font-family:'+(isEn()?'Arial':'Tahoma')+',sans-serif;line-height:1.7';
  const rows=[[t('basicSalary'),p.basicSalary],[t('baseAllowances'),p.allowances],[t('extraAllowances'),p.additionalAllowances],[t('bonuses'),p.bonuses??p.monthlyAllowances],[t('overtime'),p.overtimeAmount],[t('loansDeduction'),p.loans],[t('penalties'),p.penalties??p.deductions],[t('absenceDeduction'),p.absenceDeduction],[t('netSalary'),p.netSalary]];
  div.innerHTML='<div style="background:#063241;color:white;border-radius:22px;padding:22px;margin-bottom:18px"><h1 style="margin:0;color:#FDBA35">Mahabat HR Pro</h1><p style="margin:6px 0 0">'+t('payrollTitle')+'</p></div>'+ 
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'+
    '<div><b>'+t('employee')+':</b> '+esc(me.name||p.employeeName||'')+'</div><div><b>'+t('code')+':</b> '+esc(me.employeeCode||p.employeeCode||'')+'</div>'+ 
    '<div><b>'+t('department')+':</b> '+esc(me.department||'-')+'</div><div><b>'+t('month')+':</b> '+esc(p.month||'')+'</div></div>'+ 
    '<table style="width:100%;border-collapse:collapse">'+rows.map((r,i)=>'<tr><th style="border:1px solid #D8E7EA;background:'+(i===rows.length-1?'#FDBA35':'#F2FAFB')+';padding:10px;text-align:'+(isEn()?'left':'right')+'">'+esc(r[0])+'</th><td style="border:1px solid #D8E7EA;padding:10px;font-weight:700">'+fmtMoney(r[1])+'</td></tr>').join('')+'</table>'+ 
    '<p style="text-align:center;color:#64748b;margin-top:22px;font-size:12px">'+t('pdfIssued')+'</p>';
  return div;
}
async function downloadPayslipPdfClient(){
  const p=(state.payroll||[])[0]||{};
  if(!p.month){setMsg(t('noPayslip'),'error');return;}
  if(!window.html2pdf){ await openPayslip(); return; }
  const el=payslipPdfElement();
  const opt={margin:8,filename:'salary-'+(p.month||'latest')+'.pdf',image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}};
  await window.html2pdf().set(opt).from(el).save();
}


function applyRealtimeEvent(ev){
  const seq = Number(ev.seq || 0);
  if(seq) localStorage.setItem('mahabatLastSeq', String(seq));
  const t = String(ev.type || '');
  if(t.includes('attendance') || t.includes('payroll') || t.includes('salary') || t.includes('loan') || t.includes('leave') || t.includes('allowance') || t.includes('notification') || t.includes('device-reset')){
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async ()=>{ try{ await loadAll(); render(); }catch(e){ console.warn(e); } }, 400);
  }
}
async function fetchMissedEvents(){
  if(!token()) return;
  const lastSeq = Number(localStorage.getItem('mahabatLastSeq') || 0);
  const data = await call('/api/sync/since?seq=' + encodeURIComponent(lastSeq), {headers:headers()}).catch(()=>null);
  if(data?.events) data.events.forEach(applyRealtimeEvent);
  if(data?.latestSeq) localStorage.setItem('mahabatLastSeq', String(data.latestSeq));
}
let _wsAttempt = 0;
async function connectRealtime(){
  if(!token() || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  const fp = await deviceFingerprint();
  const lastSeq = Number(localStorage.getItem('mahabatLastSeq') || 0);
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(proto + '//' + location.host + '/ws?token=' + encodeURIComponent(token()) + '&deviceFp=' + encodeURIComponent(fp) + '&lastSeq=' + encodeURIComponent(lastSeq));
  ws.onopen = ()=>{ _wsAttempt = 0; };
  ws.onmessage = (e)=>{ try{ applyRealtimeEvent(JSON.parse(e.data)); }catch{} };
  ws.onclose = ()=>{
    if(!token()) return;
    _wsAttempt++;
    const delay = Math.min(30000, 1000 * Math.pow(1.7, Math.min(_wsAttempt, 8)));
    setTimeout(connectRealtime, delay);
  };
  ws.onerror = ()=>{ try{ ws.close(); }catch{} };
}

function attachEvents(){
  document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => { state.tab = btn.getAttribute('data-tab'); render(); }));
  const inBtn=document.getElementById('checkInBtn'); if(inBtn) inBtn.addEventListener('click',()=>punch('in'));
  const outBtn=document.getElementById('checkOutBtn'); if(outBtn) outBtn.addEventListener('click',()=>punch('out'));
  const leaveBtn=document.getElementById('submitLeaveBtn'); if(leaveBtn) leaveBtn.addEventListener('click',submitLeave);
  const loanBtn=document.getElementById('submitLoanBtn'); if(loanBtn) loanBtn.addEventListener('click',submitLoan);
  const payBtn=document.getElementById('payslipBtn'); if(payBtn) payBtn.addEventListener('click',openPayslip);
  const payPdfBtn=document.getElementById('payslipPdfBtn'); if(payPdfBtn) payPdfBtn.addEventListener('click',downloadPayslipPdfClient);
  const ch=document.getElementById('changePassBtn'); if(ch) ch.addEventListener('click',changePassword);
  const lo=document.getElementById('logoutBtn'); if(lo) lo.addEventListener('click',logout);
  const lang=document.getElementById('langToggle'); if(lang) lang.addEventListener('click', toggleLocale);
}

function render(){
  clearRoot('app');
  let html = home();
  if(state.tab==='att') html=attendance();
  if(state.tab==='requests') html=requests();
  if(state.tab==='leave') html=leaveForm();
  if(state.tab==='loan') html=loanForm();
  if(state.tab==='pay') html=payroll();
  if(state.tab==='profile') html=profile();
  if(state.tab==='notifications') html=notifications();
  if(state.tab==='settings') html=settings();
  root.innerHTML = html + bottomNav();
  attachEvents();
}

async function boot(){
  try{
    if('serviceWorker' in navigator){
      const regs = await navigator.serviceWorker.getRegistrations().catch(()=>[]);
      regs.forEach(r => r.unregister().catch(()=>{}));
    }
    restoreCache();
    const urlEmp = new URLSearchParams(location.search).get('emp');
    if(urlEmp && !token()){ renderLogin(urlEmp); return; }
    if(token()){ await deviceFingerprint(); await fetchMissedEvents(); await loadAll(); render(); connectRealtime(); }
    else renderLogin();
  }catch(e){
    console.error(e);
    if(/انتهت الجلسة|401|unauthorized|غير مصرح/i.test(e.message||'')){ localStorage.removeItem('token'); renderLogin('',smartMessage(e.message||t('sessionExpired'))); }
    else { state.msg='<div class="msg error">'+esc(smartMessage(e.message||t('loadFailed')))+'</div>'; render(); }
  }
}

function updateOnline(){document.getElementById('offline').classList.toggle('show',!navigator.onLine);}
window.addEventListener('online',()=>{updateOnline(); if(token()) loadAll().then(render).catch(()=>{});});
window.addEventListener('offline',updateOnline);
window.addEventListener('error', e => { console.error(e); if(root && !root.innerHTML.trim()) root.innerHTML='<div class="card"><div class="msg error">'+esc(smartMessage(e.message||t('loadFailed')))+'</div></div>'; });
updateOnline();
setInterval(()=>{const a=document.activeElement, typing=a&&['INPUT','TEXTAREA','SELECT'].includes(a.tagName); if(token()&&!typing&&navigator.onLine) loadAll().then(render).catch(()=>{});},30000);
boot();

window.__portalDebug = { testPortalConnection, doLogin, state };
})();
