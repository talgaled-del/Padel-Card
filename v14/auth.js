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
      setTimeout(function () {
        var first = document.querySelector(".otp-digit");
        if (first) first.focus();
      }, 50);
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

  function otpDigits() {
    return Array.prototype.map.call(document.querySelectorAll(".otp-digit"), function (el) {
      return (el.value || "").replace(/\D/g, "").slice(0, 1);
    }).join("");
  }

  function fillOtp(digits, autoSubmit) {
    var boxes = document.querySelectorAll(".otp-digit");
    var clean = String(digits || "").replace(/\D/g, "").slice(0, 6);
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].value = clean.charAt(i) || "";
    }
    if (clean.length < 6 && boxes[clean.length]) boxes[clean.length].focus();
    else if (boxes[5]) boxes[5].focus();
    if (autoSubmit && clean.length === 6) submitOtp();
  }

  function clearOtp() {
    document.querySelectorAll(".otp-digit").forEach(function (el) { el.value = ""; });
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
    if (!isConfigured() || !client) {
      showError("auth-error", "ההתחברות עדיין לא הוגדרה. אפשר להמשיך בלי להתחבר.");
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

  function submitOtp(ev) {
    if (ev) ev.preventDefault();
    showError("auth-otp-error", "");
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
    setBusy(btn, true, "מאמתים…");
    client.auth.verifyOtp({
      email: pendingEmail,
      token: token,
      type: "email"
    }).then(function (res) {
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
        hooks.go(hooks.hasCard && hooks.hasCard() ? "card" : "home");
      } else {
        showError("auth-otp-error", "האימות הצליח, אך לא התקבלה התחברות. נסו שוב.");
      }
    }).catch(function (err) {
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
      var first = document.querySelector(".otp-digit");
      if (first) first.focus();
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
    if (!isConfigured() || !client) {
      showError("auth-error", "ההתחברות עדיין לא הוגדרה. אפשר להמשיך בלי להתחבר.");
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
      window.__padelAuthUser = null;
      emitSession(null, "sign-out");
      toast("התנתקתם");
      hooks.go("home");
    };
    if (client && client.auth && client.auth.signOut) {
      client.auth.signOut().then(done).catch(done);
    } else {
      done();
    }
  }

  function bindOtpBoxes() {
    var boxes = document.querySelectorAll(".otp-digit");
    boxes.forEach(function (box, i) {
      box.addEventListener("input", function () {
        var raw = (box.value || "").replace(/\D/g, "");
        if (raw.length > 1) {
          fillOtp(otpDigits().slice(0, i) + raw, true);
          return;
        }
        box.value = raw.slice(0, 1);
        if (raw && boxes[i + 1]) boxes[i + 1].focus();
        if (otpDigits().length === 6) submitOtp();
      });
      box.addEventListener("keydown", function (ev) {
        if (ev.key === "Backspace" && !box.value && i > 0) {
          ev.preventDefault();
          boxes[i - 1].value = "";
          boxes[i - 1].focus();
        }
        if (ev.key === "ArrowLeft" && i > 0) { ev.preventDefault(); boxes[i - 1].focus(); }
        if (ev.key === "ArrowRight" && boxes[i + 1]) { ev.preventDefault(); boxes[i + 1].focus(); }
      });
      box.addEventListener("paste", function (ev) {
        var text = (ev.clipboardData || window.clipboardData).getData("text") || "";
        var digits = text.replace(/\D/g, "").slice(0, 6);
        if (!digits) return;
        ev.preventDefault();
        fillOtp(digits, true);
      });
      box.addEventListener("focus", function () { box.select(); });
    });
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

    if (!client) return;

    client.auth.getSession().then(function (res) {
      var user = userFromSession(res && res.data && res.data.session);
      if (user) {
        window.__padelAuthUser = user;
        emitSession(user, "boot");
      }
      cleanAuthUrl();
      renderPanel();
    }).catch(function () { cleanAuthUrl(); });

    if (client.auth.onAuthStateChange) {
      client.auth.onAuthStateChange(function (event, session) {
        var user = userFromSession(session);
        window.__padelAuthUser = user;
        if (event === "SIGNED_IN") {
          emitSession(user, "sign-in");
          cleanAuthUrl();
        } else if (event === "SIGNED_OUT") {
          emitSession(null, "sign-out");
        } else if (user) {
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
    /* test helpers */
    _otpDigits: otpDigits,
    _beginOtp: beginOtp
  };
})();
