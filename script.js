const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";
const PENDING_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb0IS8xfC3oSGv4ObldRMnFjgFIYeW4Lh8iFCJtO9UZQskk0VqhdBrUq3ZWg9LiFOzlA/exec";
const STUDENTS_DB_URL = "https://script.google.com/macros/s/AKfycbx35GjixD83S6R69c2mnA9KvgG93I0PX-yrIDdokwLRzaTTkd9fRR3fwuyHRWLUJDK5/exec";
const gradesData = {
    "ابتدائي":        ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "ابتدائي لغات":   ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "اعدادي":         ["الأول", "الثاني", "الثالث"],
    "اعدادي لغات":    ["الأول", "الثاني", "الثالث"],
    "ثانوي":          ["الأول", "الثاني", "الثالث"],
    "ثانوي لغات":     ["الأول", "الثاني", "الثالث"]
};

/* ===================================================
   تحويل الأرقام العربية/الشرقية إلى أرقام إنجليزية
   يدعم: ٠١٢٣٤٥٦٧٨٩ (عربي) + ۰۱۲۳۴۵۶۷۸۹ (فارسي)
   =================================================== */
function toEnglishNumerals(str) {
    if (!str) return '';
    return str
        .replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632) // عربي شرقي
        .replace(/[۰-۹]/g, d => d.charCodeAt(0) - 1776) // فارسي
        .replace(/[^\d.]/g, '');                          // احذف أي حرف غير رقمي
}

/**
   توحيد الأسماء المركبة (عبد الله -> عبدالله)
*/
function normalizeArabicName(name) {
    if (!name) return "";
    let str = name.toString().trim().replace(/[\u064B-\u065F\u0640]/g, '');
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
    str = str.replace(/[إأآٱ]/g, 'ا').replace(/ة\b/g, 'ه').replace(/[ىي]/g, 'ي');
    return str.replace(/\s+/g, ' ').trim();
}

function displayNormalizedName(name) {
    if (!name) return "";
    let str = name.toString().trim().replace(/\s+/g, ' ');
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
    return str;
}

/**
 * بيتحول المبلغ مباشرةً وهو بيكتب
 * @param {HTMLInputElement} input
 */
function convertAmountToEnglish(input) {
    var pos = input.selectionStart;
    var converted = toEnglishNumerals(input.value);
    input.value = converted;
    // المحافظة على موضع cursor بعد التحويل
    try { input.setSelectionRange(pos, pos); } catch(_) {}
}

/* ===================================================
   طابور الطلبات – يضمن إرسال بيانات التحصيل بالترتيب
   عند التزامن بين أكثر من مستخدم في نفس الوقت
   =================================================== */
const _txQueue = { pending: [], running: false };

function enqueueTransaction(fn) {
    return new Promise((resolve, reject) => {
        _txQueue.pending.push({ fn, resolve, reject });
        if (!_txQueue.running) _drainTxQueue();
    });
}

async function _drainTxQueue() {
    if (_txQueue.running || _txQueue.pending.length === 0) return;
    _txQueue.running = true;
    const { fn, resolve, reject } = _txQueue.pending.shift();
    try {
        resolve(await fn());
    } catch (err) {
        reject(err);
    } finally {
        _txQueue.running = false;
        _drainTxQueue();
    }
}

/**
 * يرسل طلب fetch مع إعادة المحاولة تلقائياً عند الفشل
 * المحاولات: 3  –  الانتظار بين المحاولات: 1 ث / 2 ث / 4 ث
 */
/**
 * يرسل طلب fetch فائق السرعة مع Timeout ذكي لمنع التعليق
 */
async function fetchWithRetry(url, options = {}, maxRetries = 2, timeoutMs = 12000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const fetchOpts = { ...options, signal: controller.signal };
            const response = await fetch(url, fetchOpts);
            clearTimeout(timeoutId);

            if (response.status === 429 || response.status === 503) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (err) {
            clearTimeout(timeoutId);
            lastError = err;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 600)); // محاولة ثانية سريعة
            }
        }
    }
    throw lastError;
}

/* ===================================================
   إدارة الوضع الليلي / النهاري (Dark / Light Mode)
   =================================================== */
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(theme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        const icon = btn.querySelector('i');
        const text = btn.querySelector('span');
        if (icon && text) {
            if (theme === 'dark') {
                icon.className = 'fa-solid fa-sun';
                icon.style.color = '#f59e0b';
                text.textContent = 'الوضع النهاري';
            } else {
                icon.className = 'fa-solid fa-moon';
                icon.style.color = '';
                text.textContent = 'الوضع الليلي';
            }
        }
    });
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
}

// تفعيل الثيم تلقائياً
initTheme();

/* ===================================================
   نظام الإشعارات الحديث (Toast Notifications)
   =================================================== */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        alert(message);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'danger') iconClass = 'fa-circle-xmark';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3800);
}

/* ===================================================
   إدارة شاشات الدخول والصلاحيات (طالب / إدارة)
   =================================================== */
function checkCurrentSession() {
    const role = sessionStorage.getItem('userRole');
    if (role === 'admin' || role === 'student') {
        enterDashboard(role);
    } else {
        showWelcomeScreen();
    }
}

function showWelcomeScreen() {
    const welcome = document.getElementById('welcomeScreen');
    const mainApp = document.getElementById('mainAppScreen');
    const modal = document.getElementById('adminLoginModal');
    
    if (welcome) welcome.style.display = 'block';
    if (mainApp) mainApp.style.display = 'none';
    if (modal) modal.style.display = 'none';
}

function loginAsStudent() {
    sessionStorage.setItem('userRole', 'student');
    enterDashboard('student');
    showToast("مرحباً بك! تم الدخول كطالب لدفع المصروفات.", "info");
}

function openAdminLoginModal() {
    const modal = document.getElementById('adminLoginModal');
    if (modal) {
        modal.style.display = 'flex';
        const userInput = document.getElementById('adminUsername');
        if (userInput) userInput.focus();
    }
}

function closeAdminLoginModal() {
    const modal = document.getElementById('adminLoginModal');
    if (modal) modal.style.display = 'none';
    const pwdInput = document.getElementById('adminPassword');
    if (pwdInput) pwdInput.value = '';
}

/* ===================================================
   إدارة نوافذ الدفع الإلكتروني (انستا باي وفودافون كاش)
   =================================================== */
function calculateCurrentRequiredTotal() {
    if (isMultiTeacherMode) {
        let total = 0;
        currentStudentTeachers.forEach((_, idx) => {
            const check = document.getElementById(`teacherCheck_${idx}`);
            const amountInput = document.getElementById(`teacherAmount_${idx}`);
            if (check && check.checked && amountInput && amountInput.value) {
                const amt = parseFloat(toEnglishNumerals(amountInput.value));
                if (!isNaN(amt)) total += amt;
            }
        });
        return total;
    } else {
        const amtInput = document.getElementById("amount");
        if (amtInput && amtInput.value) {
            const amt = parseFloat(toEnglishNumerals(amtInput.value));
            return isNaN(amt) ? 0 : amt;
        }
        return 0;
    }
}

function openInstapayModal() {
    const modal = document.getElementById('instapayModal');
    if (modal) modal.style.display = 'flex';
}

function closeInstapayModal() {
    const modal = document.getElementById('instapayModal');
    if (modal) modal.style.display = 'none';
}

function openVodafoneModal() {
    const modal = document.getElementById('vodafoneModal');
    if (modal) {
        // تحديث إجمالي المبلغ المطلوب دفعه في النافذة
        const reqEl = document.getElementById('vodafoneRequiredAmount');
        if (reqEl) {
            const total = calculateCurrentRequiredTotal();
            reqEl.textContent = total > 0 ? `${total.toLocaleString('en-US')} ج.م` : "غير محدد بعد";
        }
        modal.style.display = 'flex';
    }
}

function closeVodafoneModal() {
    const modal = document.getElementById('vodafoneModal');
    if (modal) modal.style.display = 'none';
}

function copyVodafoneNumber() {
    const num = "01010692410";
    navigator.clipboard.writeText(num).then(() => {
        const copyIcon = document.getElementById('copyIcon');
        const copyText = document.getElementById('copyText');
        if (copyIcon && copyText) {
            copyIcon.className = 'fa-solid fa-check';
            copyText.textContent = 'تم النسخ';
            setTimeout(() => {
                copyIcon.className = 'fa-solid fa-copy';
                copyText.textContent = 'نسخ';
            }, 2500);
        }
        showToast("تم نسخ رقم فودافون كاش بنجاح!", "success");
    }).catch(() => {
        showToast("رقم التحويل: 01010692410", "info");
    });
}

function confirmPaymentAndClose() {
    closeVodafoneModal();
    showToast("تم تأكيد الدفع! يرجى رفع صورة إيصال التحويل لحفظ المعاملة.", "info");
    const receiptInput = document.getElementById('receiptFile');
    if (receiptInput) {
        receiptInput.focus();
        receiptInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

function handleModalOverlayClick(e, modalId) {
    if (e.target && e.target.id === modalId) {
        document.getElementById(modalId).style.display = 'none';
    }
}

function togglePasswordVisibility() {
    const pwdInput = document.getElementById('adminPassword');
    const icon = document.getElementById('pwdToggleIcon');
    if (pwdInput && icon) {
        if (pwdInput.type === 'password') {
            pwdInput.type = 'text';
            icon.className = 'fa-solid fa-eye-slash';
        } else {
            pwdInput.type = 'password';
            icon.className = 'fa-solid fa-eye';
        }
    }
}

function handleAdminLogin(event) {
    if (event) event.preventDefault();
    
    const userInput = document.getElementById('adminUsername');
    const pwdInput = document.getElementById('adminPassword');
    const username = userInput ? userInput.value.trim() : '';
    const password = pwdInput ? pwdInput.value.trim() : '';

    // التحقق من بيانات الدخول الثابتة
    if (username.toLowerCase() === 'admin' && password === 'Admin@1122') {
        closeAdminLoginModal();
        sessionStorage.setItem('userRole', 'admin');
        enterDashboard('admin');
        showToast("تم تسجيل الدخول بنجاح! مرحباً بالإدارة.", "success");
    } else {
        const modalCard = document.getElementById('adminModalCard');
        if (modalCard) {
            modalCard.classList.remove('shake');
            void modalCard.offsetWidth; // إعادة تشغيل الأنيميشن
            modalCard.classList.add('shake');
        }
        showToast("خطأ: اسم المستخدم أو كلمة المرور غير صحيحة!", "danger");
        if (pwdInput) {
            pwdInput.value = '';
            pwdInput.focus();
        }
    }
}

function enterDashboard(role) {
    const welcome = document.getElementById('welcomeScreen');
    const mainApp = document.getElementById('mainAppScreen');
    const roleBadge = document.getElementById('userRoleBadge');

    if (welcome) welcome.style.display = 'none';
    if (mainApp) mainApp.style.display = 'block';

    const adminSections = document.querySelectorAll('.admin-only');

    if (role === 'student') {
        adminSections.forEach(sec => sec.style.display = 'none');

        if (roleBadge) {
            roleBadge.innerHTML = '<span class="user-role-badge badge-student"><i class="fa-solid fa-user-graduate"></i> وضع الطالب</span>';
        }
    } else if (role === 'admin') {
        adminSections.forEach(sec => {
            if (sec.classList.contains('flex-row')) {
                sec.style.display = 'flex';
            } else {
                sec.style.display = 'block';
            }
        });

        if (roleBadge) {
            roleBadge.innerHTML = '<span class="user-role-badge badge-admin"><i class="fa-solid fa-user-shield"></i> لوحة الإدارة</span>';
        }
    }

    // تحميل المعلمين والطلاب من الشيت وتعيين الوقت الحالي
    loadTeachers();
    loadStudentsDatabase();
    initStudentAutocomplete();
    setDefaultDateTime();
}

function logout() {
    sessionStorage.removeItem('userRole');
    showWelcomeScreen();
    showToast("تم تسجيل الخروج بنجاح والعودة للرئيسية.", "info");
}

/* ===================================================
   دوال الواجهة ومعالجة البيانات
   =================================================== */
function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
        overlay.style.display = show ? "flex" : "none";
    }
}

// ضبط الوقت والتاريخ الحاليين تلقائياً عند فتح الصفحة
function setDefaultDateTime() {
    const dateInput = document.getElementById("dateTime");
    if (dateInput && !dateInput.value) {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        dateInput.value = now.toISOString().slice(0, 16);
    }
}

function updateGrades(catId, gradeId) {
    const cat = document.getElementById(catId).value;
    const select = document.getElementById(gradeId);
    select.innerHTML = '<option value="">-- اختر الصف أولاً --</option>';
    if (cat && gradesData[cat]) {
        gradesData[cat].forEach(g => {
            select.appendChild(new Option(g, g));
        });
    }
}

let allTeachersList = [];
let allStudentsList = [];

function populateTeacherSelects(list) {
    const selects = [
        document.getElementById("teacherSelect"),
        document.getElementById("clearTeacherSelect"),
        document.getElementById("deleteTeacherSelect")
    ];
    selects.forEach(s => {
        if (s) {
            const currentVal = s.value;
            s.innerHTML = '<option value="">-- اختر المعلم --</option>';
            list.forEach(t => s.add(new Option(t, t)));
            if (currentVal && list.includes(currentVal)) s.value = currentVal;
        }
    });
}

async function loadTeachers(forceRefresh = false) {
    // 1. استخدام الكاش المحلي فوراً (0 ثانية انتظار)
    const cached = localStorage.getItem('center_teachers_cache');
    if (cached) {
        try {
            allTeachersList = JSON.parse(cached);
            populateTeacherSelects(allTeachersList);
        } catch(_) {}
    }

    // إذا لم تكن البيانات بالكاش أو طُلب التحديث الصريح، نظهر مؤشر خفيف
    const needSpinner = (!cached || forceRefresh) && allTeachersList.length === 0;
    if (needSpinner) showLoading(true);

    try {
        const res = await fetch(`${SCRIPT_URL}?t=${Date.now()}`);
        const teachers = await res.json();
        if (Array.isArray(teachers) && teachers.length > 0) {
            allTeachersList = teachers;
            localStorage.setItem('center_teachers_cache', JSON.stringify(allTeachersList));
            populateTeacherSelects(allTeachersList);
        }
    } catch (e) {
        if (allTeachersList.length === 0) {
            showToast("تعذر جلب قائمة المعلمين حالياً، جاري استخدام البيانات المحفوظة.", "warning");
        }
    } finally {
        if (needSpinner) showLoading(false);
    }
}

/* ===================================================
   تحميل قاعدة بيانات الطلاب للإكمال التلقائي
   =================================================== */
async function loadStudentsDatabase() {
    // محاولة جلبها من التخزين المؤقت المحلي أولاً لسرعة الاستجابة
    const cached = localStorage.getItem('center_students_db_cache');
    if (cached) {
        try {
            allStudentsList = JSON.parse(cached);
        } catch(_) {}
    }

    try {
        const res = await fetch(STUDENTS_DB_URL);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            allStudentsList = data.map((item, idx) => ({
                id: item.id || idx,
                studentName: (item.studentName || item.name || '').trim(),
                teacherName: (item.teacherName || item.teacher || '').trim(),
                category: (item.category || '').trim(),
                grade: (item.grade || '').trim()
            })).filter(s => s.studentName);

            localStorage.setItem('center_students_db_cache', JSON.stringify(allStudentsList));
        }
    } catch (e) {
        console.warn("Could not fetch remote students database, using cached/local if available", e);
    }
}

/* ===================================================
   إدارة واجهة تحصيل الطلاب المتعددين للمعلمين (Multi-Teacher Payment Logic)
   =================================================== */
let currentStudentTeachers = []; // قائمة مدرسي الطالب المختار
let isMultiTeacherMode = false;  // حالة تفعيل التحصيل المجمع
let currentSelectedStudentMeta = null; // بيانات الطالب المختار المحددة بدقة { studentName, category, grade }

/**
 * جلب جميع المدرسين المسجلين لطالب معين بدقة:
 * المطابقة تتم بناءً على: (اسم الطالب + الفئة الدراسية + الصف الدراسي)
 * لمنع تداخل الطلاب المتشابهين في الأسماء عبر المراحل والصفوف المختلفة
 */
function getTeachersForStudent(studentName, category, grade) {
    if (!studentName) return [];
    const norm = normalizeArabicName(studentName);
    const normCat = (category || '').trim();
    const normGrd = (grade || '').trim();

    const matches = allStudentsList.filter(s => {
        const matchName = normalizeArabicName(s.studentName) === norm;
        if (!matchName) return false;
        
        // إذا تم تمرير الفئة والصف، يجب تطابقهما بدقة متناهية
        if (normCat && (s.category || '').trim() !== normCat) return false;
        if (normGrd && (s.grade || '').trim() !== normGrd) return false;
        
        return true;
    });
    
    // استبعاد التكرارات لنفس المدرس في نفس الفرقة
    const uniqueMap = new Map();
    matches.forEach(item => {
        const t = (item.teacherName || '').trim();
        if (t && !uniqueMap.has(t)) {
            uniqueMap.set(t, item);
        }
    });
    return Array.from(uniqueMap.values());
}

/**
 * عرض كروت المدرسين التفاعلية عند اختيار الطالب المحدد (اسماً وفئةً وصفاً)
 */
function setupStudentTeachersUI(studentName, category, grade) {
    const multiContainer = document.getElementById("multiTeachersContainer");
    const singleSection = document.getElementById("singleTeacherSection");
    const manualSwitchRow = document.getElementById("manualSwitchBackRow");
    const countBadge = document.getElementById("multiTeacherCountBadge");
    const listEl = document.getElementById("multiTeachersList");
    
    if (!multiContainer || !listEl) return;

    currentSelectedStudentMeta = { studentName, category, grade };
    currentStudentTeachers = getTeachersForStudent(studentName, category, grade);

    // إذا كان الطالب مسجلاً لدى أكثر من مدرس في هذه المرحلة والصف
    if (currentStudentTeachers.length > 1) {
        isMultiTeacherMode = true;
        multiContainer.style.display = "block";
        if (singleSection) singleSection.style.display = "none";
        if (manualSwitchRow) manualSwitchRow.style.display = "none";
        if (countBadge) countBadge.textContent = `${currentStudentTeachers.length} معلمين • (${category} - ${grade})`;

        // رسم كروت المعلمين
        renderMultiTeacherCards(currentStudentTeachers);
        updateMultiPaymentSummary();
    } else if (currentStudentTeachers.length === 1) {
        // إذا كان مسجلاً لدى مدرس واحد فقط: تفعيل النمط الفردي وتعبئة بياناته تلقائياً
        isMultiTeacherMode = false;
        multiContainer.style.display = "none";
        if (singleSection) singleSection.style.display = "block";
        if (manualSwitchRow) manualSwitchRow.style.display = "none";

        const single = currentStudentTeachers[0];
        fillSingleTeacherFields(single.teacherName, single.category || category, single.grade || grade);
    } else {
        // طالب غير مسجل مسبقاً (زائر): الاعتماد على النمط الفردي
        isMultiTeacherMode = false;
        multiContainer.style.display = "none";
        if (singleSection) singleSection.style.display = "block";
        if (manualSwitchRow) manualSwitchRow.style.display = "none";

        if (category || grade) {
            fillSingleTeacherFields("", category, grade);
        }
    }
}

/**
 * إلغاء الدفع الجماعي والرجوع فوراً للدفع الفردي مع تعبئة بيانات الطالب والمدرس الأول
 */
function cancelMultiAndReturnToSingle() {
    isMultiTeacherMode = false;
    const multiContainer = document.getElementById("multiTeachersContainer");
    const singleSection = document.getElementById("singleTeacherSection");
    const manualSwitchRow = document.getElementById("manualSwitchBackRow");
    const backCount = document.getElementById("backToTeachersCount");

    if (multiContainer) multiContainer.style.display = "none";
    if (singleSection) singleSection.style.display = "block";
    
    // إتاحة زر الرجوع للدفع الجماعي إن رغب
    if (manualSwitchRow) {
        manualSwitchRow.style.display = "flex";
        if (backCount) backCount.textContent = currentStudentTeachers.length;
    }

    // تعبئة الفئة والصف الدراسي للطالب تلقائياً في القسم الفردي
    if (currentSelectedStudentMeta) {
        fillSingleTeacherFields(
            (currentStudentTeachers.length > 0 ? currentStudentTeachers[0].teacherName : ""),
            currentSelectedStudentMeta.category,
            currentSelectedStudentMeta.grade
        );
    }

    showToast("تم إلغاء الدفع الجماعي والتحويل للدفع الفردي.", "info");
}

/**
 * تعبئة حقول المعلم الفردي
 */
function fillSingleTeacherFields(teacherName, category, grade) {
    if (teacherName) {
        const teacherSel = document.getElementById("teacherSelect");
        if (teacherSel) {
            let found = Array.from(teacherSel.options).some(o => o.value === teacherName);
            if (!found) {
                teacherSel.add(new Option(teacherName, teacherName));
            }
            teacherSel.value = teacherName;
        }
    }

    if (category) {
        const catSel = document.getElementById("categorySelect");
        if (catSel) {
            catSel.value = category;
            updateGrades('categorySelect', 'gradeSelect');
        }
    }

    if (grade) {
        const gradeSel = document.getElementById("gradeSelect");
        if (gradeSel) {
            gradeSel.value = grade;
        }
    }
}

/**
 * رسم بطاقات المعلمين بالـ HTML
 */
function renderMultiTeacherCards(teachers) {
    const listEl = document.getElementById("multiTeachersList");
    if (!listEl) return;

    listEl.innerHTML = teachers.map((item, idx) => `
        <div class="teacher-pay-card active" id="teacherCard_${idx}">
            <div class="teacher-pay-info">
                <input type="checkbox" id="teacherCheck_${idx}" class="teacher-check-input" checked onchange="handleTeacherCheckChange(${idx})">
                <div class="teacher-details">
                    <span class="teacher-name-txt"><i class="fa-solid fa-chalkboard-user"></i> أ/ ${item.teacherName}</span>
                    <span class="teacher-grade-tag"><b>${item.category || 'غير محدد'}</b> • (${item.grade || 'غير محدد'})</span>
                </div>
            </div>
            <div class="teacher-pay-amount-box">
                <input type="text" id="teacherAmount_${idx}" placeholder="المبلغ" value="" inputmode="numeric" 
                       data-teacher="${item.teacherName}" 
                       data-category="${item.category || ''}" 
                       data-grade="${item.grade || ''}"
                       oninput="convertAmountToEnglish(this); updateMultiPaymentSummary();">
                <span class="currency-label">جنيه</span>
            </div>
        </div>
    `).join('');

    const quickAmount = document.getElementById("quickUnifiedAmount");
    if (quickAmount) quickAmount.focus();
}

/**
 * عند تغيير حالة الـ Checkbox لمعلم
 */
function handleTeacherCheckChange(idx) {
    const check = document.getElementById(`teacherCheck_${idx}`);
    const card = document.getElementById(`teacherCard_${idx}`);
    const amountInput = document.getElementById(`teacherAmount_${idx}`);

    if (check && card) {
        if (check.checked) {
            card.classList.add('active');
            if (amountInput) amountInput.disabled = false;
        } else {
            card.classList.remove('active');
            if (amountInput) {
                amountInput.disabled = true;
            }
        }
    }
    updateMultiPaymentSummary();
}

/**
 * تحديد أو إلغاء تحديد جميع المدرسين
 */
function toggleSelectAllTeachers(select) {
    currentStudentTeachers.forEach((_, idx) => {
        const check = document.getElementById(`teacherCheck_${idx}`);
        const card = document.getElementById(`teacherCard_${idx}`);
        const amountInput = document.getElementById(`teacherAmount_${idx}`);
        if (check) {
            check.checked = select;
            if (card) {
                if (select) card.classList.add('active');
                else card.classList.remove('active');
            }
            if (amountInput) amountInput.disabled = !select;
        }
    });
    updateMultiPaymentSummary();
}

/**
 * تطبيق مبلغ موحد على جميع المدرسين المحددين بنقرة واحدة
 */
function applyUnifiedAmountToSelected() {
    const unifiedInput = document.getElementById("quickUnifiedAmount");
    const val = unifiedInput ? unifiedInput.value.trim() : "";
    if (!val || isNaN(val) || Number(val) <= 0) {
        showToast("يرجى إدخال مبلغ صحيح لتطبيقه على المعلمين!", "warning");
        if (unifiedInput) unifiedInput.focus();
        return;
    }

    let appliedCount = 0;
    currentStudentTeachers.forEach((_, idx) => {
        const check = document.getElementById(`teacherCheck_${idx}`);
        const amountInput = document.getElementById(`teacherAmount_${idx}`);
        if (check && check.checked && amountInput) {
            amountInput.value = val;
            appliedCount++;
        }
    });

    updateMultiPaymentSummary();
    showToast(`تم تطبيق مبلغ ${val} جنيه على (${appliedCount}) معلمين بنجاح.`, "info");
}

/**
 * تحديث شريط الملخص المالي اللحظي
 */
function updateMultiPaymentSummary() {
    let total = 0;
    let selectedCount = 0;

    currentStudentTeachers.forEach((_, idx) => {
        const check = document.getElementById(`teacherCheck_${idx}`);
        const amountInput = document.getElementById(`teacherAmount_${idx}`);
        if (check && check.checked) {
            selectedCount++;
            if (amountInput && amountInput.value) {
                const amt = parseFloat(toEnglishNumerals(amountInput.value));
                if (!isNaN(amt)) total += amt;
            }
        }
    });

    const countEl = document.getElementById("summarySelectedCount");
    const totalEl = document.getElementById("summaryTotalAmount");
    if (countEl) countEl.textContent = selectedCount;
    if (totalEl) totalEl.textContent = total.toLocaleString('en-US');
}

/**
 * التبديل اليدوي لاختيار مدرس فردي من القائمة العامة
 */
function switchToManualSingleTeacher() {
    isMultiTeacherMode = false;
    const multiContainer = document.getElementById("multiTeachersContainer");
    const singleSection = document.getElementById("singleTeacherSection");
    const manualSwitchRow = document.getElementById("manualSwitchBackRow");
    const backCount = document.getElementById("backToTeachersCount");

    if (multiContainer) multiContainer.style.display = "none";
    if (singleSection) singleSection.style.display = "block";
    if (manualSwitchRow) {
        manualSwitchRow.style.display = "flex";
        if (backCount) backCount.textContent = currentStudentTeachers.length;
    }
}

/**
 * العودة لقسم المعلمين المتعددين
 */
function reopenMultiTeachersSection() {
    if (currentStudentTeachers.length > 1) {
        isMultiTeacherMode = true;
        const multiContainer = document.getElementById("multiTeachersContainer");
        const singleSection = document.getElementById("singleTeacherSection");
        const manualSwitchRow = document.getElementById("manualSwitchBackRow");

        if (multiContainer) multiContainer.style.display = "block";
        if (singleSection) singleSection.style.display = "none";
        if (manualSwitchRow) manualSwitchRow.style.display = "none";
    }
}

/* ===================================================
   تفعيل نظام الإكمال التلقائي الذكي لاسم الطالب
   يفصل بين الطلاب المتشابهين في الاسم حسب الفئة والصف الدراسي
   =================================================== */
function initStudentAutocomplete() {
    const input = document.getElementById("studentName");
    const dropdown = document.getElementById("studentNameDropdown");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        const query = this.value.trim().toLowerCase();
        if (!query) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        // تصفية الطلاب المطابقين لكلمة البحث بذكاء مع دعم الأسماء المركبة
        const normQuery = normalizeArabicName(query);
        
        // تجميع النتائج حسب المفتاح الفريد: (اسم الطالب + الفئة الدراسية + الصف الدراسي)
        // لمنع تداخل الطلاب الذين يحملون نفس الاسم في صفوف أو مراحل مختلفة!
        const studentsGroupMap = new Map();
        allStudentsList.forEach(item => {
            const normStudent = normalizeArabicName(item.studentName);
            if (normStudent.includes(normQuery)) {
                const cat = (item.category || '').trim();
                const grd = (item.grade || '').trim();
                const uniqueStudentKey = `${normStudent}___${cat}___${grd}`;

                if (!studentsGroupMap.has(uniqueStudentKey)) {
                    studentsGroupMap.set(uniqueStudentKey, {
                        displayName: displayNormalizedName(item.studentName),
                        category: cat,
                        grade: grd,
                        records: []
                    });
                }
                studentsGroupMap.get(uniqueStudentKey).records.push(item);
            }
        });

        const groups = Array.from(studentsGroupMap.values());

        if (groups.length === 0) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        // عرض أول 8 اقتراحات كحد أقصى لمنع ازدحام القائمة
        const topMatches = groups.slice(0, 8);
        dropdown.innerHTML = topMatches.map((group, idx) => {
            // المعلمون المسجلون مع هذا الطالب في هذه المرحلة والصف فقط
            const teachersText = group.records.map(r => r.teacherName).filter(Boolean).slice(0, 3).join('، ');
            const moreText = group.records.length > 3 ? '...' : '';
            const count = group.records.length;

            return `
            <div class="autocomplete-item" data-idx="${idx}">
                <div class="autocomplete-item-info">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <strong><i class="fa-solid fa-user-check" style="color: #10b981; margin-left: 6px;"></i>${highlightMatch(group.displayName, query)}</strong>
                        <span style="background: rgba(99,102,241,0.12); color: #6366f1; padding: 2px 8px; border-radius: 12px; font-weight: 700; font-size: 11px;">
                            ${count > 1 ? `<i class="fa-solid fa-users"></i> ${count} معلمين` : '<i class="fa-solid fa-user"></i> معلم واحد'}
                        </span>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 3px; font-size: 12px;">
                        <span style="color: var(--text-muted);"><i class="fa-solid fa-chalkboard-user"></i> معلموه: <b style="color: var(--text-title);">${teachersText}${moreText}</b></span>
                        <span style="background: rgba(16,185,129,0.12); color: #059669; padding: 2px 8px; border-radius: 8px; font-weight: 700; font-size: 11.5px;">
                            <i class="fa-solid fa-graduation-cap"></i> ${group.category} - ${group.grade}
                        </span>
                    </div>
                </div>
                <i class="fa-solid fa-arrow-turn-down-left" style="color: #6366f1; font-size: 11px;"></i>
            </div>
            `;
        }).join('');

        dropdown.style.display = "block";

        // إضافة أحداث النقر لاختيار الطالب المحدد بمرحلته وصفه
        dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
            item.addEventListener("click", function() {
                const selectedGroup = topMatches[parseInt(this.getAttribute("data-idx"))];
                if (!selectedGroup) return;

                input.value = selectedGroup.displayName;
                dropdown.style.display = "none";

                // تجهيز واجهة المعلمين للطالب المختار حصرًا في مرحلته وصفه الدراسي!
                setupStudentTeachersUI(selectedGroup.displayName, selectedGroup.category, selectedGroup.grade);
            });
        });
    });

    // إغلاق القائمة عند النقر خارجها
    document.addEventListener("click", function(e) {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });
}

function highlightMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span style="color: #6366f1; text-decoration: underline; font-weight: 800;">$1</span>');
}

async function addTeacher() {
    const input = document.getElementById("newTeacherName");
    const name = input ? input.value.trim() : "";
    if (!name) {
        showToast("يرجى كتابة اسم المعلم أولاً!", "warning");
        if (input) input.focus();
        return;
    }
    showLoading(true);
    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: "addTeacher", teacherName: name })
        });
        showToast(`تمت إضافة الأستاذ/ ${name} بنجاح!`, "success");
        if (input) input.value = "";
        await loadTeachers();
    } catch (e) {
        showToast("حدث خطأ أثناء إضافة المعلم.", "danger");
    }
    showLoading(false);
}

// دالة حذف المعلم
async function deleteTeacher() {
    const select = document.getElementById("deleteTeacherSelect");
    const name = select ? select.value : "";
    if (!name) {
        showToast("يرجى اختيار المعلم المراد حذفه!", "warning");
        return;
    }

    if (confirm(`⚠️ تحذير خطير!\nهل أنت متأكد من حذف الأستاذ/ ${name} نهائياً؟\nسيتم مسح اسمه، وكل معاملاته، والصفحة الخاصة به من جوجل شيت.`)) {
        showLoading(true);
        try {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ action: "deleteTeacher", teacherName: name })
            });
            showToast(`تم حذف المعلم ${name} وجميع بياناته بنجاح!`, "success");
            await loadTeachers();
        } catch (e) {
            showToast("حدث خطأ أثناء محاولة الحذف.", "danger");
        }
        showLoading(false);
    }
}

/**
 * ضغط وتطبيع صورة الإيصال لتحويلها إلى JPEG خفيف (أقل من 250KB)
 * يضمن سرعة الرفع الفائقة بنسبة 100% ومنع أخطاء مهلة الخادم وحجم الحمولة
 */
/**
 * ضغط وتطبيع صورة الإيصال لتحويلها إلى JPEG خفيف وسريع جداً (80-120KB)
 * يضمن سرعة الرفع الفائقة في أقل من نصف ثانية
 */
function compressReceiptImage(file, maxDimension = 1000, quality = 0.70) {
    return new Promise((resolve) => {
        if (!file) return resolve({ base64: "", mimeType: "", fileName: "" });

        const reader = new FileReader();
        reader.onerror = () => resolve({ base64: "", mimeType: "", fileName: "" });
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = () => {
                const parts = (e.target.result || "").split(",");
                resolve({ base64: parts[1] || "", mimeType: file.type || "image/jpeg", fileName: file.name || "receipt.jpg" });
            };
            img.onload = () => {
                let width = img.width;
                let height = img.height;

                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }

                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0, width, height);

                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                const base64 = dataUrl.split(",")[1];
                const safeName = (file.name || "receipt.jpg").replace(/\.[^/.]+$/, "") + ".jpg";

                resolve({ base64, mimeType: "image/jpeg", fileName: safeName });
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function addTransaction() {
    let sName = document.getElementById("studentName").value.trim();
    // توحيد الأسماء المركبة مثل عبد الله -> عبدالله
    sName = displayNormalizedName(sName);
    const date = document.getElementById("dateTime").value;
    const file = document.getElementById("receiptFile").files[0];
    const userRole = sessionStorage.getItem('userRole') || 'student';
    const isStudent = (userRole === 'student');

    if (!sName || !date) {
        showToast("يرجى كتابة اسم الطالب وتحديد تاريخ التحصيل!", "warning");
        return;
    }

    // =========================================================
    // 1. حالة التحصيل المجمع لأكثر من معلم (Multi-Teacher Mode)
    // =========================================================
    if (isMultiTeacherMode) {
        const transactionsToPay = [];
        let missingAmount = false;

        currentStudentTeachers.forEach((item, idx) => {
            const check = document.getElementById(`teacherCheck_${idx}`);
            const amountInput = document.getElementById(`teacherAmount_${idx}`);

            if (check && check.checked) {
                const amt = amountInput ? toEnglishNumerals(amountInput.value.trim()) : "";
                if (!amt || isNaN(amt) || Number(amt) <= 0) {
                    missingAmount = true;
                } else {
                    transactionsToPay.push({
                        studentName: sName,
                        teacherName: item.teacherName,
                        category: item.category || '',
                        grade: item.grade || '',
                        amount: amt,
                        date: date
                    });
                }
            }
        });

        if (transactionsToPay.length === 0) {
            showToast("يرجى تحديد معلم واحد على الأقل للدفع له!", "warning");
            return;
        }

        if (missingAmount) {
            showToast("يرجى إدخال مبلغ صحيح لكل معلم تم تحديده!", "warning");
            return;
        }

        showLoading(true);

        try {
            // ضغط وتجهيز صورة الإيصال تلقائياً لسرعة الإرسال ومنع الـ Timeout
            const imgData = await compressReceiptImage(file);

            if (isStudent) {
                // وضع الطالب: إرسال الطلب لشيت العمليات المعلقة في انتظار تأكيد الإدارة
                const teacherNames = transactionsToPay.map(t => t.teacherName).join('، ');
                let totalVal = 0;
                transactionsToPay.forEach(t => { totalVal += (parseFloat(t.amount) || 0); });

                const res = await enqueueTransaction(() =>
                    fetchWithRetry(PENDING_SCRIPT_URL, {
                        method: 'POST',
                        body: JSON.stringify({
                            action: "addPendingTransaction",
                            studentName: sName,
                            teachers: teacherNames,
                            category: transactionsToPay[0].category || '',
                            grade: transactionsToPay[0].grade || '',
                            totalAmount: totalVal,
                            date: date,
                            items: transactionsToPay,
                            fileBase64: imgData.base64,
                            mimeType: imgData.mimeType,
                            fileName: imgData.fileName
                        })
                    })
                );

                const resJson = await res.json().catch(() => ({ status: "success" }));
                if (resJson && resJson.status === "error") {
                    showToast(resJson.message || "حدث خطأ أثناء تسجيل طلب الدفع.", "danger");
                } else {
                    showToast(`تم إرسال طلب الدفع بنجاح (${transactionsToPay.length} معلمين) وهو قيد مراجعة وتأكيد الإدارة.`, "success");
                    resetPaymentForm();
                }
            } else {
                // وضع الإدارة: حفظ مباشر في الشيت العام وشيتات المعلمين فوراً
                let bulkSuccess = false;
                try {
                    const res = await enqueueTransaction(() =>
                        fetchWithRetry(SCRIPT_URL, {
                            method: 'POST',
                            body: JSON.stringify({
                                action: "addTransactionsBulk",
                                transactions: transactionsToPay,
                                fileBase64: imgData.base64,
                                mimeType: imgData.mimeType,
                                fileName: imgData.fileName
                            })
                        })
                    );
                    const resJson = await res.json().catch(() => ({ status: "success" }));
                    if (resJson && resJson.status === "success") {
                        bulkSuccess = true;
                    }
                } catch (bulkErr) {
                    console.warn("Bulk submission failed, fallback to sequential queue", bulkErr);
                }

                if (!bulkSuccess) {
                    for (let i = 0; i < transactionsToPay.length; i++) {
                        const tx = transactionsToPay[i];
                        await enqueueTransaction(() =>
                            fetchWithRetry(SCRIPT_URL, {
                                method: 'POST',
                                body: JSON.stringify({
                                    action: "addTransaction",
                                    studentName: tx.studentName,
                                    teacherName: tx.teacherName,
                                    category: tx.category,
                                    grade: tx.grade,
                                    amount: tx.amount,
                                    date: tx.date,
                                    fileBase64: (i === 0 ? imgData.base64 : ""),
                                    mimeType: (i === 0 ? imgData.mimeType : ""),
                                    fileName: (i === 0 ? imgData.fileName : "")
                                })
                            })
                        );
                    }
                }

                showToast(`تم بنجاح حفظ تحصيل (${transactionsToPay.length}) معلمين في الشيت!`, "success");
                resetPaymentForm();
            }
        } catch (e) {
            console.error("Submission error:", e);
            showToast("حدث خطأ أثناء إرسال المعاملة، يرجى المحاولة مرة أخرى.", "danger");
        } finally {
            showLoading(false);
        }
        return;
    }

    // =========================================================
    // 2. حالة التحصيل الفردي الكلاسيكية (Single-Teacher Mode)
    // =========================================================
    const tName = document.getElementById("teacherSelect").value;
    const cat = document.getElementById("categorySelect").value;
    const grade = document.getElementById("gradeSelect").value;
    const rawAmount = document.getElementById("amount").value;
    const amount = toEnglishNumerals(rawAmount ? rawAmount.trim() : "");

    if (!tName || !cat || !grade || !amount || isNaN(amount) || Number(amount) <= 0) {
        showToast("يرجى إكمال جميع البيانات المطلوبة وإدخال مبلغ صحيح للتحصيل!", "warning");
        return;
    }

    showLoading(true);

    try {
        const imgData = await compressReceiptImage(file);

        if (isStudent) {
            // وضع الطالب: إرسال الطلب لشيت العمليات المعلقة
            const res = await enqueueTransaction(() =>
                fetchWithRetry(PENDING_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: "addPendingTransaction",
                        studentName: sName,
                        teachers: tName,
                        category: cat,
                        grade: grade,
                        totalAmount: amount,
                        date: date,
                        items: [{
                            studentName: sName,
                            teacherName: tName,
                            category: cat,
                            grade: grade,
                            amount: amount,
                            date: date
                        }],
                        fileBase64: imgData.base64,
                        mimeType: imgData.mimeType,
                        fileName: imgData.fileName
                    })
                })
            );

            const resJson = await res.json().catch(() => ({ status: "success" }));
            if (resJson && resJson.status === "error") {
                showToast(resJson.message || "حدث خطأ أثناء تسجيل طلب الدفع.", "danger");
            } else {
                showToast("تم إرسال طلب الدفع بنجاح وهو قيد مراجعة وتأكيد الإدارة.", "success");
                resetPaymentForm();
            }
        } else {
            // وضع الإدارة: حفظ مباشر في الشيت العام وشيت المدرس
            const res = await enqueueTransaction(() =>
                fetchWithRetry(SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: "addTransaction",
                        studentName: sName,
                        teacherName: tName,
                        category: cat,
                        grade: grade,
                        amount: amount,
                        date: date,
                        fileBase64: imgData.base64,
                        mimeType: imgData.mimeType,
                        fileName: imgData.fileName
                    })
                })
            );

            const resJson = await res.json().catch(() => ({ status: "success" }));
            if (resJson && resJson.status === "error") {
                showToast(resJson.message || "حدث خطأ أثناء حفظ المعاملة.", "danger");
            } else {
                showToast("تم حفظ بيانات التحصيل بنجاح في الشيت!", "success");
                resetPaymentForm();
            }
        }
    } catch (e) {
        console.error("Submission error:", e);
        showToast("حدث خطأ أثناء إرسال المعاملة، يرجى المحاولة مرة أخرى.", "danger");
    } finally {
        showLoading(false);
    }
}

function resetPaymentForm() {
    ["studentName", "amount", "receiptFile", "categorySelect", "teacherSelect", "quickUnifiedAmount"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    // إخفاء حاوية المدرسين المتعددين
    const multiContainer = document.getElementById("multiTeachersContainer");
    const singleSection = document.getElementById("singleTeacherSection");
    const manualSwitchRow = document.getElementById("manualSwitchBackRow");

    if (multiContainer) multiContainer.style.display = "none";
    if (singleSection) singleSection.style.display = "block";
    if (manualSwitchRow) manualSwitchRow.style.display = "none";

    currentStudentTeachers = [];
    isMultiTeacherMode = false;

    setDefaultDateTime();
    updateGrades('categorySelect', 'gradeSelect');
}

async function clearTeacherDues() {
    const tName = document.getElementById("clearTeacherSelect").value;
    const cat = document.getElementById("clearCategorySelect").value;
    const grade = document.getElementById("clearGradeSelect").value;

    if (!tName || !cat || !grade) {
        showToast("يرجى تحديد المعلم والفئة والصف الدراسي أولاً!", "warning");
        return;
    }

    if (confirm(`تصفير حساب أستاذ/ ${tName} لفرقة ${cat} (الصف ${grade})؟`)) {
        showLoading(true);
        try {
            await fetch(SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: "clearDues",
                    teacherName: tName,
                    category: cat,
                    grade: grade
                })
            });
            showToast(`تم تصفير حساب أستاذ/ ${tName} للفرقة المحددة!`, "success");
            ["clearTeacherSelect", "clearCategorySelect"].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = "";
            });
            updateGrades('clearCategorySelect', 'clearGradeSelect');
        } catch (e) {
            showToast("حدث خطأ أثناء تصفية الحساب.", "danger");
        }
        showLoading(false);
    }
}

/* ===================================================
   ماسح كود الحضور والغياب للطلاب عبر الكاميرا (QR Scanner)
   =================================================== */
let _html5QrCode = null;
let _currentCameraFacing = "environment"; // الكاميرا الخلفية افتراضياً
let _availableCameras = [];
let _currentCameraIndex = 0;

function playBeepSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // 880 Hz
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (_) {}
}

async function openStudentQrScannerModal() {
    const modal = document.getElementById("studentQrScannerModal");
    if (!modal) return;
    modal.style.display = "flex";

    const loading = document.getElementById("qrCameraLoading");
    const status = document.getElementById("qrScannerStatus");
    if (loading) loading.style.display = "flex";
    if (status) status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري تشغيل الكاميرا...</span>';

    setTimeout(() => {
        startStudentQrCamera();
    }, 250);
}

function closeStudentQrScannerModal() {
    stopStudentQrCamera();
    const modal = document.getElementById("studentQrScannerModal");
    if (modal) modal.style.display = "none";
}

async function startStudentQrCamera() {
    const loading = document.getElementById("qrCameraLoading");
    const status = document.getElementById("qrScannerStatus");

    // التأكد من تحميل مكتبة Html5Qrcode
    if (typeof Html5Qrcode === "undefined") {
        if (loading) loading.style.display = "none";
        if (status) status.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;"></i> <span>تعذر تحميل مكتبة الكاميرا، اضغط بالأسفل للتسجيل المباشر</span>';
        return;
    }

    try {
        if (!_html5QrCode) {
            _html5QrCode = new Html5Qrcode("qrCameraReader");
        }

        // جلب قائمة الكاميرات
        try {
            _availableCameras = await Html5Qrcode.getCameras();
        } catch (_) {
            _availableCameras = [];
        }

        const config = {
            fps: 15,
            qrbox: { width: 230, height: 230 },
            aspectRatio: 1.0
        };

        const cameraIdOrConfig = (_availableCameras.length > 0 && _availableCameras[_currentCameraIndex]?.id) 
            ? _availableCameras[_currentCameraIndex].id 
            : { facingMode: _currentCameraFacing };

        await _html5QrCode.start(
            cameraIdOrConfig,
            config,
            (decodedText) => {
                handleQrScanResult(decodedText);
            },
            () => {
                // خطأ أثناء المسح المستمر (يمكن تجاهله)
            }
        );

        if (loading) loading.style.display = "none";
        if (status) status.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> <span>الكاميرا تعمل بنجاح، وجّه الهاتف نحو الرمز</span>';

    } catch (err) {
        console.warn("Camera start error:", err);
        if (loading) loading.style.display = "none";
        let errMsg = "تعذر فتح الكاميرا. يرجى التأكد من منح الإذن للمتصفح.";
        if (err.name === "NotAllowedError") {
            errMsg = "تم رفض إذن الوصول للكاميرا، يرجى تفعيله من إعدادات المتصفح.";
        }
        if (status) {
            status.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="color:#ef4444;"></i> <span>${errMsg}</span>`;
        }
    }
}

async function stopStudentQrCamera() {
    if (_html5QrCode) {
        try {
            if (_html5QrCode.isScanning) {
                await _html5QrCode.stop();
            }
            _html5QrCode.clear();
        } catch (_) {}
        _html5QrCode = null;
    }
}

async function switchQrCamera() {
    await stopStudentQrCamera();
    if (_availableCameras.length > 1) {
        _currentCameraIndex = (_currentCameraIndex + 1) % _availableCameras.length;
    } else {
        _currentCameraFacing = (_currentCameraFacing === "environment") ? "user" : "environment";
    }
    const loading = document.getElementById("qrCameraLoading");
    if (loading) loading.style.display = "flex";
    await startStudentQrCamera();
}

async function handleQrFileScan(input) {
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const status = document.getElementById("qrScannerStatus");
    if (status) status.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري فحص الصورة...</span>';

    try {
        const html5QrCode = new Html5Qrcode("qrCameraReader");
        const decodedText = await html5QrCode.scanFile(file, true);
        handleQrScanResult(decodedText);
    } catch (err) {
        if (status) status.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#ef4444;"></i> <span>لم يتم العثور على رمز QR صالح في هذه الصورة</span>';
    }
    input.value = "";
}

function handleQrScanResult(decodedText) {
    if (!decodedText) return;
    playBeepSound();

    const status = document.getElementById("qrScannerStatus");
    if (status) {
        status.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> <span>تم قراءة الرمز بنجاح! جاري تحويلك...</span>';
    }

    stopStudentQrCamera();

    // التحقق من الرابط أو التوكن
    setTimeout(() => {
        closeStudentQrScannerModal();
        let targetUrl = "student-attendance.html";

        if (decodedText.includes("student-attendance.html")) {
            targetUrl = decodedText;
        } else if (decodedText.startsWith("http://") || decodedText.startsWith("https://")) {
            // رابط خارجي أو مسار كامل
            targetUrl = decodedText;
        } else {
            // توكن مشفر
            targetUrl = `student-attendance.html?token=${encodeURIComponent(decodedText)}`;
        }

        window.location.href = targetUrl;
    }, 400);
}

// تشغيل عند تحميل الصفحة
window.onload = function() {
    checkCurrentSession();
    // تحديث أيقونة ونص الثيم
    const savedTheme = localStorage.getItem('theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);
};
