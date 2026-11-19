/* Certified ratings (דירוג מוסמך). Public read + rater writes go through RPCs. */
(function () {
  var LEVELS = ["D2", "D1", "C2", "C1", "B2", "B1", "A2", "A1"];
  var cache = {};
  var inflight = {};
  var hooks = {
    getClient: function () { return window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient(); },
    showToast: function () {},
    cardId: function (card) {
      if (!card) return "";
      return (card.profile && card.profile.id) || card.id || "";
    },
    onChanged: function () {},
    viewer: function () { return { isRater: false, raterId: null, ownCardId: "" }; }
  };
  var sheetCard = null;
  var sheetLevel = "";
  var sheetOpts = {};

  function $(id) { return document.getElementById(id); }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function client() { return hooks.getClient(); }

  function rpc(name, args) {
    var c = client();
    if (!c) return Promise.reject(new Error("not configured"));
    return c.rpc(name, args || {}).then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  function hebrewError(err) {
    var msg = (err && (err.message || err.error_description || err.details)) || "";
    var low = String(msg).toLowerCase();
    if (/not a certified rater/.test(low)) return "רק מוסמך פעיל יכול לתת דירוג מוסמך.";
    if (/cannot rate own card/.test(low)) return "אי אפשר לדרג את הכרטיס של עצמכם.";
    if (/card unavailable/.test(low)) return "הכרטיס אינו זמין לדירוג.";
    if (/invalid level/.test(low)) return "בחרו רמה מהסולם הישראלי.";
    if (/note too long/.test(low)) return "ההערה ארוכה מדי. עד 200 תווים.";
    if (/rating not found/.test(low)) return "לא נמצא דירוג למחיקה.";
    if (/certified rating cooldown until/.test(low)) {
      var iso = (String(msg).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
      var pretty = iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
      return pretty
        ? ("השחקן כבר קיבל דירוג מוסמך. אפשר לדרג שוב ב־" + pretty + ".")
        : "השחקן כבר קיבל דירוג מוסמך ב־3 החודשים האחרונים.";
    }
    if (/card not found/.test(low)) return "כרטיס השחקן לא נמצא.";
    if (/invalid card/.test(low)) return "לא ניתן לדרג את הכרטיס הזה.";
    if (/not authorized/.test(low)) return "אין הרשאה לפעולה הזו.";
    if (/email already in use/.test(low)) return "כתובת האימייל כבר משויכת למוסמך אחר.";
    if (/invalid email/.test(low)) return "כתובת האימייל אינה תקינה.";
    if (/invalid name/.test(low)) return "יש להזין שם מלא.";
    if (/rater not found/.test(low)) return "המוסמך לא נמצא.";
    return msg || "הפעולה נכשלה. נסו שוב.";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  }

  function asList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === "string") {
      try { return asList(JSON.parse(data)); } catch (err) { return []; }
    }
    return [];
  }

  function cached(cardId) {
    return cache[cardId] || null;
  }

  function remember(cardId, ratings) {
    cache[cardId] = asList(ratings);
    return cache[cardId];
  }

  function invalidate(cardId) {
    if (cardId) delete cache[cardId];
    else cache = {};
  }

  function fetchRatings(cardId) {
    if (!cardId) return Promise.resolve([]);
    if (inflight[cardId]) return inflight[cardId];
    inflight[cardId] = rpc("get_certified_ratings", { p_card_id: cardId })
      .then(function (data) { return remember(cardId, data); })
      .catch(function () { return remember(cardId, []); })
      .then(function (list) {
        delete inflight[cardId];
        return list;
      });
    return inflight[cardId];
  }

  function ensure(cardId) {
    if (!cardId) return Promise.resolve([]);
    if (cache[cardId]) return Promise.resolve(cache[cardId]);
    return fetchRatings(cardId);
  }

  function levelIndex(id) {
    return LEVELS.indexOf(id);
  }

  function summarize(ratings) {
    var list = asList(ratings).filter(function (r) { return r && levelIndex(r.level) >= 0; });
    if (!list.length) return null;
    var ranked = list.slice().sort(function (a, b) {
      var d = levelIndex(a.level) - levelIndex(b.level);
      if (d) return d;
      return new Date(a.updated_at || 0) - new Date(b.updated_at || 0);
    });
    var pick;
    if (ranked.length % 2 === 1) {
      pick = ranked[(ranked.length - 1) / 2];
    } else {
      var a = ranked[ranked.length / 2 - 1];
      var b = ranked[ranked.length / 2];
      pick = new Date(a.updated_at || 0) >= new Date(b.updated_at || 0) ? a : b;
    }
    var latest = list.slice().sort(function (a, b) {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    })[0];
    return {
      level: pick.level,
      count: list.length,
      name: list.length === 1 ? (pick.rater_name || "") : "",
      latest: latest,
      pick: pick
    };
  }

  function detailsListHtml(ratings) {
    var list = asList(ratings).slice().sort(function (a, b) {
      return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    });
    if (!list.length) return "";
    return '<ul class="ut-star-list">' + list.map(function (r) {
      var note = r.note ? '<p class="ut-star-note">' + escapeHtml(r.note) + "</p>" : "";
      var when = fmtDate(r.updated_at || r.created_at);
      return '<li>' +
        '<div class="ut-star-item-top">' +
          '<strong class="ut-star-item-level" dir="ltr">' + escapeHtml(r.level || "") + "</strong>" +
          '<span class="ut-star-item-name">' + escapeHtml(r.rater_name || "מוסמך") + "</span>" +
          (when ? '<time class="ut-star-item-date">' + escapeHtml(when) + "</time>" : "") +
        "</div>" +
        note +
      "</li>";
    }).join("") + "</ul>";
  }

  function rowHtml(ratings, opts) {
    opts = opts || {};
    var sum = summarize(ratings);
    if (!sum) return '<div class="ut-star-slot" hidden></div>';
    var meta = sum.count === 1
      ? escapeHtml(sum.name || "מוסמך")
      : (sum.count + " מוסמכים");
    var hint = sum.count > 1 ? "הציון המוצג הוא החציון. לחצו לפירוט." : (asList(ratings)[0] && asList(ratings)[0].note ? "לחצו להערה" : "לחצו לפירוט");
    return '<div class="ut-star-slot">' +
      '<div class="ut-star' + (opts.compact ? " compact" : "") + '">' +
        '<button type="button" class="ut-star-line" aria-expanded="false">' +
          '<span class="ut-star-main">' +
            '<span class="ut-star-label">דירוג מוסמך</span>' +
            '<span class="ut-star-meta">' + meta + "</span>" +
          "</span>" +
          '<strong class="ut-star-value" dir="ltr">' + escapeHtml(sum.level) + "</strong>" +
          '<span class="ut-star-chev" aria-hidden="true"></span>' +
        "</button>" +
        '<div class="ut-star-details" hidden>' +
          (sum.count > 1 ? '<p class="ut-star-expl">הרמה המוצגת היא החציון מבין ' + sum.count + " הדירוגים.</p>" : "") +
          detailsListHtml(ratings) +
          '<p class="ut-star-foot">חוות דעת מקצועית של מוסמך פאדל. לא דירוג רשמי.</p>' +
        "</div>" +
      "</div>" +
    "</div>";
  }

  function heroBadgeHtml(ratings) {
    var sum = summarize(ratings);
    if (!sum) return "";
    var label = sum.count === 1 ? "מוסמך" : (sum.count + " מוסמכים");
    return '<div class="ut-star-badge" title="דירוג מוסמך">' +
      '<b dir="ltr">' + escapeHtml(sum.level) + "</b>" +
      '<span>' + escapeHtml(label) + "</span>" +
    "</div>";
  }

  function patchCard(art, ratings, card) {
    if (!art) return;
    if (hooks.patchRatings && card) {
      hooks.patchRatings(art, card, ratings);
      return;
    }
    var slot = art.querySelector(".ut-star-slot");
    var html = rowHtml(ratings);
    if (slot) slot.outerHTML = html;
  }

  function hydrateCard(art, card) {
    var id = hooks.cardId(card);
    if (!art || !id) return Promise.resolve([]);
    if (cache[id]) {
      patchCard(art, cache[id], card);
      return Promise.resolve(cache[id]);
    }
    return fetchRatings(id).then(function (list) {
      patchCard(art, list, card);
      if (hooks.onRatingsLoaded) hooks.onRatingsLoaded(card, list);
      return list;
    });
  }

  function mineOn(cardId) {
    var v = hooks.viewer();
    var list = cache[cardId] || [];
    if (!v.raterId) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].rater_id === v.raterId) return list[i];
    }
    return null;
  }

  function canRate(card) {
    var v = hooks.viewer();
    if (!v.isRater) return false;
    var id = hooks.cardId(card);
    if (!id) return false;
    if (v.ownCardId && v.ownCardId === id) return false;
    return true;
  }

  function fillLevels(selected) {
    var box = $("certified-level-select");
    if (!box) return;
    box.innerHTML = '<option value="">בחרו רמה</option>' + LEVELS.map(function (id) {
      return '<option value="' + id + '" dir="ltr"' + (id === selected ? " selected" : "") + ">" + id + "</option>";
    }).join("");
    sheetLevel = selected || "";
  }

  function closeSheet() {
    var el = $("certified-sheet");
    if (el) el.classList.add("hidden");
    sheetCard = null;
    sheetLevel = "";
    sheetOpts = {};
  }

  function openSheet(card, opts) {
    sheetOpts = opts || {};
    if (!card || !canRate(card)) return;
    var id = hooks.cardId(card);
    var name = (card.profile && card.profile.name) || "השחקן";
    sheetCard = card;
    var mine = mineOn(id);
    sheetLevel = mine ? mine.level : "";
    $("certified-sheet-name").textContent = name;
    $("certified-note").value = mine && mine.note ? mine.note : "";
    fillLevels(sheetLevel);
    var save = $("certified-sheet-save");
    if (save) save.textContent = "אשר";
    var title = $("certified-sheet-title");
    if (title) title.textContent = mine ? "עדכון דירוג מוסמך" : "דירוג מוסמך";
    $("certified-sheet").classList.remove("hidden");
  }

  function saveSheet() {
    if (!sheetCard) return;
    var id = hooks.cardId(sheetCard);
    var sel = $("certified-level-select");
    if (sel) sheetLevel = sel.value || sheetLevel;
    if (!sheetLevel) {
      hooks.showToast("בחרו רמה כדי לשמור");
      return;
    }
    var note = ($("certified-note") && $("certified-note").value) || "";
    var btn = $("certified-sheet-save");
    if (btn) btn.disabled = true;
    var saved = null;
    var rpcName = (sheetOpts && sheetOpts.rpc) || "upsert_certified_rating";
    rpc(rpcName, { p_card_id: id, p_level: sheetLevel, p_note: note })
      .then(function (row) {
        saved = row;
        return fetchRatings(id);
      })
      .then(function () {
        closeSheet();
        hooks.showToast("הדירוג המוסמך נשמר");
        hooks.onChanged(id, saved);
      })
      .catch(function (err) {
        hooks.showToast(hebrewError(err));
      })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function removeMine() {
    if (!sheetCard) return;
    var id = hooks.cardId(sheetCard);
    var btn = $("certified-sheet-remove");
    if (btn) btn.disabled = true;
    rpc("delete_my_certified_rating", { p_card_id: id })
      .then(function () { return fetchRatings(id); })
      .then(function () {
        closeSheet();
        hooks.showToast("הדירוג שלכם הוסר");
        hooks.onChanged(id);
      })
      .catch(function (err) {
        hooks.showToast(hebrewError(err));
      })
      .then(function () { if (btn) btn.disabled = false; });
  }

  function bind() {
    document.addEventListener("click", function (ev) {
      /* level is chosen from #certified-level-select */
      var line = ev.target && ev.target.closest && ev.target.closest(".ut-star-line");
      if (line) {
        var wrap = line.closest(".ut-star");
        var open = wrap && !wrap.classList.contains("is-open");
        if (wrap) {
          wrap.classList.toggle("is-open", open);
          line.setAttribute("aria-expanded", open ? "true" : "false");
          var details = wrap.querySelector(".ut-star-details");
          if (details) details.hidden = !open;
        }
        return;
      }
      var rate = ev.target && ev.target.closest && ev.target.closest("[data-cert-rate]");
      if (rate && window.__padelOpenCertifiedSheet) {
        ev.preventDefault();
        window.__padelOpenCertifiedSheet(rate.getAttribute("data-cert-rate"));
      }
    });
    if ($("certified-sheet-save")) $("certified-sheet-save").addEventListener("click", saveSheet);
    var sel = $("certified-level-select");
    if (sel) sel.addEventListener("change", function () { sheetLevel = sel.value || ""; });
    var sheet = $("certified-sheet");
    if (sheet) sheet.addEventListener("click", function (ev) { if (ev.target === sheet) closeSheet(); });
  }

  function init(opts) {
    hooks = Object.assign(hooks, opts || {});
    bind();
  }

  window.PadelCertified = {
    init: init,
    ensure: ensure,
    fetch: fetchRatings,
    cached: cached,
    invalidate: invalidate,
    summarize: summarize,
    rowHtml: rowHtml,
    heroBadgeHtml: heroBadgeHtml,
    hydrateCard: hydrateCard,
    canRate: canRate,
    openSheet: openSheet,
    closeSheet: closeSheet,
    hebrewError: hebrewError
  };
})();
