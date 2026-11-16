(function () {
  const STORAGE_KEY = "padelCard.v2";
  const PHOTO_SHARE_MAX = 18000;
  const videoBlobs = new Map();
  const CLOUDINARY = {
    cloudName: "jgreas8e",
    uploadPreset: "padel_card_videos",
    photoPreset: "padel_card_photos",
    trackPreset: "padel_card_tracks",
    maxVideos: 3,
    maxBytes: 100 * 1024 * 1024,
    maxDuration: 180,
    maxPhotoBytes: 40 * 1024 * 1024,
    videoTimeoutMs: 5 * 60 * 1000
  };

  // AI Rating backend (server/ in the repo, Render web service "padel-card-api").
  // Local dev: served on :8787. Override with localStorage "padelCard.apiBase".
  const AI_API = (function () {
    var base = "https://padel-card-api.onrender.com";
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) base = "http://127.0.0.1:8787";
    try { base = localStorage.getItem("padelCard.apiBase") || base; } catch (err) {}
    return { base: base.replace(/\/+$/, ""), timeoutMs: 5 * 60 * 1000 };
  })();

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
      if (state.profile) state.profile.tenure = normalizeTenure(state.profile.tenure || "");
      state.videos = (data.videos || []).map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, objectUrl: null, localOnly: !!v.localOnly && !v.link, trackUrl: v.trackUrl || "", marker: v.marker || null, track: v.track || null, ai: cleanVideoAi(v.ai, true) };
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
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, objectUrl: null, localOnly: !!v.localOnly && !v.link, trackUrl: v.trackUrl || "", marker: v.marker || null, track: v.track || null, ai: cleanVideoAi(v.ai, true) };
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
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, localOnly: !v.link, trackUrl: v.trackUrl || "", marker: v.marker || null, track: v.track || null, ai: cleanVideoAi(v.ai, true) };
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
      tenure: normalizeTenure(state.profile.tenure || ""),
      style: state.profile.style || "",
      shots: state.profile.shots || [],
      ai: cleanAi(state.profile.ai),
      levelId: state.levelId,
      score: PadelQuiz.totalScore(state.answers),
      photo: state.photo || null,
      videos: state.videos.map(function (v) {
        return { id: v.id, name: v.name, link: v.link || "", poster: v.poster || "", duration: v.duration || 0, bytes: v.bytes || 0, trackUrl: v.trackUrl || "", marker: v.marker || null, track: v.track || null, ai: cleanVideoAi(v.ai, true) };
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

  var H264_TRANSFORM = "c_limit,w_1280,h_720,q_auto:good,vc_h264,f_mp4";

  function posterFromCloudinary(url) {
    if (!isCloudinaryVideo(url)) return "";
    var u = url.replace("/video/upload/", "/video/upload/so_auto,f_jpg/");
    u = u.replace(/,?(vc_h264|vc_auto|f_mp4)/g, "");
    u = u.replace(/\.(mp4|mov|m4v|webm|mkv)(\?|$)/i, ".jpg$2");
    return u;
  }

  function playableCloudinaryUrl(url) {
    if (!url || !isCloudinaryVideo(url)) return url || "";
    if (/vc_h264|f_mp4/.test(url) && /\.mp4(\?|$)/i.test(url)) return url;
    return url
      .replace("/video/upload/", "/video/upload/" + H264_TRANSFORM + "/")
      .replace(/\.(mov|m4v|webm|avi|mkv|hevc)(\?|$)/i, ".mp4$2");
  }

  function videoUrlFromUpload(res) {
    if (!res) return "";
    var eager = res.eager;
    if (Array.isArray(eager)) {
      var i;
      for (i = 0; i < eager.length; i++) {
        var item = eager[i];
        if (item && item.secure_url && /mp4/i.test(item.format || item.secure_url || "")) {
          return item.secure_url;
        }
      }
    }
    return playableCloudinaryUrl(res.secure_url || "");
  }

  function isDirectVideo(url) {
    if (!url) return false;
    if (isCloudinaryVideo(url)) return true;
    if (/^blob:/i.test(url) || /^data:video\//i.test(url)) return true;
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
    var src = playableCloudinaryUrl(v.link || "") || v.link || v.objectUrl || "";
    var poster = v.poster || posterFromCloudinary(v.link || "");
    if (!src) return "";
    if (v.link && !isDirectVideo(v.link) && !v.objectUrl) {
      return '<div class="video-item"><a class="link-row" href="' + escapeHtml(v.link) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(v.link) + "</a></div>";
    }
    rememberVideo(v);
    var tracked = !!(v.trackUrl || v.track || v.marker);
    return '<div class="ut-video-tile video-item" data-src="' + escapeHtml(src) + '"' +
      (v.id ? ' data-vid="' + escapeHtml(v.id) + '"' : "") +
      (poster ? ' data-poster="' + escapeHtml(poster) + '"' : "") +
      (v.trackUrl ? ' data-track-url="' + escapeHtml(v.trackUrl) + '"' : "") +
      (v.marker ? ' data-marker="' + escapeHtml((v.marker || []).join(",")) + '"' : "") +
      (tracked ? ' data-has-track="1"' : "") + ">" +
      (poster ? '<img class="ut-video-poster" alt="" src="' + escapeHtml(poster) + '">' : '<div class="ut-video-poster ut-video-fallback"></div>') +
      '<button type="button" class="ut-play-btn" aria-label="ניגון סרטון"></button>' +
      (tracked ? '<span class="track-badge ut-track-badge">מסומן</span>' : "") +
      "</div>";
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
        var item = { u: v.link };
        if (v.poster) item.p = v.poster;
        if (v.trackUrl) item.t = v.trackUrl;
        else if (v.track && compactTrackForLink(v.track)) item.k = compactTrackForLink(v.track);
        else if (v.marker) item.m = v.marker;
        var va = cleanVideoAi(v.ai, false);
        if (va) item.a = va;
        if (!item.p && !item.t && !item.k && !item.m && !item.a) return v.link;
        return item;
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
    if (p.tenure) data.t = normalizeTenure(p.tenure);
    if (p.style) data.st = p.style;
    if (p.shots && p.shots.length) data.sk = p.shots;
    var ai = overallAiForCard({ profile: p, videos: videos, ai: src.ai });
    if (ai) data.ai = ai;
    var lr = cleanLr(p.lr);
    if (lr) data.lr = lr;
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
        tenure: normalizeTenure(raw.t || ""),
        style: raw.st || "",
        shots: raw.sk || [],
        ai: cleanAi(raw.ai),
        lr: cleanLr(raw.lr)
      },
      levelId: raw.lv,
      score: raw.sc || 0,
      photo: raw.ph || null,
      videos: (raw.v || []).map(function (item, i) {
        var link = typeof item === "string" ? item : (item && (item.u || item.link)) || "";
        var poster = typeof item === "object" && item ? (item.p || item.poster || "") : "";
        if (!poster) poster = posterFromCloudinary(link);
        var trackUrl = typeof item === "object" && item ? (item.t || item.trackUrl || "") : "";
        var marker = typeof item === "object" && item ? (item.m || item.marker || null) : null;
        var packed = typeof item === "object" && item ? (item.k || item.track || null) : null;
        var va = typeof item === "object" && item ? cleanVideoAi(item.a, false) : null;
        return { id: "link-" + i, name: "סרטון " + (i + 1), link: link, poster: poster, objectUrl: null, trackUrl: trackUrl, marker: marker, track: packed, ai: va };
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
        tenure: normalizeTenure(p.tenure || ""),
        style: p.style || "",
        shots: p.shots || [],
        ai: cleanAi(p.ai)
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

  function showToast(msg, ms) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2200);
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
    tenure: {
      under1: "פחות משנה",
      "1-2": "1–2 שנים",
      "2-3": "2–3 שנים",
      "3plus": "מעל 3 שנים",
      "3-5": "מעל 3 שנים",
      "5plus": "מעל 3 שנים"
    },
    style: { competitive: "תחרותי", social: "חברתי", both: "גם וגם" },
    shots: {
      bandeja: "בנדחה", vibora: "ויבורה", smash: "סמאש", kicksmash: "קיק סמאש",
      volley: "וולי/רשת", lob: "לוב", walls: "משחק קירות", defense: "הגנה"
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

  function normalizeTenure(value) {
    if (!value) return "";
    if (value === "3-5" || value === "5plus" || value === "over3") return "3plus";
    return value;
  }

  function setSeg(name, value) {
    var v = name === "tenure" ? normalizeTenure(value) : value;
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (el) {
      el.checked = el.value === v;
    });
  }

  function segValue(name) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : "";
  }

  function renderVideoList(targetId, videos, editable) {
    if (editable) refreshStaleOwnerTracks();
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
      if ((v.trackUrl || v.track || v.marker) && !v.uploading) {
        var badge = document.createElement("span");
        badge.className = "track-badge";
        badge.textContent = "מסומן";
        meta.appendChild(badge);
      }
      if (editable && !v.uploading) {
        if (isDirectVideo(v.link || v.objectUrl || "") && !v.trackUrl && !v.track) {
          var mark = document.createElement("button");
          mark.type = "button";
          mark.className = "text-btn";
          mark.textContent = "סימון שחקן";
          mark.addEventListener("click", function () { openTrackPicker(v); });
          meta.appendChild(mark);
        }
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

  var VIDEO_EXTS = /\.(mov|mp4|m4v|hevc|qt|webm|avi)$/i;

  function isVideoFile(file) {
    if (!file) return false;
    var type = String(file.type || "").toLowerCase();
    var name = String(file.name || "");
    if (VIDEO_EXTS.test(name)) return true;
    if (type.indexOf("video/") === 0) return true;
    // iOS often leaves type empty or uses a generic octet-stream for .mov/HEVC.
    if (!type || type === "application/octet-stream") return true;
    return false;
  }

  function readVideoDuration(file) {
    return new Promise(function (resolve) {
      if (window.__padelForceUnknownDuration) {
        resolve(NaN);
        return;
      }
      var url = URL.createObjectURL(file);
      var el = document.createElement("video");
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.setAttribute("muted", "");
      el.setAttribute("playsinline", "");
      el.setAttribute("webkit-playsinline", "");
      el.preload = "metadata";
      el.setAttribute("preload", "metadata");
      el.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-99px;top:-99px;";
      var done = false;
      var finish = function (val) {
        if (done) return;
        done = true;
        try { el.removeAttribute("src"); el.load(); } catch (err) {}
        try { if (el.parentNode) el.parentNode.removeChild(el); } catch (err) {}
        URL.revokeObjectURL(url);
        resolve(val);
      };
      var onMeta = function () {
        var d = el.duration;
        if (isFinite(d) && d > 0) finish(d);
      };
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("durationchange", onMeta);
      el.addEventListener("loadeddata", onMeta);
      el.addEventListener("error", function () { finish(NaN); });
      var wait = 5000;
      try {
        if (typeof window.__padelVideoMetaTimeoutMs === "number") wait = window.__padelVideoMetaTimeoutMs;
      } catch (err) {}
      setTimeout(function () { finish(NaN); }, wait);
      try { document.body.appendChild(el); } catch (err) {}
      el.src = url;
      try { el.load(); } catch (err) {}
    });
  }

  function uploadErrorMessage(err) {
    var raw = String((err && err.message) || err || "");
    var m = raw.toLowerCase();
    if (/file size too large|maximum is|too large|file size/.test(m)) {
      return "הקובץ גדול מדי. הגודל המרבי בתוכנית החינמית הוא 100MB";
    }
    if (/timeout/.test(m)) return "ההעלאה ארכה יותר מדי. בדקו את החיבור ונסו שוב";
    if (/network/.test(m)) return "אין חיבור לרשת. בדקו את החיבור ונסו שוב";
    if (raw && raw !== "upload" && raw !== "parse") return "ההעלאה נכשלה: " + raw;
    return "ההעלאה נכשלה. נסו שוב";
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
    if (!isVideoFile(file)) {
      showToast("יש לבחור קובץ וידאו (MP4 או MOV)");
      return Promise.resolve();
    }
    if (file.size > CLOUDINARY.maxBytes) {
      showToast("הקובץ גדול מדי. הגודל המרבי הוא 100MB");
      return Promise.resolve();
    }
    // Immediate feedback so the tap never looks dead on iOS, even while
    // metadata is still pending (or never arrives).
    setUploadProgress(true, 0.05, "מכין את הסרטון…");
    return readVideoDuration(file).then(function (duration) {
      if (isFinite(duration) && duration > CLOUDINARY.maxDuration) {
        showToast("הסרטון ארוך מ־3 דקות, אבל נמשיך להעלות");
      }
      return startCloudinaryUpload(file, duration);
    }, function () {
      // Never block the upload if duration cannot be read (common on iOS).
      return startCloudinaryUpload(file, 0);
    }).catch(function (err) {
      setUploadProgress(false, 0);
      showToast(uploadErrorMessage(err));
    });
  }

  function startCloudinaryUpload(file, duration) {
    var id = "vid-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var temp = { id: id, name: file.name, uploading: true, progress: 0, duration: duration || 0, bytes: file.size, link: "", poster: "", objectUrl: null };
    state.videos.push(temp);
    renderVideoList("video-list", state.videos, true);
    setUploadProgress(true, 0, "מעלה את הסרטון… 0%");
    temp.objectUrl = URL.createObjectURL(file);
    return uploadToCloudinary(file, function (ratio) {
      temp.progress = ratio;
      setUploadProgress(true, ratio, "מעלה את הסרטון… " + Math.round(ratio * 100) + "%");
    }, { resourceType: "video", preset: CLOUDINARY.uploadPreset, timeout: CLOUDINARY.videoTimeoutMs }).then(function (res) {
      var playable = videoUrlFromUpload(res);
      var poster = posterFromCloudinary(playable || res.secure_url);
      temp.uploading = false;
      temp.link = playable || res.secure_url;
      temp.originalLink = res.secure_url || playable;
      temp.poster = poster;
      temp.duration = res.duration || duration || 0;
      temp.bytes = res.bytes || file.size;
      temp.publicId = res.public_id || "";
      persist();
      renderVideoList("video-list", state.videos, true);
      setUploadProgress(false, 0);
      if (isFinite(temp.duration) && temp.duration > CLOUDINARY.maxDuration) {
        showToast("הסרטון ארוך מ־3 דקות, אך נשמר בכרטיס");
      } else {
        showToast("הסרטון הועלה לכרטיס");
      }
      return openTrackPicker(temp);
    }, function (err) {
      state.videos = state.videos.filter(function (x) { return x.id !== id; });
      renderVideoList("video-list", state.videos, true);
      setUploadProgress(false, 0);
      showToast(uploadErrorMessage(err));
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


  var videoRecords = new Map();
  var pickerState = {
    video: null,
    boxes: [],
    selected: null,
    running: false,
    cancelled: false,
    frame: null,
    detectTimer: 0,
    mode: "",
    poster: ""
  };
  var playerState = { track: null, raf: 0, expanded: false, src: "" };

  function rememberVideo(v) {
    if (v && v.id) videoRecords.set(v.id, v);
  }

  function compactTrackForLink(track) {
    var packed = track && window.PadelTrack ? PadelTrack.pack(track) : track;
    if (!packed) return null;
    try {
      var json = JSON.stringify(packed);
      if (json.length <= 2200) return packed;
    } catch (err) {}
    return null;
  }

  function parseMarkerAttr(raw) {
    if (!raw) return null;
    var parts = String(raw).split(",").map(Number);
    if (parts.length >= 3 && isFinite(parts[0]) && isFinite(parts[1]) && isFinite(parts[2])) {
      return [parts[0], parts[1], parts[2]];
    }
    return null;
  }

  function contentRect(el, mediaW, mediaH) {
    var w = el.clientWidth || 1;
    var h = el.clientHeight || 1;
    var mw = mediaW || w;
    var mh = mediaH || h;
    var scale = Math.min(w / mw, h / mh);
    var cw = mw * scale;
    var ch = mh * scale;
    return { left: (w - cw) / 2, top: (h - ch) / 2, w: cw, h: ch, stageW: w, stageH: h };
  }

  function setPickerStatus(text) {
    var el = $("track-picker-status");
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("hidden", !text);
  }

  function configureVideoEl(video, src, opts) {
    opts = opts || {};
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.preload = "auto";
    video.controls = false;
    if (opts.poster) video.poster = opts.poster;
    else video.removeAttribute("poster");
    if (/^https?:/i.test(src || "")) {
      video.crossOrigin = "anonymous";
      video.setAttribute("crossorigin", "anonymous");
    } else {
      video.removeAttribute("crossorigin");
      try { video.crossOrigin = null; } catch (err) {}
    }
    if (src) video.src = src;
    try { video.load(); } catch (err) {}
  }

  function videoHasFrame(video) {
    return !!(video && video.videoWidth > 0 && video.readyState >= 2);
  }

  function kickVideoFrame(video, keepPlaying) {
    return new Promise(function (resolve) {
      var play = null;
      try {
        if (!keepPlaying) video.muted = true;
        play = video.play();
      } catch (err) {}
      var finish = function () {
        if (!keepPlaying) {
          try { video.pause(); } catch (err2) {}
        }
        resolve(videoHasFrame(video));
      };
      if (play && play.then) {
        play.then(function () {
          setTimeout(finish, 180);
        }).catch(function () { resolve(videoHasFrame(video)); });
      } else {
        setTimeout(finish, 180);
      }
    });
  }

  function waitForVideoFrame(video, fallbackSrc, keepPlaying) {
    return new Promise(function (resolve) {
      var settled = false;
      var triedFallback = false;
      var finish = function () {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(videoHasFrame(video));
      };
      var onMeta = function () {
        var start = 0.1;
        if (isFinite(video.duration) && video.duration > 0) {
          start = Math.min(0.12, Math.max(0.04, video.duration * 0.02));
        }
        try { video.currentTime = start; } catch (err) {}
      };
      var onReady = function () {
        if (videoHasFrame(video)) {
          kickVideoFrame(video, keepPlaying).then(finish);
        }
      };
      var cleanup = function () {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("seeked", onReady);
        video.removeEventListener("canplay", onReady);
        video.removeEventListener("error", onError);
      };
      var onError = function () { tryFallback(); };
      var tryFallback = function () {
        if (triedFallback || !fallbackSrc || video.src === fallbackSrc) {
          if (!settled) kickVideoFrame(video, keepPlaying).then(finish);
          return;
        }
        triedFallback = true;
        configureVideoEl(video, fallbackSrc, { poster: video.poster || "" });
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("loadeddata", onReady);
      video.addEventListener("seeked", onReady);
      video.addEventListener("canplay", onReady);
      video.addEventListener("error", onError);
      if (video.readyState >= 1) onMeta();
      if (videoHasFrame(video)) onReady();
      setTimeout(function () {
        if (settled) return;
        kickVideoFrame(video, keepPlaying).then(function (ok) {
          if (ok) finish();
          else tryFallback();
          setTimeout(finish, 2200);
        });
      }, 1600);
    });
  }

  function updatePickerPoster(posterUrl, showVideo) {
    var img = $("track-picker-poster");
    var video = $("track-picker-video");
    var hasFrame = !!showVideo || videoHasFrame(video);
    var posterReady = !!(img && posterUrl && img.complete && img.naturalWidth);
    if (img) {
      if (posterUrl && img.getAttribute("src") !== posterUrl) {
        img.onload = function () {
          if (!videoHasFrame(video)) {
            img.classList.remove("hidden");
            if (video) video.style.opacity = "0";
          }
        };
        img.src = posterUrl;
      }
      if (!posterUrl) {
        img.removeAttribute("src");
        img.classList.add("hidden");
      } else {
        img.classList.toggle("hidden", hasFrame || !posterReady);
      }
    }
    if (video) {
      video.style.opacity = hasFrame || !posterReady ? "1" : "0";
    }
  }

  function setTrackProgress(show, ratio, label) {
    var wrap = $("track-progress");
    var bar = $("track-progress-bar");
    var text = $("track-progress-label");
    if (!wrap) return;
    wrap.classList.toggle("hidden", !show);
    if (bar) bar.style.width = Math.round((ratio || 0) * 100) + "%";
    if (text) text.textContent = label || "מזהה את השחקן בסרטון…";
  }

  function setPickerRunning(running) {
    pickerState.running = running;
    $("track-scrub-wrap").classList.toggle("hidden", running);
    $("track-picker-actions").classList.toggle("hidden", running);
    $("track-picker-cancel-run").classList.toggle("hidden", !running);
  }

  function closeTrackPicker() {
    pickerState.cancelled = true;
    pickerState.running = false;
    pickerState.video = null;
    pickerState.boxes = [];
    pickerState.selected = null;
    var overlay = $("track-picker");
    if (overlay) overlay.classList.add("hidden");
    var vid = $("track-picker-video");
    if (vid) {
      try { vid.pause(); } catch (err) {}
      vid.removeAttribute("src");
      vid.removeAttribute("poster");
      vid.style.opacity = "";
      vid.load();
    }
    updatePickerPoster("", false);
    setPickerStatus("");
    setTrackProgress(false, 0);
    setPickerRunning(false);
    pickerState.mode = "";
  }

  function layoutPicker() {
    var video = $("track-picker-video");
    var canvas = $("track-picker-canvas");
    var stage = $("track-picker-stage");
    if (!video || !canvas || !stage) return;
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    var mw = video.videoWidth || 0;
    var mh = video.videoHeight || 0;
    if (!mw || !mh) {
      var poster = $("track-picker-poster");
      if (poster && poster.naturalWidth) {
        mw = poster.naturalWidth;
        mh = poster.naturalHeight;
      }
    }
    pickerState.frame = contentRect(stage, mw || 16, mh || 9);
    pickerState.dpr = dpr;
  }

  function drawPicker() {
    var canvas = $("track-picker-canvas");
    if (!canvas) return;
    layoutPicker();
    var ctx = canvas.getContext("2d");
    var dpr = pickerState.dpr || 1;
    var frame = pickerState.frame;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!frame) return;
    var i;
    for (i = 0; i < pickerState.boxes.length; i++) {
      var b = pickerState.boxes[i];
      ctx.strokeStyle = "rgba(200, 255, 60, 0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(frame.left + b.x * frame.w, frame.top + b.y * frame.h, b.w * frame.w, b.h * frame.h);
    }
    var sel = pickerState.selected;
    if (sel) {
      var cx = frame.left + sel.x * frame.w;
      var cy = frame.top + sel.y * frame.h;
      var r = sel.r * frame.w;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "#c8ff3c";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "rgba(200, 255, 60, 0.14)";
      ctx.fill();
      ctx.font = "800 14px Heebo, sans-serif";
      ctx.fillStyle = "#c8ff3c";
      ctx.textAlign = "center";
      ctx.fillText("אני", cx, cy - r - 8);
    }
  }

  function refreshPickerDetections() {
    var video = $("track-picker-video");
    if (!video || !window.PadelTrack || pickerState.running) return Promise.resolve();
    if (pickerState.mode === "static-only") {
      pickerState.boxes = [];
      drawPicker();
      return Promise.resolve();
    }
    var state = PadelTrack.getDetectorState && PadelTrack.getDetectorState();
    if (state && state.failed) {
      pickerState.boxes = [];
      drawPicker();
      return Promise.resolve();
    }
    return PadelTrack.detectPeople(video).then(function (boxes) {
      pickerState.boxes = boxes || [];
      drawPicker();
    }).catch(function (err) {
      pickerState.boxes = [];
      if (err && err.code === "tainted") {
        pickerState.mode = "static-only";
        setPickerStatus("לא ניתן לקרוא את פיקסלי הסרטון. לחצו על עצמכם בתמונה — נשמור סימון בתחילת הסרטון.");
      }
      drawPicker();
    });
  }

  function onPickerScrub() {
    var video = $("track-picker-video");
    var slider = $("track-picker-scrub");
    if (!video || !slider || !isFinite(video.duration) || !video.duration) return;
    var t = (Number(slider.value) / 1000) * video.duration;
    if (pickerState.detectTimer) clearTimeout(pickerState.detectTimer);
    var after = function () {
      updatePickerPoster(pickerState.poster || "", videoHasFrame(video));
      drawPicker();
      pickerState.detectTimer = setTimeout(function () { refreshPickerDetections(); }, 140);
    };
    if (!window.PadelTrack) {
      try { video.currentTime = t; } catch (err) {}
      after();
      return;
    }
    PadelTrack.seekTo(video, t).then(function () {
      if (!videoHasFrame(video)) return kickVideoFrame(video).then(after);
      after();
    }, after);
  }

  function onPickerTap(ev) {
    if (pickerState.running) return;
    var canvas = $("track-picker-canvas");
    var frame = pickerState.frame;
    if (!canvas || !frame || frame.w <= 0) return;
    var rect = canvas.getBoundingClientRect();
    var px = ev.clientX - rect.left;
    var py = ev.clientY - rect.top;
    var x = (px - frame.left) / frame.w;
    var y = (py - frame.top) / frame.h;
    if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    var box = window.PadelTrack ? PadelTrack.pickBoxAtPoint(pickerState.boxes, x, y) : null;
    if (box) {
      var aspect = (pickerState.frame && pickerState.frame.h && pickerState.frame.w)
        ? ($("track-picker-video").videoHeight / $("track-picker-video").videoWidth)
        : 9 / 16;
      var pt = PadelTrack.pointFromBox(box, aspect);
      pickerState.selected = { x: pt.x, y: pt.y, r: pt.r, box: box };
    } else {
      pickerState.selected = { x: x, y: y, r: PadelTrack.defaultRadius(), box: null };
    }
    $("track-picker-confirm").disabled = false;
    drawPicker();
  }

  function uploadTrackJson(packed) {
    var json = JSON.stringify(packed);
    var blob = new Blob([json], { type: "application/json" });
    var file;
    try { file = new File([blob], "padel-track.json", { type: "application/json" }); }
    catch (err) { file = blob; }
    return uploadToCloudinary(file, null, {
      resourceType: "raw",
      preset: CLOUDINARY.trackPreset,
      timeout: 30000
    });
  }

  function applyTrackToVideo(v, track, trackUrl) {
    var packed = window.PadelTrack ? PadelTrack.pack(track) : track;
    v.track = packed || track;
    if (trackUrl) v.trackUrl = trackUrl;
    if (track && track.m && (!track.k || !track.k.length)) {
      v.marker = [Math.round(track.m[0] * 1000), Math.round(track.m[1] * 1000), Math.round(track.m[2] * 1000)];
    } else if (packed && packed.m && !packed.k) {
      v.marker = packed.m;
    }
    persist();
    renderVideoList("video-list", state.videos, true);
  }

  var staleRefreshInFlight = {};

  function unpackTrack(track) {
    if (!track || !window.PadelTrack) return track || null;
    return PadelTrack.unpack(track) || track;
  }

  function maybeRefreshStaleTrack(v) {
    if (!v || staleRefreshInFlight[v.id]) return Promise.resolve(null);
    if (!window.PadelTrack || !PadelTrack.isCurrentTrack) return Promise.resolve(null);
    var src = playableCloudinaryUrl(v.link || "") || v.objectUrl || v.link || "";
    if (!isDirectVideo(src)) return Promise.resolve(null);

    function recompute(unpacked) {
      if (!unpacked || PadelTrack.isCurrentTrack(unpacked)) return Promise.resolve(null);
      var startBox = PadelTrack.startBoxFromTrack && PadelTrack.startBoxFromTrack(unpacked);
      if (!startBox) return Promise.resolve(null);
      staleRefreshInFlight[v.id] = true;
      var video = document.createElement("video");
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.src = src;
      video.style.position = "fixed";
      video.style.left = "-9999px";
      video.style.width = "4px";
      video.style.height = "4px";
      document.body.appendChild(video);
      var t0 = typeof unpacked.t0 === "number" ? unpacked.t0 : ((unpacked.k && unpacked.k[0] && unpacked.k[0].t) || 0);
      return waitForVideoFrame(video, "", true).then(function () {
        return PadelTrack.trackPlayer(video, startBox, { t0: t0, interval: 0.2 });
      }).then(function (track) {
        if (!track || !PadelTrack.isUsefulTrack(track)) throw new Error("track-useless");
        var packed = PadelTrack.pack(track);
        return uploadTrackJson(packed).then(function (res) {
          applyTrackToVideo(v, track, res.secure_url || "");
          return track;
        }, function () {
          applyTrackToVideo(v, track, v.trackUrl || "");
          return track;
        });
      }).catch(function () {
        return null;
      }).then(function (track) {
        staleRefreshInFlight[v.id] = false;
        try { video.removeAttribute("src"); video.load(); video.remove(); } catch (err) {}
        return track;
      });
    }

    if (v.track) return recompute(unpackTrack(v.track));
    if (v.trackUrl) {
      staleRefreshInFlight[v.id] = true;
      return PadelTrack.fetchTrack(v.trackUrl).then(function (tr) {
        staleRefreshInFlight[v.id] = false;
        if (tr && !v.track) v.track = PadelTrack.pack(tr);
        return recompute(tr);
      }).catch(function () {
        staleRefreshInFlight[v.id] = false;
        return null;
      });
    }
    return Promise.resolve(null);
  }

  function refreshStaleOwnerTracks() {
    if (!state.profile || !state.profile.id) return;
    var list = state.videos || [];
    var i;
    for (i = 0; i < list.length; i++) maybeRefreshStaleTrack(list[i]);
  }

  function finishPickerWithStatic(v, reason) {
    var sel = pickerState.selected;
    if (!sel) {
      closeTrackPicker();
      if (reason) showToast(reason);
      else showToast("הסרטון נשמר בלי סימון שחקן");
      return Promise.resolve();
    }
    var duration = ($("track-picker-video") && $("track-picker-video").duration) || v.duration || 0;
    var track = PadelTrack.staticTrack(sel.x, sel.y, sel.r, PadelTrack.HOLD_SEC, duration);
    applyTrackToVideo(v, track, "");
    closeTrackPicker();
    showToast(reason || "הסימון נשמר בתחילת הסרטון");
    return Promise.resolve();
  }

  function runTracking(v) {
    var sel = pickerState.selected;
    var video = $("track-picker-video");
    if (!sel || !video) return finishPickerWithStatic(v);
    if (pickerState.mode === "static-only") {
      return finishPickerWithStatic(v, "נשמר סימון \"אני\" בתחילת הסרטון");
    }
    pickerState.cancelled = false;
    setPickerRunning(true);
    setTrackProgress(true, 0, "מזהה את השחקן בסרטון… 0%");
    var startBox = sel.box || {
      x: Math.max(0, sel.x - sel.r),
      y: Math.max(0, sel.y - sel.r / ((video.videoHeight || 9) / (video.videoWidth || 16))),
      w: sel.r * 2,
      h: (sel.r * 2) * ((video.videoWidth || 16) / (video.videoHeight || 9))
    };
    var t0 = video.currentTime || 0;
    return PadelTrack.trackPlayer(video, startBox, {
      t0: t0,
      interval: 0.2,
      onProgress: function (ratio) {
        setTrackProgress(true, ratio, "מזהה את השחקן בסרטון… " + Math.round(ratio * 100) + "%");
      },
      shouldCancel: function () { return pickerState.cancelled; }
    }).then(function (track) {
      if (pickerState.cancelled) return finishPickerWithStatic(v);
      if (!track || !PadelTrack.isUsefulTrack(track)) {
        return finishPickerWithStatic(v, "לא הצלחנו לעקוב אחרי השחקן לכל אורך הסרטון. נשמר סימון בתחילת הסרטון");
      }
      setTrackProgress(true, 1, "שומר את הסימון…");
      var packed = PadelTrack.pack(track);
      return uploadTrackJson(packed).then(function (res) {
        applyTrackToVideo(v, track, res.secure_url);
        closeTrackPicker();
        showToast("השחקן סומן בסרטון");
      }, function () {
        applyTrackToVideo(v, track, "");
        closeTrackPicker();
        showToast("השחקן סומן בסרטון");
      });
    }, function (err) {
      var msg = "לא הצלחנו לזהות את השחקן. נשמר סימון בנקודה שנבחרה";
      if (err && err.code === "tainted") {
        msg = "לא ניתן לקרוא את פיקסלי הסרטון. נשמר סימון בתחילת הסרטון";
      }
      return finishPickerWithStatic(v, msg);
    });
  }

  function openTrackPicker(v) {
    if (!v) {
      showToast("לא ניתן לסמן שחקן כרגע");
      return Promise.resolve();
    }
    var blobSrc = v.objectUrl || "";
    var cloudSrc = playableCloudinaryUrl(v.link || "");
    var src = blobSrc || cloudSrc;
    if (!src || !isDirectVideo(src)) {
      showToast("אפשר לסמן שחקן רק בסרטון שהועלה מהמכשיר");
      return Promise.resolve();
    }
    pickerState.cancelled = false;
    pickerState.running = false;
    pickerState.boxes = [];
    pickerState.selected = null;
    pickerState.video = v;
    pickerState.mode = "";
    pickerState.poster = v.poster || posterFromCloudinary(v.link || cloudSrc) || "";
    var overlay = $("track-picker");
    var video = $("track-picker-video");
    var confirm = $("track-picker-confirm");
    overlay.classList.remove("hidden");
    confirm.disabled = true;
    setPickerRunning(false);
    setPickerStatus("");
    setTrackProgress(false, 0);
    updatePickerPoster(pickerState.poster, videoHasFrame(video));
    configureVideoEl(video, src, { poster: pickerState.poster });
    video.onloadedmetadata = function () {
      if (video.videoWidth && video.videoHeight) {
        $("track-picker-stage").style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
      }
      if (isFinite(video.duration) && video.duration) {
        $("track-picker-scrub").value = String(Math.round(((video.currentTime || 0) / video.duration) * 1000));
      }
      updatePickerPoster(pickerState.poster, videoHasFrame(video));
      layoutPicker();
      drawPicker();
    };
    video.onloadeddata = function () {
      updatePickerPoster(pickerState.poster, videoHasFrame(video));
      layoutPicker();
      drawPicker();
    };
    return waitForVideoFrame(video, blobSrc && cloudSrc && cloudSrc !== blobSrc ? cloudSrc : "").then(function (hasFrame) {
      updatePickerPoster(pickerState.poster, hasFrame);
      if (video.videoWidth && video.videoHeight) {
        $("track-picker-stage").style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
      }
      if (isFinite(video.duration) && video.duration) {
        var start = Math.min(0.12, Math.max(0.04, video.duration * 0.02));
        if (window.PadelTrack) {
          return PadelTrack.seekTo(video, start).then(function () {
            $("track-picker-scrub").value = String(Math.round((video.currentTime / video.duration) * 1000));
          });
        }
      }
    }).then(function () {
      layoutPicker();
      drawPicker();
      if (!window.PadelTrack) {
        pickerState.mode = "template";
        setTrackProgress(false, 0);
        setPickerStatus("לחצו על עצמכם בתמונה. נשמור סימון בתחילת הסרטון.");
        return;
      }
      setTrackProgress(true, 0.12, "טוען את מזהה השחקנים…");
      setPickerStatus("");
      return PadelTrack.loadDetector(function (text) {
        if (text) setTrackProgress(true, 0.25, text);
      }).then(function () {
        setTrackProgress(false, 0);
        setPickerStatus("");
        return refreshPickerDetections();
      }).catch(function () {
        setTrackProgress(false, 0);
        pickerState.mode = "template";
        setPickerStatus("לא ניתן לזהות שחקנים אוטומטית. לחצו על עצמכם בתמונה — ננסה לעקוב לפי הנקודה והצבע, ואם לא נוכל יישמר סימון \"אני\" בתחילת הסרטון.");
      });
    }).then(function () {
      layoutPicker();
      drawPicker();
    });
  }

  function videoContentFromTile(tile) {
    var id = tile.getAttribute("data-vid") || "";
    var rec = id && videoRecords.get(id);
    var marker = rec && rec.marker ? rec.marker : parseMarkerAttr(tile.getAttribute("data-marker"));
    return {
      src: tile.getAttribute("data-src") || (rec && (rec.objectUrl || rec.link)) || "",
      poster: tile.getAttribute("data-poster") || (rec && rec.poster) || "",
      trackUrl: tile.getAttribute("data-track-url") || (rec && rec.trackUrl) || "",
      marker: marker,
      track: rec && rec.track ? rec.track : null
    };
  }

  function resolvePlayerTrack(opts) {
    if (opts.track && window.PadelTrack) {
      var unpacked = PadelTrack.unpack(opts.track) || opts.track;
      if (unpacked) return Promise.resolve(unpacked);
    }
    if (opts.trackUrl && window.PadelTrack) {
      return PadelTrack.fetchTrack(opts.trackUrl).catch(function () { return null; });
    }
    if (opts.marker && window.PadelTrack) {
      return Promise.resolve(PadelTrack.staticTrack(opts.marker[0] / 1000, opts.marker[1] / 1000, opts.marker[2] / 1000));
    }
    return Promise.resolve(null);
  }

  function layoutPlayer() {
    var video = $("vp-video");
    var canvas = $("vp-overlay");
    var stage = $("vp-stage");
    if (!video || !canvas || !stage) return null;
    var rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    var dpr = Math.min(3, window.devicePixelRatio || 1);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    return { frame: contentRect(stage, video.videoWidth || 16, video.videoHeight || 9), dpr: dpr };
  }

  function isStaticTrack(track) {
    return !!(track && track.m && (!track.k || !track.k.length));
  }

  function setPlayerHint(track) {
    var hint = $("vp-hint");
    if (!hint) return;
    if (!track) {
      hint.classList.add("hidden");
      hint.textContent = "העיגול מסמן את השחקן בכרטיס";
      return;
    }
    hint.classList.remove("hidden");
    hint.textContent = isStaticTrack(track)
      ? "הסימון \"אני\" מופיע בתחילת הסרטון"
      : "העיגול מסמן את השחקן בכרטיס";
  }

  function updatePlayerChrome() {
    var video = $("vp-video");
    var slider = $("vp-seek");
    var time = $("vp-time");
    var play = $("vp-play");
    if (video && slider && isFinite(video.duration) && video.duration) {
      slider.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
    if (video && time) {
      time.textContent = formatDuration(video.currentTime || 0) + " / " + formatDuration(video.duration || 0);
    }
    if (play) play.textContent = video && !video.paused ? "❚❚" : "▶";
  }

  function drawPlayerOverlay() {
    var video = $("vp-video");
    var canvas = $("vp-overlay");
    updatePlayerChrome();
    if (!video || !canvas) return;
    var layout = layoutPlayer();
    if (!layout) return;
    var ctx = canvas.getContext("2d");
    ctx.setTransform(layout.dpr, 0, 0, layout.dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!playerState.track || !window.PadelTrack) return;
    var pos = PadelTrack.atTime(playerState.track, video.currentTime || 0);
    if (!pos || !pos.visible || pos.fade <= 0.02) return;
    var frame = layout.frame;
    var cx = frame.left + pos.x * frame.w;
    var cy = frame.top + pos.y * frame.h;
    var r = Math.max(10, pos.r * frame.w);
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.75 * pos.fade;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = "#c8ff3c";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "rgba(200, 255, 60, 0.12)";
    ctx.fill();
    ctx.font = "800 14px Heebo, sans-serif";
    ctx.fillStyle = "#c8ff3c";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(pos.static ? "אני" : "אני", cx, cy - r - 6);
    ctx.restore();
  }

  function tickPlayer() {
    drawPlayerOverlay();
    var video = $("vp-video");
    var slider = $("vp-seek");
    var time = $("vp-time");
    var play = $("vp-play");
    if (video && slider && isFinite(video.duration) && video.duration) {
      slider.value = String(Math.round((video.currentTime / video.duration) * 1000));
    }
    if (video && time) {
      time.textContent = formatDuration(video.currentTime || 0) + " / " + formatDuration(video.duration || 0);
    }
    if (play) play.textContent = video && !video.paused ? "❚❚" : "▶";
    if (video && !video.paused) {
      playerState.raf = requestAnimationFrame(tickPlayer);
    } else {
      playerState.raf = 0;
    }
  }

  function closeVideoPlayer() {
    var overlay = $("video-player");
    var video = $("vp-video");
    var shell = $("vp-shell");
    if (playerState.raf) cancelAnimationFrame(playerState.raf);
    playerState.raf = 0;
    playerState.track = null;
    playerState.expanded = false;
    if (shell) shell.classList.remove("is-expanded");
    if (video) {
      try { video.pause(); } catch (err) {}
      video.removeAttribute("src");
      video.load();
    }
    if (overlay) overlay.classList.add("hidden");
  }

  function expandPlayerView(on) {
    var shell = $("vp-shell");
    playerState.expanded = !!on;
    if (shell) shell.classList.toggle("is-expanded", !!on);
    $("vp-expand").textContent = on ? "↙" : "⛶";
    requestAnimationFrame(function () { drawPlayerOverlay(); });
  }

  function blockNativeFullscreen(video) {
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.playsInline = true;
    video.controls = false;
    try { video.controlsList = "nofullscreen nodownload noremoteplayback"; } catch (err) {}
    var exit = function () {
      try {
        if (video.webkitDisplayingFullscreen && video.webkitExitFullscreen) video.webkitExitFullscreen();
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
      } catch (err) {}
      expandPlayerView(true);
    };
    video.addEventListener("webkitbeginfullscreen", function (ev) {
      ev.preventDefault();
      exit();
    });
    video.addEventListener("fullscreenchange", function () {
      if (document.fullscreenElement === video) exit();
    });
  }

  function openVideoPlayer(opts) {
    opts = opts || {};
    var src = playableCloudinaryUrl(opts.src || "") || opts.src;
    if (!src) return;
    var overlay = $("video-player");
    var video = $("vp-video");
    overlay.classList.remove("hidden");
    expandPlayerView(false);
    playerState.src = src;
    playerState.track = null;
    setPlayerHint(null);
    configureVideoEl(video, src, { poster: opts.poster || posterFromCloudinary(src) || "" });
    video.muted = false;
    video.defaultMuted = false;
    blockNativeFullscreen(video);
    video.onloadedmetadata = function () {
      if (video.videoWidth && video.videoHeight) {
        $("vp-stage").style.aspectRatio = video.videoWidth + " / " + video.videoHeight;
      }
      drawPlayerOverlay();
    };
    video.onloadeddata = function () { drawPlayerOverlay(); };
    resolvePlayerTrack(opts).then(function (track) {
      playerState.track = track;
      setPlayerHint(track);
      drawPlayerOverlay();
      var rec = (state.videos || []).find(function (x) {
        if (!x) return false;
        if (opts.trackUrl && x.trackUrl === opts.trackUrl) return true;
        var link = playableCloudinaryUrl(x.link || "") || x.link || x.objectUrl || "";
        return !!(link && src && link === src);
      });
      if (rec && state.profile) {
        maybeRefreshStaleTrack(rec).then(function (fresh) {
          if (fresh && playerState.src === src) {
            playerState.track = fresh;
            setPlayerHint(fresh);
            drawPlayerOverlay();
          }
        });
      }
    });
    waitForVideoFrame(video, "", true).then(function () {
      drawPlayerOverlay();
    });
    var play = video.play();
    if (play && play.catch) play.catch(function () {});
    if (!playerState.raf) playerState.raf = requestAnimationFrame(tickPlayer);
    setTimeout(function () { drawPlayerOverlay(); }, 250);
    setTimeout(function () { drawPlayerOverlay(); }, 800);
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
      '<label class="btn btn-primary" id="card-photo-upload-label" for="card-photo-file">' +
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
      tenure: normalizeTenure(segValue("tenure")),
      style: segValue("style"),
      shots: checkedValues("shots"),
      ai: cleanAi(state.profile && state.profile.ai),
      lr: cleanLr(state.profile && state.profile.lr)
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
      ? '<p class="ut-section">חוזקות</p><div class="ut-shots">' + shots.map(function (s) {
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
      vidHtml = videosToggleHtml(videos);
    } else if (!opts.compact) {
      vidHtml += '<p class="empty-videos">עדיין אין סרטונים בכרטיס.</p>';
    } else {
      vidHtml = "";
    }

    var aiOverall = overallAiForCard(card);
    var ratingLine = ratingLineHtml(level) + aiRatingHtml(aiOverall, opts, card);
    if (opts.allowReupload && !opts.compact) vidHtml += aiCtaHtml(card);

    art.innerHTML =
      '<div class="ut-hero' + (photo ? " has-photo" : "") + '">' +
        (photo ? photoImgTag(photo, opts.compact ? "heroCompact" : "hero", "ut-hero-img", p.name) : "") +
        '<div class="ut-hero-fallback">' + escapeHtml(initials(p.name)) + "</div>" +
        '<div class="ut-hero-shade"></div>' +
        '<div class="ut-hero-content">' +
          '<div class="ut-id"><h1>' + escapeHtml(p.name) + "</h1><p>" + escapeHtml(identity.join(" · ")) + "</p></div>" +
          heroBadgeHtml(level, aiOverall, p.lr) +
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
      '<span class="ut-rating-label">רמה לפי השאלון</span>' +
      '<strong class="ut-rating-value" dir="ltr">' + escapeHtml(text) + "</strong>" +
      "</div>";
  }

  /* ---------- Collapsible videos section (v13) ---------- */
  // Default collapsed; the choice is remembered for the browser session.
  var VIDEOS_OPEN_KEY = "padelCard.videosOpen";
  var videosSectionSeq = 0;

  function videosOpenPref() {
    try { return sessionStorage.getItem(VIDEOS_OPEN_KEY) === "1"; } catch (err) { return false; }
  }

  function videosToggleHtml(videos) {
    var open = videosOpenPref();
    var id = "ut-vids-" + (++videosSectionSeq);
    var thumbs = videos.slice(0, 3).map(function (v) {
      var t = v.poster || posterFromCloudinary(v.link || "");
      return '<span class="ut-vid-peek">' + (t ? '<img alt="" src="' + escapeHtml(t) + '">' : "") + "</span>";
    }).join("");
    return '<div class="ut-vids' + (open ? " is-open" : "") + '">' +
      '<button type="button" class="ut-vid-toggle" aria-expanded="' + (open ? "true" : "false") + '" aria-controls="' + id + '">' +
        '<span class="ut-vid-title">סרטוני משחק <b>(' + videos.length + ")</b></span>" +
        '<span class="ut-vid-peeks" aria-hidden="true">' + thumbs + "</span>" +
        '<span class="ut-vid-hint">' + (open ? "הסתרה" : "הצגה") + "</span>" +
        '<span class="ut-vid-chev" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="ut-vid-body" id="' + id + '"' + (open ? "" : " inert") + '><div class="ut-vid-inner">' +
        '<div class="video-list">' + videos.map(videoTileHtml).join("") + "</div>" +
      "</div></div>" +
    "</div>";
  }

  function setVideosOpen(wrap, open) {
    var btn = wrap.querySelector(".ut-vid-toggle");
    var body = wrap.querySelector(".ut-vid-body");
    wrap.classList.toggle("is-open", open);
    if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
    var hint = wrap.querySelector(".ut-vid-hint");
    if (hint) hint.textContent = open ? "הסתרה" : "הצגה";
    if (body) {
      if (open) body.removeAttribute("inert");
      else body.setAttribute("inert", "");
    }
    if (!open) {
      wrap.querySelectorAll("video").forEach(function (v) { try { v.pause(); } catch (err) {} });
    }
  }

  document.addEventListener("click", function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest(".ut-vid-toggle");
    if (!btn) return;
    var wrap = btn.closest(".ut-vids");
    var open = !wrap.classList.contains("is-open");
    try { sessionStorage.setItem(VIDEOS_OPEN_KEY, open ? "1" : "0"); } catch (err) {}
    // Keep every videos section on the page (e.g. both pair columns) in the same state.
    document.querySelectorAll(".ut-vids").forEach(function (w) { setVideosOpen(w, open); });
  });

  /* ---------- AI Rating (v13: per-video analysis + deterministic combine) ---------- */
  // Overall result, stored compactly in profile.ai and the share-link hash:
  //   { l: "C1", c: 0|1|2, n: videos, t: total seconds, d: yymmdd, e: "≤200 chars", s: [8 sub-scores 0–10 | null] }
  // Per-video result, stored on each video (v.ai; link item field "a"):
  //   { h: video+track key, l, c: model confidence for this clip, t: seconds, d, s: [8], e (localStorage only), lg: 1 if migrated from v12 }
  var AI_CONF = [
    { key: "low", label: "ביטחון נמוך" },
    { key: "medium", label: "ביטחון בינוני" },
    { key: "high", label: "ביטחון גבוה" }
  ];
  var AI_SUBS = [
    { key: "volley", label: "וולי", group: "tech" },
    { key: "bandeja", label: "בנדחה", group: "tech" },
    { key: "vibora", label: "ויבורה", group: "tech" },
    { key: "smash", label: "סמאש", group: "tech" },
    { key: "wall_play", label: "משחק קירות" },
    { key: "positioning", label: "מיקום מול השותף" },
    { key: "consistency", label: "עקביות" },
    { key: "rally_pace", label: "קצב ראלי" }
  ];
  var AI_TIMING = { msPerVideoSecond: 2700, overheadMs: 8000, unknownDurationSec: 60 };
  // Test hook: localStorage "padelCard.aiTiming" = {"msPerVideoSecond":…, "overheadMs":…}
  try { Object.assign(AI_TIMING, JSON.parse(localStorage.getItem("padelCard.aiTiming") || "{}")); } catch (err) {}
  var aiState = { warmed: false, justRated: false };
  var aiRun = null; // { running, stage, items: [...], startedAt, summary }

  function aiLevelIndex(id) {
    for (var i = 0; i < PadelQuiz.LEVELS.length; i++) if (PadelQuiz.LEVELS[i].id === id) return i;
    return -1;
  }

  function cleanScores(arr) {
    var out = (Array.isArray(arr) ? arr : []).slice(0, AI_SUBS.length).map(function (v) {
      if (v === null || v === undefined || v === "") return null;
      var n = Number(v);
      return isFinite(n) ? Math.max(0, Math.min(10, Math.round(n))) : null;
    });
    while (out.length < AI_SUBS.length) out.push(null);
    return out;
  }

  function cleanConf(c) {
    c = Number(c);
    return c === 0 || c === 1 || c === 2 ? c : 0;
  }

  function cleanAi(ai) {
    if (!ai || typeof ai !== "object") return null;
    if (!PadelQuiz.levelById(ai.l)) return null;
    var out = {
      l: ai.l,
      c: cleanConf(ai.c),
      n: Math.max(1, Math.min(9, Math.round(Number(ai.n) || 1))),
      d: Math.round(Number(ai.d) || 0),
      e: String(ai.e || "").slice(0, 200),
      s: cleanScores(ai.s)
    };
    var t = Math.round(Number(ai.t) || 0);
    if (t > 0) out.t = t;
    return out;
  }

  function cleanVideoAi(a, keepText) {
    if (!a || typeof a !== "object" || !PadelQuiz.levelById(a.l)) return null;
    var out = {
      h: String(a.h || "").slice(0, 16),
      l: a.l,
      c: cleanConf(a.c),
      t: Math.max(0, Math.round(Number(a.t) || 0)),
      d: Math.round(Number(a.d) || 0),
      s: cleanScores(a.s)
    };
    if (keepText && a.e) out.e = String(a.e).slice(0, 200);
    if (a.lg) out.lg = 1;
    return out;
  }

  function todayYmd() {
    var now = new Date();
    return (now.getFullYear() % 100) * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  }

  function hashStr(str) {
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = (h1 * 33) ^ ch;
      h2 = (h2 * 33) ^ ch;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36).slice(0, 3);
  }

  // Cloudinary public id (transformations and version stripped) or the plain URL.
  function videoIdentity(url) {
    url = String(url || "");
    var i = url.indexOf("/upload/");
    if (!isCloudinaryVideo(url) || i < 0) return url.split("?")[0];
    var parts = url.slice(i + 8).split("?")[0].split("/").filter(function (seg) {
      return seg && !/^v\d+$/.test(seg) && !/,/.test(seg) && !/^[a-z]{1,3}_[^/]*$/.test(seg);
    });
    return parts.join("/").replace(/\.[a-z0-9]{2,5}$/i, "");
  }

  function trackSignature(v) {
    if (v.trackUrl) return "u:" + v.trackUrl;
    if (v.track) { try { return "k:" + JSON.stringify(v.track); } catch (err) {} }
    if (v.marker) return "m:" + (v.marker || []).join(",");
    return "";
  }

  function aiVideoKey(v) {
    return hashStr(videoIdentity(v.link) + "|" + trackSignature(v));
  }

  function videoSeconds(v) {
    var d = Number(v.duration) || 0;
    if (!d && v.track && v.track.d) d = v.track.d / 100;
    return d;
  }

  function aiEligibleVideos(videos) {
    return (videos || []).filter(function (v) {
      return v.link && isCloudinaryVideo(v.link) || (v.link && isDirectVideo(v.link) && /^https?:/i.test(v.link));
    });
  }

  function videoIsMarked(v) {
    return !!(v.trackUrl || v.track || v.marker);
  }

  function isLocalVideoList(videos) {
    return videos === state.videos;
  }

  // A per-video result counts only while it still matches the video + its marking.
  // Shared links carry results without the track itself, so they are trusted as-is.
  function validVideoAi(v, validate) {
    if (!v || !v.ai) return null;
    if (validate && v.ai.h && v.ai.h !== aiVideoKey(v)) return null;
    return v.ai;
  }

  // Deterministic, explainable combine:
  //   weight = clip seconds (min 10) × confidence weight (low 1, medium 2, high 3)
  //   level = weighted mean of level positions on the quiz scale, rounded
  //   sub-scores = weighted mean over clips where the aspect was seen
  //   confidence = weighted mean, capped by total footage (<2 min → low, <5 min → at most medium),
  //                one step lower if clips disagree by 3+ levels
  //   explanation = the one from the clip with the largest weight
  function combineAi(results) {
    if (!results.length) return null;
    var CW = [1, 2, 3];
    var totalW = 0, lvl = 0, conf = 0, total = 0, best = null, bestW = -1, minI = 99, maxI = -1;
    var sums = AI_SUBS.map(function () { return 0; }), ws = AI_SUBS.map(function () { return 0; });
    results.forEach(function (r) {
      var idx = aiLevelIndex(r.l);
      if (idx < 0) return;
      var w = Math.max(10, r.t || 0) * CW[cleanConf(r.c)];
      totalW += w;
      lvl += w * idx;
      conf += w * cleanConf(r.c);
      total += r.t || 0;
      minI = Math.min(minI, idx);
      maxI = Math.max(maxI, idx);
      if (w > bestW) { bestW = w; best = r; }
      (r.s || []).forEach(function (v, i) {
        if (v === null || v === undefined) return;
        sums[i] += w * v;
        ws[i] += w;
      });
    });
    if (!totalW) return null;
    var c = Math.round(conf / totalW);
    if (total < 120) c = 0;
    else if (total < 300) c = Math.min(c, 1);
    if (maxI - minI >= 3) c = Math.max(0, c - 1);
    var latest = 0;
    results.forEach(function (r) { latest = Math.max(latest, r.d || 0); });
    return cleanAi({
      l: PadelQuiz.LEVELS[Math.round(lvl / totalW)].id,
      c: c,
      n: results.length,
      t: Math.round(total),
      d: latest || todayYmd(),
      e: (best && best.e) || "",
      s: sums.map(function (s, i) { return ws[i] ? Math.round(s / ws[i]) : null; })
    });
  }

  // Overall rating shown on a card. Falls back to a stored (e.g. v12) overall
  // only when no video carries a per-video result at all.
  function overallAiForCard(card) {
    if (!card) return null;
    var p = card.profile || {};
    var videos = card.videos || [];
    var validate = isLocalVideoList(videos);
    var anyPerVideo = videos.some(function (v) { return !!v.ai; });
    if (!anyPerVideo) return cleanAi(p.ai || card.ai);
    var results = [];
    aiEligibleVideos(videos).forEach(function (v) {
      var a = validVideoAi(v, validate);
      if (a) results.push(Object.assign({}, a, { e: a.e || "" }));
    });
    var combined = combineAi(results);
    if (combined && !combined.e) {
      var stored = cleanAi(p.ai);
      if (stored && stored.e && results.length === 1) combined.e = stored.e;
    }
    return combined;
  }

  // v12 → v13: an overall result from N videos is attached to the first N marked videos
  // (videos are appended in upload order, so those are the ones v12 analysed).
  function migrateLegacyAi() {
    if (!state.profile || !state.profile.ai) return;
    var videos = aiEligibleVideos(state.videos);
    if (!videos.length || videos.some(function (v) { return !!v.ai; })) return;
    var ai = cleanAi(state.profile.ai);
    if (!ai) return;
    var marked = videos.filter(videoIsMarked);
    if (ai.n > marked.length) return;
    marked.slice(0, ai.n).forEach(function (v) {
      v.ai = cleanVideoAi({ h: aiVideoKey(v), l: ai.l, c: ai.c, t: Math.round(videoSeconds(v)), d: ai.d, s: ai.s, e: ai.e, lg: 1 }, true);
    });
  }

  function aiFromServer(res, v) {
    var conf = { low: 0, medium: 1, high: 2 }[res.modelConfidence || res.confidence];
    var subs = res.subscores || {};
    return cleanVideoAi({
      h: aiVideoKey(v),
      l: res.level,
      c: conf == null ? 0 : conf,
      t: Math.round(videoSeconds(v) || res.totalSeconds || 0),
      d: todayYmd(),
      e: res.explanation || "",
      s: AI_SUBS.map(function (k) { return subs[k.key]; })
    }, true);
  }

  function aiDateText(d) {
    if (!d) return "";
    var yy = Math.floor(d / 10000), mm = Math.floor(d / 100) % 100, dd = d % 100;
    return dd + "." + mm + ".20" + (yy < 10 ? "0" : "") + yy;
  }

  function aiVideosText(n) {
    return n === 1 ? "מבוסס על סרטון אחד" : "מבוסס על " + n + " סרטונים";
  }

  function aiBarHtml(sub, v) {
    var seen = v !== null && v !== undefined;
    return '<div class="ai-bar' + (seen ? "" : " is-empty") + '">' +
      '<span class="ai-bar-k">' + escapeHtml(sub.label) + "</span>" +
      '<span class="ai-bar-track"><span class="ai-bar-fill" style="width:' + (seen ? v * 10 : 0) + '%"></span></span>' +
      '<span class="ai-bar-v" dir="ltr">' + (seen ? v + "/10" : "לא נצפה") + "</span>" +
      "</div>";
  }

  function videoThumb(v) {
    return v.poster || posterFromCloudinary(v.link || "") || "";
  }

  function videoLabel(v, i) {
    var sub = [];
    var sec = videoSeconds(v);
    if (sec) sub.push(formatDuration(sec));
    if (v.name && !/^סרטון/.test(v.name)) sub.push(v.name);
    return { title: "סרטון " + (i + 1), sub: sub.join(" · ") };
  }

  function thumbHtml(v, cls) {
    var t = videoThumb(v);
    return '<span class="' + cls + '">' + (t ? '<img alt="" src="' + escapeHtml(t) + '">' : "") + "</span>";
  }

  function aiBasisHtml(card) {
    var videos = aiEligibleVideos(card.videos || []);
    var validate = isLocalVideoList(card.videos || []);
    var rows = [];
    videos.forEach(function (v, i) {
      var a = validVideoAi(v, validate);
      if (!a) return;
      var lab = videoLabel(v, i);
      var conf = AI_CONF[a.c] || AI_CONF[0];
      rows.push('<li class="ai-basis-row">' + thumbHtml(v, "ai-thumb") +
        '<span class="ai-basis-txt"><b>' + escapeHtml(lab.title) + "</b>" + (lab.sub ? "<small>" + escapeHtml(lab.sub) + "</small>" : "") + "</span>" +
        '<span class="ai-basis-lv" dir="ltr">' + escapeHtml(a.l) + "</span>" +
        '<span class="ai-dot conf-' + conf.key + '" title="' + conf.label + '"></span>' +
        "</li>");
    });
    if (!rows.length) return "";
    return '<p class="ut-ai-group">מבוסס על</p><ul class="ai-basis">' + rows.join("") + "</ul>";
  }

  function aiRatingHtml(ai, opts, card) {
    if (!ai) return "";
    var level = PadelQuiz.levelById(ai.l);
    var conf = AI_CONF[ai.c] || AI_CONF[0];
    var tech = [], rest = [];
    AI_SUBS.forEach(function (sub, i) {
      (sub.group === "tech" ? tech : rest).push(aiBarHtml(sub, ai.s[i]));
    });
    var basis = card ? aiBasisHtml(card) : "";
    var details =
      '<div class="ut-ai-details" hidden>' +
        (ai.e ? '<p class="ut-ai-expl">' + escapeHtml(ai.e) + "</p>" : "") +
        '<p class="ut-ai-group">טכניקה</p>' + tech.join("") +
        '<p class="ut-ai-group">משחק</p>' + rest.join("") +
        basis +
        '<p class="ut-ai-foot">' + (ai.n > 1 ? "הרמה הכוללת היא ממוצע משוקלל לפי אורך כל סרטון ורמת הביטחון בו. " : "") +
          "הערכה אוטומטית מהסרטונים" + (ai.t ? " (" + formatDuration(ai.t) + " דק׳ משחק)" : "") + (ai.d ? " · " + aiDateText(ai.d) : "") + ". לא דירוג רשמי.</p>" +
      "</div>";
    return '<div class="ut-ai' + (opts && opts.compact ? " compact" : "") + '">' +
      '<button type="button" class="ut-ai-line" aria-expanded="false">' +
        '<span class="ut-ai-main">' +
          '<span class="ut-ai-label"><span class="ut-ai-spark" aria-hidden="true">✦</span>AI Rating</span>' +
          '<span class="ut-ai-meta"><span class="ai-conf conf-' + conf.key + '">' + conf.label + "</span>" +
          '<span class="ai-count">' + aiVideosText(ai.n) + "</span></span>" +
        "</span>" +
        '<strong class="ut-ai-value" dir="ltr">' + escapeHtml(ratingText(level)) + "</strong>" +
        '<span class="ut-ai-chev" aria-hidden="true"></span>' +
      "</button>" +
      details +
    "</div>";
  }

  /* Which videos still need analysis. */
  function aiPlan(card) {
    var videos = aiEligibleVideos(card.videos || []);
    var validate = isLocalVideoList(card.videos || []);
    var plan = { all: videos, done: [], pending: [], unmarked: [] };
    videos.forEach(function (v) {
      if (validVideoAi(v, validate)) plan.done.push(v);
      else if (videoIsMarked(v)) plan.pending.push(v);
      else plan.unmarked.push(v);
    });
    return plan;
  }

  var AI_STATUS = {
    done: { text: "נותח", cls: "st-done" },
    cached: { text: "נותח", cls: "st-done" },
    running: { text: "מנתח עכשיו…", cls: "st-running" },
    waiting: { text: "ממתין", cls: "st-waiting" },
    failed: { text: "נכשל", cls: "st-failed" },
    idle: { text: "טרם נותח", cls: "st-waiting" },
    unmarked: { text: "לא מסומן", cls: "st-unmarked" }
  };

  function aiItemRowHtml(item) {
    var st = AI_STATUS[item.status] || AI_STATUS.waiting;
    var lab = videoLabel(item.v, item.idx);
    var showBar = item.status === "running";
    var note = item.status === "cached" ? "מניתוח קודם" : item.status === "failed" ? (item.error || "") : item.status === "unmarked" ? "סמנו את עצמכם כדי לנתח" : "";
    return '<li class="ai-run-row ' + st.cls + '" data-run-idx="' + item.idx + '">' +
      thumbHtml(item.v, "ai-thumb") +
      '<span class="ai-run-txt"><b>' + escapeHtml(lab.title) + "</b>" +
        '<small class="ai-run-sub">' + escapeHtml([lab.sub, note].filter(Boolean).join(" · ")) + "</small>" +
        (showBar ? '<span class="ai-run-mini"><span class="ai-run-mini-fill" style="width:' + Math.round((item.frac || 0) * 100) + '%"></span></span>' : "") +
      "</span>" +
      '<span class="ai-st">' + (item.status === "running" ? '<span class="ai-spinner sm" aria-hidden="true"></span>' : item.status === "done" || item.status === "cached" ? '<span class="ai-check" aria-hidden="true"></span>' : "") + st.text + "</span>" +
    "</li>";
  }

  function aiRunPct() {
    if (!aiRun) return 0;
    var queue = aiRun.items.filter(function (it) { return it.queued; });
    var tot = 0, got = 0;
    queue.forEach(function (it) {
      tot += it.expectedMs;
      got += it.expectedMs * (it.status === "done" || it.status === "failed" ? 1 : (it.frac || 0));
    });
    return tot ? Math.min(aiRun.running ? 99 : 100, Math.round(100 * got / tot)) : 0;
  }

  function aiRunStageText() {
    if (!aiRun) return "";
    if (!aiRun.running) return aiRun.summary || "";
    if (aiRun.stage === "wake") return "מעיר את השרת…";
    var queue = aiRun.items.filter(function (it) { return it.queued; });
    var cur = aiRun.items.filter(function (it) { return it.status === "running"; })[0];
    if (!cur) return "מנתח…";
    var pos = queue.indexOf(cur) + 1;
    return (cur.preparing ? "מכין את " : "מנתח את ") + "סרטון " + (cur.idx + 1) + " · " + pos + " מתוך " + queue.length;
  }

  function aiRunPanelHtml() {
    var pct = aiRunPct();
    return '<div class="ai-run' + (aiRun.running ? " is-running" : " is-finished") + '" id="ai-run" aria-live="polite">' +
      '<div class="ai-run-head"><span class="ai-run-title"><span class="ut-ai-spark" aria-hidden="true">✦</span>' + (aiRun.running ? "ניתוח AI" : "הניתוח הסתיים") + "</span>" +
        '<span class="ai-run-pct" dir="ltr" id="ai-run-pct">' + pct + "%</span></div>" +
      '<div class="ai-run-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span class="ai-run-fill" id="ai-run-fill" style="width:' + pct + '%"></span></div>' +
      '<p class="ai-run-stage" id="ai-run-stage">' + escapeHtml(aiRunStageText()) + "</p>" +
      '<ul class="ai-run-list" id="ai-run-list">' + aiRun.items.map(aiItemRowHtml).join("") + "</ul>" +
      (aiRun.running ? '<p class="ut-ai-hint">אפשר להישאר בעמוד. כל סרטון שמסתיים נשמר מיד בכרטיס.</p>' : "") +
    "</div>";
  }

  function aiIdleListHtml(plan) {
    if (plan.all.length < 2 && !plan.unmarked.length) return "";
    var items = plan.all.map(function (v, i) {
      var status = plan.done.indexOf(v) >= 0 ? "cached" : plan.unmarked.indexOf(v) >= 0 ? "unmarked" : "idle";
      return { v: v, idx: i, status: status };
    });
    return '<ul class="ai-run-list idle">' + items.map(aiItemRowHtml).join("") + "</ul>";
  }

  function aiCtaHtml(card) {
    var plan = aiPlan(card);
    if (!plan.all.length) return "";
    if (aiRun) return '<div class="ut-ai-cta">' + aiRunPanelHtml() + (aiRun.running ? "" : aiButtonsHtml(plan)) + "</div>";
    return '<div class="ut-ai-cta">' + aiButtonsHtml(plan) + aiIdleListHtml(plan) +
      '<p class="ut-ai-hint">' + (plan.pending.length
        ? "ה-AI צופה בסרטונים שבהם סימנת את עצמך ומעריך את הרמה. רק סרטונים שעוד לא נותחו יישלחו. כדאי לפחות 2 דקות משחק בסך הכול."
        : plan.done.length ? "כל סרטון מנותח פעם אחת. סרטון חדש או סימון מחדש ינותחו בלחיצה הבאה." : "סמנו את עצמכם בסרטון כדי לקבל AI Rating.") + "</p>" +
    "</div>";
  }

  function aiButtonsHtml(plan) {
    if (plan.pending.length) {
      var label = plan.done.length ? "נתח סרטונים חדשים (" + plan.pending.length + ")" : "קבל AI Rating" + (plan.pending.length > 1 ? " (" + plan.pending.length + " סרטונים)" : "");
      return '<button type="button" class="btn btn-ai" id="ai-rate-btn" data-mode="new"><span class="ut-ai-spark" aria-hidden="true">✦</span><span>' + label + "</span></button>";
    }
    if (plan.done.length) {
      return '<button type="button" class="btn btn-ai is-complete" id="ai-rate-btn" data-mode="none" aria-disabled="true"><span class="ai-check" aria-hidden="true"></span><span>כל הסרטונים נותחו</span></button>' +
        '<button type="button" class="ai-reanalyze" id="ai-reanalyze-btn">ניתוח מחדש של כל הסרטונים</button>';
    }
    return '<button type="button" class="btn btn-ai" id="ai-rate-btn" data-mode="unmarked"><span class="ut-ai-spark" aria-hidden="true">✦</span><span>קבל AI Rating</span></button>';
  }

  /* Clothing colours from the first frame, inside the marked start box.
     Indoor courts are often lit/filmed with a strong blue cast (blue floor, glass, mesh),
     so in a blue-cast frame blue-ish pixels are read by lightness only: dark → black,
     very light → white, otherwise ignored. The server labels these as "may be wrong". */
  function rgbToColorName(r, g, b, blueCast) {
    var max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    var l = (max + min) / 2;
    var d = max - min;
    var s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (l < 0.16) return "black";
    if (s < 0.16) return l > 0.75 ? "white" : l < 0.3 ? "black" : "gray";
    if (l > 0.88) return "white";
    var h;
    var R = r / 255, G = g / 255, B = b / 255;
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    if (blueCast && h >= 180 && h < 250) {
      if (l < 0.3) return "black";
      if (l > 0.66) return "white";
      return "";
    }
    if (h < 15 || h >= 340) return l > 0.7 ? "pink" : "red";
    if (h < 40) return l < 0.35 ? "brown" : (s < 0.45 && l > 0.6 ? "beige" : "orange");
    if (h < 68) return "yellow";
    if (h < 160) return "green";
    if (h < 195) return "turquoise";
    if (h < 250) return l < 0.3 ? "navy" : "blue";
    if (h < 290) return "purple";
    return "pink";
  }

  function frameHasBlueCast(ctx, W, H) {
    var data;
    try { data = ctx.getImageData(0, 0, W, H).data; } catch (err) { return false; }
    var r = 0, b = 0, n = 0;
    for (var i = 0; i < data.length; i += 4 * 16) { r += data[i]; b += data[i + 2]; n++; }
    return n > 0 && b / n > 1.5 * (r / n) + 20;
  }

  function dominantColor(ctx, x, y, w, h, blueCast) {
    x = Math.max(0, Math.round(x)); y = Math.max(0, Math.round(y));
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var data;
    try { data = ctx.getImageData(x, y, w, h).data; } catch (err) { return ""; }
    var counts = {}, total = 0;
    for (var i = 0; i < data.length; i += 4) {
      var name = rgbToColorName(data[i], data[i + 1], data[i + 2], blueCast);
      total++;
      if (!name) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
    var best = "", bestN = 0;
    Object.keys(counts).forEach(function (k) { if (counts[k] > bestN) { best = k; bestN = counts[k]; } });
    return bestN / Math.max(1, total) >= 0.35 ? best : "";
  }

  function sampleAppearance(src, box, t) {
    return new Promise(function (resolve) {
      if (!box || !src) { resolve(null); return; }
      var video = document.createElement("video");
      var done = false;
      var finish = function (val) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { video.removeAttribute("src"); video.load(); } catch (err) {}
        resolve(val);
      };
      var timer = setTimeout(function () { finish(null); }, 9000);
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.addEventListener("error", function () { finish(null); });
      video.addEventListener("loadeddata", function () {
        try { video.currentTime = Math.max(0.05, t || 0.05); } catch (err) { finish(null); }
      }, { once: true });
      video.addEventListener("seeked", function () {
        try {
          var W = Math.min(960, video.videoWidth || 960);
          var H = Math.round(W * (video.videoHeight || 540) / (video.videoWidth || 960));
          var c = document.createElement("canvas");
          c.width = W; c.height = H;
          var ctx = c.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(video, 0, 0, W, H);
          var bx = box.x * W, by = box.y * H, bw = box.w * W, bh = box.h * H;
          var cast = frameHasBlueCast(ctx, W, H);
          var top = dominantColor(ctx, bx + bw * 0.3, by + bh * 0.2, bw * 0.4, bh * 0.3, cast);
          var bottom = dominantColor(ctx, bx + bw * 0.3, by + bh * 0.66, bw * 0.4, bh * 0.14, cast);
          finish(top || bottom ? { top: top, bottom: bottom } : null);
        } catch (err) { finish(null); }
      }, { once: true });
      video.src = src;
      try { video.load(); } catch (err) {}
    });
  }

  function trackForAi(v) {
    if (v.track && typeof v.track === "object" && (v.track.k || v.track.m)) return Promise.resolve(v.track);
    if (!v.trackUrl) return Promise.resolve(null);
    return fetch(v.trackUrl, { mode: "cors" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  function prepareAiVideo(v) {
    return trackForAi(v).then(function (packed) {
      var item = { videoUrl: v.link, duration: v.duration || (packed && packed.d ? packed.d / 100 : 0) };
      if (packed) item.track = packed;
      else if (v.trackUrl) item.trackUrl = v.trackUrl;
      var unpacked = packed && window.PadelTrack ? PadelTrack.unpack(packed) : null;
      var box = unpacked && unpacked.startBox;
      if (!box) return item;
      var src = playableCloudinaryUrl(v.link) || v.link;
      return sampleAppearance(src, box, unpacked.t0 || 0).then(function (look) {
        if (look) item.appearance = look;
        return item;
      });
    });
  }

  /* ---------- Top badge: quiz level, or a quiz/AI range ---------- */
  // 1 step apart → range shown automatically. 2+ steps → owner is asked once per (AI level, quiz level);
  // the decision is stored as profile.lr = { a: AI level, q: quiz level, ok: 1|0 } (also in the share link).
  function cleanLr(lr) {
    if (!lr || typeof lr !== "object" || !PadelQuiz.levelById(lr.a) || !PadelQuiz.levelById(lr.q)) return null;
    return { a: lr.a, q: lr.q, ok: lr.ok ? 1 : 0 };
  }

  // Range proposed when AI is 2+ steps away: the AI level and its neighbour towards the quiz level.
  function proposedRange(qIdx, aIdx) {
    var other = aIdx + (qIdx > aIdx ? 1 : -1);
    return { lo: Math.min(aIdx, other), hi: Math.max(aIdx, other) };
  }

  function levelBadgeInfo(quizId, ai, lr) {
    var q = aiLevelIndex(quizId);
    var a = ai ? aiLevelIndex(ai.l) : -1;
    var L = PadelQuiz.LEVELS;
    var res = { kind: "quiz", lo: q, hi: q, gap: a < 0 ? 0 : Math.abs(a - q), aIdx: a, qIdx: q };
    if (q < 0 || a < 0 || a === q) return res;
    if (Math.abs(a - q) === 1) {
      res.kind = "range";
      res.lo = Math.min(a, q);
      res.hi = Math.max(a, q);
      return res;
    }
    lr = cleanLr(lr);
    res.kind = "far";
    res.decided = !!(lr && lr.a === L[a].id && lr.q === L[q].id);
    if (res.decided && lr.ok) {
      var r = proposedRange(q, a);
      res.kind = "accepted";
      res.lo = r.lo;
      res.hi = r.hi;
    }
    return res;
  }

  function rangeText(lo, hi) {
    var L = PadelQuiz.LEVELS;
    return L[lo].id + "-" + L[hi].id;
  }

  function heroBadgeHtml(level, ai, lr) {
    var info = levelBadgeInfo(level.id, ai, lr);
    if (info.kind === "range" || info.kind === "accepted") {
      var L = PadelQuiz.LEVELS;
      return '<div class="' + badgeClass(L[info.lo].id) + ' is-range" title="טווח לפי השאלון וה-AI"><b dir="ltr">' +
        escapeHtml(L[info.lo].id) + '<i>-</i>' + escapeHtml(L[info.hi].id) + "</b><span>שאלון + AI</span></div>";
    }
    return '<div class="' + badgeClass(level.id) + '"><b>' + escapeHtml(level.id) + "</b><span>" + escapeHtml(level.title) + "</span></div>";
  }

  // Wrap level ids (e.g. "C2-C1", "B2") so they don't flip punctuation in RTL text.
  function bidiLevels(text) {
    return escapeHtml(text).replace(/[A-D][12](?:-[A-D][12])?/g, function (m) { return '<bdi dir="ltr">' + m + "</bdi>"; });
  }

  function closeLevelDialog() {
    var el = $("level-dialog");
    if (el) el.remove();
  }

  function setLevelDecision(card, info, ok) {
    var L = PadelQuiz.LEVELS;
    var lr = { a: L[info.aIdx].id, q: L[info.qIdx].id, ok: ok ? 1 : 0 };
    if (state.profile) state.profile.lr = lr;
    if (state.publicCard && viewerOwnsCard(state.publicCard)) {
      state.publicCard.profile.lr = lr;
      try { history.replaceState(null, "", "#/p/" + toBase64Url(JSON.stringify(compactPlayer(state.publicCard, true)))); } catch (err) {}
    }
    persist();
  }

  // Called after a fresh AI result. Asks only when AI is 2+ steps from the quiz and this exact pair wasn't decided yet.
  function maybeAskLevelRange() {
    var card = viewedCardForAi();
    if (!card || !viewerOwnsViewedCard()) return;
    var ai = overallAiForCard(card);
    var p = card.profile || {};
    var info = levelBadgeInfo(card.levelId, ai, p.lr);
    if (info.kind !== "far" || info.decided) return;
    var L = PadelQuiz.LEVELS;
    var r = proposedRange(info.qIdx, info.aIdx);
    var lower = info.aIdx < info.qIdx;
    var range = lower ? L[r.lo].id + "-" + L[r.hi].id : L[r.lo].id + "-" + L[r.hi].id;
    var msg = "ה-AI דירג אותך " + L[info.aIdx].id + ", רחוק מהרמה בשאלון (" + L[info.qIdx].id + "). " +
      (lower ? "להוריד" : "להעלות") + " את הרמה שלך לטווח " + range + "?";
    closeLevelDialog();
    var wrap = document.createElement("div");
    wrap.id = "level-dialog";
    wrap.className = "lvl-dialog";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML =
      '<div class="lvl-dialog-card">' +
        '<div class="lvl-dialog-levels" dir="ltr">' +
          '<span class="lvl-chip quiz"><small>שאלון</small><b>' + escapeHtml(L[info.qIdx].id) + "</b></span>" +
          '<span class="lvl-arrow" aria-hidden="true">' + (lower ? "↘" : "↗") + "</span>" +
          '<span class="lvl-chip ai"><small>AI</small><b>' + escapeHtml(L[info.aIdx].id) + "</b></span>" +
        "</div>" +
        '<p class="lvl-dialog-text">' + bidiLevels(msg) + "</p>" +
        '<p class="lvl-dialog-note">הרמה בשאלון נשארת שמורה, ושתי השורות ממשיכות להופיע בכרטיס.</p>' +
        '<div class="btn-row two">' +
          '<button type="button" class="btn btn-ghost" id="level-dialog-no">לא, להשאיר ' + escapeHtml(L[info.qIdx].id) + "</button>" +
          '<button type="button" class="btn btn-primary" id="level-dialog-yes">כן, ' + escapeHtml(range) + "</button>" +
        "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    $("level-dialog-yes").addEventListener("click", function () {
      setLevelDecision(card, info, true);
      closeLevelDialog();
      rerenderAfterAi();
      showToast("הרמה בכרטיס עודכנה לטווח " + range, 3500);
    });
    $("level-dialog-no").addEventListener("click", function () {
      setLevelDecision(card, info, false);
      closeLevelDialog();
      rerenderAfterAi();
      showToast("הרמה בכרטיס נשארה " + L[info.qIdx].id, 3000);
    });
  }

  function viewedCardForAi() {
    return state.publicCard && viewerOwnsCard(state.publicCard) ? state.publicCard : (state.profile ? currentCardData() : null);
  }

  function aiErrorMessage(err) {
    if (err && err.userMessage) return err.userMessage;
    if (err && err.name === "AbortError") return "הניתוח לקח יותר מדי זמן";
    return "אין חיבור לשרת ה-AI";
  }

  function warmAiServer() {
    if (aiState.warmed) return;
    aiState.warmed = true;
    // Free Render instances sleep when idle; wake it while the owner is looking at the card.
    try { fetch(AI_API.base + "/healthz", { mode: "cors" }).catch(function () {}); } catch (err) {}
  }

  function wakeAiServer() {
    var attempt = function (ms) {
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
      return fetch(AI_API.base + "/healthz", { mode: "cors", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error("health-" + r.status); return r.json(); })
        .catch(function (e) { clearTimeout(timer); throw e; });
    };
    return attempt(70000).catch(function () { return attempt(40000); });
  }

  function expectedMsFor(v) {
    var sec = videoSeconds(v) || AI_TIMING.unknownDurationSec;
    return AI_TIMING.overheadMs + sec * AI_TIMING.msPerVideoSecond;
  }

  // Time-based estimate: linear to 90% at the expected time, then creeps towards 95%.
  function estimateFrac(item) {
    if (!item.startedAt) return 0;
    var r = (Date.now() - item.startedAt) / item.expectedMs;
    if (r < 1) return 0.9 * r;
    return Math.min(0.95, 0.9 + 0.05 * (1 - Math.exp(-(r - 1) * 2)));
  }

  function tickAiRun() {
    if (!aiRun || !aiRun.running) return;
    aiRun.items.forEach(function (it) { if (it.status === "running") it.frac = estimateFrac(it); });
    var pct = aiRunPct();
    var fill = $("ai-run-fill"), pctEl = $("ai-run-pct"), stage = $("ai-run-stage");
    if (fill) {
      fill.style.width = pct + "%";
      fill.parentNode.setAttribute("aria-valuenow", String(pct));
    }
    if (pctEl) pctEl.textContent = pct + "%";
    if (stage) stage.textContent = aiRunStageText();
    aiRun.items.forEach(function (it) {
      if (it.status !== "running") return;
      var row = document.querySelector('.ai-run-row[data-run-idx="' + it.idx + '"] .ai-run-mini-fill');
      if (row) row.style.width = Math.round(it.frac * 100) + "%";
    });
  }

  function refreshAiRunList() {
    var list = $("ai-run-list");
    if (list && aiRun) list.innerHTML = aiRun.items.map(aiItemRowHtml).join("");
    tickAiRun();
  }

  function saveVideoAi(card, v, result) {
    v.ai = result;
    // Owner viewing their own shared link: mirror into the local card too.
    if (!isLocalVideoList(card.videos)) {
      state.videos.forEach(function (lv) {
        if (lv.link && videoIdentity(lv.link) === videoIdentity(v.link)) lv.ai = Object.assign({}, result, { h: aiVideoKey(lv) });
      });
    }
    var overall = overallAiForCard(card);
    if (state.profile) state.profile.ai = overall || state.profile.ai || null;
    if (state.publicCard && viewerOwnsCard(state.publicCard)) {
      state.publicCard.profile.ai = overall;
      try { history.replaceState(null, "", "#/p/" + toBase64Url(JSON.stringify(compactPlayer(state.publicCard, true)))); } catch (err) {}
    }
    persist();
  }

  function analyzeOne(card, item) {
    var p = card.profile || {};
    item.status = "running";
    item.preparing = true;
    item.startedAt = Date.now();
    item.frac = 0;
    refreshAiRunList();
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, AI_API.timeoutMs);
    return prepareAiVideo(item.v).then(function (payload) {
      item.preparing = false;
      return fetch(AI_API.base + "/api/ai-rating", {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: cardOwnerId(card), perVideo: true, videos: [payload], profile: { hand: p.hand, gender: p.gender } }),
        signal: ctrl ? ctrl.signal : undefined
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json || !json.level) {
          var e = new Error(json && json.error || "http-" + res.status);
          e.userMessage = (json && json.message) || "ניתוח ה-AI נכשל";
          e.code = json && json.error;
          throw e;
        }
        return json;
      });
    }).then(function (json) {
      var result = aiFromServer(json, item.v);
      if (!result) throw Object.assign(new Error("bad-result"), { userMessage: "תשובה לא תקינה מה-AI" });
      saveVideoAi(card, item.v, result);
      item.status = "done";
      item.frac = 1;
    }).catch(function (err) {
      console.warn("ai-rating", err);
      item.status = "failed";
      item.error = aiErrorMessage(err);
      item.code = err && err.code;
    }).then(function () {
      clearTimeout(timer);
      item.preparing = false;
      refreshAiRunList();
    });
  }

  function requestAiRating(mode) {
    if (aiRun && aiRun.running) return;
    var card = viewedCardForAi();
    if (!card || !viewerOwnsViewedCard()) return;
    var plan = aiPlan(card);
    if (!plan.all.length) { showToast("העלו סרטון משחק כדי לקבל AI Rating", 3500); return; }
    var queue = mode === "all" ? plan.all.filter(videoIsMarked) : plan.pending;
    if (!queue.length) {
      if (plan.unmarked.length && !plan.done.length) showToast("סמנו את עצמכם בסרטון לפני הניתוח", 3500);
      else showToast("כל הסרטונים כבר נותחו", 2500);
      return;
    }
    aiRun = {
      running: true,
      stage: "wake",
      startedAt: Date.now(),
      items: plan.all.map(function (v, i) {
        var queued = queue.indexOf(v) >= 0;
        var status = queued ? "waiting" : plan.done.indexOf(v) >= 0 ? "cached" : "unmarked";
        return { v: v, idx: i, queued: queued, status: status, expectedMs: expectedMsFor(v), frac: 0 };
      })
    };
    rerenderAfterAi();
    var ticker = setInterval(tickAiRun, 200);
    var queued = aiRun.items.filter(function (it) { return it.queued; });
    wakeAiServer().then(function () {
      aiRun.stage = "video";
      // Sequential: one request per video.
      var stopped = null;
      return queued.reduce(function (chain, item) {
        return chain.then(function () {
          // After a rate-limit/quota answer the next requests would fail too: mark them, don't send.
          if (stopped) { item.status = "failed"; item.error = stopped.error; refreshAiRunList(); return null; }
          return analyzeOne(card, item).then(function () {
            if (item.status === "failed" && (item.code === "rate_limited" || item.code === "ai_quota" || item.code === "not_configured")) stopped = item;
          });
        });
      }, Promise.resolve());
    }, function () {
      queued.forEach(function (it) { it.status = "failed"; it.error = "השרת לא זמין"; });
      throw Object.assign(new Error("wake-failed"), { userMessage: "שרת ה-AI לא זמין כרגע. נסו שוב בעוד דקה" });
    }).then(function () {
      var ok = queued.filter(function (it) { return it.status === "done"; }).length;
      var failed = queued.length - ok;
      aiRun.running = false;
      aiRun.summary = failed
        ? (ok ? ok + " נותחו, " + failed + " נכשלו. אפשר לנסות שוב את מה שנכשל." : "הניתוח נכשל. נסו שוב.")
        : (queued.length === 1 ? "הסרטון נותח והדירוג עודכן." : queued.length + " סרטונים נותחו והדירוג עודכן.");
      if (ok) aiState.justRated = true;
      var firstErr = queued.filter(function (it) { return it.status === "failed"; })[0];
      if (failed) showToast(firstErr && firstErr.error ? firstErr.error + (ok ? " · " + ok + " סרטונים נותחו" : "") : "ניתוח ה-AI נכשל. נסו שוב", 4500);
      else showToast("ה-AI Rating עודכן. שתפו שוב את הקישור כדי שכולם יראו", 4000);
    }).catch(function (err) {
      aiRun.running = false;
      aiRun.summary = "הניתוח לא התחיל.";
      showToast(aiErrorMessage(err), 4500);
    }).then(function () {
      clearInterval(ticker);
      rerenderAfterAi();
      if (aiRun && aiRun.items.some(function (it) { return it.queued && it.status === "done"; })) {
        setTimeout(maybeAskLevelRange, 600);
      }
    });
  }

  function rerenderAfterAi() {
    if (state.view !== "card") return;
    var y = window.scrollY;
    renderCard();
    window.scrollTo(0, y);
    if (aiState.justRated) {
      aiState.justRated = false;
      var line = document.querySelector("#card-root .ut-ai-line");
      if (line) toggleAiDetails(line, true);
    }
  }

  function toggleAiDetails(btn, force) {
    var wrap = btn.closest(".ut-ai");
    var det = wrap && wrap.querySelector(".ut-ai-details");
    if (!det) return;
    var open = typeof force === "boolean" ? force : det.hidden;
    det.hidden = !open;
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    wrap.classList.toggle("is-open", open);
  }

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var line = t.closest(".ut-ai-line");
    if (line) { toggleAiDetails(line); return; }
    var btn = t.closest("#ai-rate-btn");
    if (btn) {
      ev.preventDefault();
      if (btn.getAttribute("data-mode") === "none") { showToast("כל הסרטונים כבר נותחו. אפשר לנתח מחדש מהקישור למטה", 3000); return; }
      requestAiRating("new");
      return;
    }
    if (t.closest("#ai-reanalyze-btn")) { ev.preventDefault(); requestAiRating("all"); }
  });

  window.addEventListener("hashchange", function () { if (aiRun && !aiRun.running) aiRun = null; });

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
    setWhatsAppShare($("wa-share-own"), owns, owns ? urlToCopyForCard() : "", "single");
    $("copy-pair-from-card").classList.toggle("hidden", !local || !partner);
    $("local-card-actions").classList.toggle("hidden", !local);
    $("open-pair").classList.toggle("hidden", !local || !partner);
    var root = $("card-root");
    root.innerHTML = "";
    root.appendChild(createPremiumCard(data, { compact: false, partner: partner, allowReupload: owns }));
    if (owns && aiEligibleVideos(data.videos).length) warmAiServer();
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
    setWhatsAppShare($("wa-share-pair"), owns, owns ? urlToCopyForPair() : "", "pair");
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

  function whatsappShareText(url, kind) {
    var intro = kind === "pair" ? "כרטיס הזוג שלנו בפאדל 🎾" : "הכרטיס שחקן פאדל שלי 🎾";
    return intro + "\n" + url;
  }

  function whatsappShareHref(url, kind) {
    return "https://wa.me/?text=" + encodeURIComponent(whatsappShareText(url, kind));
  }

  function setWhatsAppShare(el, visible, url, kind) {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
    if (visible && url) el.setAttribute("href", whatsappShareHref(url, kind));
    else el.setAttribute("href", "https://wa.me/");
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
    // The transparent <input type=file> already covers its <label>.
    // Do not call input.click() from a label handler: when the tap already
    // hit the input (always, with the overlay), a second programmatic click
    // can open then immediately cancel the iOS picker.
    $("video-file").addEventListener("change", function (ev) {
      // Copy off the live FileList before resetting the input — clearing
      // value empties the live list, which would drop the chosen files.
      var files = ev.target.files ? Array.from(ev.target.files) : [];
      ev.target.value = "";
      addVideoFiles(files);
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
    function armWhatsAppShare(id, urlFn, kind) {
      var el = $(id);
      if (!el) return;
      function syncHref() {
        var url = urlFn();
        if (url) el.href = whatsappShareHref(url, kind);
      }
      ["pointerdown", "touchstart", "click"].forEach(function (evt) {
        el.addEventListener(evt, syncHref);
      });
    }
    armWhatsAppShare("wa-share-own", urlToCopyForCard, "single");
    armWhatsAppShare("wa-share-pair", urlToCopyForPair, "pair");
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
      if (!tile) return;
      if (!ev.target.closest(".ut-play-btn, .ut-video-poster, .ut-video-tile, .ut-track-badge")) return;
      ev.preventDefault();
      var info = videoContentFromTile(tile);
      if (!info.src) return;
      openVideoPlayer(info);
    });
    $("track-picker-skip").addEventListener("click", function () {
      if (pickerState.video) finishPickerWithStatic(pickerState.video);
      else closeTrackPicker();
    });
    $("track-picker-confirm").addEventListener("click", function () {
      if (pickerState.video) runTracking(pickerState.video);
    });
    $("track-picker-cancel-run").addEventListener("click", function () {
      pickerState.cancelled = true;
    });
    $("track-picker-scrub").addEventListener("input", onPickerScrub);
    $("track-picker-scrub").addEventListener("change", onPickerScrub);
    $("track-picker-scrub").addEventListener("touchend", onPickerScrub);
    var lastPickerTap = 0;
    var handlePickerTap = function (ev) {
      if (Date.now() - lastPickerTap < 350) return;
      lastPickerTap = Date.now();
      onPickerTap(ev);
    };
    $("track-picker-canvas").addEventListener("pointerup", handlePickerTap);
    $("track-picker-canvas").addEventListener("click", handlePickerTap);
    $("track-picker").addEventListener("click", function (ev) {
      if (ev.target === $("track-picker") && !pickerState.running) {
        if (pickerState.video && pickerState.selected) finishPickerWithStatic(pickerState.video);
        else closeTrackPicker();
      }
    });
    $("vp-close").addEventListener("click", closeVideoPlayer);
    $("vp-expand").addEventListener("click", function () { expandPlayerView(!playerState.expanded); });
    $("vp-play").addEventListener("click", function () {
      var video = $("vp-video");
      if (!video) return;
      if (video.paused) {
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
        if (!playerState.raf) playerState.raf = requestAnimationFrame(tickPlayer);
      } else {
        video.pause();
        drawPlayerOverlay();
      }
    });
    var onPlayerSeek = function () {
      var video = $("vp-video");
      var slider = $("vp-seek");
      if (!video || !isFinite(video.duration) || !video.duration) return;
      video.currentTime = (Number(slider.value) / 1000) * video.duration;
      drawPlayerOverlay();
    };
    $("vp-seek").addEventListener("input", onPlayerSeek);
    $("vp-seek").addEventListener("change", onPlayerSeek);
    $("video-player").addEventListener("click", function (ev) {
      if (ev.target === $("video-player") && !playerState.expanded) closeVideoPlayer();
    });
    $("vp-video").addEventListener("play", function () {
      if (!playerState.raf) playerState.raf = requestAnimationFrame(tickPlayer);
    });
    $("vp-video").addEventListener("pause", function () { drawPlayerOverlay(); });
    $("vp-video").addEventListener("ended", function () { drawPlayerOverlay(); });
    $("vp-video").addEventListener("seeked", function () { drawPlayerOverlay(); });
    $("vp-video").addEventListener("timeupdate", function () {
      var video = $("vp-video");
      if (video && video.paused) drawPlayerOverlay();
    });
    var onViewport = function () {
      if (!$("track-picker").classList.contains("hidden")) drawPicker();
      if (!$("video-player").classList.contains("hidden")) drawPlayerOverlay();
    };
    window.addEventListener("resize", onViewport);
    window.addEventListener("orientationchange", onViewport);
    if (window.visualViewport) window.visualViewport.addEventListener("resize", onViewport);
    window.addEventListener("hashchange", render);
  }

  loadSaved();
  try {
    var hadPerVideo = state.videos.some(function (v) { return !!v.ai; });
    migrateLegacyAi();
    if (!hadPerVideo && state.videos.some(function (v) { return !!v.ai; })) persist();
  } catch (err) { console.warn("ai migrate", err); }
  bind();
  render();
})();
