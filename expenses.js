/* ===================================================
   expenses.js — إدارة المصروفات والمخرجات
   ربط قاعدة بيانات Google Sheets مع واجهة المستخدم
   =================================================== */

// رابط تطبيق الويب الخاص بقاعدة بيانات المصروفات (Google Apps Script)
const EXPENSES_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby8rseGsfAQYgSe-6L8xIYOjU4sjwVoxteagXsae_P0LGYhAGk_M9CPmy1_GnZmGUtX/exec";

// مفتاح التخزين المؤقت المحلي
const STORAGE_KEY = "center_expenses_cache";

// المتغيرات العامة لحفظ الحالة
let allExpenses = [];
let filteredExpenses = [];
let isEditing = false;

// طابور الطلبات المتسلسل لمنع التداخل والتعارض
const _expensesQueue = { pending: [], running: false };

function enqueueExpenses(fn) {
    return new Promise((resolve, reject) => {
        _expensesQueue.pending.push({ fn, resolve, reject });
        if (!_expensesQueue.running) _drainExpensesQueue();
    });
}

async function _drainExpensesQueue() {
    if (_expensesQueue.running || _expensesQueue.pending.length === 0) return;
    _expensesQueue.running = true;
    const { fn, resolve, reject } = _expensesQueue.pending.shift();
    try {
        resolve(await fn());
    } catch (err) {
        reject(err);
    } finally {
        _expensesQueue.running = false;
        _drainExpensesQueue();
    }
}

// دالة إرسال الطلبات مع إعادة المحاولة التلقائية
async function expensesFetch(url, options = {}, retries = 3) {
    let lastErr;
    for (let i = 1; i <= retries; i++) {
        try {
            const res = await fetch(url, options);
            if (res.status === 429 || res.status === 503) {
                throw new Error(`HTTP ${res.status}`);
            }
            return res;
        } catch (e) {
            lastErr = e;
            if (i < retries) {
                await new Promise(r => setTimeout(r, Math.pow(2, i - 1) * 1000));
            }
        }
    }
    throw lastErr;
}

// ───────────────────────────────────────────────────
// التهيئة عند تحميل الصفحة
// ───────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    setDefaultDate();
    loadCachedExpenses();
    fetchExpensesFromSheet();
});

// تعيين تاريخ اليوم كافتراضي في حقل الإدخال
function setDefaultDate() {
    const today = new Date().toISOString().split("T")[0];
    const dateInput = document.getElementById("expenseDate");
    if (dateInput) dateInput.value = today;
}

// ───────────────────────────────────────────────────
// إدارة الوضع الليلي / الفاتح
// ───────────────────────────────────────────────────
function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
    updateThemeButtonText(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    updateThemeButtonText(newTheme);
}

function updateThemeButtonText(theme) {
    const btn = document.querySelector(".theme-toggle-btn");
    if (!btn) return;
    if (theme === "dark") {
        btn.innerHTML = '<i class="fa-solid fa-sun"></i> <span>الوضع النهاري</span>';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-moon"></i> <span>الوضع الليلي</span>';
    }
}

// ───────────────────────────────────────────────────
// شاشة التحميل والإشعارات (Toast & Loading)
// ───────────────────────────────────────────────────
function showLoading(show, message = "جاري معالجة البيانات، يرجى الانتظار...") {
    const overlay = document.getElementById("loadingOverlay");
    const textEl = document.getElementById("loadingText");
    if (!overlay) return;
    if (textEl) textEl.textContent = message;
    overlay.style.display = show ? "flex" : "none";
}

function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) {
        alert(message);
        return;
    }
    const toast = document.createElement("div");
    toast.className = `toast-item toast-${type}`;
    
    let icon = "fa-circle-check";
    if (type === "error") icon = "fa-circle-xmark";
    else if (type === "warning") icon = "fa-triangle-exclamation";
    else if (type === "info") icon = "fa-circle-info";

    toast.innerHTML = `
        <i class="fa-solid ${icon}"></i>
        <div class="toast-message">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("toast-hiding");
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// ───────────────────────────────────────────────────
// قراءة وتخزين مؤقت للبيانات
// ───────────────────────────────────────────────────
function loadCachedExpenses() {
    try {
        const cached = localStorage.getItem(STORAGE_KEY);
        if (cached) {
            allExpenses = JSON.parse(cached);
            applyFilters();
        }
    } catch (e) {
        console.warn("فشل قراءة كاش المصروفات", e);
    }
}

function saveExpensesCache(records) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    } catch (e) {
        console.warn("فشل حفظ كاش المصروفات", e);
    }
}

// ───────────────────────────────────────────────────
// جلب البيانات من Google Apps Script
// ───────────────────────────────────────────────────
async function fetchExpensesFromSheet(showFeedback = false) {
    if (showFeedback) showLoading(true, "جاري تحديث سجل المصروفات من قاعدة البيانات...");
    
    try {
        const res = await expensesFetch(`${EXPENSES_SCRIPT_URL}?action=getExpenses`, {
            redirect: "follow"
        });
        
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error("رد غير صالح من السيرفر:", text);
            throw new Error("استجابة غير صحيحة من السيرفر.");
        }

        if (data.status === "error") {
            throw new Error(data.message || "حدث خطأ أثناء جلب البيانات.");
        }

        allExpenses = Array.isArray(data.records) ? data.records : [];
        saveExpensesCache(allExpenses);
        applyFilters();

        if (showFeedback) {
            showToast("تم تحديث البيانات بنجاح من قاعدة البيانات ✅", "success");
        }
    } catch (err) {
        console.error("خطأ جلب المصروفات:", err);
        if (showFeedback) {
            showToast("تعذر جلب البيانات من السيرفر: " + err.message, "error");
        }
        // في حالة الفشل، إذا كان الكاش فارغاً، نعرض رسالة فارغة
        if (allExpenses.length === 0) {
            renderEmptyState("تعذر الاتصال بقاعدة البيانات. تأكد من إعدادات النشر أو أعد المحاولة لاحقاً.");
        }
    } finally {
        if (showFeedback) showLoading(false);
    }
}

// ───────────────────────────────────────────────────
// معالجة إرسال النموذج (إضافة / تعديل)
// ───────────────────────────────────────────────────
async function handleFormSubmit(event) {
    event.preventDefault();

    const dateVal = document.getElementById("expenseDate").value.trim();
    const amountVal = parseFloat(document.getElementById("expenseAmount").value);
    const titleVal = document.getElementById("expenseTitle").value.trim();
    const categoryVal = document.getElementById("expenseCategory").value.trim();
    const spentByVal = document.getElementById("expenseSpentBy").value.trim();
    const notesVal = document.getElementById("expenseNotes").value.trim();
    const editingId = document.getElementById("editingRowId").value.trim();

    if (!dateVal || isNaN(amountVal) || amountVal <= 0 || !titleVal || !categoryVal) {
        showToast("يرجى ملء كافة الحقول الأساسية بشكل صحيح.", "warning");
        return;
    }

    const payload = {
        action: editingId ? "updateExpense" : "addExpense",
        rowId: editingId || undefined,
        date: dateVal,
        amount: amountVal,
        title: titleVal,
        category: categoryVal,
        spentBy: spentByVal,
        notes: notesVal
    };

    const loadingMsg = editingId 
        ? "جاري حفظ تعديل المصروف في الشيت..." 
        : "جاري إضافة المصروف إلى الشيت...";
    
    showLoading(true, loadingMsg);

    try {
        const res = await enqueueExpenses(() => expensesFetch(EXPENSES_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify(payload)
        }));

        const resText = await res.text();
        let result;
        try {
            result = JSON.parse(resText);
        } catch (e) {
            throw new Error("استجابة غير متوقعة من السيرفر: " + resText.substring(0, 100));
        }

        if (result.status === "error") {
            throw new Error(result.message || "حدث خطأ أثناء حفظ المصروف.");
        }

        showToast(editingId ? "تم تعديل المصروف بنجاح ✅" : "تم تسجيل المصروف بنجاح ✅", "success");

        // تحديث محلي سريع أو إعادة جلب
        if (editingId) {
            const index = allExpenses.findIndex(item => item.rowId === editingId);
            if (index !== -1) {
                allExpenses[index] = {
                    ...allExpenses[index],
                    date: dateVal,
                    amount: amountVal,
                    title: titleVal,
                    category: categoryVal,
                    spentBy: spentByVal,
                    notes: notesVal
                };
            }
            cancelEditMode();
        } else {
            const newRecord = {
                rowId: result.rowId || ("EXP-" + Date.now()),
                date: dateVal,
                amount: amountVal,
                title: titleVal,
                category: categoryVal,
                spentBy: spentByVal,
                notes: notesVal,
                timestamp: new Date().toLocaleString("ar-EG")
            };
            allExpenses.unshift(newRecord);
            resetForm();
        }

        saveExpensesCache(allExpenses);
        applyFilters();

    } catch (err) {
        console.error("فشل حفظ المصروف:", err);
        showToast("فشل الحفظ: " + err.message, "error");
    } finally {
        showLoading(false);
    }
}

// ───────────────────────────────────────────────────
// بدء وإلغاء وضع التعديل
// ───────────────────────────────────────────────────
function startEditExpense(rowId) {
    const expense = allExpenses.find(item => item.rowId === rowId);
    if (!expense) return;

    isEditing = true;
    document.getElementById("editingRowId").value = expense.rowId;
    document.getElementById("expenseDate").value = expense.date;
    document.getElementById("expenseAmount").value = expense.amount;
    document.getElementById("expenseTitle").value = expense.title;
    document.getElementById("expenseCategory").value = expense.category;
    document.getElementById("expenseSpentBy").value = expense.spentBy || "";
    document.getElementById("expenseNotes").value = expense.notes || "";

    // تغيير نصوص الواجهة
    document.getElementById("formTitleText").textContent = "تعديل بيانات المصروف";
    document.getElementById("btnSubmitText").textContent = "حفظ التعديلات في الشيت";
    document.getElementById("btnCancelEdit").style.display = "inline-flex";
    document.getElementById("editBanner").classList.add("active");

    // التمرير لأعلى النموذج
    document.getElementById("expenseFormSection").scrollIntoView({ behavior: "smooth" });
}

function cancelEditMode() {
    isEditing = false;
    resetForm();
    document.getElementById("formTitleText").textContent = "تسجيل مصروف جديد";
    document.getElementById("btnSubmitText").textContent = "حفظ المصروف في الشيت";
    document.getElementById("btnCancelEdit").style.display = "none";
    document.getElementById("editBanner").classList.remove("active");
}

function resetForm() {
    document.getElementById("editingRowId").value = "";
    document.getElementById("expenseAmount").value = "";
    document.getElementById("expenseTitle").value = "";
    document.getElementById("expenseCategory").value = "";
    document.getElementById("expenseSpentBy").value = "";
    document.getElementById("expenseNotes").value = "";
    setDefaultDate();
}

// ───────────────────────────────────────────────────
// حذف مصروف
// ───────────────────────────────────────────────────
async function deleteExpense(rowId, title) {
    if (!confirm(`هل أنت متأكد من حذف هذا المصروف: "${title}"؟`)) {
        return;
    }

    showLoading(true, "جاري حذف المصروف من قاعدة البيانات...");

    try {
        const res = await enqueueExpenses(() => expensesFetch(EXPENSES_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "deleteExpense",
                rowId: rowId
            })
        }));

        const resText = await res.text();
        let result;
        try {
            result = JSON.parse(resText);
        } catch (e) {
            throw new Error("استجابة غير صحيحة من السيرفر: " + resText.substring(0, 100));
        }

        if (result.status === "error") {
            throw new Error(result.message || "حدث خطأ أثناء الحذف.");
        }

        showToast("تم حذف المصروف بنجاح 🗑️", "success");

        allExpenses = allExpenses.filter(item => item.rowId !== rowId);
        saveExpensesCache(allExpenses);
        applyFilters();

        if (document.getElementById("editingRowId").value === rowId) {
            cancelEditMode();
        }

    } catch (err) {
        console.error("فشل حذف المصروف:", err);
        showToast("تعذر حذف المصروف: " + err.message, "error");
    } finally {
        showLoading(false);
    }
}

// ───────────────────────────────────────────────────
// تصفية وعرض البيانات في الجدول
// ───────────────────────────────────────────────────
function applyFilters() {
    const searchText = (document.getElementById("filterSearch")?.value || "").trim().toLowerCase();
    const category = (document.getElementById("filterCategory")?.value || "").trim();
    const fromDate = document.getElementById("filterFromDate")?.value || "";
    const toDate = document.getElementById("filterToDate")?.value || "";

    filteredExpenses = allExpenses.filter(item => {
        // فلتر البحث النصي
        if (searchText) {
            const inTitle = (item.title || "").toLowerCase().includes(searchText);
            const inSpentBy = (item.spentBy || "").toLowerCase().includes(searchText);
            const inNotes = (item.notes || "").toLowerCase().includes(searchText);
            if (!inTitle && !inSpentBy && !inNotes) return false;
        }

        // فلتر التصنيف
        if (category && item.category !== category) {
            return false;
        }

        // فلتر التواريخ
        if (fromDate && item.date < fromDate) {
            return false;
        }
        if (toDate && item.date > toDate) {
            return false;
        }

        return true;
    });

    renderTable();
    updateStatistics();
}

function resetFilters() {
    document.getElementById("filterSearch").value = "";
    document.getElementById("filterCategory").value = "";
    document.getElementById("filterFromDate").value = "";
    document.getElementById("filterToDate").value = "";
    applyFilters();
}

function renderTable() {
    const tbody = document.getElementById("expensesTableBody");
    if (!tbody) return;

    if (filteredExpenses.length === 0) {
        renderEmptyState("لا توجد مصروفات تطابق اختياراتك حالياً.");
        return;
    }

    let rowsHtml = "";
    filteredExpenses.forEach((item, index) => {
        const catClass = getCategoryClass(item.category);
        const safeTitle = escapeHtml(item.title);
        const safeSpentBy = escapeHtml(item.spentBy || "-");
        const safeNotes = escapeHtml(item.notes || "-");
        const safeRowId = escapeHtml(item.rowId);

        rowsHtml += `
            <tr>
                <td style="text-align: center; color: var(--text-muted); font-weight: 600;">${index + 1}</td>
                <td style="font-weight: 600; white-space: nowrap;">${item.date}</td>
                <td style="font-weight: 700;">${safeTitle}</td>
                <td><span class="cat-tag ${catClass}">${escapeHtml(item.category)}</span></td>
                <td><span class="table-amount">${formatCurrency(item.amount)}</span> ج.م</td>
                <td>${safeSpentBy}</td>
                <td style="color: var(--text-secondary); font-size: 13px;">${safeNotes}</td>
                <td style="text-align: center; white-space: nowrap;">
                    <button type="button" class="action-icon-btn edit" onclick="startEditExpense('${safeRowId}')" title="تعديل هذا السجل">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    <button type="button" class="action-icon-btn delete" onclick="deleteExpense('${safeRowId}', '${safeTitle.replace(/'/g, "\\'")}')" title="حذف هذا السجل">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

function renderEmptyState(message) {
    const tbody = document.getElementById("expensesTableBody");
    if (!tbody) return;
    tbody.innerHTML = `
        <tr>
            <td colspan="8" class="empty-placeholder">
                <i class="fa-solid fa-receipt"></i>
                <p>${escapeHtml(message)}</p>
            </td>
        </tr>
    `;
}

// ───────────────────────────────────────────────────
// تحديث الإحصائيات العلوية
// ───────────────────────────────────────────────────
function updateStatistics() {
    const todayStr = new Date().toISOString().split("T")[0];
    const currentMonthStr = todayStr.substring(0, 7); // yyyy-mm

    let totalAmount = 0;
    let todayAmount = 0;
    let monthAmount = 0;

    filteredExpenses.forEach(item => {
        const amt = parseFloat(item.amount) || 0;
        totalAmount += amt;

        if (item.date === todayStr) {
            todayAmount += amt;
        }

        if (item.date && item.date.startsWith(currentMonthStr)) {
            monthAmount += amt;
        }
    });

    document.getElementById("totalExpensesAmount").textContent = formatCurrency(totalAmount);
    document.getElementById("todayExpensesAmount").textContent = formatCurrency(todayAmount);
    document.getElementById("monthExpensesAmount").textContent = formatCurrency(monthAmount);
    document.getElementById("recordsCount").textContent = filteredExpenses.length;
}

// ───────────────────────────────────────────────────
// تصدير البيانات إلى ملف CSV
// ───────────────────────────────────────────────────
function exportExpensesToCSV() {
    if (filteredExpenses.length === 0) {
        showToast("لا توجد بيانات متاحة للتصدير.", "warning");
        return;
    }

    const headers = ["م", "التاريخ", "البيان", "التصنيف", "المبلغ (جنيه)", "المسؤول / المستلم", "ملاحظات"];
    const rows = filteredExpenses.map((item, index) => [
        index + 1,
        `"${item.date}"`,
        `"${(item.title || "").replace(/"/g, '""')}"`,
        `"${(item.category || "").replace(/"/g, '""')}"`,
        item.amount,
        `"${(item.spentBy || "").replace(/"/g, '""')}"`,
        `"${(item.notes || "").replace(/"/g, '""')}"`
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `سجل_مصروفات_السنتر_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("تم تصدير ملف المصروفات بنجاح 📊", "success");
}

// ───────────────────────────────────────────────────
// أدوات مساعدة
// ───────────────────────────────────────────────────
function getCategoryClass(category) {
    switch (category) {
        case "فواتير": return "bills";
        case "إيجار": return "rent";
        case "رواتب": return "salaries";
        case "أدوات ومستلزمات": return "tools";
        case "ضيافة": return "hospitality";
        case "صيانة": return "maintenance";
        case "دعاية وتسويق": return "marketing";
        default: return "other";
    }
}

function formatCurrency(val) {
    return Number(val || 0).toLocaleString("ar-EG", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function escapeHtml(text) {
    if (text === null || text === undefined) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

