/**
 * ==============================================================================
 * كود Google Apps Script الكامل لنظام السنتر (شيت الطلاب وتوزيع المدرسين)
 * ==============================================================================
 * المميزات:
 * 1. تسجيل كل طالب في الشيت المجمع ("جميع الطلاب").
 * 2. إنشاء Tab (صفحة) خاصة تلقائياً باسم كل مدرس يضاف له طالب.
 * 3. تسجيل الطالب في صفحة المدرس الخاصة به تلقائياً.
 * 4. تعديل بيانات الطالب في الشيت المجمع وفي صفحة المدرس (مع نقل الطالب لو تغير المدرس).
 * 5. حذف الطالب من الشيت المجمع ومن صفحة المدرس المحددة فقط.
 * 6. جلب جميع الطلاب بصيغة JSON عبر doGet لمزامنة الموقع مباشرة.
 * ==============================================================================
 */

// اسم الصفحة المجمعة لكافة الطلاب
var MAIN_SHEET_NAME = "جميع الطلاب";

// ترويسة الأعمدة للشيت المجمع
var MAIN_HEADERS = ["اسم الطالب", "المعلم", "الفئة الدراسية", "الصف الدراسي", "تاريخ التسجيل"];

// ترويسة الأعمدة لصفحة المدرس الخاصة
var TEACHER_HEADERS = ["اسم الطالب", "الفئة الدراسية", "الصف الدراسي", "تاريخ التسجيل"];

/**
 * معالجة طلبات POST (إضافة، تعديل، حذف)
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  // انتظار القفل لمدة 15 ثانية لمنع تداخل العمليات
  try {
    lock.waitLock(15000);
  } catch (err) {
    return responseJSON({ status: "error", message: "الخادم مشغول حالياً، يرجى إعادة المحاولة." });
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var data = JSON.parse(e.postData.contents);
    var action = data.action || "addStudent";

    var studentName = (data.studentName || data.name || "").toString().trim();
    var teacherName = (data.teacherName || data.teacher || "").toString().trim();
    var category = (data.category || "").toString().trim();
    var grade = (data.grade || "").toString().trim();
    var date = (data.date || new Date().toLocaleString('ar-EG')).toString().trim();

    // التأكد من وجود الشيت المجمع
    var mainSheet = getOrCreateSheet(ss, MAIN_SHEET_NAME, MAIN_HEADERS, "#1e3a8a");

    // ==========================================
    // 1. إضافة طالب جديد
    // ==========================================
    if (action === "addStudent") {
      if (!studentName || !teacherName) {
        return responseJSON({ status: "error", message: "يجب تحديد اسم الطالب واسم المعلم." });
      }

      // أ) إضافة الطالب في الشيت المجمع
      mainSheet.appendRow([studentName, teacherName, category, grade, date]);

      // ب) فتح أو إنشاء Tab خاص بالمدرس وإضافة الطالب فيه
      var teacherSheetName = sanitizeSheetName(teacherName);
      var teacherSheet = getOrCreateSheet(ss, teacherSheetName, TEACHER_HEADERS, "#047857");
      teacherSheet.appendRow([studentName, category, grade, date]);

      return responseJSON({
        status: "success",
        message: "تم تسجيل الطالب مع المدرس بنجاح في الشيت المجمع وفي صفحة " + teacherSheetName
      });
    }

    // ==========================================
    // 2. تعديل بيانات طالب
    // ==========================================
    if (action === "updateStudent") {
      var oldStudentName = (data.oldStudentName || studentName).toString().trim();
      var oldTeacherName = (data.oldTeacherName || teacherName).toString().trim();

      // أ) تعديل في الشيت المجمع
      var mainValues = mainSheet.getDataRange().getValues();
      var updatedInMain = false;

      for (var i = 1; i < mainValues.length; i++) {
        var rowStudent = mainValues[i][0].toString().trim();
        var rowTeacher = mainValues[i][1].toString().trim();

        if (rowStudent === oldStudentName && rowTeacher === oldTeacherName) {
          mainSheet.getRange(i + 1, 1, 1, 5).setValues([[studentName, teacherName, category, grade, date]]);
          updatedInMain = true;
          break;
        }
      }

      // ب) تعديل في صفحة المدرس
      if (oldTeacherName === teacherName) {
        // نفس المدرس: تعديل البيانات داخل صفحته
        var tSheet = ss.getSheetByName(sanitizeSheetName(teacherName));
        if (tSheet) {
          var tValues = tSheet.getDataRange().getValues();
          for (var j = 1; j < tValues.length; j++) {
            if (tValues[j][0].toString().trim() === oldStudentName) {
              tSheet.getRange(j + 1, 1, 1, 4).setValues([[studentName, category, grade, date]]);
              break;
            }
          }
        }
      } else {
        // تغير المدرس: حذف من صفحة المدرس القديم وإضافة في صفحة المدرس الجديد
        var oldSheet = ss.getSheetByName(sanitizeSheetName(oldTeacherName));
        if (oldSheet) {
          var oldValues = oldSheet.getDataRange().getValues();
          for (var k = oldValues.length - 1; k >= 1; k--) {
            if (oldValues[k][0].toString().trim() === oldStudentName) {
              oldSheet.deleteRow(k + 1);
              break;
            }
          }
        }

        // إضافة في صفحة المدرس الجديد
        var newSheet = getOrCreateSheet(ss, sanitizeSheetName(teacherName), TEACHER_HEADERS, "#047857");
        newSheet.appendRow([studentName, category, grade, date]);
      }

      return responseJSON({
        status: "success",
        message: "تم تعديل بيانات الطالب بنجاح في الشيت المجمع وصفحة المدرس"
      });
    }

    // ==========================================
    // 3. حذف طالب من عند معلم محدد
    // ==========================================
    if (action === "deleteStudent") {
      // أ) حذف من الشيت المجمع
      var mainVals = mainSheet.getDataRange().getValues();
      var deletedFromMain = false;

      for (var m = mainVals.length - 1; m >= 1; m--) {
        var sName = mainVals[m][0].toString().trim();
        var tName = mainVals[m][1].toString().trim();

        if (sName === studentName && tName === teacherName) {
          mainSheet.deleteRow(m + 1);
          deletedFromMain = true;
          break;
        }
      }

      // ب) حذف من صفحة المدرس الخاصة
      var teacherSheetNameDel = sanitizeSheetName(teacherName);
      var tDelSheet = ss.getSheetByName(teacherSheetNameDel);
      if (tDelSheet) {
        var tVals = tDelSheet.getDataRange().getValues();
        for (var n = tVals.length - 1; n >= 1; n--) {
          if (tVals[n][0].toString().trim() === studentName) {
            tDelSheet.deleteRow(n + 1);
            break;
          }
        }
      }

      return responseJSON({
        status: "success",
        message: "تم حذف الطالب بنجاح من الشيت المجمع ومن صفحة " + teacherSheetNameDel
      });
    }

    return responseJSON({ status: "success", message: "تم تنفيذ الإجراء بنجاح" });

  } catch (error) {
    return responseJSON({ status: "error", message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * معالجة طلبات GET (جلب كافة بيانات الطلاب للشاشة)
 */
function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var mainSheet = ss.getSheetByName(MAIN_SHEET_NAME);

    if (!mainSheet) {
      return responseJSON([]);
    }

    var values = mainSheet.getDataRange().getValues();
    var students = [];

    // قراءة البيانات من بعد صف العناوين
    for (var i = 1; i < values.length; i++) {
      var sName = values[i][0] ? values[i][0].toString().trim() : "";
      var tName = values[i][1] ? values[i][1].toString().trim() : "";
      var cat = values[i][2] ? values[i][2].toString().trim() : "";
      var grd = values[i][3] ? values[i][3].toString().trim() : "";
      var dt = values[i][4] ? values[i][4].toString().trim() : "";

      if (sName) {
        students.push({
          id: i,
          studentName: sName,
          teacherName: tName,
          category: cat,
          grade: grd,
          date: dt
        });
      }
    }

    return responseJSON(students);

  } catch (err) {
    return responseJSON({ error: err.toString() });
  }
}

/**
 * دالة مساعدة لإنشاء أو فتح الورقة (Tab) مع تنسيق الترويسة من اليمين لليسار
 */
function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);

    // تفعيل اتجاه الورقة من اليمين لليسار (RTL)
    sheet.setRightToLeft(true);

    // إضافة الترويسة
    sheet.appendRow(headers);

    // تنسيق صف الترويسة الأول
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground(headerColor || "#1e3a8a");
    headerRange.setFontColor("#ffffff");
    headerRange.setFontWeight("bold");
    headerRange.setFontSize(11);
    headerRange.setHorizontalAlignment("center");
    headerRange.setVerticalAlignment("middle");

    // تجميد الصف الأول
    sheet.setFrozenRows(1);
    sheet.setRowHeight(1, 35);

    // توسيع الأعمدة لتناسب النصوص
    for (var col = 1; col <= headers.length; col++) {
      sheet.setColumnWidth(col, 160);
    }
  }

  return sheet;
}

/**
 * تنظيف اسم الورقة من الحروف الممنوعة في أسماء الـ Tabs بجوجل شيت
 */
function sanitizeSheetName(name) {
  if (!name) return "مدرس_غير_محدد";
  // منع الرموز: : \ / ? * [ ]
  var sanitized = name.replace(/[:\\/\?\*\[\]]/g, " ").trim();
  if (!sanitized) {
    sanitized = "مدرس_غير_محدد";
  }
  // الحد الأقصى لطول الاسم في جوجل شيت 100 حرف
  if (sanitized.length > 90) {
    sanitized = sanitized.substring(0, 90);
  }
  return sanitized;
}

/**
 * إرجاع استجابة JSON نظيفة
 */
function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

