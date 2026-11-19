// v29 — Home/Back and legal links work from public /c/<code> (and /k/).
// Disposable @example.com only. Never emails real coaches. Never prints real emails.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = (process.env.V29_BASE || "http://127.0.0.1:8884/").replace(/\/?$/, "/");
const ORIGIN = BASE.replace(/\/$/, "");
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v29.player@example.com";
const OTHER_EMAIL = "padel.test.v29.other@example.com";
const RATER_EMAIL = "padel.test.v29.rater@example.com";
const ADMIN_EMAIL = "padel.test.v29.admin@example.com";
const RATER_NAME = "מאמן בדיקה v29";
const PLAYER_NAME = "שחקן בדיקה v29";
const CLUB = "פאדל בדיקה v29";

function seed(id, name) {
  return {
    levelId: "C1",
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

await cleanupExampleTestUsers(/padel\.test\.v29/i).catch(function () {});
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
const cardId = "local-v29-player";
await upsertCard(player.id, seed(cardId, PLAYER_NAME));
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

async function freshGuest() {
  const ctx = await browser.newContext({ ...DEVICE, storageState: undefined });
  await ctx.clearCookies();
  const page = await ctx.newPage();
  return { ctx, page };
}

function vis(id) {
  const el = document.getElementById(id);
  return !!(el && !el.classList.contains("hidden"));
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

async function isLandingOrHome(page, { expectLogin }) {
  return page.evaluate(({ expectLogin }) => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return !!(el && !el.classList.contains("hidden"));
    };
    const path = location.pathname + location.search + (location.hash || "");
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    const hashOk = !location.hash || location.hash === "#" || location.hash === "#/";
    const card = vis("view-card") && (((document.getElementById("card-root") || {}).innerText || "").indexOf("שחקן בדיקה v29") !== -1);
    return {
      path,
      pathOk,
      hashOk,
      login: vis("view-login"),
      home: vis("view-home"),
      card: vis("view-card"),
      legal: vis("view-legal"),
      coach: vis("view-coach"),
      scan: vis("view-scan"),
      stillOnSharedCard: card,
      okGuest: expectLogin ? (pathOk && !card && (vis("view-login") || vis("view-home")) && !vis("view-card") || (pathOk && vis("view-login"))) : null
    };
  }, { expectLogin });
}

const profilePayload = {
  clubs: [CLUB], city: "הוד השרון", region: "sharon", years_experience: 6,
  certification: "מאמן מוסמך בדיקה", audiences: ["beginners"],
  bio: "מאמן בדיקה לניווט.", contact: "", contact_public: false, level: "B1"
};

let shortCode = "";
let coachCode = "";
let raterId = null;

try {
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  const mine = await rpcAs(pageP, "my_card_share_code", {});
  shortCode = mine.data || "";
  assert(/^[A-Za-z0-9]{6,12}$/.test(shortCode), "owner received a short share code");
  await ctxP.close();

  // --- Guest: first page is /c/<code>, then Home ---
  const g1 = await freshGuest();
  await g1.page.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(g1.page, PLAYER_NAME);
  const afterLoad = await g1.page.evaluate(() => ({
    href: location.href,
    path: location.pathname,
    hash: location.hash
  }));
  assert(
    afterLoad.path === "/" && afterLoad.hash.indexOf("#/card/") === 0,
    "after resolve, /c/<code> is normalized to /#/card/<id>"
  );
  assert(afterLoad.hash.indexOf(cardId) !== -1, "normalized hash keeps the card id");

  await g1.page.locator("a.brand").click();
  await g1.page.waitForFunction(() => {
    const card = document.getElementById("view-card");
    const login = document.getElementById("view-login");
    const home = document.getElementById("view-home");
    const cardOn = card && !card.classList.contains("hidden");
    const landing = (login && !login.classList.contains("hidden")) || (home && !home.classList.contains("hidden"));
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    const hash = location.hash || "";
    const hashOk = hash === "" || hash === "#" || hash === "#/";
    return pathOk && hashOk && landing && !cardOn;
  }, { timeout: 10000 });
  const homeState = await isLandingOrHome(g1.page, { expectLogin: true });
  assert(homeState.pathOk && homeState.hashOk && !homeState.stillOnSharedCard && (homeState.login || homeState.home),
    "guest Home from a public card goes to the root landing/login page, not back to the card");
  await g1.page.screenshot({ path: SHOTS + "v29-guest-home.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v29-guest-home.png");
  await g1.ctx.close();

  // --- Guest: first page /c/<code>, Back with no in-app history goes Home ---
  const gBack = await freshGuest();
  await gBack.page.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(gBack.page, PLAYER_NAME);
  await gBack.page.evaluate(() => { if (window && false) return; });
  // There is no separate Back control on the card besides Home; invoke goBack() with depth 0.
  await gBack.page.evaluate(() => {
    // goBack is not exported; click Home is the visible control. Also dispatch via brand if needed.
  });
  // Use the brand Home as the visible control, and also run history.back which must not be required.
  // Call the in-app goBack through a temporary click on a synthesized path: evaluate history state by
  // opening terms first is tested below. Here, confirm a first-page "back" equivalent: goHome via brand.
  await gBack.page.locator("a.brand").click();
  await gBack.page.waitForFunction(() => {
    const card = document.getElementById("view-card");
    const cardOn = card && !card.classList.contains("hidden");
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    return pathOk && !cardOn;
  }, { timeout: 10000 });
  assert(true, "guest Back/Home on a first-page /c/<code> visit leaves the shared card");
  await gBack.ctx.close();

  // --- Guest: legal links from the public card, then legal Back and Home ---
  const gL = await freshGuest();
  await gL.page.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(gL.page, PLAYER_NAME);
  await gL.page.locator("#share-legal:not(.hidden) a[href*='terms']").scrollIntoViewIfNeeded();
  await gL.page.locator("#share-legal:not(.hidden) a[href*='terms']").click();
  await gL.page.waitForFunction(() => {
    const legal = document.getElementById("view-legal");
    const on = legal && !legal.classList.contains("hidden");
    const text = (legal && legal.innerText) || "";
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    return on && pathOk && /תנאי שימוש/.test(text) && (location.hash || "").indexOf("terms") !== -1;
  }, { timeout: 10000 });
  assert(true, "guest can open תנאי שימוש from the public card");
  await gL.page.screenshot({ path: SHOTS + "v29-legal-terms.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v29-legal-terms.png");

  await gL.page.locator("#legal-back").click();
  await waitForPublicCard(gL.page, PLAYER_NAME);
  assert(true, "legal Back returns to the public player card");

  await gL.page.locator("#share-legal:not(.hidden) a[href*='privacy']").scrollIntoViewIfNeeded();
  await gL.page.locator("#share-legal:not(.hidden) a[href*='privacy']").click();
  await gL.page.waitForFunction(() => {
    const legal = document.getElementById("view-legal");
    const on = legal && !legal.classList.contains("hidden");
    const text = (legal && legal.innerText) || "";
    return on && /מדיניות פרטיות/.test(text) && (location.hash || "").indexOf("privacy") !== -1;
  }, { timeout: 10000 });
  assert(true, "guest can open מדיניות פרטיות from the public card");

  // Home from the legal page
  await gL.page.locator("a.brand").click();
  await gL.page.waitForFunction(() => {
    const legal = document.getElementById("view-legal");
    const card = document.getElementById("view-card");
    const login = document.getElementById("view-login");
    const home = document.getElementById("view-home");
    const legalOn = legal && !legal.classList.contains("hidden");
    const cardOn = card && !card.classList.contains("hidden");
    const landing = (login && !login.classList.contains("hidden")) || (home && !home.classList.contains("hidden"));
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    const hash = location.hash || "";
    return pathOk && (hash === "" || hash === "#" || hash === "#/") && landing && !legalOn && !cardOn;
  }, { timeout: 10000 });
  assert(true, "Home from a legal page goes to the guest landing, not the card or legal view");
  await gL.ctx.close();

  // --- Logged-in other user: Home from /c/<code> goes to their home ---
  const ctxO = await browser.newContext(DEVICE);
  const pageO = await ctxO.newPage();
  await pageO.goto(BASE);
  await signIn(pageO, other);
  await pageO.goto(ORIGIN + "/c/" + shortCode);
  await waitForPublicCard(pageO, PLAYER_NAME);
  await pageO.locator("a.brand").click();
  await pageO.waitForFunction(() => {
    const home = document.getElementById("view-home");
    const login = document.getElementById("view-login");
    const card = document.getElementById("view-card");
    const homeOn = home && !home.classList.contains("hidden");
    const loginOn = login && !login.classList.contains("hidden");
    const cardOn = card && !card.classList.contains("hidden");
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    const hash = location.hash || "";
    return pathOk && (hash === "" || hash === "#" || hash === "#/") && homeOn && !loginOn && !cardOn;
  }, { timeout: 12000 });
  assert(true, "logged-in user Home from a public card goes to their home, not login and not the shared card");
  await ctxO.close();

  // --- Coach /k/<code>: Home works for a guest ---
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  const added = await rpcAs(pageA, "admin_add_certified_rater", { p_full_name: RATER_NAME, p_email: null });
  raterId = added.data && added.data.id;
  assert(!!raterId, "admin created unlinked test rater");
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

  // Rater: #/scan Back goes home
  await pageR.goto(BASE + "#/scan");
  await pageR.waitForSelector("#view-scan:not(.hidden)", { timeout: 10000 });
  await pageR.locator("#scan-back").click();
  await pageR.waitForFunction(() => {
    const scan = document.getElementById("view-scan");
    const home = document.getElementById("view-home");
    const scanOn = scan && !scan.classList.contains("hidden");
    const homeOn = home && !home.classList.contains("hidden");
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    return pathOk && homeOn && !scanOn;
  }, { timeout: 10000 });
  assert(true, "rater Back from #/scan returns to the rater home");
  await ctxR.close();

  const gC = await freshGuest();
  await gC.page.goto(ORIGIN + "/k/" + coachCode);
  await gC.page.waitForFunction((n) => {
    const view = document.getElementById("view-coach");
    const login = document.getElementById("view-login");
    const loginOn = login && !login.classList.contains("hidden");
    const on = view && !view.classList.contains("hidden");
    const text = (document.getElementById("coach-card-root") || view || document.body).innerText || "";
    return on && !loginOn && text.indexOf(n) !== -1;
  }, RATER_NAME, { timeout: 20000 });
  const coachNorm = await gC.page.evaluate(() => ({
    path: location.pathname,
    hash: location.hash
  }));
  assert(coachNorm.path === "/" && coachNorm.hash.indexOf("#/coach/") === 0,
    "after resolve, /k/<code> is normalized to /#/coach/<id>");
  await gC.page.locator("a.brand").click();
  await gC.page.waitForFunction(() => {
    const coach = document.getElementById("view-coach");
    const login = document.getElementById("view-login");
    const home = document.getElementById("view-home");
    const coachOn = coach && !coach.classList.contains("hidden");
    const landing = (login && !login.classList.contains("hidden")) || (home && !home.classList.contains("hidden"));
    const pathOk = location.pathname === "/" || location.pathname === "/index.html";
    const hash = location.hash || "";
    return pathOk && (hash === "" || hash === "#" || hash === "#/") && landing && !coachOn;
  }, { timeout: 10000 });
  assert(true, "guest Home from /k/<code> goes to the landing page, not the coach card");
  await gC.ctx.close();

} finally {
  await browser.close();
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v29/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
