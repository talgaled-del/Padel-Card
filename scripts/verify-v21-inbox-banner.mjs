// v21 — rater home banner + red count badge. Disposable test users only.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, cleanupExampleTestUsers,
  cleanupCertifiedTestData, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V21_BASE || "http://127.0.0.1:8877/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v21.player@example.com";
const RATER_EMAIL = "padel.test.v21.rater@example.com";
const ADMIN_EMAIL = "padel.test.v21.admin@example.com";

function seed(id, name, levelId) {
  return {
    levelId: levelId || "C1",
    profile: {
      id, name, gender: "male", age: "28", hand: "right", side: "right",
      competitor: "no", hasPartner: "no", partnerId: null,
      photo: BASE + "avatars/alon.jpg", region: "center", courts: [],
      frequency: "2-3", tenure: "1-2", style: "social", shots: ["volley"]
    },
    answers: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    videos: []
  };
}

await cleanupExampleTestUsers(/padel\.test\.v21/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});
const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await deleteCard(player.id);
await deleteCard(rater.id);
await upsertCard(player.id, seed("local-v21-player", "שחקן בדיקה", "C1"));
await upsertCard(rater.id, seed("local-v21-rater", "מאמן בדיקה", "B2"));
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
    const { data, error } = await c.auth.signInWithPassword({ email, password });
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

try {
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  await pageA.goto(BASE);
  await signIn(pageA, admin);
  await pageA.waitForTimeout(800);
  const added = await rpcAs(pageA, "admin_add_certified_rater", {
    p_full_name: "מאמן בדיקה v21",
    p_email: RATER_EMAIL
  });
  assert(added.data && added.data.id, "admin created test rater");
  const raterId = added.data && added.data.id;
  await ctxA.close();

  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.waitForTimeout(1000);
  const created = await rpcAs(pageP, "create_rating_request", {
    p_rater_id: raterId,
    p_card_id: "local-v21-player",
    p_message: "בקשת בדיקה"
  });
  assert(created.data && created.data.id, "player created a pending request");
  await ctxP.close();

  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  pageR.on("pageerror", (e) => { failures.push("pageerror: " + e.message); });
  await pageR.goto(BASE);
  await signIn(pageR, rater);
  await pageR.waitForTimeout(1500);
  await pageR.goto(BASE + "#/");
  await pageR.waitForSelector("#req-home-banner:not(.hidden)", { timeout: 20000 });
  const banner = (await pageR.textContent("#req-home-banner")) || "";
  assert(/בקשת דירוג ממתינה|בקשות דירוג ממתינות/.test(banner), "home shows the pending-request banner");
  const badge = await pageR.evaluate(() => {
    const top = document.getElementById("req-top-badge");
    const count = document.getElementById("home-req-count");
    const topCount = document.getElementById("home-req-count-top");
    return {
      topVisible: top && !top.classList.contains("hidden"),
      count: (count && count.textContent) || "",
      topCount: (topCount && topCount.textContent) || ""
    };
  });
  assert(badge.topVisible && badge.count === "1" && badge.topCount === "1", "red count badge shows 1 in the banner and top bar");
  await pageR.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
  });
  await pageR.waitForTimeout(250);
  await pageR.screenshot({ path: SHOTS + "v21-rater-pending-banner.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v21-rater-pending-banner.png");

  await pageR.click("#req-home-banner");
  await pageR.waitForTimeout(600);
  const inboxVisible = await pageR.evaluate(() => {
    const box = document.getElementById("req-inbox");
    if (!box || box.classList.contains("hidden")) return false;
    const r = box.getBoundingClientRect();
    return r.top < (window.innerHeight - 40) && r.bottom > 40;
  });
  assert(inboxVisible, "banner click scrolls the inbox into view");
} catch (err) {
  failures.push("THROWN: " + (err && err.stack || err));
  console.error(err);
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v21/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures);
  process.exit(1);
}
console.log("ALL v21 CHECKS PASSED");
