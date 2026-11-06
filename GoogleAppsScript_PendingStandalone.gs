/**
 * ==============================================================================
 * كود نظام العمليات المعلقة المستقل مع مجلد تلقائي للإيصالات
 * يعمل تلقائياً وبشكل مستقل بنسبة 100% دون أي تعقيد في الصلاحيات
 * ==============================================================================
 */

// اسم الشيت المنفرد
var SHEET_NAME = "العمليات المعلقة";

// اسم المجلد التلقائي الذي سينشئه النظام على Google Drive
var FOLDER_NAME = "إيصالات دفع الطلاب - سنتر النجاح";

/**
 * دالة تفريغ الصلاحيات وتفعيل إذن Drive والـ Sheets تلقائياً
 * شغل هذه الدالة مرة واحدة فقط عند وضع الكود واضغط سماح (Allow)
 */
function setupAndAuthorize() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreatePendingSheet(ss);
  var folder = getOrCreateReceiptsFolder();
  Logger.log("تم تهيئة الشيت والمجلد بنجاح: " + folder.getUrl());
}

/**
 * معالجة طلبات الـ POST (إضافة وحذف طلبات الدفع المعلقة)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  var hasLock = false;

  try {
    hasLock = lock.tryLock(25000);
    if (!hasLock) {
      return createResponse({ status: "error", message: "الخادم مشغول حالياً، يرجى المحاولة مجدداً." });
    }

    if (!e || !e.postData || !e.postData.contents) {
      return createResponse({ status: "error", message: "لا توجد بيانات مرسلة في الطلب." });
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      return createResponse({ status: "error", message: "تنسيق البيانات المرسلة غير صالح." });
    }

    var action = data.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. إضافة طلب دفع معلق وحفظ إيصاله في المجلد التلقائي
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

      // رفع الإيصال في المجلد التلقائي للشيت
      var fileUrl = uploadReceiptToDrive(data.fileBase64, data.mimeType, data.fileName, studentName);
      var pendingSheet = getOrCreatePendingSheet(ss);
      var reqId = "REQ_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
      var itemsJson = JSON.stringify(items);

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
        message: "تم تسجيل طلب الدفع بنجاح وهو قيد المراجعة.",
        requestId: reqId,
        fileUrl: fileUrl
      });
    }

    // 2. إزالة الطلب من الشيت وحذف الإيصال من الدرايف عند التأكيد أو الحذف
    if (action === "removePendingTransaction" || action === "confirmPendingTransaction") {
      var requestId = (data.requestId || "").toString().trim();
      if (!requestId) {
        return createResponse({ status: "error", message: "معرف الطلب مطلوب." });
      }

      var pendingSheet = getOrCreatePendingSheet(ss);
      if (pendingSheet.getLastRow() <= 1) {
        return createResponse({ status: "error", message: "لا توجد طلبات معلقة." });
      }

      var pRange = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn());
      var pValues = pRange.getValues();
      var foundRow = -1;
      var fileUrl = "";

      for (var r = 0; r < pValues.length; r++) {
        if ((pValues[r][0] || "").toString().trim() === requestId) {
          foundRow = r + 2;
          fileUrl = (pValues[r][7] || "").toString().trim();
          break;
        }
      }

      if (foundRow === -1) {
        return createResponse({ status: "error", message: "لم يتم العثور على الطلب المطلوب." });
      }

      // مسح الإيصال من الدرايف لتوفير المساحة
      deleteReceiptSafely(fileUrl);

      // مسح الصف من الشيت
      pendingSheet.deleteRow(foundRow);

      return createResponse({
        status: "success",
        message: "تمت إزالة الطلب وحذف الإيصال بنجاح."
      });
    }

    // 3. رفض طلب دفع معلق
    if (action === "rejectPendingTransaction") {
      var requestId = (data.requestId || "").toString().trim();
      if (!requestId) {
        return createResponse({ status: "error", message: "معرف الطلب مطلوب." });
      }

      var pendingSheet = getOrCreatePendingSheet(ss);
      if (pendingSheet.getLastRow() <= 1) {
        return createResponse({ status: "error", message: "لا توجد طلبات معلقة." });
      }

      var pRange = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn());
      var pValues = pRange.getValues();
      var foundRow = -1;
      var fileUrl = "";

      for (var r = 0; r < pValues.length; r++) {
        if ((pValues[r][0] || "").toString().trim() === requestId) {
          foundRow = r + 2;
          fileUrl = (pValues[r][7] || "").toString().trim();
          break;
        }
      }

      if (foundRow === -1) {
        return createResponse({ status: "error", message: "لم يتم العثور على الطلب." });
      }

      deleteReceiptSafely(fileUrl);
      pendingSheet.deleteRow(foundRow);

      return createResponse({
        status: "success",
        message: "تم رفض ومسح الطلب بنجاح."
      });
    }

    return createResponse({ status: "error", message: "إجراء غير معروف: " + action });

  } catch (error) {
    return createResponse({ status: "error", message: error.toString() });
  } finally {
    if (hasLock) {
      try { lock.releaseLock(); } catch (e) {}
    }
  }
}

/**
 * معالجة طلبات الـ GET (جلب كافة الطلبات المعلقة لعرضها في الواجهة)
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var pendingSheet = ss.getSheetByName(SHEET_NAME);
    if (!pendingSheet || pendingSheet.getLastRow() <= 1) {
      return createResponse({ status: "success", pendingList: [] });
    }

    var pVals = pendingSheet.getRange(2, 1, pendingSheet.getLastRow() - 1, pendingSheet.getLastColumn()).getValues();
    var list = [];

    for (var p = 0; p < pVals.length; p++) {
      var row = pVals[p];
      if (!row[0]) continue;

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
        status: (row[8] || "معلق").toString().trim(),
        items: parsedItems
      });
    }

    return createResponse({ status: "success", pendingList: list });
  } catch (err) {
    return createResponse({ status: "error", message: err.toString() });
  }
}

/**
 * الحصول على شيت العمليات المعلقة أو إنشاؤه وتنسيقه التلقائي
 */
function getOrCreatePendingSheet(ss) {
  var sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.setRightToLeft(true);

    var headers = [
      "معرف الطلب",        // 1
      "التاريخ",           // 2
      "اسم الطالب",        // 3
      "المعلم/المعلمين",    // 4
      "الفئة",             // 5
      "الصف",             // 6
      "إجمالي المبلغ",     // 7
      "رابط الإيصال",      // 8
      "الحالة",           // 9
      "تفاصيل المعاملات"   // 10
    ];

    sheet.appendRow(headers);

    // تنسيق الترويسة
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground("#854d0e");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(11);
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");
    headerRange.setWrap(true);
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 35);

    var columnWidths = {
      1: 160, 2: 165, 3: 220, 4: 240, 5: 125, 6: 120, 7: 130, 8: 260, 9: 110, 10: 320
    };

    for (var colIndex in columnWidths) {
      sheet.setColumnWidth(parseInt(colIndex, 10), columnWidths[colIndex]);
    }

    try {
      var maxRows = sheet.getMaxRows();
      if (maxRows > 1) {
        var dataRange = sheet.getRange(2, 1, maxRows - 1, headers.length);
        dataRange.setVerticalAlignment("middle");
        sheet.getRange(2, 1, maxRows - 1, 2).setHorizontalAlignment("center");
        sheet.getRange(2, 5, maxRows - 1, 2).setHorizontalAlignment("center");
        sheet.getRange(2, 7, maxRows - 1, 1).setHorizontalAlignment("center").setNumberFormat("#,##0.00");
        sheet.getRange(2, 9, maxRows - 1, 1).setHorizontalAlignment("center");
        sheet.getRange(2, 4, maxRows - 1, 1).setWrap(true);
        sheet.getRange(2, 10, maxRows - 1, 1).setWrap(true);

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
 * إنشاء أو جلب المجلد التلقائي المخصص للإيصالات على Google Drive
 */
var _cachedPendingFolder = null;
function getOrCreateReceiptsFolder() {
  if (_cachedPendingFolder) return _cachedPendingFolder;
  try {
    var props = PropertiesService.getScriptProperties();
    var cachedFolderId = props.getProperty("PENDING_RECEIPTS_FOLDER_ID");
    if (cachedFolderId) {
      try {
        _cachedPendingFolder = DriveApp.getFolderById(cachedFolderId);
        return _cachedPendingFolder;
      } catch(e) {}
    }

    var folders = DriveApp.getFoldersByName(FOLDER_NAME);
    var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
    try {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    props.setProperty("PENDING_RECEIPTS_FOLDER_ID", folder.getId());
    _cachedPendingFolder = folder;
    return _cachedPendingFolder;
  } catch(err) {
    return null;
  }
}

/**
 * رفع الإيصال في المجلد التلقائي
 */
function uploadReceiptToDrive(base64Data, mimeType, fileName, studentName) {
  if (!base64Data) return "لا يوجد إيصال";
  try {
    var folder = getOrCreateReceiptsFolder();
    var decoded = Utilities.base64Decode(base64Data);
    var safeMime = mimeType || "image/jpeg";
    var safeName = fileName || ("receipt_" + (studentName ? studentName.replace(/\s+/g, '_') : "student") + "_" + new Date().getTime() + ".jpg");
    var blob = Utilities.newBlob(decoded, safeMime, safeName);
    var file = folder ? folder.createFile(blob) : DriveApp.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    return file.getUrl();
  } catch (err) {
    return "فشل رفع الإيصال: " + err.message;
  }
}

/**
 * حذف ملف الإيصال المؤقت من Drive
 */
function deleteReceiptSafely(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string' || fileUrl.indexOf('drive.google.com') === -1) return;
  try {
    var m1 = fileUrl.match(/[-\w]{25,}/);
    if (m1 && m1[0]) {
      var file = DriveApp.getFileById(m1[0]);
      file.setTrashed(true);
    }
  } catch(e) {}
}

function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
