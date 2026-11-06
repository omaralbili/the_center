/* ===================================================
   attendance.js — منطق صفحة تسجيل الحضور والغياب
   =================================================== */

// ── رابط Apps Script الخاص بالحضور
const ATT_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwqGlBz-aIG9uqyHOB5Y30Io7GnIkRzKWbejh-nHMl2nhVXEUNkNPAG9S4IvXRObd-N/exec";

// رابط جلب المعلمين (من السكريبت الأساسي الموجود)
const TEACHERS_URL   = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";

// رابط قاعدة بيانات الطلاب للإكمال التلقائي
const STUDENTS_DB_URL = "https://script.google.com/macros/s/AKfycbx35GjixD83S6R69c2mnA9KvgG93I0PX-yrIDdokwLRzaTTkd9fRR3fwuyHRWLUJDK5/exec";

/* ===================================================
   توحيد الأسماء المركبة وإزالة الفروق الإملائية
   =================================================== */
function normalizeArabicName(name) {
    if (!name) return "";
    let str = name.toString().trim();
    str = str.replace(/[\u064B-\u065F\u0640]/g, '');
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
    str = str.replace(/\bابن\s+/g, 'بن ');
    str = str.replace(/[إأآٱ]/g, 'ا');
    str = str.replace(/ة\b/g, 'ه');
    str = str.replace(/[ىي]/g, 'ي');
    return str.replace(/\s+/g, ' ').trim();
}

function displayNormalizedName(name) {
    if (!name) return "";
    let str = name.toString().trim().replace(/\s+/g, ' ');
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
    return str;
}

const attGradesData = {
    "ابتدائي":        ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "ابتدائي لغات":   ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "اعدادي":         ["الأول", "الثاني", "الثالث"],
    "اعدادي لغات":    ["الأول", "الثاني", "الثالث"],
    "ثانوي":          ["الأول", "الثاني", "الثالث"],
    "ثانوي لغات":     ["الأول", "الثاني", "الثالث"]
};

/* ───────────────────────────────────────────────────
   طابور الإرسال + إعادة المحاولة (نفس نمط script.js)
   ─────────────────────────────────────────────────── */
const _attQueue = { pending: [], running: false };

function enqueueAtt(fn) {
    return new Promise((resolve, reject) => {
        _attQueue.pending.push({ fn, resolve, reject });
        if (!_attQueue.running) _drainAttQueue();
    });
}

async function _drainAttQueue() {
    if (_attQueue.running || _attQueue.pending.length === 0) return;
    _attQueue.running = true;
    const { fn, resolve, reject } = _attQueue.pending.shift();
    try { resolve(await fn()); }
    catch (err) { reject(err); }
    finally { _attQueue.running = false; _drainAttQueue(); }
}

async function attFetch(url, options, retries = 3) {
    let lastErr;
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status === 429 || res.status === 503) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (e) {
            lastErr = e;
            if (i < retries) await new Promise(r => setTimeout(r, Math.pow(2, i - 1) * 1000));
        }
    }
    throw lastErr;
}

/* ───────────────────────────────────────────────────
   State
   ─────────────────────────────────────────────────── */
let allRecords   = [];   // كل سجلات الحضور
let filteredRecs = [];   // المفلترة
let editingRowId = null; // id السطر الجاري تعديله
let allStudentsList = []; // قائمة الطلاب المقترحين

/* ───────────────────────────────────────────────────
   تهيئة عند التحميل
   ─────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    setDefaultDateTime();
    setDefaultFilterMonth();
    loadTeachers();
    loadStudentsDatabase();
    initAttStudentAutocomplete();
    loadAllRecords();
    setupAttendanceLiveSync();
});

/* ── ثيم ─────────────────────────────────────────── */
function initTheme() {
    const saved = localStorage.getItem('theme');
    const sys   = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved || sys);
}
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        const ic = btn.querySelector('i');
        const sp = btn.querySelector('span');
        if (ic && sp) {
            ic.className  = theme === 'dark' ? 'fa-solid fa-sun'  : 'fa-solid fa-moon';
            ic.style.color = theme === 'dark' ? '#f59e0b' : '';
            sp.textContent = theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي';
        }
    });
}
function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ── إشعارات ─────────────────────────────────────── */
function showToast(msg, type = 'success') {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    const icons = { success: 'circle-check', danger: 'circle-xmark', warning: 'triangle-exclamation', info: 'circle-info' };
    t.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i><span>${msg}</span>`;
    c.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 3500);
}

/* ── تحميل ─────────────────────────────────────── */
function showLoading(show) {
    const btn = document.getElementById('btnSaveAtt');
    if (!btn) return;
    btn.disabled = show;
    btn.innerHTML = show
        ? '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...'
        : '<i class="fa-solid fa-floppy-disk"></i> حفظ السجل';
}

/* ───────────────────────────────────────────────────
   التبويبات
   ─────────────────────────────────────────────────── */
async function switchTab(tabId, btn) {
    document.querySelectorAll('.att-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.att-tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
    // ✅ دايماً أعد تحميل البيانات عند التبديل لأي تبويب يعرض بيانات
    if (tabId === 'tabRecords') { await loadAllRecords(); }
    if (tabId === 'tabStats')   { await loadAllRecords(); renderStats(); }
    if (tabId === 'tabQr')      { startTabQrGenerator(); }
}

/* ───────────────────────────────────────────────────
   التاريخ والوقت الافتراضيان
   ─────────────────────────────────────────────────── */
function setDefaultDateTime() {
    const now = new Date();
    document.getElementById('attDate').value = now.toISOString().split('T')[0];
    document.getElementById('attTime').value = now.toTimeString().slice(0, 5);
}

function setDefaultFilterMonth() {
    const now = new Date();
    const m = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('filterMonth').value = m;
    document.getElementById('statsMonth').value  = m;
}

/* ───────────────────────────────────────────────────
   جلب قائمة المعلمين
   ─────────────────────────────────────────────────── */
async function loadTeachers() {
    try {
        const res  = await fetch(TEACHERS_URL);
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.teachers || []);

        const ids = ['attTeacherSelect', 'filterTeacher', 'statsTeacher'];
        ids.forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const first = sel.options[0];
            sel.innerHTML = '';
            sel.appendChild(first);
            list.forEach(t => {
                const name = typeof t === 'string' ? t : (t.name || t.teacherName || '');
                if (name) {
                    const opt = document.createElement('option');
                    opt.value = opt.textContent = name;
                    sel.appendChild(opt);
                }
            });
        });
    } catch (e) {
        showToast('تعذّر تحميل قائمة المعلمين', 'warning');
    }
}

/* ───────────────────────────────────────────────────
   تحديث الصفوف بحسب الفئة
   ─────────────────────────────────────────────────── */
function updateAttGrades() {
    const cat   = document.getElementById('attCategorySelect').value;
    const sel   = document.getElementById('attGradeSelect');
    sel.innerHTML = '<option value="">-- اختر الصف --</option>';
    (attGradesData[cat] || []).forEach(g => {
        const o = document.createElement('option');
        o.value = o.textContent = g;
        sel.appendChild(o);
    });
}

function onAttTeacherChange() { /* يمكن استخدامها مستقبلاً لفلترة الطلاب */ }

/* ───────────────────────────────────────────────────
   تحميل قاعدة بيانات الطلاب للإكمال التلقائي
   ─────────────────────────────────────────────────── */
async function loadStudentsDatabase() {
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
        console.warn("Attendance: Could not fetch remote students db", e);
    }
}

/* ───────────────────────────────────────────────────
   الإكمال التلقائي لاسم الطالب في شاشة الغياب
   ─────────────────────────────────────────────────── */
function initAttStudentAutocomplete() {
    const input = document.getElementById("attStudentName");
    const dropdown = document.getElementById("attStudentDropdown");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        const query = this.value.trim();
        const normQ = normalizeArabicName(query);
        if (!normQ) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        const matches = allStudentsList.filter(s => 
            normalizeArabicName(s.studentName).includes(normQ)
        );

        if (matches.length === 0) {
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        const topMatches = matches.slice(0, 8);
        dropdown.innerHTML = topMatches.map((s, idx) => `
            <div class="autocomplete-item" data-idx="${idx}">
                <div class="autocomplete-item-info">
                    <strong><i class="fa-solid fa-user-check" style="color: #10b981; margin-left: 6px;"></i>${highlightAttMatch(displayNormalizedName(s.studentName), query)}</strong>
                    <span><i class="fa-solid fa-chalkboard-user"></i> أ/ ${s.teacherName || 'غير محدد'} • ${s.category || ''} (${s.grade || ''})</span>
                </div>
                <i class="fa-solid fa-arrow-turn-down-left" style="color: #6366f1; font-size: 11px;"></i>
            </div>
        `).join('');

        dropdown.style.display = "block";

        dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
            item.addEventListener("click", function() {
                const selected = topMatches[parseInt(this.getAttribute("data-idx"))];
                if (!selected) return;

                input.value = displayNormalizedName(selected.studentName);
                dropdown.style.display = "none";

                // تعبئة المدرس والفئة والصف تلقائياً في شاشة الغياب
                if (selected.teacherName) {
                    const teacherSel = document.getElementById("attTeacherSelect");
                    if (teacherSel) {
                        let found = Array.from(teacherSel.options).some(o => o.value === selected.teacherName);
                        if (!found) {
                            teacherSel.add(new Option(selected.teacherName, selected.teacherName));
                        }
                        teacherSel.value = selected.teacherName;
                    }
                }

                if (selected.category) {
                    const catSel = document.getElementById("attCategorySelect");
                    if (catSel) {
                        catSel.value = selected.category;
                        updateAttGrades();
                    }
                }

                if (selected.grade) {
                    const gradeSel = document.getElementById("attGradeSelect");
                    if (gradeSel) {
                        gradeSel.value = selected.grade;
                    }
                }
            });
        });
    });

    document.addEventListener("click", function(e) {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });
}

function highlightAttMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span style="color: #6366f1; text-decoration: underline; font-weight: 800;">$1</span>');
}

/* ───────────────────────────────────────────────────
   اختيار الحالة (حاضر / غائب)
   ─────────────────────────────────────────────────── */
function selectStatus(status) {
    document.getElementById('attStatus').value = status;
    document.getElementById('btnPresent').classList.toggle('selected', status === 'حاضر');
    document.getElementById('btnAbsent').classList.toggle('selected', status === 'غائب');
}

/* ───────────────────────────────────────────────────
   حفظ سجل جديد أو تعديل موجود
   ─────────────────────────────────────────────────── */
async function saveAttendance() {
    let studentName   = document.getElementById('attStudentName').value.trim();
    const teacher     = document.getElementById('attTeacherSelect').value;
    const category    = document.getElementById('attCategorySelect').value;
    const grade       = document.getElementById('attGradeSelect').value;
    const date        = document.getElementById('attDate').value;
    const time        = document.getElementById('attTime').value;
    const status      = document.getElementById('attStatus').value;
    const note        = document.getElementById('attNote').value.trim();

    if (!studentName || !teacher || !category || !grade || !date || !time) {
        showToast('يرجى إكمال جميع البيانات المطلوبة!', 'warning');
        return;
    }

    studentName = displayNormalizedName(studentName);

    showLoading(true);

    const payload = {
        action:      editingRowId ? 'updateAttendance' : 'addAttendance',
        rowId:       editingRowId || '',
        studentName, teacher, category, grade, date, time, status, note,
        timestamp:   new Date().toISOString()
    };

    try {
        await enqueueAtt(() => attFetch(ATT_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        }));

        showToast(editingRowId ? 'تم تعديل السجل بنجاح ✅' : 'تم حفظ سجل الحضور بنجاح ✅', 'success');
        resetAttForm();
        await loadAllRecords();

    } catch (e) {
        showToast('حدث خطأ أثناء الحفظ، يرجى المحاولة مرة أخرى.', 'danger');
    }

    showLoading(false);
}

/* ───────────────────────────────────────────────────
   تهيئة النموذج
   ─────────────────────────────────────────────────── */
function resetAttForm() {
    editingRowId = null;
    document.getElementById('attStudentName').value = '';
    document.getElementById('attTeacherSelect').value = '';
    document.getElementById('attCategorySelect').value = '';
    document.getElementById('attGradeSelect').innerHTML = '<option value="">-- اختر الصف --</option>';
    document.getElementById('attNote').value = '';
    document.getElementById('formTitle').textContent = 'تسجيل حضور / غياب طالب';
    document.getElementById('btnCancelEdit').style.display = 'none';
    selectStatus('حاضر');
    setDefaultDateTime();
}

function cancelAttEdit() { resetAttForm(); }

/* ───────────────────────────────────────────────────
   تحميل كل السجلات
   ─────────────────────────────────────────────────── */
async function loadAllRecords() {
    // إظهار حالة التحميل في الجدول
    const tbody = document.getElementById('attTableBody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
            <i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل البيانات...</div></td></tr>`;
    }

    try {
        // ✅ redirect: 'follow' ضروري لـ Google Apps Script
        const res = await fetch(`${ATT_SCRIPT_URL}?action=getAttendance`, {
            redirect: 'follow'
        });

        const text = await res.text(); // نقرأ كـ text أولاً لتجنب أخطاء JSON
        let data;
        try {
            data = JSON.parse(text);
        } catch (_) {
            throw new Error('استجابة غير صالحة من الخادم');
        }

        // دعم أشكال الاستجابة المختلفة
        if (Array.isArray(data)) {
            allRecords = data;
        } else if (data && Array.isArray(data.records)) {
            allRecords = data.records;
        } else if (data && data.status === 'success') {
            allRecords = data.records || [];
        } else {
            allRecords = [];
        }

        applyFilter();

    } catch (e) {
        console.warn('loadAllRecords error:', e);
        showToast('تعذّر تحميل سجلات الحضور: ' + e.message, 'warning');
        allRecords = [];
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
                <i class="fa-solid fa-triangle-exclamation"></i> تعذّر تحميل البيانات، حاول مرة أخرى</div></td></tr>`;
        }
    }
}

/* ───────────────────────────────────────────────────
   فلاتر جدول السجلات
   ─────────────────────────────────────────────────── */
function onFilterCatChange() {
    const cat = document.getElementById('filterCategory').value;
    const sel = document.getElementById('filterGrade');
    sel.innerHTML = '<option value="">-- كل الصفوف --</option>';
    (attGradesData[cat] || []).forEach(g => {
        const o = document.createElement('option');
        o.value = o.textContent = g;
        sel.appendChild(o);
    });
    applyFilter();
}

function applyFilter() {
    const teacher  = document.getElementById('filterTeacher').value;
    const category = document.getElementById('filterCategory').value;
    const grade    = document.getElementById('filterGrade').value;
    const status   = document.getElementById('filterStatus').value;
    const month    = document.getElementById('filterMonth').value; // YYYY-MM

    filteredRecs = allRecords.filter(r => {
        if (teacher  && r.teacher  !== teacher)  return false;
        if (category && r.category !== category) return false;
        if (grade    && r.grade    !== grade)    return false;
        if (status   && r.status   !== status)   return false;

        // ✅ مطابقة الشهر بشكل مرن — يدعم YYYY-MM-DD وأشكال أخرى
        if (month) {
            const d = (r.date || '').trim();
            // تحويل التاريخ لـ YYYY-MM إذا كان بفورمات مختلف
            const normalized = normalizeToYearMonth(d);
            if (normalized && normalized !== month) return false;
            // لو ما قدرنا نطابق، نعرض السجل ولا نحذفه
        }

        return true;
    });

    renderTable();
}

/**
 * استخراج YYYY-MM من أي فورمات تاريخ شائع
 */
function normalizeToYearMonth(dateStr) {
    if (!dateStr) return null;
    // YYYY-MM-DD
    const iso = dateStr.match(/^(\d{4})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}`;
    // DD/MM/YYYY
    const ar = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (ar) return `${ar[3]}-${String(ar[2]).padStart(2, '0')}`;
    return null;
}

/* ───────────────────────────────────────────────────
   رسم جدول السجلات
   ─────────────────────────────────────────────────── */
function renderTable() {
    const tbody = document.getElementById('attTableBody');
    const count = document.getElementById('recordsCount');

    if (!filteredRecs.length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state">
            <i class="fa-solid fa-inbox"></i> لا توجد سجلات تطابق الفلتر المحدد</div></td></tr>`;
        count.textContent = '';
        return;
    }

    tbody.innerHTML = filteredRecs.map((r, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${r.studentName || '—'}</strong></td>
            <td>${r.teacher || '—'}</td>
            <td>${r.category || '—'}</td>
            <td>${r.grade || '—'}</td>
            <td>${r.date || '—'}</td>
            <td>${r.time || '—'}</td>
            <td><span class="${r.status === 'حاضر' ? 'badge-present' : 'badge-absent'}">${r.status || '—'}</span></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.note || '—'}</td>
            <td>
                <button class="btn-edit-sm" onclick="editRecord('${r.rowId}')">
                    <i class="fa-solid fa-pen"></i> تعديل
                </button>
                <button class="btn-del-sm" onclick="deleteRecord('${r.rowId}', '${(r.studentName || '').replace(/'/g, '')}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        </tr>`).join('');

    count.textContent = `إجمالي السجلات المعروضة: ${filteredRecs.length}`;
}

/* ───────────────────────────────────────────────────
   تعديل سجل
   ─────────────────────────────────────────────────── */
function editRecord(rowId) {
    const r = allRecords.find(x => x.rowId === rowId);
    if (!r) return;

    editingRowId = rowId;

    document.getElementById('attStudentName').value = r.studentName || '';
    document.getElementById('attTeacherSelect').value = r.teacher || '';
    document.getElementById('attCategorySelect').value = r.category || '';
    updateAttGrades();
    document.getElementById('attGradeSelect').value = r.grade || '';
    document.getElementById('attDate').value = r.date || '';
    document.getElementById('attTime').value = r.time || '';
    document.getElementById('attNote').value = r.note || '';
    selectStatus(r.status || 'حاضر');

    document.getElementById('formTitle').textContent = `تعديل سجل: ${r.studentName}`;
    document.getElementById('btnCancelEdit').style.display = 'inline-flex';

    // الانتقال لتبويب التسجيل
    document.querySelectorAll('.att-tab-btn')[0].click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`جاري تعديل سجل: ${r.studentName}`, 'info');
}

/* ───────────────────────────────────────────────────
   حذف سجل
   ─────────────────────────────────────────────────── */
async function deleteRecord(rowId, name) {
    if (!confirm(`هل تريد حذف سجل الطالب "${name}"؟`)) return;

    try {
        await enqueueAtt(() => attFetch(ATT_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'deleteAttendance', rowId })
        }));
        showToast('تم حذف السجل بنجاح', 'success');
        await loadAllRecords();
    } catch (e) {
        showToast('حدث خطأ أثناء الحذف', 'danger');
    }
}

/* ───────────────────────────────────────────────────
   الإحصائيات
   ─────────────────────────────────────────────────── */
function onStatsTeacherChange() { renderStats(); }

function onStatsCatChange() {
    const cat = document.getElementById('statsCategory').value;
    const sel = document.getElementById('statsGrade');
    sel.innerHTML = '<option value="">-- اختر الصف --</option>';
    (attGradesData[cat] || []).forEach(g => {
        const o = document.createElement('option');
        o.value = o.textContent = g;
        sel.appendChild(o);
    });
    renderStats();
}

function renderStats() {
    const teacher  = document.getElementById('statsTeacher').value;
    const category = document.getElementById('statsCategory').value;
    const grade    = document.getElementById('statsGrade').value;
    const month    = document.getElementById('statsMonth').value;

    const empty     = document.getElementById('statsEmpty');
    const cards     = document.getElementById('statsCards');
    const tableWrap = document.getElementById('statsTableWrap');

    if (!teacher && !category && !grade) {
        empty.style.display = 'block';
        cards.style.display = 'none';
        tableWrap.style.display = 'none';
        return;
    }

    // فلترة
    const recs = allRecords.filter(r => {
        if (teacher  && r.teacher  !== teacher)  return false;
        if (category && r.category !== category) return false;
        if (grade    && r.grade    !== grade)    return false;
        if (month    && !r.date?.startsWith(month)) return false;
        return true;
    });

    if (!recs.length) {
        empty.style.display = 'block';
        empty.innerHTML = '<i class="fa-solid fa-inbox"></i> لا توجد سجلات لهذا الاختيار في الشهر المحدد';
        cards.style.display = 'none';
        tableWrap.style.display = 'none';
        return;
    }

    empty.style.display = 'none';
    cards.style.display = 'grid';
    tableWrap.style.display = 'block';

    const total   = recs.length;
    const present = recs.filter(r => r.status === 'حاضر').length;
    const absent  = total - present;
    const rate    = total ? Math.round((present / total) * 100) : 0;

    document.getElementById('statTotal').textContent   = total;
    document.getElementById('statPresent').textContent = present;
    document.getElementById('statAbsent').textContent  = absent;
    document.getElementById('statRate').textContent    = `${rate}%`;
    document.getElementById('statBar').style.width     = `${rate}%`;

    // تفاصيل كل طالب
    const byStudent = {};
    recs.forEach(r => {
        const n = r.studentName || 'غير محدد';
        if (!byStudent[n]) byStudent[n] = { present: 0, absent: 0 };
        if (r.status === 'حاضر') byStudent[n].present++;
        else byStudent[n].absent++;
    });

    const tbody = document.getElementById('statsTableBody');
    tbody.innerHTML = Object.entries(byStudent)
        .sort((a, b) => (b[1].present + b[1].absent) - (a[1].present + a[1].absent))
        .map(([name, d]) => {
            const tot  = d.present + d.absent;
            const pct  = tot ? Math.round((d.present / tot) * 100) : 0;
            const color = pct >= 75 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
            return `<tr>
                <td><strong>${name}</strong></td>
                <td><span class="badge-present">${d.present}</span></td>
                <td><span class="badge-absent">${d.absent}</span></td>
                <td>${tot}</td>
                <td>
                    <span style="color:${color};font-weight:700;">${pct}%</span>
                    <div class="progress-bar-wrap" style="width:80px;display:inline-block;margin-right:8px;vertical-align:middle;">
                        <div class="progress-bar-fill" style="width:${pct}%;background:${color};"></div>
                    </div>
                </td>
            </tr>`;
        }).join('');
}

/* ===================================================
   شاشة الـ QR للسنتر داخل التبويب (تتغير كل 25 ثانية)
   =================================================== */
let tabQrTimerInterval = null;
let tabQrTimeLeft = 25;
let tabQrCodeInstance = null;
let tabQrTodayCount = 0;

function startTabQrGenerator() {
    renderTabQrCode();
    tabQrTimeLeft = 25;
    updateTabQrTimerUI();

    if (tabQrTimerInterval) clearInterval(tabQrTimerInterval);
    tabQrTimerInterval = setInterval(() => {
        tabQrTimeLeft--;
        if (tabQrTimeLeft <= 0) {
            renderTabQrCode();
            tabQrTimeLeft = 25;
        }
        updateTabQrTimerUI();
    }, 1000);
}

function forceRefreshTabQr() {
    renderTabQrCode();
    tabQrTimeLeft = 25;
    updateTabQrTimerUI();
    showToast("تم تحديث رمز الـ QR فوراً", "info");
}

function updateTabQrTimerUI() {
    const textEl = document.getElementById("tabQrTimerText");
    const barEl = document.getElementById("tabQrTimerBar");
    if (textEl) textEl.textContent = `${tabQrTimeLeft} ثانية`;
    if (barEl) {
        const pct = (tabQrTimeLeft / 25) * 100;
        barEl.style.width = `${pct}%`;
        if (tabQrTimeLeft <= 5) {
            barEl.style.background = "#ef4444";
            if (textEl) textEl.style.color = "#ef4444";
        } else if (tabQrTimeLeft <= 10) {
            barEl.style.background = "#f59e0b";
            if (textEl) textEl.style.color = "#f59e0b";
        } else {
            barEl.style.background = "linear-gradient(90deg, #10b981, #6366f1)";
            if (textEl) textEl.style.color = "#10b981";
        }
    }
}

function renderTabQrCode() {
    const timestamp = Date.now();
    const salt = Math.random().toString(36).substring(2, 9);
    const token = btoa(`${timestamp}_${salt}`);

    // حفظ التوكن النشط
    try {
        let activeTokens = [];
        const saved = localStorage.getItem('center_active_qr_tokens');
        if (saved) activeTokens = JSON.parse(saved);
        activeTokens.push(token);
        if (activeTokens.length > 5) activeTokens = activeTokens.slice(-5);
        localStorage.setItem('center_active_qr_tokens', JSON.stringify(activeTokens));
        localStorage.setItem('center_current_qr_token', token);
    } catch (_) {}

    const origin = window.location.origin;
    let path = window.location.pathname;
    path = path.substring(0, path.lastIndexOf('/'));
    const targetUrl = `${origin}${path}/student-attendance.html?token=${encodeURIComponent(token)}&t=${timestamp}`;

    const container = document.getElementById("tabQrCanvas");
    if (!container) return;
    container.innerHTML = "";

    if (typeof QRCode !== "undefined") {
        tabQrCodeInstance = new QRCode(container, {
            text: targetUrl,
            width: 240,
            height: 240,
            colorDark: "#0f172a",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    } else {
        const img = document.createElement("img");
        img.src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(targetUrl)}`;
        img.alt = "QR Code";
        img.style.width = "240px";
        img.style.height = "240px";
        container.appendChild(img);
    }
}

/* ===================================================
   المزامنة اللحظية للحضور (Real-time Instant Sync)
   تسمع فوراً عندما يسجل أي طالب حضوره بالـ QR
   =================================================== */
function playAttChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.1); // A5

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
    } catch (_) {}
}

function setupAttendanceLiveSync() {
    // 1. استقبال عبر BroadcastChannel
    try {
        const bc = new BroadcastChannel('center_attendance_channel');
        bc.onmessage = (event) => {
            if (event.data && event.data.type === 'NEW_ATTENDANCE' && event.data.record) {
                handleIncomingAttendance(event.data.record);
            }
        };
    } catch (_) {}

    // 2. استقبال عبر Storage Event (للتوافق بين كل النوافذ والأجهزة)
    window.addEventListener('storage', (e) => {
        if (e.key === 'center_live_attendance_sync' && e.newValue) {
            try {
                const rec = JSON.parse(e.newValue);
                handleIncomingAttendance(rec);
            } catch (_) {}
        }
    });
}

function handleIncomingAttendance(rec) {
    playAttChime();
    showToast(`🟢 سجل حضور للتو: ${rec.studentName} مع أ/ ${rec.teacher}`, 'success');

    // 1. إضافة السجل في أعلى قائمة allRecords
    const newRecordObj = {
        rowId: rec.id || Date.now(),
        studentName: rec.studentName,
        teacher: rec.teacher,
        category: rec.category || '',
        grade: rec.grade || '',
        date: rec.date || new Date().toISOString().split('T')[0],
        time: rec.time || new Date().toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}),
        status: rec.status || 'حاضر',
        note: rec.note || '[سجل عبر QR]'
    };

    allRecords.unshift(newRecordObj);

    // 2. تحديث جدول السجلات إذا كان معروضاً
    applyFilter();

    // 3. تحديث قائمة الحضور اللحظي في تبويب الـ QR
    updateTabQrLiveFeed(newRecordObj);

    // 4. تحديث الإحصائيات إذا كان تبويب الإحصائيات مفتوحاً
    renderStats();
}

function updateTabQrLiveFeed(rec) {
    const list = document.getElementById("tabQrLiveList");
    const empty = document.getElementById("tabQrLiveEmpty");
    const countEl = document.getElementById("tabQrLiveCount");

    if (empty) empty.style.display = "none";

    tabQrTodayCount++;
    if (countEl) countEl.textContent = `${tabQrTodayCount} مسجل اليوم`;

    if (list) {
        const row = document.createElement("div");
        row.style.cssText = "background:var(--card-bg); border:1px solid var(--border-color); border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; animation:fadeInDown 0.3s ease;";
        row.innerHTML = `
            <div>
                <strong style="color:var(--text-title); font-size:13.5px;"><i class="fa-solid fa-circle-check" style="color:#10b981; margin-left:6px;"></i>${rec.studentName}</strong>
                <span style="font-size:11.5px; color:var(--text-muted); display:block; margin-top:2px;">أ/ ${rec.teacher} • ${rec.category || ''} (${rec.grade || ''})</span>
            </div>
            <span style="font-size:12px; font-weight:700; color:#10b981; direction:ltr;">${rec.time}</span>
        `;
        list.insertBefore(row, list.firstChild);
    }
}

