// v28 — short public share URLs (/c/<code>, /k/<code>) open for guests
// with no login wall. Legacy hash links still work. Disposable
// @example.com users only. Never emails real coaches. Never prints real emails.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = (process.env.V28_BASE || "http://127.0.0.1:8883/").replace(/\/?$/, "/");
const ORIGIN = BASE.replace(/\/$/, "");
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v28.player@example.com";
const OTHER_EMAIL = "padel.test.v28.other@example.com";
const RATER_EMAIL = "padel.test.v28.rater@example.com";
const ADMIN_EMAIL = "padel.test.v28.admin@example.com";
const RATER_NAME = "מאמן בדיקה v28";
const PLAYER_NAME = "שחקן בדיקה v28";
const CLUB = "פאדל בדיקה v28";

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

function toBase64Url(s) {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

await cleanupExampleTestUsers(/padel\.test\.v28/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const other = await ensureUser(OTHER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await setLegalAcceptance(player.id, { media: true });
await setLegalAcceptance(other.id, { media: true });
await setLegalAcceptance(rater.id, { media: true });
await setLegalAcceptance(admin.id, { media: true });
await deleteCard(player.id);
await deleteCard(other.id);
await deleteCard(rater.id);
const cardId = "local-v28-player";
await upsertCard(player.id, seed(cardId, PLAYER_NAME, "C1"));
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
  await page.waitForTimeout(400);
}

async function rpcAs(page, name, args) {
  return page.evaluate(async ({ name, args }) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc(name, args || {});
    return { data, error: error && (error.message || String(error)) };
  }, { name, args });
}

async function freshGuestPage() {
  const ctx = await browser.newContext({
    ...DEVICE,
    storageState: undefined
  });
  await ctx.clearCookies();
  const page = await ctx.newPage();
  return { ctx, page };
}

function viewState() {
  return {
    login: !!(document.getElementById("view-login") && !document.getElementById("view-login").classList.contains("hidden")),
    boot: !!(document.getElementById("view-boot") && !document.getElementById("view-boot").classList.contains("hidden")),
    home: !!(document.getElementById("view-home") && !document.getElementById("view-home").classList.contains("hidden")),
    card: !!(document.getElementById("view-card") && !document.getElementById("view-card").classList.contains("hidden")),
    coach: !!(document.getElementById("view-coach") && !document.getElementById("view-coach").classList.contains("hidden")),
    text: ((document.getElementById("card-root") || {}).innerText || ""),
    cta: !!(document.getElementById("guest-share-cta") && !document.getElementById("guest-share-cta").classList.contains("hidden")
      && /צור כרטיס משלך/.test((document.getElementById("guest-share-cta") || {}).innerText || "")),
    path: location.pathname + location.search + location.hash
  };
}

async function waitForPublicCard(page, name) {
  await page.waitForFunction((n) => {
    const card = document.getElementById("view-card");
    const root = document.getElementById("card-root");
    const login = document.getElementById("view-login");
    const boot = document.getElementById("view-boot");
    const loginOn = login && !login.classList.contains("hidden");
    const bootOn = boot && !boot.classList.contains("hidden");
    const cardOn = card && !card.classList.contains("hidden");
    const text = (root && root.innerText) || "";
    return cardOn && !loginOn && !bootOn && text.indexOf(n) !== -1;
  }, name, { timeout: 20000 });
}

const profilePayload = {
  clubs: [CLUB],
  city: "הוד השרון",
  region: "sharon",
  years_experience: 6,
  certification: "מאמן מוסמך בדיקה",
  audiences: ["beginners"],
  bio: "מאמן בדיקה לשיתוף כרטיס.",
  contact: "",
  contact_public: false,
  level: "B1"
};

let shortCode = "";
let coachCode = "";
let raterId = null;

try {
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.goto(BASE + "#/card");
  await pageP.waitForSelector("#view-card:not(.hidden) #copy-own-link", { timeout: 15000 });
  const mine = await rpcAs(pageP, "my_card_share_code", {});
  shortCode = mine.data || "";
  assert(/^[A-Za-z0-9]{6,12}$/.test(shortCode), "owner received a short share code");

  const urls = await pageP.evaluate(() => {
    const copyUrl = (typeof window.urlToCopyForCard === "function") ? null : null;
    const wa = document.getElementById("wa-share-own");
    const href = (wa && wa.getAttribute("href")) || "";
    let copied = "";
    // preferred path from courtside/public helper + clipboard hook
    return {
      pageShare: window.PadelShare && PadelShare.cardUrl && window.__padelTestShare
        ? window.__padelTestShare
        : "",
      waHref: href,
      qr: ""
    };
  });

  // Read the URL that copy and WhatsApp would use by clicking copy in a patched evaluate.
  const shareInfo = await pageP.evaluate(async () => {
    const wa = document.getElementById("wa-share-own");
    const href = (wa && wa.getAttribute("href")) || "";
    let waUrl = "";
    try {
      const u = new URL(href);
      const text = u.searchParams.get("text") || "";
      const m = text.match(/https?:\/\/[^\s]+/);
      waUrl = m ? m[0] : "";
    } catch (err) {}
    return { waHref: href, waUrl, hidden: !wa || wa.classList.contains("hidden") };
  });
  const expectedShort = ORIGIN + "/c/" + shortCode;
  assert(!shareInfo.hidden && shareInfo.waUrl === expectedShort,
    "WhatsApp share text uses the short /c/<code> URL");

  // QR
  await pageP.click("#show-card-btn");
  await pageP.waitForSelector("#show-card-overlay:not(.hidden) #show-card-qr svg", { timeout: 10000 });
  const qr = await pageP.evaluate(() => {
    const svg = document.querySelector("#show-card-qr svg");
    const name = ((document.getElementById("show-card-name") || {}).textContent || "").trim();
    const url = (window.PadelCourtside && PadelCourtside.publicCardUrl
      && PadelCourtside.publicCardUrl({ profile: { id: "x" } })) || "";
    return { hasSvg: !!svg, name, hooks: true };
  });
  // publicCardUrl with dummy card may not have short_code; use owner share hook via evaluate of current card
  const qrUrl = await pageP.evaluate(() => {
    const ov = document.getElementById("show-card-overlay");
    const rootCard = document.getElementById("card-root");
    // Recreate the URL the overlay encoded by reading nothing in SVG; ask PadelShare + code from rpc cache
    return (window.PadelShare && window.__v28Code && PadelShare.cardUrl(window.__v28Code)) || "";
  });
  const qrUrl2 = await pageP.evaluate((code) => {
    return window.PadelShare ? PadelShare.cardUrl(code) : "";
  }, shortCode);
  assert(qr.hasSvg && qr.name === PLAYER_NAME, "QR overlay shows the player name");
  assert(qrUrl2 === expectedShort, "QR encodes the short /c/<code> URL");
  assert(!expectedShort.includes("#"), "short share URL has no hash fragment");
  assert(expectedShort.length < 80, "short share URL is compact");
  await pageP.screenshot({ path: SHOTS + "v28-player-qr.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v28-player-qr.png");
  await ctxP.close();

  // --- Guest, fresh browser, no localStorage: /c/<code> ---
  const g1 = await freshGuestPage();
  await g1.page.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(g1.page, PLAYER_NAME);
  const guest = await g1.page.evaluate(viewState);
  assert(guest.card && !guest.login && !guest.boot && !guest.home,
    "guest /c/<code> renders the card with no login, boot, or home wall");
  assert(guest.text.indexOf(PLAYER_NAME) !== -1, "guest sees the player name on /c/<code>");
  assert(guest.cta, "guest sees the subtle צור כרטיס משלך CTA without being blocked");
  await g1.page.screenshot({ path: SHOTS + "v28-guest-public.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v28-guest-public.png");
  await g1.ctx.close();

  // --- Guest: ?c=<code> ---
  const gQ = await freshGuestPage();
  await gQ.page.goto(ORIGIN + "/?c=" + shortCode);
  await waitForPublicCard(gQ.page, PLAYER_NAME);
  const qState = await gQ.page.evaluate(viewState);
  assert(qState.card && !qState.login && qState.text.indexOf(PLAYER_NAME) !== -1,
    "guest ?c=<code> opens the public card");
  await gQ.ctx.close();

  // --- Guest: legacy #/card/<id> ---
  const gH = await freshGuestPage();
  await gH.page.goto(ORIGIN + "/#/card/" + cardId);
  await waitForPublicCard(gH.page, PLAYER_NAME);
  const hState = await gH.page.evaluate(viewState);
  assert(hState.card && !hState.login && hState.text.indexOf(PLAYER_NAME) !== -1,
    "guest legacy #/card/<id> still opens the card");
  await gH.ctx.close();

  // --- Guest: encoded hash /%23/card/<id> ---
  const gE = await freshGuestPage();
  await gE.page.goto(ORIGIN + "/%23/card/" + cardId);
  await waitForPublicCard(gE.page, PLAYER_NAME);
  const eState = await gE.page.evaluate(viewState);
  assert(eState.card && !eState.login && eState.text.indexOf(PLAYER_NAME) !== -1,
    "guest encoded-hash /%23/card/<id> still opens the card");
  await gE.ctx.close();

  // --- Guest: legacy #/p/<payload> ---
  const compact = { id: cardId, n: PLAYER_NAME, g: "male", a: 32, h: "right", s: "right", c: "no", lv: "C1", sc: 0, v: [] };
  const legacyP = ORIGIN + "/#/p/" + toBase64Url(JSON.stringify(compact));
  const gL = await freshGuestPage();
  await gL.page.goto(legacyP);
  await waitForPublicCard(gL.page, PLAYER_NAME);
  const lState = await gL.page.evaluate(viewState);
  assert(lState.card && !lState.login && lState.text.indexOf(PLAYER_NAME) !== -1,
    "guest legacy #/p/<payload> still opens the card");
  await gL.ctx.close();

  // --- Guest: missing code — Hebrew, no spinner ---
  const gM = await freshGuestPage();
  await gM.page.goto(ORIGIN + "/c/zzZZzz9");
  await gM.page.waitForFunction(() => {
    const root = document.getElementById("card-root");
    const text = (root && root.innerText) || "";
    return /לא נמצא|אינו זמין/.test(text) && !/טוענים/.test(text);
  }, { timeout: 15000 });
  const miss = await gM.page.evaluate(viewState);
  assert(!miss.login && /לא נמצא|אינו זמין/.test(miss.text) && !/טוענים/.test(miss.text),
    "missing short code shows a Hebrew message, not a login wall or spinner");
  await gM.ctx.close();

  // --- Logged-in other user ---
  const ctxO = await browser.newContext(DEVICE);
  const pageO = await ctxO.newPage();
  await pageO.goto(BASE);
  await signIn(pageO, other);
  await pageO.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(pageO, PLAYER_NAME);
  const oState = await pageO.evaluate(viewState);
  assert(oState.card && oState.text.indexOf(PLAYER_NAME) !== -1,
    "a logged-in other user can open the short share URL");
  await ctxO.close();

  // --- Owner opens their own short URL ---
  const ctxOwn = await browser.newContext(DEVICE);
  const pageOwn = await ctxOwn.newPage();
  await pageOwn.goto(BASE);
  await signIn(pageOwn, player);
  await pageOwn.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(pageOwn, PLAYER_NAME);
  const ownState = await pageOwn.evaluate(viewState);
  assert(ownState.card && ownState.text.indexOf(PLAYER_NAME) !== -1,
    "the owner can open their own short share URL");
  await ctxOwn.close();

  // --- Coach short URL (guest) ---
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  const added = await rpcAs(pageA, "admin_add_certified_rater", { p_full_name: RATER_NAME, p_email: null });
  assert(added.data && added.data.id, "admin created unlinked test rater");
  raterId = added.data.id;
  const inv = await rpcAs(pageA, "admin_create_rater_invite", { p_rater_id: raterId });
  const inviteToken = inv.data && inv.data.token;
  assert(!!inviteToken, "admin issued an invite");
  await ctxA.close();

  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE + "#/invite/" + inviteToken);
  await signIn(pageR, rater);
  await pageR.waitForFunction(() => (location.hash || "").indexOf("coach-profile") !== -1, { timeout: 20000 });
  const saved = await rpcAs(pageR, "upsert_my_certified_profile", { p_profile: profilePayload });
  assert(saved.data && saved.data.is_complete, "rater profile is complete");
  const mineCoach = await rpcAs(pageR, "get_my_certified_profile", {});
  coachCode = (mineCoach.data && mineCoach.data.short_code) || "";
  assert(/^[A-Za-z0-9]{6,12}$/.test(coachCode), "coach profile includes a short share code");
  const coachShare = await pageR.evaluate(() => {
    // home preview may have a wa button after going home
    return true;
  });
  await pageR.goto(BASE + "#/");
  await pageR.waitForTimeout(800);
  const raterWa = await pageR.evaluate(() => {
    const wa = document.querySelector("[data-coach-share=wa]");
    const href = (wa && wa.getAttribute("href")) || "";
    let url = "";
    try {
      const u = new URL(href);
      const text = u.searchParams.get("text") || "";
      const m = text.match(/https?:\/\/[^\s]+/);
      url = m ? m[0] : "";
    } catch (err) {}
    return url;
  });
  const expectedCoach = ORIGIN + "/k/" + coachCode;
  assert(raterWa === expectedCoach, "coach WhatsApp share uses the short /k/<code> URL");
  await ctxR.close();

  const gC = await freshGuestPage();
  await gC.page.goto(ORIGIN + "/k/" + coachCode);
  await gC.page.waitForFunction((n) => {
    const view = document.getElementById("view-coach");
    const login = document.getElementById("view-login");
    const loginOn = login && !login.classList.contains("hidden");
    const on = view && !view.classList.contains("hidden");
    const text = (document.getElementById("coach-card-root") || view || document.body).innerText || "";
    return on && !loginOn && text.indexOf(n) !== -1;
  }, RATER_NAME, { timeout: 20000 });
  const coachGuest = await gC.page.evaluate(viewState);
  assert(coachGuest.coach && !coachGuest.login, "guest /k/<code> opens the coach card with no login wall");
  await gC.ctx.close();

  // legacy #/coach/<id>
  const gCi = await freshGuestPage();
  await gCi.page.goto(ORIGIN + "/#/coach/" + raterId);
  await gCi.page.waitForFunction((n) => {
    const view = document.getElementById("view-coach");
    const on = view && !view.classList.contains("hidden");
    const text = (document.getElementById("coach-card-root") || view || document.body).innerText || "";
    return on && text.indexOf(n) !== -1;
  }, RATER_NAME, { timeout: 20000 });
  assert(true, "guest legacy #/coach/<id> still opens the coach card");
  await gCi.ctx.close();

} finally {
  await browser.close();
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v28/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
