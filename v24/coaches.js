/* Certified rater profiles, public coaches directory, and invite claim. */
(function () {
  var hooks = {
    getClient: function () { return window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient(); },
    showToast: function () {},
    go: function () {},
    isRater: function () { return false; },
    isLoggedIn: function () { return false; },
    regionLabel: function (id) { return id || ""; },
    weightedLevel: function () { return null; },
    playerPhoto: function () { return ""; },
    uploadPhoto: null,
    onClaimed: function () {}
  };

  var AUDIENCES = [
    { id: "kids", label: "ילדים" },
    { id: "beginners", label: "מתחילים" },
    { id: "advanced", label: "מתקדמים" },
    { id: "competitive", label: "תחרותיים" }
  ];
  var REGIONS = [
    ["north", "צפון"], ["haifa", "חיפה והקריות"], ["sharon", "שרון"], ["center", "מרכז"],
    ["telaviv", "תל אביב"], ["shfela", "שפלה"], ["jerusalem", "ירושלים"], ["south", "דרום"]
  ];
  var directoryCache = null;
  var editorBusy = false;
  var lastInviteToken = "";

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function rpc(name, args, allowAnon) {
    var c = hooks.getClient();
    if (!c) return Promise.reject(new Error("not configured"));
    var run = function () {
      return c.rpc(name, args || {}).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    };
    if (allowAnon || !c.auth || !c.auth.getSession) return run();
    return c.auth.getSession().then(function (s) {
      if (!(s && s.data && s.data.session)) throw new Error("not authorized");
      return run();
    });
  }

  function hebrewError(err) {
    var msg = (err && (err.message || err.error_description || err.error)) || String(err || "");
    var low = String(msg).toLowerCase();
    if (/invite already used/.test(low)) return "קישור ההזמנה כבר נוצל.";
    if (/invite expired/.test(low)) return "קישור ההזמנה פג תוקף. בקשו קישור חדש.";
    if (/invalid invite/.test(low)) return "קישור ההזמנה אינו תקין.";
    if (/rater already linked/.test(low)) return "המוסמך כבר משויך לחשבון אחר.";
    if (/cannot assign admin email/.test(low)) return "אי אפשר לשייך למוסמך את האימייל של חשבון מנהל.";
    if (/email already in use/.test(low)) return "האימייל הזה כבר משויך למוסמך אחר.";
    if (/coach not found/.test(low)) return "כרטיס המוסמך לא נמצא.";
    if (/invalid contact/.test(low)) return "מספר הטלפון אינו תקין.";
    if (/invalid photo/.test(low)) return "יש להעלות תמונה מכתובת מאובטחת.";
    if (/invalid level/.test(low)) return "בחרו רמה מהסולם הישראלי.";
    if (/certified raters cannot have a player card/.test(low)) return "למוסמך אין כרטיס שחקן. כרטיס המוסמך הוא הפרופיל שלכם.";
    if (/invalid profile|invalid club|too many clubs/.test(low)) return "בדקו את פרטי הפרופיל ונסו שוב.";
    if (/not a certified rater/.test(low)) return "רק מוסמך פעיל יכול לערוך את הפרופיל הזה.";
    if (/not authorized/.test(low)) return "יש להתחבר כדי להמשיך.";
    return msg || "הפעולה נכשלה. נסו שוב.";
  }

  function audienceLabel(id) {
    for (var i = 0; i < AUDIENCES.length; i++) if (AUDIENCES[i].id === id) return AUDIENCES[i].label;
    return id;
  }

  function yearsLabel(n) {
    if (n == null || n === "") return "";
    n = Number(n);
    if (n === 1) return "שנת אימון אחת";
    return n + " שנות אימון";
  }

  function clubsText(clubs) {
    return (clubs || []).filter(Boolean).join(" · ");
  }

  function locationText(coach) {
    var parts = [];
    if (coach && coach.city) parts.push(coach.city);
    if (coach && coach.region) {
      var lab = hooks.regionLabel(coach.region) || coach.region;
      if (parts.indexOf(lab) === -1) parts.push(lab);
    }
    return parts.join(" · ");
  }

  function initials(name) {
    return (name || "מ").trim().split(/\s+/).slice(0, 2).map(function (p) { return p.charAt(0); }).join("") || "מ";
  }

  function photoTag(url, name, cls) {
    if (url) return '<img class="' + cls + '" alt="" src="' + escapeHtml(url) + '">';
    return '<span class="' + cls + ' is-fallback" aria-hidden="true">' + escapeHtml(initials(name)) + "</span>";
  }

  function waLink(contact) {
    var digits = String(contact || "").replace(/\D/g, "");
    if (digits.length < 9) return "";
    if (digits.indexOf("0") === 0) digits = "972" + digits.slice(1);
    if (digits.indexOf("972") !== 0 && digits.length <= 10) digits = "972" + digits;
    return "https://wa.me/" + digits;
  }

  function setInviteToken(token) {
    lastInviteToken = token || "";
    try {
      if (token) sessionStorage.setItem("padelCard.inviteToken", token);
      else sessionStorage.removeItem("padelCard.inviteToken");
    } catch (err) {}
  }

  function peekInviteToken() {
    if (lastInviteToken) return lastInviteToken;
    try { return sessionStorage.getItem("padelCard.inviteToken") || ""; } catch (err) { return ""; }
  }

  function levelMeta(id) {
    if (!id || !window.PadelQuiz || !PadelQuiz.LEVELS) return null;
    for (var i = 0; i < PadelQuiz.LEVELS.length; i++) {
      if (PadelQuiz.LEVELS[i].id === id) return PadelQuiz.LEVELS[i];
    }
    return null;
  }

  function levelLabel(id) {
    var m = levelMeta(id);
    if (!m) return id || "";
    return m.id + " · " + m.title;
  }

  function fillLevelSelect(sel, current) {
    if (!sel) return;
    var levels = (window.PadelQuiz && PadelQuiz.LEVELS) || [];
    var html = '<option value="">בחרו רמה</option>';
    for (var i = 0; i < levels.length; i++) {
      var L = levels[i];
      html += '<option value="' + escapeHtml(L.id) + '"' + (current === L.id ? " selected" : "") + ">" +
        escapeHtml(L.id + " — " + L.title + " (" + L.numeric + ")") + "</option>";
    }
    sel.innerHTML = html;
    if (current) sel.value = current;
  }

  function credsHtml(c) {
    if (!c) return "";
    var meta = levelMeta(c.level);
    var level = c.level
      ? '<div class="coach-level-badge"><b dir="ltr">' + escapeHtml(c.level) + "</b><span>הרמה שלי" +
        (meta && meta.title ? " · " + escapeHtml(meta.title) : "") + "</span></div>"
      : "";
    var rank = c.national_ranking
      ? '<div class="coach-ranking-badge"><b>' + escapeHtml(c.national_ranking) + "</b><span>דירוג ארצי</span></div>"
      : "";
    if (!level && !rank) return "";
    return '<div class="coach-creds">' + level + rank + "</div>";
  }

  function tileLevelHtml(c) {
    var bits = [];
    if (c.level) {
      bits.push('<p class="coach-tile-level"><b dir="ltr">' + escapeHtml(c.level) + "</b><span>" +
        escapeHtml(levelLabel(c.level)) + "</span></p>");
    }
    if (c.national_ranking) {
      bits.push('<p class="coach-tile-rank">דירוג ארצי · ' + escapeHtml(c.national_ranking) + "</p>");
    }
    return bits.join("");
  }

  function coachTileHtml(c, opts) {
    opts = opts || {};
    var href = "#/coach/" + encodeURIComponent(c.id);
    var years = yearsLabel(c.years_experience);
    var loc = locationText(c);
    var clubs = clubsText(c.clubs);
    var tag = opts.link === false ? "div" : "a";
    var extra = opts.link === false ? "" : ' href="' + href + '"';
    return '<' + tag + ' class="coach-tile"' + extra + '>' +
      photoTag(c.photo, c.full_name, "coach-tile-photo") +
      '<div class="coach-tile-body">' +
        '<div class="coach-tile-top"><strong>' + escapeHtml(c.full_name || "מוסמך") + "</strong>" +
          '<span class="coach-badge">מוסמך</span></div>' +
        (loc ? '<p class="coach-tile-meta">' + escapeHtml(loc) + "</p>" : "") +
        (clubs ? '<p class="coach-tile-clubs">' + escapeHtml(clubs) + "</p>" : "") +
        (years ? '<p class="coach-tile-years">' + escapeHtml(years) + "</p>" : "") +
        tileLevelHtml(c) +
      "</div></" + tag + ">";
  }

  function renderDirectory() {
    var root = $("view-coaches");
    if (!root) return;
    var q = (($("coaches-search") || {}).value || "").trim().toLowerCase();
    var list = directoryCache || [];
    if (q) {
      list = list.filter(function (c) {
        var blob = [c.full_name, clubsText(c.clubs), c.city, hooks.regionLabel(c.region)].join(" ").toLowerCase();
        return blob.indexOf(q) !== -1;
      });
    }
    var box = $("coaches-grid");
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="note">' + (directoryCache && directoryCache.length ? "אין מוסמכים שתואמים לחיפוש." : "עדיין אין מוסמכים עם פרופיל ציבורי.") + "</p>";
      return;
    }
    box.innerHTML = list.map(function (c) { return coachTileHtml(c); }).join("");
  }

  function loadDirectory() {
    var box = $("coaches-grid");
    if (box && !directoryCache) box.innerHTML = '<p class="note">טוענים את המוסמכים…</p>';
    return rpc("list_certified_coaches_public", {}, true).then(function (data) {
      directoryCache = Array.isArray(data) ? data : [];
      renderDirectory();
    }).catch(function (err) {
      if (box) box.innerHTML = '<p class="note">' + escapeHtml(hebrewError(err)) + "</p>";
    });
  }

  function renderCoachCard(coach) {
    var root = $("coach-card-root");
    if (!root) return;
    if (!coach) {
      root.innerHTML = '<p class="note">כרטיס המוסמך לא נמצא.</p>';
      return;
    }
    var years = yearsLabel(coach.years_experience);
    var loc = locationText(coach);
    var clubs = (coach.clubs || []).map(function (c) {
      return '<span class="pill">' + escapeHtml(c) + "</span>";
    }).join("");
    var aud = (coach.audiences || []).map(function (a) {
      return '<span class="pill">' + escapeHtml(audienceLabel(a)) + "</span>";
    }).join("");
    var contact = coach.contact_public && coach.contact ? coach.contact : "";
    var wa = contact ? waLink(contact) : "";
    var levelOnHero = coach.level
      ? '<div class="coach-level-badge"><b dir="ltr">' + escapeHtml(coach.level) + "</b><span>הרמה שלי</span></div>"
      : "";

    root.innerHTML =
      '<article class="coach-card">' +
        '<div class="coach-card-hero">' +
          photoTag(coach.photo, coach.full_name, "coach-card-photo") +
          '<div class="coach-card-hero-shade"></div>' +
          '<div class="coach-card-hero-text">' +
            '<span class="coach-badge coach-badge-lg">מוסמך</span>' +
            "<h1>" + escapeHtml(coach.full_name || "מוסמך") + "</h1>" +
            (loc ? "<p>" + escapeHtml(loc) + "</p>" : "") +
          "</div>" +
          levelOnHero +
        "</div>" +
        '<div class="coach-card-body">' +
          credsHtml(coach) +
          (years || coach.certification ? '<p class="coach-card-cred">' +
            escapeHtml([years, coach.certification].filter(Boolean).join(" · ")) + "</p>" : "") +
          (clubs ? '<p class="ut-section">מועדונים</p><div class="ut-shots">' + clubs + "</div>" : "") +
          (aud ? '<p class="ut-section">מלמדים</p><div class="ut-shots">' + aud + "</div>" : "") +
          (coach.bio ? '<p class="ut-section">קצת עליי</p><p class="coach-bio">' + escapeHtml(coach.bio) + "</p>" : "") +
          '<div class="coach-card-actions">' +
            (wa ? '<a class="btn btn-primary" id="coach-wa" href="' + escapeHtml(wa) + '" target="_blank" rel="noopener">וואטסאפ לשיעור</a>' : "") +
            '<button type="button" class="btn btn-ghost" id="coach-share-btn">שיתוף הכרטיס</button>' +
          "</div>" +
        "</div>" +
      "</article>";

    if ($("coach-share-btn")) $("coach-share-btn").addEventListener("click", function () {
      var url = location.origin + location.pathname + "#/coach/" + coach.id;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          hooks.showToast("הקישור הועתק");
        }).catch(function () { hooks.showToast(url); });
      } else hooks.showToast("הקישור מוכן להעתקה");
    });
  }

  function loadCoach(id) {
    var root = $("coach-card-root");
    if (root) root.innerHTML = '<p class="note">טוענים את כרטיס המוסמך…</p>';
    return rpc("get_certified_coach_public", { p_id: id }, true).then(function (data) {
      renderCoachCard(data);
    }).catch(function (err) {
      if (root) root.innerHTML = '<p class="note">' + escapeHtml(hebrewError(err)) + "</p>";
    });
  }

  function formValues() {
    var clubsRaw = (($("coach-edit-clubs") || {}).value || "");
    var clubs = clubsRaw.split(/[,،\n]/).map(function (s) { return s.trim(); }).filter(Boolean);
    var audiences = [];
    document.querySelectorAll("#coach-edit-audiences input[type=checkbox]:checked").forEach(function (el) {
      audiences.push(el.value);
    });
    return {
      clubs: clubs,
      city: (($("coach-edit-city") || {}).value || "").trim(),
      region: (($("coach-edit-region") || {}).value || "").trim() || null,
      years_experience: (($("coach-edit-years") || {}).value || "") === "" ? null : Number($("coach-edit-years").value),
      certification: (($("coach-edit-cert") || {}).value || "").trim(),
      audiences: audiences,
      bio: (($("coach-edit-bio") || {}).value || "").trim(),
      contact: (($("coach-edit-contact") || {}).value || "").trim(),
      contact_public: !!($("coach-edit-contact-public") && $("coach-edit-contact-public").checked),
      photo: (($("coach-edit-photo-url") || {}).value || "").trim() || null,
      level: (($("coach-edit-level") || {}).value || "").trim() || null,
      national_ranking: (($("coach-edit-ranking") || {}).value || "").trim()
    };
  }

  function fillEditor(data) {
    data = data || {};
    if ($("coach-edit-name")) $("coach-edit-name").textContent = data.full_name || "הפרופיל שלי כמוסמך";
    if ($("coach-edit-clubs")) $("coach-edit-clubs").value = (data.clubs || []).join(", ");
    if ($("coach-edit-city")) $("coach-edit-city").value = data.city || "";
    if ($("coach-edit-region")) $("coach-edit-region").value = data.region || "";
    if ($("coach-edit-years")) $("coach-edit-years").value = data.years_experience == null ? "" : data.years_experience;
    if ($("coach-edit-cert")) $("coach-edit-cert").value = data.certification || "";
    if ($("coach-edit-bio")) $("coach-edit-bio").value = data.bio || "";
    if ($("coach-edit-contact")) $("coach-edit-contact").value = data.contact || "";
    if ($("coach-edit-contact-public")) $("coach-edit-contact-public").checked = !!data.contact_public;
    if ($("coach-edit-photo-url")) $("coach-edit-photo-url").value = data.photo || "";
    fillLevelSelect($("coach-edit-level"), data.level || "");
    if ($("coach-edit-ranking")) $("coach-edit-ranking").value = data.national_ranking || "";
    document.querySelectorAll("#coach-edit-audiences input[type=checkbox]").forEach(function (el) {
      el.checked = (data.audiences || []).indexOf(el.value) !== -1;
    });
    var preview = $("coach-edit-photo-preview");
    if (preview) {
      preview.innerHTML = photoTag(data.photo, data.full_name, "coach-edit-photo");
    }
    var status = $("coach-edit-status");
    if (status) {
      status.textContent = data.is_complete
        ? "הפרופיל מפורסם בכרטיס הציבורי ובמדריך המוסמכים."
        : "כדי לפרסם: מלאו ניסיון, מועדון או עיר, וקהל יעד.";
      status.classList.toggle("is-ready", !!data.is_complete);
    }
    var pub = $("coach-edit-public-link");
    if (pub) {
      if (data.is_complete && data.id) {
        pub.classList.remove("hidden");
        pub.setAttribute("href", "#/coach/" + data.id);
      } else pub.classList.add("hidden");
    }
  }

  function loadEditor() {
    fillEditor({});
    return rpc("get_my_certified_profile").then(function (data) {
      fillEditor(data || {});
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    });
  }

  function saveEditor() {
    if (editorBusy) return;
    editorBusy = true;
    var btn = $("coach-edit-save");
    if (btn) btn.disabled = true;
    return rpc("upsert_my_certified_profile", { p_profile: formValues() }).then(function (data) {
      fillEditor(data || {});
      directoryCache = null;
      hooks.showToast((data && data.is_complete) ? "הפרופיל נשמר ופורסם" : "הפרופיל נשמר");
    }).catch(function (err) {
      hooks.showToast(hebrewError(err));
    }).then(function () {
      editorBusy = false;
      if (btn) btn.disabled = false;
    });
  }

  function onPhotoFile(file) {
    if (!file || !hooks.uploadPhoto) {
      hooks.showToast("לא ניתן להעלות תמונה כרגע");
      return;
    }
    hooks.showToast("מעלה תמונה…");
    hooks.uploadPhoto(file).then(function (url) {
      if ($("coach-edit-photo-url")) $("coach-edit-photo-url").value = url;
      var preview = $("coach-edit-photo-preview");
      if (preview) preview.innerHTML = photoTag(url, "מוסמך", "coach-edit-photo");
      hooks.showToast("התמונה נוספה");
    }).catch(function () {
      hooks.showToast("העלאת התמונה נכשלה");
    });
  }

  function renderInvite() {
    var root = $("view-invite");
    if (!root) return;
    if (!hooks.isLoggedIn()) {
      root.innerHTML = '<div class="coach-invite-panel"><h1>הזמנה למוסמך</h1><p class="lede">התחברו באימייל או בגוגל כדי לקבל את ההזמנה ולהשלים את כרטיס המוסמך.</p></div>';
      return;
    }
    root.innerHTML = '<div class="coach-invite-panel"><h1>מקבלים את ההזמנה…</h1><p class="lede">רגע, מחברים את החשבון שלכם.</p></div>';
    claimPendingInvite();
  }

  function claimPendingInvite() {
    var token = peekInviteToken();
    if (!token) return Promise.resolve(null);
    if (!hooks.isLoggedIn()) return Promise.resolve(null);
    return rpc("claim_rater_invite", { p_token: token }).then(function (data) {
      setInviteToken("");
      hooks.showToast("ברוכים הבאים, " + ((data && data.rater_name) || "מוסמך"));
      if (hooks.onClaimed) hooks.onClaimed(data);
      hooks.go("coach-profile");
      return data;
    }).catch(function (err) {
      var msg = hebrewError(err);
      hooks.showToast(msg);
      var root = $("view-invite");
      if (root) {
        root.innerHTML = '<div class="coach-invite-panel"><h1>לא הצלחנו לקבל את ההזמנה</h1><p class="lede">' +
          escapeHtml(msg) + '</p><button type="button" class="btn btn-primary" id="invite-home-btn">חזרה לבית</button></div>';
        if ($("invite-home-btn")) $("invite-home-btn").addEventListener("click", function () { hooks.go("home"); });
      }
      if (/already used|expired|invalid invite|already linked|admin email/.test(String((err && err.message) || "").toLowerCase())) {
        setInviteToken("");
      }
      return null;
    });
  }

  function loadHomePreview() {
    var box = $("home-coach-preview");
    var wrap = $("home-rater-home");
    if (!box) return;
    if (!hooks.isRater || !hooks.isRater()) {
      box.innerHTML = "";
      if (wrap) wrap.classList.add("hidden");
      return;
    }
    if (wrap) wrap.classList.remove("hidden");
    return rpc("get_my_certified_profile").then(function (data) {
      if (data && data.is_complete) {
        var saved = $("coach-card-root") && $("coach-card-root").innerHTML;
        var main = $("coach-card-root");
        // Render into the preview by temporarily swapping the root id target via a clone container.
        renderCoachInto(box, data);
        if (main && saved != null) { /* keep main root untouched */ }
      } else {
        box.innerHTML = '<div class="coach-home-incomplete"><p>השלימו את כרטיס המוסמך כדי לפרסם אותו לשחקנים. זה הפרופיל שלכם — בלי כרטיס שחקן.</p>' +
          '<button type="button" class="btn btn-primary" id="home-complete-coach">השלמת הפרופיל</button></div>';
        if ($("home-complete-coach")) $("home-complete-coach").addEventListener("click", function () { hooks.go("coach-profile"); });
      }
    }).catch(function () {
      box.innerHTML = "";
    });
  }

  function renderCoachInto(root, coach) {
    if (!root) return;
    var prev = $("coach-card-root");
    var prevId = prev && prev.id;
    root.id = "coach-card-root";
    try { renderCoachCard(coach); }
    finally {
      root.id = root === prev ? "coach-card-root" : (root.getAttribute("data-root-id") || "home-coach-preview");
      if (prev && prev !== root) prev.id = prevId || "coach-card-root";
    }
    var share = root.querySelector("#coach-share-btn");
    if (share) share.id = "home-coach-share-btn";
    var wa = root.querySelector("#coach-wa");
    if (wa) wa.id = "home-coach-wa";
  }

  function bind() {
    if ($("coaches-search")) $("coaches-search").addEventListener("input", renderDirectory);
    if ($("coach-edit-save")) $("coach-edit-save").addEventListener("click", saveEditor);
    if ($("coach-edit-photo-file")) $("coach-edit-photo-file").addEventListener("change", function (ev) {
      var file = ev.target && ev.target.files && ev.target.files[0];
      if (file) onPhotoFile(file);
      ev.target.value = "";
    });
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelCoaches = {
    init: init,
    loadDirectory: loadDirectory,
    loadCoach: loadCoach,
    loadEditor: loadEditor,
    loadHomePreview: loadHomePreview,
    levelLabel: levelLabel,
    renderInvite: renderInvite,
    claimPendingInvite: claimPendingInvite,
    setInviteToken: setInviteToken,
    peekInviteToken: peekInviteToken,
    hebrewError: hebrewError,
    audienceLabel: audienceLabel,
    yearsLabel: yearsLabel,
    clubsText: clubsText,
    locationText: locationText,
    coachTileHtml: coachTileHtml,
    inviteMessage: function (name, link) {
      return [
        "שלום " + (name || "מוסמך") + " 👋",
        "",
        "מזמינים אותך להצטרף ל־Padel Card — כרטיס שחקן דיגיטלי בעברית, שעוזר לשחקנים להציג את הרמה שלהם ולבקש חוות דעת מקצועית ממאמנים.",
        "",
        "כמוסמך דירוג, חוות הדעת שלך מופיעה בכרטיס השחקן ועוזרת למארגנים ולשחקנים להבין רמה אמיתית — לא רק תחושת בטן. ההצטרפות חינמית לגמרי.",
        "",
        "כל מה שצריך: לפתוח את הקישור, להתחבר באימייל או בגוגל, ולהשלים את כרטיס המוסמך שלך (מועדונים, ניסיון וקצת עליך).",
        "",
        link || "",
        "",
        "מחכים לך,",
        "צוות Padel Card"
      ].join("\n");
    }
  };
})();
