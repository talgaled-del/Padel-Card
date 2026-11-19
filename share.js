/* PadelShare — short, hash-free public links for player and coach cards. */
(function () {
  var CODE_RE = /^[A-Za-z0-9]{6,12}$/;

  function canonicalOrigin() {
    var host = String(location.hostname || "").toLowerCase();
    if (host === "padelcard.app" || host === "www.padelcard.app" || host === "padel-card.onrender.com") {
      return "https://padelcard.app";
    }
    return location.origin;
  }

  function cardUrl(code) {
    if (!code || !CODE_RE.test(code)) return "";
    return canonicalOrigin() + "/c/" + code;
  }

  function coachUrl(code) {
    if (!code || !CODE_RE.test(code)) return "";
    return canonicalOrigin() + "/k/" + code;
  }

  function cardIdFallbackUrl(id) {
    if (!id) return "";
    return canonicalOrigin() + "/card/" + encodeURIComponent(id);
  }

  function coachIdFallbackUrl(id) {
    if (!id) return "";
    return canonicalOrigin() + "/#/coach/" + encodeURIComponent(id);
  }

  function absorbEncodedHash() {
    var path = location.pathname || "/";
    var decoded = path;
    try { decoded = decodeURIComponent(path); } catch (err) {}
    var hashish = "";
    if (/^\/#\//.test(decoded)) hashish = decoded.slice(1);
    else if (path.indexOf("%23") !== -1 && decoded.indexOf("#/") !== -1) {
      hashish = decoded.slice(decoded.indexOf("#/"));
    }
    if (!hashish) return false;
    var next = "/" + (location.search || "") + hashish;
    try { history.replaceState(null, "", next); return true; }
    catch (err) { return false; }
  }

  function takeQuery() {
    var q = "";
    try { q = new URLSearchParams(location.search || "").get("c") || new URLSearchParams(location.search || "").get("card") || ""; }
    catch (err) { q = ""; }
    return String(q || "").trim();
  }

  function parseLocation() {
    absorbEncodedHash();
    var path = location.pathname || "/";
    var m;
    try { path = decodeURIComponent(path); } catch (err) {}
    m = path.match(/^\/c\/([A-Za-z0-9]{6,12})\/?$/);
    if (m) return { kind: "card-code", code: m[1] };
    m = path.match(/^\/k\/([A-Za-z0-9]{6,12})\/?$/);
    if (m) return { kind: "coach-code", code: m[1] };
    m = path.match(/^\/card\/([^/]+)\/?$/);
    if (m) {
      var id = m[1];
      try { id = decodeURIComponent(m[1]); } catch (err) {}
      return { kind: "card-id", id: id };
    }
    var q = takeQuery();
    if (q) {
      if (CODE_RE.test(q)) return { kind: "card-code", code: q };
      return { kind: "card-id", id: q };
    }
    return null;
  }

  function isPublicShareLocation() {
    var got = parseLocation();
    return !!(got && got.kind);
  }

  function parseShareRef(raw) {
    var text = String(raw || "").trim();
    if (!text) return null;
    try {
      if (/^https?:\/\//i.test(text) || text.charAt(0) === "/" || text.charAt(0) === "#") {
        var href = text;
        if (text.charAt(0) === "#") href = "https://padelcard.app/" + text;
        else if (text.charAt(0) === "/") href = "https://padelcard.app" + text;
        var u = new URL(href);
        var path = u.pathname || "/";
        try { path = decodeURIComponent(path); } catch (err) {}
        if (/^\/#\//.test(path)) {
          u.hash = path.slice(1);
          path = "/";
        }
        var m = path.match(/^\/c\/([A-Za-z0-9]{6,12})\/?$/);
        if (m) return { kind: "card-code", code: m[1] };
        m = path.match(/^\/k\/([A-Za-z0-9]{6,12})\/?$/);
        if (m) return { kind: "coach-code", code: m[1] };
        m = path.match(/^\/card\/([^/]+)\/?$/);
        if (m) {
          var idp = m[1];
          try { idp = decodeURIComponent(m[1]); } catch (err) {}
          return { kind: "card-id", id: idp };
        }
        var c = u.searchParams.get("c") || u.searchParams.get("card");
        if (c && CODE_RE.test(c)) return { kind: "card-code", code: c };
        if (c) return { kind: "card-id", id: c };
        var hash = u.hash || "";
        m = hash.match(/#\/card\/([^/?#]+)/i);
        if (m) {
          var hid = m[1];
          try { hid = decodeURIComponent(m[1]); } catch (err) {}
          return { kind: "card-id", id: hid };
        }
        m = hash.match(/#\/coach\/([^/?#]+)/i);
        if (m) {
          var cid = m[1];
          try { cid = decodeURIComponent(m[1]); } catch (err) {}
          return { kind: "coach-id", id: cid };
        }
        m = hash.match(/#\/p\/([^/?#]+)/i);
        if (m) return { kind: "legacy-p", payload: m[1] };
      }
    } catch (err) {}
    if (CODE_RE.test(text)) return { kind: "card-code", code: text };
    if (/^[A-Za-z0-9._:-]{3,120}$/.test(text)) return { kind: "card-id", id: text };
    return null;
  }

  window.PadelShare = {
    CODE_RE: CODE_RE,
    canonicalOrigin: canonicalOrigin,
    cardUrl: cardUrl,
    coachUrl: coachUrl,
    cardIdFallbackUrl: cardIdFallbackUrl,
    coachIdFallbackUrl: coachIdFallbackUrl,
    absorbEncodedHash: absorbEncodedHash,
    parseLocation: parseLocation,
    isPublicShareLocation: isPublicShareLocation,
    parseShareRef: parseShareRef
  };
})();
