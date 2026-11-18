// v27 — court-side QR, scanner, and rating without a prior request.
// Disposable @example.com users only. Never emails real coaches. Never prints real emails.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V27_BASE || "http://127.0.0.1:8882/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v27.player@example.com";
const RATER_EMAIL = "padel.test.v27.rater@example.com";
const ADMIN_EMAIL = "padel.test.v27.admin@example.com";
const RATER_NAME = "מאמן בדיקה v27";
const PLAYER_NAME = "שחקן בדיקה v27";
const CLUB = "פאדל בדיקה v27";

function seed(id, name, levelId) {
  return {
    levelId: levelId || "C1",
    profile: {
      id, name, gender: "male", age: "32", hand: "right", side: "right",
      competitor: "no", hasPartner: "no", partnerId: null,
      photo: BASE + "avatars/alon.jpg", region: "sharon", courts: [],
      frequency: "2-3", tenure: "1-2", style: "social", shots: ["volley"],
      ai: { l: "B2", c: 2, n: 1, t: 180, d: 261117, s: [3, 3, 3, 3, 3, 3, 3, 3] }
    },
    answers: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    videos: []
  };
}

await cleanupExampleTestUsers(/padel\.test\.v27/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await setLegalAcceptance(player.id, { media: true });
await setLegalAcceptance(rater.id, { media: true });
await setLegalAcceptance(admin.id, { media: true });
await deleteCard(player.id);
await deleteCard(rater.id);
const cardId = "local-v27-player";
await upsertCard(player.id, seed(cardId, PLAYER_NAME, "C1"));
await addAdmin(ADMIN_EMAIL, admin.id);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
});

async function signIn(page, creds) {
  await page.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const result = await page.evaluate(async ({ email, password }) => {
    const c = PadelAuth.getClient();
    const { error } = await c.auth.signInWithPassword({ email, password });
    return { error: error && (error.message || String(error)) };
  }, { email: creds.email, password: creds.password });
  if (result.error) throw new Error("sign-in failed: " + result.error);
  await page.waitForFunction(() => {
    const modal = document.getElementById("legal-consent-modal");
    const accepted = window.PadelLegal && PadelLegal.hasAccepted && PadelLegal.hasAccepted();
    return accepted && (!modal || modal.classList.contains("hidden"));
  }, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function rpcAs(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc(name, args || {});
    return { data, error: error && (error.message || String(error)) };
  }, { name, args });
}

async function hideToast(page) {
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) { t.classList.remove("show"); t.textContent = ""; }
  }).catch(() => {});
  await page.waitForTimeout(40);
}

const profilePayload = {
  clubs: [CLUB],
  city: "הוד השרון",
  region: "sharon",
  years_experience: 6,
  certification: "מאמן מוסמך בדיקה",
  audiences: ["beginners"],
  bio: "מאמן בדיקה לדירוג במגרש.",
  contact: "",
  contact_public: false,
  level: "B1"
};

let raterId = null;
let inviteToken = null;

try {
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(600);
  const added = await rpcAs(pageA, "admin_add_certified_rater", { p_full_name: RATER_NAME, p_email: null });
  assert(added.data && added.data.id, "admin created unlinked test rater");
  raterId = added.data.id;
  const live = await rpcAs(pageA, "admin_create_rater_invite", { p_rater_id: raterId });
  inviteToken = live.data && live.data.token;
  assert(!!inviteToken, "admin issued an invite");
  await ctxA.close();

  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE + "#/invite/" + inviteToken);
  await signIn(pageR, rater);
  await pageR.waitForFunction(() => (location.hash || "").indexOf("coach-profile") !== -1, { timeout: 20000 });
  const saved = await rpcAs(pageR, "upsert_my_certified_profile", { p_profile: profilePayload });
  assert(saved.data && saved.data.is_complete, "rater profile is complete");

  // Rater cannot use player-card or coaches directory
  await pageR.goto(BASE + "#/");
  await pageR.waitForTimeout(800);
  const raterHome = await pageR.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return !!(el && !el.classList.contains("hidden"));
    };
    return {
      scan: vis("scan-card-btn") && /סרוק כרטיס שחקן/.test((document.getElementById("scan-card-btn") || {}).textContent || ""),
      coaches: vis("home-coaches-btn"),
      quiz: vis("start-quiz"),
      showCard: vis("show-card-btn")
    };
  });
  assert(raterHome.scan, "rater home shows סרוק כרטיס שחקן");
  assert(!raterHome.coaches && !raterHome.quiz, "rater home still hides the coaches directory and player-card CTA");
  await ctxR.close();

  // Player QR
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.goto(BASE + "#/card");
  await pageP.waitForSelector("#view-card:not(.hidden) #show-card-btn", { timeout: 15000 });
  const playerCard = await pageP.evaluate(() => {
    const btn = document.getElementById("show-card-btn");
    const actions = document.getElementById("owner-actions");
    return {
      visible: !!(btn && actions && !actions.classList.contains("hidden") && !btn.classList.contains("hidden")),
      label: (btn && btn.textContent || "").trim()
    };
  });
  assert(playerCard.visible && playerCard.label === "הצג כרטיס", "player's own card shows הצג כרטיס");
  await pageP.click("#show-card-btn");
  await pageP.waitForSelector("#show-card-overlay:not(.hidden) #show-card-qr svg", { timeout: 10000 });
  const qr = await pageP.evaluate((expectedId) => {
    const ov = document.getElementById("show-card-overlay");
    const name = ((document.getElementById("show-card-name") || {}).textContent || "").trim();
    const level = ((document.getElementById("show-card-level") || {}).textContent || "").trim();
    const svg = document.querySelector("#show-card-qr svg");
    const url = window.PadelCourtside && PadelCourtside.publicCardUrl(expectedId);
    return {
      open: ov && !ov.classList.contains("hidden"),
      name,
      level,
      hasSvg: !!(svg && (svg.querySelectorAll("path, rect, use").length > 0 || (svg.innerHTML || "").length > 80)),
      url: url || "",
      urlOk: !!(url && url.indexOf("#/card/" + expectedId) !== -1)
    };
  }, cardId);
  assert(qr.open && qr.hasSvg, "fullscreen QR overlay renders a high-contrast QR code");
  assert(qr.name === PLAYER_NAME, "QR screen shows the player name");
  assert(/C1|B2|רמה/.test(qr.level), "QR screen shows a level under the code");
  assert(qr.urlOk, "QR encodes the public #/card/<id> URL");
  await hideToast(pageP);
  await pageP.screenshot({ path: SHOTS + "v27-player-qr.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v27-player-qr.png");
  await pageP.click("#show-card-close");
  await ctxP.close();

  // Guest can open the public card route
  const ctxG = await browser.newContext(DEVICE);
  const pageG = await ctxG.newPage();
  await pageG.goto(BASE + "#/card/" + cardId);
  await pageG.waitForFunction((name) => {
    const root = document.getElementById("card-root");
    return root && (root.innerText || "").indexOf(name) !== -1;
  }, PLAYER_NAME, { timeout: 15000 });
  const guest = await pageG.evaluate(() => ({
    login: !!(document.getElementById("view-login") && !document.getElementById("view-login").classList.contains("hidden")),
    rate: !!(document.getElementById("courtside-rate-btn") && !document.getElementById("courtside-bar").classList.contains("hidden"))
  }));
  assert(!guest.login, "public #/card/<id> is not login-gated");
  assert(!guest.rate, "guests do not see דרג עכשיו");
  await ctxG.close();

  // Rater scan screen + manual open + rate now
  const ctxS = await browser.newContext(DEVICE);
  const pageS = await ctxS.newPage();
  await pageS.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "mock-resend-v27" }) });
  });
  await pageS.goto(BASE);
  await signIn(pageS, rater);

  // Pending request first, so courtside rating should fulfill it
  const req = await rpcAs(pageS, "create_rating_request", {
    // this will fail: rater is not the card owner
  }).catch(() => ({ error: "skip" }));
  await ctxS.close();

  // Player creates a pending request to this rater
  const ctxPR = await browser.newContext(DEVICE);
  const pagePR = await ctxPR.newPage();
  await pagePR.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "mock-resend-v27" }) });
  });
  await pagePR.goto(BASE);
  await signIn(pagePR, player);
  const createdReq = await rpcAs(pagePR, "create_rating_request", {
    p_rater_id: raterId,
    p_card_id: cardId,
    p_message: "בדיקת מגרש"
  });
  assert(createdReq.data && createdReq.data.id, "player opened a pending request to the test rater");
  const pendingId = createdReq.data.id;
  await ctxPR.close();

  const ctxRate = await browser.newContext(DEVICE);
  const pageRate = await ctxRate.newPage();
  await pageRate.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "mock-resend-v27" }) });
  });
  await pageRate.goto(BASE);
  await signIn(pageRate, rater);
  await pageRate.goto(BASE + "#/scan");
  await pageRate.waitForSelector("#view-scan:not(.hidden)", { timeout: 10000 });
  const scanUi = await pageRate.evaluate(() => ({
    title: ((document.querySelector("#view-scan h1") || {}).textContent || "").trim(),
    video: !!document.getElementById("scan-video"),
    manual: !!document.getElementById("scan-manual"),
    playsinline: document.getElementById("scan-video") && document.getElementById("scan-video").hasAttribute("playsinline")
  }));
  assert(scanUi.title === "סריקת כרטיס שחקן" && scanUi.video && scanUi.manual && scanUi.playsinline,
    "rater scan screen has camera surface, playsinline, and manual fallback");
  await hideToast(pageRate);
  await pageRate.evaluate(() => {
    window.scrollTo(0, 0);
    const v = document.getElementById("scan-video");
    // Hide the browser's fake camera pattern so the shot shows the viewfinder frame.
    if (v) v.style.opacity = "0";
  });
  await pageRate.waitForTimeout(250);
  await pageRate.screenshot({ path: SHOTS + "v27-rater-scan.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v27-rater-scan.png");

  await pageRate.fill("#scan-manual", BASE + "#/card/" + cardId);
  await pageRate.click("#scan-manual-go");
  await pageRate.waitForFunction((name) => {
    const root = document.getElementById("card-root");
    const hash = location.hash || "";
    return hash.indexOf("card/") !== -1 && root && (root.innerText || "").indexOf(name) !== -1;
  }, PLAYER_NAME, { timeout: 15000 });
  await pageRate.waitForSelector("#courtside-bar:not(.hidden) #courtside-rate-btn:not(.hidden)", { timeout: 10000 });
  const levels = await pageRate.evaluate(() => (document.getElementById("card-root") || {}).innerText || "");
  assert(/דירוג שאלון|דירוג AI|דירוג מוסמך|דירוג משוקלל/.test(levels),
    "rater view of the scanned card shows quiz/AI/certified/weighted levels");
  await hideToast(pageRate);
  await pageRate.locator("#courtside-rate-btn").scrollIntoViewIfNeeded();
  await pageRate.waitForTimeout(300);
  await pageRate.screenshot({ path: SHOTS + "v27-rate-now.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v27-rate-now.png");

  await pageRate.click("#courtside-rate-btn");
  await pageRate.waitForSelector("#certified-sheet:not(.hidden)", { timeout: 8000 });
  await pageRate.selectOption("#certified-level-select", "B1");
  await pageRate.click("#certified-sheet-save");
  await pageRate.waitForFunction(() => {
    const t = document.getElementById("toast");
    return t && /הדירוג המוסמך נשמר/.test(t.textContent || "");
  }, { timeout: 15000 });
  assert(true, "דרג עכשיו saves a courtside rating");

  // Fulfillment of the pending request
  const after = await rpcAs(pageRate, "list_rater_requests", {});
  const list = Array.isArray(after.data) ? after.data : [];
  const fulfilled = list.find((r) => r && r.id === pendingId) || null;
  // inbox might only return pending; check via get if needed
  const cooldownLook = await rpcAs(pageRate, "get_card_for_courtside", { p_card_id: cardId });
  assert(cooldownLook.data && cooldownLook.data.can_rate === false && cooldownLook.data.cooldown && cooldownLook.data.cooldown.active,
    "after a courtside rating the 3-month cooldown is active");
  assert(/B1/.test((cooldownLook.data.cooldown && cooldownLook.data.cooldown.last_level) || ""),
    "cooldown payload includes the existing certified level");

  const blocked = await rpcAs(pageRate, "rate_card_courtside", { p_card_id: cardId, p_level: "A1" });
  assert(/cooldown/i.test(blocked.error || ""), "server rejects a second courtside rating within 3 months");

  const missing = await rpcAs(pageRate, "get_card_for_courtside", { p_card_id: "does-not-exist-v27" });
  assert(/card not found|invalid card/i.test(missing.error || ""), "missing card is rejected");
  await ctxRate.close();

  // Non-rater cannot call courtside RPCs
  const ctxN = await browser.newContext(DEVICE);
  const pageN = await ctxN.newPage();
  await pageN.goto(BASE);
  await signIn(pageN, player);
  const denied = await rpcAs(pageN, "rate_card_courtside", { p_card_id: cardId, p_level: "C1" });
  assert(/not a certified rater|not authorized|cannot rate own card/i.test(denied.error || ""),
    "a non-rater cannot call rate_card_courtside");
  await ctxN.close();
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v27/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
