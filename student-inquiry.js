/* ===================================================
   student-inquiry.js — الاستعلام الذكي عن مدفوعات الطلاب
   نظام إدارة حسابات النجاح
   =================================================== */

// روابط قواعد البيانات
const STUDENTS_DB_URL = "https://script.google.com/macros/s/AKfycbx35GjixD83S6R69c2mnA9KvgG93I0PX-yrIDdokwLRzaTTkd9fRR3fwuyHRWLUJDK5/exec";
const TRANSACTIONS_URL = "https://script.google.com/macros/s/AKfycbxazZen_peC1JAwtTJ-eScQmuCWpsPYvqeubzj0ZL1NdBVOxV4hJjixFYQ_LkU_rSvs/exec";
const ATTENDANCE_URL = "https://script.google.com/macros/s/AKfycbwqGlBz-aIG9uqyHOB5Y30Io7GnIkRzKWbejh-nHMl2nhVXEUNkNPAG9S4IvXRObd-N/exec";

let allStudents = [];
let allTransactions = [];
let allAttendance = [];
let currentSelectedStudent = null;
let currentSearchMatches = [];

/* ===================================================
   توحيد الأسماء المركبة وإزالة الفروق الإملائية
   يدمج: "عبد الله" -> "عبدالله", "أبو بكر" -> "أبوبكر"
   ويوحد الهمزات والياء والألف اللينة
   =================================================== */
function normalizeArabicName(name) {
    if (!name) return "";
    let str = name.toString().trim();

    // إزالة التشكيل والتطويل
    str = str.replace(/[\u064B-\u065F\u0640]/g, '');

    // دمج الأسماء المركبة الشائعة ككلمة واحدة (سواء كتبت بمسافة أو بدون)
    // 1) عبد + اسم: عبد الله -> عبدالله، عبد الرحمن -> عبدالرحمن
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');

    // 2) أبو / ابي / ابا + اسم: أبو بكر -> أبوبكر
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');

    // 3) بن / ابن
    str = str.replace(/\bابن\s+/g, 'بن ');

    // 4) توحيد أشكال الهمزات
    str = str.replace(/[إأآٱ]/g, 'ا');
    str = str.replace(/ة\b/g, 'ه');
    str = str.replace(/[ىي]/g, 'ي');

    // إزالة المسافات الزائدة
    str = str.replace(/\s+/g, ' ').trim();

    return str;
}

/**
 * تنظيف وعرض الاسم المركب ككلمة واحدة دائماً في العرض المرئي
 * مثال: "عبد الله محمد" -> "عبدالله محمد"
 */
function displayNormalizedName(name) {
    if (!name) return "";
    let str = name.toString().trim().replace(/\s+/g, ' ');
    // دمج "عبد ..." لتصبح جزءاً واحداً دائماً في العرض
    str = str.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
    // دمج "أبو ..."
    str = str.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
    return str;
}

/**
 * توحيد صيغة الصف الدراسي للمقارنة الدقيقة
 * يزيل كلمة "الصف" أو اسم المرحلة الملحق ويوحد الهمزات
 */
function normalizeGrade(grade) {
    if (!grade) return "";
    let str = grade.toString().trim();
    str = str.replace(/[\u064B-\u065F\u0640]/g, '');
    str = str.replace(/^(الصف|صف)\s+/g, '');
    str = str.replace(/\s+(الابتدائي|الاعدادي|الثانوي|لغات)$/g, '');
    str = str.replace(/[إأآٱ]/g, 'ا');
    str = str.replace(/ة\b/g, 'ه');
    str = str.replace(/[ىي]/g, 'ي');
    return str.replace(/\s+/g, ' ').trim();
}

/**
 * التحقق من تطابق الصفين الدراسيين مع التعامل مع أشكال الكتابة المختلفة
 */
function isSameGrade(g1, g2) {
    if (!g1 || !g2) return false;
    const n1 = normalizeGrade(g1);
    const n2 = normalizeGrade(g2);
    if (n1 === n2) return true;
    const stripAl = (s) => s.replace(/^ال/, '');
    return stripAl(n1) === stripAl(n2);
}

/**
 * توحيد اسم المرحلة (الفئة)
 */
function normalizeCategory(cat) {
    if (!cat) return "";
    let str = cat.toString().trim();
    str = str.replace(/[\u064B-\u065F\u0640]/g, '');
    str = str.replace(/[إأآٱ]/g, 'ا');
    str = str.replace(/ة\b/g, 'ه');
    str = str.replace(/[ىي]/g, 'ي');
    return str.replace(/\s+/g, ' ').trim();
}

function isSameCategory(c1, c2) {
    if (!c1 || !c2) return false;
    return normalizeCategory(c1) === normalizeCategory(c2);
}

document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    loadAllData();
    initInquirySearch();

    // فحص ما إذا كان هناك اسم طالب ممرر عبر رابط الصفحة ?student=...
    const urlParams = new URLSearchParams(window.location.search);
    const queryStudent = urlParams.get('student');
    const queryCategory = urlParams.get('category');
    const queryGrade = urlParams.get('grade');
    if (queryStudent) {
        const input = document.getElementById("inquiryStudentInput");
        if (input) {
            input.value = decodeURIComponent(queryStudent);
            // الانتظار حتى تحميل البيانات ثم البحث
            setTimeout(() => {
                selectStudent(
                    input.value,
                    queryCategory ? decodeURIComponent(queryCategory) : null,
                    queryGrade ? decodeURIComponent(queryGrade) : null
                );
            }, 600);
        }
    }
});

/* ───────────────────────────────────────────────────
   إدارة المظهر (Dark / Light)
   ─────────────────────────────────────────────────── */
function initTheme() {
    const saved = localStorage.getItem('theme');
    const sys = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    applyTheme(saved || sys);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
        const ic = btn.querySelector('i');
        const sp = btn.querySelector('span');
        if (ic && sp) {
            ic.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
            ic.style.color = theme === 'dark' ? '#f59e0b' : '';
            sp.textContent = theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي';
        }
    });
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
}

function showToast(msg, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    const icons = { success: "circle-check", danger: "circle-xmark", warning: "triangle-exclamation", info: "circle-info" };
    toast.innerHTML = `<i class="fa-solid fa-${icons[type] || 'circle-info'}"></i><span>${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    setTimeout(() => {
        toast.classList.remove("show");
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

/* ───────────────────────────────────────────────────
   تحميل بيانات الطلاب والتحصيلات
   ─────────────────────────────────────────────────── */
async function loadAllData(forceRefresh = false) {
    // محاولة استخدام الكاش السريع
    if (!forceRefresh) {
        const cachedStudents = localStorage.getItem('center_students_db_cache');
        if (cachedStudents) {
            try { allStudents = JSON.parse(cachedStudents); } catch(_) {}
        }
        const cachedTxs = localStorage.getItem('center_txs_cache');
        if (cachedTxs) {
            try { allTransactions = JSON.parse(cachedTxs); } catch(_) {}
        }
        const cachedAtt = localStorage.getItem('center_att_cache');
        if (cachedAtt) {
            try { allAttendance = JSON.parse(cachedAtt); } catch(_) {}
        }
    }

    try {
        // جلب الطلاب
        const p1 = fetch(STUDENTS_DB_URL, { redirect: 'follow' })
            .then(r => r.json())
            .catch(() => []);

        // جلب المعاملات من الشيت
        const p2 = fetch(`${TRANSACTIONS_URL}?action=getTransactions`, { redirect: 'follow' })
            .then(r => r.json())
            .catch(() => []);

        // جلب سجلات الحضور والغياب
        const p3 = fetch(`${ATTENDANCE_URL}?action=getAttendance`, { redirect: 'follow' })
            .then(r => r.json())
            .catch(() => []);

        const [studentsData, txsData, attData] = await Promise.all([p1, p2, p3]);

        if (Array.isArray(studentsData) && studentsData.length > 0) {
            allStudents = studentsData.map((item, idx) => ({
                id: item.id || idx,
                studentName: (item.studentName || item.name || '').trim(),
                teacherName: (item.teacherName || item.teacher || '').trim(),
                category: (item.category || '').trim(),
                grade: (item.grade || '').trim()
            })).filter(s => s.studentName);
            localStorage.setItem('center_students_db_cache', JSON.stringify(allStudents));
        }

        // التعامل مع بيانات التحصيلات
        let txList = [];
        if (Array.isArray(txsData)) {
            txList = txsData;
        } else if (txsData && Array.isArray(txsData.transactions)) {
            txList = txsData.transactions;
        }

        if (txList.length > 0) {
            allTransactions = txList.map(t => ({
                studentName: (t.studentName || t['اسم الطالب'] || '').trim(),
                teacherName: (t.teacherName || t['المعلم'] || '').trim(),
                category: (t.category || t['الفئة'] || '').trim(),
                grade: (t.grade || t['الصف'] || '').trim(),
                amount: t.amount || t['المبلغ'] || '0',
                date: t.date || t['التاريخ'] || '',
                fileLink: t.fileLink || t['رابط الإيصال'] || ''
            }));
            localStorage.setItem('center_txs_cache', JSON.stringify(allTransactions));
        }

        // التعامل مع بيانات الحضور والغياب
        let attList = [];
        if (Array.isArray(attData)) {
            attList = attData;
        } else if (attData && Array.isArray(attData.records)) {
            attList = attData.records;
        }

        if (attList.length > 0) {
            allAttendance = attList.map(a => ({
                studentName: (a.studentName || '').trim(),
                teacherName: (a.teacher || a.teacherName || '').trim(),
                category: (a.category || '').trim(),
                grade: (a.grade || '').trim(),
                status: (a.status || '').trim(),
                date: (a.date || '').trim(),
                note: (a.note || '').trim()
            }));
            localStorage.setItem('center_att_cache', JSON.stringify(allAttendance));
        }

        if (forceRefresh) {
            showToast("تم تحديث كافة البيانات بنجاح من جوجل شيت ✅", "success");
            if (currentSelectedStudent && currentSelectedStudent.name) {
                selectStudent(currentSelectedStudent.name, currentSelectedStudent.category, currentSelectedStudent.grade);
            } else {
                const inputVal = document.getElementById("inquiryStudentInput")?.value.trim();
                if (inputVal) selectStudent(inputVal);
            }
        }
    } catch (e) {
        console.warn("Data load error:", e);
    }
}

/* ───────────────────────────────────────────────────
   تهيئة شريط البحث والإكمال التلقائي
   ─────────────────────────────────────────────────── */
function initInquirySearch() {
    const input = document.getElementById("inquiryStudentInput");
    const dropdown = document.getElementById("inquiryDropdown");
    const clearBtn = document.getElementById("clearInquiryBtn");
    if (!input || !dropdown) return;

    input.addEventListener("input", function() {
        const query = this.value.trim().toLowerCase();

        if (clearBtn) {
            clearBtn.style.display = query ? "flex" : "none";
        }

        if (!query) {
            currentSearchMatches = [];
            dropdown.style.display = "none";
            dropdown.innerHTML = "";
            return;
        }

        // جمع كل الطلاب مع تمييزهم بدقة بالفئة والصف الدراسي
        const matchesMap = new Map();
        const normQuery = normalizeArabicName(query);

        allStudents.forEach(s => {
            const rawName = s.studentName || '';
            const normName = normalizeArabicName(rawName);

            if (normName.includes(normQuery)) {
                const cat = (s.category || '').trim();
                const gr = (s.grade || '').trim();
                // مفتاح فريد يجمع بين الاسم والفئة والصف
                const key = `${normName}_${normalizeCategory(cat)}_${normalizeGrade(gr)}`;
                if (!matchesMap.has(key)) {
                    matchesMap.set(key, {
                        name: displayNormalizedName(rawName),
                        rawName: rawName,
                        normName: normName,
                        teachers: s.teacherName ? [s.teacherName] : [],
                        category: cat,
                        grade: gr,
                        id: s.id
                    });
                } else if (s.teacherName && !matchesMap.get(key).teachers.includes(s.teacherName)) {
                    matchesMap.get(key).teachers.push(s.teacherName);
                }
            }
        });

        // أيضاً المعاملات إذا كان هناك طلاب فيها
        allTransactions.forEach(t => {
            const rawName = t.studentName || '';
            const normName = normalizeArabicName(rawName);

            if (normName.includes(normQuery)) {
                const cat = (t.category || '').trim();
                const gr = (t.grade || '').trim();
                const key = `${normName}_${normalizeCategory(cat)}_${normalizeGrade(gr)}`;
                if (!matchesMap.has(key)) {
                    matchesMap.set(key, {
                        name: displayNormalizedName(rawName),
                        rawName: rawName,
                        normName: normName,
                        teachers: t.teacherName ? [t.teacherName] : [],
                        category: cat,
                        grade: gr,
                        id: null
                    });
                } else if (t.teacherName && !matchesMap.get(key).teachers.includes(t.teacherName)) {
                    matchesMap.get(key).teachers.push(t.teacherName);
                }
            }
        });

        const matches = Array.from(matchesMap.values());
        currentSearchMatches = matches;

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

        const topMatches = matches.slice(0, 10);
        dropdown.innerHTML = topMatches.map((m, idx) => {
            const teachersText = m.teachers && m.teachers.length > 1
                ? `${m.teachers.length} معلمين (${m.teachers.slice(0, 2).join('، ')}${m.teachers.length > 2 ? '...' : ''})`
                : (m.teachers && m.teachers.length === 1 ? `أ/ ${m.teachers[0]}` : 'مدرسين متعددين');

            return `
            <div class="autocomplete-item" data-idx="${idx}">
                <div class="autocomplete-item-info">
                    <strong><i class="fa-solid fa-user-check" style="color: #10b981; margin-left: 6px;"></i>${highlightMatch(m.name, query)}</strong>
                    <span><i class="fa-solid fa-layer-group"></i> ${m.category ? `<b style="color: #6366f1;">${m.category}</b> (${m.grade || ''})` : 'غير محدد'} • <i class="fa-solid fa-chalkboard-user"></i> ${teachersText}</span>
                </div>
                <i class="fa-solid fa-arrow-turn-down-left" style="color: #6366f1; font-size: 11px;"></i>
            </div>
            `;
        }).join('');

        dropdown.style.display = "block";

        dropdown.querySelectorAll(".autocomplete-item").forEach(item => {
            item.addEventListener("click", function() {
                const selected = topMatches[parseInt(this.getAttribute("data-idx"))];
                if (!selected) return;

                input.value = selected.name;
                dropdown.style.display = "none";
                selectStudent(selected.rawName || selected.name, selected.category, selected.grade);
            });
        });
    });

    // البحث عند الضغط على Enter
    input.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            dropdown.style.display = "none";
            const val = this.value.trim();
            if (!val) return;
            const normVal = normalizeArabicName(val);
            const exactMatches = currentSearchMatches.filter(m => m.normName === normVal);
            if (exactMatches.length === 1) {
                selectStudent(exactMatches[0].rawName || exactMatches[0].name, exactMatches[0].category, exactMatches[0].grade);
            } else if (currentSearchMatches.length > 0) {
                selectStudent(currentSearchMatches[0].rawName || currentSearchMatches[0].name, currentSearchMatches[0].category, currentSearchMatches[0].grade);
            } else {
                selectStudent(val);
            }
        }
    });

    document.addEventListener("click", function(e) {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = "none";
        }
    });
}

function clearInquirySearch() {
    currentSelectedStudent = null;
    currentSearchMatches = [];
    const input = document.getElementById("inquiryStudentInput");
    const dropdown = document.getElementById("inquiryDropdown");
    const clearBtn = document.getElementById("clearInquiryBtn");
    if (input) input.value = "";
    if (dropdown) dropdown.style.display = "none";
    if (clearBtn) clearBtn.style.display = "none";

    document.getElementById("studentResultsContainer").style.display = "none";
    document.getElementById("initialEmptyState").style.display = "block";

    const dupBox = document.getElementById("duplicateProfilesContainer");
    if (dupBox) {
        dupBox.style.display = "none";
        dupBox.innerHTML = "";
    }
}

/* ───────────────────────────────────────────────────
   عرض بيانات ومدفوعات الطالب مع الفصل التام حسب المرحلة والصف
   ─────────────────────────────────────────────────── */
function selectStudent(studentName, targetCategory = null, targetGrade = null) {
    if (!studentName) return;

    const resultsContainer = document.getElementById("studentResultsContainer");
    const emptyState = document.getElementById("initialEmptyState");

    const normTargetName = normalizeArabicName(studentName);

    // إذا لم تُمرر الفئة والصف، نحاول اكتشافها بدقة من قاعدة البيانات
    if (!targetCategory || !targetGrade) {
        const matchingStudents = allStudents.filter(s => normalizeArabicName(s.studentName) === normTargetName);
        if (matchingStudents.length > 0) {
            if (targetCategory && !targetGrade) {
                const matchInCat = matchingStudents.find(s => isSameCategory(s.category, targetCategory));
                if (matchInCat) {
                    targetGrade = (matchInCat.grade || '').trim();
                }
            } else if (!targetCategory) {
                targetCategory = (matchingStudents[0].category || '').trim();
                targetGrade = (matchingStudents[0].grade || '').trim();
            }
        } else {
            // محاولة من المعاملات
            const matchingTxs = allTransactions.filter(t => normalizeArabicName(t.studentName) === normTargetName);
            if (matchingTxs.length > 0) {
                if (targetCategory && !targetGrade) {
                    const matchInCat = matchingTxs.find(t => isSameCategory(t.category, targetCategory));
                    if (matchInCat) targetGrade = (matchInCat.grade || '').trim();
                } else if (!targetCategory) {
                    targetCategory = (matchingTxs[0].category || '').trim();
                    targetGrade = (matchingTxs[0].grade || '').trim();
                }
            }
        }
    }

    currentSelectedStudent = {
        name: studentName,
        category: targetCategory,
        grade: targetGrade
    };

    // جلب معلومات الطالب من جدول الطلاب المسجلين بالربط الدقيق للمرحلة والصف
    const studentRegistrations = allStudents.filter(s => {
        const matchesName = normalizeArabicName(s.studentName) === normTargetName;
        if (!matchesName) return false;

        // التحقق من الفئة (المرحلة)
        if (targetCategory && s.category) {
            if (!isSameCategory(s.category, targetCategory)) return false;
        }

        // التحقق من الصف الدراسي
        if (targetGrade && s.grade) {
            if (!isSameGrade(s.grade, targetGrade)) return false;
        }

        return true;
    });

    // جلب المعاملات الخاصة بهذا الطالب المطابق للاسم والفئة والصف
    const studentTxs = allTransactions.filter(t => {
        const matchesName = normalizeArabicName(t.studentName) === normTargetName;
        if (!matchesName) return false;

        // التحقق من الفئة
        if (targetCategory && t.category) {
            if (!isSameCategory(t.category, targetCategory)) return false;
        }

        // التحقق من الصف
        if (targetGrade && t.grade) {
            if (!isSameGrade(t.grade, targetGrade)) return false;
        }

        // إذا لم يكن الصف مسجلاً في المعاملة ولكن يوجد اسم معلم
        // نتأكد أن المعلم مسجل لهذا الطالب في نفس المرحلة والصف
        if (targetGrade && !t.grade && t.teacherName) {
            const belongsToTeacher = studentRegistrations.some(r =>
                normalizeArabicName(r.teacherName) === normalizeArabicName(t.teacherName)
            );
            if (!belongsToTeacher) return false;
        }

        return true;
    });

    // جلب سجلات غياب الطالب المطابقة للاسم والفئة والصف
    const studentAbsences = allAttendance.filter(a => {
        const matchesName = normalizeArabicName(a.studentName) === normTargetName && a.status === 'غائب';
        if (!matchesName) return false;

        if (targetCategory && a.category) {
            if (!isSameCategory(a.category, targetCategory)) return false;
        }

        if (targetGrade && a.grade) {
            if (!isSameGrade(a.grade, targetGrade)) return false;
        }

        if (targetGrade && !a.grade && a.teacherName) {
            const belongsToTeacher = studentRegistrations.some(r =>
                normalizeArabicName(r.teacherName) === normalizeArabicName(a.teacherName)
            );
            if (!belongsToTeacher) return false;
        }

        return true;
    });

    emptyState.style.display = "none";
    resultsContainer.style.display = "block";

    // تحديث بيانات بطاقة الطالب
    document.getElementById("cardStudentName").textContent = displayNormalizedName(studentName);

    let subtextParts = [];
    if (targetCategory || targetGrade) {
        subtextParts.push(`${targetCategory || ''}${targetGrade ? ' (' + targetGrade + ')' : ''}`);
    } else if (studentRegistrations.length > 0) {
        const cat = studentRegistrations[0].category;
        const gr = studentRegistrations[0].grade;
        if (cat || gr) subtextParts.push(`${cat || ''}${gr ? ' (' + gr + ')' : ''}`);
    }
    document.getElementById("cardStudentSubtext").textContent = subtextParts.join(" • ") || "طالب مسجل بالسنتر";

    // تجميع المعلمين والإحصائيات
    let totalPaid = 0;
    const teachersMap = new Map();

    // 1. تسجيل المعلمين المسجل معهم الطالب في هذا الصف أولاً لضمان الدقة
    studentRegistrations.forEach(r => {
        const tName = r.teacherName || "مدرس غير محدد";
        if (!teachersMap.has(tName)) {
            teachersMap.set(tName, {
                teacherName: tName,
                category: r.category || targetCategory,
                grade: r.grade || targetGrade,
                payments: [],
                absences: []
            });
        }
    });

    // 2. ربط المدفوعات بالمعلمين
    studentTxs.forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        totalPaid += amt;

        const tName = t.teacherName || "مدرس غير محدد";
        if (!teachersMap.has(tName)) {
            teachersMap.set(tName, {
                teacherName: tName,
                category: t.category || targetCategory,
                grade: t.grade || targetGrade,
                payments: [],
                absences: []
            });
        }
        teachersMap.get(tName).payments.push(t);
    });

    // 3. ربط الغياب بالمعلمين
    studentAbsences.forEach(a => {
        const tName = a.teacherName || "مدرس غير محدد";
        if (!teachersMap.has(tName)) {
            teachersMap.set(tName, {
                teacherName: tName,
                category: a.category || targetCategory,
                grade: a.grade || targetGrade,
                payments: [],
                absences: []
            });
        }
        teachersMap.get(tName).absences.push(a);
    });

    document.getElementById("cardTotalPaid").textContent = `${totalPaid} ج.م`;
    document.getElementById("cardMonthsCount").textContent = studentTxs.length;
    document.getElementById("cardTeachersCount").textContent = teachersMap.size;
    document.getElementById("cardTotalAbsences").textContent = studentAbsences.length;

    // فحص وعرض تنبيه تشابه الأسماء في حال وجود طلاب آخرين بنفس الاسم
    checkAndRenderDuplicateProfiles(studentName, targetCategory, targetGrade);

    // بناء شبكة المعلمين
    const grid = document.getElementById("teachersGrid");
    grid.innerHTML = "";

    if (teachersMap.size === 0) {
        grid.innerHTML = `
            <div class="empty-history" style="grid-column: 1 / -1;">
                <i class="fa-solid fa-file-invoice-dollar"></i>
                <h3>لا توجد سجلات مسجلة لهذا الطالب حتى الآن</h3>
            </div>
        `;
        return;
    }

    teachersMap.forEach((teacherData) => {
        const card = document.createElement("div");
        card.className = "teacher-pay-card";

        const absCount = teacherData.absences.length;
        const absBadge = absCount === 0
            ? `<span class="badge-absent-count zero"><i class="fa-solid fa-circle-check"></i> لا يوجد غياب</span>`
            : `<span class="badge-absent-count"><i class="fa-solid fa-triangle-exclamation"></i> غياب: ${absCount} ${absCount === 1 ? 'مرة' : 'مرات'}</span>`;

        let paymentsHtml = "";
        if (teacherData.payments.length === 0) {
            paymentsHtml = `
                <div style="text-align: center; padding: 12px; color: var(--text-muted); font-size: 13px;">
                    <i class="fa-solid fa-clock-rotate-left" style="margin-left: 6px;"></i>
                    مسجل مع هذا المعلم ولكن لم يتم تسجيل أي مدفوعات بعد
                </div>
            `;
        } else {
            // ترتيب الدفعات حسب التاريخ
            paymentsHtml = teacherData.payments.map((p, pIdx) => {
                const dateText = formatPaymentDate(p.date);
                const monthName = extractMonthName(p.date);
                const hasReceipt = p.fileLink && p.fileLink !== "لا يوجد إيصال" && p.fileLink.startsWith("http");

                // تشفير بيانات الدفعة لتمريرها لدالة الحذف
                const txDataStr = encodeURIComponent(JSON.stringify({
                    studentName: p.studentName || studentName,
                    teacherName: teacherData.teacherName,
                    category: teacherData.category || '',
                    grade: teacherData.grade || '',
                    amount: p.amount,
                    date: p.date
                }));

                return `
                    <div class="month-item" id="txRow_${pIdx}">
                        <div class="month-info">
                            <i class="fa-solid fa-calendar-check"></i>
                            <span>${monthName} (${dateText})</span>
                        </div>
                        <div class="month-actions">
                            <span class="month-amount">${p.amount} ج.م</span>
                            ${hasReceipt ? `<a href="${p.fileLink}" target="_blank" class="receipt-link-btn" title="عرض الإيصال"><i class="fa-solid fa-receipt"></i> الإيصال</a>` : ''}
                            <button type="button" class="btn-delete-payment" onclick="confirmAndDeletePayment('${txDataStr}', this)" title="حذف هذه الدفعة (إذا تم التسجيل بالخطأ أو مكرر)">
                                <i class="fa-solid fa-trash-can"></i>
                                <span>حذف</span>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        card.innerHTML = `
            <div class="teacher-pay-header">
                <div class="teacher-name-box">
                    <div class="teacher-icon">
                        <i class="fa-solid fa-chalkboard-user"></i>
                    </div>
                    <div>
                        <h3>أ/ ${teacherData.teacherName}</h3>
                        <span>${teacherData.category || ''} ${teacherData.grade ? `(${teacherData.grade})` : ''}</span>
                    </div>
                </div>
                <div class="teacher-badges-group">
                    <span class="badge-present" style="font-size: 11.5px;">${teacherData.payments.length} شهر مسدد</span>
                    ${absBadge}
                </div>
            </div>
            <div class="months-timeline">
                ${paymentsHtml}
            </div>
        `;

        grid.appendChild(card);
    });
}

/**
 * فحص ما إذا كان هناك طلاب آخرون بنفس الاسم في مراحل أو صفوف أخرى
 * وعرض تنبيه يتيح التبديل بينهم بنقرة واحدة
 */
function checkAndRenderDuplicateProfiles(studentName, currentCat, currentGrade) {
    const container = document.getElementById("duplicateProfilesContainer");
    if (!container) return;

    const normTargetName = normalizeArabicName(studentName);
    const currentKey = `${normalizeCategory(currentCat)}_${normalizeGrade(currentGrade)}`;

    const otherProfilesMap = new Map();

    allStudents.forEach(s => {
        if (normalizeArabicName(s.studentName) === normTargetName) {
            const cat = (s.category || '').trim();
            const gr = (s.grade || '').trim();
            const key = `${normalizeCategory(cat)}_${normalizeGrade(gr)}`;
            if (key !== currentKey && (cat || gr)) {
                if (!otherProfilesMap.has(key)) {
                    otherProfilesMap.set(key, {
                        name: displayNormalizedName(s.studentName),
                        rawName: s.studentName,
                        category: cat,
                        grade: gr,
                        teachers: s.teacherName ? [s.teacherName] : []
                    });
                } else if (s.teacherName && !otherProfilesMap.get(key).teachers.includes(s.teacherName)) {
                    otherProfilesMap.get(key).teachers.push(s.teacherName);
                }
            }
        }
    });

    const otherProfiles = Array.from(otherProfilesMap.values());

    if (otherProfiles.length === 0) {
        container.style.display = "none";
        container.innerHTML = "";
        return;
    }

    container.innerHTML = `
        <div class="duplicate-profiles-banner">
            <div class="duplicate-profiles-title">
                <i class="fa-solid fa-users" style="font-size: 18px; color: #f59e0b;"></i>
                <div>
                    <strong>تنبيه تشابه أسماء:</strong>
                    <span>يوجد طالب آخر بنفس الاسم (<strong>${displayNormalizedName(studentName)}</strong>) في صفوف دراسية أخرى:</span>
                </div>
            </div>
            <div class="duplicate-profiles-chips">
                ${otherProfiles.map(p => {
                    const tText = p.teachers.length > 0 ? ` • أ/ ${p.teachers.join('، ')}` : '';
                    const escapedName = (p.rawName || p.name).replace(/'/g, "\\'");
                    const escapedCat = p.category.replace(/'/g, "\\'");
                    const escapedGr = p.grade.replace(/'/g, "\\'");
                    return `
                        <button type="button" class="switch-profile-btn" onclick="selectStudent('${escapedName}', '${escapedCat}', '${escapedGr}')" title="عرض ملف هذا الطالب">
                            <i class="fa-solid fa-arrow-right-arrow-left"></i>
                            <span>عرض طالب: <b>${p.category} (${p.grade})</b>${tText}</span>
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    container.style.display = "block";
}

function extractMonthName(dateStr) {
    if (!dateStr) return "شهر غير محدد";
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            const months = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
            return `شهر ${months[d.getMonth()]}`;
        }
    } catch (_) {}
    return "سداد قسط";
}

function formatPaymentDate(dateStr) {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
        }
    } catch (_) {}
    return dateStr.split("T")[0] || dateStr;
}

function highlightMatch(text, query) {
    if (!query) return text;
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span style="color: #6366f1; text-decoration: underline; font-weight: 800;">$1</span>');
}

/* ===================================================
   حذف دفعة التحصيل من شيت التحصيل وشيت المدرس
   =================================================== */
async function confirmAndDeletePayment(encodedData, btnElement) {
    let tx;
    try {
        tx = JSON.parse(decodeURIComponent(encodedData));
    } catch (e) {
        showToast("خطأ في قراءة بيانات الدفعة المراد حذفها.", "danger");
        return;
    }

    const confirmMsg = `⚠️ تأكيد حذف الدفعة:\n\n• الطالب: ${displayNormalizedName(tx.studentName)}\n• المعلم: أ/ ${tx.teacherName}\n• المبلغ: ${tx.amount} ج.م\n• التاريخ: ${formatPaymentDate(tx.date)}\n\nهل أنت متأكد من حذف هذه الدفعة نهائياً؟\nسيتم مسحها من شيت التحصيل العام ومن صفحة المعلم.`;

    if (!confirm(confirmMsg)) {
        return;
    }

    // تفعيل حالة التحميل للزر لمنع الضغط المتكرر
    const originalBtnHtml = btnElement ? btnElement.innerHTML : "";
    if (btnElement) {
        btnElement.classList.add("deleting");
        btnElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>جاري الحذف...</span>`;
    }

    showToast("جاري حذف الدفعة من الشيت وقاعدة البيانات...", "info");

    try {
        const response = await fetch(TRANSACTIONS_URL, {
            method: "POST",
            body: JSON.stringify({
                action: "deleteTransaction",
                studentName: tx.studentName,
                teacherName: tx.teacherName,
                category: tx.category,
                grade: tx.grade,
                amount: tx.amount,
                date: tx.date
            })
        });

        const result = await response.json();

        if (result && (result.status === "success" || result.status === "warning")) {
            showToast(result.message || "تم حذف الدفعة بنجاح!", result.status === "success" ? "success" : "warning");

            // حذف المعاملة محلياً من مصفوفة allTransactions
            const normStudent = normalizeArabicName(tx.studentName);
            const idx = allTransactions.findIndex(t =>
                normalizeArabicName(t.studentName) === normStudent &&
                (t.teacherName || "").trim() === (tx.teacherName || "").trim() &&
                String(t.amount).trim() === String(tx.amount).trim() &&
                (!tx.date || (t.date || "").trim() === (tx.date || "").trim())
            );

            if (idx !== -1) {
                allTransactions.splice(idx, 1);
                localStorage.setItem("center_txs_cache", JSON.stringify(allTransactions));
            }

            // إعادة رسم بطاقة الطالب والمدفوعات فوراً
            if (currentSelectedStudent) {
                selectStudent(currentSelectedStudent.name, currentSelectedStudent.category, currentSelectedStudent.grade);
            }
        } else {
            showToast(result.message || "حدث خطأ أثناء محاولة الحذف من الخادم.", "danger");
            if (btnElement) {
                btnElement.classList.remove("deleting");
                btnElement.innerHTML = originalBtnHtml;
            }
        }
    } catch (err) {
        console.error("Delete payment error:", err);
        showToast("فشل الاتصال بالخادم أثناء الحذف. يرجى المحاولة مرة أخرى.", "danger");
        if (btnElement) {
            btnElement.classList.remove("deleting");
            btnElement.innerHTML = originalBtnHtml;
        }
    }
}
