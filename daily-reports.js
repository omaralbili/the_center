/**
 * ==============================================================================
 * daily-reports.js — التقارير اليومية للمدفوعات والتحصيل
 * نظام إدارة السنتر
 * ==============================================================================
 */

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";
const STORAGE_KEY = "center_txs_cache";

// المتغيرات العامة
let allTransactions = [];
let filteredTransactions = [];
let currentSelectedDate = "";

/* ===================================================
   إدارة الثيم (ليلي / نهاري)
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

/* ===================================================
   توحيد وتطبيع الأسماء العربية
   =================================================== */
function normalizeArabicName(name) {
    if (!name || typeof name !== 'string') return '';
    return name
        .trim()
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0670]/g, '') // التشكيل
        .replace(/عبد\s+/g, 'عبد')
        .replace(/أبو\s+/g, 'أبو')
        .replace(/ابو\s+/g, 'أبو')
        .replace(/[إأآا]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه')
        .replace(/\s+/g, ' ');
}

function displayNormalizedName(name) {
    if (!name || typeof name !== 'string') return '';
    let n = name.trim().replace(/\s+/g, ' ');
    n = n.replace(/عبد\s+/g, 'عبد');
    n = n.replace(/ابو\s+/g, 'أبو');
    return n;
}

/* ===================================================
   تطبيع التواريخ والأوقات
   =================================================== */
function normalizeToYMD(dateStr) {
    if (!dateStr) return '';
    const cleanStr = String(dateStr).replace(/\([^\)]*\)/g, '').trim();
    const d = new Date(cleanStr);
    if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    // محاولات Regex في حال فشل Date
    const mIso = cleanStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (mIso) return `${mIso[1]}-${mIso[2].padStart(2, '0')}-${mIso[3].padStart(2, '0')}`;
    const mSlash = cleanStr.match(/(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
    if (mSlash) return `${mSlash[3]}-${mSlash[2].padStart(2, '0')}-${mSlash[1].padStart(2, '0')}`;
    return '';
}

function formatDisplayTime(dateStr) {
    if (!dateStr) return '--:--';
    try {
        const cleanStr = String(dateStr).replace(/\([^\)]*\)/g, '').trim();
        const d = new Date(cleanStr);
        if (!isNaN(d.getTime())) {
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'م' : 'ص';
            hours = hours % 12;
            hours = hours ? hours : 12;
            return `${hours}:${minutes} ${ampm}`;
        }
    } catch (_) {}
    return '--:--';
}

function formatFullArabicDate(ymd) {
    if (!ymd) return '';
    try {
        const parts = ymd.split('-');
        if (parts.length === 3) {
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            const days = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
            const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            return `${days[d.getDay()]}، ${parseInt(parts[2], 10)} ${months[d.getMonth()]} ${parts[0]}`;
        }
    } catch (_) {}
    return ymd;
}

/* ===================================================
   تحميل المعاملات من الكاش والخادم
   =================================================== */
async function loadTransactionsData(forceRefresh = false) {
    showLoading(true);

    // 1. القراءة الفورية من الكاش أولاً للسرعة القصوى
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached && !forceRefresh) {
        try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                processRawTransactions(parsed);
                renderReport();
            }
        } catch (_) {}
    }

    // 2. الجلب الحي من Google Sheet
    try {
        const url = `${SCRIPT_URL}?action=getTransactions&t=${Date.now()}`;
        const res = await fetch(url, { redirect: 'follow' });
        const data = await res.json();

        let list = [];
        if (Array.isArray(data)) {
            list = data;
        } else if (data && Array.isArray(data.transactions)) {
            list = data.transactions;
        }

        if (list.length > 0) {
            processRawTransactions(list);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
            populateTeachersDropdown();
            renderReport();
        } else if (!cached) {
            allTransactions = [];
            renderReport();
        }
    } catch (err) {
        console.warn("Could not fetch fresh transactions:", err);
        if (!cached || allTransactions.length === 0) {
            showToast("تعذر الاتصال بالخادم، يرجى التحقق من اتصال الإنترنت.", "warning");
        }
    }

    showLoading(false);
}

function processRawTransactions(rawList) {
    allTransactions = rawList.map((t, idx) => {
        const sName = (t.studentName || t['اسم الطالب'] || '').toString().trim();
        const tName = (t.teacherName || t['المعلم'] || '').toString().trim();
        const cat = (t.category || t['الفئة'] || '').toString().trim();
        const grd = (t.grade || t['الصف'] || '').toString().trim();
        const amt = parseFloat(t.amount || t['المبلغ'] || '0') || 0;
        const dRaw = (t.date || t['التاريخ'] || '').toString().trim();
        const fLink = (t.fileLink || t['رابط الإيصال'] || '').toString().trim();

        return {
            id: idx + 1,
            studentName: sName,
            normStudentName: normalizeArabicName(sName),
            teacherName: tName,
            category: cat,
            grade: grd,
            amount: amt,
            rawDate: dRaw,
            dateYMD: normalizeToYMD(dRaw),
            timeStr: formatDisplayTime(dRaw),
            fileLink: fLink
        };
    });
}

/* ===================================================
   إدارة التاريخ والتصفية
   =================================================== */
function initDatePicker() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    currentSelectedDate = `${y}-${m}-${d}`;

    const input = document.getElementById("reportDateInput");
    if (input) {
        input.value = currentSelectedDate;
    }
    updateQuickButtonsState(0);
}

function onDateChange(newVal) {
    if (!newVal) return;
    currentSelectedDate = newVal;
    checkAndHighlightQuickButton();
    renderReport();
}

function shiftDay(offset) {
    if (!currentSelectedDate) return;
    const parts = currentSelectedDate.split('-');
    const cur = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    cur.setDate(cur.getDate() + offset);

    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    currentSelectedDate = `${y}-${m}-${d}`;

    const input = document.getElementById("reportDateInput");
    if (input) input.value = currentSelectedDate;

    checkAndHighlightQuickButton();
    renderReport();
}

function selectQuickDate(dayOffset) {
    const cur = new Date();
    cur.setDate(cur.getDate() + dayOffset);

    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    currentSelectedDate = `${y}-${m}-${d}`;

    const input = document.getElementById("reportDateInput");
    if (input) input.value = currentSelectedDate;

    updateQuickButtonsState(dayOffset);
    renderReport();
}

function updateQuickButtonsState(offset) {
    const btnToday = document.getElementById("btnToday");
    const btnYest = document.getElementById("btnYesterday");
    const btnTwo = document.getElementById("btnTwoDaysAgo");

    if (btnToday) btnToday.classList.toggle("active", offset === 0);
    if (btnYest) btnYest.classList.toggle("active", offset === -1);
    if (btnTwo) btnTwo.classList.toggle("active", offset === -2);
}

function checkAndHighlightQuickButton() {
    const now = new Date();
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const yestYMD = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;

    const two = new Date();
    two.setDate(two.getDate() - 2);
    const twoYMD = `${two.getFullYear()}-${String(two.getMonth() + 1).padStart(2, '0')}-${String(two.getDate()).padStart(2, '0')}`;

    let offset = null;
    if (currentSelectedDate === todayYMD) offset = 0;
    else if (currentSelectedDate === yestYMD) offset = -1;
    else if (currentSelectedDate === twoYMD) offset = -2;

    updateQuickButtonsState(offset);
}

function populateTeachersDropdown() {
    const select = document.getElementById("teacherFilterSelect");
    if (!select) return;

    const currentVal = select.value;
    const teachersSet = new Set();
    allTransactions.forEach(t => {
        if (t.teacherName) teachersSet.add(t.teacherName);
    });

    const sortedTeachers = Array.from(teachersSet).sort();
    let html = '<option value="">-- جميع المعلمين --</option>';
    sortedTeachers.forEach(t => {
        html += `<option value="${t}">${t}</option>`;
    });

    select.innerHTML = html;
    if (currentVal && teachersSet.has(currentVal)) {
        select.value = currentVal;
    }
}

function applyFilters() {
    renderReport();
}

function resetFilters() {
    const tSel = document.getElementById("teacherFilterSelect");
    const cSel = document.getElementById("categoryFilterSelect");
    const sInput = document.getElementById("searchInput");

    if (tSel) tSel.value = "";
    if (cSel) cSel.value = "";
    if (sInput) sInput.value = "";

    renderReport();
}

function refreshDailyData() {
    loadTransactionsData(true);
}

/* ===================================================
   توليد ورسم التقرير
   =================================================== */
function renderReport() {
    if (!currentSelectedDate) return;

    const teacherFilter = document.getElementById("teacherFilterSelect") ? document.getElementById("teacherFilterSelect").value.trim() : "";
    const categoryFilter = document.getElementById("categoryFilterSelect") ? document.getElementById("categoryFilterSelect").value.trim() : "";
    const searchRaw = document.getElementById("searchInput") ? document.getElementById("searchInput").value.trim() : "";
    const normSearch = normalizeArabicName(searchRaw);

    // تصفية المعاملات حسب اليوم المختار والفلاتر
    filteredTransactions = allTransactions.filter(t => {
        // شرط التاريخ الرئيسي
        if (t.dateYMD !== currentSelectedDate) return false;

        // فلتر المعلم
        if (teacherFilter && t.teacherName !== teacherFilter) return false;

        // فلتر الفئة / المرحلة
        if (categoryFilter && t.category !== categoryFilter) return false;

        // فلتر البحث بالاسم
        if (normSearch) {
            const matchStudent = t.normStudentName.includes(normSearch);
            const matchTeacher = normalizeArabicName(t.teacherName).includes(normSearch);
            if (!matchStudent && !matchTeacher) return false;
        }

        return true;
    });

    // تحديث إحصائيات الـ KPIs
    updateKpis();

    // تحديث بطاقات توزيع إيراد المدرسين
    renderTeachersBreakdown();

    // تحديث جدول المعاملات
    renderTable();

    // تحديث الترويسة المطبوعة
    updatePrintHeaders();
}

function updateKpis() {
    let totalRevenue = 0;
    const distinctStudents = new Set();
    const activeTeachers = new Set();

    filteredTransactions.forEach(t => {
        totalRevenue += t.amount;
        if (t.normStudentName) distinctStudents.add(t.normStudentName);
        if (t.teacherName) activeTeachers.add(t.teacherName);
    });

    const elTotal = document.getElementById("kpiTotalRevenue");
    const elTxs = document.getElementById("kpiTotalTransactions");
    const elStudents = document.getElementById("kpiDistinctStudents");
    const elTeachers = document.getElementById("kpiActiveTeachers");
    const elBadge = document.getElementById("tableCountBadge");

    if (elTotal) elTotal.textContent = `${totalRevenue.toLocaleString('en-US')} ج.م`;
    if (elTxs) elTxs.textContent = filteredTransactions.length;
    if (elStudents) elStudents.textContent = distinctStudents.size;
    if (elTeachers) elTeachers.textContent = activeTeachers.size;
    if (elBadge) elBadge.textContent = `${filteredTransactions.length} عملية دفع`;
}

function renderTeachersBreakdown() {
    const container = document.getElementById("teachersChipsContainer");
    const summarySpan = document.getElementById("teachersCountSummary");
    const section = document.getElementById("teachersBreakdownSection");
    if (!container) return;

    if (filteredTransactions.length === 0) {
        if (section) section.style.display = "none";
        return;
    }

    if (section) section.style.display = "block";

    // تجميع المبالغ حسب كل معلم
    const teachersMap = new Map();
    filteredTransactions.forEach(t => {
        const name = t.teacherName || "غير محدد";
        if (!teachersMap.has(name)) {
            teachersMap.set(name, { count: 0, amount: 0 });
        }
        const obj = teachersMap.get(name);
        obj.count += 1;
        obj.amount += t.amount;
    });

    // ترتيب المعلمين حسب الإيراد تنازلياً
    const sorted = Array.from(teachersMap.entries()).sort((a, b) => b[1].amount - a[1].amount);

    if (summarySpan) {
        summarySpan.textContent = `(${sorted.length} معلمين)`;
    }

    let html = "";
    sorted.forEach(([tName, data]) => {
        html += `
        <div class="teacher-revenue-chip" onclick="filterByTeacherDirect('${tName.replace(/'/g, "\\'")}')" style="cursor: pointer;" title="انقر لتصفية الجدول لهذا المعلم فقط">
            <i class="fa-solid fa-chalkboard-user" style="color: var(--cyan-primary);"></i>
            <span class="teacher-name-txt">${tName}</span>
            <span class="teacher-amount-badge">${data.amount.toLocaleString('en-US')} ج.م</span>
            <span class="teacher-count-badge">${data.count} طلاب</span>
        </div>
        `;
    });

    container.innerHTML = html;
}

function filterByTeacherDirect(teacherName) {
    const sel = document.getElementById("teacherFilterSelect");
    if (sel) {
        sel.value = teacherName;
        applyFilters();
    }
}

function renderTable() {
    const tbody = document.getElementById("reportTableBody");
    const emptyState = document.getElementById("emptyReportState");
    const table = document.getElementById("dailyReportTable");
    if (!tbody) return;

    if (filteredTransactions.length === 0) {
        tbody.innerHTML = "";
        if (table) table.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (table) table.style.display = "table";
    if (emptyState) emptyState.style.display = "none";

    let html = "";
    filteredTransactions.forEach((t, idx) => {
        const hasReceipt = t.fileLink && t.fileLink !== "لا يوجد إيصال" && t.fileLink.startsWith("http");
        let receiptHtml = `<span style="color: var(--text-muted); font-size: 11px;">بدون إيصال</span>`;
        if (hasReceipt) {
            receiptHtml = `
            <button type="button" class="btn-view-receipt-mini" onclick="openReceiptModal('${t.fileLink}')" title="معاينة إيصال الدفع">
                <i class="fa-solid fa-image"></i>
                <span>عرض</span>
            </button>
            `;
        }

        html += `
        <tr>
            <td style="font-weight: 700; color: var(--text-muted);">${idx + 1}</td>
            <td class="table-time-cell"><i class="fa-regular fa-clock" style="color: var(--cyan-primary);"></i> ${t.timeStr}</td>
            <td style="font-weight: 700;">${displayNormalizedName(t.studentName)}</td>
            <td><span style="font-weight: 600; color: #4338ca;"><i class="fa-solid fa-user-tie" style="font-size: 11px;"></i> ${t.teacherName || '-'}</span></td>
            <td>${t.category || '-'}</td>
            <td>${t.grade || '-'}</td>
            <td class="table-amount-cell">${t.amount.toLocaleString('en-US')} ج.م</td>
            <td class="hide-on-print" style="text-align: center;">${receiptHtml}</td>
        </tr>
        `;
    });

    tbody.innerHTML = html;
}

function updatePrintHeaders() {
    const printDate = document.getElementById("printReportDateTxt");
    const printTime = document.getElementById("printGeneratedTimeTxt");
    const printTotal = document.getElementById("printTotalAmountTxt");

    let total = 0;
    filteredTransactions.forEach(t => total += t.amount);

    if (printDate) printDate.textContent = formatFullArabicDate(currentSelectedDate);
    if (printTime) {
        const now = new Date();
        const dStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
        const tStr = formatDisplayTime(now);
        printTime.textContent = `${dStr} - ${tStr}`;
    }
    if (printTotal) printTotal.textContent = `${total.toLocaleString('en-US')} ج.م (${filteredTransactions.length} معاملة)`;
}

/* ===================================================
   الطباعة وتصدير الإكسيل
   =================================================== */
function printReport() {
    updatePrintHeaders();
    window.print();
}

function exportToCsv() {
    if (filteredTransactions.length === 0) {
        showToast("لا توجد بيانات لتصديرها في هذا التاريخ!", "warning");
        return;
    }

    const headers = ["م", "وقت الدفع", "اسم الطالب", "المعلم", "المرحلة", "الصف", "المبلغ", "رابط الإيصال"];
    const rows = filteredTransactions.map((t, idx) => [
        idx + 1,
        `"${t.timeStr}"`,
        `"${displayNormalizedName(t.studentName)}"`,
        `"${t.teacherName}"`,
        `"${t.category}"`,
        `"${t.grade}"`,
        t.amount,
        `"${t.fileLink || ''}"`
    ]);

    let csvContent = "\uFEFF"; // UTF-8 BOM لضمان قراءة الحروف العربية بدقة في Excel
    csvContent += headers.join(",") + "\r\n";
    rows.forEach(r => {
        csvContent += r.join(",") + "\r\n";
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `تقرير_مدفوعات_${currentSelectedDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("تم تصدير ملف Excel بنجاح!", "success");
}

/* ===================================================
   نافذة معاينة الإيصال (Modal)
   =================================================== */
function extractDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const m = url.match(/[-\w]{25,}/);
    return (m && m[0]) ? m[0] : '';
}

function openReceiptModal(url) {
    if (!url) return;
    const modal = document.getElementById("receiptPreviewModal");
    const img = document.getElementById("modalReceiptImg");
    const fallback = document.getElementById("modalReceiptFallback");
    const fallbackLink = document.getElementById("modalFallbackLink");
    const externalLink = document.getElementById("modalExternalLink");

    if (modal) {
        const fileId = extractDriveFileId(url);

        if (fallback) fallback.style.display = "none";
        if (img) {
            img.style.display = "block";
            img.src = fileId ? `https://lh3.googleusercontent.com/d/${fileId}=s1600` : url;
        }

        if (fallbackLink) fallbackLink.href = url;
        if (externalLink) externalLink.href = url;

        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    }
}

function onReceiptImgError() {
    const img = document.getElementById("modalReceiptImg");
    const fallback = document.getElementById("modalReceiptFallback");
    if (img) img.style.display = "none";
    if (fallback) fallback.style.display = "block";
}

function closeReceiptModal(e) {
    const modal = document.getElementById("receiptPreviewModal");
    if (modal && (!e || e.target === modal)) {
        closeReceiptModalDirect();
    }
}

function closeReceiptModalDirect() {
    const modal = document.getElementById("receiptPreviewModal");
    if (modal) {
        modal.style.display = "none";
        document.body.style.overflow = "";
        const img = document.getElementById("modalReceiptImg");
        if (img) img.src = "";
    }
}

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeReceiptModalDirect();
});

/* ===================================================
   إشعارات التوست وشاشة التحميل
   =================================================== */
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';
    if (type === 'danger')  iconClass = 'fa-circle-xmark';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'toastOut 0.4s ease forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
        overlay.style.display = show ? "flex" : "none";
    }
}

/* ===================================================
   البدء عند تشغيل الصفحة
   =================================================== */
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initDatePicker();
    loadTransactionsData();
});

