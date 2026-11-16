/* Padel Card — admin console (#/admin). All privileged work goes through
   SECURITY DEFINER RPCs that check is_admin(auth.uid()). */
(function () {
  var REGIONS = {
    north: "צפון", haifa: "חיפה והקריות", sharon: "שרון", center: "מרכז",
    telaviv: "תל אביב", shfela: "שפלה", jerusalem: "ירושלים", south: "דרום"
  };
  var PROVIDERS = { google: "Google", email: "אימייל" };
  var ACTIONS = { disable: "השבתה", enable: "הפעלה מחדש", "delete": "מחיקה" };
  var hooks = {
    go: function () {},
    showToast: function () {},
    onViewCard: function () {},
    regionLabel: function (id) { return REGIONS[id] || id || "—"; }
  };
  var cache = { search: "", sort: "created_at_desc", users: [], stats: null, actions: [] };
  var pendingDialog = null;

  function $(id) { return document.getElementById(id); }

  function client() {
    return window.PadelAuth && typeof PadelAuth.getClient === "function" ? PadelAuth.getClient() : null;
  }

  function rpc(name, args) {
    var c = client();
    if (!c) return Promise.reject(new Error("not configured"));
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) {
        var err = res.error;
        var msg = (err && (err.message || err.details || err.hint)) || "שגיאה";
        var boxed = new Error(msg);
        boxed.code = err && (err.code || err.details);
        boxed.status = err && err.status;
        throw boxed;
      }
      return res.data;
    });
  }

  function hebrewError(err) {
    var raw = String((err && err.message) || err || "");
    var m = raw.toLowerCase();
    if (/not authorized|42501/.test(m)) return "אין הרשאה לפעולה הזו.";
    if (/cannot change your own|cannot delete your own/.test(m)) return "אי אפשר לבצע את הפעולה על החשבון שלכם.";
    if (/cannot change an admin|cannot delete an admin/.test(m)) return "אי אפשר לשנות חשבון מנהל.";
    if (/email confirmation/.test(m)) return "כתובת האימייל שהוקלדה אינה תואמת.";
    if (/user not found/.test(m)) return "המשתמש לא נמצא.";
    return raw ? ("שגיאה: " + raw) : "משהו השתבש.";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (err) {
      return String(iso);
    }
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function providerLabel(p) {
    var key = String(p || "email").toLowerCase();
    return PROVIDERS[key] || p || "אימייל";
  }

  function regionLabel(id) {
    if (!id) return "—";
    return hooks.regionLabel(id) || REGIONS[id] || id;
  }

  function accountFlags() { return rpc("account_flags"); }

  function listDisabledIds() {
    var c = client();
    if (!c) return Promise.resolve([]);
    return c.from("disabled_cards").select("card_id").then(function (res) {
      if (res.error) throw res.error;
      return (res.data || []).map(function (r) { return r.card_id; }).filter(Boolean);
    });
  }

  function isCardUnavailable(cardId) {
    if (!cardId) return Promise.resolve(false);
    return rpc("is_card_unavailable", { p_card_id: cardId });
  }

  function loadAll() {
    var search = cache.search;
    var sort = cache.sort;
    return Promise.all([
      rpc("admin_stats"),
      rpc("admin_list_users", { p_search: search, p_sort: sort }),
      rpc("admin_list_actions")
    ]).then(function (parts) {
      cache.stats = parts[0] || {};
      cache.users = (parts[1] && parts[1].users) || [];
      cache.total = (parts[1] && parts[1].total) || cache.users.length;
      cache.actions = parts[2] || [];
      paint();
    });
  }

  function paintStats() {
    var root = $("admin-stats");
    if (!root) return;
    var s = cache.stats || {};
    var tiles = [
      { k: "משתמשים", v: s.total_users },
      { k: "כרטיסים", v: s.total_cards },
      { k: "חדשים השבוע", v: s.new_this_week },
      { k: "פעילים ב־7 ימים", v: s.active_last_7d },
      { k: "לא פעילים", v: s.disabled_users },
      { k: "סרטוני AI", v: s.ai_videos }
    ];
    var html = tiles.map(function (t) {
      return '<div class="admin-stat"><span class="admin-stat-k">' + escapeHtml(t.k) + '</span><strong class="admin-stat-v">' + escapeHtml(String(t.v == null ? "—" : t.v)) + "</strong></div>";
    }).join("");
    function chips(list, labelFn) {
      if (!list || !list.length) return "";
      return list.map(function (row) {
        var label = labelFn(row);
        return '<span class="admin-chip"><b>' + escapeHtml(label) + "</b> " + escapeHtml(String(row.count)) + "</span>";
      }).join("");
    }
    html += '<div class="admin-dist"><p class="admin-dist-k">לפי רמה</p><div class="admin-chips">' + (chips(s.by_level, function (r) { return r.level || "—"; }) || '<span class="admin-muted">אין עדיין נתונים</span>') + "</div></div>";
    html += '<div class="admin-dist"><p class="admin-dist-k">לפי אזור</p><div class="admin-chips">' + (chips(s.by_region, function (r) { return regionLabel(r.region); }) || '<span class="admin-muted">אין עדיין נתונים</span>') + "</div></div>";
    root.innerHTML = html;
  }

  function paintUsers() {
    var root = $("admin-users");
    if (!root) return;
    var count = $("admin-user-count");
    if (count) count.textContent = cache.total ? (cache.total + " משתמשים") : "אין משתמשים";
    if (!cache.users.length) {
      root.innerHTML = '<p class="admin-empty">לא נמצאו משתמשים.</p>';
      return;
    }
    root.innerHTML = cache.users.map(function (u) {
      var disabled = u.status === "disabled";
      var name = u.name || "בלי שם בכרטיס";
      var region = regionLabel(u.region);
      return '<article class="admin-user' + (disabled ? " is-disabled" : "") + '" data-user-id="' + escapeHtml(u.id) + '">' +
        '<div class="admin-user-top">' +
          '<div class="admin-user-id">' +
            '<strong>' + escapeHtml(name) + "</strong>" +
            '<span class="admin-email" dir="ltr">' + escapeHtml(u.email || "") + "</span>" +
          "</div>" +
          '<span class="admin-status ' + (disabled ? "is-off" : "is-on") + '">' + (disabled ? "לא פעיל" : "פעיל") + "</span>" +
        "</div>" +
        '<dl class="admin-meta">' +
          "<div><dt>ספק</dt><dd>" + escapeHtml(providerLabel(u.provider)) + "</dd></div>" +
          "<div><dt>רמה</dt><dd>" + escapeHtml(u.level || "—") + "</dd></div>" +
          "<div><dt>אזור</dt><dd>" + escapeHtml(region) + "</dd></div>" +
          "<div><dt>כרטיס</dt><dd>" + (u.has_card ? "כן" : "לא") + "</dd></div>" +
          "<div><dt>נרשם</dt><dd>" + escapeHtml(fmtDate(u.created_at)) + "</dd></div>" +
          "<div><dt>כניסה אחרונה</dt><dd>" + escapeHtml(fmtDate(u.last_sign_in_at)) + "</dd></div>" +
        "</dl>" +
        '<div class="admin-user-actions">' +
          (u.has_card ? '<button type="button" class="btn btn-ghost" data-admin-act="view">צפייה בכרטיס</button>' : "") +
          '<button type="button" class="btn btn-ghost" data-admin-act="' + (disabled ? "enable" : "disable") + '">' + (disabled ? "הפעלה מחדש" : "השבתה") + "</button>" +
          '<button type="button" class="btn btn-danger" data-admin-act="delete">מחיקה</button>' +
        "</div>" +
      "</article>";
    }).join("");
  }

  function paintActions() {
    var root = $("admin-actions");
    if (!root) return;
    if (!cache.actions.length) {
      root.innerHTML = '<p class="admin-empty">עדיין אין פעולות ביומן.</p>';
      return;
    }
    root.innerHTML = '<ol class="admin-log-list">' + cache.actions.map(function (a) {
      return "<li><strong>" + escapeHtml(ACTIONS[a.action] || a.action) + "</strong> · " +
        '<span dir="ltr">' + escapeHtml(a.target_email || "") + "</span>" +
        '<span class="admin-log-meta">על ידי ' + escapeHtml(a.admin_email || "מנהל") +
        " · " + escapeHtml(fmtDate(a.created_at)) + "</span></li>";
    }).join("") + "</ol>";
  }

  function paint() {
    paintStats();
    paintUsers();
    paintActions();
  }

  function setBusy(busy) {
    var root = $("view-admin");
    if (root) root.classList.toggle("is-busy", !!busy);
  }

  function refresh() {
    setBusy(true);
    return loadAll().catch(function (err) {
      hooks.showToast(hebrewError(err));
    }).then(function () { setBusy(false); });
  }

  function findUser(id) {
    return cache.users.filter(function (u) { return u.id === id; })[0];
  }

  function closeDialog() {
    var box = $("admin-dialog");
    if (box) box.classList.add("hidden");
    pendingDialog = null;
  }

  function openDialog(opts) {
    pendingDialog = opts;
    var box = $("admin-dialog");
    if (!box) return;
    $("admin-dialog-title").textContent = opts.title || "";
    $("admin-dialog-text").textContent = opts.text || "";
    var note = $("admin-dialog-note");
    if (note) {
      note.textContent = opts.note || "";
      note.classList.toggle("hidden", !opts.note);
    }
    var field = $("admin-dialog-field");
    var input = $("admin-dialog-email");
    if (field) field.classList.toggle("hidden", !opts.requireEmail);
    if (input) {
      input.value = "";
      if (opts.requireEmail) setTimeout(function () { input.focus(); }, 50);
    }
    var yes = $("admin-dialog-yes");
    if (yes) yes.textContent = opts.yesLabel || "אישור";
    yes.className = "btn " + (opts.danger ? "btn-danger" : "btn-primary");
    box.classList.remove("hidden");
  }

  function confirmAction() {
    var opts = pendingDialog;
    if (!opts) return;
    var typed = (($("admin-dialog-email") || {}).value || "").trim();
    if (opts.requireEmail && typed.toLowerCase() !== String(opts.email || "").toLowerCase()) {
      hooks.showToast("יש להקליד את כתובת האימייל לאישור.");
      return;
    }
    var user = opts.user;
    closeDialog();
    setBusy(true);
    var work;
    if (opts.act === "disable") work = rpc("admin_set_disabled", { p_user_id: user.id, p_disabled: true });
    else if (opts.act === "enable") work = rpc("admin_set_disabled", { p_user_id: user.id, p_disabled: false });
    else if (opts.act === "delete") work = rpc("admin_delete_user", { p_user_id: user.id, p_email: typed });
    else work = Promise.resolve();
    work.then(function () {
      hooks.showToast(opts.doneToast || "הפעולה בוצעה");
      return refresh();
    }).catch(function (err) {
      setBusy(false);
      hooks.showToast(hebrewError(err));
    });
  }

  function onUserAction(act, userId) {
    var user = findUser(userId);
    if (!user) return;
    if (act === "view") {
      hooks.onViewCard(user);
      return;
    }
    if (act === "disable") {
      openDialog({
        act: "disable",
        user: user,
        title: "השבתת משתמש",
        text: "להשבית את " + (user.name || user.email) + "? לא יוכלו להתחבר, וקישור הכרטיס שלהם יוסתר.",
        yesLabel: "השבתה",
        doneToast: "המשתמש הושבת"
      });
      return;
    }
    if (act === "enable") {
      openDialog({
        act: "enable",
        user: user,
        title: "הפעלה מחדש",
        text: "להפעיל מחדש את " + (user.email || "") + "?",
        yesLabel: "הפעלה מחדש",
        doneToast: "המשתמש הופעל מחדש"
      });
      return;
    }
    if (act === "delete") {
      openDialog({
        act: "delete",
        user: user,
        email: user.email,
        requireEmail: true,
        danger: true,
        title: "מחיקת משתמש",
        text: "הפעולה מוחקת את החשבון ואת הכרטיס לצמיתות. לאישור, הקלידו את כתובת האימייל.",
        note: user.email,
        yesLabel: "מחיקה לצמיתות",
        doneToast: "המשתמש נמחק"
      });
    }
  }

  function exportCsv() {
    var rows = cache.users || [];
    var headers = ["email", "provider", "name", "created_at", "last_sign_in_at", "has_card", "level", "region", "status"];
    function cell(v) {
      var s = v == null ? "" : String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    var lines = [headers.join(",")].concat(rows.map(function (u) {
      return [
        u.email, u.provider, u.name, u.created_at, u.last_sign_in_at,
        u.has_card ? "yes" : "no", u.level, u.region, u.status
      ].map(cell).join(",");
    }));
    var blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "padel-users.csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function bind() {
    var search = $("admin-search");
    if (search) {
      var timer = 0;
      search.addEventListener("input", function () {
        cache.search = search.value || "";
        clearTimeout(timer);
        timer = setTimeout(refresh, 280);
      });
    }
    var sort = $("admin-sort");
    if (sort) {
      sort.addEventListener("change", function () {
        cache.sort = sort.value || "created_at_desc";
        refresh();
      });
    }
    if ($("admin-export")) $("admin-export").addEventListener("click", exportCsv);
    if ($("admin-refresh")) $("admin-refresh").addEventListener("click", refresh);
    var list = $("admin-users");
    if (list) {
      list.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-admin-act]");
        if (!btn) return;
        var card = ev.target.closest("[data-user-id]");
        if (!card) return;
        onUserAction(btn.getAttribute("data-admin-act"), card.getAttribute("data-user-id"));
      });
    }
    if ($("admin-dialog-no")) $("admin-dialog-no").addEventListener("click", closeDialog);
    if ($("admin-dialog-yes")) $("admin-dialog-yes").addEventListener("click", confirmAction);
    var dlg = $("admin-dialog");
    if (dlg) dlg.addEventListener("click", function (ev) { if (ev.target === dlg) closeDialog(); });
    if ($("home-admin-btn")) $("home-admin-btn").addEventListener("click", function () { hooks.go("admin"); });
    if ($("admin-preview-back")) $("admin-preview-back").addEventListener("click", function () { hooks.go("admin"); });
  }

  function render() {
    var search = $("admin-search");
    var sort = $("admin-sort");
    if (search && search.value !== cache.search) search.value = cache.search;
    if (sort) sort.value = cache.sort;
    refresh();
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelAdmin = {
    init: init,
    render: render,
    accountFlags: accountFlags,
    listDisabledIds: listDisabledIds,
    isCardUnavailable: isCardUnavailable,
    getCard: function (userId) { return rpc("admin_get_card", { p_user_id: userId }); },
    listUsers: function (search, sort) { return rpc("admin_list_users", { p_search: search || "", p_sort: sort || "created_at_desc" }); },
    stats: function () { return rpc("admin_stats"); },
    setDisabled: function (userId, disabled) { return rpc("admin_set_disabled", { p_user_id: userId, p_disabled: !!disabled }); },
    deleteUser: function (userId, email) { return rpc("admin_delete_user", { p_user_id: userId, p_email: email }); },
    listActions: function () { return rpc("admin_list_actions"); },
    hebrewError: hebrewError
  };
})();
