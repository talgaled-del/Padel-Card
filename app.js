(function () {
  const STORAGE_KEY = "padelCard.v2";
  const PHOTO_SHARE_MAX = 18000;
  const videoBlobs = new Map();
  const CLOUDINARY = {
    cloudName: "jgreas8e",
    uploadPreset: "padel_card_videos",
    photoPreset: "padel_card_photos",
    maxVideos: 3,
    maxBytes: 100 * 1024 * 1024,
    maxDuration: 180,
    maxPhotoBytes: 40 * 1024 * 1024
  };

  const PHOTO_UPLOAD = {
    maxEdge: 2000,
    quality: 0.9,
    timeoutMs: 90000
  };

  const PHOTO_DISPLAY = {
    hero: { w: 1290, h: 1200 },
    heroCompact: { w: 1194, h: 780 },
    preview: { w: 384, h: 384 },
    thumb: { w: 192, h: 192 }
  };

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
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, objectUrl: null, localOnly: !!v.localOnly && !v.link };
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
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, objectUrl: null, localOnly: !!v.localOnly && !v.link };
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
      videos: state.videos.filter(function (v) { return !v.uploading; }).map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, localOnly: !v.link };
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
      levelId: state.levelId,
      score: PadelQuiz.totalScore(state.answers),
      photo: state.photo || null,
      videos: state.videos.map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0 };
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

  function isCloudinaryVideo(url) {
    return /res\.cloudinary\.com\/[^/]+\/video\/upload\//.test(url || "");
  }

  function isCloudinaryImage(url) {
    return /res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url || "");
  }

  function isRemotePhoto(photo) {
    return /^https?:\/\//i.test(photo || "");
  }

  function canEmbedPhotoInLink(photo) {
    if (!photo) return false;
    if (isRemotePhoto(photo)) return true;
    return photo.length <= PHOTO_SHARE_MAX;
  }

  function stripCloudinaryImageTransforms(url) {
    var marker = "/image/upload/";
    var i = (url || "").indexOf(marker);
    if (i < 0) return url;
    var rest = url.slice(i + marker.length);
    var parts = rest.split("/");
    if (parts[0] && /(?:^|,)(?:f_|q_|c_|g_|w_|h_|dpr_|so_|e_|fl_)/.test(parts[0])) {
      rest = parts.slice(1).join("/");
    }
    return url.slice(0, i + marker.length) + rest;
  }

  function cloudinaryImageUrl(url, kind) {
    if (!isCloudinaryImage(url)) return url;
    var size = PHOTO_DISPLAY[kind] || PHOTO_DISPLAY.hero;
    var t = "f_auto,q_auto,c_fill,g_face,w_" + size.w + ",h_" + size.h;
    var base = stripCloudinaryImageTransforms(url);
    var marker = "/image/upload/";
    var i = base.indexOf(marker);
    return base.slice(0, i + marker.length) + t + "/" + base.slice(i + marker.length);
  }

  function photoSrc(photo, kind) {
    if (!photo) return "";
    if (isCloudinaryImage(photo)) return cloudinaryImageUrl(photo, kind || "hero");
    return photo;
  }

  function photoImgTag(photo, kind, className, alt) {
    var src = photoSrc(photo, kind);
    if (!src) return "";
    var cls = (className || "") + (isCloudinaryImage(photo) ? " is-cloud" : "");
    return '<img class="' + cls.trim() + '" alt="' + escapeHtml(alt || "") + '" src="' + escapeHtml(src) + '">';
  }

  function posterFromCloudinary(url) {
    if (!isCloudinaryVideo(url)) return "";
    return url.replace("/video/upload/", "/video/upload/so_auto/").replace(/\.[a-z0-9]+(?=\?|$)/i, ".jpg");
  }

  function isDirectVideo(url) {
    if (!url) return false;
    if (isCloudinaryVideo(url)) return true;
    return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url);
  }

  function formatBytes(n) {
    if (!n) return "";
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + "KB";
    return (n / (1024 * 1024)).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + "MB";
  }

  function formatDuration(sec) {
    if (!sec || !isFinite(sec)) return "";
    var s = Math.round(sec);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  function videoTileHtml(v) {
    var src = v.link || v.objectUrl || "";
    var poster = v.poster || posterFromCloudinary(v.link || "");
    if (!src) return "";
    if (v.link && !isDirectVideo(v.link) && !v.objectUrl) {
      return '<div class="video-item"><a class="link-row" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(v.link) + "</a></div>";
    }
    return '<div class="ut-video-tile video-item" data-src="' + escapeHtml(src) + '"' +
      (poster ? ' data-poster="' + escapeHtml(poster) + '"' : "") + ">" +
      (poster ? '<img class="ut-video-poster" alt="" src="' + escapeHtml(poster) + '">' : '<div class="ut-video-poster ut-video-fallback"></div>') +
      '<button type="button" class="ut-play-btn" aria-label="ניגון סרטון"></button></div>';
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
      v: videos.map(function (v) {
        if (!v.link) return null;
        if (v.poster) return { u: v.link, p: v.poster };
        return v.link;
      }).filter(Boolean)
    };
    var photo = p.photo || src.photo || null;
    if (includePhoto && canEmbedPhotoInLink(photo)) data.ph = photo;
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
        shots: raw.sk || []
      },
      levelId: raw.lv,
      score: raw.sc || 0,
      photo: raw.ph || null,
      videos: (raw.v || []).map(function (item, i) {
        var link = typeof item === "string" ? item : (item && (item.u || item.link)) || "";
        var poster = typeof item === "object" && item ? (item.p || item.poster || "") : "";
        if (!poster) poster = posterFromCloudinary(link);
        return { id: "link-" + i, name: "סרטון " + (i + 1), link: link, poster: poster, objectUrl: null };
      }).filter(function (v) { return v.link; })
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
        shots: p.shots || []
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
    return html;
  }

  function setAvatar(elAvatar, elImg, elInitials, name, photo) {
    elInitials.textContent = initials(name);
    if (photo) {
      elImg.src = photoSrc(photo, "thumb");
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
      img.src = photoSrc(state.photo, "preview");
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
      ? '<span class="chip-photo">' + photoImgTag(p.photo, "thumb", "", p.name) + "</span>"
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
        ? '<span class="hit-photo">' + photoImgTag(p.photo, "thumb", "", p.name) + "</span>"
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
    if (!box) return;
    if (!videos || !videos.length) { box.innerHTML = ""; return; }
    box.innerHTML = "";
    videos.forEach(function (v) {
      var wrap = document.createElement("div");
      wrap.className = "video-item-wrap";
      if (v.uploading) {
        wrap.innerHTML = '<div class="video-item is-uploading"><div class="ut-video-poster ut-video-fallback"></div></div>';
      } else {
        wrap.innerHTML = videoTileHtml(v);
      }
      var meta = document.createElement("div");
      meta.className = "meta";
      var bits = [v.name || "סרטון"];
      if (v.uploading) bits = ["מעלה את " + (v.name || "הסרטון") + "…"];
      else {
        if (v.duration) bits.push(formatDuration(v.duration));
        if (v.bytes) bits.push(formatBytes(v.bytes));
        if (v.link && isCloudinaryVideo(v.link)) bits.push("נשמר בכרטיס");
      }
      var label = document.createElement("span");
      label.textContent = bits.join(" · ");
      meta.appendChild(label);
      if (editable && !v.uploading) {
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
      wrap.appendChild(meta);
      box.appendChild(wrap);
    });
  }

  function finishedVideoCount() {
    return state.videos.filter(function (v) { return !v.uploading; }).length;
  }

  function setUploadProgress(show, ratio, label) {
    var wrap = $("upload-progress");
    var bar = $("upload-progress-bar");
    var text = $("upload-progress-label");
    if (!wrap) return;
    wrap.classList.toggle("hidden", !show);
    if (bar) bar.style.width = Math.round((ratio || 0) * 100) + "%";
    if (text) text.textContent = label || "מעלה את הסרטון…";
  }

  function readVideoDuration(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var el = document.createElement("video");
      el.preload = "metadata";
      var done = false;
      var finish = function (fn, val) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        fn(val);
      };
      el.onloadedmetadata = function () { finish(resolve, el.duration); };
      el.onerror = function () { finish(reject, new Error("meta")); };
      setTimeout(function () { finish(reject, new Error("meta-timeout")); }, 8000);
      el.src = url;
    });
  }

  function uploadToCloudinary(file, onProgress, opts) {
    opts = opts || {};
    var resource = opts.resourceType || "video";
    var preset = opts.preset || CLOUDINARY.uploadPreset;
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", preset);
      var xhr = new XMLHttpRequest();
      xhr.open("POST", "https://api.cloudinary.com/v1_1/" + CLOUDINARY.cloudName + "/" + resource + "/upload");
      xhr.upload.onprogress = function (ev) {
        if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
      };
      xhr.timeout = opts.timeout || PHOTO_UPLOAD.timeoutMs;
      xhr.onload = function () {
        var json = null;
        try { json = JSON.parse(xhr.responseText); } catch (err) { reject(new Error("parse")); return; }
        if (xhr.status >= 200 && xhr.status < 300 && json && json.secure_url) resolve(json);
        else reject(new Error((json && json.error && json.error.message) || "upload"));
      };
      xhr.onerror = function () { reject(new Error("network")); };
      xhr.ontimeout = function () { reject(new Error("timeout")); };
      xhr.send(fd);
    });
  }

  function addVideoFiles(files) {
    var list = Array.from(files || []);
    if (!list.length) return;
    (function next(i) {
      if (i >= list.length) return;
      addOneVideoFile(list[i]).then(function () { next(i + 1); }, function () { next(i + 1); });
    })(0);
  }

  function addOneVideoFile(file) {
    if (!file) return Promise.resolve();
    if (finishedVideoCount() >= CLOUDINARY.maxVideos) {
      showToast("אפשר להוסיף עד 3 סרטונים לכרטיס");
      return Promise.resolve();
    }
    if (file.type && file.type.indexOf("video/") !== 0) {
      showToast("יש לבחור קובץ וידאו");
      return Promise.resolve();
    }
    if (file.size > CLOUDINARY.maxBytes) {
      showToast("הקובץ גדול מדי. הגודל המרבי הוא 100MB");
      return Promise.resolve();
    }
    return readVideoDuration(file).then(function (duration) {
      if (isFinite(duration) && duration > CLOUDINARY.maxDuration) {
        showToast("משך הסרטון ארוך מדי. המקסימום הוא 3 דקות");
        return;
      }
      return startCloudinaryUpload(file, duration);
    }, function () {
      showToast("לא ניתן לקרוא את משך הסרטון. נסו קובץ אחר");
    });
  }

  function startCloudinaryUpload(file, duration) {
    var id = "vid-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var temp = { id: id, name: file.name, uploading: true, progress: 0, duration: duration || 0, bytes: file.size, link: "", poster: "", objectUrl: null };
    state.videos.push(temp);
    renderVideoList("video-list", state.videos, true);
    setUploadProgress(true, 0, "מעלה את הסרטון… 0%");
    return uploadToCloudinary(file, function (ratio) {
      temp.progress = ratio;
      setUploadProgress(true, ratio, "מעלה את הסרטון… " + Math.round(ratio * 100) + "%");
    }).then(function (res) {
      var poster = posterFromCloudinary(res.secure_url);
      temp.uploading = false;
      temp.link = res.secure_url;
      temp.poster = poster;
      temp.duration = res.duration || duration || 0;
      temp.bytes = res.bytes || file.size;
      temp.publicId = res.public_id || "";
      persist();
      renderVideoList("video-list", state.videos, true);
      setUploadProgress(true, 1, "הסרטון הועלה לכרטיס");
      showToast("הסרטון הועלה לכרטיס");
      setTimeout(function () { setUploadProgress(false, 0); }, 1600);
    }, function (err) {
      state.videos = state.videos.filter(function (x) { return x.id !== id; });
      renderVideoList("video-list", state.videos, true);
      setUploadProgress(false, 0);
      showToast("ההעלאה נכשלה. נסו שוב");
      console.warn("cloudinary upload failed", err);
    });
  }

  function addVideoLink() {
    var input = $("video-link");
    var url = (input.value || "").trim();
    if (!url) return;
    if (finishedVideoCount() >= CLOUDINARY.maxVideos) {
      showToast("אפשר להוסיף עד 3 סרטונים לכרטיס");
      return;
    }
    try {
      var parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
      url = parsed.href;
    } catch (err) {
      showToast("הזינו קישור תקין שמתחיל ב-https");
      return;
    }
    state.videos.push({
      id: "link-" + Date.now(),
      name: "קישור לסרטון",
      link: url,
      poster: posterFromCloudinary(url),
      objectUrl: null
    });
    input.value = "";
    persist();
    renderVideoList("video-list", state.videos, true);
  }

  function isPhotoFile(file) {
    if (!file) return false;
    if (file.type && file.type.indexOf("image/") === 0) return true;
    if (file.type && file.type !== "application/octet-stream" && file.type !== "") return false;
    return !file.name || /\.(jpe?g|png|webp|gif|heic|heif|avif)$/i.test(file.name);
  }

  function isDataUrlPhoto(photo) {
    return typeof photo === "string" && photo.indexOf("data:") === 0;
  }

  function isLowResLoadedImage(img) {
    if (!img || !img.naturalWidth) return false;
    return img.naturalWidth < 600 || img.naturalHeight < 600;
  }

  function needsPhotoReupload(photo, img) {
    if (!photo) return false;
    if (isDataUrlPhoto(photo)) return true;
    return isLowResLoadedImage(img);
  }

  function viewedCardPhoto(card) {
    if (!card) return "";
    return card.photo || (card.profile && card.profile.photo) || "";
  }

  function sourceSize(src) {
    return {
      w: src.naturalWidth || src.width || 0,
      h: src.naturalHeight || src.height || 0
    };
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var finishBitmap = function (bmp) { resolve({ kind: "bitmap", src: bmp }); };
      if (window.createImageBitmap) {
        var opts = {};
        try { opts.imageOrientation = "from-image"; } catch (err) {}
        var attempt = createImageBitmap(file, opts);
        if (attempt && attempt.then) {
          attempt.then(finishBitmap, function () { loadImageElement(file, resolve, reject); });
          return;
        }
      }
      loadImageElement(file, resolve, reject);
    });
  }

  function loadImageElement(file, resolve, reject) {
    var img = new Image();
    var objectUrl = URL.createObjectURL(file);
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      URL.revokeObjectURL(objectUrl);
      reject(new Error("load"));
    }, 15000);
    img.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve({ kind: "image", src: img });
    };
    img.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      reject(new Error("load"));
    };
    img.src = objectUrl;
  }

  function coverCrop(srcW, srcH, destW, destH) {
    var ratio = destW / destH;
    var sw, sh, sx, sy;
    if ((srcW / srcH) > ratio) {
      sh = srcH;
      sw = srcH * ratio;
      sx = (srcW - sw) / 2;
      sy = 0;
    } else {
      sw = srcW;
      sh = srcW / ratio;
      sx = 0;
      sy = Math.max(0, (srcH - sh) * 0.18);
    }
    return { sx: sx, sy: sy, sw: sw, sh: sh };
  }

  function drawHighQuality(src, sx, sy, sw, sh, destW, destH) {
    var from = src;
    var fromSx = sx, fromSy = sy, inW = sw, inH = sh;
    var tmpPrev = null;
    while (inW / 2 >= destW * 1.5 && inH / 2 >= destH * 1.5) {
      var mid = document.createElement("canvas");
      mid.width = Math.max(1, Math.round(inW / 2));
      mid.height = Math.max(1, Math.round(inH / 2));
      var mctx = mid.getContext("2d");
      mctx.imageSmoothingEnabled = true;
      if (mctx.imageSmoothingQuality) mctx.imageSmoothingQuality = "high";
      mctx.drawImage(from, fromSx, fromSy, inW, inH, 0, 0, mid.width, mid.height);
      from = mid;
      fromSx = 0;
      fromSy = 0;
      inW = mid.width;
      inH = mid.height;
      tmpPrev = mid;
    }
    var out = document.createElement("canvas");
    out.width = destW;
    out.height = destH;
    var ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, fromSx, fromSy, inW, inH, 0, 0, destW, destH);
    return out;
  }

  function fitWithin(srcW, srcH, maxEdge) {
    var edge = Math.max(srcW, srcH);
    if (edge <= maxEdge) return { w: srcW, h: srcH };
    var scale = maxEdge / edge;
    return {
      w: Math.max(1, Math.round(srcW * scale)),
      h: Math.max(1, Math.round(srcH * scale))
    };
  }

  function dataUrlToBlob(data) {
    var parts = String(data).split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
    var bin = atob(parts[1] || "");
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function asJpegFile(blob) {
    try {
      return new File([blob], "padel-photo.jpg", { type: "image/jpeg", lastModified: Date.now() });
    } catch (err) {
      try { blob.name = "padel-photo.jpg"; } catch (e) {}
      return blob;
    }
  }

  function canvasToJpegBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (blob && blob.size) resolve(blob);
          else reject(new Error("toBlob"));
        }, "image/jpeg", quality);
        return;
      }
      try {
        resolve(dataUrlToBlob(canvas.toDataURL("image/jpeg", quality)));
      } catch (err) {
        reject(err);
      }
    });
  }

  function preparePhotoForUpload(file) {
    return loadImageFile(file).then(function (loaded) {
      var src = loaded.src;
      var size = sourceSize(src);
      if (!size.w || !size.h) throw new Error("size");
      var dest = fitWithin(size.w, size.h, PHOTO_UPLOAD.maxEdge);
      var canvas = drawHighQuality(src, 0, 0, size.w, size.h, dest.w, dest.h);
      if (src.close) try { src.close(); } catch (err) {}
      return canvasToJpegBlob(canvas, PHOTO_UPLOAD.quality);
    }).then(function (blob) {
      return asJpegFile(blob);
    });
  }

  function photoErrorMessage(err) {
    var msg = (err && err.message) || "";
    if (msg === "load" || msg === "size" || msg === "toBlob") {
      return "לא ניתן לקרוא את התמונה. בחרו תמונה בפורמט JPEG או PNG ונסו שוב";
    }
    if (msg === "timeout") return "העלאת התמונה ארכה יותר מדי. נסו שוב";
    if (msg === "network") return "העלאת התמונה נכשלה. בדקו את החיבור ונסו שוב";
    return "העלאת התמונה נכשלה. נסו שוב";
  }

  var pendingPreparedPhoto = null;

  function setPhotoRetryVisible(show) {
    ["photo-retry", "card-photo-retry"].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.toggle("hidden", !show);
    });
  }

  function setPhotoUploadProgress(show, ratio, label) {
    var targets = [
      { wrap: "photo-upload-progress", bar: "photo-upload-progress-bar", text: "photo-upload-progress-label" }
    ];
    if (state.view === "card") {
      targets.push({
        wrap: "card-photo-upload-progress",
        bar: "card-photo-upload-progress-bar",
        text: "card-photo-upload-progress-label"
      });
    }
    targets.forEach(function (t) {
      var wrap = $(t.wrap);
      var bar = $(t.bar);
      var text = $(t.text);
      if (!wrap) return;
      wrap.classList.toggle("hidden", !show);
      if (bar) bar.style.width = Math.round((ratio || 0) * 100) + "%";
      if (text) text.textContent = label || "מעלה תמונה…";
    });
  }

  function applyUploadedPhoto(url) {
    state.photo = url;
    if (state.publicCard && viewerOwnsCard(state.publicCard)) {
      state.publicCard.photo = url;
      if (state.publicCard.profile) state.publicCard.profile.photo = url;
    }
    if (state.profile) persist();
    renderPhotoPreview();
    if (state.view === "card") renderCard();
  }

  function uploadPreparedPhoto(prepared) {
    setPhotoRetryVisible(false);
    setPhotoUploadProgress(true, 0, "מעלה תמונה… 0%");
    showToast("מעלה תמונה…");
    return uploadToCloudinary(prepared, function (ratio) {
      setPhotoUploadProgress(true, ratio, "מעלה תמונה… " + Math.round(ratio * 100) + "%");
    }, { resourceType: "image", preset: CLOUDINARY.photoPreset, timeout: PHOTO_UPLOAD.timeoutMs }).then(function (res) {
      pendingPreparedPhoto = null;
      applyUploadedPhoto(res.secure_url);
      setPhotoUploadProgress(true, 1, "התמונה נשמרה בכרטיס");
      showToast("התמונה נוספה");
      setTimeout(function () { setPhotoUploadProgress(false, 0); }, 1200);
    }, function (err) {
      console.warn("photo upload failed", err);
      setPhotoUploadProgress(false, 0);
      setPhotoRetryVisible(true);
      showToast(photoErrorMessage(err));
      return Promise.reject(err);
    });
  }

  function retryPhotoUpload() {
    if (!pendingPreparedPhoto) {
      showToast("בחרו תמונה מחדש");
      setPhotoRetryVisible(false);
      return;
    }
    uploadPreparedPhoto(pendingPreparedPhoto).catch(function () {});
  }

  function onPhotoSelected(file) {
    if (!isPhotoFile(file)) {
      showToast("יש לבחור קובץ תמונה");
      return;
    }
    if (file.size > CLOUDINARY.maxPhotoBytes) {
      showToast("התמונה גדולה מדי. בחרו תמונה קטנה יותר");
      return;
    }
    pendingPreparedPhoto = null;
    setPhotoRetryVisible(false);
    if (state.view === "card") {
      var box = $("photo-quality-prompt");
      if (box) box.classList.remove("hidden");
    }
    setPhotoUploadProgress(true, 0, "מכין את התמונה…");
    showToast("מכין את התמונה…");
    preparePhotoForUpload(file).then(function (prepared) {
      pendingPreparedPhoto = prepared;
      return uploadPreparedPhoto(prepared).catch(function () {});
    }, function (err) {
      console.warn("photo prepare failed", err);
      pendingPreparedPhoto = null;
      setPhotoUploadProgress(false, 0);
      setPhotoRetryVisible(false);
      showToast(photoErrorMessage(err));
    });
  }

  function photoQualityPromptHtml() {
    return '<div class="photo-quality-prompt" id="photo-quality-prompt">' +
      "<p>התמונה ישנה ובאיכות נמוכה — העלה מחדש לתמונה חדה</p>" +
      '<label class="btn btn-primary" id="card-photo-upload-label">' +
        '<input id="card-photo-file" type="file" accept="image/*,.heic,.heif,image/jpeg,image/png,image/webp" />' +
        "העלאת תמונה" +
      "</label>" +
      '<button class="btn btn-ghost' + (pendingPreparedPhoto ? "" : " hidden") + '" id="card-photo-retry" type="button">נסו שוב</button>' +
      '<div class="upload-progress hidden" id="card-photo-upload-progress" aria-live="polite">' +
        '<div class="upload-progress-track"><div class="upload-progress-bar" id="card-photo-upload-progress-bar"></div></div>' +
        '<span id="card-photo-upload-progress-label">מעלה תמונה…</span>' +
      "</div>" +
    "</div>";
  }

  function ensurePhotoQualityPrompt(art, photo) {
    if (!art || art.querySelector("#photo-quality-prompt")) return;
    if (!needsPhotoReupload(photo, art.querySelector(".ut-hero-img"))) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = photoQualityPromptHtml();
    var node = wrap.firstElementChild;
    var body = art.querySelector(".ut-body");
    if (body) art.insertBefore(node, body);
    else art.appendChild(node);
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
      shots: checkedValues("shots")
    };
    if (!profile.name) return showToast("חסר שם");
    if (!profile.age || Number(profile.age) < 10 || Number(profile.age) > 99) return showToast("גיל לא תקין");
    if (!profile.gender || !profile.hand || !profile.side || !profile.competitor || !profile.hasPartner) {
      return showToast("נא למלא את כל השדות");
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
    var photo = card.photo || p.photo;
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

    var videos = (card.videos || []).filter(function (v) { return v.link || v.objectUrl; });
    var vidHtml = '<p class="ut-section">סרטוני משחק</p>';
    if (videos.length) {
      vidHtml += '<div class="video-list">' + videos.map(videoTileHtml).join("") + "</div>";
    } else if (!opts.compact) {
      vidHtml += '<p class="empty-videos">עדיין אין סרטונים בכרטיס.</p>';
    } else {
      vidHtml = "";
    }

    var ratingLine = ratingLineHtml(level);

    art.innerHTML =
      '<div class="ut-hero' + (photo ? " has-photo" : "") + '">' +
        (photo ? photoImgTag(photo, opts.compact ? "heroCompact" : "hero", "ut-hero-img", p.name) : "") +
        '<div class="ut-hero-fallback">' + escapeHtml(initials(p.name)) + "</div>" +
        '<div class="ut-hero-shade"></div>' +
        '<div class="ut-hero-content">' +
          '<div class="ut-id"><h1>' + escapeHtml(p.name) + "</h1><p>" + escapeHtml(identity.join(" · ")) + "</p></div>" +
          '<div class="' + badgeClass(level.id) + '"><b>' + escapeHtml(level.id) + "</b><span>" + escapeHtml(level.title) + "</span></div>" +
        "</div>" +
      "</div>" +
      (opts.allowReupload && needsPhotoReupload(photo) ? photoQualityPromptHtml() : "") +
      '<div class="ut-body">' +
        ratingLine +
        '<div class="ut-stats">' + stats.join("") + "</div>" +
        shotsHtml + courts + partnerHtml + vidHtml +
      "</div>";
    bindHeroPhoto(art, photo, opts.allowReupload);
    return art;
  }

  function bindHeroPhoto(art, photo, allowReupload) {
    var img = art.querySelector(".ut-hero-img");
    var hero = art.querySelector(".ut-hero");
    if (!img || !hero) return;
    var mark = function () {
      if (img.naturalWidth) hero.classList.add("is-ready");
      if (allowReupload) ensurePhotoQualityPrompt(art, photo);
    };
    var fail = function () { hero.classList.remove("has-photo", "is-ready"); };
    if (img.complete) {
      if (img.naturalWidth) mark();
      else fail();
    } else {
      img.addEventListener("load", mark);
      img.addEventListener("error", fail);
    }
  }

  function ratingText(level) {
    if (!level) return "";
    return (level.id || "") + " · " + (level.numeric || "");
  }

  function ratingLineHtml(level) {
    var text = ratingText(level);
    if (!text || text === " · ") return "";
    return '<div class="ut-rating-line">' +
      '<span class="ut-rating-label">דירוג</span>' +
      '<strong class="ut-rating-value" dir="ltr">' + escapeHtml(text) + "</strong>" +
      "</div>";
  }

  function localOwnerId() {
    return (state.profile && state.profile.id) || "";
  }

  function cardOwnerId(card) {
    if (!card) return "";
    return card.id || (card.profile && card.profile.id) || "";
  }

  function viewerOwnsCard(card) {
    var mine = localOwnerId();
    return !!(mine && cardOwnerId(card) === mine);
  }

  function viewerOwnsViewedCard() {
    if (state.publicCard) return viewerOwnsCard(state.publicCard);
    return !!(state.profile && state.levelId);
  }

  function viewerOwnsViewedPair() {
    if (state.publicPair) {
      return viewerOwnsCard(state.publicPair.a) || viewerOwnsCard(state.publicPair.b);
    }
    return !!(state.profile && state.levelId && linkedPartner());
  }

  function isLocalLiveCard() {
    return !state.publicCard && !!(state.profile && state.levelId);
  }

  function isLocalLivePair() {
    return !state.publicPair && !!(state.profile && state.levelId && linkedPartner());
  }

  function renderCard() {
    var data = state.publicCard ? state.publicCard : currentCardData();
    var owns = viewerOwnsViewedCard();
    var local = isLocalLiveCard();
    var partner = local ? linkedPartner() : null;
    $("owner-actions").classList.toggle("hidden", !owns);
    $("copy-own-link").classList.toggle("hidden", !owns);
    $("copy-pair-from-card").classList.toggle("hidden", !local || !partner);
    $("local-card-actions").classList.toggle("hidden", !local);
    $("open-pair").classList.toggle("hidden", !local || !partner);
    var root = $("card-root");
    root.innerHTML = "";
    root.appendChild(createPremiumCard(data, { compact: false, partner: partner, allowReupload: owns }));
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
    var owns = viewerOwnsViewedPair();
    $("pair-owner-actions").classList.toggle("hidden", !owns);
    $("copy-pair-link").classList.toggle("hidden", !owns);
    $("pair-back-card").classList.toggle("hidden", !isLocalLivePair());

    $("pair-level-chip").className = badgeClass(summary.letter);
    $("pair-level-letter").textContent = summary.letter;
    $("pair-level-num").textContent = ratingText({ id: summary.letter, numeric: summary.numeric });
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

  function currentPageUrl() {
    return location.origin + location.pathname + location.hash;
  }

  function currentShareUrl() {
    if (state.publicPair || state.publicCard) return currentPageUrl();
    if (state.shareMode === "pair" && linkedPartner()) {
      return pairShareUrl(currentCardData(), partnerAsCard(linkedPartner()));
    }
    return singleShareUrl();
  }

  function urlToCopyForCard() {
    if (state.profile && state.levelId && viewerOwnsViewedCard()) return singleShareUrl();
    if (state.publicCard) return currentPageUrl();
    return singleShareUrl();
  }

  function urlToCopyForPair() {
    if (state.publicPair) return currentPageUrl();
    if (linkedPartner()) return pairShareUrl(currentCardData(), partnerAsCard(linkedPartner()));
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
    if (!url) {
      showToast("אין קישור להעתקה");
      return;
    }
    // Start the clipboard write in the same click tick (required on iOS).
    // Also try a synchronous execCommand fallback while the user gesture is
    // still valid — if we wait for clipboard.writeText to reject, iOS will
    // refuse execCommand because the gesture has expired.
    var synced = syncCopy(url);
    var startedClipboard = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        var maybe = navigator.clipboard.writeText(url);
        startedClipboard = true;
        if (maybe && typeof maybe.then === "function") {
          maybe.then(function () {
            showToast("הקישור הועתק");
          }).catch(function () {
            if (synced) showToast("הקישור הועתק");
            else shareOrRevealLink(url);
          });
        }
      } catch (err) {
        startedClipboard = false;
      }
    }
    if (synced) {
      showToast("הקישור הועתק");
      return;
    }
    if (!startedClipboard) shareOrRevealLink(url);
  }

  function focusAndSelect(el, text) {
    el.focus();
    if (typeof el.setSelectionRange === "function") {
      try { el.setSelectionRange(0, (text || el.value || "").length); return true; }
      catch (err) {}
    }
    if (typeof el.select === "function") {
      try { el.select(); return true; } catch (err) {}
    }
    var sel = window.getSelection && window.getSelection();
    if (sel && document.createRange) {
      var range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }
    return false;
  }

  function tryExecCopy(el, text) {
    focusAndSelect(el, text);
    try { return document.execCommand("copy"); } catch (err) { return false; }
  }

  function syncCopy(text) {
    var ok = false;
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.contentEditable = "true";
    ta.readOnly = false;
    ta.style.cssText = "position:fixed;top:0;right:0;width:1px;height:1px;padding:0;margin:0;border:0;outline:none;box-shadow:none;background:transparent;opacity:0.01;font-size:16px;";
    document.body.appendChild(ta);
    ok = tryExecCopy(ta, text);
    ta.remove();
    if (ok) return true;

    var input = document.createElement("input");
    input.type = "text";
    input.value = text;
    input.setAttribute("readonly", "");
    input.setAttribute("aria-hidden", "true");
    input.style.cssText = "position:fixed;top:" + (window.pageYOffset || 0) + "px;right:0;width:1px;height:1px;padding:0;margin:0;border:0;outline:none;background:transparent;opacity:0.01;font-size:16px;";
    document.body.appendChild(input);
    ok = tryExecCopy(input, text);
    input.remove();
    if (ok) return true;

    var holder = document.createElement("div");
    holder.contentEditable = "true";
    holder.setAttribute("aria-hidden", "true");
    holder.style.cssText = "position:fixed;top:0;right:0;width:1px;height:1px;opacity:0.01;font-size:16px;overflow:hidden;";
    holder.textContent = text;
    document.body.appendChild(holder);
    ok = tryExecCopy(holder, text);
    holder.remove();
    return ok;
  }

  function shareOrRevealLink(url) {
    if (navigator.share) {
      var sharePromise;
      try {
        sharePromise = navigator.share({ title: "כרטיס פאדל", text: "כרטיס השחקן שלי בפאדל", url: url });
      } catch (err) {
        sharePromise = null;
      }
      if (sharePromise && typeof sharePromise.then === "function") {
        sharePromise.then(function () {
          showToast("מוכן לשיתוף");
        }).catch(function (err) {
          if (err && err.name === "AbortError") return;
          revealLink(url);
        });
        return;
      }
    }
    revealLink(url);
  }

  function revealLink(url) {
    var box = $("link-fallback");
    var input = $("link-fallback-input");
    if (!box || !input) {
      try { window.prompt("העתיקו את הקישור:", url); } catch (err) {}
      showToast("העתיקו את הקישור ידנית");
      return;
    }
    input.value = url;
    box.classList.remove("hidden");
    setTimeout(function () { focusAndSelect(input, url); }, 50);
    showToast("העתיקו את הקישור ידנית");
  }

  function hideLinkFallback() {
    var box = $("link-fallback");
    if (box) box.classList.add("hidden");
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
    document.body.classList.remove("has-dock");
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
    document.addEventListener("change", function (ev) {
      if (!ev.target || ev.target.id !== "card-photo-file") return;
      var file = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if (file) onPhotoSelected(file);
    });
    $("photo-retry").addEventListener("click", retryPhotoUpload);
    document.addEventListener("click", function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest("#card-photo-retry")) {
        ev.preventDefault();
        retryPhotoUpload();
      }
    });
    $("photo-remove").addEventListener("click", function () {
      state.photo = null;
      pendingPreparedPhoto = null;
      setPhotoRetryVisible(false);
      renderPhotoPreview();
      if (state.profile) persist();
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
    $("copy-own-link").addEventListener("click", function () { copyText(urlToCopyForCard()); });
    $("copy-pair-from-card").addEventListener("click", function () { copyText(urlToCopyForPair()); });
    $("copy-pair-link").addEventListener("click", function () { copyText(urlToCopyForPair()); });
    $("link-fallback-close").addEventListener("click", hideLinkFallback);
    $("link-fallback-select").addEventListener("click", function () {
      var input = $("link-fallback-input");
      if (input) focusAndSelect(input, input.value);
    });
    $("link-fallback").addEventListener("click", function (ev) {
      if (ev.target === $("link-fallback")) hideLinkFallback();
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
    $("pair-back-card").addEventListener("click", function () { go("card"); });
    document.addEventListener("click", function (ev) {
      var tile = ev.target.closest(".ut-video-tile");
      if (!tile || tile.querySelector("video")) return;
      if (!ev.target.closest(".ut-play-btn, .ut-video-poster, .ut-video-tile")) return;
      ev.preventDefault();
      var src = tile.getAttribute("data-src");
      if (!src) return;
      var poster = tile.getAttribute("data-poster") || "";
      var vid = document.createElement("video");
      vid.controls = true;
      vid.autoplay = true;
      vid.playsInline = true;
      vid.preload = "metadata";
      if (poster) vid.poster = poster;
      vid.src = src;
      tile.innerHTML = "";
      tile.appendChild(vid);
      var play = vid.play();
      if (play && play.catch) play.catch(function () {});
    });
    window.addEventListener("hashchange", render);
  }

  loadSaved();
  bind();
  render();
})();
