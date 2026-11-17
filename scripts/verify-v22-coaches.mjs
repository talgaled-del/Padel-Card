// v22 — certified rater profiles, invites, public coaches directory, picker cards.
// Disposable @example.com users only. Never emails real coaches.
import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "fs";
import {
  ensureUser, deleteCard, upsertCard, addAdmin, setLegalAcceptance,
  cleanupExampleTestUsers, cleanupCertifiedTestData, expireOpenInvites, DEVICE
} from "./v15-admin.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.env.V22_BASE || "http://127.0.0.1:8878/";
const SHOTS = ROOT + "screens/";
const failures = [];
function assert(c, m) { if (!c) { failures.push(m); console.error("FAIL", m); } else console.log("OK  ", m); }
fs.mkdirSync(SHOTS, { recursive: true });

const PLAYER_EMAIL = "padel.test.v22.player@example.com";
const RATER_EMAIL = "padel.test.v22.rater@example.com";
const OTHER_EMAIL = "padel.test.v22.other@example.com";
const ADMIN_EMAIL = "padel.test.v22.admin@example.com";
const RATER_NAME = "מאמן בדיקה v22";
const CLUB = "פאדל בדיקה";

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

await cleanupExampleTestUsers(/padel\.test\.v22/i).catch(function () {});
await cleanupCertifiedTestData().catch(function () {});

const player = await ensureUser(PLAYER_EMAIL);
const rater = await ensureUser(RATER_EMAIL);
const other = await ensureUser(OTHER_EMAIL);
const admin = await ensureUser(ADMIN_EMAIL);
await setLegalAcceptance(player.id, { media: true });
await setLegalAcceptance(rater.id, { media: true });
await setLegalAcceptance(other.id, { media: true });
await setLegalAcceptance(admin.id, { media: true });
await deleteCard(player.id);
await deleteCard(rater.id);
await deleteCard(other.id);
await upsertCard(player.id, seed("local-v22-player", "שחקן בדיקה v22", "C1"));
await upsertCard(rater.id, seed("local-v22-rater", RATER_NAME, "B1"));
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

async function restAs(page, table) {
  return page.evaluate(async (table) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.from(table).select("*");
    return { data, error: error && (error.message || error.code || String(error)) };
  }, table);
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

let raterId = null;
let inviteToken = null;

try {
  // --- Admin: create unlinked rater + invite ---
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

  const forbiddenAdmin = await rpcAs(pageA, "list_certified_coaches_public", {});
  assert(!forbiddenAdmin.error, "admin can read public coaches list");

  await pageA.goto(BASE + "#/admin");
  await pageA.waitForTimeout(800);
  await pageA.click('[data-admin-tab="certified"]');
  await pageA.waitForSelector('[data-rater-id="' + raterId + '"]', { timeout: 15000 });
  await pageA.click('[data-rater-id="' + raterId + '"] [data-rater-act="invite"]');
  await pageA.waitForSelector('[data-invite-box="' + raterId + '"]:not(.hidden) textarea', { timeout: 15000 });
  const inviteUi = await pageA.evaluate((id) => {
    const box = document.querySelector('[data-invite-box="' + id + '"]');
    const input = box && box.querySelector("input");
    const ta = box && box.querySelector("textarea");
    return {
      url: (input && input.value) || "",
      msg: (ta && ta.value) || "",
      text: (box && box.innerText) || ""
    };
  }, raterId);
  assert(/#\/invite\/[0-9a-f]{32,}/i.test(inviteUi.url), "invite box shows a one-time invite URL");
  assert(inviteUi.msg.indexOf(RATER_NAME) !== -1, "WhatsApp message is personalized with the rater name");
  assert(/Padel Card/.test(inviteUi.msg) && /חינמית/.test(inviteUi.msg) && inviteUi.msg.indexOf(inviteUi.url) !== -1,
    "WhatsApp message explains Padel Card, that it is free, and includes the link");
  assert(/העתקת הודעת וואטסאפ/.test(inviteUi.text), "copy WhatsApp button is visible");
  inviteToken = (inviteUi.url.match(/#\/invite\/([0-9a-f]+)/i) || [])[1];
  assert(!!inviteToken, "extracted invite token from admin UI");
  const box = pageA.locator('[data-invite-box="' + raterId + '"]');
  await box.scrollIntoViewIfNeeded();
  await hideToast(pageA);
  await pageA.screenshot({ path: SHOTS + "v22-admin-invite.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v22-admin-invite.png");

  // Recreating an invite retires the previous unused token
  const second = await rpcAs(pageA, "admin_create_rater_invite", { p_rater_id: raterId });
  assert(second.data && second.data.token && second.data.token !== inviteToken, "new invite token replaces the previous live one");
  const oldClaimPrep = inviteToken;
  inviteToken = second.data.token;
  await ctxA.close();

  // --- RLS: anon cannot read tables; public list is allowed ---
  const ctxAnon = await browser.newContext(DEVICE);
  const pageAnon = await ctxAnon.newPage();
  await pageAnon.goto(BASE);
  await pageAnon.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const rlsAnon = await pageAnon.evaluate(async (id) => {
    const c = PadelAuth.getClient();
    const profiles = await c.from("certified_rater_profiles").select("*");
    const invites = await c.from("certified_rater_invites").select("*");
    const list = await c.rpc("list_certified_coaches_public");
    const one = await c.rpc("get_certified_coach_public", { p_id: id });
    const claim = await c.rpc("claim_rater_invite", { p_token: "abcd" });
    const upsert = await c.rpc("upsert_my_certified_profile", { p_profile: { city: "x" } });
    return {
      profilesErr: profiles.error && (profiles.error.message || profiles.error.code || String(profiles.error)),
      invitesErr: invites.error && (invites.error.message || invites.error.code || String(invites.error)),
      listErr: list.error && (list.error.message || String(list.error)),
      list: list.data,
      oneErr: one.error && (one.error.message || String(one.error)),
      claimErr: claim.error && (claim.error.message || String(claim.error)),
      upsertErr: upsert.error && (upsert.error.message || String(upsert.error))
    };
  }, raterId);
  assert(!!rlsAnon.profilesErr, "anon cannot select certified_rater_profiles");
  assert(!!rlsAnon.invitesErr, "anon cannot select certified_rater_invites");
  assert(!rlsAnon.listErr, "anon can call list_certified_coaches_public");
  const listedIncomplete = Array.isArray(rlsAnon.list) && rlsAnon.list.some((c) => c && c.id === raterId);
  assert(!listedIncomplete, "incomplete profile is hidden from the public directory");
  assert(/coach not found/i.test(rlsAnon.oneErr || ""), "public coach card 404s until the profile is complete");
  assert(!!rlsAnon.claimErr, "anon cannot claim an invite");
  assert(!!rlsAnon.upsertErr, "anon cannot upsert a rater profile");

  // Public coaches page still renders (empty of the incomplete test rater)
  await pageAnon.goto(BASE + "#/coaches");
  await pageAnon.waitForSelector("#view-coaches:not(.hidden)", { timeout: 10000 });
  const coachesBoot = await pageAnon.evaluate(() => ({
    title: ((document.querySelector("#view-coaches h1") || {}).textContent || "").trim(),
    hasTest: ((document.getElementById("coaches-grid") || {}).innerText || "").indexOf("מאמן בדיקה v22") !== -1
  }));
  assert(coachesBoot.title === "המוסמכים שלנו" && !coachesBoot.hasTest, "public coaches page loads and hides incomplete profiles");
  await ctxAnon.close();

  // Retired token cannot be claimed
  const ctxOld = await browser.newContext(DEVICE);
  const pageOld = await ctxOld.newPage();
  await pageOld.goto(BASE);
  await signIn(pageOld, rater);
  const retired = await rpcAs(pageOld, "claim_rater_invite", { p_token: oldClaimPrep });
  assert(/already used|invalid invite|expired/i.test(retired.error || ""), "retired unused invite cannot be claimed");
  await ctxOld.close();

  // Admin email cannot claim
  const ctxAdminClaim = await browser.newContext(DEVICE);
  const pageAdminClaim = await ctxAdminClaim.newPage();
  await pageAdminClaim.goto(BASE);
  await signIn(pageAdminClaim, admin);
  const adminClaim = await rpcAs(pageAdminClaim, "claim_rater_invite", { p_token: inviteToken });
  assert(/cannot assign admin email|admin email/i.test(adminClaim.error || ""), "admin email is rejected by claim_rater_invite");
  await ctxAdminClaim.close();

  // Expired token is rejected
  const ctxExpAdmin = await browser.newContext(DEVICE);
  const pageExpAdmin = await ctxExpAdmin.newPage();
  await pageExpAdmin.goto(BASE);
  await signIn(pageExpAdmin, admin);
  const expiredInvite = await rpcAs(pageExpAdmin, "admin_create_rater_invite", { p_rater_id: raterId });
  const expiredToken = expiredInvite.data && expiredInvite.data.token;
  await ctxExpAdmin.close();
  await expireOpenInvites(raterId);
  const ctxExp = await browser.newContext(DEVICE);
  const pageExp = await ctxExp.newPage();
  await pageExp.goto(BASE);
  await signIn(pageExp, rater);
  const expiredRes = await rpcAs(pageExp, "claim_rater_invite", { p_token: expiredToken });
  assert(/invite expired/i.test(expiredRes.error || ""), "expired invite is rejected");
  await ctxExp.close();

  // Fresh invite for the successful claim
  const ctxA2 = await browser.newContext(DEVICE);
  const pageA2 = await ctxA2.newPage();
  await pageA2.goto(BASE);
  await signIn(pageA2, admin);
  const live = await rpcAs(pageA2, "admin_create_rater_invite", { p_rater_id: raterId });
  inviteToken = live.data && live.data.token;
  assert(!!inviteToken, "admin issued a fresh invite after expiry test");
  await ctxA2.close();

  // --- Invitee claims via #/invite/<token> then edits profile ---
  const ctxR = await browser.newContext(DEVICE);
  const pageR = await ctxR.newPage();
  await pageR.goto(BASE + "#/invite/" + inviteToken);
  await pageR.waitForFunction(() => window.PadelAuth && PadelAuth.getClient && PadelAuth.getClient());
  const stored = await pageR.evaluate(() => sessionStorage.getItem("padelCard.inviteToken") || "");
  assert(stored === inviteToken, "invite token is kept in sessionStorage before login");
  await signIn(pageR, rater);
  await pageR.waitForFunction(() => (location.hash || "").indexOf("coach-profile") !== -1, { timeout: 20000 });
  await pageR.waitForSelector("#view-coach-profile:not(.hidden)", { timeout: 15000 });
  await pageR.waitForTimeout(800);
  let mine = await rpcAs(pageR, "get_my_certified_profile", {});
  if (mine.error || !(mine.data && mine.data.full_name)) {
    const diag = await pageR.evaluate(async () => {
      const c = PadelAuth.getClient();
      const sess = await c.auth.getSession();
      const user = sess && sess.data && sess.data.session && sess.data.session.user;
      return {
        hash: location.hash,
        toast: ((document.getElementById("toast") || {}).textContent || "").slice(0, 180),
        hasSession: !!(user && user.id),
        emailIsTest: !!(user && /padel\.test\.v22/.test(user.email || "")),
        inviteLeft: (window.PadelCoaches && PadelCoaches.peekInviteToken && PadelCoaches.peekInviteToken()) || ""
      };
    });
    console.error("get_my failed", mine.error, "diag", JSON.stringify(diag));
    await pageR.waitForTimeout(1500);
    mine = await rpcAs(pageR, "get_my_certified_profile", {});
  }
  if (mine.error) console.error("get_my retry error", mine.error);
  assert(!mine.error && mine.data && mine.data.full_name === RATER_NAME, "claimed rater can load their profile");
  assert(true, "invite claim routes the rater to the profile editor");

  const reuse = await rpcAs(pageR, "claim_rater_invite", { p_token: inviteToken });
  assert(/already used|invalid invite/i.test(reuse.error || ""), "used invite token cannot be claimed again");

  const otherDenied = await (async () => {
    const ctxO = await browser.newContext(DEVICE);
    const pageO = await ctxO.newPage();
    await pageO.goto(BASE);
    await signIn(pageO, other);
    const up = await rpcAs(pageO, "upsert_my_certified_profile", {
      p_profile: { city: "תל אביב", years_experience: 3, audiences: ["kids"], clubs: ["x"] }
    });
    const inv = await rpcAs(pageO, "admin_create_rater_invite", { p_rater_id: raterId });
    const tables = await restAs(pageO, "certified_rater_profiles");
    await ctxO.close();
    return { up, inv, tables };
  })();
  assert(/not a certified rater|not authorized/i.test(otherDenied.up.error || ""), "non-rater cannot upsert a certified profile");
  assert(!!otherDenied.inv.error, "non-admin cannot create an invite");
  assert(!!otherDenied.tables.error, "authenticated non-admin cannot select profile rows directly");

  const profilePayload = {
    clubs: [CLUB, "פאדל הרצליה"],
    city: "הוד השרון",
    region: "sharon",
    years_experience: 8,
    certification: "מאמן מוסמך בדיקה",
    audiences: ["beginners", "advanced"],
    bio: "מאמן בדיקה לפרופיל מוסמך. עובד עם מתחילים ומתקדמים.",
    contact: "0500000000",
    contact_public: true,
    show_player_card: true
  };
  const saved = await rpcAs(pageR, "upsert_my_certified_profile", { p_profile: profilePayload });
  if (!(saved.data && saved.data.is_complete)) console.error("upsert failed", saved.error, saved.data && Object.keys(saved.data || {}));
  assert(saved.data && saved.data.is_complete, "rater profile saves and is marked complete");

  await pageR.evaluate(() => { if (window.PadelCoaches && PadelCoaches.loadEditor) return PadelCoaches.loadEditor(); });
  await pageR.waitForFunction((name) => {
    const n = document.getElementById("coach-edit-name");
    const s = document.getElementById("coach-edit-status");
    return n && (n.textContent || "").indexOf(name) !== -1 && s && /מפורסם/.test(s.textContent || "");
  }, RATER_NAME, { timeout: 15000 });
  await pageR.evaluate(() => {
    const view = document.getElementById("view-coach-profile");
    if (view) view.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await hideToast(pageR);
  await pageR.screenshot({ path: SHOTS + "v22-profile-editor.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v22-profile-editor.png");
  const editorReady = await pageR.evaluate(() => {
    const link = document.getElementById("coach-edit-public-link");
    return { href: link && link.getAttribute("href"), hidden: link && link.classList.contains("hidden") };
  });
  assert(editorReady.href === "#/coach/" + raterId && !editorReady.hidden, "editor shows the public coach card link after publish");

  // Rater home shows the profile button
  await pageR.goto(BASE + "#/");
  await pageR.waitForTimeout(800);
  const homeBtn = await pageR.evaluate(() => {
    const b = document.getElementById("home-coach-profile-btn");
    return b && !b.classList.contains("hidden") && /הפרופיל שלי כמוסמך/.test(b.textContent || "");
  });
  assert(homeBtn, "rater home shows הפרופיל שלי כמוסמך");
  await ctxR.close();

  // --- Public coach card ---
  const ctxC = await browser.newContext(DEVICE);
  const pageC = await ctxC.newPage();
  await pageC.goto(BASE + "#/coach/" + raterId);
  await pageC.waitForSelector("#view-coach:not(.hidden) .coach-card", { timeout: 15000 });
  const card = await pageC.evaluate(() => {
    const root = document.getElementById("coach-card-root");
    const t = (root && root.innerText) || "";
    return {
      t,
      wa: !!document.getElementById("coach-wa"),
      badge: /מוסמך/.test(t),
      login: !!(document.getElementById("view-login") && !document.getElementById("view-login").classList.contains("hidden"))
    };
  });
  assert(!card.login, "public coach card is not login-gated");
  assert(card.badge && card.t.indexOf(RATER_NAME) !== -1, "coach card shows the מוסמך badge and name");
  assert(card.t.indexOf(CLUB) !== -1 && /8 שנות אימון/.test(card.t), "coach card shows clubs and years of experience");
  assert(/מתחילים/.test(card.t) && /מתקדמים/.test(card.t), "coach card lists teaching audiences");
  assert(/הוד השרון/.test(card.t), "coach card shows city");
  assert(card.wa, "opted-in lesson contact shows a WhatsApp button");
  assert(/דירוג שחקן/.test(card.t), "active player rating is shown on the rater card");
  await hideToast(pageC);
  await pageC.screenshot({ path: SHOTS + "v22-coach-card.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v22-coach-card.png");

  // Public payload hides contact when opted out
  const pubOn = await pageC.evaluate(async (id) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc("get_certified_coach_public", { p_id: id });
    return { data, error: error && (error.message || String(error)) };
  }, raterId);
  assert(pubOn.data && pubOn.data.contact && pubOn.data.contact_public, "public RPC returns contact only when opted in");

  // Hide contact via rater session then re-check as anon
  const ctxHide = await browser.newContext(DEVICE);
  const pageHide = await ctxHide.newPage();
  await pageHide.goto(BASE);
  await signIn(pageHide, rater);
  const hidden = await rpcAs(pageHide, "upsert_my_certified_profile", {
    p_profile: {
      clubs: [CLUB, "פאדל הרצליה"],
      city: "הוד השרון",
      region: "sharon",
      years_experience: 8,
      certification: "מאמן מוסמך בדיקה",
      audiences: ["beginners", "advanced"],
      bio: "מאמן בדיקה לפרופיל מוסמך. עובד עם מתחילים ומתקדמים.",
      contact: "0500000000",
      contact_public: false,
      show_player_card: true
    }
  });
  assert(hidden.data && hidden.data.is_complete && hidden.data.contact_public === false, "rater can update own profile and opt out of contact");
  await ctxHide.close();
  const pubOff = await pageC.evaluate(async (id) => {
    const c = PadelAuth.getClient();
    const { data, error } = await c.rpc("get_certified_coach_public", { p_id: id });
    return { data, error: error && (error.message || String(error)) };
  }, raterId);
  assert(pubOff.data && pubOff.data.contact_public === false && !pubOff.data.contact, "public coach payload omits contact when not opted in");
  await ctxC.close();

  // --- Public directory ---
  const ctxD = await browser.newContext(DEVICE);
  const pageD = await ctxD.newPage();
  await pageD.goto(BASE + "#/coaches");
  await pageD.waitForSelector("#view-coaches:not(.hidden)", { timeout: 10000 });
  await pageD.waitForFunction((name) => {
    const g = document.getElementById("coaches-grid");
    return g && (g.innerText || "").indexOf(name) !== -1;
  }, RATER_NAME, { timeout: 15000 });
  const dir = await pageD.evaluate((name) => {
    const grid = document.getElementById("coaches-grid");
    const link = grid && grid.querySelector('a.coach-tile[href*="' + name + '"], a.coach-tile');
    const tiles = Array.from((grid && grid.querySelectorAll("a.coach-tile")) || []);
    const mine = tiles.find((el) => (el.innerText || "").indexOf("מאמן בדיקה v22") !== -1);
    return {
      title: ((document.querySelector("#view-coaches h1") || {}).textContent || "").trim(),
      href: mine && mine.getAttribute("href"),
      text: (mine && mine.innerText) || "",
      login: !!(document.getElementById("view-login") && !document.getElementById("view-login").classList.contains("hidden"))
    };
  }, raterId);
  assert(!dir.login && dir.title === "המוסמכים שלנו", "public המוסמכים שלנו page is not login-gated");
  assert(dir.href === "#/coach/" + raterId, "directory tile links to #/coach/<id>");
  assert(dir.text.indexOf(CLUB) !== -1 && /8 שנות אימון/.test(dir.text), "directory tile shows clubs and years");
  await pageD.fill("#coaches-search", CLUB);
  await pageD.waitForTimeout(200);
  const searchHit = await pageD.evaluate(() => ((document.getElementById("coaches-grid") || {}).innerText || ""));
  assert(searchHit.indexOf(RATER_NAME) !== -1, "directory search by club finds the rater");
  await pageD.fill("#coaches-search", "מועדון שלא קיים");
  await pageD.waitForTimeout(200);
  const searchMiss = await pageD.evaluate(() => ((document.getElementById("coaches-grid") || {}).innerText || ""));
  assert(/אין מוסמכים שתואמים/.test(searchMiss), "directory search shows an empty state");
  await pageD.fill("#coaches-search", "");
  await pageD.waitForTimeout(200);
  await hideToast(pageD);
  await pageD.screenshot({ path: SHOTS + "v22-coaches-page.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v22-coaches-page.png");
  await ctxD.close();

  // --- Player picker ---
  const ctxP = await browser.newContext(DEVICE);
  const pageP = await ctxP.newPage();
  await pageP.route("**/functions/v1/notify-rating-request", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, id: "mock-resend-v22" })
    });
  });
  await pageP.goto(BASE);
  await signIn(pageP, player);
  await pageP.goto(BASE + "#/");
  await pageP.waitForSelector("#req-ask-home-btn:not(.hidden)", { timeout: 15000 });
  await pageP.click("#req-ask-home-btn");
  await pageP.waitForSelector('#req-picker-list button[data-rater-id]:not([disabled])', { timeout: 15000 });
  const pickerBefore = await pageP.evaluate((id) => {
    const btn = document.querySelector('#req-picker-list button[data-rater-id="' + id + '"]');
    return { text: (btn && btn.innerText) || "", hasPhoto: !!(btn && btn.querySelector(".coach-tile-photo")) };
  }, raterId);
  assert(pickerBefore.text.indexOf(RATER_NAME) !== -1, "picker shows the rater name");
  assert(pickerBefore.text.indexOf(CLUB) !== -1 && /8 שנות אימון/.test(pickerBefore.text), "picker cards show clubs and years of experience");
  assert(pickerBefore.hasPhoto, "picker cards include a photo (or fallback)");
  await pageP.fill("#req-picker-search", CLUB);
  await pageP.waitForTimeout(200);
  const pickerSearch = await pageP.evaluate((id) => {
    const visible = Array.from(document.querySelectorAll("#req-picker-list button[data-rater-id]"));
    return {
      ids: visible.map((el) => el.getAttribute("data-rater-id")),
      empty: ((document.getElementById("req-picker-list") || {}).innerText || "")
    };
  }, raterId);
  assert(pickerSearch.ids.indexOf(raterId) !== -1, "picker search by club keeps the test rater");
  await hideToast(pageP);
  await pageP.screenshot({ path: SHOTS + "v22-rater-picker.png", timeout: 20000, fullPage: false });
  console.log("SHOT", SHOTS + "v22-rater-picker.png");
  await ctxP.close();
} finally {
  await browser.close().catch(() => {});
  await cleanupCertifiedTestData().catch(() => {});
  await cleanupExampleTestUsers(/padel\.test\.v22/i).catch(() => {});
}

if (failures.length) {
  console.error("FAILED", failures.length, failures.join(" | "));
  process.exit(1);
}
console.log("ALL PASSED");
