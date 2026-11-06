/**
 * ==============================================================================
 * pending-payments.js — إدارة وتأكيد ورفض طلبات الدفع المعلقة للطلاب
 * نظام إدارة السنتر
 * ==============================================================================
 */

const MAIN_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";
const PENDING_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxb0IS8xfC3oSGv4ObldRMnFjgFIYeW4Lh8iFCJtO9UZQskk0VqhdBrUq3ZWg9LiFOzlA/exec";

let allPendingRequests = [];

/* ===================================================
   إدارة الثيم (داكن / فاتح)
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
   تنسيق التاريخ بنمط عربي احترافي ومختصر
   يحول Wed Nov 04 2026 00:51:00 GMT+0200 إلى 2026/11/04 • 12:51 ص
   =================================================== */
function formatArabicDate(rawDate) {
    if (!rawDate) return "غير محدد";
    try {
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) {
            return String(rawDate).split("GMT")[0].trim();
        }
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');

        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'م' : 'ص';
        hours = hours % 12;
        hours = hours ? hours : 12;

        return `${year}/${month}/${day} • ${hours}:${minutes} ${ampm}`;
    } catch (e) {
        return String(rawDate).split("GMT")[0].trim();
    }
}

/* ===================================================
   إشعارات التوست (Toast Notifications)
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
    if (type === 'warning') iconClass = 'fa-triangle-exclamation';
    if (type === 'danger')  iconClass = 'fa-circle-xmark';

    toast.innerHTML = `
        <i class="fa-solid ${iconClass}"></i>
        <div class="toast-message">${message}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function showLoading(show) {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
        overlay.style.display = show ? "flex" : "none";
    }
}

/* ===================================================
   جلب طلبات الدفع المعلقة من جوجل شيت
   =================================================== */
async function loadPendingRequests() {
    showLoading(true);
    const badge = document.getElementById("pendingCountBadge");
    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري التحميل...</span>`;
    }

    try {
        // جلب المعاملات من الاسكربت المستقل والاسكربت الرئيسي في نفس الوقت لضمان عدم ضياع أي طلب معلق!
        const fetchPromises = [
            fetch(`${PENDING_SCRIPT_URL}?action=getPendingTransactions&t=${Date.now()}`)
                .then(r => r.json())
                .then(d => (d && d.pendingList) ? d.pendingList.map(item => ({ ...item, _backend: 'pending' })) : [])
                .catch(err => { console.warn('Pending script fetch error:', err); return []; })
        ];

        if (typeof MAIN_SCRIPT_URL !== 'undefined' && MAIN_SCRIPT_URL && MAIN_SCRIPT_URL !== PENDING_SCRIPT_URL) {
            fetchPromises.push(
                fetch(`${MAIN_SCRIPT_URL}?action=getPendingTransactions&t=${Date.now()}`)
                    .then(r => r.json())
                    .then(d => (d && d.pendingList) ? d.pendingList.map(item => ({ ...item, _backend: 'main' })) : [])
                    .catch(err => { console.warn('Main script fetch error:', err); return []; })
            );
        }

        const results = await Promise.all(fetchPromises);
        const combined = [].concat(...results);

        // إزالة التكرار بالـ requestId
        const seenIds = new Set();
        allPendingRequests = [];

        combined.forEach(item => {
            const reqId = item.requestId || `${item.studentName}_${item.date}`;
            const s = (item.status || "").trim();
            if ((s === "معلق" || s === "") && !seenIds.has(reqId)) {
                seenIds.add(reqId);
                allPendingRequests.push(item);
            }
        });

        renderPendingCards(allPendingRequests);
    } catch (err) {
        console.error("Error loading pending requests:", err);
        showToast("تعذر تحميل طلبات الدفع المعلقة، يرجى المحاولة لاحقاً.", "danger");
        renderPendingCards([]);
    }
    showLoading(false);
}

/* ===================================================
   رسم كروت الطلبات المعلقة في الواجهة بتصميم متناسق
   =================================================== */
function renderPendingCards(list) {
    const container = document.getElementById("pendingCardsContainer");
    const emptyState = document.getElementById("emptyPendingContainer");
    const badge = document.getElementById("pendingCountBadge");

    if (badge) {
        badge.innerHTML = `<i class="fa-solid fa-clock"></i> <span>${list.length} طلبات معلقة</span>`;
    }

    if (!list || list.length === 0) {
        if (container) {
            container.innerHTML = "";
            container.classList.remove('single-card-view');
        }
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (emptyState) emptyState.style.display = "none";

    // تفعيل وضع الكارت الفردي المتناسق في المنتصف تلقائياً
    if (list.length === 1) {
        container.classList.add('single-card-view');
    } else {
        container.classList.remove('single-card-view');
    }

    let html = "";
    list.forEach(req => {
        const teachersList = (req.teachers || "").split(/[,،]/).map(t => t.trim()).filter(Boolean);
        const teachersChips = teachersList.length > 0 
            ? teachersList.map(t => `<span class="teacher-badge"><i class="fa-solid fa-chalkboard-user"></i> ${t}</span>`).join("")
            : `<span class="teacher-badge">${req.teachers || "غير محدد"}</span>`;

        // فحص حالة ورابط صورة الإيصال
        const isDriveError = req.receiptLink && req.receiptLink.includes("فشل رفع الإيصال");
        const hasReceipt = req.receiptLink && req.receiptLink !== "لا يوجد إيصال" && !isDriveError && req.receiptLink.startsWith("http");
        
        let receiptHtml = "";
        if (hasReceipt) {
            receiptHtml = `<button type="button" onclick="previewReceipt('${req.receiptLink}')" class="btn-view-receipt">
                 <i class="fa-solid fa-receipt"></i>
                 <span>معاينة الإيصال</span>
               </button>`;
        } else if (isDriveError) {
            receiptHtml = `<span style="color: #ef4444; font-size: 11.5px; font-weight: 700;" title="${escapeHtml(req.receiptLink)}">
                 <i class="fa-solid fa-triangle-exclamation"></i> لم يتم منح إذن Drive في الشيت
               </span>`;
        } else {
            receiptHtml = `<span style="color: var(--text-muted); font-size: 12px;"><i class="fa-solid fa-circle-exclamation"></i> بدون إيصال</span>`;
        }

        const formattedDate = formatArabicDate(req.date);

        html += `
        <div class="pending-card" id="card_${req.requestId}">
            <div class="card-top-row">
                <div class="student-profile">
                    <div class="student-avatar">
                        <i class="fa-solid fa-user-graduate"></i>
                    </div>
                    <div class="student-info-text">
                        <h4 class="student-name" title="${req.studentName}">${req.studentName}</h4>
                        <div class="student-meta">
                            <span><i class="fa-solid fa-layer-group" style="color: #6366f1;"></i> ${req.category || '-'}</span>
                            <span>•</span>
                            <span><i class="fa-solid fa-book-open" style="color: #10b981;"></i> ${req.grade || '-'}</span>
                        </div>
                    </div>
                </div>
                <div class="amount-pill">
                    ${parseFloat(req.totalAmount || 0).toLocaleString('en-US')} ج.م
                </div>
            </div>

            <div class="card-details-box">
                <div class="detail-line">
                    <span class="lbl"><i class="fa-regular fa-calendar"></i> تاريخ الطلب:</span>
                    <bdi class="date-badge"><i class="fa-regular fa-clock" style="color: #f59e0b;"></i> ${formattedDate}</bdi>
                </div>
                <div>
                    <span class="lbl" style="margin-bottom: 5px;"><i class="fa-solid fa-users"></i> المعلمون المحددون:</span>
                    <div class="teachers-chips-wrap">
                        ${teachersChips}
                    </div>
                </div>
                <div class="detail-line" style="margin-top: 4px; padding-top: 8px; border-top: 1px dashed var(--section-border);">
                    <span class="lbl"><i class="fa-solid fa-image"></i> صورة التحويل:</span>
                    ${receiptHtml}
                </div>
            </div>

            <div class="actions-grid">
                <button type="button" class="btn-action-card btn-action-confirm" onclick="confirmPayment('${req.requestId}', '${escapeHtml(req.studentName)}')">
                    <i class="fa-solid fa-circle-check"></i>
                    <span>تأكيد الدفع</span>
                </button>
                <button type="button" class="btn-action-card btn-action-reject" onclick="rejectPayment('${req.requestId}', '${escapeHtml(req.studentName)}')">
                    <i class="fa-solid fa-circle-xmark"></i>
                    <span>رفض الطلب</span>
                </button>
            </div>
        </div>
        `;
    });

    if (container) container.innerHTML = html;
}

/* ===================================================
   تصفية وبحث لحظي في الكروت المعروضة
   =================================================== */
function filterPendingCards() {
    const input = document.getElementById("pendingSearchInput");
    const query = input ? input.value.trim().toLowerCase() : "";

    if (!query) {
        renderPendingCards(allPendingRequests);
        return;
    }

    const filtered = allPendingRequests.filter(item => {
        const sName = (item.studentName || "").toLowerCase();
        const tNames = (item.teachers || "").toLowerCase();
        const cat = (item.category || "").toLowerCase();
        const grd = (item.grade || "").toLowerCase();
        return sName.includes(query) || tNames.includes(query) || cat.includes(query) || grd.includes(query);
    });

    renderPendingCards(filtered);
}

/* ===================================================
   تأكيد عملية الدفع وحذف الطلب المؤقت والإيصال
   =================================================== */
async function confirmPayment(requestId, studentName) {
    if (!confirm(`هل أنت متأكد من تأكيد عملية دفع الطالب:\n(${studentName})؟\n\nسيتم ترحيل المعاملة إلى شيت التحصيل الرئيسي وشيتات المعلمين، ومسح الطلب من الشيت المؤقت.`)) {
        return;
    }

    showLoading(true);
    try {
        const targetReq = allPendingRequests.find(r => r.requestId === requestId);
        if (!targetReq) {
            showToast("لم يتم العثور على بيانات هذا الطلب، يرجى التحديث.", "warning");
            showLoading(false);
            return;
        }

        const itemsToRecord = (targetReq.items && targetReq.items.length > 0)
            ? targetReq.items
            : [{
                studentName: targetReq.studentName,
                teacherName: targetReq.teachers,
                category: targetReq.category,
                grade: targetReq.grade,
                amount: targetReq.totalAmount,
                date: targetReq.date
            }];

        if (targetReq._backend === 'main') {
            // المعاملة موجودة في الشيت الرئيسي: تأكيد وترحيل فوري مباشر
            await fetch(MAIN_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    action: "confirmPendingTransaction",
                    requestId: requestId
                })
            });
        } else {
            // المعاملة في الشيت المستقل: ترحيل للشيت الرئيسي وحذف من المستقل بالتوازي الفوري
            await Promise.all([
                fetch(MAIN_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: "addTransactionsBulk",
                        transactions: itemsToRecord,
                        fileBase64: "",
                        mimeType: "",
                        fileName: ""
                    })
                }),
                fetch(PENDING_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        action: "removePendingTransaction",
                        requestId: requestId
                    })
                })
            ]);
        }

        showToast(`تم تأكيد دفع الطالب (${studentName}) وترحيله للتحصيل بنجاح!`, "success");
        allPendingRequests = allPendingRequests.filter(r => r.requestId !== requestId);
        renderPendingCards(allPendingRequests);

    } catch (err) {
        console.error("Error confirming payment:", err);
        showToast("حدث خطأ أثناء ترحيل العملية، يرجى التحقق من الاتصال.", "danger");
    }
    showLoading(false);
}

/* ===================================================
   رفض عملية الدفع
   =================================================== */
async function rejectPayment(requestId, studentName) {
    const reason = prompt(`يرجى كتابة سبب رفض طلب دفع الطالب (${studentName}):`, "عدم وضوح الإيصال أو عدم استلام المبلغ");
    if (reason === null) return;

    showLoading(true);
    try {
        const res = await fetch(PENDING_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: "rejectPendingTransaction",
                requestId: requestId,
                reason: reason.trim() || "رفض من الإدارة"
            })
        });

        const resJson = await res.json();
        if (resJson && resJson.status === "success") {
            showToast(`تم رفض طلب الطالب (${studentName}) بنجاح ومسحه من القائمة.`, "info");
            allPendingRequests = allPendingRequests.filter(r => r.requestId !== requestId);
            renderPendingCards(allPendingRequests);
        } else {
            showToast(resJson.message || "حدث خطأ أثناء رفض العملية.", "danger");
            await loadPendingRequests();
        }
    } catch (err) {
        console.error("Error rejecting payment:", err);
        showToast("فشل الاتصال بالخادم لرفض العملية.", "danger");
    }
    showLoading(false);
}


/* ===================================================
   معالجة واستعراض إيصال الدفع بأعلى كفاءة وموثوقية
   يدعم العرض المباشر، عارض Drive المدمج، ونافذة Drive المنبثقة
   =================================================== */
function extractDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    const m = url.match(/[-\w]{25,}/);
    return (m && m[0]) ? m[0] : '';
}

function handleReceiptImageError() {
    const img = document.getElementById("modalPreviewImage");
    const iframe = document.getElementById("modalPreviewIframe");
    const fallback = document.getElementById("receiptFallbackNotice");
    
    // محاولة تشغيل عارض Drive المدمج قبل إظهار الفولباك
    if (img) img.style.display = "none";
    if (iframe && iframe.dataset.previewSrc) {
        iframe.src = iframe.dataset.previewSrc;
        iframe.style.display = "block";
    } else if (fallback) {
        fallback.style.display = "block";
    }
}

/* ===================================================
   معاينة صورة الإيصال في نافذة Modal نظيفة واحترافية
   =================================================== */
function previewReceipt(url) {
    if (!url) return;
    const modal = document.getElementById("imagePreviewModal");
    const img = document.getElementById("modalPreviewImage");
    const iframe = document.getElementById("modalPreviewIframe");
    const link = document.getElementById("modalExternalLink");
    const fallback = document.getElementById("receiptFallbackNotice");
    const driveBtn = document.getElementById("btnDirectDriveLink");

    if (modal) {
        const fileId = extractDriveFileId(url);
        
        if (fallback) fallback.style.display = "none";
        if (iframe) {
            iframe.style.display = "none";
            iframe.src = "";
        }

        if (img) {
            img.style.display = "block";
            // استخدام رابط جوجل CDN الصريح والمعتمد لعرض الصورة مباشرة
            img.src = fileId ? `https://lh3.googleusercontent.com/d/${fileId}=s1600` : url;
        }

        if (link) link.href = url;
        if (driveBtn) driveBtn.href = url;

        modal.style.display = "flex";
        document.body.style.overflow = "hidden";
    }
}

function closeImageModal(e) {
    const modal = document.getElementById("imagePreviewModal");
    if (modal && (!e || e.target === modal)) {
        closeImageModalDirect();
    }
}

function closeImageModalDirect() {
    const modal = document.getElementById("imagePreviewModal");
    if (modal) {
        modal.style.display = "none";
        document.body.style.overflow = "";
        const img = document.getElementById("modalPreviewImage");
        if (img) img.src = ""; // تفريغ الصورة لمنع ظهورها مسبقاً في الفتح التالي
    }
}

// إغلاق النافذة بزر Escape في لوحة المفاتيح
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeImageModalDirect();
});

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// البدء عند تحميل الصفحة
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    loadPendingRequests();
});
