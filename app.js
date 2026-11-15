(function () {
  const STORAGE_KEY = "padelCard.v2";
  const PHOTO_SHARE_MAX = 18000;
  const videoBlobs = new Map();

  const state = {
    view: "home",
    quizIndex: 0,
    answers: [],
    levelId: null,
    profile: null,
    publicCard: null,
    publicPair: null,
    videos: [],
    courts: [],
    photo: null,
    partnerId: null,
    shareMode: "single"
  };

  const $ = function (id) { return document.getElementById(id); };

  function uid() {
    return "local-" + Date.now().toString(16) + "-" + Math.random().toString(16).slice(2, 8);
  }

  function loadSaved() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        migrateV1();
        return;
      }
      var data = JSON.parse(raw);
      state.levelId = data.levelId || null;
      state.profile = data.profile || null;
      state.answers = data.answers || [];
      state.photo = (data.profile && data.profile.photo) || data.photo || null;
      state.partnerId = (data.profile && data.profile.partnerId) || data.partnerId || null;
      state.videos = (data.videos || []).map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", objectUrl: null, localOnly: !!v.localOnly };
      });
    } catch (err) {
      console.warn("לא ניתן לטעון נתונים שמורים", err);
    }
  }

  function migrateV1() {
    try {
      var raw = localStorage.getItem("padelCard.v1");
      if (!raw) return;
      var data = JSON.parse(raw);
      state.levelId = data.levelId || null;
      state.profile = data.profile || null;
      if (state.profile && !state.profile.id) state.profile.id = uid();
      state.answers = data.answers || [];
      state.videos = (data.videos || []).map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", objectUrl: null, localOnly: !!v.localOnly };
      });
      persist();
    } catch (err) { /* ignore */ }
  }

  function persist() {
    if (state.profile) {
      state.profile.photo = state.photo || null;
      state.profile.partnerId = state.partnerId || null;
    }
    var payload = {
      levelId: state.levelId,
      profile: state.profile,
      answers: state.answers,
      videos: state.videos.map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", localOnly: !v.link };
      })
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (state.profile && state.levelId) upsertSelf();
  }

  function upsertSelf() {
    PadelDB.upsert({
      id: state.profile.id,
      name: state.profile.name,
      gender: state.profile.gender,
      age: Number(state.profile.age),
      hand: state.profile.hand,
      side: state.profile.side,
      competitor: state.profile.competitor,
      hasPartner: state.profile.hasPartner,
      partnerId: state.partnerId || null,
      region: state.profile.region || "",
      courts: state.profile.courts || [],
      frequency: state.profile.frequency || "",
      tenure: state.profile.tenure || "",
      style: state.profile.style || "",
      shots: state.profile.shots || [],
      playtomic: state.profile.playtomic || "",
      association: state.profile.association || "",
      phone: state.profile.phone || "",
      hidePhone: !!state.profile.hidePhone,
      levelId: state.levelId,
      score: PadelQuiz.totalScore(state.answers),
      photo: state.photo || null,
      videos: state.videos.map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "" };
      }).filter(function (v) { return v.link; })
    });
  }

  function toBase64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(str) {
    var pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
    var b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function compactPlayer(src, includePhoto) {
    var p = src.profile || src;
    var videos = src.videos || [];
    var data = {
      id: p.id || src.id,
      n: p.name,
      g: p.gender,
      a: Number(p.age),
      h: p.hand,
      s: p.side,
      c: p.competitor,
      lv: src.levelId || p.levelId,
      sc: src.score || 0,
      v: videos.map(function (v) { return v.link; }).filter(Boolean)
    };
    var photo = p.photo || src.photo || null;
    if (includePhoto && photo && photo.length <= PHOTO_SHARE_MAX) data.ph = photo;
    data.hp = p.hasPartner || "no";
    var partner = null;
    if (p.partnerId) partner = PadelDB.findById(p.partnerId);
    if (!partner && src.partnerName) {
      data.pn = src.partnerName;
      data.pl = src.partnerLevel || "";
    } else if (partner) {
      data.pn = partner.name;
      data.pl = partner.levelId;
    }
    if (p.region) data.z = p.region;
    if (p.courts && p.courts.length) data.ct = p.courts;
    if (p.frequency) data.f = p.frequency;
    if (p.tenure) data.t = p.tenure;
    if (p.style) data.st = p.style;
    if (p.shots && p.shots.length) data.sk = p.shots;
    if (p.playtomic) data.ptm = p.playtomic;
    if (p.association) data.as = p.association;
    if (p.phone) {
      data.tel = p.phone;
      if (p.hidePhone) data.hd = 1;
    }
    return data;
  }

  function expandPlayer(raw) {
    var level = PadelQuiz.levelById(raw.lv);
    if (!level || !raw.n) throw new Error("כרטיס לא תקין");
    return {
      id: raw.id,
      profile: {
        id: raw.id,
        name: raw.n,
        gender: raw.g,
        age: raw.a,
        hand: raw.h,
        side: raw.s,
        competitor: raw.c,
        hasPartner: raw.hp || "no",
        partnerName: raw.pn || "",
        partnerLevel: raw.pl || "",
        photo: raw.ph || null,
        region: raw.z || "",
        courts: raw.ct || [],
        frequency: raw.f || "",
        tenure: raw.t || "",
        style: raw.st || "",
        shots: raw.sk || [],
        playtomic: raw.ptm || "",
        association: raw.as || "",
        phone: raw.tel || "",
        hidePhone: !!raw.hd
      },
      levelId: raw.lv,
      score: raw.sc || 0,
      photo: raw.ph || null,
      videos: (raw.v || []).map(function (link, i) {
        return { id: "link-" + i, name: "סרטון " + (i + 1), link: link, objectUrl: null };
      })
    };
  }

  function currentCardData() {
    return {
      id: state.profile.id,
      profile: Object.assign({}, state.profile, { photo: state.photo }),
      levelId: state.levelId,
      score: PadelQuiz.totalScore(state.answers),
      photo: state.photo,
      videos: state.videos
    };
  }

  function linkedPartner() {
    return state.partnerId ? PadelDB.findById(state.partnerId) : null;
  }

  function partnerAsCard(p) {
    if (!p) return null;
    return {
      id: p.id,
      profile: {
        id: p.id,
        name: p.name,
        gender: p.gender,
        age: p.age,
        hand: p.hand,
        side: p.side,
        competitor: p.competitor,
        photo: p.photo || null,
        region: p.region || "",
        courts: p.courts || [],
        frequency: p.frequency || "",
        tenure: p.tenure || "",
        style: p.style || "",
        shots: p.shots || [],
        playtomic: p.playtomic || "",
        association: p.association || "",
        phone: p.phone || "",
        hidePhone: !!p.hidePhone
      },
      levelId: p.levelId,
      score: p.score || 0,
      photo: p.photo || null,
      videos: p.videos || []
    };
  }

  function urlFromHash(path, data) {
    return location.origin + location.pathname + "#/" + path + "/" + toBase64Url(JSON.stringify(data));
  }

  function singleShareUrl(card) {
    return urlFromHash("p", compactPlayer(card || currentCardData(), true));
  }

  function pairShareUrl(a, b) {
    var ca = compactPlayer(a, true);
    var cb = compactPlayer(b, true);
    // If the combined payload is too large for a practical link, drop photos.
    var trial = toBase64Url(JSON.stringify({ a: ca, b: cb }));
    if (trial.length > 28000) {
      ca = compactPlayer(a, false);
      cb = compactPlayer(b, false);
    }
    return urlFromHash("pair", { a: ca, b: cb });
  }

  function parseRoute() {
    var hash = (location.hash || "#/").replace(/^#/, "");
    var parts = hash.split("/").filter(Boolean);
    state.publicCard = null;
    state.publicPair = null;

    if (parts[0] === "demo") {
      if (parts[1] === "pair") {
        var pa = PadelDB.findById("seed-michal");
        var pb = PadelDB.findById("seed-alon");
        if (pa && pb) {
          state.publicPair = { a: partnerAsCard(pa), b: partnerAsCard(pb) };
          state.view = "pair";
          return;
        }
      } else if (parts[1]) {
        var demoId = parts[1].indexOf("seed-") === 0 ? parts[1] : "seed-" + parts[1];
        var demo = PadelDB.findById(demoId);
        if (demo) {
          state.publicCard = partnerAsCard(demo);
          state.view = "card";
          return;
        }
        showToast("כרטיס הדוגמה לא נמצא");
      }
    }

    if (parts[0] === "p" && parts[1]) {
      try {
        state.publicCard = expandPlayer(JSON.parse(fromBase64Url(parts[1])));
        state.view = "card";
        return;
      } catch (err) {
        console.warn(err);
        showToast("קישור הכרטיס אינו תקין");
      }
    }

    if (parts[0] === "pair") {
      if (parts[1]) {
        try {
          var raw = JSON.parse(fromBase64Url(parts[1]));
          state.publicPair = { a: expandPlayer(raw.a), b: expandPlayer(raw.b) };
          state.view = "pair";
          return;
        } catch (err) {
          console.warn(err);
          showToast("קישור הזוג אינו תקין");
        }
      } else if (state.profile && state.levelId && linkedPartner()) {
        state.view = "pair";
        return;
      } else {
        state.view = state.profile ? "card" : "home";
        return;
      }
    }

    var route = parts[0] || "home";
    var allowed = { home: 1, quiz: 1, result: 1, profile: 1, card: 1, pair: 1, share: 1 };
    if (route === "result" && !state.levelId) { state.view = "quiz"; return; }
    if (route === "profile" && !state.levelId) { state.view = "quiz"; return; }
    if ((route === "card" || route === "share" || route === "pair") && (!state.profile || !state.levelId)) {
      state.view = state.levelId ? "profile" : "home";
      return;
    }
    if (route === "share" && !state.profile) { state.view = "home"; return; }
    state.view = allowed[route] ? route : "home";
  }

  function go(view) {
    if (view === "home") location.hash = "#/";
    else location.hash = "#/" + view;
  }

  function showToast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function initials(name) {
    return (name || "ש")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(function (p) { return p[0]; })
      .join("");
  }

  const LABELS = {
    gender: { male: "גבר", female: "אישה", other: "מעדיף/ה לא לציין" },
    hand: { right: "ימין", left: "שמאל" },
    side: { right: "ימין", left: "שמאל", either: "לא משנה לי" },
    competitor: { yes: "כן", no: "לא" },
    region: {
      north: "צפון", haifa: "חיפה והקריות", sharon: "שרון", center: "מרכז",
      telaviv: "תל אביב", shfela: "שפלה", jerusalem: "ירושלים", south: "דרום"
    },
    frequency: { weekly: "פעם בשבוע", "2-3": "2–3 בשבוע", "4plus": "4+ בשבוע" },
    tenure: { under1: "פחות משנה", "1-2": "1–2 שנים", "3-5": "3–5 שנים", "5plus": "5+ שנים" },
    style: { competitive: "תחרותי", social: "חברתי", both: "גם וגם" },
    shots: {
      bandeja: "בנדחה", vibora: "ויבורה", smash: "סמאש", volley: "וולה/רשת",
      lob: "לוב", walls: "משחק קירות", defense: "הגנה"
    }
  };

  function checkedValues(name) {
    return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (el) {
      return el.value;
    });
  }

  function setChecked(name, values) {
    var set = {};
    (values || []).forEach(function (v) { set[v] = true; });
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (el) {
      el.checked = !!set[el.value];
    });
  }

  function digitsPhone(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function formatPhone(phone) {
    var d = digitsPhone(phone);
    if (d.length === 10 && d.charAt(0) === "0") return d.slice(0, 3) + "-" + d.slice(3, 6) + "-" + d.slice(6);
    if (d.length === 12 && d.indexOf("972") === 0) return "0" + d.slice(3, 5) + "-" + d.slice(5, 8) + "-" + d.slice(8);
    return phone || "";
  }

  function waNumber(phone) {
    var d = digitsPhone(phone);
    if (!d) return "";
    if (d.indexOf("972") === 0) return d;
    if (d.charAt(0) === "0") return "972" + d.slice(1);
    return d;
  }

  function renderCourtList() {
    var box = $("court-list");
    box.innerHTML = "";
    (state.courts || []).forEach(function (name, i) {
      var tag = document.createElement("span");
      tag.className = "tag";
      tag.appendChild(document.createTextNode(name));
      var rm = document.createElement("button");
      rm.type = "button";
      rm.className = "text-btn";
      rm.textContent = "×";
      rm.setAttribute("aria-label", "הסרת " + name);
      rm.addEventListener("click", function () {
        state.courts.splice(i, 1);
        renderCourtList();
      });
      tag.appendChild(rm);
      box.appendChild(tag);
    });
  }

  function addCourt() {
    var input = $("court-input");
    var name = (input.value || "").trim();
    if (!name) return;
    state.courts = state.courts || [];
    if (state.courts.indexOf(name) !== -1) { input.value = ""; return; }
    if (state.courts.length >= 6) return showToast("אפשר עד שישה מגרשים");
    state.courts.push(name);
    input.value = "";
    renderCourtList();
  }

  function pill(label, value) {
    if (!value) return "";
    return '<span class="pill"><em>' + escapeHtml(label) + "</em> " + escapeHtml(value) + "</span>";
  }

  function extrasHtml(p, compact) {
    var html = "";
    var pills = [];
    if (p.region && LABELS.region[p.region]) pills.push(pill("אזור", LABELS.region[p.region]));
    if (p.frequency && LABELS.frequency[p.frequency]) pills.push(pill("תדירות", LABELS.frequency[p.frequency]));
    if (p.tenure && LABELS.tenure[p.tenure]) pills.push(pill("ותק", LABELS.tenure[p.tenure]));
    if (p.style && LABELS.style[p.style]) pills.push(pill("סגנון", LABELS.style[p.style]));
    if (pills.length) html += '<div class="pill-row">' + pills.join("") + "</div>";
    if (p.courts && p.courts.length) {
      html += '<p class="extra-line">מגרשים: <b>' + p.courts.map(escapeHtml).join(" · ") + "</b></p>";
    }
    var shots = (p.shots || []).map(function (k) { return LABELS.shots[k]; }).filter(Boolean);
    if (shots.length) {
      html += '<div class="shot-pills">' + shots.map(function (s) {
        return '<span class="pill">' + escapeHtml(s) + "</span>";
      }).join("") + "</div>";
    }
    var ratings = [];
    if (p.playtomic) ratings.push("Playtomic " + p.playtomic);
    if (p.association) ratings.push("איגוד " + p.association);
    if (ratings.length) html += '<p class="extra-line"><b>' + escapeHtml(ratings.join(" · ")) + "</b></p>";
    return html;
  }

  function fillContactBox(el, p, isPublic) {
    if (!p.phone) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }
    var wa = waNumber(p.phone);
    if (!wa) { el.classList.add("hidden"); el.innerHTML = ""; return; }
    el.classList.remove("hidden");
    var showNumber = !p.hidePhone || !isPublic;
    var html = "";
    if (showNumber) html += '<div class="phone-num">' + escapeHtml(formatPhone(p.phone)) + "</div>";
    else html += '<div class="extra-line">המספר מוסתר · אפשר לפנות בוואטסאפ</div>';
    if (p.hidePhone && !isPublic) html += '<div class="extra-line">המספר יוסתר בכרטיס הציבורי</div>';
    html += '<a class="btn btn-whatsapp btn-contact" href="https://wa.me/' + wa + '" target="_blank" rel="noopener noreferrer">פנייה בוואטסאפ</a>';
    el.innerHTML = html;
  }

  function appendContactTo(parent, p, isPublic) {
    if (!p.phone || !waNumber(p.phone)) return;
    var box = document.createElement("div");
    box.className = "contact-box";
    fillContactBox(box, p, isPublic);
    parent.appendChild(box);
  }

  function setAvatar(elAvatar, elImg, elInitials, name, photo) {
    elInitials.textContent = initials(name);
    if (photo) {
      elImg.src = photo;
      elImg.alt = name || "";
      elImg.classList.remove("hidden");
      elAvatar.classList.add("has-photo");
    } else {
      elImg.removeAttribute("src");
      elImg.classList.add("hidden");
      elAvatar.classList.remove("has-photo");
    }
  }

  function renderHome() {
    var hasCard = !!(state.profile && state.levelId);
    $("home-cta-label").textContent = hasCard ? "קביעת רמה מחדש" : "קביעת רמה והקמת כרטיס";
    $("home-card-btn").classList.toggle("hidden", !hasCard);
  }

  function renderQuiz() {
    var q = PadelQuiz.QUESTIONS[state.quizIndex];
    var total = PadelQuiz.QUESTIONS.length;
    $("quiz-step").textContent = "שאלה " + (state.quizIndex + 1) + " מתוך " + total;
    $("quiz-progress").style.width = ((state.quizIndex / total) * 100) + "%";
    $("question-text").textContent = q.text;
    var hint = $("question-hint");
    if (q.hint) {
      hint.textContent = q.hint;
      hint.classList.remove("hidden");
    } else {
      hint.classList.add("hidden");
    }
    var box = $("options");
    box.innerHTML = "";
    q.options.forEach(function (opt, i) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option" + (state.answers[state.quizIndex] === i ? " selected" : "");
      btn.textContent = opt.label;
      btn.addEventListener("click", function () { chooseAnswer(i); });
      box.appendChild(btn);
    });
    $("quiz-back").classList.toggle("hidden", state.quizIndex === 0);
  }

  function chooseAnswer(index) {
    state.answers[state.quizIndex] = index;
    renderQuiz();
    setTimeout(function () {
      if (state.quizIndex < PadelQuiz.QUESTIONS.length - 1) {
        state.quizIndex += 1;
        renderQuiz();
      } else {
        finishQuiz();
      }
    }, 180);
  }

  function finishQuiz() {
    var score = PadelQuiz.totalScore(state.answers);
    var level = PadelQuiz.levelFromScore(score);
    state.levelId = level.id;
    persist();
    go("result");
  }

  function renderResult() {
    var level = PadelQuiz.levelById(state.levelId);
    var score = PadelQuiz.totalScore(state.answers);
    $("result-badge").className = "result-badge level-" + level.id;
    $("result-letter").textContent = level.id;
    $("result-numeric").textContent = "רמה " + level.numeric;
    $("result-title").textContent = level.title;
    $("result-blurb").textContent = level.blurb;
    $("result-score").textContent = "ציון השאלון: " + score + " מתוך " + PadelQuiz.maxScore;
    $("goto-profile").textContent = state.profile ? "עדכון הכרטיס עם הרמה החדשה" : "המשיכו למילוי הכרטיס";
  }

  function fillProfileForm() {
    var p = state.profile || {};
    $("name").value = p.name || "";
    $("age").value = p.age || "";
    setSeg("gender", p.gender || "");
    setSeg("hand", p.hand || "");
    setSeg("side", p.side || "");
    setSeg("competitor", p.competitor || "");
    setSeg("hasPartner", p.hasPartner || "");
    $("region").value = p.region || "";
    setSeg("frequency", p.frequency || "");
    setSeg("tenure", p.tenure || "");
    setSeg("style", p.style || "");
    setChecked("shots", p.shots || []);
    $("playtomic").value = p.playtomic || "";
    $("association").value = p.association || "";
    $("phone").value = p.phone || "";
    $("hide-phone").checked = !!p.hidePhone;
    state.courts = (p.courts || []).slice();
    renderCourtList();
    $("video-link").value = "";
    renderPhotoPreview();
    togglePartnerSearch();
    renderSelectedPartner();
    renderSearchResults($("partner-query").value);
    renderVideoList("video-list", state.videos, true);
  }

  function renderPhotoPreview() {
    var img = $("photo-img");
    var box = $("photo-preview");
    if (state.photo) {
      img.src = state.photo;
      img.classList.remove("hidden");
      box.classList.add("has-photo");
      $("photo-remove").classList.remove("hidden");
    } else {
      img.removeAttribute("src");
      img.classList.add("hidden");
      box.classList.remove("has-photo");
      $("photo-remove").classList.add("hidden");
    }
  }

  function togglePartnerSearch() {
    var yes = segValue("hasPartner") === "yes";
    $("partner-search-wrap").classList.toggle("hidden", !yes);
    if (yes && !$("partner-query").value) renderSearchResults("");
  }

  function renderSelectedPartner() {
    var box = $("partner-selected");
    var p = linkedPartner();
    if (!p || segValue("hasPartner") !== "yes") {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = partnerChipHtml(p, true);
    var rm = box.querySelector("[data-clear-partner]");
    if (rm) {
      rm.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        state.partnerId = null;
        renderSelectedPartner();
        renderSearchResults($("partner-query").value);
      });
    }
  }

  function partnerChipHtml(p, withClear) {
    var level = PadelQuiz.levelById(p.levelId);
    var photo = p.photo
      ? '<span class="chip-photo"><img src="' + p.photo + '" alt=""></span>'
      : '<span class="chip-photo">' + initials(p.name) + "</span>";
    var clear = withClear ? '<button type="button" class="text-btn" data-clear-partner>הסרה</button>' : "";
    return photo +
      '<span class="chip-info"><strong>' + escapeHtml(p.name) + "</strong><span>" +
      (level ? level.id + " · " : "") +
      "יד " + (LABELS.hand[p.hand] || "") +
      " · צד " + (LABELS.side[p.side] || "") +
      "</span></span>" + clear;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function renderSearchResults(query) {
    var box = $("partner-results");
    if (segValue("hasPartner") !== "yes") { box.innerHTML = ""; return; }
    var exclude = state.profile && state.profile.id;
    var hits = PadelDB.searchByName(query, exclude).filter(function (p) {
      return p.id !== state.partnerId;
    }).slice(0, 8);
    if (!hits.length) {
      if (state.partnerId) { box.innerHTML = ""; return; }
      box.innerHTML = '<p class="note">לא נמצא במאגר. אפשר לחפש את שחקני הדוגמה, או כרטיס שנוצר במכשיר הזה.</p>';
      return;
    }
    box.innerHTML = "";
    hits.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "player-hit" + (p.id === state.partnerId ? " selected" : "");
      var level = PadelQuiz.levelById(p.levelId);
      var photo = p.photo
        ? '<span class="hit-photo"><img src="' + p.photo + '" alt=""></span>'
        : '<span class="hit-photo">' + initials(p.name) + "</span>";
      btn.innerHTML = photo +
        '<span class="hit-info"><strong>' + escapeHtml(p.name) + "</strong><span>" +
        "יד " + (LABELS.hand[p.hand] || "—") +
        " · צד " + (LABELS.side[p.side] || "—") +
        "</span></span>" +
        '<span class="hit-level">' + (level ? level.id : "") + "</span>";
      btn.addEventListener("click", function () {
        state.partnerId = p.id;
        renderSelectedPartner();
        renderSearchResults(query);
      });
      box.appendChild(btn);
    });
  }

  function setSeg(name, value) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (el) {
      el.checked = el.value === value;
    });
  }

  function segValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  }

  function renderVideoList(targetId, videos, editable) {
    var box = $(targetId);
    if (!videos || !videos.length) { box.innerHTML = ""; return; }
    box.innerHTML = "";
    videos.forEach(function (v) {
      var item = document.createElement("div");
      item.className = "video-item";
      if (v.objectUrl) {
        var vid = document.createElement("video");
        vid.controls = true;
        vid.preload = "metadata";
        vid.src = v.objectUrl;
        item.appendChild(vid);
      } else if (v.link) {
        var a = document.createElement("a");
        a.className = "link-row";
        a.href = v.link;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = v.link;
        item.appendChild(a);
      }
      var meta = document.createElement("div");
      meta.className = "meta";
      var label = document.createElement("span");
      label.textContent = v.name + (v.link ? "" : " · נשמר במכשיר זה בלבד");
      meta.appendChild(label);
      if (editable) {
        var rm = document.createElement("button");
        rm.type = "button";
        rm.className = "text-btn";
        rm.textContent = "הסרה";
        rm.addEventListener("click", function () {
          if (v.objectUrl) URL.revokeObjectURL(v.objectUrl);
          state.videos = state.videos.filter(function (x) { return x.id !== v.id; });
          persist();
          renderVideoList("video-list", state.videos, true);
        });
        meta.appendChild(rm);
      }
      item.appendChild(meta);
      box.appendChild(item);
    });
  }

  function addVideoFiles(files) {
    Array.from(files || []).slice(0, 3).forEach(function (file) {
      if (!file.type.startsWith("video/")) return;
      var id = "vid-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      var objectUrl = URL.createObjectURL(file);
      videoBlobs.set(id, file);
      state.videos.push({ id: id, name: file.name, objectUrl: objectUrl, link: "", localOnly: true });
    });
    persist();
    renderVideoList("video-list", state.videos, true);
  }

  function addVideoLink() {
    var input = $("video-link");
    var url = (input.value || "").trim();
    if (!url) return;
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      url = parsed.href;
    } catch (err) {
      showToast("הזינו קישור תקין שמתחיל ב-https");
      return;
    }
    state.videos.push({ id: "link-" + Date.now(), name: "קישור לסרטון", link: url, objectUrl: null });
    input.value = "";
    persist();
    renderVideoList("video-list", state.videos, true);
  }

  function compressPhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("not-image"));
        return;
      }
      var img = new Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        var side = Math.min(img.width, img.height) || 1;
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;
        var canvas = document.createElement("canvas");
        var max = 220;
        canvas.width = max;
        canvas.height = max;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, side, side, 0, 0, max, max);
        URL.revokeObjectURL(objectUrl);
        var qualities = [0.62, 0.5, 0.4, 0.3];
        var data = canvas.toDataURL("image/jpeg", qualities[0]);
        for (var i = 1; i < qualities.length && data.length > PHOTO_SHARE_MAX; i++) {
          data = canvas.toDataURL("image/jpeg", qualities[i]);
        }
        resolve(data);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("load"));
      };
      img.src = objectUrl;
    });
  }

  function onPhotoSelected(file) {
    compressPhoto(file).then(function (data) {
      state.photo = data;
      renderPhotoPreview();
      showToast(data.length > PHOTO_SHARE_MAX ? "התמונה נשמרה, אבל בקישור יוצגו ראשי תיבות" : "התמונה נוספה");
    }).catch(function () {
      showToast("לא ניתן לקרוא את התמונה");
    });
  }

  function saveProfile(ev) {
    ev.preventDefault();
    var profile = {
      id: (state.profile && state.profile.id) || uid(),
      name: $("name").value.trim(),
      age: $("age").value,
      gender: segValue("gender"),
      hand: segValue("hand"),
      side: segValue("side"),
      competitor: segValue("competitor"),
      hasPartner: segValue("hasPartner"),
      partnerId: null,
      photo: state.photo || null,
      region: $("region").value || "",
      courts: (state.courts || []).slice(),
      frequency: segValue("frequency"),
      tenure: segValue("tenure"),
      style: segValue("style"),
      shots: checkedValues("shots"),
      playtomic: $("playtomic").value.trim(),
      association: $("association").value.trim(),
      phone: $("phone").value.trim(),
      hidePhone: $("hide-phone").checked
    };
    if (!profile.name) return showToast("חסר שם");
    if (!profile.age || Number(profile.age) < 10 || Number(profile.age) > 99) return showToast("גיל לא תקין");
    if (!profile.gender || !profile.hand || !profile.side || !profile.competitor || !profile.hasPartner) {
      return showToast("נא למלא את כל השדות");
    }
    if (profile.phone && !waNumber(profile.phone)) {
      return showToast("מספר הטלפון אינו תקין");
    }
    if (profile.hasPartner === "yes") {
      if (!state.partnerId || !PadelDB.findById(state.partnerId)) {
        return showToast("בחרו פרטנר מהמאגר, או סמנו שאין פרטנר קבוע");
      }
      profile.partnerId = state.partnerId;
    } else {
      state.partnerId = null;
    }
    state.profile = profile;
    persist();
    go("card");
  }


  function photoSrc(photo) {
    return photo || "";
  }

  function ico(kind) {
    var paths = {
      hand: '<path d="M8 13v-2a2 2 0 1 1 4 0v2M12 13V8a2 2 0 1 1 4 0v5M16 13v-3a2 2 0 1 1 4 0v6a6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6v-3a2 2 0 1 1 4 0v1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      side: '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 5v14M4 12h16" fill="none" stroke="currentColor" stroke-width="1.6"/>',
      trophy: '<path d="M8 5h8v3a4 4 0 0 1-8 0V5Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 12v3M9 19h6M10 19l1-4h2l1 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      style: '<path d="M12 4 14 9l5 .5-3.8 3.3L16.5 18 12 15.2 7.5 18l1.3-5.2L5 9.5 10 9Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
      freq: '<rect x="4" y="6" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M8 4v4M16 4v4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      years: '<circle cx="12" cy="13" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 9v4l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
      pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/>',
      partner: '<path d="M9 13a3 3 0 1 0-3-3 3 3 0 0 0 3 3ZM15 13a3 3 0 1 0-1-.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M15 20a5.5 5.5 0 0 1 5.5 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'
    };
    return '<span class="ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[kind] || paths.style) + "</svg></span>";
  }

  function statCell(kind, label, value) {
    if (!value) return "";
    return '<div class="ut-stat">' + ico(kind) + '<span><span class="k">' + escapeHtml(label) + '</span><span class="v">' + escapeHtml(value) + "</span></span></div>";
  }

  function badgeClass(levelId) {
    var band = (levelId || "C").charAt(0);
    return "ut-badge band-" + band;
  }

  function createPremiumCard(card, opts) {
    opts = opts || {};
    var p = card.profile;
    var level = PadelQuiz.levelById(card.levelId) || { id: card.levelId, title: "", numeric: "" };
    var photo = photoSrc(card.photo || p.photo);
    var partner = opts.partner;
    var partnerName = partner ? partner.name : (p.partnerName || "");
    var art = document.createElement("article");
    art.className = "ut-card" + (opts.compact ? " compact" : "");

    var identity = [];
    if (p.age) identity.push(String(p.age));
    if (p.region && LABELS.region[p.region]) identity.push(LABELS.region[p.region]);
    if (LABELS.gender[p.gender]) identity.push(LABELS.gender[p.gender]);

    var stats = [
      statCell("hand", "יד חזקה", LABELS.hand[p.hand]),
      statCell("side", "העדפת צד", LABELS.side[p.side]),
      statCell("trophy", "מתחרה", LABELS.competitor[p.competitor]),
      statCell("style", "סגנון", LABELS.style[p.style]),
      statCell("freq", "תדירות", LABELS.frequency[p.frequency]),
      statCell("years", "ותק", LABELS.tenure[p.tenure])
    ];
    if (partnerName) stats.push(statCell("partner", "פרטנר קבוע", partnerName));

    var shots = (p.shots || []).map(function (k) { return LABELS.shots[k]; }).filter(Boolean);
    var shotsHtml = shots.length
      ? '<p class="ut-section">מכה חזקה</p><div class="ut-shots">' + shots.map(function (s) {
          return '<span class="pill">' + escapeHtml(s) + "</span>";
        }).join("") + "</div>"
      : "";

    var rates = "";
    if (p.playtomic || p.association) {
      rates = '<div class="ut-ratings">';
      if (p.playtomic) rates += '<div class="ut-rate"><span class="rk">Playtomic</span><span class="rv">' + escapeHtml(p.playtomic) + "</span></div>";
      if (p.association) rates += '<div class="ut-rate"><span class="rk">דירוג איגוד</span><span class="rv">' + escapeHtml(p.association) + "</span></div>";
      rates += "</div>";
    }

    var phoneLine = (p.phone && !p.hidePhone)
      ? '<p class="ut-phone-line">' + escapeHtml(formatPhone(p.phone)) + "</p>"
      : "";
    var courts = (p.courts && p.courts.length)
      ? '<p class="ut-line">מגרשים קבועים: <b>' + p.courts.map(escapeHtml).join(" · ") + "</b></p>"
      : "";

    var partnerHtml = "";
    if (partner) {
      partnerHtml = '<p class="ut-section">פרטנר קבוע</p><div class="partner-chip ut-partner">' + partnerChipHtml(partner, false) + "</div>";
    } else if (p.partnerName) {
      partnerHtml = '<p class="ut-section">פרטנר קבוע</p><div class="partner-chip ut-partner">' + partnerChipHtml({
        name: p.partnerName, levelId: p.partnerLevel || "", hand: "", side: "", photo: null
      }, false) + "</div>";
    }

    var videos = card.videos || [];
    var vidHtml = '<p class="ut-section">סרטוני משחק</p>';
    if (videos.length) {
      vidHtml += '<div class="video-list">';
      videos.forEach(function (v) {
        if (v.link) {
          vidHtml += '<div class="video-item"><a class="link-row" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(v.link) + "</a></div>";
        } else if (v.objectUrl) {
          vidHtml += '<div class="video-item"><video controls preload="metadata" src="' + v.objectUrl + '"></video></div>';
        }
      });
      vidHtml += "</div>";
    } else if (!opts.compact) {
      vidHtml += '<p class="empty-videos">עדיין אין סרטונים בכרטיס.</p>';
    } else {
      vidHtml = "";
    }

    var wa = "";
    if (opts.compact && p.phone && waNumber(p.phone)) {
      wa = '<a class="ut-wa-mini" href="https://wa.me/' + waNumber(p.phone) + '" target="_blank" rel="noopener noreferrer">פנייה בוואטסאפ</a>';
    }

    art.innerHTML =
      '<div class="ut-hero' + (photo ? " has-photo" : "") + '">' +
        (photo ? '<img class="ut-hero-img" alt="' + escapeHtml(p.name) + '" src="' + photo + '">' : "") +
        '<div class="ut-hero-fallback">' + escapeHtml(initials(p.name)) + "</div>" +
        '<div class="ut-hero-shade"></div>' +
        '<div class="ut-hero-content">' +
          '<div class="ut-id"><h1>' + escapeHtml(p.name) + "</h1><p>" + escapeHtml(identity.join(" · ")) + "</p></div>" +
          '<div class="' + badgeClass(level.id) + '"><b>' + escapeHtml(level.id) + "</b><span>" + escapeHtml(level.title) + "</span><em>רמה " + escapeHtml(level.numeric) + "</em></div>" +
        "</div>" +
      "</div>" +
      '<div class="ut-body">' +
        '<div class="ut-stats">' + stats.join("") + "</div>" +
        shotsHtml + rates + phoneLine + courts + partnerHtml + vidHtml + wa +
      "</div>";
    return art;
  }

  function setupDock(p, isPublic) {
    var dock = $("card-dock");
    if (!dock) return;
    var has = !!(p && p.phone && waNumber(p.phone) && isPublic);
    dock.classList.toggle("hidden", !has);
    document.body.classList.toggle("has-dock", has);
    if (!has) return;
    $("dock-wa").href = "https://wa.me/" + waNumber(p.phone);
    var showNum = !p.hidePhone;
    $("dock-phone").classList.add("hidden");
    $("dock-phone").textContent = "";
  }

  function renderCard() {
    var isPublic = !!state.publicCard;
    var data = isPublic ? state.publicCard : currentCardData();
    var partner = isPublic ? null : linkedPartner();
    $("owner-actions").classList.toggle("hidden", isPublic);
    $("open-pair").classList.toggle("hidden", isPublic || !partner);
    var root = $("card-root");
    root.innerHTML = "";
    root.appendChild(createPremiumCard(data, { compact: false, partner: partner }));
    setupDock(data.profile, isPublic);
  }

  function renderPairColumn(card) {
    return createPremiumCard(card, { compact: true, partner: null });
  }

  function renderPair() {
    var isPublic = !!state.publicPair;
    var a, b;
    if (isPublic) {
      a = state.publicPair.a;
      b = state.publicPair.b;
    } else {
      a = currentCardData();
      b = partnerAsCard(linkedPartner());
      if (!b) { go("card"); return; }
    }
    var summary = PadelDB.pairSummary(a, b);
    $("pair-owner-actions").classList.toggle("hidden", isPublic);
    setupDock(null, false);

    $("pair-level-chip").className = badgeClass(summary.letter);
    $("pair-level-letter").textContent = summary.letter;
    $("pair-level-num").textContent = summary.numeric;
    $("pair-title").textContent = summary.title;
    $("pair-names").textContent = a.profile.name + " · " + a.levelId + "  +  " + b.profile.name + " · " + b.levelId;
    $("pair-blurb").textContent = summary.blurb;
    var flags = $("pair-flags");
    flags.innerHTML = "";
    [summary.gap, summary.sideText, summary.handText].forEach(function (t) {
      var li = document.createElement("li");
      if (!summary.sidesFit && t === summary.sideText) li.className = "warn";
      li.textContent = t;
      flags.appendChild(li);
    });
    var grid = $("pair-grid");
    grid.innerHTML = "";
    grid.appendChild(renderPairColumn(a));
    grid.appendChild(renderPairColumn(b));
  }

  function renderShare() {
    var me = currentCardData();
    var partner = linkedPartner();
    $("share-single-meta").textContent = me.profile.name + " · " + me.levelId;
    if (partner) {
      var sum = PadelDB.pairSummary(me, partnerAsCard(partner));
      $("share-opt-pair").classList.remove("hidden");
      $("share-pair-meta").textContent = me.profile.name + " ו" + partner.name + " · רמת זוג " + sum.letter;
      if (state.shareMode !== "single" && state.shareMode !== "pair") state.shareMode = "pair";
    } else {
      $("share-opt-pair").classList.add("hidden");
      state.shareMode = "single";
    }
    $("share-opt-single").classList.toggle("selected", state.shareMode === "single");
    $("share-opt-pair").classList.toggle("selected", state.shareMode === "pair");
    $("share-url").textContent = currentShareUrl();
  }

  function currentShareUrl() {
    if (state.publicPair) return location.origin + location.pathname + location.hash;
    if (state.publicCard) return location.origin + location.pathname + location.hash;
    if (state.shareMode === "pair" && linkedPartner()) {
      return pairShareUrl(currentCardData(), partnerAsCard(linkedPartner()));
    }
    return singleShareUrl();
  }

  function shareMessage(url) {
    if (state.view === "pair" || (state.view === "share" && state.shareMode === "pair")) {
      var a = state.publicPair ? state.publicPair.a : currentCardData();
      var b = state.publicPair ? state.publicPair.b : partnerAsCard(linkedPartner());
      if (a && b) {
        var s = PadelDB.pairSummary(a, b);
        return "היי, זה כרטיס הזוג שלנו בפאדל — " + a.profile.name + " (" + a.levelId + ") ו" + b.profile.name + " (" + b.levelId + "), רמת זוג " + s.letter + "\n" + url;
      }
    }
    var data = state.publicCard || currentCardData();
    return "היי, זה כרטיס השחקן שלי בפאדל — רמה " + data.levelId + " (" + data.profile.name + ")\n" + url;
  }

  function copyText(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () {
        showToast("הקישור הועתק");
      }).catch(function () { fallbackCopy(url); });
    } else {
      fallbackCopy(url);
    }
  }

  function fallbackCopy(url) {
    var ta = document.createElement("textarea");
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); showToast("הקישור הועתק"); }
    catch (err) { showToast("לא ניתן להעתיק, העתיקו ידנית"); }
    ta.remove();
  }

  function sendWhatsApp(url) {
    location.href = "https://wa.me/?text=" + encodeURIComponent(shareMessage(url));
  }

  function render() {
    parseRoute();
    ["home", "quiz", "result", "profile", "card", "pair", "share"].forEach(function (name) {
      $("view-" + name).classList.toggle("hidden", state.view !== name);
    });
    if (state.view === "home") renderHome();
    if (state.view === "quiz") renderQuiz();
    if (state.view === "result") renderResult();
    if (state.view === "profile") fillProfileForm();
    if (state.view === "card") renderCard();
    if (state.view === "pair") renderPair();
    if (state.view === "share") renderShare();
    var showcase = state.view === "card" || state.view === "pair";
    document.body.classList.toggle("mode-showcase", showcase);
    if (state.view !== "card") {
      document.body.classList.remove("has-dock");
      if ($("card-dock")) $("card-dock").classList.add("hidden");
    }
    window.scrollTo(0, 0);
  }

  function startQuiz(reset) {
    if (reset) {
      state.quizIndex = 0;
      state.answers = [];
    } else if (!state.answers.length) {
      state.quizIndex = 0;
    }
    go("quiz");
  }

  function bind() {
    $("start-quiz").addEventListener("click", function () { startQuiz(true); });
    $("home-card-btn").addEventListener("click", function () { go("card"); });
    $("quiz-back").addEventListener("click", function () {
      if (state.quizIndex > 0) {
        state.quizIndex -= 1;
        renderQuiz();
      }
    });
    $("goto-profile").addEventListener("click", function () { go("profile"); });
    $("profile-form").addEventListener("submit", saveProfile);
    $("video-file").addEventListener("change", function (ev) {
      addVideoFiles(ev.target.files);
      ev.target.value = "";
    });
    $("add-link").addEventListener("click", addVideoLink);
    $("add-court").addEventListener("click", addCourt);
    $("court-input").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); addCourt(); }
    });
    $("photo-file").addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (file) onPhotoSelected(file);
    });
    $("photo-remove").addEventListener("click", function () {
      state.photo = null;
      renderPhotoPreview();
    });
    document.querySelectorAll('input[name="hasPartner"]').forEach(function (el) {
      el.addEventListener("change", function () {
        if (el.value === "no") state.partnerId = null;
        togglePartnerSearch();
        renderSelectedPartner();
      });
    });
    $("partner-query").addEventListener("input", function () {
      renderSearchResults(this.value);
    });
    $("open-share").addEventListener("click", function () {
      state.shareMode = linkedPartner() ? "pair" : "single";
      go("share");
    });
    $("open-pair").addEventListener("click", function () { go("pair"); });
    $("edit-profile").addEventListener("click", function () { go("profile"); });
    $("retake-quiz").addEventListener("click", function () { startQuiz(true); });
    $("share-opt-single").addEventListener("click", function () {
      state.shareMode = "single";
      renderShare();
    });
    $("share-opt-pair").addEventListener("click", function () {
      state.shareMode = "pair";
      renderShare();
    });
    $("share-wa").addEventListener("click", function () { sendWhatsApp(currentShareUrl()); });
    $("copy-link").addEventListener("click", function () { copyText(currentShareUrl()); });
    $("share-back").addEventListener("click", function () { go("card"); });
    $("pair-open-share").addEventListener("click", function () {
      state.shareMode = "pair";
      go("share");
    });
    $("pair-back-card").addEventListener("click", function () { go("card"); });
    window.addEventListener("hashchange", render);
  }

  loadSaved();
  bind();
  render();
})();
