// v12 — AI Rating end-to-end check (mock backend).
// Needs: static site on :8765 (python3 -m http.server 8765 --directory /workspace/padel-card),
//        a CORS static server for the test video (VIDEO_BASE, default http://127.0.0.1:18767/),
//        and the API: cd server && MOCK_AI=1 EXTRA_VIDEO_HOSTS=127.0.0.1:18767 PORT=8787 node server.js
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import vm from "vm";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8765/";
const API = process.env.API || "http://127.0.0.1:8787";
const VIDEO_BASE = process.env.VIDEO_BASE || "http://127.0.0.1:18767/";
const TRACK = JSON.parse(fs.readFileSync(process.env.TRACK || "/workspace/padel-test/new-track.json", "utf8"));
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const SHOTS = ROOT + "screens/";

const failures = [];
function assert(cond, msg) {
  if (!cond) { failures.push(msg); console.error("FAIL", msg); }
  else console.log("OK  ", msg);
}

// 1. Server levels are a verbatim copy of quiz.js levels.
{
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(ROOT + "quiz.js", "utf8"), sandbox);
  const quizLevels = sandbox.window.PadelQuiz.LEVELS;
  const serverLevels = require(ROOT + "server/lib/levels.js").LEVELS;
  assert(JSON.stringify(quizLevels) === JSON.stringify(serverLevels), "server/lib/levels.js matches quiz.js LEVELS");
  const rating = require(ROOT + "server/lib/rating.js");
  const d = rating.describePlayer(TRACK, { top: "black", bottom: "white" });
  assert(d.half === "near" && d.imageSide === "right", "track describes near half, right side (got " + d.half + "/" + d.imageSide + ")");
  const prompt = rating.buildPrompt([{ duration: 29.56, description: d }], { hand: "right" });
  assert(/STRICT JSON/.test(prompt) && /shorter than about 2 minutes/.test(prompt) && /C1 \(3\.5/.test(prompt), "prompt demands strict JSON, low confidence for short clips, uses quiz levels");
  const n = rating.normalizeResult({ player_found: true, level: "b2", confidence: "high", explanation_he: "א".repeat(400), subscores: { volley: 12, bandeja: null } }, { totalSeconds: 30, videoCount: 1 });
  assert(n.level === "B2" && n.confidence === "low" && n.explanation.length <= 200 && n.subscores.volley === 10 && n.subscores.bandeja === null, "normalizer clamps, truncates and forces low confidence under 2 min");
}

{
  const html = fs.readFileSync(ROOT + "index.html", "utf8");
  assert(/src="v12\/app\.js"/.test(html) && /href="v12\/cards\.css"/.test(html) && !/v10-2\//.test(html), "index.html loads assets from v12/");
  for (const f of ["app.js", "quiz.js", "players.js", "track.js", "styles.css", "cards.css"]) {
    assert(fs.readFileSync(ROOT + f, "utf8") === fs.readFileSync(ROOT + "v12/" + f, "utf8"), "v12/" + f + " is in sync");
  }
}

// 2. API basics.
{
  const h = await fetch(API + "/healthz").then((r) => r.json());
  assert(h.ok && h.mock, "API /healthz is up in mock mode");
  const bad = await fetch(API + "/api/ai-rating", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: "{}" });
  assert(bad.status === 403, "foreign Origin is rejected (403)");
  const pre = await fetch(API + "/api/ai-rating", { method: "OPTIONS", headers: { Origin: "https://padel-card.onrender.com" } });
  assert(pre.status === 204 && pre.headers.get("access-control-allow-origin") === "https://padel-card.onrender.com", "CORS preflight allows padel-card.onrender.com");
  const ssrf = await fetch(API + "/api/ai-rating", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ videoUrl: "http://169.254.169.254/latest" }) }).then((r) => r.json());
  assert(ssrf.error === "video_not_allowed", "non-Cloudinary video URL is refused");
}

const PHOTO = BASE + "avatars/alon.jpg";
const VIDEO = VIDEO_BASE + "tal-pushit.mp4";

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
const device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" };

async function newPage(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", (err) => { console.log("PAGEERROR", err.message); failures.push("pageerror: " + err.message); });
  return page;
}

const owner = await browser.newContext(device);
const page = await newPage(owner);
await page.goto(BASE);
await page.evaluate(({ photo, video, track, poster }) => {
  localStorage.setItem("padelCard.v2", JSON.stringify({
    levelId: "B2",
    profile: { id: "local-tal-ai", name: "טל גלעד", gender: "male", age: "36", hand: "right", side: "right", competitor: "no", hasPartner: "no", partnerId: null, photo, region: "center", courts: [], frequency: "2-3", tenure: "3plus", style: "both", shots: ["volley"] },
    answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
    videos: [{ id: "vid-1", name: "משחק", link: video, poster, duration: 29.56, bytes: 2767965, trackUrl: "", marker: null, track }]
  }));
}, { photo: PHOTO, video: VIDEO, track: TRACK, poster: VIDEO_BASE + "frames/raw-0.png" });

await page.goto(BASE + "#/card");
await page.reload(); // state is read from localStorage at boot
await page.waitForSelector("#card-root .ut-card");
const qLine = await page.textContent("#card-root .ut-rating-line");
assert(/רמה לפי השאלון/.test(qLine) && /B2 · 4\.0/.test(qLine), "questionnaire line: " + qLine.trim().replace(/\s+/g, " "));
assert(!(await page.$("#card-root .ut-ai")), "no AI line before analysis");
const btn = await page.$("#ai-rate-btn");
assert(btn && /קבל AI Rating/.test(await btn.textContent()), "owner sees 'קבל AI Rating'");
await page.locator("#ai-rate-btn").scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOTS + "v12-owner-button.png" });

let sentBody = null;
page.on("request", (req) => { if (req.url().endsWith("/api/ai-rating") && req.method() === "POST") sentBody = JSON.parse(req.postData() || "{}"); });
await page.click("#ai-rate-btn");
await page.waitForSelector("#ai-rate-btn.is-loading", { timeout: 5000 });
const loadingText = await page.textContent("#ai-rate-btn");
assert(/מנתח את המשחק… זה יכול לקחת דקה/.test(loadingText), "loading state text: " + loadingText.trim());
await page.locator("#ai-rate-btn").scrollIntoViewIfNeeded();
await page.screenshot({ path: SHOTS + "v12-owner-loading.png" });

await page.waitForSelector("#card-root .ut-ai", { timeout: 60000 });
assert(sentBody && sentBody.videos && sentBody.videos.length === 1 && sentBody.videos[0].track && sentBody.videos[0].track.v === 2, "request carries the v:2 track");
assert(sentBody && sentBody.videos[0].appearance, "request carries clothing colours: " + JSON.stringify(sentBody && sentBody.videos[0].appearance));
assert(sentBody && sentBody.cardId === "local-tal-ai" && sentBody.profile.hand === "right", "request carries cardId + hand");
const aiLine = (await page.textContent("#card-root .ut-ai-line")).replace(/\s+/g, " ");
assert(/AI Rating/.test(aiLine) && /C1 · 3\.5/.test(aiLine), "AI line shows C1 · 3.5: " + aiLine);
assert(/ביטחון נמוך/.test(aiLine), "short clip → low confidence badge");
assert(/מבוסס על סרטון אחד/.test(aiLine), "shows video count");
await page.waitForTimeout(700);
assert(await page.isVisible("#card-root .ut-ai-details"), "details auto-expand after a fresh rating");
const bars = await page.$$eval("#card-root .ai-bar", (els) => els.length);
assert(bars === 8, "8 sub-score bars (got " + bars + ")");
await page.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "center" }));
await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + "v12-ai-expanded.png" });
await page.click("#card-root .ut-ai-line");
assert(!(await page.isVisible("#card-root .ut-ai-details")), "tap collapses details");
await page.evaluate(() => window.scrollTo(0, 0));
await page.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "center" }));
await page.waitForTimeout(400);
await page.screenshot({ path: SHOTS + "v12-ai-collapsed.png" });
assert(/עדכון AI Rating/.test(await page.textContent("#ai-rate-btn")), "button becomes 'עדכון AI Rating'");

const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).profile.ai);
assert(saved && saved.l === "C1" && saved.c === 0 && saved.n === 1 && saved.s.length === 8, "AI result saved to localStorage: " + JSON.stringify(saved));

const waHref = await page.getAttribute("#wa-share-own", "href");
const shareUrl = decodeURIComponent(waHref.split("text=")[1]).split("\n").pop();
const payload = JSON.parse(Buffer.from(shareUrl.split("#/p/")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
assert(payload.ai && payload.ai.l === "C1", "share link hash carries ai");
const aiBytes = Buffer.from(JSON.stringify(payload.ai)).length;
assert(aiBytes < 520, "ai payload is small (" + aiBytes + " bytes JSON, link " + shareUrl.length + " chars)");

// Re-saving the profile keeps the AI result.
await page.goto(BASE + "#/profile");
await page.waitForSelector("#profile-form");
await page.evaluate(() => document.querySelector('#profile-form button[type="submit"], #profile-form .btn-primary').click());
await page.waitForTimeout(500);
const afterEdit = await page.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).profile.ai);
assert(afterEdit && afterEdit.l === "C1", "editing the profile keeps the AI result");

// Error path: Hebrew toast.
await page.goto(BASE + "#/card");
await page.waitForSelector("#ai-rate-btn");
await page.route("**/api/ai-rating", (route) => route.fulfill({ status: 429, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "rate_limited", message: "ביקשתם הרבה ניתוחים לאחרונה. נסו שוב מאוחר יותר" }) }));
await page.click("#ai-rate-btn");
await page.waitForFunction(() => /ביקשתם הרבה ניתוחים/.test(document.getElementById("toast").textContent) && document.getElementById("toast").classList.contains("show"), null, { timeout: 20000 });
assert(true, "server error → Hebrew toast");
assert(!(await page.$("#ai-rate-btn.is-loading")), "button leaves loading state after error");
await page.unroute("**/api/ai-rating");
await page.route("**/api/ai-rating", (route) => route.abort("connectionrefused"));
await page.click("#ai-rate-btn");
await page.waitForFunction(() => /אין חיבור לשרת ה-AI/.test(document.getElementById("toast").textContent), null, { timeout: 20000 });
assert(true, "network failure → Hebrew toast");
await page.screenshot({ path: SHOTS + "v12-error-toast.png" });

// Visitor opens the shared link.
const visitor = await browser.newContext(device);
const vpage = await newPage(visitor);
await vpage.goto(shareUrl);
await vpage.waitForSelector("#card-root .ut-ai");
assert(!(await vpage.$("#ai-rate-btn")), "visitor does not see the AI button");
const vLine = (await vpage.textContent("#card-root .ut-ai-line")).replace(/\s+/g, " ");
assert(/C1 · 3\.5/.test(vLine) && /ביטחון נמוך/.test(vLine), "visitor sees AI Rating: " + vLine);
await vpage.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "center" }));
await vpage.screenshot({ path: SHOTS + "v12-visitor-collapsed.png" });
await vpage.click("#card-root .ut-ai-line");
assert(await vpage.isVisible("#card-root .ut-ai-details"), "visitor can expand details");
const expl = await vpage.textContent("#card-root .ut-ai-expl");
assert(expl && expl.length <= 200, "explanation shown (" + expl.length + " chars)");
await vpage.evaluate(() => document.querySelector("#card-root .ut-ai").scrollIntoView({ block: "center" }));
await vpage.screenshot({ path: SHOTS + "v12-visitor-expanded.png" });

// Old links without ai still render.
await vpage.goto(BASE + "#/demo/michal");
await vpage.waitForSelector("#card-root .ut-card");
assert(!(await vpage.$("#card-root .ut-ai")), "demo card without AI renders normally");

await browser.close();
console.log(failures.length ? "\n" + failures.length + " FAILURE(S)" : "\nALL PASS");
process.exit(failures.length ? 1 : 0);
