"use strict";
/*
 * padel-card-api — AI Rating backend.
 *   POST /api/ai-rating  { videoUrl, track, cardId }  or  { videos: [{ videoUrl, track, duration, appearance }], cardId, profile }
 *   GET  /healthz
 * Env: GEMINI_API_KEY (required unless MOCK_AI=1), GEMINI_MODEL (default gemini-3.8-flash),
 *      ALLOWED_ORIGINS (comma list, default https://padel-card.onrender.com + localhost),
 *      MOCK_AI=1 (no Gemini call; deterministic fake result), PORT (Render sets it).
 * No npm dependencies (Node >= 20, global fetch).
 */
const http = require("http");
const { URL } = require("url");
const rating = require("./lib/rating");
const gemini = require("./lib/gemini");

const PORT = Number(process.env.PORT) || 8787;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MOCK = process.env.MOCK_AI === "1";
const MAX_VIDEOS = 3;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "jgreas8e";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://padel-card.onrender.com")
  .split(",").map((s) => s.trim()).filter(Boolean);
// Extra video hosts for local testing only, e.g. EXTRA_VIDEO_HOSTS=127.0.0.1:8766
const EXTRA_VIDEO_HOSTS = (process.env.EXTRA_VIDEO_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const RATE = {
  perHour: Number(process.env.RATE_PER_HOUR) || 6,
  perDay: Number(process.env.RATE_PER_DAY) || 20,
  maxConcurrent: Number(process.env.MAX_CONCURRENT) || 2
};

function log(...args) { console.log(new Date().toISOString(), ...args); }

/* ---------- CORS ---------- */
function originAllowed(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin"
  };
}
function send(req, res, status, obj, extra) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  }, corsHeaders(req), extra || {}));
  res.end(body);
}
function fail(req, res, status, code, message, extra) {
  send(req, res, status, { error: code, message }, extra);
}

/* ---------- rate limit (in-memory, per IP) ---------- */
const hits = new Map(); // ip -> [timestamps]
let inFlight = 0;
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket.remoteAddress || "unknown";
}
function rateCheck(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 24 * 3600 * 1000);
  hits.set(ip, list);
  const lastHour = list.filter((t) => now - t < 3600 * 1000);
  if (lastHour.length >= RATE.perHour) return Math.ceil((lastHour[0] + 3600 * 1000 - now) / 1000);
  if (list.length >= RATE.perDay) return Math.ceil((list[0] + 24 * 3600 * 1000 - now) / 1000);
  list.push(now);
  return 0;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (!list.some((t) => now - t < 24 * 3600 * 1000)) hits.delete(ip);
}, 3600 * 1000).unref();

/* ---------- helpers ---------- */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("body too large"), { code: "body_too_large" })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (e) { reject(Object.assign(new Error("bad json"), { code: "bad_json" })); }
    });
    req.on("error", reject);
  });
}

function allowedVideoUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol === "https:" && u.hostname === "res.cloudinary.com" && u.pathname.startsWith(`/${CLOUD_NAME}/video/upload/`)) return u;
  if (EXTRA_VIDEO_HOSTS.includes(u.host) && /^https?:$/.test(u.protocol)) return u;
  return null;
}
function allowedTrackUrl(raw) {
  let u;
  try { u = new URL(raw); } catch (e) { return null; }
  if (u.protocol === "https:" && u.hostname === "res.cloudinary.com" && u.pathname.startsWith(`/${CLOUD_NAME}/raw/upload/`)) return u;
  if (EXTRA_VIDEO_HOSTS.includes(u.host)) return u;
  return null;
}

/* Prefer the eager H.264 rendition for Cloudinary uploads. */
function h264Url(u) {
  if (u.hostname !== "res.cloudinary.com") return u.toString();
  let s = u.toString();
  if (!/vc_h264|f_mp4/.test(s)) {
    s = s.replace("/video/upload/", "/video/upload/c_limit,w_1280,h_720,q_auto:good,vc_h264,f_mp4/")
      .replace(/\.(mov|m4v|webm|avi|mkv|hevc)(\?|$)/i, ".mp4$2");
  }
  return s;
}

async function fetchBuffer(url, maxBytes, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw Object.assign(new Error("fetch " + res.status), { code: res.status === 423 ? "video_processing" : "video_fetch_failed" });
    const len = Number(res.headers.get("content-length") || 0);
    if (len && len > maxBytes) throw Object.assign(new Error("too large"), { code: "video_too_large" });
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { try { ctrl.abort(); } catch (e) {} throw Object.assign(new Error("too large"), { code: "video_too_large" }); }
      chunks.push(value);
    }
    return { buf: Buffer.concat(chunks.map((c) => Buffer.from(c))), mimeType: (res.headers.get("content-type") || "video/mp4").split(";")[0] };
  } catch (e) {
    if (e.name === "AbortError" && !e.code) e.code = "video_fetch_timeout";
    if (!e.code) e.code = "video_fetch_failed";
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveTrack(item) {
  if (item.track && typeof item.track === "object") return item.track;
  const url = typeof item.track === "string" ? item.track : item.trackUrl;
  if (!url) return null;
  const u = allowedTrackUrl(url);
  if (!u) return null;
  try {
    const { buf } = await fetchBuffer(u.toString(), 256 * 1024, 15000);
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    log("track fetch failed", e.message);
    return null;
  }
}

function cleanProfile(p) {
  p = p && typeof p === "object" ? p : {};
  return {
    hand: ["right", "left"].includes(p.hand) ? p.hand : "",
    gender: ["male", "female"].includes(p.gender) ? p.gender : ""
  };
}

const MESSAGES = {
  bad_request: "הבקשה לא תקינה",
  no_videos: "אין סרטון לניתוח",
  video_not_allowed: "אפשר לנתח רק סרטונים שהועלו לכרטיס",
  video_fetch_failed: "לא הצלחנו לטעון את הסרטון",
  video_fetch_timeout: "טעינת הסרטון לקחה יותר מדי זמן",
  video_processing: "הסרטון עדיין בעיבוד. נסו שוב בעוד דקה",
  video_too_large: "הסרטון גדול מדי לניתוח",
  rate_limited: "ביקשתם הרבה ניתוחים לאחרונה. נסו שוב מאוחר יותר",
  busy: "השרת עמוס כרגע. נסו שוב בעוד דקה",
  not_configured: "ניתוח ה-AI עדיין לא הופעל בשרת",
  ai_failed: "ניתוח ה-AI נכשל. ודאו שהמצלמה הייתה קבועה ושהשחקן נשאר באותו צד לאורך הסרטון, ונסו שוב",
  ai_quota: "מכסת ה-AI נגמרה להיום. נסו שוב מחר"
};

/* ---------- mock ---------- */
function mockModelJson(videos) {
  const totalSec = videos.reduce((s, v) => s + (v.duration || 0), 0);
  // Deterministic variety per clip (by length), so combining several mock clips is visible in tests.
  const variants = [
    { level: "C1", confidence: "medium", subs: { volley: 7, bandeja: 5, vibora: 4, smash: 6, wall_play: 4, positioning: 7, consistency: 5, rally_pace: 6 },
      he: "תוצאת בדיקה (MOCK): וולי יציב ועלייה טובה לרשת יחד עם השותף. חסרה עקביות בהוצאת כדורים מהזכוכית האחורית." },
    { level: "B2", confidence: "medium", subs: { volley: 7, bandeja: 6, vibora: 5, smash: 7, wall_play: 6, positioning: 7, consistency: 6, rally_pace: 7 },
      he: "תוצאת בדיקה (MOCK): בנדחה בשליטה וקריאה טובה של המשחק. לפעמים נשאר מאחור כשהשותף עולה לרשת." },
    { level: "C2", confidence: "low", subs: { volley: 5, bandeja: null, vibora: null, smash: 4, wall_play: 5, positioning: 5, consistency: 5, rally_pace: 4 },
      he: "תוצאת בדיקה (MOCK): מחזיק ראלי בקצב סביר. קטע קצר, קשה לראות חבטות מעל הראש." }
  ];
  const v = variants[Math.round(totalSec) % variants.length];
  return {
    player_found: true,
    player_description: "MOCK: player in a black shirt and white shorts on the near half, right side",
    observed_seconds: Math.round(totalSec),
    level: v.level,
    confidence: v.confidence,
    confidence_reason: "MOCK result",
    explanation_he: v.he,
    subscores: v.subs
  };
}

/* ---------- main handler ---------- */
async function handleRating(req, res) {
  const ip = clientIp(req);
  let body;
  try { body = await readJson(req); }
  catch (e) { return fail(req, res, e.code === "body_too_large" ? 413 : 400, "bad_request", MESSAGES.bad_request); }

  let items = Array.isArray(body.videos) ? body.videos : (body.videoUrl ? [{ videoUrl: body.videoUrl, track: body.track, trackUrl: body.trackUrl, duration: body.duration, appearance: body.appearance }] : []);
  items = items.filter((v) => v && typeof v.videoUrl === "string").slice(0, MAX_VIDEOS);
  if (!items.length) return fail(req, res, 400, "no_videos", MESSAGES.no_videos);
  for (const it of items) {
    const u = allowedVideoUrl(it.videoUrl);
    if (!u) return fail(req, res, 400, "video_not_allowed", MESSAGES.video_not_allowed);
    it.url = h264Url(u);
  }
  if (!MOCK && !process.env.GEMINI_API_KEY) return fail(req, res, 503, "not_configured", MESSAGES.not_configured);

  const wait = rateCheck(ip);
  if (wait) return fail(req, res, 429, "rate_limited", MESSAGES.rate_limited, { "Retry-After": String(wait) });
  if (inFlight >= RATE.maxConcurrent) return fail(req, res, 503, "busy", MESSAGES.busy, { "Retry-After": "60" });

  inFlight++;
  const started = Date.now();
  const cardId = String(body.cardId || "").slice(0, 80);
  try {
    const profile = cleanProfile(body.profile);
    const prepared = [];
    let totalBytes = 0;
    for (const it of items) {
      const track = await resolveTrack(it);
      const fetched = await fetchBuffer(it.url, MAX_VIDEO_BYTES, 120000);
      totalBytes += fetched.buf.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw Object.assign(new Error("total too large"), { code: "video_too_large" });
      const desc = rating.describePlayer(track, it.appearance || {});
      let duration = Number(it.duration) || 0;
      if (!duration && desc.duration) duration = desc.duration;
      prepared.push({ buf: fetched.buf, mimeType: /^video\//.test(fetched.mimeType) ? fetched.mimeType : "video/mp4", duration, description: desc });
    }
    const totalSeconds = prepared.reduce((s, v) => s + (v.duration || 0), 0);
    // perVideo: the client sends one clip per request and combines the results itself.
    const perVideo = body.perVideo === true && prepared.length === 1;
    const prompt = rating.buildPrompt(prepared, profile, { perVideo });
    let modelJson, usage = null, modelName = MODEL;
    if (MOCK) {
      await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS) || 2500));
      modelJson = mockModelJson(prepared);
      modelName = "mock";
    } else {
      // ~1 frame/sec is Gemini's default; short clips get 2 fps so fast exchanges are not missed.
      const fps = totalSeconds && totalSeconds <= 240 ? 2 : 1;
      const out = await gemini.generateFromVideos({
        apiKey: process.env.GEMINI_API_KEY,
        model: MODEL,
        videos: prepared.map((v) => ({ buf: v.buf, mimeType: v.mimeType, fps })),
        prompt,
        schema: rating.responseSchema()
      });
      usage = out.usage;
      if (out.schemaFallback) log("note: responseSchema rejected, used plain JSON mode");
      modelName = out.model;
      modelJson = rating.parseModelJson(out.text);
    }
    const result = rating.normalizeResult(modelJson, { totalSeconds, videoCount: prepared.length, model: modelName, perVideo });
    if (MOCK) result.mock = true;
    log("ai-rating ok", JSON.stringify({ cardId, ip, videos: prepared.length, bytes: totalBytes, sec: Math.round(totalSeconds), ms: Date.now() - started, level: result.level, conf: result.confidence, usage }));
    if (process.env.DEBUG_PROMPT === "1") result.prompt = prompt;
    send(req, res, 200, result);
  } catch (e) {
    log("ai-rating error", cardId, e.code || "", e.status || "", e.message);
    let code = e.code && MESSAGES[e.code] ? e.code : "ai_failed";
    if (e.status === 429) code = "ai_quota";
    const status = code === "ai_failed" || code === "ai_quota" ? 502 : code === "video_too_large" ? 413 : 400;
    fail(req, res, status, code, MESSAGES[code]);
  } finally {
    inFlight--;
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (req.method === "OPTIONS") {
    res.writeHead(originAllowed(req.headers.origin) ? 204 : 403, corsHeaders(req));
    return res.end();
  }
  if (req.method === "GET" && (path === "/healthz" || path === "/")) {
    return send(req, res, 200, { ok: true, service: "padel-card-api", mock: MOCK, model: MOCK ? "mock" : MODEL, configured: MOCK || !!process.env.GEMINI_API_KEY });
  }
  if (req.method === "POST" && path === "/api/ai-rating") {
    if (req.headers.origin && !originAllowed(req.headers.origin)) return fail(req, res, 403, "forbidden_origin", "origin not allowed");
    return handleRating(req, res).catch((e) => { log("fatal", e); try { fail(req, res, 500, "ai_failed", MESSAGES.ai_failed); } catch (x) {} });
  }
  fail(req, res, 404, "not_found", "not found");
});
server.requestTimeout = 6 * 60 * 1000;
server.headersTimeout = 65000;
server.keepAliveTimeout = 65000;

if (require.main === module) {
  server.listen(PORT, () => log(`padel-card-api listening on :${PORT} (mock=${MOCK}, model=${MODEL})`));
}
module.exports = { server, originAllowed, allowedVideoUrl };
