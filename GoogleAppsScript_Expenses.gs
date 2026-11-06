/**
 * ==============================================================================
 * كود Google Apps Script — إدارة المصروفات والمخرجات (Expenses Management)
 * ==============================================================================
 * 
 * الميزات:
 * 1. حفظ المصروفات في صفحة (Tab) باسم "المصروفات" تلقائياً.
 * 2. قفل LockService لمنع تداخل البيانات عند التزامن.
 * 3. جلب جميع المصروفات بصيغة JSON مرتبة بالتاريخ.
 * 4. تعديل وحذف المصروفات بسهولة بواسطة معرف السجل (rowId).
 * ==============================================================================
 */

var EXPENSES_SHEET_NAME = "المصروفات";
var EXPENSES_HEADERS = [
  "رقم السجل",
  "التاريخ",
  "بند المصروف / البيان",
  "التصنيف",
  "المبلغ (جنيه)",
  "المسؤول / المستلم",
  "ملاحظات",
  "وقت التسجيل"
];

// دالة مساعدة لإنشاء رد بصيغة JSON مع رؤوس CORS
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// إنشاء أو جلب شيت المصروفات مع التنسيق
function getOrCreateExpensesSheet(ss) {
  var sheet = ss.getSheetByName(EXPENSES_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(EXPENSES_SHEET_NAME);
    sheet.appendRow(EXPENSES_HEADERS);
    sheet.setRightToLeft(true);

    var headerRange = sheet.getRange(1, 1, 1, EXPENSES_HEADERS.length);
    headerRange.setBackground("#ef4444"); // لون أحمر مميز للمصروفات
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setHorizontalAlignment("center");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// دالة توليد رقم سجل فريد
function generateExpenseId() {
  var d = new Date();
  return "EXP-" + Utilities.formatDate(d, "GMT+2", "yyyyMMdd-HHmmss") + "-" + Math.floor(Math.random() * 900 + 100);
}

// ===================================================================
// doPost — إضافة / تعديل / حذف المصروفات
// ===================================================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (lockErr) {
    return responseJSON({ status: "error", message: "الخادم مشغول، يرجى إعادة المحاولة." });
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = getOrCreateExpensesSheet(ss);
    
    var data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    }
    
    var action = (data.action || "").toString().trim();

    // ─────────────────────────────────────────────
    // 1. إضافة مصروف جديد
    // ─────────────────────────────────────────────
    if (action === "addExpense") {
      var newId = generateExpenseId();
      var amount = parseFloat(data.amount) || 0;
      var dateStr = (data.date || Utilities.formatDate(new Date(), "GMT+2", "yyyy-MM-dd")).toString().trim();

      sheet.appendRow([
        newId,
        dateStr,
        (data.title || data.description || "").toString().trim(),
        (data.category || "أخرى").toString().trim(),
        amount,
        (data.spentBy || data.recipient || "").toString().trim(),
        (data.notes || "").toString().trim(),
        Utilities.formatDate(new Date(), "GMT+2", "yyyy-MM-dd HH:mm:ss")
      ]);

      return responseJSON({
        status: "success",
        message: "تم حفظ المصروف بنجاح.",
        rowId: newId
      });
    }

    // ─────────────────────────────────────────────
    // 2. تعديل مصروف موجود بواسطة rowId
    // ─────────────────────────────────────────────
    if (action === "updateExpense") {
      var rowId = (data.rowId || "").toString().trim();
      var values = sheet.getDataRange().getValues();
      var updated = false;

      for (var i = 1; i < values.length; i++) {
        if (values[i][0].toString() === rowId) {
          var amount = parseFloat(data.amount) || 0;
          sheet.getRange(i + 1, 1, 1, 8).setValues([[
            rowId,
            (data.date || values[i][1]).toString().trim(),
            (data.title || data.description || "").toString().trim(),
            (data.category || "أخرى").toString().trim(),
            amount,
            (data.spentBy || data.recipient || "").toString().trim(),
            (data.notes || "").toString().trim(),
            Utilities.formatDate(new Date(), "GMT+2", "yyyy-MM-dd HH:mm:ss")
          ]]);
          updated = true;
          break;
        }
      }

      return responseJSON({
        status: updated ? "success" : "error",
        message: updated ? "تم تعديل المصروف بنجاح." : "لم يُعثر على السجل المطلوب تعديله."
      });
    }

    // ─────────────────────────────────────────────
    // 3. حذف مصروف بواسطة rowId
    // ─────────────────────────────────────────────
    if (action === "deleteExpense") {
      var rowId = (data.rowId || "").toString().trim();
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
        status: deleted ? "success" : "error",
        message: deleted ? "تم حذف المصروف بنجاح." : "لم يُعثر على السجل المطلوب حذفه."
      });
    }

    // ─────────────────────────────────────────────
    // 4. جلب المصروفات عبر POST أيضاً (للتوافق)
    // ─────────────────────────────────────────────
    if (action === "getExpenses") {
      var expenses = fetchAllExpenses(sheet);
      return responseJSON({ status: "success", records: expenses });
    }

    return responseJSON({ status: "error", message: "إجراء غير معروف: " + action });

  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ===================================================================
// doGet — جلب المصروفات للواجهة
// ===================================================================
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(EXPENSES_SHEET_NAME);

    if (!sheet) {
      return responseJSON({ status: "success", records: [] });
    }

    var records = fetchAllExpenses(sheet);
    return responseJSON({ status: "success", records: records });

  } catch (err) {
    return responseJSON({ status: "error", message: err.toString() });
  }
}

// دالة مساعدة لقراءة كل السجلات من الشيت
function fetchAllExpenses(sheet) {
  var values = sheet.getDataRange().getValues();
  var records = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row[0]) continue; // تجاهل الصفوف الفارغة

    var dateVal = row[1];
    if (dateVal instanceof Date) {
      dateVal = Utilities.formatDate(dateVal, "GMT+2", "yyyy-MM-dd");
    }

    records.push({
      rowId: row[0] ? row[0].toString() : "",
      date: dateVal ? dateVal.toString() : "",
      title: row[2] ? row[2].toString() : "",
      category: row[3] ? row[3].toString() : "",
      amount: parseFloat(row[4]) || 0,
      spentBy: row[5] ? row[5].toString() : "",
      notes: row[6] ? row[6].toString() : "",
      timestamp: row[7] ? row[7].toString() : ""
    });
  }

  // الترتيب من الأحدث إلى الأقدم حسب التاريخ
  records.reverse();
  return records;
}

