/* ===================================================
   ملف التحكم بصفحة إضافة وبحث وتعديل وحذف الطلاب الجدد
   وحسابات الفئات والصفوف لكل معلم
   =================================================== */

// رابط سكريبت جلب قائمة المعلمين القدامى
const TEACHERS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";

// رابط سكريبت شيت تسجيل وتعديل وحذف الطلاب الجدد
const STUDENTS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx35GjixD83S6R69c2mnA9KvgG93I0PX-yrIDdokwLRzaTTkd9fRR3fwuyHRWLUJDK5/exec";

// بيانات المراحل والصفوف الدراسية
const gradesData = {
    "ابتدائي":        ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "ابتدائي لغات":   ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
    "اعدادي":         ["الأول", "الثاني", "الثالث"],
    "اعدادي لغات":    ["الأول", "الثاني", "الثالث"],
    "ثانوي":          ["الأول", "الثاني", "الثالث"],
    "ثانوي لغات":     ["الأول", "الثاني", "الثالث"]
};

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

/* ===================================================
   طابور الطلبات – يضمن تسجيل الطلاب بالترتيب
   عند التزامن بين أكثر من مستخدم في نفس الوقت
   =================================================== */
const _studentsQueue = { pending: [], running: false };

function enqueueStudentRequest(fn) {
    return new Promise((resolve, reject) => {
        _studentsQueue.pending.push({ fn, resolve, reject });
        if (!_studentsQueue.running) _drainStudentsQueue();
    });
}

async function _drainStudentsQueue() {
    if (_studentsQueue.running || _studentsQueue.pending.length === 0) return;
    _studentsQueue.running = true;
    const { fn, resolve, reject } = _studentsQueue.pending.shift();
    try {
        resolve(await fn());
    } catch (err) {
        reject(err);
    } finally {
        _studentsQueue.running = false;
        _drainStudentsQueue();
    }
}

/**
 * fetch مع إعادة المحاولة تلقائياً (3 محاولات – 1ث / 2ث / 4ث)
 */
async function fetchStudentWithRetry(url, options, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 || response.status === 503) {
                throw new Error(`HTTP ${response.status}`);
            }
            return response;
        } catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt - 1) * 1000;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastError;
}

let allTeachers = [];
let registeredStudents = [];
let currentEditingStudent = null; // لتخزين بيانات الطالب الجاري تعديله أو حذفه


/* ===================================================
   إدارة الوضع الليلي / النهاري
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

initTheme();

/* ===================================================
   نظام الإشعارات الحديث (Toasts)
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

function showLoading(show, text = "جاري معالجة البيانات...") {
    const overlay = document.getElementById("loadingOverlay");
    const loadingText = document.getElementById("loadingText");
    if (overlay) {
        overlay.style.display = show ? "flex" : "none";
    }
    if (loadingText && text) {
        loadingText.textContent = text;
    }
}

/* ===================================================
   تحديث القوائم والصفوف الدراسية
   =================================================== */
function updateGrades(catId, gradeId) {
    const cat = document.getElementById(catId).value;
    const select = document.getElementById(gradeId);
    select.innerHTML = '<option value="">-- اختر الصف الدراسي --</option>';
    if (cat && gradesData[cat]) {
        gradesData[cat].forEach(g => {
            select.appendChild(new Option(g, g));
        });
    }
}

/* ===================================================
   تحميل قائمة المعلمين المضافين مسبقاً
   =================================================== */
async function loadTeachers() {
    showLoading(true, "جاري تحميل قائمة المعلمين من الخادم...");
    try {
        const res = await fetch(TEACHERS_SCRIPT_URL);
        const teachers = await res.json();
        allTeachers = Array.isArray(teachers) ? teachers : [];

        const teacherSelect = document.getElementById("teacherSelect");
        const filterSelect = document.getElementById("filterTeacherSelect");

        teacherSelect.innerHTML = '<option value="">-- اختر المعلم --</option>';
        filterSelect.innerHTML = '<option value="">-- كل المعلمين --</option>';

        allTeachers.forEach(t => {
            teacherSelect.add(new Option(t, t));
            filterSelect.add(new Option(t, t));
        });

        // تحديث الحسابات بعد تحميل المدرسين
        renderCalculations();
    } catch (e) {
        showToast("حدث خطأ في تحميل قائمة المعلمين من الخادم.", "danger");
    }
    showLoading(false);
}

/* ===================================================
   البحث السريع عن الطالب وسحب بياناته
   =================================================== */
function handleQuickSearch(query) {
    const dropdown = document.getElementById("searchResultsDropdown");
    const clearBtn = document.getElementById("searchClearBtn");

    if (!query || !query.trim()) {
        dropdown.style.display = "none";
        clearBtn.style.display = "none";
        return;
    }

    clearBtn.style.display = "block";
    const normQ = normalizeArabicName(query);

    // البحث في سجل الطلاب المسجلين
    const matches = registeredStudents.filter(s => normalizeArabicName(s.studentName).includes(normQ));

    if (matches.length === 0) {
        dropdown.innerHTML = `
            <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 13px;">
                <i class="fa-solid fa-circle-question" style="margin-left: 6px;"></i>
                لم يتم العثور على طالب باسم "${query}"
            </div>
        `;
        dropdown.style.display = "block";
        return;
    }

    dropdown.innerHTML = matches.map(s => `
        <div class="search-result-item" onclick="selectStudentForEdit(${s.id})">
            <div class="search-result-info">
                <strong><i class="fa-solid fa-user-check" style="color: #10b981;"></i> ${displayNormalizedName(s.studentName)}</strong>
                <span><i class="fa-solid fa-chalkboard-user"></i> أ/ ${s.teacherName} • ${s.category} (${s.grade})</span>
            </div>
            <i class="fa-solid fa-arrow-left" style="color: #6366f1;"></i>
        </div>
    `).join('');

    dropdown.style.display = "block";
}

function clearQuickSearch() {
    const input = document.getElementById("quickSearchInput");
    const dropdown = document.getElementById("searchResultsDropdown");
    const clearBtn = document.getElementById("searchClearBtn");
    if (input) input.value = '';
    if (dropdown) dropdown.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
}

// إغلاق قائمة البحث عند النقر خارجها
document.addEventListener('click', function(e) {
    const searchBox = document.querySelector('.student-search-box');
    const dropdown = document.getElementById("searchResultsDropdown");
    if (searchBox && !searchBox.contains(e.target) && dropdown) {
        dropdown.style.display = "none";
    }
});

/* ===================================================
   تحديد طالب للتعديل أو الحذف وتعبئة الحقول
   =================================================== */
function selectStudentForEdit(id) {
    const student = registeredStudents.find(s => s.id === id);
    if (!student) return;

    currentEditingStudent = { ...student };

    // ملء بيانات الطالب في خانات الإدخال
    document.getElementById("studentNameInput").value = student.studentName;
    document.getElementById("teacherSelect").value = student.teacherName;
    document.getElementById("categorySelect").value = student.category;

    updateGrades('categorySelect', 'gradeSelect');
    document.getElementById("gradeSelect").value = student.grade;

    // إغلاق قائمة البحث
    clearQuickSearch();

    // تفعيل وضع التعديل والحذف
    activateEditMode();

    // الصعود للنموذج بنعومة
    document.querySelector('.container').scrollIntoView({ behavior: 'smooth' });

    showToast(`تم سحب بيانات الطالب (${student.studentName}) بنجاح! تم تفعيل أزرار التعديل والحذف.`, "info");
}

/* ===================================================
   تفعيل وإلغاء وضع التعديل والحذف
   =================================================== */
function activateEditMode() {
    if (!currentEditingStudent) return;

    document.getElementById("editingStatusBadge").style.display = "inline-flex";
    document.getElementById("editingStatusText").textContent = `جاري تعديل/حذف: ${currentEditingStudent.studentName}`;
    document.getElementById("formTitleText").textContent = "تعديل أو حذف بيانات الطالب";

    // إخفاء زر الإضافة الجديد وإظهار أزرار التعديل والحذف
    document.getElementById("btnSaveNew").style.display = "none";
    document.getElementById("btnUpdateStudent").style.display = "inline-flex";
    document.getElementById("btnDeleteStudent").style.display = "inline-flex";
    document.getElementById("btnCancelEdit").style.display = "inline-flex";

    updateDeleteButtonLabel();
}

function updateDeleteButtonLabel() {
    const teacherSelect = document.getElementById("teacherSelect");
    const tName = teacherSelect.value || (currentEditingStudent ? currentEditingStudent.teacherName : "");
    const deleteBtnText = document.getElementById("btnDeleteText");
    if (deleteBtnText) {
        deleteBtnText.textContent = tName ? `حذف الطالب من عند أ/ ${tName}` : "حذف الطالب من عند المعلم المحدد";
    }
}

function handleTeacherSelectChange() {
    updateDeleteButtonLabel();
}

function cancelEditMode() {
    currentEditingStudent = null;

    document.getElementById("editingStatusBadge").style.display = "none";
    document.getElementById("formTitleText").textContent = "بيانات تسجيل وتعديل الطلاب";

    // إعادة ضبط الحقول
    document.getElementById("studentNameInput").value = "";
    document.getElementById("teacherSelect").value = "";
    document.getElementById("categorySelect").value = "";
    updateGrades('categorySelect', 'gradeSelect');

    // إعادة إظهار زر الإضافة
    document.getElementById("btnSaveNew").style.display = "inline-flex";
    document.getElementById("btnUpdateStudent").style.display = "none";
    document.getElementById("btnDeleteStudent").style.display = "none";
    document.getElementById("btnCancelEdit").style.display = "none";
}

/* ===================================================
   إرسال النموذج (حفظ كطالب جديد)
   =================================================== */
async function handleFormSubmit(e) {
    if (e) e.preventDefault();

    // إذا كنا في وضع التعديل، لا نقوم بإضافة جديد
    if (currentEditingStudent) {
        handleUpdateStudent();
        return;
    }

    const nameInput = document.getElementById("studentNameInput");
    const teacherInput = document.getElementById("teacherSelect");
    const categoryInput = document.getElementById("categorySelect");
    const gradeInput = document.getElementById("gradeSelect");

    const sName = displayNormalizedName(nameInput.value.trim());
    const tName = teacherInput.value;
    const cat = categoryInput.value;
    const grade = gradeInput.value;

    if (!sName || !tName || !cat || !grade) {
        showToast("يرجى إكمال جميع بيانات الطالب المطلوبة!", "warning");
        return;
    }

    showLoading(true, `جاري تسجيل الطالب ${sName} مع الأستاذ/ ${tName}...`);

    const now = new Date();
    const formattedDate = now.toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    try {
        const payload = {
            action: "addStudent",
            studentName: sName,
            name: sName,
            teacherName: tName,
            teacher: tName,
            category: cat,
            grade: grade,
            date: formattedDate,
            timestamp: new Date().toISOString()
        };

        // الإرسال عبر الطابور لضمان الترتيب عند التزامن
        await enqueueStudentRequest(() =>
            fetchStudentWithRetry(STUDENTS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify(payload)
            })
        );

        showToast(`تم تسجيل الطالب "${sName}" بنجاح في الشيت الجديد!`, "success");

        const newRecord = {
            id: Date.now(),
            studentName: sName,
            teacherName: tName,
            category: cat,
            grade: grade,
            date: formattedDate
        };

        registeredStudents.unshift(newRecord);
        localStorage.setItem('center_students_records', JSON.stringify(registeredStudents));

        nameInput.value = '';
        categoryInput.value = '';
        updateGrades('categorySelect', 'gradeSelect');
        nameInput.focus();

        renderCalculations();
        renderStudentsTable();

    } catch (err) {
        showToast("حدث خطأ أثناء الاتصال بخادم تسجيل الطلاب.", "danger");
    }

    showLoading(false);
}

/* ===================================================
   تعديل بيانات الطالب
   =================================================== */
async function handleUpdateStudent() {
    if (!currentEditingStudent) {
        showToast("يرجى تحديد الطالب أولاً للتعديل!", "warning");
        return;
    }

    const sName = displayNormalizedName(document.getElementById("studentNameInput").value.trim());
    const tName = document.getElementById("teacherSelect").value;
    const cat = document.getElementById("categorySelect").value;
    const grade = document.getElementById("gradeSelect").value;

    if (!sName || !tName || !cat || !grade) {
        showToast("يرجى إكمال كافة البيانات للتعديل!", "warning");
        return;
    }

    showLoading(true, `جاري تعديل بيانات الطالب ${sName} في الشيت...`);

    try {
        const payload = {
            action: "updateStudent",
            oldStudentName: currentEditingStudent.studentName,
            oldTeacherName: currentEditingStudent.teacherName,
            studentName: sName,
            name: sName,
            teacherName: tName,
            teacher: tName,
            category: cat,
            grade: grade,
            date: new Date().toLocaleDateString('ar-EG')
        };

        await fetch(STUDENTS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // تحديث السجل محلياً
        const index = registeredStudents.findIndex(s => s.id === currentEditingStudent.id);
        if (index !== -1) {
            registeredStudents[index] = {
                ...registeredStudents[index],
                studentName: sName,
                teacherName: tName,
                category: cat,
                grade: grade
            };
            localStorage.setItem('center_students_records', JSON.stringify(registeredStudents));
        }

        showToast(`تم تعديل بيانات الطالب "${sName}" بنجاح!`, "success");

        cancelEditMode();
        renderCalculations();
        renderStudentsTable();

    } catch (err) {
        showToast("حدث خطأ أثناء إرسال طلب التعديل.", "danger");
    }

    showLoading(false);
}

/* ===================================================
   حذف الطالب من عند المعلم المحدد
   =================================================== */
async function handleDeleteStudent() {
    if (!currentEditingStudent) {
        showToast("يرجى اختيار الطالب المراد حذفه!", "warning");
        return;
    }

    const sName = displayNormalizedName(document.getElementById("studentNameInput").value.trim());
    const tName = document.getElementById("teacherSelect").value;
    const cat = document.getElementById("categorySelect").value;
    const grade = document.getElementById("gradeSelect").value;

    if (!confirm(`⚠️ تحذير!\nهل أنت متأكد من حذف الطالب (${sName}) من عند الأستاذ/ (${tName})؟\nسيتم حذفه من هذه المجموعة في الشيت.`)) {
        return;
    }

    showLoading(true, `جاري حذف الطالب ${sName} من عند الأستاذ/ ${tName}...`);

    try {
        const payload = {
            action: "deleteStudent",
            studentName: sName,
            name: sName,
            teacherName: tName,
            teacher: tName,
            category: cat,
            grade: grade
        };

        await fetch(STUDENTS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // حذف السجل محلياً
        registeredStudents = registeredStudents.filter(s => s.id !== currentEditingStudent.id);
        localStorage.setItem('center_students_records', JSON.stringify(registeredStudents));

        showToast(`تم حذف الطالب "${sName}" بنجاح من عند الأستاذ/ ${tName}!`, "success");

        cancelEditMode();
        renderCalculations();
        renderStudentsTable();

    } catch (err) {
        showToast("حدث خطأ أثناء إرسال طلب الحذف.", "danger");
    }

    showLoading(false);
}

/* ===================================================
   حساب وعرض عدد الفئات والصفوف لكل مدرس
   =================================================== */
function renderCalculations() {
    const container = document.getElementById("teachersBreakdownContainer");
    if (!container) return;

    const teachersSet = new Set([...allTeachers, ...registeredStudents.map(s => s.teacherName)]);
    const teachersList = Array.from(teachersSet).filter(Boolean);

    let totalStudents = registeredStudents.length;
    let activeTeachersCount = 0;
    const allCoveredGrades = new Set();

    if (teachersList.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 25px; color: var(--text-muted);">
                <i class="fa-solid fa-chalkboard-user" style="font-size: 32px; margin-bottom: 8px; opacity: 0.6;"></i>
                <p style="margin: 0;">لم يتم العثور على أي معلمين بعد. أضف معلماً من لوحة الإدارة أولاً.</p>
            </div>
        `;
        document.getElementById("totalStudentsCount").textContent = "0";
        document.getElementById("activeTeachersCount").textContent = "0";
        document.getElementById("totalClassesCount").textContent = "0";
        return;
    }

    let cardsHtml = '';

    teachersList.forEach(teacher => {
        const teacherStudents = registeredStudents.filter(s => s.teacherName === teacher);
        const studentCount = teacherStudents.length;

        if (studentCount > 0) activeTeachersCount++;

        const categoriesSet = new Set(teacherStudents.map(s => s.category));
        const categories = Array.from(categoriesSet);

        const gradesSet = new Set(teacherStudents.map(s => `${s.category} (${s.grade})`));
        const grades = Array.from(gradesSet);

        grades.forEach(g => allCoveredGrades.add(g));

        cardsHtml += `
            <div class="teacher-calc-card">
                <div class="teacher-calc-header">
                    <h3>
                        <i class="fa-solid fa-chalkboard-user" style="color: #6366f1;"></i>
                        <span>أ/ ${teacher}</span>
                    </h3>
                    <span class="teacher-student-count-badge">
                        ${studentCount} ${studentCount === 1 ? 'طالب' : 'طلاب'}
                    </span>
                </div>

                <!-- حساب عدد الفئات -->
                <div class="calc-stat-row">
                    <span><i class="fa-solid fa-layer-group"></i> عدد الفئات المسجلة:</span>
                    <span class="badge-pill categories">${categories.length} فئات</span>
                </div>
                ${categories.length > 0 ? `
                    <div class="pills-container">
                        ${categories.map(c => `<span class="tiny-pill">${c}</span>`).join('')}
                    </div>
                ` : `<div style="font-size: 11.5px; color: var(--text-muted);">لا توجد فئات مسجلة بعد</div>`}

                <!-- حساب عدد الصفوف الدراسية -->
                <div class="calc-stat-row" style="margin-top: 4px;">
                    <span><i class="fa-solid fa-book-open"></i> عدد الصفوف الدراسية:</span>
                    <span class="badge-pill grades">${grades.length} صفوف</span>
                </div>
                ${grades.length > 0 ? `
                    <div class="pills-container">
                        ${grades.map(g => `<span class="tiny-pill" style="background: rgba(245, 158, 11, 0.15); color: #d97706;">${g}</span>`).join('')}
                    </div>
                ` : `<div style="font-size: 11.5px; color: var(--text-muted);">لا توجد صفوف مسجلة بعد</div>`}
            </div>
        `;
    });

    container.innerHTML = cardsHtml;

    document.getElementById("totalStudentsCount").textContent = totalStudents;
    document.getElementById("activeTeachersCount").textContent = activeTeachersCount;
    document.getElementById("totalClassesCount").textContent = allCoveredGrades.size;
}

/* ===================================================
   عرض وتصفية جدول الطلاب المسجلين
   =================================================== */
function renderStudentsTable(filterText = '', filterTeacher = '') {
    const tbody = document.getElementById("studentsTableBody");
    if (!tbody) return;

    let filtered = registeredStudents;

    if (filterText) {
        const q = filterText.toLowerCase().trim();
        filtered = filtered.filter(s => s.studentName.toLowerCase().includes(q));
    }

    if (filterTeacher) {
        filtered = filtered.filter(s => s.teacherName === filterTeacher);
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 25px; color: var(--text-muted);">
                    لا توجد بيانات طلاب مسجلة مطابقة للبحث
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((s, index) => {
        let catClass = 'cat-ibtedai';
        if (s.category === 'اعدادي') catClass = 'cat-edadi';
        if (s.category === 'ثانوي') catClass = 'cat-thanawy';

        return `
            <tr>
                <td><strong>${index + 1}</strong></td>
                <td><strong style="color: var(--text-title);">${s.studentName}</strong></td>
                <td>أ/ ${s.teacherName}</td>
                <td><span class="badge-cat ${catClass}">${s.category}</span></td>
                <td>الصف ${s.grade}</td>
                <td style="font-size: 12px; color: var(--text-muted);">${s.date}</td>
                <td style="text-align: center;">
                    <button type="button" class="btn-edit-record" onclick="selectStudentForEdit(${s.id})" title="تعديل أو سحب بيانات الطالب">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" class="btn-del-record" onclick="deleteStudentRecordDirect(${s.id})" title="حذف الطالب">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterStudentsTable() {
    const text = document.getElementById("searchStudentInput").value;
    const teacher = document.getElementById("filterTeacherSelect").value;
    renderStudentsTable(text, teacher);
}

function deleteStudentRecordDirect(id) {
    const student = registeredStudents.find(s => s.id === id);
    if (!student) return;

    selectStudentForEdit(id);
    handleDeleteStudent();
}

async function loadStudentsFromSheet() {
    try {
        const res = await fetch(STUDENTS_SCRIPT_URL);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            registeredStudents = data.map((item, index) => ({
                id: item.id || (Date.now() + index),
                studentName: item.studentName || item.name,
                teacherName: item.teacherName || item.teacher,
                category: item.category,
                grade: item.grade,
                date: item.date || ""
            }));
            localStorage.setItem('center_students_records', JSON.stringify(registeredStudents));
            renderCalculations();
            renderStudentsTable();
        }
    } catch (e) {
        // يتم الاعتماد على السجل المحلي في حال كان doGet قيد التحديث
    }
}

/* ===================================================
   تشغيل عند تحميل الصفحة
   =================================================== */
window.onload = function() {
    try {
        const saved = localStorage.getItem('center_students_records');
        registeredStudents = saved ? JSON.parse(saved) : [];
    } catch (e) {
        registeredStudents = [];
    }

    loadTeachers();
    renderCalculations();
    renderStudentsTable();
    loadStudentsFromSheet();
};

