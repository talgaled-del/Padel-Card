/* Player rating-request flow and rater inbox. */
(function () {
  var hooks = {
    getClient: function () { return window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient(); },
    showToast: function () {},
    cardId: function () { return ""; },
    hasCard: function () { return false; },
    isRater: function () { return false; },
    onOpenRate: function () {},
    go: function () {},
    onChanged: function () {}
  };
  var cache = { mine: null, inbox: null, raters: null, unseen: [] };
  var picked = {};

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rpc(name, args) {
    var c = hooks.getClient();
    if (!c) return Promise.reject(new Error("not configured"));
    var run = function () {
      return c.rpc(name, args || {}).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    };
    if (!c.auth || !c.auth.getSession) return run();
    return c.auth.getSession().then(function (s) {
      if (!(s && s.data && s.data.session)) throw new Error("not authorized");
      return run();
    });
  }

  function asList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return [];
  }

  function hebrewError(err) {
    var msg = (err && (err.message || err.error_description || err.details)) || "";
    var low = String(msg).toLowerCase();
    if (/cannot assign admin email/.test(low)) return "אי אפשר לשייך למוסמך את האימייל של חשבון מנהל.";
    if (/cannot request own rating/.test(low)) return "אי אפשר לבקש דירוג מעצמכם.";
    if (/too many pending/.test(low)) return "אפשר להמתין על עד שלוש בקשות פתוחות במקביל.";
    if (/rating request cooldown until/.test(low)) {
      var iso = (String(msg).match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
      return cooldownCopy(formatDay(iso));
    }
    if (/request already pending/.test(low)) return "כבר יש בקשה ממתינה למוסמך הזה.";
    if (/rater has no email/.test(low)) return "למוסמך הזה עדיין אין אימייל משויך. סמנו «בקרוב».";
    if (/request not pending/.test(low)) return "הבקשה כבר אינה ממתינה.";
    if (/request not found/.test(low)) return "הבקשה לא נמצאה.";
    if (/not your card/.test(low)) return "אפשר לבקש דירוג רק לכרטיס שלכם.";
    if (/not authorized/.test(low)) return "אין הרשאה לפעולה הזו.";
    if (/permission denied/.test(low)) return "אין הרשאה לפעולה הזו. ודאו שאתם מחוברים לחשבון הנכון.";
    if (window.PadelCertified && PadelCertified.hebrewError) return PadelCertified.hebrewError(err);
    return msg || "הפעולה נכשלה. נסו שוב.";
  }

  function formatDay(iso) {
    if (!iso) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      var p = iso.split("-");
      return p[2] + "/" + p[1] + "/" + p[0];
    }
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).formatToParts(d);
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return "";
    };
    return get("day") + "/" + get("month") + "/" + get("year");
  }

  function cooldownCopy(day) {
    return "אפשר לבקש דירוג מוסמך אחת לשלושה חודשים — זמן להתאמן ולהשתפר." +
      (day ? " אפשר לבקש שוב ב־" + day + "." : "");
  }

  function paintCooldown(info) {
    cache.cooldown = info || cache.cooldown || { active: false };
    var rater = !!(hooks.isRater && hooks.isRater());
    var locked = !rater && !!(cache.cooldown && cache.cooldown.active);
    var day = cache.cooldown && (cache.cooldown.next_allowed_date || formatDay(cache.cooldown.next_allowed_at));
    var text = locked ? cooldownCopy(day) : "";
    ["req-ask-home-btn", "req-ask-btn"].forEach(function (id) {
      var btn = $(id);
      if (btn) {
        btn.disabled = locked || rater;
        btn.setAttribute("aria-disabled", (locked || rater) ? "true" : "false");
      }
    });
    ["req-cooldown-home", "req-cooldown-card"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.textContent = text;
      el.classList.toggle("hidden", !locked);
    });
  }

  function loadCooldown() {
    return rpc("get_rating_request_cooldown").then(function (data) {
      paintCooldown(data || { active: false });
      return cache.cooldown;
    }).catch(function () {
      paintCooldown({ active: false });
      return cache.cooldown;
    });
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function statusLabel(s) {
    if (s === "pending") return "ממתין";
    if (s === "done") return "דורג";
    if (s === "declined") return "נדחה";
    if (s === "cancelled") return "בוטל";
    return s || "";
  }

  function parseNotifyResult(res, err) {
    if (err) return { ok: false, skipped: false, error: err };
    var data = res && res.data;
    if (res && res.error && !data) return { ok: false, skipped: false, error: res.error };
    if (data && data.error && !data.ok) {
      return { ok: false, skipped: !!data.skipped, error: data.error };
    }
    if (data && (data.ok || data.skipped)) {
      return { ok: !!data.ok && !data.error, skipped: !!data.skipped, id: data.id };
    }
    if (data && data.id) return { ok: true, skipped: false, id: data.id };
    return { ok: false, skipped: false };
  }

  function notify(requestId, kind, extra) {
    var c = hooks.getClient();
    if (!c) return Promise.resolve({ ok: false });
    var body = Object.assign({ kind: kind || "new" }, extra || {});
    if (requestId) body.request_id = requestId;
    return c.functions.invoke("notify-rating-request", { body: body }).then(function (res) {
      var out = parseNotifyResult(res);
      if (!out.ok && !out.skipped) console.warn("notify-rating-request", res && (res.error || res.data));
      return out;
    }).catch(function (err) {
      console.warn("notify-rating-request", err);
      return parseNotifyResult(null, err);
    });
  }

  function notifyPlayerRated(cardId, saved) {
    if (saved && saved.request_id) return notify(saved.request_id, "done");
    if (cardId) return notify(null, "rated", { card_id: cardId });
    return Promise.resolve({ ok: false });
  }

  function loadMine() {
    return rpc("list_my_rating_requests").then(function (data) {
      cache.mine = asList(data);
      return cache.mine;
    });
  }

  function loadInbox() {
    if (!hooks.isRater()) {
      cache.inbox = [];
      return Promise.resolve([]);
    }
    return rpc("list_rater_requests").then(function (data) {
      cache.inbox = asList(data);
      return cache.inbox;
    }).catch(function () {
      cache.inbox = [];
      return [];
    });
  }

  function loadRaters() {
    return rpc("list_certified_raters_public").then(function (data) {
      cache.raters = asList(data);
      return cache.raters;
    });
  }

  function pendingCount(list) {
    return asList(list).filter(function (r) { return r.status === "pending"; }).length;
  }

  function renderInbox(root) {
    if (!root) return;
    var list = (cache.inbox || []).filter(function (r) { return r.status === "pending"; });
    if (!hooks.isRater()) {
      root.classList.add("hidden");
      root.innerHTML = "";
      return;
    }
    root.classList.remove("hidden");
    if (!list.length) {
      root.innerHTML = '<div class="req-inbox">' +
        '<h2>בקשות דירוג</h2>' +
        '<p class="note">אין כרגע בקשות ממתינות.</p>' +
      "</div>";
      return;
    }
    root.innerHTML = '<div class="req-inbox">' +
      "<h2>בקשות דירוג <b>(" + list.length + ")</b></h2>" +
      '<ul class="req-inbox-list">' + list.map(function (r) {
        var photo = r.player_photo
          ? '<img class="req-avatar" alt="" src="' + escapeHtml(r.player_photo) + '">'
          : '<span class="req-avatar is-fallback" aria-hidden="true">★</span>';
        return '<li class="req-inbox-item" data-request-id="' + escapeHtml(r.id) + '">' +
          photo +
          '<div class="req-inbox-body">' +
            "<strong>" + escapeHtml(r.player_name || "שחקן") + "</strong>" +
            (r.player_level ? '<span class="req-level" dir="ltr">' + escapeHtml(r.player_level) + "</span>" : "") +
            (r.message ? '<p class="req-msg">' + escapeHtml(r.message) + "</p>" : "") +
            '<span class="req-date">' + escapeHtml(fmtDate(r.created_at)) + "</span>" +
          "</div>" +
          '<div class="req-inbox-actions">' +
            '<button type="button" class="btn btn-star" data-req-act="rate">דרג</button>' +
          "</div>" +
        "</li>";
      }).join("") + "</ul></div>";
  }

  function renderMine(root) {
    if (!root) return;
    var list = cache.mine || [];
    if (!hooks.hasCard()) {
      root.classList.add("hidden");
      root.innerHTML = "";
      return;
    }
    root.classList.remove("hidden");
    var visible = list.filter(function (r) { return r.status !== "declined"; });
    var rows = visible.length
      ? '<ul class="req-mine-list">' + visible.map(function (r) {
          var st = r.status || "";
          var cancel = st === "pending"
            ? '<button type="button" class="text-btn" data-req-act="cancel" data-request-id="' + escapeHtml(r.id) + '">ביטול</button>'
            : "";
          var mail = (r.email_status === "sent" && r.email_sent_at)
            ? '<span class="req-mine-mail">מייל נשלח · ' + escapeHtml(fmtDate(r.email_sent_at)) + "</span>"
            : "";
          return '<li class="req-mine-item is-' + escapeHtml(st) + '">' +
            '<span class="req-status">' + escapeHtml(statusLabel(st)) + "</span>" +
            "<strong>" + escapeHtml(r.rater_name || "מוסמך") + "</strong>" +
            '<span class="req-date">' + escapeHtml(fmtDate(r.created_at)) + "</span>" +
            mail +
            cancel +
          "</li>";
        }).join("") + "</ul>"
      : '<p class="note">עדיין לא נשלחו בקשות דירוג.</p>';
    root.innerHTML = '<div class="req-mine">' +
      '<div class="req-mine-head">' +
        "בקשות דירוג מוסמך" +
        (pendingCount(list) ? " · " + pendingCount(list) + " ממתינות" : "") +
      "</div>" + rows + "</div>";
  }

  function closePicker() {
    var el = $("req-picker");
    if (el) el.classList.add("hidden");
    picked = {};
  }

  function openPicker() {
    if (!hooks.hasCard()) {
      hooks.showToast("צרו כרטיס כדי לבקש דירוג ממוסמך");
      return;
    }
    if (hooks.isRater && hooks.isRater()) {
      hooks.showToast("מוסמכים מדרגים שחקנים — אין צורך בכרטיס שחקן או בבקשת דירוג.");
      return;
    }
    if (cache.cooldown && cache.cooldown.active) {
      hooks.showToast(cooldownCopy(cache.cooldown.next_allowed_date || formatDay(cache.cooldown.next_allowed_at)));
      return;
    }
    picked = {};
    var box = $("req-picker");
    if (!box) return;
    var form = $("req-picker-form");
    var result = $("req-picker-result");
    if (form) form.classList.remove("hidden");
    if (result) {
      result.classList.add("hidden");
      result.innerHTML = "";
    }
    $("req-picker-list").innerHTML = '<p class="note">טוענים את רשימת המוסמכים…</p>';
    if ($("req-picker-msg")) $("req-picker-msg").value = "";
    if ($("req-picker-search")) $("req-picker-search").value = "";
    box.classList.remove("hidden");
    loadRaters().then(function () {
      paintPickerList();
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    });
  }

  function paintPickerList() {
    var root = $("req-picker-list");
    if (!root) return;
    var list = cache.raters || [];
    var q = (($("req-picker-search") || {}).value || "").trim().toLowerCase();
    if (q) {
      list = list.filter(function (r) {
        var clubs = (r.clubs || []).join(" ");
        var blob = [r.full_name, clubs, r.city].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }
    if (!list.length) {
      root.innerHTML = '<p class="note">' + ((cache.raters || []).length ? "אין מוסמכים שתואמים לחיפוש." : "אין כרגע מוסמכים זמינים.") + "</p>";
      return;
    }
    root.innerHTML = list.map(function (r) {
      var self = !!r.is_self;
      var ready = !!r.has_email && !self;
      var pending = (cache.mine || []).some(function (q) {
        return q.rater_id === r.id && q.status === "pending";
      });
      var cls = "req-rater coach-tile" + (ready ? "" : " is-soon") + (pending ? " is-pending" : "") + (self ? " is-self" : "") + (picked[r.id] ? " is-on" : "");
      var badge = self ? "זה החשבון המחובר" : (ready ? (pending ? "בקשה ממתינה" : "") : "בקרוב");
      var photo = r.photo
        ? '<img class="coach-tile-photo" alt="" src="' + escapeHtml(r.photo) + '">'
        : '<span class="coach-tile-photo is-fallback" aria-hidden="true">★</span>';
      var clubs = (r.clubs || []).filter(Boolean).join(" · ");
      var years = "";
      if (r.years_experience === 1) years = "שנת אימון אחת";
      else if (r.years_experience) years = r.years_experience + " שנות אימון";
      var level = "";
      if (r.level) {
        var lab = (window.PadelCoaches && PadelCoaches.levelLabel) ? PadelCoaches.levelLabel(r.level) : r.level;
        level = '<p class="coach-tile-level"><b dir="ltr">' + escapeHtml(r.level) + "</b><span>" + escapeHtml(lab) + "</span></p>";
      }
      var rank = r.national_ranking ? '<p class="coach-tile-rank">דירוג ארצי · ' + escapeHtml(r.national_ranking) + "</p>" : "";
      return '<button type="button" class="' + cls + '" data-rater-id="' + escapeHtml(r.id) + '"' +
        (ready && !pending ? "" : " disabled") + ">" +
        photo +
        '<div class="coach-tile-body">' +
          '<div class="coach-tile-top"><strong>' + escapeHtml(r.full_name || "מוסמך") + "</strong>" +
            (badge ? '<span class="coach-badge">' + escapeHtml(badge) + "</span>" : "") +
          "</div>" +
          (clubs ? '<p class="coach-tile-clubs">' + escapeHtml(clubs) + "</p>" : "") +
          (years ? '<p class="coach-tile-years">' + escapeHtml(years) + "</p>" : "") +
          level + rank +
        "</div>" +
      "</button>";
    }).join("");
  }

  function submitPicker() {
    var ids = Object.keys(picked).filter(function (id) { return picked[id]; });
    if (!ids.length) {
      hooks.showToast("בחרו לפחות מוסמך אחד");
      return;
    }
    var msg = (($("req-picker-msg") || {}).value || "").trim();
    var cardId = hooks.cardId();
    var btn = $("req-picker-send");
    if (btn) btn.disabled = true;
    var chain = Promise.resolve();
    var created = [];
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return rpc("create_rating_request", {
          p_rater_id: id,
          p_card_id: cardId,
          p_message: msg || null
        }).then(function (row) {
          var item = { row: row, mail: null, raterName: (row && row.rater_name) || "" };
          created.push(item);
          if (row && row.id) {
            return notify(row.id, "new").then(function (mail) { item.mail = mail; });
          }
        });
      });
    });
    chain.then(function () {
      showSendResult(created);
      return refresh();
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    }).then(function () {
      if (btn) btn.disabled = false;
      hooks.onChanged();
    });
  }

  function showSendResult(items) {
    var form = $("req-picker-form");
    var box = $("req-picker-result");
    if (!box) {
      var n = items && items.length;
      hooks.showToast(n === 1 ? "הבקשה נשלחה" : "נשלחו " + n + " בקשות");
      closePicker();
      return;
    }
    if (form) form.classList.add("hidden");
    box.classList.remove("hidden");
    box.innerHTML = (items || []).map(function (item) {
      var name = (item.row && item.row.rater_name) || item.raterName || "המוסמך";
      var mail = item.mail || {};
      var sent = mail.ok && !mail.skipped;
      if (sent) {
        return '<div class="req-mail-row" data-request-id="' + escapeHtml(item.row.id) + '">' +
          '<p class="req-mail-ok">✉️ נשלח מייל ל' + escapeHtml(name) + "</p>" +
          '<p class="req-mail-wait">הבקשה ממתינה לדירוג</p>' +
        "</div>";
      }
      return '<div class="req-mail-row" data-request-id="' + escapeHtml((item.row && item.row.id) || "") + '">' +
        '<p class="req-mail-fail">הבקשה נשמרה, אך המייל לא נשלח</p>' +
        '<button type="button" class="btn btn-primary" data-req-resend="' + escapeHtml((item.row && item.row.id) || "") + '">נסה שוב</button>' +
      "</div>";
    }).join("") + '<button type="button" class="btn btn-ghost" id="req-picker-result-close">סגירה</button>';
  }

  function resendRequestEmail(id, btn) {
    if (!id) return;
    if (btn) btn.disabled = true;
    notify(id, "new").then(function (mail) {
      var row = btn && btn.closest && btn.closest(".req-mail-row");
      if (!row) return;
      var sent = mail && mail.ok && !mail.skipped;
      if (sent) {
        var name = "";
        (cache.mine || []).some(function (r) { if (r.id === id) { name = r.rater_name || ""; return true; } });
        row.innerHTML = '<p class="req-mail-ok">✉️ נשלח מייל ל' + escapeHtml(name || "המוסמך") + "</p>" +
          '<p class="req-mail-wait">הבקשה ממתינה לדירוג</p>';
      } else {
        hooks.showToast("המשלוח נכשל. נסו שוב.");
        if (btn) btn.disabled = false;
      }
      return refresh();
    });
  }

  function cancel(id) {
    return rpc("cancel_rating_request", { p_id: id }).then(function () {
      hooks.showToast("הבקשה בוטלה");
      return refresh();
    }).then(function () { hooks.onChanged(); });
  }

  function decline(id) {
    return rpc("decline_rating_request", { p_id: id }).then(function (res) {
      if (res && res.id) notify(res.id, "declined");
      hooks.showToast("הבקשה נדחתה");
      return refresh();
    }).then(function () { hooks.onChanged(); });
  }


  function paintPendingBadges(count) {
    var n = count || 0;
    var banner = $("req-home-banner");
    var bannerText = $("req-home-banner-text");
    var badge = $("home-req-count");
    var top = $("req-top-badge");
    var topCount = $("home-req-count-top");
    var show = n > 0 && hooks.isRater();
    if (bannerText) {
      bannerText.textContent = n === 1
        ? "יש לך בקשת דירוג ממתינה ⭐"
        : "יש לך " + n + " בקשות דירוג ממתינות ⭐";
    }
    if (banner) banner.classList.toggle("hidden", !show);
    if (badge) {
      badge.textContent = show ? String(n) : "";
      badge.classList.toggle("hidden", !show);
    }
    if (top) top.classList.toggle("hidden", !show);
    if (topCount) topCount.textContent = show ? String(n) : "";
  }

  function loadUnseenRatings() {
    if (!hooks.hasCard || !hooks.hasCard()) {
      cache.unseen = [];
      return Promise.resolve([]);
    }
    return rpc("list_unseen_certified_ratings").then(function (data) {
      cache.unseen = asList(data);
      return cache.unseen;
    }).catch(function () {
      cache.unseen = [];
      return [];
    });
  }

  function paintRatedBanner() {
    var n = (cache.unseen || []).length;
    var show = n > 0 && hooks.hasCard && hooks.hasCard();
    ["rated-home-banner", "rated-card-banner"].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.toggle("hidden", !show);
    });
  }

  function dismissRatedBanner() {
    return rpc("mark_certified_ratings_seen").then(function () {
      cache.unseen = [];
      paintRatedBanner();
    }).catch(function () {});
  }

  function refresh() {
    var tasks = [loadMine(), loadUnseenRatings(), loadCooldown()];
    if (hooks.isRater()) tasks.push(loadInbox());
    return Promise.all(tasks).then(function () {
      renderMine($("req-mine"));
      renderMine($("req-mine-home"));
      renderInbox($("req-inbox"));
      var count = pendingCount(cache.inbox);
      paintPendingBadges(count);
      paintRatedBanner();
      return cache;
    }).catch(function (err) {
      console.warn("rating requests", err);
    });
  }

  function bind() {
    if ($("req-ask-btn")) $("req-ask-btn").addEventListener("click", openPicker);
    if ($("req-ask-home-btn")) $("req-ask-home-btn").addEventListener("click", openPicker);
    if ($("req-picker-cancel")) $("req-picker-cancel").addEventListener("click", closePicker);
    if ($("req-picker-send")) $("req-picker-send").addEventListener("click", submitPicker);
    if ($("req-picker-search")) $("req-picker-search").addEventListener("input", paintPickerList);

    if ($("req-home-banner")) $("req-home-banner").addEventListener("click", function (ev) {
      ev.preventDefault();
      var box = $("req-inbox");
      if (box) {
        box.classList.remove("hidden");
        box.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
    if ($("req-top-badge")) $("req-top-badge").addEventListener("click", function (ev) {
      ev.preventDefault();
      if (location.hash !== "#/" && location.hash !== "#/home") {
        if (hooks.go) hooks.go("home");
      }
      setTimeout(function () {
        var box = $("req-inbox");
        if (box) {
          box.classList.remove("hidden");
          box.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refresh();
    });
    window.addEventListener("focus", function () { refresh(); });
    var sheet = $("req-picker");
    if (sheet) sheet.addEventListener("click", function (ev) { if (ev.target === sheet) closePicker(); });
    document.addEventListener("click", function (ev) {
      var pick = ev.target && ev.target.closest && ev.target.closest("#req-picker-list .req-rater:not(:disabled)");
      if (pick) {
        var id = pick.getAttribute("data-rater-id");
        picked[id] = !picked[id];
        pick.classList.toggle("is-on", !!picked[id]);
        return;
      }
      var actBtn = ev.target && ev.target.closest && ev.target.closest("[data-req-act]");
      if (!actBtn) return;
      var act = actBtn.getAttribute("data-req-act");
      var item = actBtn.closest("[data-request-id]");
      var id = (item && item.getAttribute("data-request-id")) || actBtn.getAttribute("data-request-id");
      if (!id) return;
      if (act === "cancel") {
        cancel(id).catch(function (err) { hooks.showToast(hebrewError(err)); });
      } else if (act === "rate") {
        hooks.onOpenRate(id);
      }
    });
    document.addEventListener("click", function (ev) {
      var resend = ev.target && ev.target.closest && ev.target.closest("[data-req-resend]");
      if (resend) {
        ev.preventDefault();
        resendRequestEmail(resend.getAttribute("data-req-resend"), resend);
        return;
      }
      if (ev.target && ev.target.id === "req-picker-result-close") {
        ev.preventDefault();
        closePicker();
      }
    });
    ["rated-home-banner", "rated-card-banner"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("click", function (ev) {
        ev.preventDefault();
        dismissRatedBanner();
        if (hooks.go) hooks.go("card");
      });
    });
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelRequests = {
    init: init,
    refresh: refresh,
    openPicker: openPicker,
    closePicker: closePicker,
    notify: notify,
    notifyPlayerRated: notifyPlayerRated,
    loadMine: loadMine,
    loadInbox: loadInbox,
    hebrewError: hebrewError,
    statusLabel: statusLabel,
    pendingCount: pendingCount,
    cooldownCopy: cooldownCopy,
    cached: function () { return cache; }
  };
})();
