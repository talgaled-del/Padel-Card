"use strict";
/*
 * Turns a player track (packed v:2 JSON from track.js) into a plain-language
 * description the model can use to find the marked player, builds the prompt
 * and the response schema, and normalizes the model's answer.
 */
const { LEVELS, LEVEL_IDS } = require("./levels");

const MIN_SECONDS_FOR_CONFIDENCE = 120;
const SUBSCORE_KEYS = ["volley", "bandeja", "vibora", "smash", "wall_play", "positioning", "consistency", "rally_pace"];
const COLOR_WORDS = ["black", "white", "gray", "red", "orange", "yellow", "green", "turquoise", "blue", "navy", "purple", "pink", "brown", "beige"];

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function fmtTime(sec) {
  const s = Math.max(0, Math.round(sec));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
function pct(v) { return Math.round(clamp(v, 0, 1) * 100) + "%"; }

/* Accepts the packed format ({v,d,a,h,k:[[t*100,x*1000,y*1000,r*1000,c]],s,t0,n}). */
function unpackTrack(raw) {
  if (!raw || typeof raw !== "object") return null;
  const keys = Array.isArray(raw.k) ? raw.k : [];
  const out = {
    version: num(raw.v) || 1,
    duration: (num(raw.d) || 0) / 100,
    keys: keys
      .filter((k) => Array.isArray(k) && k.length >= 3)
      .slice(0, 2000)
      .map((k) => ({ t: (num(k[0]) || 0) / 100, x: clamp((num(k[1]) || 0) / 1000, 0, 1), y: clamp((num(k[2]) || 0) / 1000, 0, 1), r: clamp((num(k[3]) || 0) / 1000, 0, 1), c: k[4] ? 1 : 0 })),
    startBox: null,
    t0: typeof raw.t0 === "number" ? raw.t0 / 100 : 0,
    netY: typeof raw.n === "number" ? clamp(raw.n / 1000, 0, 1) : null,
    marker: null
  };
  if (Array.isArray(raw.s) && raw.s.length >= 4) {
    const [x, y, w, h] = raw.s.map((v) => clamp((num(v) || 0) / 1000, 0, 1));
    out.startBox = { x, y, w, h };
  }
  if (!out.keys.length && Array.isArray(raw.m) && raw.m.length >= 2) {
    out.marker = { x: clamp((num(raw.m[0]) || 0) / 1000, 0, 1), y: clamp((num(raw.m[1]) || 0) / 1000, 0, 1) };
  }
  return out;
}

function sampleKeys(keys, n) {
  const good = keys.filter((k) => k.c);
  const pool = good.length >= n ? good : keys;
  if (pool.length <= n) return pool;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[Math.round((i * (pool.length - 1)) / (n - 1))]);
  return out;
}

function cleanColor(v) {
  const s = String(v || "").toLowerCase().trim();
  return COLOR_WORDS.includes(s) ? s : "";
}

/* Returns { text, half, imageSide, courtSide } for one video. */
function describePlayer(track, extra) {
  extra = extra || {};
  const t = unpackTrack(track);
  const lines = [];
  if (!t || (!t.keys.length && !t.startBox && !t.marker)) {
    return { text: "No tracking data is available for this video. Only use the clothing hints if given; otherwise say the player is unclear.", half: "unknown", imageSide: "unknown", courtSide: "unknown" };
  }
  const first = t.startBox
    ? { x: t.startBox.x + t.startBox.w / 2, y: t.startBox.y + t.startBox.h / 2, feet: t.startBox.y + t.startBox.h }
    : t.keys.length ? { x: t.keys[0].x, y: t.keys[0].y, feet: t.keys[0].y + (t.keys[0].r || 0.05) }
    : { x: t.marker.x, y: t.marker.y, feet: t.marker.y + 0.05 };
  const netY = t.netY;
  let half = "unknown";
  if (netY != null) half = first.feet > netY ? "near" : "far";
  else half = first.feet > 0.5 ? "near" : "far";
  const imageSide = first.x < 0.5 ? "left" : "right";
  // Near team faces away from the camera, so frame-left is their left. Far team is mirrored.
  const courtSide = half === "near" ? imageSide : half === "far" ? (imageSide === "left" ? "right" : "left") : "unknown";

  lines.push("Coordinates are fractions of the video frame: x from the LEFT edge, y from the TOP edge (0% = top/left, 100% = bottom/right).");
  lines.push(`The marked player is on the ${half === "near" ? "NEAR half of the court (closer to the camera, on this side of the net)" : half === "far" ? "FAR half of the court (beyond the net, farther from the camera)" : "court (half unknown)"}.`);
  lines.push(`At the start of the clip they stand on the ${imageSide.toUpperCase()} side of the frame, i.e. the player's own ${courtSide} side of their half (${courtSide === "right" ? "drive / derecha side" : courtSide === "left" ? "backhand / revés side" : "side unknown"}). Their partner is the other player on the same half.`);
  if (netY != null) lines.push(`The net meets the court floor at about y=${pct(netY)} in the frame. Players never cross the net, so the marked player's feet stay on the ${half} side of it for the whole clip (their body can appear above that line in the image when they stand close to the net).`);
  if (t.startBox) {
    const b = t.startBox;
    lines.push(`Start box at ${fmtTime(t.t0)}: left=${pct(b.x)}, top=${pct(b.y)}, width=${pct(b.w)}, height=${pct(b.h)} of the frame.`);
  }
  const samples = sampleKeys(t.keys, 10);
  if (samples.length) {
    lines.push("Approximate centre of the marked player at several moments (from an automatic tracker, may be off by a little):");
    samples.forEach((k) => lines.push(`  - ${fmtTime(k.t)}: x=${pct(k.x)}, y=${pct(k.y)}${k.c ? "" : " (uncertain)"}`));
  } else if (t.marker) {
    lines.push(`The player marked themselves at x=${pct(t.marker.x)}, y=${pct(t.marker.y)} at the start of the clip (no continuous track).`);
  }
  const top = cleanColor(extra.top);
  const bottom = cleanColor(extra.bottom);
  if (top || bottom) {
    lines.push(`Clothing estimated from the first frame (automatic, may be wrong): ${top ? "top/shirt " + top : ""}${top && bottom ? ", " : ""}${bottom ? "shorts/bottom " + bottom : ""}.`);
  }
  return { text: lines.join("\n"), half, imageSide, courtSide, duration: t.duration };
}

function levelTable() {
  return LEVELS.map((l) => `- ${l.id} (${l.numeric}, ${l.title}): ${l.blurb}`).join("\n");
}

function buildPrompt(videos, profile, opts) {
  profile = profile || {};
  opts = opts || {};
  const totalSec = videos.reduce((s, v) => s + (v.duration || 0), 0);
  const parts = [];
  parts.push(
`You are an experienced padel coach in Israel who rates amateur players from match video.
You will receive ${videos.length} video clip(s) of doubles padel. Exactly ONE player is the subject ("the marked player"). Rate ONLY that player, never their partner or the opponents.

How to find the marked player in each clip:`);
  videos.forEach((v, i) => {
    parts.push(`\nVideo ${i + 1}${v.duration ? ` (about ${fmtTime(v.duration)} long)` : ""}:\n${v.description.text}`);
  });
  const hints = [];
  if (profile.hand === "right" || profile.hand === "left") hints.push(`self-reported ${profile.hand}-handed`);
  if (profile.gender === "male" || profile.gender === "female") hints.push(`gender: ${profile.gender}`);
  if (hints.length) parts.push(`\nExtra identification hints about the marked player: ${hints.join(", ")}.`);
  parts.push(`
Level scale (Israeli letter levels; you MUST answer with one of these ids exactly):
${levelTable()}

What to evaluate for the marked player, each as an integer 0-10 (0 = very weak, 5 = solid club level, 10 = professional), or null if that shot/aspect was not seen at all in the footage:
- volley: net play and volleys
- bandeja: bandeja technique and use
- vibora: vibora technique and use
- smash: smash / overhead finishing (por 3, por 4, flat smash)
- wall_play: playing balls off the back and side glass
- positioning: court positioning and movement relative to the partner (moving together, net/back transitions, covering the middle)
- consistency: unforced errors, keeping the ball in play
- rally_pace: the pace and intensity they can sustain in rallies

Rules:
- Base the rating ONLY on what you actually see the marked player do. Do not guess from age, gender, or clothing.
- If you cannot reliably tell which player is the marked one, set player_found=false and confidence="low".
${opts.perVideo
  ? `- This clip (about ${totalSec ? fmtTime(totalSec) : "unknown length"}) is ONE of several clips of the same player. Each clip is rated separately and the results are combined later, weighted by clip length and confidence. Judge confidence only by how much of the player's game THIS clip shows: "low" if it shows only a few rallies, is shorter than about a minute, or the player is hard to see; "medium" for a few minutes of clear rallies; "high" only for many varied shots seen clearly.`
  : `- Total footage is about ${totalSec ? fmtTime(totalSec) : "unknown length"}. If the total footage is shorter than about 2 minutes, or the player is visible in only a few rallies, confidence MUST be "low". Use "high" only with several minutes of clear footage showing many different shots.`}
- explanation_he: 1-2 short sentences in natural Hebrew (max 200 characters) explaining the level, mentioning a concrete strength and a concrete weakness you saw.
- player_description: short English description of the person you rated (clothing, position), so we can confirm you rated the right player.
- Respond with STRICT JSON only, matching the schema. No markdown, no comments, no extra keys.`);
  return parts.join("\n");
}

function responseSchema() {
  const score = { type: "INTEGER", nullable: true, minimum: 0, maximum: 10 };
  const subs = {};
  SUBSCORE_KEYS.forEach((k) => { subs[k] = score; });
  return {
    type: "OBJECT",
    properties: {
      player_found: { type: "BOOLEAN" },
      player_description: { type: "STRING" },
      observed_seconds: { type: "INTEGER" },
      level: { type: "STRING", enum: LEVEL_IDS },
      confidence: { type: "STRING", enum: ["low", "medium", "high"] },
      confidence_reason: { type: "STRING" },
      explanation_he: { type: "STRING" },
      subscores: { type: "OBJECT", properties: subs, required: SUBSCORE_KEYS, propertyOrdering: SUBSCORE_KEYS }
    },
    required: ["player_found", "player_description", "level", "confidence", "explanation_he", "subscores"],
    propertyOrdering: ["player_found", "player_description", "observed_seconds", "level", "confidence", "confidence_reason", "explanation_he", "subscores"]
  };
}

function parseModelJson(text) {
  if (!text) throw new Error("empty model response");
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("model response is not JSON");
  return JSON.parse(s.slice(a, b + 1));
}

function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + "…";
}

function normalizeResult(raw, ctx) {
  ctx = ctx || {};
  if (!raw || typeof raw !== "object") throw new Error("model result is not an object");
  const level = LEVEL_IDS.includes(String(raw.level || "").toUpperCase()) ? String(raw.level).toUpperCase() : null;
  if (!level) throw new Error("model returned an unknown level: " + raw.level);
  let confidence = ["low", "medium", "high"].includes(raw.confidence) ? raw.confidence : "low";
  const modelConfidence = confidence;
  const found = raw.player_found !== false;
  const notes = [];
  if (!found) { confidence = "low"; notes.push("player_not_found"); }
  // Per-video mode: the client combines clips and applies the total-length rule itself.
  if (!ctx.perVideo && (ctx.totalSeconds || 0) < MIN_SECONDS_FOR_CONFIDENCE) {
    if (confidence !== "low") notes.push("short_footage");
    confidence = "low";
  }
  const subs = {};
  const src = raw.subscores || {};
  SUBSCORE_KEYS.forEach((k) => {
    const v = num(src[k]);
    subs[k] = v == null ? null : clamp(Math.round(v), 0, 10);
  });
  const lv = LEVELS.find((l) => l.id === level);
  return {
    level,
    levelNumeric: lv.numeric,
    levelTitle: lv.title,
    confidence,
    modelConfidence,
    perVideo: !!ctx.perVideo,
    explanation: truncate(raw.explanation_he || "", 200),
    subscores: subs,
    playerFound: found,
    playerDescription: truncate(raw.player_description || "", 240),
    observedSeconds: num(raw.observed_seconds),
    videoCount: ctx.videoCount || 1,
    totalSeconds: Math.round(ctx.totalSeconds || 0),
    notes,
    model: ctx.model || "",
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  SUBSCORE_KEYS,
  MIN_SECONDS_FOR_CONFIDENCE,
  unpackTrack,
  describePlayer,
  buildPrompt,
  responseSchema,
  parseModelJson,
  normalizeResult,
  truncate
};
