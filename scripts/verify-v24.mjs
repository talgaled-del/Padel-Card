// v24 — standalone coach profiles: level + national ranking, no player card for raters.
// Disposable @example.com users only. Never emails real coaches. Never prints real emails.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V24_BASE || "http://127.0.0.1:8880/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v24.player@example.com";
const RATER_EMAIL = "padel.test.v24.rater@example.com";
const ADMIN_EMAIL = "padel.test.v24.admin@example.com";
const RATER_NAME = "מאמן בדיקה v24";
const CLUB = "פאדל בדיקה v24";
const RANKING = "12 באיגוד הפאדל הישראלי";
const LEVEL = "B1";

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

await cleanupExampleTestUsers(/padel\.test\.v24/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await setLegalAcceptance(player.id, { media: true });
await setLegalAcceptance(rater.id, { media: true });
await setLegalAcceptance(admin.id, { media: true });
await deleteCard(player.id);
await deleteCard(rater.id);
await upsertCard(player.id, seed("local-v24-player", "שחקן בדיקה v24", "C1"));
await addAdmin(ADMIN_EMAIL, admin.id);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
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
  await page.waitForTimeout(500);
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
    if (t) {
      t.classList.remove("show");
      t.textContent = "";
    }
  }).catch(() => {});
  await page.waitForTimeout(50);
}

const profilePayload = {
  clubs: [CLUB, "פאדל הרצליה"],
  city: "הוד השרון",
  region: "sharon",
  years_experience: 8,
  certification: "מאמן מוסמך בדיקה",
  audiences: ["beginners", "advanced"],
  bio: "מאמן בדיקה לפרופיל מוסמך עצמאי. בלי כרטיס שחקן.",
  contact: "0500000000",
  contact_public: true,
  level: LEVEL,
  national_ranking: RANKING
};

let raterId = null;
let inviteToken = null;

try {
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(800);
  const added = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: RATER_NAME,
    p_email: null
  });
  assert(added.data && added.data.id, "admin created unlinked test rater");
  raterId = added.data && added.data.id;
  const live = await rpcAs(pageA, "admin_create_rater_invite", { p_rater_id: raterId });
  inviteToken = live.data && live.data.token;
  assert(!!inviteToken, "admin issued an invite token");
  await ctxA.close();

  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE + "#/invite/" + inviteToken);
  await pageR.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  await signIn(pageR, rater);
  await pageR.waitForFunction(() => (location.hash || "").indexOf("coach-profile") !== -1, { timeout: 20000 });
  await pageR.waitForSelector("#view-coach-profile:not(.hidden)", { timeout: 15000 });
  assert(true, "invite claim routes the rater to the profile editor only");

  const badLevel = await rpcAs(pageR, "upsert_my_certified_profile", {
    p_profile: Object.assign({}, profilePayload, { level: "Z9" })
  });
  assert(/invalid level/i.test(badLevel.error || ""), "invalid self-declared level is rejected");

  const saved = await rpcAs(pageR, "upsert_my_certified_profile", { p_profile: profilePayload });
  if (!(saved.data && saved.data.is_complete)) console.error("upsert failed", saved.error, saved.data && Object.keys(saved.data || {}));
  assert(saved.data && saved.data.is_complete, "rater profile saves and is marked complete");
  assert(saved.data.level === LEVEL, "saved profile includes self-declared level");
  assert(saved.data.national_ranking === RANKING, "saved profile includes national ranking");
  assert(saved.data.show_player_card !== true, "profile does not expose a linked player card");
  assert(!saved.data.player && !saved.data.has_player_card && !saved.data.player_cert_levels,
    "profile JSON has no player-card fields");

  await pageR.evaluate(() => { if (window.PadelCoaches && PadelCoaches.loadEditor) return PadelCoaches.loadEditor(); });
  await pageR.waitForFunction((name) => {
    const n = document.getElementById("coach-edit-name");
    const s = document.getElementById("coach-edit-status");
    const lvl = document.getElementById("coach-edit-level");
    const rank = document.getElementById("coach-edit-ranking");
    return n && (n.textContent || "").indexOf(name) !== -1 && s && /מפורסם/.test(s.textContent || "")
      && lvl && lvl.value === "B1" && rank && (rank.value || "").indexOf("12") !== -1;
  }, RATER_NAME, { timeout: 15000 });
  const editorBits = await pageR.evaluate(() => {
    const view = document.getElementById("view-coach-profile");
    const text = (view && view.innerText) || "";
    return {
      levelLabel: /הרמה שלי/.test(text),
      rankLabel: /דירוג ארצי/.test(text),
      noUsePhoto: text.indexOf("שימוש בתמונת הכרטיס") === -1,
      noHidePlayer: text.indexOf("אל תציגו את דירוג השחקן") === -1
    };
  });
  assert(editorBits.levelLabel && editorBits.rankLabel, "editor shows הרמה שלי and דירוג ארצי");
  assert(editorBits.noUsePhoto && editorBits.noHidePlayer, "editor copy no longer prompts for a player card");

  await pageR.evaluate(() => {
    const el = document.getElementById("coach-edit-level");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await hideToast(pageR);
  await pageR.screenshot({ path: SHOTS + "v24-editor.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v24-editor.png");

  // Server-side block: a bound active rater cannot insert a player card
  let blocked = "";
  try {
    await upsertCard(rater.id, seed("local-v24-rater", RATER_NAME, "B1"));
  } catch (e) {
    blocked = String(e && e.message || e);
  }
  assert(/certified raters cannot have a player card/i.test(blocked),
    "server rejects a player-card insert for an active certified rater");

  // Rater home hides all player-card UI
  await pageR.goto(BASE + "#/");
  await pageR.waitForTimeout(1000);
  const home = await pageR.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return !!(el && !el.classList.contains("hidden"));
    };
    const body = document.body.innerText || "";
    const preview = document.getElementById("home-coach-preview");
    return {
      quiz: vis("start-quiz"),
      empty: vis("home-empty-card"),
      cardBtn: vis("home-card-btn"),
      ask: vis("req-ask-home-btn"),
      mine: vis("req-mine-home"),
      raterHome: vis("home-rater-home"),
      editorBtn: vis("home-coach-profile-btn"),
      inbox: vis("req-inbox") || true,
      cta: body.indexOf("צור כרטיס") !== -1 && vis("start-quiz"),
      previewHasName: ((preview && preview.innerText) || "").indexOf("מאמן בדיקה v24") !== -1,
      previewHasLevel: ((preview && preview.innerText) || "").indexOf("B1") !== -1,
      previewHasRank: ((preview && preview.innerText) || "").indexOf("12 באיגוד") !== -1,
      noPlayerLink: ((preview && preview.innerText) || "").indexOf("לכרטיס השחקן") === -1
    };
  });
  assert(!home.quiz && !home.empty && !home.cardBtn && !home.ask && !home.mine && !home.cta,
    "rater home hides quiz, empty-card CTA, player card, and request-rating UI");
  assert(home.raterHome && home.editorBtn, "rater home shows the coach card area and הפרופיל שלי כמוסמך");
  assert(home.previewHasName && home.previewHasLevel && home.previewHasRank && home.noPlayerLink,
    "home coach preview shows level and ranking, not a player-card link");

  // Hash routes for player-card flows bounce raters home
  await pageR.goto(BASE + "#/quiz");
  await pageR.waitForTimeout(600);
  const bounced = await pageR.evaluate(() => ({
    hash: location.hash || "",
    home: !!(document.getElementById("view-home") && !document.getElementById("view-home").classList.contains("hidden"))
  }));
  assert(bounced.home && !/#\/(quiz|card|profile|result)/.test(bounced.hash),
    "rater visiting #/quiz is redirected home");
  await ctxR.close();

  // Public coach card
  const ctxC = await browser.newContext(DEVICE);
  const pageC = await ctxC.newPage();
  await pageC.goto(BASE + "#/coach/" + raterId);
  await pageC.waitForSelector("#view-coach:not(.hidden) .coach-card", { timeout: 15000 });
  const card = await pageC.evaluate(() => {
    const root = document.getElementById("coach-card-root");
    const t = (root && root.innerText) || "";
    return {
      t,
      badge: /מוסמך/.test(t),
      level: /הרמה שלי/.test(t) && /B1/.test(t),
      rank: /דירוג ארצי/.test(t) && /12 באיגוד הפאדל הישראלי/.test(t),
      playerLink: /לכרטיס השחקן/.test(t),
      playerLevel: /דירוג שחקן/.test(t)
    };
  });
  assert(card.badge && card.t.indexOf(RATER_NAME) !== -1, "public coach card shows name and מוסמך badge");
  assert(card.level, "public coach card shows הרמה שלי");
  assert(card.rank, "public coach card shows דירוג ארצי when filled");
  assert(!card.playerLink && !card.playerLevel, "public coach card has no player-card link or player level");

  const pub = await pageC.evaluate(async (id) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc("get_certified_coach_public", { p_id: id });
    return { data, error: error && (error.message || String(error)) };
  }, raterId);
  assert(!pub.error && pub.data && pub.data.level === LEVEL && pub.data.national_ranking === RANKING,
    "public RPC includes level and national_ranking");
  assert(!pub.data.player && !pub.data.has_player_card && pub.data.show_player_card !== true && !pub.data.player_cert_levels,
    "public RPC omits player-card fields");

  await hideToast(pageC);
  await pageC.screenshot({ path: SHOTS + "v24-coach-card.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v24-coach-card.png");
  await ctxC.close();

  // Directory tiles
  const ctxD = await browser.newContext(DEVICE);
  const pageD = await ctxD.newPage();
  await pageD.goto(BASE + "#/coaches");
  await pageD.waitForSelector("#view-coaches:not(.hidden)", { timeout: 10000 });
  await pageD.waitForFunction((name) => {
    const g = document.getElementById("coaches-grid");
    return g && (g.innerText || "").indexOf(name) !== -1;
  }, RATER_NAME, { timeout: 15000 });
  const dir = await pageD.evaluate((name) => {
    const tiles = Array.from(document.querySelectorAll("#coaches-grid a.coach-tile"));
    const mine = tiles.find((el) => (el.innerText || "").indexOf(name) !== -1);
    const text = (mine && mine.innerText) || "";
    return {
      href: mine && mine.getAttribute("href"),
      level: /B1/.test(text),
      rank: /דירוג ארצי/.test(text) && /12 באיגוד/.test(text),
      player: /לכרטיס השחקן/.test(text) || /דירוג שחקן/.test(text)
    };
  }, RATER_NAME);
  assert(dir.href === "#/coach/" + raterId, "directory tile links to the public coach card");
  assert(dir.level && dir.rank && !dir.player, "directory tile shows level and ranking, not a player card");
  await ctxD.close();

  // Player picker
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, id: "mock-resend-v24" })
    });
  });
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.goto(BASE + "#/");
  await pageP.waitForSelector("#req-ask-home-btn:not(.hidden)", { timeout: 15000 });
  await pageP.click("#req-ask-home-btn");
  await pageP.waitForSelector('#req-picker-list button[data-rater-id]:not([disabled])', { timeout: 15000 });
  const picker = await pageP.evaluate((id) => {
    const btn = document.querySelector('#req-picker-list button[data-rater-id="' + id + '"]');
    const text = (btn && btn.innerText) || "";
    return {
      text,
      level: /B1/.test(text),
      rank: /דירוג ארצי/.test(text)
    };
  }, raterId);
  assert(picker.text.indexOf(RATER_NAME) !== -1, "picker shows the test rater");
  assert(picker.level && picker.rank, "picker tiles show level and national ranking");
  await ctxP.close();

  // Non-rater can still have a player card (player already upserted; admin is not a rater)
  const adminCardTry = await (async () => {
    try {
      await upsertCard(admin.id, seed("local-v24-admin", "מנהל בדיקה v24", "C2"));
      const { getCard } = await import("./v15-admin.mjs");
      const row = await getCard(admin.id);
      await deleteCard(admin.id);
      return { ok: !!row };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  })();
  assert(adminCardTry.ok, "a non-rater (test admin) can still have a player card");
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v24/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
