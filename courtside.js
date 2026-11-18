/* global qrcode, jsQR */
(function () {
  var hooks = {
    showToast: function () {},
    go: function () {},
    isRater: function () { return false; },
    isLoggedIn: function () { return false; },
    cardId: function (card) { return (card && card.profile && card.profile.id) || (card && card.id) || ""; },
    getClient: function () { return window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient(); },
    weightedLabel: function () { return ""; },
    initials: function (name) { return (name || "ש").trim().slice(0, 1); },
    openRateSheet: function () {}
  };

  var wakeLock = null;
  var scanStream = null;
  var scanTimer = null;
  var scanBusy = false;
  var lastCourtside = null;

  function $(id) { return document.getElementById(id); }

  function hebrewError(err) {
    var msg = (err && (err.message || err.error_description || err.details)) || "";
    var low = String(msg).toLowerCase();
    if (/certified rating cooldown until/.test(low)) {
      var iso = (String(msg).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
      var pretty = iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
      return pretty
        ? ("השחקן כבר קיבל דירוג מוסמך. אפשר לדרג שוב ב־" + pretty + ".")
        : "השחקן כבר קיבל דירוג מוסמך ב־3 החודשים האחרונים.";
    }
    if (/card not found/.test(low)) return "כרטיס השחקן לא נמצא.";
    if (/card unavailable/.test(low)) return "הכרטיס אינו זמין.";
    if (/cannot rate own card/.test(low)) return "אי אפשר לדרג את הכרטיס של עצמכם.";
    if (/not a certified rater/.test(low)) return "רק מוסמך פעיל יכול לסרוק ולדרג.";
    if (/invalid card/.test(low)) return "לא זיהינו כרטיס שחקן בקישור או במזהה.";
    if (/not authorized/.test(low)) return "אין הרשאה לפעולה הזו.";
    if (window.PadelCertified && PadelCertified.hebrewError) return PadelCertified.hebrewError(err);
    return msg || "הפעולה נכשלה. נסו שוב.";
  }

  function publicCardUrl(id) {
    if (!id) return "";
    var path = (location.pathname || "/").replace(/index\.html$/, "");
    return location.origin + path + "#/card/" + encodeURIComponent(id);
  }

  function parseCardRef(raw) {
    var text = String(raw || "").trim();
    if (!text) return "";
    var hash = "";
    try {
      if (/^https?:\/\//i.test(text)) {
        var u = new URL(text);
        hash = u.hash || "";
        if (!hash && /\/card\/(.+)$/.test(u.pathname)) return decodeURIComponent(RegExp.$1);
      } else if (text.charAt(0) === "#") {
        hash = text;
      }
    } catch (err) {}
    var m = hash.match(/#\/card\/([^/?#]+)/i);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    m = hash.match(/#\/p\/([^/?#]+)/i);
    if (m) {
      try {
        var json = window.atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
        var data = JSON.parse(json);
        return (data && data.profile && data.profile.id) || data.id || "";
      } catch (err) {
        return "";
      }
    }
    if (/^[A-Za-z0-9._:-]{3,120}$/.test(text)) return text;
    return "";
  }

  function rpc(name, args) {
    var c = hooks.getClient();
    if (!c) return Promise.reject(new Error("not authorized"));
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function releaseWakeLock() {
    if (wakeLock && wakeLock.release) {
      try { wakeLock.release(); } catch (err) {}
    }
    wakeLock = null;
  }

  function requestWakeLock() {
    releaseWakeLock();
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      if (lock && lock.addEventListener) {
        lock.addEventListener("release", function () { if (wakeLock === lock) wakeLock = null; });
      }
    }).catch(function () {});
  }

  function renderQr(el, url) {
    el.innerHTML = "";
    if (!url || typeof qrcode !== "function") {
      el.textContent = url || "";
      return;
    }
    var qr = qrcode(0, "M");
    qr.addData(url, "Byte");
    qr.make();
    el.innerHTML = qr.createSvgTag(8, 4);
    var svg = el.querySelector("svg");
    if (svg) {
      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.style.background = "#fff";
      var rect = svg.querySelector("rect");
      if (rect) rect.setAttribute("fill", "#ffffff");
    }
  }

  function openShow(card) {
    var overlay = $("show-card-overlay");
    if (!overlay || !card) return;
    var id = hooks.cardId(card);
    var url = publicCardUrl(id);
    var name = (card.profile && card.profile.name) || "שחקן";
    var photo = (card.profile && card.profile.photo) || "";
    var level = hooks.weightedLabel(card) || card.levelId || "";
    renderQr($("show-card-qr"), url);
    $("show-card-name").textContent = name;
    var lvl = $("show-card-level");
    if (lvl) {
      lvl.textContent = level ? ("רמה " + level) : "";
      lvl.classList.toggle("hidden", !level);
    }
    var img = $("show-card-photo");
    var fallback = $("show-card-photo-fallback");
    if (photo && img) {
      img.src = photo;
      img.alt = name;
      img.classList.remove("hidden");
      if (fallback) fallback.classList.add("hidden");
    } else {
      if (img) { img.removeAttribute("src"); img.classList.add("hidden"); }
      if (fallback) {
        fallback.textContent = hooks.initials(name);
        fallback.classList.remove("hidden");
      }
    }
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    requestWakeLock();
  }

  function closeShow() {
    var overlay = $("show-card-overlay");
    if (overlay) overlay.classList.add("hidden");
    document.body.style.overflow = "";
    releaseWakeLock();
  }

  function stopScan() {
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    scanBusy = false;
    if (scanStream) {
      scanStream.getTracks().forEach(function (t) { try { t.stop(); } catch (err) {} });
      scanStream = null;
    }
    var video = $("scan-video");
    if (video) video.srcObject = null;
  }

  function onScanText(text) {
    var id = parseCardRef(text);
    if (!id) {
      hooks.showToast("לא זיהינו כרטיס שחקן בקוד. נסו שוב או הדביקו קישור.");
      return;
    }
    stopScan();
    hooks.go("card/" + encodeURIComponent(id));
  }

  function tickDetect() {
    if (!scanStream) return;
    var video = $("scan-video");
    var canvas = $("scan-canvas");
    if (!video || video.readyState < 2) {
      scanTimer = setTimeout(tickDetect, 180);
      return;
    }
    function again() { if (scanStream) scanTimer = setTimeout(tickDetect, 160); }

    if (window.BarcodeDetector) {
      var det = tickDetect._bd;
      if (!det) {
        try { tickDetect._bd = new BarcodeDetector({ formats: ["qr_code"] }); det = tickDetect._bd; }
        catch (err) { det = null; }
      }
      if (det) {
        det.detect(video).then(function (codes) {
          var raw = codes && codes[0] && (codes[0].rawValue || codes[0].raw);
          if (raw) onScanText(raw);
          else again();
        }).catch(function () { again(); });
        return;
      }
    }

    if (typeof jsQR !== "function" || !canvas) { again(); return; }
    var w = video.videoWidth || 640;
    var h = video.videoHeight || 480;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    try {
      var img = ctx.getImageData(0, 0, w, h);
      var code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
      if (code && code.data) onScanText(code.data);
      else again();
    } catch (err) {
      again();
    }
  }

  function startCamera() {
    var note = $("scan-camera-note");
    var video = $("scan-video");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (note) note.textContent = "המצלמה אינה זמינה בדפדפן הזה. אפשר להדביק קישור למטה.";
      return;
    }
    if (note) note.textContent = "מבקשים גישה למצלמה…";
    stopScan();
    var constraints = { video: { facingMode: { ideal: "environment" } }, audio: false };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      scanStream = stream;
      if (video) {
        video.setAttribute("playsinline", "true");
        video.setAttribute("webkit-playsinline", "true");
        video.muted = true;
        video.srcObject = stream;
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
      }
      if (note) note.textContent = "כוונו את המצלמה לקוד.";
      tickDetect();
    }).catch(function () {
      if (note) note.textContent = "לא הצלחנו לפתוח את המצלמה. בדקו את ההרשאה, או הדביקו קישור למטה.";
    });
  }

  function openScan() {
    if (!hooks.isRater()) {
      hooks.showToast("רק מוסמך דירוג יכול לסרוק כרטיס שחקן.");
      hooks.go("home");
      return;
    }
    var input = $("scan-manual");
    if (input) input.value = "";
    startCamera();
  }

  function submitManual() {
    var input = $("scan-manual");
    var id = parseCardRef(input && input.value);
    if (!id) {
      hooks.showToast("הדביקו קישור לכרטיס, או הקלידו את מזהה הכרטיס.");
      return;
    }
    stopScan();
    hooks.go("card/" + encodeURIComponent(id));
  }

  function paintBar(info) {
    lastCourtside = info || null;
    var bar = $("courtside-bar");
    var btn = $("courtside-rate-btn");
    var note = $("courtside-note");
    if (!bar) return;
    if (!info || !hooks.isRater()) {
      bar.classList.add("hidden");
      return;
    }
    bar.classList.remove("hidden");
    if (btn) btn.classList.toggle("hidden", !info.can_rate);
    if (note) {
      if (info.is_self) {
        note.textContent = "זה הכרטיס שלכם — אי אפשר לדרג אותו.";
        note.classList.remove("hidden");
      } else if (info.cooldown && info.cooldown.active) {
        var bits = [];
        if (info.cooldown.last_level) bits.push("דירוג מוסמך קיים: " + info.cooldown.last_level);
        if (info.cooldown.last_rater_name) bits.push("על ידי " + info.cooldown.last_rater_name);
        if (info.cooldown.next_allowed_date) bits.push("אפשר לדרג שוב ב־" + info.cooldown.next_allowed_date);
        note.textContent = bits.join(". ") + ".";
        note.classList.remove("hidden");
      } else {
        note.textContent = "";
        note.classList.add("hidden");
      }
    }
  }

  function bind() {
    if ($("show-card-close")) $("show-card-close").addEventListener("click", closeShow);
    if ($("show-card-overlay")) {
      $("show-card-overlay").addEventListener("click", function (ev) {
        if (ev.target === $("show-card-overlay")) closeShow();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeShow();
    });
    if ($("scan-manual-go")) $("scan-manual-go").addEventListener("click", submitManual);
    if ($("scan-manual")) {
      $("scan-manual").addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); submitManual(); }
      });
    }
    if ($("courtside-rate-btn")) {
      $("courtside-rate-btn").addEventListener("click", function () {
        var card = lastCourtside && lastCourtside.card;
        if (!card || !lastCourtside.can_rate) return;
        hooks.openRateSheet(card, { rpc: "rate_card_courtside" });
      });
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (scanStream) stopScan();
        releaseWakeLock();
      } else {
        var overlay = $("show-card-overlay");
        if (overlay && !overlay.classList.contains("hidden")) requestWakeLock();
        if ($("view-scan") && !$("view-scan").classList.contains("hidden") && hooks.isRater()) startCamera();
      }
    });
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelCourtside = {
    init: init,
    publicCardUrl: publicCardUrl,
    parseCardRef: parseCardRef,
    openShow: openShow,
    closeShow: closeShow,
    openScan: openScan,
    stopScan: stopScan,
    paintBar: paintBar,
    hebrewError: hebrewError,
    last: function () { return lastCourtside; }
  };
})();
