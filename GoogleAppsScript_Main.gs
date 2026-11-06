/**
 * ==============================================================================
 * كود Google Apps Script الأساسي والمصحح بنسبة 100% — نظام التحصيل والمعلمين
 * إصدار خالي من الأخطاء ومحسن للأداء والأمان والتعامل مع حالات الضغط العالي
 * ==============================================================================
 */

// المعرف الخاص بمجلد حفظ إيصالات الدفع على Google Drive
var FOLDER_ID = "1lgmAFHgA3CcCjsHizYNAn3WgfTJXsKac";

// قائمة الفئات الدراسية المسموح بها بترتيبها المطلوب للتنسيق
var VALID_CATEGORIES = [
  "ابتدائي",
  "ابتدائي لغات",
  "اعدادي",
  "اعدادي لغات",
  "ثانوي",
  "ثانوي لغات"
];

// ترتيب الصفوف الخاص بكل مرحلة دراسية
var GRADE_ORDERS = {
  "ابتدائي": ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
  "ابتدائي لغات": ["تأسيس", "الثالث", "الرابع", "الخامس", "السادس"],
  "اعدادي": ["الأول", "الثاني", "الثالث"],
  "اعدادي لغات": ["الأول", "الثاني", "الثالث"],
  "ثانوي": ["الأول", "الثاني", "الثالث"],
  "ثانوي لغات": ["الأول", "الثاني", "الثالث"]
};

// =========================================================
// دالة doPost — معالجة جميع طلبات الكتابة (POST)
// =========================================================
function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;
  
  try {
    hasLock = lock.tryLock(20000);
    if (!hasLock) {
      return createResponse({
        status: "error",
        message: "الخادم مشغول حالياً بمعالجة طلبات أخرى، يرجى المحاولة مجدداً بعد لحظات."
      });
    }

    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ status: "error", message: "لا توجد بيانات مرسلة في الطلب." });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createResponse({ status: "error", message: "تنسيق البيانات المرسلة غير صالح (Invalid JSON)." });
    }

    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // ---------------------------------------------------------
    // 1. إضافة معلم جديد وإنشاء صفحته الخاصة
    // ---------------------------------------------------------
    if (action === "addTeacher") {
      var teacherName = (data.teacherName || "").toString().trim();
      if (!teacherName) {
        return createResponse({ status: "error", message: "اسم المعلم مطلوب." });
      }

      var teacherSheet = ss.getSheetByName("Teachers");
      if (!teacherSheet) {
        teacherSheet = ss.insertSheet("Teachers");
        teacherSheet.setRightToLeft(true);
        teacherSheet.appendRow(["المعلم"]);
        formatHeaderRow(teacherSheet, 1);
      }

      // التحقق من عدم وجود المعلم مسبقاً لمنع التكرار
      var existingTeachers = [];
      if (teacherSheet.getLastRow() > 1) {
        var tVals = teacherSheet.getRange(2, 1, teacherSheet.getLastRow() - 1, 1).getValues();
        for (var t = 0; t < tVals.length; t++) {
          if (tVals[t][0]) existingTeachers.push(tVals[t][0].toString().trim());
        }
      }

      if (existingTeachers.indexOf(teacherName) === -1) {
        teacherSheet.appendRow([teacherName]);
      }

      // إنشاء الشيت الفردي للمعلم إذا لم يكن موجوداً
      var personalSheet = ss.getSheetByName(teacherName);
      if (!personalSheet) {
        personalSheet = ss.insertSheet(teacherName);
        personalSheet.setRightToLeft(true);
        personalSheet.appendRow(["التاريخ", "اسم الطالب", "الفئة", "الصف", "المبلغ", "رابط الإيصال"]);
        formatHeaderRow(personalSheet, 6);
      }

      return createResponse({ status: "success", message: "تم إضافة المعلم بنجاح." });
    }

    // ---------------------------------------------------------
    // 2. إضافة تحصيل فردي ورفع الإيصال
    // ---------------------------------------------------------
    if (action === "addTransaction") {
      var studentName = (data.studentName || "").toString().trim();
      var teacherName = (data.teacherName || "").toString().trim();
      var category    = (data.category || "").toString().trim();
      var grade       = (data.grade || "").toString().trim();
      var amount      = (data.amount !== undefined ? data.amount : "0").toString().trim();
      var date        = (data.date || new Date().toLocaleString('ar-EG')).toString().trim();

      if (!studentName || !teacherName) {
        return createResponse({ status: "error", message: "بيانات الطالب والمعلم مطلوبة." });
      }

      // رفع الملف بأمان دون إيقاف العملية في حال فشل التخزين
      var fileUrl = uploadTempReceiptSafely(data.fileBase64, data.mimeType, data.fileName, studentName);

      // شيت المعاملات العام
      var transSheet = getOrCreateTransactionsSheet(ss);
      transSheet.appendRow([date, studentName, teacherName, category, grade, amount, fileUrl]);
      sortSheetData(transSheet, 4, 5);

      // شيت المعلم الفردي
      var tSheet = getOrCreateTeacherSheet(ss, teacherName);
      tSheet.appendRow([date, studentName, category, grade, amount, fileUrl]);
      sortSheetData(tSheet, 3, 4);

      return createResponse({ status: "success", message: "تم حفظ بيانات التحصيل بنجاح.", fileUrl: fileUrl });
    }

    // ---------------------------------------------------------
    // 3. إضافة تحصيل مجمع لعدة معلمين (Bulk Transactions)
    // ---------------------------------------------------------
    if (action === "addTransactionsBulk") {
      var transactions = Array.isArray(data.transactions) ? data.transactions : [];
      if (transactions.length === 0) {
        return createResponse({ status: "error", message: "لا توجد معاملات مرسلة لتسجيلها." });
      }

      var defaultStudent = (transactions[0] && transactions[0].studentName) ? transactions[0].studentName : "Bulk";
      var fileUrl = uploadReceiptSafely(data.fileBase64, data.mimeType, data.fileName, defaultStudent);

      var transSheet = getOrCreateTransactionsSheet(ss);
      var newTransRows = [];
      var teacherRowsMap = {};

      for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        if (!tx) continue;

        var sName = (tx.studentName || "").toString().trim();
        var tName = (tx.teacherName || "").toString().trim();
        var cat   = (tx.category || "").toString().trim();
        var grd   = (tx.grade || "").toString().trim();
        var amt   = (tx.amount !== undefined ? tx.amount : "0").toString().trim();
        var dt    = (tx.date || new Date().toLocaleString('ar-EG')).toString().trim();

        if (!sName || !tName) continue;

        newTransRows.push([dt, sName, tName, cat, grd, amt, fileUrl]);

        if (!teacherRowsMap[tName]) teacherRowsMap[tName] = [];
        teacherRowsMap[tName].push([dt, sName, cat, grd, amt, fileUrl]);
      }

      // كتابة دفعية فائقة السرعة للشيت العام (Single Batch Write)
      if (newTransRows.length > 0) {
        var startRow = transSheet.getLastRow() + 1;
        transSheet.getRange(startRow, 1, newTransRows.length, 7).setValues(newTransRows);
      }

      // كتابة دفعية فائقة السرعة لكل شيت معلم
      for (var tKey in teacherRowsMap) {
        var tSheet = getOrCreateTeacherSheet(ss, tKey);
        var tStartRow = tSheet.getLastRow() + 1;
        tSheet.getRange(tStartRow, 1, teacherRowsMap[tKey].length, 6).setValues(teacherRowsMap[tKey]);
      }

      return createResponse({
        status: "success",
        message: "تم حفظ التحصيلات بنجاح فائق",
        count: transactions.length,
        fileUrl: fileUrl
      });
    }

    // ---------------------------------------------------------
    // 3.ب. إضافة طلب دفع إلى العمليات المعلقة (Pending Transactions)
    // ---------------------------------------------------------
    if (action === "addPendingTransaction") {
      var studentName = (data.studentName || "").toString().trim();
      var teachersStr = (data.teachers || "").toString().trim();
      var category    = (data.category || "").toString().trim();
      var grade       = (data.grade || "").toString().trim();
      var totalAmount = (data.totalAmount !== undefined ? data.totalAmount : "0").toString().trim();
      var dateStr     = (data.date || new Date().toLocaleString('ar-EG')).toString().trim();
      var items       = data.items || [];

      if (!studentName) {
        return createResponse({ status: "error", message: "اسم الطالب مطلوب لتقديم الطلب." });
      }

      // حفظ صورة الإيصال في الدرايف بشكل آمن
      var fileUrl = uploadReceiptSafely(data.fileBase64, data.mimeType, data.fileName, studentName);

      var pendingSheet = getOrCreatePendingSheet(ss);
      var reqId = "REQ_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
      var itemsJson = JSON.stringify(items);

      // الأعمدة: [معرف الطلب, التاريخ, اسم الطالب, المعلم/المعلمين, الفئة, الصف, المبلغ, رابط الإيصال, الحالة, تفاصيل المعاملات]
      pendingSheet.appendRow([
        reqId,
        dateStr,
        studentName,
        teachersStr,
        category,
        grade,
        totalAmount,
        fileUrl,
        "معلق",
        itemsJson
      ]);

      return createResponse({
        status: "success",
        message: "تم تسجيل طلب الدفع بنجاح وهو قيد مراجعة وتأكيد الإدارة.",
        requestId: reqId,
        fileUrl: fileUrl
      });
    }

    // ---------------------------------------------------------
    // 3.ج. تأكيد طلب دفع معلق (نقل للتحصيل الفعلي وتحديث الحالة لمؤكد)
    // ---------------------------------------------------------
    if (action === "confirmPendingTransaction") {
      var requestId = (data.requestId || "").toString().trim();
      if (!requestId) {
        return createResponse({ status: "error", message: "معرف الطلب مطلوب للتأكيد." });
      }

      var pendingSheet = getOrCreatePendingSheet(ss);
      if (pendingSheet.getLastRow() <= 1) {
        return createResponse({ status: "error", message: "لا توجد طلبات معلقة." });
      }

      var pRange = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn());
      var pValues = pRange.getValues();
      var foundRow = -1;
      var targetData = null;

      for (var r = 0; r < pValues.length; r++) {
        if ((pValues[r][0] || "").toString().trim() === requestId) {
          foundRow = r + 2;
          targetData = pValues[r];
          break;
        }
      }

      if (foundRow === -1 || !targetData) {
        return createResponse({ status: "error", message: "لم يتم العثور على طلب الدفع المعلق." });
      }

      var currentStatus = (targetData[8] || "").toString().trim();
      if (currentStatus === "مؤكد") {
        return createResponse({ status: "warning", message: "هذا الطلب تم تأكيده بالفعل مسبقاً." });
      }

      var reqDate     = targetData[1];
      var sName       = targetData[2];
      var fallbackTeacher = targetData[3];
      var cat         = targetData[4];
      var grd         = targetData[5];
      var totAmt      = targetData[6];
      var fileUrl     = targetData[7];
      var itemsJson   = targetData[9];

      var items = [];
      try {
        if (itemsJson) items = JSON.parse(itemsJson);
      } catch(e) {}

      if (!items || items.length === 0) {
        items = [{
          studentName: sName,
          teacherName: fallbackTeacher,
          category: cat,
          grade: grd,
          amount: totAmt,
          date: reqDate
        }];
      }

      // تسجيل المعاملات في Transactions وشيتات المعلمين
      var transSheet = getOrCreateTransactionsSheet(ss);
      var touchedTeacherSheets = {};

      for (var k = 0; k < items.length; k++) {
        var itm = items[k];
        if (!itm) continue;
        var itemStudent = (itm.studentName || sName || "").toString().trim();
        var itemTeacher = (itm.teacherName || fallbackTeacher || "").toString().trim();
        var itemCat     = (itm.category || cat || "").toString().trim();
        var itemGrd     = (itm.grade || grd || "").toString().trim();
        var itemAmt     = (itm.amount !== undefined ? itm.amount : totAmt).toString().trim();
        var itemDt      = (itm.date || reqDate || new Date().toLocaleString('ar-EG')).toString().trim();

        if (!itemStudent || !itemTeacher) continue;

        // إضافة في شيت Transactions العام
        transSheet.appendRow([itemDt, itemStudent, itemTeacher, itemCat, itemGrd, itemAmt, fileUrl]);

        // إضافة في شيت المعلم الفردي
        var tSheet = touchedTeacherSheets[itemTeacher] || getOrCreateTeacherSheet(ss, itemTeacher);
        touchedTeacherSheets[itemTeacher] = tSheet;
        tSheet.appendRow([itemDt, itemStudent, itemCat, itemGrd, itemAmt, fileUrl]);
      }

      // إعادة الترتيب
      sortSheetData(transSheet, 4, 5);
      for (var tKey in touchedTeacherSheets) {
        if (touchedTeacherSheets.hasOwnProperty(tKey)) {
          sortSheetData(touchedTeacherSheets[tKey], 3, 4);
        }
      }

      // حذف صورة الإيصال المؤقتة من Drive لتوفير المساحة بعد التأكيد
      deleteReceiptFileSafely(fileUrl);

      // مسح الطلب من شيت العمليات المعلقة بعد تأكيده وترحيله بنجاح
      pendingSheet.deleteRow(foundRow);

      return createResponse({
        status: "success",
        message: "تم تأكيد طلب الدفع بنجاح وترحيله إلى سجلات التحصيل وشيتات المعلمين."
      });
    }

    // ---------------------------------------------------------
    // 3.د. رفض طلب دفع معلق
    // ---------------------------------------------------------
    if (action === "rejectPendingTransaction") {
      var requestId = (data.requestId || "").toString().trim();
      var reason    = (data.reason || "رفض من قبل الإدارة").toString().trim();
      if (!requestId) {
        return createResponse({ status: "error", message: "معرف الطلب مطلوب للرفض." });
      }

      var pendingSheet = getOrCreatePendingSheet(ss);
      if (pendingSheet.getLastRow() <= 1) {
        return createResponse({ status: "error", message: "لا توجد طلبات معلقة." });
      }

      var pRange = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn());
      var pValues = pRange.getValues();
      var foundRow = -1;

      for (var r = 0; r < pValues.length; r++) {
        if ((pValues[r][0] || "").toString().trim() === requestId) {
          foundRow = r + 2;
          break;
        }
      }

      if (foundRow === -1) {
        return createResponse({ status: "error", message: "لم يتم العثور على طلب الدفع المعلق." });
      }

      var pFileUrl = (pValues[r][7] || "").toString().trim();
      deleteReceiptFileSafely(pFileUrl);
      // مسح الطلب المرفوض من شيت العمليات المعلقة
      pendingSheet.deleteRow(foundRow);

      return createResponse({
        status: "success",
        message: "تم رفض عملية الدفع بنجاح وتحديث حالتها في الشيت."
      });
    }

    // ---------------------------------------------------------
    // 4. تصفية حساب معلم (تصفير مبالغ فرقة معينة)
    // ---------------------------------------------------------
    if (action === "clearDues") {
      var teacherName = (data.teacherName || "").toString().trim();
      var category    = (data.category || "").toString().trim();
      var grade       = (data.grade || "").toString().trim();

      if (!teacherName || !category || !grade) {
        return createResponse({ status: "error", message: "يجب تحديد المعلم والفئة والصف لإتمام التصفية." });
      }

      var clearedCount = 0;
      var transSheet = ss.getSheetByName("Transactions");
      if (transSheet && transSheet.getLastRow() > 1) {
        var tRange = transSheet.getRange(2, 1, transSheet.getLastRow() - 1, transSheet.getLastColumn());
        var tData = tRange.getValues();
        var changedTrans = false;

        for (var i = 0; i < tData.length; i++) {
          var rowTeacher  = (tData[i][2] || "").toString().trim();
          var rowCategory = (tData[i][3] || "").toString().trim();
          var rowGrade    = (tData[i][4] || "").toString().trim();

          if (rowTeacher === teacherName && rowCategory === category && rowGrade === grade) {
            tData[i][5] = 0; // تصفير المبلغ
            clearedCount++;
            changedTrans = true;
          }
        }

        if (changedTrans) {
          tRange.setValues(tData);
        }
      }

      var teacherPersonalSheet = ss.getSheetByName(teacherName);
      if (teacherPersonalSheet && teacherPersonalSheet.getLastRow() > 1) {
        var pRange = teacherPersonalSheet.getRange(2, 1, teacherPersonalSheet.getLastRow() - 1, teacherPersonalSheet.getLastColumn());
        var pData = pRange.getValues();
        var changedPersonal = false;

        for (var j = 0; j < pData.length; j++) {
          var pCategory = (pData[j][2] || "").toString().trim();
          var pGrade    = (pData[j][3] || "").toString().trim();

          if (pCategory === category && pGrade === grade) {
            pData[j][4] = 0; // تصفير المبلغ في شيت المعلم الفردي
            changedPersonal = true;
          }
        }

        if (changedPersonal) {
          pRange.setValues(pData);
        }
      }

      return createResponse({
        status: "success",
        message: "تم تصفية حساب أستاذ/ " + teacherName + " لفرقة " + category + " (" + grade + ") — " + clearedCount + " سجل تم تصفيره."
      });
    }

    // ---------------------------------------------------------
    // 5. حذف المعلم نهائياً
    // ---------------------------------------------------------
    if (action === "deleteTeacher") {
      var teacherName = (data.teacherName || "").toString().trim();
      if (!teacherName) {
        return createResponse({ status: "error", message: "اسم المعلم مطلوب لإتمام الحذف." });
      }

      var teacherListSheet = ss.getSheetByName("Teachers");
      if (teacherListSheet && teacherListSheet.getLastRow() > 1) {
        var tListData = teacherListSheet.getRange(1, 1, teacherListSheet.getLastRow(), 1).getValues();
        for (var i = tListData.length - 1; i >= 1; i--) {
          if ((tListData[i][0] || "").toString().trim() === teacherName) {
            teacherListSheet.deleteRow(i + 1);
          }
        }
      }

      var transSheet = ss.getSheetByName("Transactions");
      if (transSheet && transSheet.getLastRow() > 1) {
        var transData = transSheet.getRange(1, 1, transSheet.getLastRow(), transSheet.getLastColumn()).getValues();
        for (var j = transData.length - 1; j >= 1; j--) {
          if ((transData[j][2] || "").toString().trim() === teacherName) {
            transSheet.deleteRow(j + 1);
          }
        }
      }

      var personalSheet = ss.getSheetByName(teacherName);
      if (personalSheet) {
        ss.deleteSheet(personalSheet);
      }

      return createResponse({ status: "success", message: "تم حذف المعلم وكل بياناته بنجاح." });
    }

    // ---------------------------------------------------------
    // 6. حذف دفعة تحصيل محددة (معكوسة في Transactions وشيت المدرس)
    // ---------------------------------------------------------
    if (action === "deleteTransaction") {
      var studentName = (data.studentName || "").toString().trim();
      var teacherName = (data.teacherName || "").toString().trim();
      var category    = (data.category || "").toString().trim();
      var grade       = (data.grade || "").toString().trim();
      var dateStr     = (data.date || "").toString().trim();
      var targetAmt   = parseFloat(data.amount);

      if (!studentName || !teacherName) {
        return createResponse({ status: "error", message: "بيانات الطالب والمعلم مطلوبة لإتمام الحذف." });
      }

      var normStudent = normalizeArabic(studentName);
      var normTeacher = normalizeArabic(teacherName);

      var deletedFromTrans = false;
      var deletedFromTeacher = false;

      // أ) الحذف من شيت Transactions العام (من الأسفل للأعلى، حذف نسخة واحدة فقط)
      var transSheet = ss.getSheetByName("Transactions");
      if (transSheet && transSheet.getLastRow() > 1) {
        var transRange = transSheet.getRange(1, 1, transSheet.getLastRow(), transSheet.getLastColumn());
        var transValues = transRange.getValues();

        for (var i = transValues.length - 1; i >= 1; i--) {
          var rDateVal = transValues[i][0];
          var rStudent = normalizeArabic(transValues[i][1]);
          var rTeacher = normalizeArabic(transValues[i][2]);
          var rCat     = (transValues[i][3] || "").toString().trim();
          var rGrade   = (transValues[i][4] || "").toString().trim();
          var rAmt     = parseFloat(transValues[i][5]);

          var matchStudent = (rStudent === normStudent);
          var matchTeacher = (rTeacher === normTeacher);
          var matchAmount  = (isNaN(targetAmt) || rAmt === targetAmt);
          var matchCat     = (!category || rCat === category);
          var matchGrade   = (!grade || rGrade === grade);
          var matchDate    = true;

          if (dateStr && rDateVal) {
            matchDate = compareDatesFlexible(rDateVal, dateStr);
          }

          if (matchStudent && matchTeacher && matchAmount && matchCat && matchGrade && matchDate) {
            transSheet.deleteRow(i + 1);
            deletedFromTrans = true;
            break; // حذف نسخة واحدة فقط لمنع حذف التكرارات الأخرى
          }
        }
      }

      // ب) الحذف من صفحة المعلم الفردية (Teacher Tab)
      var personalSheet = ss.getSheetByName(teacherName);
      if (personalSheet && personalSheet.getLastRow() > 1) {
        var pRange = personalSheet.getRange(1, 1, personalSheet.getLastRow(), personalSheet.getLastColumn());
        var pValues = pRange.getValues();

        for (var j = pValues.length - 1; j >= 1; j--) {
          var pDateVal = pValues[j][0];
          var pStudent = normalizeArabic(pValues[j][1]);
          var pCat     = (pValues[j][2] || "").toString().trim();
          var pGrade   = (pValues[j][3] || "").toString().trim();
          var pAmt     = parseFloat(pValues[j][4]);

          var pMatchStudent = (pStudent === normStudent);
          var pMatchAmount  = (isNaN(targetAmt) || pAmt === targetAmt);
          var pMatchCat     = (!category || pCat === category);
          var pMatchGrade   = (!grade || pGrade === grade);
          var pMatchDate    = true;

          if (dateStr && pDateVal) {
            pMatchDate = compareDatesFlexible(pDateVal, dateStr);
          }

          if (pMatchStudent && pMatchAmount && pMatchCat && pMatchGrade && pMatchDate) {
            personalSheet.deleteRow(j + 1);
            deletedFromTeacher = true;
            break; // حذف نسخة واحدة فقط
          }
        }
      }

      if (deletedFromTrans || deletedFromTeacher) {
        return createResponse({
          status: "success",
          message: "تم حذف معاملة التحصيل بنجاح من الشيت العام ومن صفحة المعلم.",
          deletedFromTransactions: deletedFromTrans,
          deletedFromTeacherSheet: deletedFromTeacher
        });
      } else {
        return createResponse({
          status: "warning",
          message: "لم يتم العثور على سجل مطابق تماماً للحذف، يرجى تحديث البيانات."
        });
      }
    }

    return createResponse({ status: "error", message: "إجراء غير معروف: " + action });

  } catch (error) {
    return createResponse({ status: "error", message: error.toString() });
  } finally {
    if (hasLock) {
      try {
        lock.releaseLock();
      } catch (e) {}
    }
  }
}

// =========================================================
// دالة doGet — جلب قائمة المعلمين أو جلب سجلات التحصيل
// =========================================================
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "";

    // 1. جلب كافة سجلات التحصيل لشاشة استعلام الطلاب
    if (action === "getPendingTransactions") {
      var pendingSheet = ss.getSheetByName("العمليات المعلقة");
      if (!pendingSheet || pendingSheet.getLastRow() <= 1) {
        return createResponse({ status: "success", pendingList: [] });
      }

      var pVals = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn()).getValues();
      var list = [];

      for (var p = 0; p < pVals.length; p++) {
        var row = pVals[p];
        if (!row[0]) continue; // reqId

        var reqStatus = (row[8] || "").toString().trim();
        var parsedItems = [];
        try {
          if (row[9]) parsedItems = JSON.parse(row[9]);
        } catch(e) {}

        list.push({
          requestId: row[0] ? row[0].toString().trim() : "",
          date: row[1] ? row[1].toString().trim() : "",
          studentName: row[2] ? row[2].toString().trim() : "",
          teachers: row[3] ? row[3].toString().trim() : "",
          category: row[4] ? row[4].toString().trim() : "",
          grade: row[5] ? row[5].toString().trim() : "",
          totalAmount: (row[6] !== undefined && row[6] !== null) ? row[6].toString().trim() : "0",
          receiptLink: row[7] ? row[7].toString().trim() : "",
          status: reqStatus || "معلق",
          items: parsedItems
        });
      }

      return createResponse({ status: "success", pendingList: list });
    }

    if (action === "getTransactions") {
      var transSheet = ss.getSheetByName("Transactions");
      if (!transSheet || transSheet.getLastRow() <= 1) {
        return createResponse({ status: "success", transactions: [] });
      }

      var values = transSheet.getRange(2, 1, transSheet.getLastRow() - 1, transSheet.getLastColumn()).getValues();
      var transactions = [];

      for (var i = 0; i < values.length; i++) {
        var row = values[i];
        if (!row[1]) continue;

        transactions.push({
          date: row[0] ? row[0].toString().trim() : "",
          studentName: row[1] ? row[1].toString().trim() : "",
          teacherName: row[2] ? row[2].toString().trim() : "",
          category: row[3] ? row[3].toString().trim() : "",
          grade: row[4] ? row[4].toString().trim() : "",
          amount: (row[5] !== undefined && row[5] !== null) ? row[5].toString().trim() : "0",
          fileLink: row[6] ? row[6].toString().trim() : ""
        });
      }

      return createResponse({ status: "success", transactions: transactions });
    }

    // 2. الافتراضي: جلب قائمة المعلمين
    var sheet = ss.getSheetByName("Teachers");
    if (!sheet || sheet.getLastRow() <= 1) {
      return createResponse([]);
    }

    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    var teachers = [];
    for (var j = 0; j < data.length; j++) {
      if (data[j] && data[j][0]) {
        var name = data[j][0].toString().trim();
        if (name !== "" && teachers.indexOf(name) === -1) {
          teachers.push(name);
        }
      }
    }
    return createResponse(teachers);

  } catch (err) {
    return createResponse({ status: "error", message: err.toString() });
  }
}

// =========================================================
// دوال المساعدة والمعمارية (Helper Functions)
// =========================================================

/**
 * الحصول على شيت Transactions أو إنشاؤه وتنسيقه
 */
/**
 * الحصول على شيت العمليات المعلقة أو إنشاؤه وتنسيقه
 */
/**
 * الحصول على شيت العمليات المعلقة أو إنشاؤه وتنسيقه الاحترافي الشامل
 * يتضمن:
 * 1. ضبط اتجاه الشيت من اليمين لليسار.
 * 2. ترويسة متناسقة وتجميد الصف الأول لمنع اختفائه أثناء التمرير.
 * 3. تخصيص عرض كل عمود حسب نوع محتواه لمنع قطع النصوص أو تشوه البيانات.
 * 4. محاذاة تلقائية للنصوص والأرقام والتواريخ وتنسيق العملات.
 */
/**
 * الحصول على شيت العمليات المعلقة أو إنشاؤه وتنسيقه الاحترافي الشامل
 * يتضمن:
 * 1. ضبط اتجاه الشيت من اليمين لليسار (RTL).
 * 2. ترويسة متناسقة وتجميد الصف الأول لمنع اختفائه أثناء التمرير.
 * 3. تخصيص عرض كل عمود بدقة هندسية تمنع أي قص أو تشوه في أسماء المعلمين والروابط.
 * 4. محاذاة وتنسيق تلقائي وتفعيل قائمة منسدلة (Data Validation) لعمود الحالة.
 */
function getOrCreatePendingSheet(ss) {
  var sheetName = "العمليات المعلقة";
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.setRightToLeft(true);

    var headers = [
      "معرف الطلب",        // A (1)
      "التاريخ",           // B (2)
      "اسم الطالب",        // C (3)
      "المعلم/المعلمين",    // D (4)
      "الفئة",             // E (5)
      "الصف",             // F (6)
      "إجمالي المبلغ",     // G (7)
      "رابط الإيصال",      // H (8)
      "الحالة",           // I (9)
      "تفاصيل المعاملات"   // J (10)
    ];

    sheet.appendRow(headers);

    // 1. تنسيق ترويسة الشيت الاحترافية وتجميدها
    formatHeaderRow(sheet, headers.length, "#854d0e");

    // 2. ضبط عرض الأعمدة بدقة هندسية تمنع أي قص أو تشوه
    var columnWidths = {
      1: 160, // معرف الطلب (REQ_...)
      2: 165, // التاريخ والوقت
      3: 220, // اسم الطالب كاملاً
      4: 240, // المعلمون (خصوصاً مع الدفع المجمع)
      5: 125, // المرحلة الدراسية
      6: 120, // الصف الدراسي
      7: 130, // إجمالي المبلغ
      8: 260, // رابط Drive
      9: 110, // الحالة (معلق / مؤكد / مرفوض)
      10: 320 // تفاصيل المعاملات المفصلة JSON
    };

    for (var colIndex in columnWidths) {
      sheet.setColumnWidth(parseInt(colIndex, 10), columnWidths[colIndex]);
    }

    // 3. ضبط التنسيق الهندسي والمحاذاة التلقائية وقواعد التحقق
    try {
      var maxRows = sheet.getMaxRows();
      if (maxRows > 1) {
        var dataRange = sheet.getRange(2, 1, maxRows - 1, headers.length);

        // محاذاة رأسية لكافة الخلايا
        dataRange.setVerticalAlignment("middle");

        // توسيط الأعمدة ذات البيانات المحددة
        sheet.getRange(2, 1, maxRows - 1, 2).setHorizontalAlignment("center"); // A & B
        sheet.getRange(2, 5, maxRows - 1, 2).setHorizontalAlignment("center"); // E & F
        sheet.getRange(2, 7, maxRows - 1, 1).setHorizontalAlignment("center").setNumberFormat("#,##0.00"); // G (المبلغ)
        sheet.getRange(2, 9, maxRows - 1, 1).setHorizontalAlignment("center"); // I (الحالة)

        // التفاف النص لأسماء المعلمين وبيانات JSON لعدم التداخل
        sheet.getRange(2, 4, maxRows - 1, 1).setWrap(true);
        sheet.getRange(2, 10, maxRows - 1, 1).setWrap(true);

        // إضافة قائمة منسدلة (Dropdown) تفاعلية لعمود الحالة
        var statusRule = SpreadsheetApp.newDataValidation()
          .requireValueInList(["معلق", "مؤكد", "مرفوض"], true)
          .setAllowInvalid(true)
          .build();
        sheet.getRange(2, 9, maxRows - 1, 1).setDataValidation(statusRule);
      }
    } catch(fmtErr) {}
  }
  
  return sheet;
}

/**
 * الحصول على شيت المعلم الفردي أو إنشاؤه وتنسيقه
 */
/**
 * الحصول على شيت Transactions أو إنشاؤه وتنسيقه
 */
function getOrCreateTransactionsSheet(ss) {
  var sheet = ss.getSheetByName("Transactions");
  if (!sheet) {
    sheet = ss.insertSheet("Transactions");
    sheet.setRightToLeft(true);
    sheet.appendRow(["التاريخ", "اسم الطالب", "المعلم", "الفئة", "الصف", "المبلغ", "رابط الإيصال"]);
    formatHeaderRow(sheet, 7);
  }
  return sheet;
}

function getOrCreateTeacherSheet(ss, teacherName) {
  var sheet = ss.getSheetByName(teacherName);
  if (!sheet) {
    sheet = ss.insertSheet(teacherName);
    sheet.setRightToLeft(true);
    sheet.appendRow(["التاريخ", "اسم الطالب", "الفئة", "الصف", "المبلغ", "رابط الإيصال"]);
    formatHeaderRow(sheet, 6);
  }
  return sheet;
}

/**
 * رفع ملف الإيصال إلى Drive بشكل آمن بدون إيقاف بقية العمليات عند حدوث خطأ
 */
/**
 * مجلد الإيصالات المؤقتة لطلبات الدفع المعلقة
 */
var _cachedTempFolder = null;
function getOrCreateTempReceiptsFolder() {
  if (_cachedTempFolder) return _cachedTempFolder;
  try {
    var props = PropertiesService.getScriptProperties();
    var cachedId = props.getProperty("MAIN_RECEIPTS_FOLDER_ID");
    if (cachedId) {
      try {
        _cachedTempFolder = DriveApp.getFolderById(cachedId);
        return _cachedTempFolder;
      } catch(e) {}
    }

    var folder = DriveApp.getFolderById(FOLDER_ID);
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    props.setProperty("MAIN_RECEIPTS_FOLDER_ID", folder.getId());
    _cachedTempFolder = folder;
    return _cachedTempFolder;
  } catch(err) {
    return null;
  }
}

/**
 * رفع إيصال مؤقت داخل مجلد "إيصالات مؤقتة"
 */
function uploadTempReceiptSafely(base64Data, mimeType, fileName, studentName) {
  if (!base64Data) {
    return "لا يوجد إيصال";
  }
  try {
    var folder = getOrCreateTempReceiptsFolder();
    if (!folder) {
      return uploadReceiptSafely(base64Data, mimeType, fileName, studentName);
    }
    var decoded = Utilities.base64Decode(base64Data);
    var safeMime = mimeType || "image/jpeg";
    var safeName = fileName || ("temp_receipt_" + (studentName ? studentName.replace(/s+/g, '_') : "student") + "_" + new Date().getTime() + ".jpg");
    var blob = Utilities.newBlob(decoded, safeMime, safeName);
    var file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e){}
    return file.getUrl();
  } catch (err) {
    return "فشل رفع الإيصال: " + err.message;
  }
}

/**
 * حذف ملف الإيصال المؤقت من Drive
 */
function deleteReceiptFileSafely(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string' || fileUrl.indexOf('drive.google.com') === -1) return;
  try {
    var fileId = "";
    var m1 = fileUrl.match(/[-w]{25,}/);
    if (m1) fileId = m1[0];
    if (fileId) {
      var file = DriveApp.getFileById(fileId);
      file.setTrashed(true);
    }
  } catch(e) {}
}

function uploadReceiptSafely(base64Data, mimeType, fileName, studentName) {
  if (!base64Data) {
    return "لا يوجد إيصال";
  }
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var decoded = Utilities.base64Decode(base64Data);
    var safeMime = mimeType || "image/jpeg";
    var safeName = fileName || ("receipt_" + (studentName ? studentName.replace(/\s+/g, '_') : "student") + "_" + new Date().getTime() + ".jpg");
    var blob = Utilities.newBlob(decoded, safeMime, safeName);
    var file = folder.createFile(blob);
    return file.getUrl();
  } catch (err) {
    return "فشل رفع الإيصال: " + err.message;
  }
}

/**
 * دالة الترتيب المخصصة حسب الفئة والصف مع حماية الحدود
 */
function sortSheetData(sheet, catCol, gradeCol) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 2) return; // يلزم على الأقل صفين من البيانات بعد الهيدر لعمل ترتيب

  var lastCol = sheet.getLastColumn();
  if (lastCol < 1 || catCol > lastCol || gradeCol > lastCol) return;

  var range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  var values = range.getValues();

  values.sort(function(a, b) {
    var catA = (a[catCol - 1] || "").toString().trim();
    var catB = (b[catCol - 1] || "").toString().trim();

    var indexA = VALID_CATEGORIES.indexOf(catA);
    var indexB = VALID_CATEGORIES.indexOf(catB);

    if (indexA === -1) indexA = 999;
    if (indexB === -1) indexB = 999;

    if (indexA !== indexB) {
      return indexA - indexB;
    }

    var gradeA = (a[gradeCol - 1] || "").toString().trim();
    var gradeB = (b[gradeCol - 1] || "").toString().trim();

    var gradeOrderList = GRADE_ORDERS[catA] || [];
    var gradeIndexA = gradeOrderList.indexOf(gradeA);
    var gradeIndexB = gradeOrderList.indexOf(gradeB);

    if (gradeIndexA === -1) gradeIndexA = 999;
    if (gradeIndexB === -1) gradeIndexB = 999;

    return gradeIndexA - gradeIndexB;
  });

  range.setValues(values);
}

/**
 * تنسيق صف الترويسة (Header Row) وتجميده
 */
function formatHeaderRow(sheet, cols, bgColor) {
  bgColor = bgColor || "#1e3a8a";
  var headerRange = sheet.getRange(1, 1, 1, cols);
  headerRange.setBackground(bgColor);
  headerRange.setFontColor("#ffffff");
  headerRange.setFontWeight("bold");
  headerRange.setFontSize(11);
  headerRange.setHorizontalAlignment("center");
  headerRange.setVerticalAlignment("middle");
  headerRange.setWrap(true);
  sheet.setFrozenRows(1);
  sheet.setRowHeight(1, 35);
  for (var col = 1; col <= cols; col++) {
    sheet.setColumnWidth(col, 160);
  }
}

/**
 * إنشاء استجابة JSON موحدة مع الهيدر الصحيح
 */
function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * دالة توحيد وتطبيع الأسماء والنصوص العربية لمطابقة السجلات بدقة
 */
function normalizeArabic(text) {
  if (!text) return "";
  var s = text.toString().trim();
  s = s.replace(/[\u064B-\u065F\u0640]/g, '');
  s = s.replace(/\bعبد\s+([\u0621-\u064A])/g, 'عبد$1');
  s = s.replace(/\b(أبو|ابو|أبي|ابي|أبا|ابا)\s+([\u0621-\u064A])/g, '$1$2');
  s = s.replace(/[إأآٱ]/g, 'ا');
  s = s.replace(/ة\b/g, 'ه');
  s = s.replace(/[ىي]/g, 'ي');
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * مقارنة التواريخ بمرونة لتجنب اختلاف كائنات التاريخ والنصوص
 */
function compareDatesFlexible(sheetDate, targetDateStr) {
  if (!sheetDate || !targetDateStr) return true;
  try {
    var d1 = new Date(sheetDate);
    var d2 = new Date(targetDateStr);
    if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
      return (d1.getFullYear() === d2.getFullYear() &&
              d1.getMonth() === d2.getMonth() &&
              d1.getDate() === d2.getDate());
    }
  } catch(e) {}
  var sDate = sheetDate.toString().trim();
  var tDate = targetDateStr.toString().trim();
  return sDate.indexOf(tDate) !== -1 || tDate.indexOf(sDate) !== -1;
}