/* Padel Card — Supabase Auth (Google + email OTP). Optional: if config
   placeholders are unset the login UI still renders, with an explanation,
   and the rest of the app keeps working from localStorage. */
(function () {
  var RESEND_SEC = 60;
  var pendingEmail = "";
  var resendUntil = 0;
  var cooldownTimer = 0;
  var client = null;
  var hooks = {
    onSession: function () {},
    onToast: function () {},
    go: function () {}
  };

  function $(id) { return document.getElementById(id); }

  function cfg() { return window.PadelConfig || {}; }

  function isConfigured() {
    var c = cfg();
    var url = String(c.SUPABASE_URL || "").trim();
    var key = String(c.SUPABASE_ANON_KEY || "").trim();
    if (!url || !key) return false;
    if (/^YOUR_/i.test(url) || /^YOUR_/i.test(key)) return false;
    if (url.indexOf("http") !== 0) return false;
    return true;
  }

  function getCreateClient() {
    if (typeof window.__supabaseCreateClient === "function") return window.__supabaseCreateClient;
    if (window.supabase && typeof window.supabase.createClient === "function") return window.supabase.createClient;
    return null;
  }

  function toast(msg) { hooks.onToast(msg); }

  function showError(id, msg) {
    var el = $(id);
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.classList.remove("hidden");
    } else {
      el.textContent = "";
      el.classList.add("hidden");
    }
  }

  function hebrewAuthError(err) {
    var raw = (err && (err.message || err.error_description || err.msg || err.code)) || "";
    var m = String(raw).toLowerCase();
    if (/rate|too many|429/.test(m)) return "נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.";
    if (/email/.test(m) && /invalid/.test(m)) return "כתובת האימייל אינה תקינה.";
    if (/invalid|expired|otp/.test(m)) return "הקוד שגוי או שפג תוקפו. בקשו קוד חדש.";
    if (/network|fetch|failed to/.test(m)) return "אין חיבור לשרת ההתחברות. בדקו את הרשת ונסו שוב.";
    return raw ? ("שגיאה: " + raw) : "משהו השתבש. נסו שוב.";
  }

  function userFromSession(session) {
    var user = session && session.user;
    if (!user) return null;
    return {
      id: user.id,
      email: user.email || (user.user_metadata && user.user_metadata.email) || "",
      provider: (user.app_metadata && user.app_metadata.provider) || "email"
    };
  }

  function emitSession(user, source) {
    hooks.onSession(user, { source: source || "update" });
  }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.prevLabel = btn.dataset.prevLabel || btn.textContent;
      btn.disabled = true;
      if (label) btn.textContent = label;
    } else {
      btn.disabled = false;
      if (btn.dataset.prevLabel) btn.textContent = btn.dataset.prevLabel;
      delete btn.dataset.prevLabel;
    }
  }

  function showStep(name) {
    var methods = $("auth-step-methods");
    var otp = $("auth-step-otp");
    if (methods) methods.classList.toggle("hidden", name !== "methods");
    if (otp) otp.classList.toggle("hidden", name !== "otp");
    if (name === "otp") {
      var focusOtp = function () {
        var input = otpInput();
        if (input) input.focus({ preventScroll: true });
        syncOtpSlots();
      };
      focusOtp();
      setTimeout(focusOtp, 50);
      setTimeout(focusOtp, 200);
    }
  }

  function renderPanel() {
    var configured = isConfigured() && !!client;
    var note = $("auth-unconfigured");
    if (note) note.classList.toggle("hidden", configured);
    ["auth-google", "auth-email", "auth-email-submit"].forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !configured;
    });
    var status = $("home-auth-status");
    var loginBtn = $("home-login-btn");
    var emailEl = $("home-auth-email");
    var ownerOut = $("owner-logout");
    var sessionUser = window.__padelAuthUser || null;
    var signedIn = !!(sessionUser && sessionUser.id);
    if (loginBtn) loginBtn.classList.toggle("hidden", signedIn);
    if (status) status.classList.toggle("hidden", !signedIn);
    if (emailEl) emailEl.textContent = signedIn ? (sessionUser.email || "") : "";
    if (ownerOut) ownerOut.classList.toggle("hidden", !signedIn);
  }

  function otpInput() {
    return $("auth-otp-input");
  }

  function otpDigits() {
    var el = otpInput();
    return String((el && el.value) || "").replace(/\D/g, "").slice(0, 6);
  }

  function syncOtpSlots() {
    var digits = otpDigits();
    var slots = document.querySelectorAll("#otp-slots .otp-digit");
    var el = otpInput();
    var focused = !!(el && document.activeElement === el);
    var caret = digits.length === 6 ? 5 : digits.length;
    for (var i = 0; i < slots.length; i++) {
      slots[i].textContent = digits.charAt(i) || "";
      slots[i].classList.toggle("is-filled", i < digits.length);
      slots[i].classList.toggle("is-on", focused && i === caret);
    }
  }

  var writingOtp = false;
  var otpValueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");

  function setOtpRaw(el, value) {
    if (otpValueDesc && otpValueDesc.set) otpValueDesc.set.call(el, value);
    else el.value = value;
  }

  function fillOtp(digits, autoSubmit) {
    var el = otpInput();
    var clean = String(digits || "").replace(/\D/g, "").slice(0, 6);
    writingOtp = true;
    if (el) {
      setOtpRaw(el, clean);
      syncOtpSlots();
      el.focus();
    }
    writingOtp = false;
    if (autoSubmit && clean.length === 6) submitOtp();
  }

  function clearOtp() {
    fillOtp("", false);
  }

  function startCooldown(seconds) {
    resendUntil = Date.now() + (seconds * 1000);
    tickCooldown();
  }

  function tickCooldown() {
    var btn = $("auth-otp-resend");
    if (!btn) return;
    clearTimeout(cooldownTimer);
    var left = Math.ceil((resendUntil - Date.now()) / 1000);
    if (left <= 0) {
      btn.disabled = false;
      btn.textContent = "שליחה מחדש";
      return;
    }
    btn.disabled = true;
    btn.textContent = "שליחה מחדש בעוד " + left + " שנ׳";
    cooldownTimer = setTimeout(tickCooldown, 250);
  }


  function requireLegalConsent(errorId) {
    if (window.PadelLegal && typeof PadelLegal.canStartAuth === "function" && !PadelLegal.canStartAuth()) {
      showError(errorId || "auth-error", "יש לאשר את תנאי השימוש ואת מדיניות הפרטיות כדי להמשיך.");
      var box = $("auth-legal-accept");
      if (box) {
        box.focus();
        var label = $("auth-legal-label");
        if (label && label.scrollIntoView) label.scrollIntoView({ block: "center" });
      }
      return false;
    }
    if (window.PadelLegal && typeof PadelLegal.rememberIntent === "function") PadelLegal.rememberIntent();
    return true;
  }

  function sendOtp(email) {
    if (!client) return Promise.resolve({ error: { message: "not configured" } });
    return client.auth.signInWithOtp({
      email: email,
      options: { shouldCreateUser: true }
    });
  }

  function beginOtp(email) {
    pendingEmail = email;
    try { sessionStorage.setItem("padelCard.pendingEmail", email); } catch (err) {}
    var label = $("auth-otp-email");
    if (label) label.textContent = email;
    clearOtp();
    showError("auth-otp-error", "");
    showStep("otp");
    startCooldown(RESEND_SEC);
  }

  function submitEmail(ev) {
    if (ev) ev.preventDefault();
    showError("auth-error", "");
    if (!requireLegalConsent("auth-error")) return;
    if (!isConfigured() || !client) {
      showError("auth-error", "ההתחברות עדיין לא הוגדרה.");
      return;
    }
    var input = $("auth-email");
    var email = ((input && input.value) || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("auth-error", "כתובת אימייל אינה תקינה.");
      if (input) input.focus();
      return;
    }
    var btn = $("auth-email-submit");
    setBusy(btn, true, "שולחים…");
    sendOtp(email).then(function (res) {
      setBusy(btn, false);
      if (res && res.error) {
        showError("auth-error", hebrewAuthError(res.error));
        return;
      }
      beginOtp(email);
      toast("הקוד נשלח לאימייל");
    }).catch(function (err) {
      setBusy(btn, false);
      showError("auth-error", hebrewAuthError(err));
    });
  }

  var otpBusy = false;
  function submitOtp(ev) {
    if (ev) ev.preventDefault();
    showError("auth-otp-error", "");
    if (otpBusy) return;
    var token = otpDigits();
    if (token.length !== 6) {
      showError("auth-otp-error", "יש להזין 6 ספרות.");
      return;
    }
    if (!client) {
      showError("auth-otp-error", "ההתחברות עדיין לא הוגדרה.");
      return;
    }
    var btn = $("auth-otp-submit");
    otpBusy = true;
    setBusy(btn, true, "מאמתים…");
    client.auth.verifyOtp({
      email: pendingEmail,
      token: token,
      type: "email"
    }).then(function (res) {
      otpBusy = false;
      setBusy(btn, false);
      if (res && res.error) {
        showError("auth-otp-error", hebrewAuthError(res.error));
        return;
      }
      var user = userFromSession(res && res.data && res.data.session) ||
        (res && res.data && res.data.user && { id: res.data.user.id, email: res.data.user.email || pendingEmail, provider: "email" });
      if (!user && res && res.data && res.data.user) {
        user = { id: res.data.user.id, email: res.data.user.email || pendingEmail, provider: "email" };
      }
      if (user) {
        window.__padelAuthUser = user;
        emitSession(user, "sign-in");
        toast("התחברתם בהצלחה");
        if (typeof hooks.afterSignIn === "function") hooks.afterSignIn(user);
        else hooks.go(hooks.hasCard && hooks.hasCard() ? "card" : "home");
      } else {
        showError("auth-otp-error", "האימות הצליח, אך לא התקבלה התחברות. נסו שוב.");
      }
    }).catch(function (err) {
      otpBusy = false;
      setBusy(btn, false);
      showError("auth-otp-error", hebrewAuthError(err));
    });
  }

  function resendOtp() {
    if (!pendingEmail) return;
    if (Date.now() < resendUntil) return;
    showError("auth-otp-error", "");
    var btn = $("auth-otp-resend");
    setBusy(btn, true, "שולחים…");
    sendOtp(pendingEmail).then(function (res) {
      setBusy(btn, false);
      if (res && res.error) {
        showError("auth-otp-error", hebrewAuthError(res.error));
        return;
      }
      startCooldown(RESEND_SEC);
      toast("נשלח קוד חדש");
    }).catch(function (err) {
      setBusy(btn, false);
      showError("auth-otp-error", hebrewAuthError(err));
    });
  }

  function pasteOtp() {
    if (!navigator.clipboard || typeof navigator.clipboard.readText !== "function") {
      toast("אין גישה ללוח. הדביקו ידנית לתיבה.");
      var input = otpInput();
      if (input) input.focus();
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      var digits = String(text || "").replace(/\D/g, "").slice(0, 6);
      if (!digits) {
        toast("לא נמצא קוד בלוח");
        return;
      }
      fillOtp(digits, true);
    }).catch(function () {
      toast("אין גישה ללוח. הדביקו ידנית לתיבה.");
    });
  }

  function signInGoogle() {
    showError("auth-error", "");
    if (!requireLegalConsent("auth-error")) return;
    if (!isConfigured() || !client) {
      showError("auth-error", "ההתחברות עדיין לא הוגדרה.");
      return;
    }
    var btn = $("auth-google");
    setBusy(btn, true, "מעבירים ל־Google…");
    client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin }
    }).then(function (res) {
      if (res && res.error) {
        setBusy(btn, false);
        showError("auth-error", hebrewAuthError(res.error));
      }
    }).catch(function (err) {
      setBusy(btn, false);
      showError("auth-error", hebrewAuthError(err));
    });
  }

  function signOut() {
    var done = function () {
      // A newer sign-in may have completed while this sign-out was finishing.
      if (window.__padelAuthUser) return;
      window.__padelAuthUser = null;
      emitSession(null, "sign-out");
      toast("התנתקתם");
      hooks.go("home");
    };
    if (client && client.auth && client.auth.signOut) {
      return client.auth.signOut().then(function () {
        if (window.__padelAuthUser) return;
        done();
      }).catch(function () {
        if (window.__padelAuthUser) return;
        done();
      });
    }
    done();
    return Promise.resolve();
  }

  function onOtpInput() {
    var el = otpInput();
    if (!el) return;
    var clean = otpDigits();
    if (otpValueDesc && otpValueDesc.get && otpValueDesc.get.call(el) !== clean) {
      writingOtp = true;
      setOtpRaw(el, clean);
      writingOtp = false;
    }
    syncOtpSlots();
    if (clean.length === 6) submitOtp();
  }

  function hookOtpValue() {
    var el = otpInput();
    if (!el || el.dataset.otpHooked || !otpValueDesc || !otpValueDesc.get || !otpValueDesc.set) return;
    el.dataset.otpHooked = "1";
    Object.defineProperty(el, "value", {
      configurable: true,
      enumerable: true,
      get: function () { return otpValueDesc.get.call(el); },
      set: function (v) {
        var clean = String(v == null ? "" : v).replace(/\D/g, "").slice(0, 6);
        otpValueDesc.set.call(el, clean);
        syncOtpSlots();
        if (!writingOtp && clean.length === 6) submitOtp();
      }
    });
  }

  function bindOtpBoxes() {
    var el = otpInput();
    if (!el) return;
    hookOtpValue();
    el.addEventListener("input", onOtpInput);
    el.addEventListener("change", onOtpInput);
    el.addEventListener("keyup", function (ev) {
      if (ev.key === "Backspace" || ev.key === "Delete") syncOtpSlots();
    });
    el.addEventListener("paste", function (ev) {
      var text = ((ev.clipboardData || window.clipboardData) && (ev.clipboardData || window.clipboardData).getData("text")) || "";
      var digits = text.replace(/\D/g, "").slice(0, 6);
      if (!digits) return;
      ev.preventDefault();
      fillOtp(digits, true);
    });
    el.addEventListener("focus", syncOtpSlots);
    el.addEventListener("blur", syncOtpSlots);
    var box = $("otp-boxes");
    if (box) box.addEventListener("click", function () { el.focus(); });
  }

  function bind() {
    var emailForm = $("auth-email-form");
    if (emailForm) emailForm.addEventListener("submit", submitEmail);
    var otpForm = $("auth-otp-form");
    if (otpForm) otpForm.addEventListener("submit", submitOtp);
    if ($("auth-google")) $("auth-google").addEventListener("click", signInGoogle);
    if ($("auth-back-home")) $("auth-back-home").addEventListener("click", function () { hooks.go("home"); });
    if ($("auth-otp-back")) $("auth-otp-back").addEventListener("click", function () { showStep("methods"); });
    if ($("auth-otp-resend")) $("auth-otp-resend").addEventListener("click", resendOtp);
    if ($("auth-otp-paste")) $("auth-otp-paste").addEventListener("click", pasteOtp);
    if ($("home-login-btn")) $("home-login-btn").addEventListener("click", function () { hooks.go("login"); });
    if ($("home-logout-btn")) $("home-logout-btn").addEventListener("click", signOut);
    if ($("owner-logout")) $("owner-logout").addEventListener("click", signOut);
    bindOtpBoxes();
  }

  function createClientIfPossible() {
    if (!isConfigured()) return null;
    var create = getCreateClient();
    if (!create) return null;
    try {
      var c = cfg();
      return create(c.SUPABASE_URL, c.SUPABASE_ANON_KEY, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
          flowType: "pkce"
        }
      });
    } catch (err) {
      console.warn("Supabase client failed", err);
      return null;
    }
  }

  function cleanAuthUrl() {
    var hash = location.hash || "";
    var search = location.search || "";
    var dirtyHash = /access_token=|refresh_token=|error_description=|error=/.test(hash);
    var dirtySearch = /[?&]code=|[?&]error=/.test(search);
    if (!dirtyHash && !dirtySearch) return;
    var url = location.origin + location.pathname + "#/";
    try { history.replaceState(null, "", url); } catch (err) { location.hash = "#/"; }
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    client = createClientIfPossible();
    bind();
    renderPanel();

    if (!client) {
      emitSession(null, "boot");
      return;
    }

    client.auth.getSession().then(function (res) {
      var user = userFromSession(res && res.data && res.data.session);
      window.__padelAuthUser = user;
      emitSession(user, "boot");
      cleanAuthUrl();
      renderPanel();
    }).catch(function () {
      cleanAuthUrl();
      window.__padelAuthUser = null;
      emitSession(null, "boot");
    });

    if (client.auth.onAuthStateChange) {
      client.auth.onAuthStateChange(function (event, session) {
        var user = userFromSession(session);
        if (event === "INITIAL_SESSION") {
          window.__padelAuthUser = user;
          renderPanel();
          return;
        }
        if (event === "SIGNED_IN") {
          window.__padelAuthUser = user;
          emitSession(user, "sign-in");
          cleanAuthUrl();
          renderPanel();
          return;
        }
        if (event === "SIGNED_OUT") {
          client.auth.getSession().then(function (res) {
            var live = userFromSession(res && res.data && res.data.session);
            if (live) {
              window.__padelAuthUser = live;
              return;
            }
            window.__padelAuthUser = null;
            emitSession(null, "sign-out");
            renderPanel();
          }).catch(function () {
            if (window.__padelAuthUser) return;
            window.__padelAuthUser = null;
            emitSession(null, "sign-out");
            renderPanel();
          });
          return;
        }
        if (user) {
          window.__padelAuthUser = user;
          emitSession(user, "update");
        }
        renderPanel();
      });
    }
  }

  window.PadelAuth = {
    init: init,
    isConfigured: isConfigured,
    render: renderPanel,
    signOut: signOut,
    showStep: showStep,
    fillOtp: fillOtp,
    getClient: function () { return client; },
    /* test helpers */
    _otpDigits: otpDigits,
    _beginOtp: beginOtp
  };
})();
