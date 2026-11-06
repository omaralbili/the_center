/**
 * ==============================================================================
 * كود Google Apps Script — نظام تسجيل الحضور والغياب
 * الشيت: يُنشئ تلقائياً Tab باسم "الحضور والغياب"
 * مع حماية LockService لمنع تداخل البيانات عند التزامن
 * ==============================================================================
 *
 * خطوات الاستخدام:
 * 1. افتح Google Sheets جديد (أو الموجود لديك)
 * 2. Tools → Apps Script → الصق الكود كله هنا
 * 3. Deploy → New Deployment → Web App → Anyone
 * 4. انسخ الرابط وضعه في attendance.js في متغير ATT_SCRIPT_URL
 * ==============================================================================
 */

var ATT_SHEET_NAME = "الحضور والغياب";
var ATT_HEADERS    = [
    "رقم السجل", "اسم الطالب", "المعلم",
    "الفئة الدراسية", "الصف الدراسي",
    "التاريخ", "الوقت", "الحالة", "ملاحظة", "وقت التسجيل"
];

// ===================================================================
// doPost — إضافة / تعديل / حذف
// ===================================================================
function doPost(e) {

    // ✅ قفل لمنع التداخل عند التزامن
    var lock = LockService.getScriptLock();
    try {
        lock.waitLock(15000);
    } catch (lockErr) {
        return responseJSON({ status: "error", message: "الخادم مشغول، يرجى إعادة المحاولة." });
    }

    try {
        var ss     = SpreadsheetApp.getActiveSpreadsheet();
        var sheet  = getOrCreateAttSheet(ss);
        var data   = JSON.parse(e.postData.contents);
        var action = (data.action || "").toString().trim();

        // ─────────────────────────────────────────────
        // 1. إضافة سجل حضور جديد
        // ─────────────────────────────────────────────
        if (action === "addAttendance") {
            var newId = generateId();
            sheet.appendRow([
                newId,
                (data.studentName || "").toString().trim(),
                (data.teacher     || "").toString().trim(),
                (data.category    || "").toString().trim(),
                (data.grade       || "").toString().trim(),
                (data.date        || "").toString().trim(),
                (data.time        || "").toString().trim(),
                (data.status      || "حاضر").toString().trim(),
                (data.note        || "").toString().trim(),
                new Date().toLocaleString("ar-EG")
            ]);

            return responseJSON({
                status:  "success",
                message: "تم حفظ سجل الحضور بنجاح.",
                rowId:   newId
            });
        }

        // ─────────────────────────────────────────────
        // 2. تعديل سجل موجود بواسطة rowId
        // ─────────────────────────────────────────────
        if (action === "updateAttendance") {
            var rowId  = (data.rowId || "").toString().trim();
            var values = sheet.getDataRange().getValues();
            var updated = false;

            for (var i = 1; i < values.length; i++) {
                if (values[i][0].toString() === rowId) {
                    sheet.getRange(i + 1, 1, 1, 10).setValues([[
                        rowId,
                        (data.studentName || "").toString().trim(),
                        (data.teacher     || "").toString().trim(),
                        (data.category    || "").toString().trim(),
                        (data.grade       || "").toString().trim(),
                        (data.date        || "").toString().trim(),
                        (data.time        || "").toString().trim(),
                        (data.status      || "حاضر").toString().trim(),
                        (data.note        || "").toString().trim(),
                        new Date().toLocaleString("ar-EG")
                    ]]);
                    updated = true;
                    break;
                }
            }

            return responseJSON({
                status:  updated ? "success" : "error",
                message: updated ? "تم تعديل السجل بنجاح." : "لم يُعثر على السجل."
            });
        }

        // ─────────────────────────────────────────────
        // 3. حذف سجل بواسطة rowId
        // ─────────────────────────────────────────────
        if (action === "deleteAttendance") {
            var rowId  = (data.rowId || "").toString().trim();
            var values = sheet.getDataRange().getValues();
            var deleted = false;

            for (var i = values.length - 1; i >= 1; i--) {
                if (values[i][0].toString() === rowId) {
                    sheet.deleteRow(i + 1);
                    deleted = true;
                    break;
                }
            }

            return responseJSON({
                status:  deleted ? "success" : "error",
                message: deleted ? "تم حذف السجل بنجاح." : "لم يُعثر على السجل."
            });
        }

        return responseJSON({ status: "success", message: "تم تنفيذ الإجراء." });

    } catch (err) {
        return responseJSON({ status: "error", message: err.toString() });
    } finally {
        lock.releaseLock();
    }
}

// ===================================================================
// doGet — جلب كل سجلات الحضور
// ===================================================================
function doGet(e) {
    try {
        var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "getAttendance";

        if (action === "getAttendance") {
            var ss     = SpreadsheetApp.getActiveSpreadsheet();
            var sheet  = ss.getSheetByName(ATT_SHEET_NAME);

            if (!sheet) return responseJSON({ status: "success", records: [] });

            var values  = sheet.getDataRange().getValues();
            var records = [];

            for (var i = 1; i < values.length; i++) {
                var row = values[i];
                if (!row[0]) continue; // تجاهل الصفوف الفارغة
                records.push({
                    rowId:       row[0]  ? row[0].toString()  : "",
                    studentName: row[1]  ? row[1].toString()  : "",
                    teacher:     row[2]  ? row[2].toString()  : "",
                    category:    row[3]  ? row[3].toString()  : "",
                    grade:       row[4]  ? row[4].toString()  : "",
                    date:        row[5]  ? row[5].toString()  : "",
                    time:        row[6]  ? row[6].toString()  : "",
                    status:      row[7]  ? row[7].toString()  : "",
                    note:        row[8]  ? row[8].toString()  : "",
                    timestamp:   row[9]  ? row[9].toString()  : ""
                });
            }

            return responseJSON({ status: "success", records: records });
        }

        return responseJSON({ status: "success", records: [] });

    } catch (err) {
        return responseJSON({ status: "error", message: err.toString() });
    }
}

// ===================================================================
// دوال مساعدة
// ===================================================================

/**
 * إنشاء أو فتح شيت الحضور والغياب مع التنسيق
 */
function getOrCreateAttSheet(ss) {
    var sheet = ss.getSheetByName(ATT_SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(ATT_SHEET_NAME);
        sheet.setRightToLeft(true);
        sheet.appendRow(ATT_HEADERS);

        var headerRange = sheet.getRange(1, 1, 1, ATT_HEADERS.length);
        headerRange.setBackground("#7c3aed");
        headerRange.setFontColor("#ffffff");
        headerRange.setFontWeight("bold");
        headerRange.setFontSize(11);
        headerRange.setHorizontalAlignment("center");
        headerRange.setVerticalAlignment("middle");
        sheet.setFrozenRows(1);
        sheet.setRowHeight(1, 38);

        // عرض الأعمدة
        var widths = [120, 180, 150, 120, 120, 110, 90, 90, 180, 160];
        widths.forEach(function(w, c) { sheet.setColumnWidth(c + 1, w); });

        // تنسيق عمود الحالة (حاضر / غائب) — لونين مختلفين
        // (سيتم تطبيقه ديناميكياً عند الإضافة لاحقاً)
    }
    return sheet;
}

/**
 * توليد ID فريد للسجل بناءً على الوقت الحالي
 */
function generateId() {
    return "ATT-" + new Date().getTime();
}

/**
 * إرجاع استجابة JSON
 */
function responseJSON(data) {
    return ContentService.createTextOutput(JSON.stringify(data))
        .setMimeType(ContentService.MimeType.JSON);
}

