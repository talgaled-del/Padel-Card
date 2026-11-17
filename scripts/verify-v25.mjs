// v25 — hide the coaches directory from raters; owner coach-card share.
// Disposable @example.com users only. Never emails real coaches. Never prints real emails.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V25_BASE || "http://127.0.0.1:8881/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v25.player@example.com";
const RATER_EMAIL = "padel.test.v25.rater@example.com";
const ADMIN_EMAIL = "padel.test.v25.admin@example.com";
const RATER_NAME = "מאמן בדיקה v25";
const CLUB = "פאדל בדיקה v25";

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

await cleanupExampleTestUsers(/padel\.test\.v25/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await setLegalAcceptance(player.id, { media: true });
await setLegalAcceptance(rater.id, { media: true });
await setLegalAcceptance(admin.id, { media: true });
await deleteCard(player.id);
await deleteCard(rater.id);
await upsertCard(player.id, seed("local-v25-player", "שחקן בדיקה v25", "C1"));
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

function shareState(page, rootSel) {
  return page.evaluate((rootSel) => {
    const root = document.querySelector(rootSel) || document.body;
    const copy = root.querySelector('[data-coach-share="copy"]');
    const wa = root.querySelector('[data-coach-share="wa"]');
    const native = root.querySelector('[data-coach-share="native"]');
    const href = (wa && wa.getAttribute("href")) || "";
    let text = "";
    try { text = decodeURIComponent((href.split("text=")[1] || "").replace(/\+/g, " ")); } catch (e) { text = href; }
    return {
      hasCopy: !!(copy && /העתק קישור/.test(copy.textContent || "")),
      hasWa: !!(wa && /שלח בווטסאפ/.test(wa.textContent || "")),
      waHref: href,
      waText: text,
      waHasLink: /#\/coach\//.test(text) && href.indexOf("https://wa.me/?text=") === 0,
      nativeVisible: !!(native && !native.classList.contains("hidden")),
      nativeLabel: (native && (native.textContent || "").trim()) || ""
    };
  }, rootSel);
}

const profilePayload = {
  clubs: [CLUB],
  city: "הוד השרון",
  region: "sharon",
  years_experience: 8,
  certification: "מאמן מוסמך בדיקה",
  audiences: ["beginners"],
  bio: "מאמן בדיקה לשיתוף כרטיס מוסמך.",
  contact: "0500000000",
  contact_public: true,
  level: "B1",
  national_ranking: "12"
};

let raterId = null;
let inviteToken = null;

try {
  // OG tags ship in the static HTML (same preview for player and coach hash links)
  const ctxOg = await browser.newContext(DEVICE);
  const pageOg = await ctxOg.newPage();
  const html = await pageOg.goto(BASE).then(() => pageOg.content());
  assert(html.indexOf('property="og:image"') !== -1 && html.indexOf("og-cover.png") !== -1,
    "index.html includes Open Graph image tags");
  assert(html.indexOf('property="og:title"') !== -1 && html.indexOf("כרטיס שחקן פאדל") !== -1,
    "index.html includes Open Graph title");
  await ctxOg.close();

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
  raterId = added.data.id;
  const live = await rpcAs(pageA, "admin_create_rater_invite", { p_rater_id: raterId });
  inviteToken = live.data && live.data.token;
  assert(!!inviteToken, "admin issued an invite token");
  await ctxA.close();

  // Guest can still open the public directory
  const ctxG = await browser.newContext(DEVICE);
  const pageG = await ctxG.newPage();
  await pageG.goto(BASE + "#/coaches");
  await pageG.waitForSelector("#view-coaches:not(.hidden)", { timeout: 10000 });
  const guestDir = await pageG.evaluate(() => ({
    title: ((document.querySelector("#view-coaches h1") || {}).textContent || "").trim(),
    login: !!(document.getElementById("view-login") && !document.getElementById("view-login").classList.contains("hidden"))
  }));
  assert(!guestDir.login && guestDir.title === "המוסמכים שלנו", "guests can open the public #/coaches directory");
  await ctxG.close();

  // Rater claims and completes a profile
  const ctxR = await browser.newContext({
    ...DEVICE,
    permissions: ["clipboard-read", "clipboard-write"]
  });
  await ctxR.addInitScript(() => {
    navigator.share = function (data) {
      window.__padelShareArg = data;
      return Promise.resolve();
    };
  });
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE + "#/invite/" + inviteToken);
  await signIn(pageR, rater);
  await pageR.waitForFunction(() => (location.hash || "").indexOf("coach-profile") !== -1, { timeout: 20000 });
  const saved = await rpcAs(pageR, "upsert_my_certified_profile", { p_profile: profilePayload });
  assert(saved.data && saved.data.is_complete, "rater profile is complete");

  // Home: no directory CTA, share bar on the coach preview
  await pageR.goto(BASE + "#/");
  await pageR.waitForTimeout(1200);
  await pageR.waitForFunction((name) => {
    const box = document.getElementById("home-coach-preview");
    return box && (box.innerText || "").indexOf(name) !== -1;
  }, RATER_NAME, { timeout: 15000 });
  const home = await pageR.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return !!(el && !el.classList.contains("hidden"));
    };
    const body = document.body.innerText || "";
    const btn = document.getElementById("home-coaches-btn");
    return {
      coachesBtn: vis("home-coaches-btn"),
      coachesLabelOnBtn: !!(btn && !btn.classList.contains("hidden") && /המוסמכים שלנו/.test(btn.textContent || "")),
      dirCtaInHome: vis("home-coaches-btn") && /המוסמכים שלנו/.test(body)
    };
  });
  assert(!home.coachesBtn && !home.coachesLabelOnBtn && !home.dirCtaInHome,
    "rater home hides the המוסמכים שלנו directory button");
  const homeShare = await shareState(pageR, "#home-coach-preview, #home-rater-home");
  assert(homeShare.hasCopy && homeShare.hasWa, "rater home preview shows העתק קישור and שלח בווטסאפ");
  assert(homeShare.waHasLink && /כרטיס המוסמך שלי בפאדל/.test(homeShare.waText),
    "home WhatsApp href is wa.me with the short Hebrew message and coach link");
  assert(homeShare.nativeVisible && homeShare.nativeLabel === "שתף",
    "navigator.share is offered as an extra שתף button when available");

  // Direct #/coaches bounces the rater home
  await pageR.goto(BASE + "#/coaches");
  await pageR.waitForTimeout(900);
  const bounced = await pageR.evaluate(() => ({
    hash: location.hash || "",
    home: !!(document.getElementById("view-home") && !document.getElementById("view-home").classList.contains("hidden")),
    coaches: !!(document.getElementById("view-coaches") && !document.getElementById("view-coaches").classList.contains("hidden"))
  }));
  assert(bounced.home && !bounced.coaches && !/#\/coaches/.test(bounced.hash),
    "rater opening #/coaches is redirected home");

  // Owner viewing #/coach/<id> sees share controls
  await pageR.goto(BASE + "#/coach/" + raterId);
  await pageR.waitForSelector("#view-coach:not(.hidden) .coach-card", { timeout: 15000 });
  await pageR.waitForSelector('#view-coach:not(.hidden) [data-coach-share="copy"]', { timeout: 10000 });
  const ownerShare = await shareState(pageR, "#view-coach");
  assert(ownerShare.hasCopy && ownerShare.hasWa, "owner on #/coach/<id> sees copy and WhatsApp share");
  assert(ownerShare.waHasLink && ownerShare.waText.indexOf("#/coach/" + raterId) !== -1,
    "owner WhatsApp message includes https://…#/coach/<id>");

  await hideToast(pageR);
  await pageR.locator('#view-coach [data-coach-share="copy"]').click();
  await pageR.waitForFunction(() => {
    const t = document.getElementById("toast");
    return t && /הקישור הועתק/.test(t.textContent || "");
  }, { timeout: 5000 });
  const copied = await pageR.evaluate(async () => {
    try { return await navigator.clipboard.readText(); } catch (e) { return ""; }
  });
  assert(/#\/coach\//.test(copied) && copied.indexOf(raterId) !== -1,
    "העתק קישור copies the public #/coach/<id> URL");

  await pageR.evaluate(() => {
    const bar = document.querySelector("#view-coach [data-coach-share='copy']");
    if (bar) bar.scrollIntoView({ block: "center" });
  });
  await hideToast(pageR);
  await pageR.screenshot({ path: SHOTS + "v25-coach-share.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v25-coach-share.png");
  await ctxR.close();

  // Visitor does not see owner share controls
  const ctxV = await browser.newContext(DEVICE);
  const pageV = await ctxV.newPage();
  await pageV.goto(BASE + "#/coach/" + raterId);
  await pageV.waitForSelector("#view-coach:not(.hidden) .coach-card", { timeout: 15000 });
  const visitor = await pageV.evaluate(() => ({
    copy: !!document.querySelector("#view-coach [data-coach-share='copy']"),
    waShare: !!document.querySelector("#view-coach [data-coach-share='wa']"),
    lessonWa: !!document.getElementById("coach-wa")
  }));
  assert(!visitor.copy && !visitor.waShare, "visitors do not see owner copy/WhatsApp share controls");
  await ctxV.close();

  // Players still see the public directory and the request picker
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.goto(BASE + "#/coaches");
  await pageP.waitForSelector("#view-coaches:not(.hidden)", { timeout: 10000 });
  await pageP.waitForFunction((name) => {
    const g = document.getElementById("coaches-grid");
    return g && (g.innerText || "").indexOf(name) !== -1;
  }, RATER_NAME, { timeout: 15000 });
  const playerDir = await pageP.evaluate(() => {
    const btn = document.getElementById("home-coaches-btn");
    return {
      title: ((document.querySelector("#view-coaches h1") || {}).textContent || "").trim(),
      // button lives on the (hidden) home view; for a player it must not be forced hidden
    };
  });
  assert(playerDir.title === "המוסמכים שלנו", "players can still open the public coaches directory");

  await pageP.goto(BASE + "#/");
  await pageP.waitForTimeout(800);
  const playerHome = await pageP.evaluate(() => {
    const b = document.getElementById("home-coaches-btn");
    return !!(b && !b.classList.contains("hidden") && /המוסמכים שלנו/.test(b.textContent || ""));
  });
  assert(playerHome, "players still see המוסמכים שלנו on home");

  await pageP.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, id: "mock-resend-v25" }) });
  });
  await pageP.waitForSelector("#req-ask-home-btn:not(.hidden)", { timeout: 15000 });
  await pageP.click("#req-ask-home-btn");
  await pageP.waitForSelector('#req-picker-list button[data-rater-id]:not([disabled])', { timeout: 15000 });
  const picker = await pageP.evaluate((id) => {
    const btn = document.querySelector('#req-picker-list button[data-rater-id="' + id + '"]');
    return { text: (btn && btn.innerText) || "" };
  }, raterId);
  assert(picker.text.indexOf(RATER_NAME) !== -1, "players still see raters in the rating-request picker");
  await ctxP.close();
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v25/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
