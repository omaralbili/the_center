/* ===================================================
   حماية الواجهة الأمامية
   يمنع المستخدم العادي من فتح أدوات المطور
   ✅ كشف DevTools يعمل على اللابتوب/الكمبيوتر فقط
   ✅ الموبايل والتابلت لا يتأثران بالـ Zoom
   =================================================== */

(function () {
    'use strict';

    // ── كشف نوع الجهاز ───────────────────────────────
    // الموبايل والتابلت بيكون فيهم touch events
    var _isMobile = (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(navigator.userAgent)
    );

    // ── 1. منع كليك يمين (لابتوب فقط) ───────────────
    if (!_isMobile) {
        document.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            return false;
        });
    }

    // ── 2. منع اختصارات لوحة المفاتيح (لابتوب فقط) ──
    // الموبايل أصلاً ما فيهوش F12 أو Ctrl، لكن تأكيداً نشيله
    if (!_isMobile) {
        document.addEventListener('keydown', function (e) {
            // F12
            if (e.key === 'F12' || e.keyCode === 123) {
                e.preventDefault();
                return false;
            }
            // Ctrl+Shift+I  (DevTools)
            if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i')) {
                e.preventDefault();
                return false;
            }
            // Ctrl+Shift+J  (Console)
            if (e.ctrlKey && e.shiftKey && (e.key === 'J' || e.key === 'j')) {
                e.preventDefault();
                return false;
            }
            // Ctrl+Shift+C  (Inspect Element)
            if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
                e.preventDefault();
                return false;
            }
            // Ctrl+U  (View Source)
            if (e.ctrlKey && (e.key === 'U' || e.key === 'u')) {
                e.preventDefault();
                return false;
            }
            // Ctrl+S  (Save Page)
            if (e.ctrlKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                return false;
            }
        });
    }

    // ── 3. كشف DevTools عبر حجم الشاشة (لابتوب فقط) ─
    // ⚠️ على الموبايل الـ Zoom بيغير outerWidth/innerWidth
    //    فنوقف الكشف ده تماماً على الموبايل لتجنب الـ false positive
    if (!_isMobile) {
        var _devToolsOpen = false;
        var _threshold = 160; // px — DevTools عادةً بيفتح بعرض/ارتفاع أكبر من 160px

        function _checkDevTools() {
            var widthDiff  = window.outerWidth  - window.innerWidth;
            var heightDiff = window.outerHeight - window.innerHeight;

            if (widthDiff > _threshold || heightDiff > _threshold) {
                if (!_devToolsOpen) {
                    _devToolsOpen = true;
                    _onDevToolsOpened();
                }
            } else {
                _devToolsOpen = false;
                // إزالة التحذير لو أغلق المستخدم الـ DevTools
                var existing = document.getElementById('__devtools_warning__');
                if (existing) existing.remove();
            }
        }

        function _onDevToolsOpened() {
            console.clear();
            console.log('%c⛔ منطقة محظورة', 'color:red;font-size:30px;font-weight:bold;');
            console.log('%c هذا النظام خاص بسنتر النجاح — أي محاولة اختراق ستُسجَّل.', 'color:#1e3a8a;font-size:14px;');

            if (!document.getElementById('__devtools_warning__')) {
                var overlay = document.createElement('div');
                overlay.id = '__devtools_warning__';
                overlay.style.cssText = [
                    'position:fixed', 'inset:0', 'z-index:999999',
                    'background:rgba(15,23,42,0.97)',
                    'display:flex', 'flex-direction:column',
                    'align-items:center', 'justify-content:center',
                    'font-family:Cairo,sans-serif', 'direction:rtl', 'text-align:center',
                    'padding:20px'
                ].join(';');

                overlay.innerHTML = `
                    <div style="color:#ef4444;font-size:64px;margin-bottom:16px;">⛔</div>
                    <h2 style="color:#fff;font-size:22px;margin:0 0 12px;">تم رصد محاولة فتح أدوات المطور</h2>
                    <p style="color:#94a3b8;font-size:15px;max-width:360px;line-height:1.7;">
                        هذا النظام محمي. أغلق أدوات المطور للمتابعة.
                    </p>
                    <button onclick="location.reload()"
                        style="margin-top:24px;padding:12px 32px;background:#1e3a8a;color:#fff;
                               border:none;border-radius:10px;font-size:16px;
                               font-family:Cairo,sans-serif;cursor:pointer;">
                        🔄 إعادة التحميل
                    </button>
                `;
                document.body.appendChild(overlay);
            }
        }

        // فحص كل ثانية
        setInterval(_checkDevTools, 1000);

        // ── 4. مسح الـ console دورياً (لابتوب فقط) ───
        setInterval(function () {
            if (typeof console !== 'undefined') {
                console.clear();
            }
        }, 3000);
    }

})();
