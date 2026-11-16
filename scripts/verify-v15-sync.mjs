// v15 — real cloud card round-trip against Supabase.
// Creates a disposable confirmed test user, then deletes it.
// Never prints service-role or the user password.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import { ensureTestUser, deleteCard, deleteTestUser, getCard, DEVICE } from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.BASE || "http://127.0.0.1:8870/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }

fs.mkdirSync(SHOTS, { recursive: true });

const seed = {
  levelId: "B2",
  profile: {
    id: "local-tal-v15",
    name: "טל גלעד",
    gender: "male",
    age: "36",
    hand: "right",
    side: "right",
    competitor: "no",
    hasPartner: "no",
    partnerId: null,
    photo: BASE + "avatars/alon.jpg",
    region: "center",
    courts: [],
    frequency: "2-3",
    tenure: "3plus",
    style: "both",
    shots: ["volley"]
  },
  answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
  videos: []
};

const creds = await ensureTestUser();
console.log("TEST USER ready");
await deleteCard(creds.id);

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

async function snap(page, name) {
  await page.evaluate(() => {
    const t = document.getElementById("toast");
    if (t) t.classList.remove("show");
  }).catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: SHOTS + name, timeout: 20000 });
  console.log("SHOT", SHOTS + name);
}

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

try {
  // 1) First login on a device that already has a local card → upload
  const ctxA = await browser.newContext(DEVICE);
  const pageA = await ctxA.newPage();
  pageA.on("pageerror", (e) => { console.log("PAGEERROR A", e.message); failures.push("pageerror A: " + e.message); });
  await pageA.goto(BASE);
  await pageA.waitForSelector("#view-login:not(.hidden)");
  await pageA.evaluate((s) => { localStorage.setItem("padelCard.v2", JSON.stringify(s)); }, seed);
  await signInPage(pageA);
  await pageA.waitForSelector("#card-root .ut-card", { timeout: 30000 });
  const seenA = await pageA.evaluate(() => ({
    name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || "",
    id: JSON.parse(localStorage.getItem("padelCard.v2")).profile.id,
    level: JSON.parse(localStorage.getItem("padelCard.v2")).levelId
  }));
  console.log("AFTER FIRST LOGIN", { name: seenA.name, id: seenA.id, level: seenA.level });
  assert(/טל/.test(seenA.name), "first login shows the uploaded local card: " + seenA.name);
  assert(seenA.id === "local-tal-v15", "card id stays stable after upload: " + seenA.id);
  assert(seenA.level === "B2", "quiz level preserved");
  await snap(pageA, "v15-sync-first-login.png");
  const row = await getCard(creds.id);
  assert(row && row.card && row.card.profile && row.card.profile.id === "local-tal-v15", "cloud row exists after first login");
  assert(row.card.profile.name === "טל גלעד" && row.card.levelId === "B2", "cloud payload matches the local card");
  await ctxA.close();

  // 2) Fresh browser profile (no local card) pulls from cloud
  const ctxB = await browser.newContext(DEVICE);
  const pageB = await ctxB.newPage();
  pageB.on("pageerror", (e) => { console.log("PAGEERROR B", e.message); failures.push("pageerror B: " + e.message); });
  await pageB.goto(BASE);
  const localBefore = await pageB.evaluate(() => localStorage.getItem("padelCard.v2"));
  assert(!localBefore, "fresh profile has no local card");
  await signInPage(pageB);
  await pageB.waitForSelector("#card-root .ut-card", { timeout: 30000 });
  const seenB = await pageB.evaluate(() => ({
    name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || "",
    id: JSON.parse(localStorage.getItem("padelCard.v2")).profile.id,
    hasLocal: !!localStorage.getItem("padelCard.v2")
  }));
  assert(/טל/.test(seenB.name) && seenB.id === "local-tal-v15", "fresh profile loads the same card from the cloud");
  await snap(pageB, "v15-sync-fresh-profile.png");

  // 3) Edit persists (name change + debounce)
  await pageB.click("#edit-profile");
  await pageB.waitForSelector("#view-profile:not(.hidden)");
  await pageB.fill("#name", "טל גלעד מעודכן");
  await pageB.click("#profile-form button[type=submit], #profile-form .btn-primary, button[type=submit]");
  // Wait for navigation back to card and debounce+upsert
  await pageB.waitForSelector("#card-root .ut-card, #view-card:not(.hidden)", { timeout: 15000 }).catch(() => {});
  await pageB.waitForTimeout(2000);
  const afterEdit = await getCard(creds.id);
  const cloudName = afterEdit && afterEdit.card && afterEdit.card.profile && afterEdit.card.profile.name;
  assert(cloudName === "טל גלעד מעודכן", "edit persisted to cloud: " + cloudName);
  const localName = await pageB.evaluate(() => JSON.parse(localStorage.getItem("padelCard.v2")).profile.name);
  assert(localName === "טל גלעד מעודכן", "edit also stored locally");
  await snap(pageB, "v15-sync-after-edit.png");
  await ctxB.close();

  // 4) Another fresh profile sees the edited name; conflicting local is backed up
  const ctxC = await browser.newContext(DEVICE);
  const pageC = await ctxC.newPage();
  pageC.on("pageerror", (e) => { console.log("PAGEERROR C", e.message); failures.push("pageerror C: " + e.message); });
  await pageC.goto(BASE);
  const conflict = JSON.parse(JSON.stringify(seed));
  conflict.profile.name = "כרטיס ישן במכשיר";
  conflict.profile.id = "local-old-device";
  await pageC.evaluate((s) => { localStorage.setItem("padelCard.v2", JSON.stringify(s)); }, conflict);
  await signInPage(pageC);
  await pageC.waitForSelector("#card-root .ut-card", { timeout: 30000 });
  const seenC = await pageC.evaluate(() => {
    const cur = JSON.parse(localStorage.getItem("padelCard.v2") || "null");
    const bak = JSON.parse(localStorage.getItem("padelCard.v2.backup") || "null");
    return {
      name: (document.querySelector("#card-root .ut-id h1") || {}).textContent || "",
      id: cur && cur.profile && cur.profile.id,
      savedName: cur && cur.profile && cur.profile.name,
      backupId: bak && bak.profile && bak.profile.id,
      backupName: bak && bak.profile && bak.profile.name
    };
  });
  console.log("CONFLICT", { name: seenC.name, id: seenC.id, backupId: seenC.backupId });
  assert(seenC.id === "local-tal-v15" && /מעודכן/.test(seenC.savedName), "cloud wins on conflict and keeps the stable id");
  assert(seenC.backupId === "local-old-device" && seenC.backupName === "כרטיס ישן במכשיר", "conflicting local card was copied to padelCard.v2.backup");
  await snap(pageC, "v15-sync-conflict.png");

  // 5) Sign-out returns to login and does not destroy the local copy
  await pageC.click("#owner-logout");
  await pageC.waitForSelector("#view-login:not(.hidden)", { timeout: 15000 });
  const afterOut = await pageC.evaluate(() => ({
    login: !document.getElementById("view-login").classList.contains("hidden"),
    card: !document.getElementById("view-card").classList.contains("hidden"),
    local: !!localStorage.getItem("padelCard.v2"),
    name: (localStorage.getItem("padelCard.v2") && JSON.parse(localStorage.getItem("padelCard.v2")).profile.name) || ""
  }));
  assert(afterOut.login && !afterOut.card, "sign-out shows the login screen, not the owner card");
  assert(afterOut.local && /מעודכן/.test(afterOut.name), "sign-out does not destroy the local card data");
  await snap(pageC, "v15-sync-signed-out.png");
  await ctxC.close();
} finally {
  await browser.close();
  try { await deleteTestUser(creds.id); console.log("TEST USER removed"); } catch (err) { console.error("cleanup user failed"); }
}

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V15 SYNC TESTS PASSED");
