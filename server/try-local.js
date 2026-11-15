"use strict";
/* One real Gemini call on a local file, without the HTTP layer.
 * GEMINI_API_KEY=... node try-local.js /path/video.mp4 /path/track.json [durationSec] [top] [bottom]
 */
const fs = require("fs");
const rating = require("./lib/rating");
const gemini = require("./lib/gemini");

(async () => {
  const [videoPath, trackPath, durArg, top, bottom] = process.argv.slice(2);
  if (!process.env.GEMINI_API_KEY) { console.error("GEMINI_API_KEY is not set"); process.exit(2); }
  const buf = fs.readFileSync(videoPath);
  const track = trackPath ? JSON.parse(fs.readFileSync(trackPath, "utf8")) : null;
  const desc = rating.describePlayer(track, { top, bottom });
  const duration = Number(durArg) || desc.duration || 0;
  const prompt = rating.buildPrompt([{ duration, description: desc }], { hand: "right", gender: "male" });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const t0 = Date.now();
  const out = await gemini.generateFromVideos({
    apiKey: process.env.GEMINI_API_KEY,
    model,
    videos: [{ buf, mimeType: "video/mp4", fps: duration && duration <= 240 ? 2 : 1 }],
    prompt,
    schema: rating.responseSchema()
  });
  console.log("RAW:", out.text);
  console.log("USAGE:", JSON.stringify(out.usage), "schemaFallback:", out.schemaFallback);
  const result = rating.normalizeResult(rating.parseModelJson(out.text), { totalSeconds: duration, videoCount: 1, model: out.model });
  console.log("RESULT:", JSON.stringify(result, null, 2));
  console.log("ms:", Date.now() - t0);
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
