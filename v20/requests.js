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
  var cache = { mine: null, inbox: null, raters: null };
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
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
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
    if (/request already pending/.test(low)) return "כבר יש בקשה ממתינה למוסמך הזה.";
    if (/rater has no email/.test(low)) return "למוסמך הזה עדיין אין אימייל משויך. סמנו «בקרוב».";
    if (/request not pending/.test(low)) return "הבקשה כבר אינה ממתינה.";
    if (/request not found/.test(low)) return "הבקשה לא נמצאה.";
    if (/not your card/.test(low)) return "אפשר לבקש דירוג רק לכרטיס שלכם.";
    if (/not authorized/.test(low)) return "אין הרשאה לפעולה הזו.";
    if (window.PadelCertified && PadelCertified.hebrewError) return PadelCertified.hebrewError(err);
    return msg || "הפעולה נכשלה. נסו שוב.";
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

  function notify(requestId, kind) {
    var c = hooks.getClient();
    if (!c || !requestId) return Promise.resolve();
    return c.functions.invoke("notify-rating-request", {
      body: { request_id: requestId, kind: kind || "new" }
    }).then(function (res) {
      if (res.error) console.warn("notify-rating-request", res.error);
      return res;
    }).catch(function (err) {
      console.warn("notify-rating-request", err);
    });
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
            '<button type="button" class="btn btn-ghost" data-req-act="decline">דחייה</button>' +
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
    var rows = list.length
      ? '<ul class="req-mine-list">' + list.map(function (r) {
          var st = r.status || "";
          var cancel = st === "pending"
            ? '<button type="button" class="text-btn" data-req-act="cancel" data-request-id="' + escapeHtml(r.id) + '">ביטול</button>'
            : "";
          return '<li class="req-mine-item is-' + escapeHtml(st) + '">' +
            '<span class="req-status">' + escapeHtml(statusLabel(st)) + "</span>" +
            "<strong>" + escapeHtml(r.rater_name || "מוסמך") + "</strong>" +
            '<span class="req-date">' + escapeHtml(fmtDate(r.created_at)) + "</span>" +
            cancel +
          "</li>";
        }).join("") + "</ul>"
      : '<p class="note">עדיין לא נשלחו בקשות דירוג.</p>';
    root.innerHTML = '<div class="req-mine">' +
      '<div class="req-mine-head">' +
        "בקשות דירוג כוכב" +
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
      hooks.showToast("צרו כרטיס כדי לבקש דירוג כוכב");
      return;
    }
    picked = {};
    var box = $("req-picker");
    if (!box) return;
    $("req-picker-list").innerHTML = '<p class="note">טוענים את רשימת המוסמכים…</p>';
    $("req-picker-msg").value = "";
    box.classList.remove("hidden");
    loadRaters().then(function (list) {
      if (!list.length) {
        $("req-picker-list").innerHTML = '<p class="note">אין כרגע מוסמכים זמינים.</p>';
        return;
      }
      $("req-picker-list").innerHTML = list.map(function (r) {
        var ready = !!r.has_email;
        var pending = (cache.mine || []).some(function (q) {
          return q.rater_id === r.id && q.status === "pending";
        });
        var cls = "req-rater" + (ready ? "" : " is-soon") + (pending ? " is-pending" : "");
        var badge = ready ? (pending ? "בקשה ממתינה" : "") : "בקרוב";
        return '<button type="button" class="' + cls + '" data-rater-id="' + escapeHtml(r.id) + '"' +
          (ready && !pending ? "" : " disabled") + ">" +
          "<strong>" + escapeHtml(r.full_name) + "</strong>" +
          (badge ? '<span>' + badge + "</span>" : "") +
        "</button>";
      }).join("");
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    });
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
          created.push(row);
          if (row && row.id) return notify(row.id, "new");
        });
      });
    });
    chain.then(function () {
      closePicker();
      hooks.showToast(created.length === 1 ? "הבקשה נשלחה" : "נשלחו " + created.length + " בקשות");
      return refresh();
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    }).then(function () {
      if (btn) btn.disabled = false;
      hooks.onChanged();
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

  function refresh() {
    var tasks = [loadMine()];
    if (hooks.isRater()) tasks.push(loadInbox());
    return Promise.all(tasks).then(function () {
      renderMine($("req-mine"));
      renderMine($("req-mine-home"));
      renderInbox($("req-inbox"));
      var count = pendingCount(cache.inbox);
      var badge = $("home-req-count");
      if (badge) {
        badge.textContent = count ? String(count) : "";
        badge.classList.toggle("hidden", !count);
      }
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
      } else if (act === "decline") {
        decline(id).catch(function (err) { hooks.showToast(hebrewError(err)); });
      } else if (act === "rate") {
        hooks.onOpenRate(id);
      }
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
    loadMine: loadMine,
    loadInbox: loadInbox,
    hebrewError: hebrewError,
    statusLabel: statusLabel,
    pendingCount: pendingCount,
    cached: function () { return cache; }
  };
})();
