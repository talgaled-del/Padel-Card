// v15 — v13/v14 regression (per-video AI, progress, combine, level-range badge + dialog) on the v15 tree.
// Owner flows sign in as the disposable test user so the login gate is satisfied.
// Needs: static site (python3 -m http.server 8870 --directory /workspace/padel-card-v15 --bind 127.0.0.1)
//        BASE=http://127.0.0.1:8870/
//        CORS static for test clips: node /workspace/padel-v13-test/cors-static.mjs /workspace/padel-v13-test 18767
//        API: cd server && MOCK_AI=1 MOCK_DELAY_MS=5000 RATE_PER_HOUR=1000 RATE_PER_DAY=1000 EXTRA_VIDEO_HOSTS=127.0.0.1:18767 PORT=8787 node server.js
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import { ensureTestUser, deleteCard, deleteTestUser, upsertCard } from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8870/";
const VB = process.env.VIDEO_BASE || "http://127.0.0.1:18767/";
const TRACK = JSON.parse(fs.readFileSync("/workspace/padel-test/new-track.json", "utf8"));
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

const CLIPS = {
  1: { link: VB + "clip1.mp4", poster: VB + "poster1.jpg", duration: 29.56, name: "IMG_4121.MOV" },
  2: { link: VB + "clip2.mp4", poster: VB + "poster2.jpg", duration: 20.08, name: "IMG_4188.MOV" },
  3: { link: VB + "clip3.mp4", poster: VB + "poster3.jpg", duration: 25, name: "IMG_4190.MOV" }
};
function vid(n, extra) { return Object.assign({ id: "vid-" + n, bytes: 2000000, trackUrl: "", marker: null, track: TRACK }, CLIPS[n], extra || {}); }

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome-stable", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const device = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: "he-IL",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1" };

const creds = await ensureTestUser();
console.log("TEST USER ready");

async function signInPage(page) {
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const result = await page.evaluate(async ({ email, password }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    return { error: error && (error.message || String(error)), id: data && data.user && data.user.id };
  }, { email: creds.email, password: creds.password });
  if (result.error) throw new Error("sign-in failed: " + result.error);
  return result;
}

async function ownerPage(seed) {
  await deleteCard(creds.id);
  const card = { levelId: seed.levelId, profile: seed.profile, answers: seed.answers || [], videos: seed.videos || [] };
  await upsertCard(creds.id, card);
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("PAGEERROR", e.message); failures.push("pageerror: " + e.message); });
  page.requests = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/ai-rating") && r.method() === "POST") {
      const b = JSON.parse(r.postData() || "{}");
      page.requests.push({ url: b.videos && b.videos[0] && b.videos[0].videoUrl, perVideo: b.perVideo, n: (b.videos || []).length });
    }
  });
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.setItem("padelCard.aiTiming", JSON.stringify({ msPerVideoSecond: 220, overheadMs: 1200 }));
  });
  await page.reload();
  await signInPage(page);
  await page.waitForSelector("#card-root .ut-card", { timeout: 30000 });
  return page;
}
function profile(levelId, extra) {
  return Object.assign({ id: "local-tal", name: "טל גלעד", gender: "male", age: "36", hand: "right", side: "right", competitor: "no", hasPartner: "no", partnerId: null,
    photo: BASE + "avatars/alon.jpg", region: "center", courts: [], frequency: "2-3", tenure: "3plus", style: "both", shots: ["volley"] }, extra || {});
}
const text = async (page, sel) => ((await page.textContent(sel)) || "").replace(/\s+/g, " ").trim();
const badge = (page) => text(page, "#card-root .ut-hero .ut-badge b");
async function snap(page, name) {
  for (let i = 0; i < 3; i++) {
    try { await page.screenshot({ path: SHOTS + name, timeout: 20000 }); return; } catch (e) { console.log("     retry screenshot", name); }
  }
  failures.push("screenshot failed: " + name);
}
async function shot(page, name, sel) {
  await page.evaluate(() => document.getElementById("toast").classList.remove("show"));
  if (sel) await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: "center" }); }, sel);
  else await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  await snap(page, name);
}
async function pushLocalCardAndReload(page, waitSel) {
  const res = await page.evaluate(async () => {
    const d = JSON.parse(localStorage.getItem("padelCard.v2"));
    const c = PadelAuth.getClient();
    const sess = await c.auth.getUser();
    const user = sess && sess.data && sess.data.user;
    if (!user) return { error: "no user" };
    const { error } = await c.from("cards").upsert({
      user_id: user.id,
      card: { levelId: d.levelId, profile: d.profile, answers: d.answers || [], videos: d.videos || [] },
      updated_at: new Date().toISOString()
    });
    return { error: error && (error.message || String(error)) };
  });
  if (res && res.error) throw new Error("push card: " + res.error);
  await page.reload();
  await page.waitForSelector(waitSel || "#card-root .ut-card", { timeout: 30000 });
}
async function addVideos(page, list) {
  await page.evaluate((list) => {
    const d = JSON.parse(localStorage.getItem("padelCard.v2"));
    d.videos = d.videos.concat(list);
    localStorage.setItem("padelCard.v2", JSON.stringify(d));
  }, list);
  await pushLocalCardAndReload(page);
}
async function waitRunDone(page) {
  await page.waitForSelector("#ai-run.is-finished", { timeout: 120000 });
  await page.waitForTimeout(1200);
}

/* ===== Home: how it works ===== */
{
  const ctx = await browser.newContext(device);
  const hp = await ctx.newPage();
  hp.on("pageerror", (e) => failures.push("home pageerror: " + e.message));
  await hp.goto(BASE);
  await hp.waitForSelector("#view-login:not(.hidden) .hiw-list li");
  const steps = await hp.$$eval("#view-login:not(.hidden) .hiw-list li strong", (els) => els.map((e) => e.textContent.trim()));
  assert(steps.length === 5 && steps.some((t) => /AI Rating/.test(t)) && steps.some((t) => /3 סרטוני/.test(t)) && steps.some((t) => /העיניים/.test(t)), "login/home steps: " + steps.join(" | "));
  assert(!(await hp.$("#view-login .feature-list")), "old feature list merged into the new steps");
  const loginCopy = ((await hp.textContent("#view-login .lede")) || "").trim();
  assert(/התחברו כדי ליצור ולשמור את כרטיס השחקן שלכם/.test(loginCopy), "logged-out home shows login copy: " + loginCopy);
  await hp.evaluate(() => document.querySelector("#view-login .hiw").scrollIntoView({ block: "center" }));
  await hp.waitForTimeout(400);
  await hp.screenshot({ path: SHOTS + "v13-home.png" });
  await hp.evaluate(() => window.scrollTo(0, 0));
  await hp.screenshot({ path: SHOTS + "v13-home-full.png", fullPage: true });
  await hp.screenshot({ path: SHOTS + "v15-logged-out-home.png", fullPage: true });
  await ctx.close();
}

/* ===== Scenario A: Tal's case — v12 analysed video 1, then 2 new videos uploaded ===== */
{
  const legacy = { l: "C1", c: 0, n: 1, d: 261115, e: "וולי יציב ועלייה טובה לרשת. חסרה עקביות מהזכוכית.", s: [6, 5, 4, 5, 4, 6, 5, 5] };
  const page = await ownerPage({ levelId: "B2", profile: profile("B2", { ai: legacy }), answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3], videos: [vid(1), vid(2), vid(3)] });
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).videos.map((v) => !!v.ai));
  assert(JSON.stringify(migrated) === "[true,false,false]", "v12 result is attached to video 1 only: " + JSON.stringify(migrated));
  const btn = await text(page, "#ai-rate-btn");
  assert(btn === "✦נתח סרטונים חדשים (2)" || /נתח סרטונים חדשים \(2\)/.test(btn), "button: " + btn);
  const idle = await page.$$eval(".ai-run-list.idle .ai-st", (els) => els.map((e) => e.textContent.trim()));
  assert(JSON.stringify(idle) === JSON.stringify(["נותח", "טרם נותח", "טרם נותח"]), "idle status list: " + idle.join(" / "));
  assert((await badge(page)) === "C1-B2", "1-step gap (quiz B2, AI C1) → badge C1-B2: " + (await badge(page)));
  await shot(page, "v13-badge-range.png");
  await shot(page, "v13-idle-new2.png", "#ai-rate-btn");

  await page.route("**/healthz", async (r) => { await new Promise((res) => setTimeout(res, 2500)); await r.continue(); });
  await page.click("#ai-rate-btn");
  await page.waitForSelector("#ai-run.is-running");
  assert(/מעיר את השרת/.test(await text(page, "#ai-run-stage")), "wake stage shown: " + (await text(page, "#ai-run-stage")));
  await shot(page, "v13-progress-wake.png", "#ai-run");
  await page.waitForFunction(() => /סרטון 2/.test(document.getElementById("ai-run-stage").textContent) && parseInt(document.getElementById("ai-run-pct").textContent) > 5, null, { timeout: 30000 });
  await page.waitForTimeout(1800);
  const st1 = await page.$$eval("#ai-run-list .ai-st", (els) => els.map((e) => e.textContent.trim()));
  assert(JSON.stringify(st1) === JSON.stringify(["נותח", "מנתח עכשיו…", "ממתין"]), "mid-run statuses: " + st1.join(" / "));
  const pct1 = parseInt(await text(page, "#ai-run-pct"));
  assert(pct1 > 0 && pct1 < 60, "overall progress while on video 2: " + pct1 + "%");
  await shot(page, "v13-progress-video2.png", "#ai-run");
  await page.waitForFunction(() => /סרטון 3/.test(document.getElementById("ai-run-stage").textContent), null, { timeout: 30000 });
  await page.waitForTimeout(2200);
  const st2 = await page.$$eval("#ai-run-list .ai-st", (els) => els.map((e) => e.textContent.trim()));
  assert(JSON.stringify(st2) === JSON.stringify(["נותח", "נותח", "מנתח עכשיו…"]), "statuses on video 3: " + st2.join(" / "));
  const pct2 = parseInt(await text(page, "#ai-run-pct"));
  assert(pct2 >= 40 && pct2 <= 99, "overall progress while on video 3: " + pct2 + "%");
  await shot(page, "v13-progress-video3.png", "#ai-run");
  await waitRunDone(page);
  assert(page.requests.length === 2, "exactly 2 analysis requests (got " + page.requests.length + ")");
  assert(page.requests.every((r) => r.perVideo === true && r.n === 1), "one video per request, perVideo mode");
  assert(page.requests[0].url.endsWith("clip2.mp4") && page.requests[1].url.endsWith("clip3.mp4"), "only the new videos were sent: " + page.requests.map((r) => r.url.split("/").pop()).join(", "));
  assert((await text(page, "#ai-run-pct")) === "100%", "progress ends at 100%");
  const fin = await text(page, "#card-root .ut-ai-line");
  // v1 legacy C1 low 30s (w30) · v2 C2 low 20s (w20) · v3 B2 medium 25s (w50) → 3.3 → C1, 75s total → low
  assert(/C1 · 3\.5/.test(fin) && /ביטחון נמוך/.test(fin) && /מבוסס על 3 סרטונים/.test(fin), "combined result: " + fin);
  assert(/כל הסרטונים נותחו/.test(await text(page, "#ai-rate-btn")) && (await page.$("#ai-reanalyze-btn")), "button: all analysed + re-analyse option");
  assert(!(await page.$("#level-dialog")), "no dialog for a 1-step gap");
  await shot(page, "v13-final-run.png", "#ai-run");
  const basis = await page.$$eval("#card-root .ai-basis-row", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  assert(basis.length === 3, "expanded section lists the 3 videos: " + basis.join(" | "));
  await shot(page, "v13-final-expanded.png", "#card-root .ai-basis");
  await shot(page, "v13-final-top.png", "#card-root .ut-ai");

  // Visitor view of the share link.
  const waHref = await page.getAttribute("#wa-share-own", "href");
  const shareUrl = decodeURIComponent(waHref.split("text=")[1]).split("\n").pop();
  const vctx = await browser.newContext(device);
  const vp = await vctx.newPage();
  vp.on("pageerror", (e) => failures.push("visitor pageerror: " + e.message));
  await vp.goto(shareUrl);
  await vp.waitForSelector("#card-root .ut-ai");
  assert(!(await vp.$("#ai-rate-btn")) && !(await vp.$("#ai-run")), "visitor: no AI buttons/progress");
  assert(/רמה לפי השאלון/.test(await text(vp, "#card-root .ut-rating-line")) && /C1 · 3\.5/.test(await text(vp, "#card-root .ut-ai-line")), "visitor sees both rows");
  assert((await badge(vp)) === "C1-B2", "visitor badge C1-B2");
  await vp.click("#card-root .ut-ai-line");
  assert((await vp.$$("#card-root .ai-basis-row")).length === 3, "visitor sees the 3 analysed videos");
  await shot(vp, "v13-visitor-expanded.png", "#card-root .ai-basis");
  // Collapsible videos section (visitor).
  assert((await vp.getAttribute(".ut-vid-toggle", "aria-expanded")) === "false", "videos section collapsed by default");
  assert(/סרטוני משחק \(3\)/.test(await text(vp, ".ut-vid-title")), "toggle header shows count: " + (await text(vp, ".ut-vid-title")));
  await vp.waitForTimeout(400);
  assert(!(await vp.isVisible("#card-root .ut-video-tile")), "tiles hidden while collapsed");
  await shot(vp, "v13-videos-collapsed.png", ".ut-vids");
  await vp.click(".ut-vid-toggle");
  await vp.waitForTimeout(450);
  assert((await vp.getAttribute(".ut-vid-toggle", "aria-expanded")) === "true" && (await vp.isVisible("#card-root .ut-video-tile")), "tap expands, tiles visible");
  await shot(vp, "v13-videos-expanded.png", ".ut-vids");
  await vp.reload();
  await vp.waitForSelector(".ut-vid-toggle");
  assert((await vp.getAttribute(".ut-vid-toggle", "aria-expanded")) === "true", "open state remembered in the session");
  await vp.evaluate(() => { const v = document.createElement("video"); v.pause = () => { window.__paused = 1; }; document.querySelector(".ut-vid-inner").appendChild(v); });
  await vp.click(".ut-vid-toggle");
  assert((await vp.evaluate(() => window.__paused)) === 1 && (await vp.getAttribute(".ut-vid-toggle", "aria-expanded")) === "false", "collapsing pauses videos inside");
  console.log("     share link length:", shareUrl.length);
  await vctx.close();

  // Deleting a video drops it from the overall.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("padelCard.v2")); d.videos = d.videos.slice(0, 2); localStorage.setItem("padelCard.v2", JSON.stringify(d)); });
  await pushLocalCardAndReload(page, "#card-root .ut-ai");
  assert(/מבוסס על 2 סרטונים/.test(await text(page, "#card-root .ut-ai-line")), "deleted video drops out: " + (await text(page, "#card-root .ut-ai-line")));
  // Re-marking a video invalidates only that video.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("padelCard.v2")); d.videos[1].trackUrl = "https://res.cloudinary.com/jgreas8e/raw/upload/v2/remarked.json"; localStorage.setItem("padelCard.v2", JSON.stringify(d)); });
  await pushLocalCardAndReload(page, "#ai-rate-btn");
  assert(/נתח סרטונים חדשים \(1\)/.test(await text(page, "#ai-rate-btn")), "re-marked video counts as new: " + (await text(page, "#ai-rate-btn")));
  await page.context().close();
}

/* ===== Scenario B: fresh — 1 video analysed, then 2 added; >1 step gap → dialog YES; failure path ===== */
{
  const page = await ownerPage({ levelId: "B2", profile: profile("B2"), answers: [], videos: [vid(2)] });
  assert(/קבל AI Rating/.test(await text(page, "#ai-rate-btn")), "first time: 'קבל AI Rating'");
  await page.click("#ai-rate-btn");
  await page.waitForSelector("#level-dialog", { timeout: 60000 });
  assert(page.requests.length === 1, "first run: 1 request");
  const msg = await text(page, ".lvl-dialog-text");
  assert(msg === "ה-AI דירג אותך C2, רחוק מהרמה בשאלון (B2). להוריד את הרמה שלך לטווח C2-C1?", "dialog text: " + msg);
  await page.waitForTimeout(400);
  await snap(page, "v13-dialog-lower.png");
  await page.click("#level-dialog-yes");
  await page.waitForTimeout(300);
  assert((await badge(page)) === "C2-C1", "YES → badge C2-C1: " + (await badge(page)));
  const lr = await page.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).profile.lr);
  assert(lr && lr.a === "C2" && lr.q === "B2" && lr.ok === 1, "decision stored: " + JSON.stringify(lr));
  await shot(page, "v13-badge-accepted.png");

  // Add 2 videos; make clip3 fail once.
  await addVideos(page, [vid(1), vid(3)]);
  assert((await badge(page)) === "C2-C1", "badge persists after reload");
  assert(/נתח סרטונים חדשים \(2\)/.test(await text(page, "#ai-rate-btn")), "after adding 2: 'נתח סרטונים חדשים (2)'");
  await page.route("**/api/ai-rating", async (r) => {
    if ((r.request().postData() || "").includes("clip3.mp4")) {
      await r.fulfill({ status: 502, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "ai_failed", message: "ניתוח ה-AI נכשל. ודאו שהמצלמה הייתה קבועה ושהשחקן נשאר באותו צד לאורך הסרטון, ונסו שוב" }) });
    } else await r.continue();
  });
  page.requests = [];
  await page.click("#ai-rate-btn");
  await waitRunDone(page);
  assert(page.requests.length === 2 && page.requests.map((r) => r.url.split("/").pop()).join() === "clip1.mp4,clip3.mp4", "second run: only the 2 new videos: " + page.requests.map((r) => r.url.split("/").pop()).join());
  const st = await page.$$eval("#ai-run-list .ai-st", (els) => els.map((e) => e.textContent.trim()));
  assert(JSON.stringify(st) === JSON.stringify(["נותח", "נותח", "נכשל"]), "statuses with a failure: " + st.join(" / "));
  const failSummary = await text(page, "#ai-run-stage");
  assert(/1 נותחו, 1 נכשלו/.test(failSummary) && /מצלמה הייתה קבועה|אותו צד/.test(failSummary), "summary mentions filming cause: " + failSummary);
  await shot(page, "v13-failed-one.png", "#ai-run");
  await page.unroute("**/api/ai-rating");
  page.requests = [];
  assert(/נתח סרטונים חדשים \(1\)/.test(await text(page, "#ai-rate-btn")), "failed video stays pending");
  await page.click("#ai-rate-btn");
  await waitRunDone(page);
  assert(page.requests.length === 1 && page.requests[0].url.endsWith("clip3.mp4"), "retry sends only the failed video");
  // C2 low 20s w20 idx2 · C1 med 30s w60 idx3 · B2 med 25s w50 idx4 → 3.23 → C1 → 1 step from B2 → automatic range
  assert(/C1 · 3\.5/.test(await text(page, "#card-root .ut-ai-line")), "combined C1");
  assert((await badge(page)) === "C1-B2", "AI moved to 1 step → badge C1-B2 automatically: " + (await badge(page)));
  assert(!(await page.$("#level-dialog")), "no dialog when the new AI level is 1 step away");
  // Re-analyse all sends all 3.
  page.requests = [];
  await page.click("#ai-reanalyze-btn");
  await waitRunDone(page);
  assert(page.requests.length === 3, "re-analyse all → 3 requests");
  await page.context().close();
}

/* ===== Scenario C: >1 step gap → dialog NO; not asked again for the same levels ===== */
{
  const page = await ownerPage({ levelId: "B2", profile: profile("B2"), answers: [], videos: [vid(2)] });
  await page.click("#ai-rate-btn");
  await page.waitForSelector("#level-dialog", { timeout: 60000 });
  await page.click("#level-dialog-no");
  await page.waitForTimeout(300);
  assert((await badge(page)) === "B2", "NO → badge stays B2");
  const lr = await page.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).profile.lr);
  assert(lr && lr.ok === 0 && lr.a === "C2", "NO decision stored: " + JSON.stringify(lr));
  await shot(page, "v13-badge-declined.png");
  await page.click("#ai-reanalyze-btn");
  await waitRunDone(page);
  await page.waitForTimeout(900);
  assert(!(await page.$("#level-dialog")), "same AI level again → not asked again");
  assert(/רמה לפי השאלון/.test(await text(page, "#card-root .ut-rating-line")) && /C2 · 3\.0/.test(await text(page, "#card-root .ut-ai-line")), "both rows still shown");
  await page.context().close();
}

/* ===== Scenario D: AI higher by 2+ steps → raise dialog ===== */
{
  const page = await ownerPage({ levelId: "D1", profile: profile("D1"), answers: [], videos: [vid(1)] });
  await page.click("#ai-rate-btn");
  await page.waitForSelector("#level-dialog", { timeout: 60000 });
  const msg = await text(page, ".lvl-dialog-text");
  assert(msg === "ה-AI דירג אותך C1, רחוק מהרמה בשאלון (D1). להעלות את הרמה שלך לטווח C2-C1?", "raise dialog: " + msg);
  await snap(page, "v13-dialog-raise.png");
  await page.click("#level-dialog-yes");
  await page.waitForTimeout(300);
  assert((await badge(page)) === "C2-C1", "raise YES → C2-C1");
  await page.context().close();
}

/* ===== Equal levels → plain badge ===== */
{
  const page = await ownerPage({ levelId: "C1", profile: profile("C1"), answers: [], videos: [vid(1)] });
  await page.click("#ai-rate-btn");
  await waitRunDone(page);
  await page.waitForTimeout(900);
  assert((await badge(page)) === "C1" && !(await page.$("#level-dialog")), "equal levels → badge C1, no dialog");
  await page.context().close();
}

await browser.close();
try { await deleteTestUser(creds.id); console.log("TEST USER removed"); } catch (err) { console.error("cleanup user failed"); }
console.log(failures.length ? "\n" + failures.length + " FAILURE(S)" : "\nALL PASS");
process.exit(failures.length ? 1 : 0);
