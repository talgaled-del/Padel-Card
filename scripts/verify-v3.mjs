import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const PHOTO = "/tmp/maya-photo.jpg";

fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function assert(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error("FAIL", msg);
  } else {
    console.log("OK  ", msg);
  }
}

function photoDataUrl() {
  const buf = fs.readFileSync(PHOTO);
  return "data:image/jpeg;base64," + buf.toString("base64");
}

async function inspectCard(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el && !el.classList.contains("hidden") && el.offsetParent !== null);
    const visibleRoot = document.querySelector(".view:not(.hidden)") || document.body;
    const text = (visibleRoot.innerText || "").replace(/\s+/g, " ");
    const ratings = [...visibleRoot.querySelectorAll(".ut-rating-line")].map((el) => ({
      label: el.querySelector(".ut-rating-label")?.textContent.trim() || "",
      value: el.querySelector(".ut-rating-value")?.textContent.trim() || "",
      text: el.textContent.replace(/\s+/g, " ").trim()
    }));
    return {
      viewCard: vis(document.getElementById("view-card")),
      viewPair: vis(document.getElementById("view-pair")),
      ownerBar: vis(document.getElementById("owner-actions")),
      copyOwn: vis(document.getElementById("copy-own-link")),
      copyPairFromCard: vis(document.getElementById("copy-pair-from-card")),
      localActions: vis(document.getElementById("local-card-actions")),
      openPair: vis(document.getElementById("open-pair")),
      pairOwnerBar: vis(document.getElementById("pair-owner-actions")),
      copyPair: vis(document.getElementById("copy-pair-link")),
      shareView: vis(document.getElementById("view-share")),
      waContact: !!document.querySelector(".ut-wa-mini, #dock-wa, a.btn-contact, .btn-dock"),
      waVisibleText: /פנייה בוואטסאפ/.test(text),
      playtomic: /Playtomic|דירוג איגוד/.test(text),
      phoneLine: !!document.querySelector(".ut-phone-line, .dock-phone, .phone-num"),
      ratings,
      ratingCount: ratings.length,
      toast: document.getElementById("toast")?.textContent.trim() || "",
      toastShown: document.getElementById("toast")?.classList.contains("show") || false,
      name: document.querySelector(".ut-id h1")?.textContent.trim() || "",
      text
    };
  });
}

async function snap(page, name) {
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 250));
  const dest = path.join(OUT, name);
  await page.screenshot({ path: dest, fullPage: true });
  console.log("SNAP", dest);
  return dest;
}

function hookClipboard(page) {
  return page.evaluate(() => {
    window.__copied = null;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (text) => {
        window.__copied = text;
        return orig(text);
      };
    }
  });
}

async function seedOwner(page, photo) {
  await page.evaluate((photo) => {
    const profile = {
      id: "local-verify-owner",
      name: "מאיה שגב",
      age: 31,
      gender: "female",
      hand: "right",
      side: "left",
      competitor: "no",
      hasPartner: "yes",
      partnerId: "seed-michal",
      photo,
      region: "telaviv",
      courts: ["פאדל יד אליהו", "פאדל פארק הירקון"],
      frequency: "2-3",
      tenure: "1-2",
      style: "both",
      shots: ["bandeja", "volley", "lob"]
    };
    const payload = {
      levelId: "B2",
      profile,
      answers: [3, 3, 3, 3, 2, 3, 2, 3, 2, 2, 2, 2],
      videos: [{ id: "v1", name: "סרטון 1", link: "https://youtu.be/padel-maya", poster: "", duration: 0, bytes: 0, localOnly: false }]
    };
    localStorage.setItem("padelCard.v2", JSON.stringify(payload));
  }, photo);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

const context = browser.defaultBrowserContext();
await context.overridePermissions(BASE.replace(/\/$/, ""), ["clipboard-read", "clipboard-write"]);

const pageErrors = [];

// --- Visitor: demo card ---
const visitor = await browser.newPage();
visitor.on("pageerror", (err) => pageErrors.push("visitor: " + err));
await visitor.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await visitor.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await visitor.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
await visitor.evaluate(() => localStorage.clear());
await visitor.goto(BASE + "#/demo/michal", { waitUntil: "networkidle0", timeout: 30000 });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-card");
await visitor.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

const v = await inspectCard(visitor);
console.log("VISITOR", JSON.stringify({ ...v, text: undefined }, null, 2));
assert(v.viewCard, "visitor is on card view");
assert(!v.ownerBar && !v.copyOwn && !v.copyPairFromCard && !v.localActions, "visitor has no copy/owner controls");
assert(!v.waContact && !v.waVisibleText, "visitor has no WhatsApp contact");
assert(!v.playtomic, "visitor has no Playtomic/federation rating");
assert(!v.phoneLine, "visitor has no phone line");
assert(v.ratingCount === 1, "visitor has exactly one rating line, got " + v.ratingCount);
assert(v.ratings[0] && v.ratings[0].value === "C1 · 3.5", "visitor rating is C1 · 3.5, got " + JSON.stringify(v.ratings[0]));
assert(v.name === "מיכל לוי", "visitor sees Michal");
await snap(visitor, "visitor-card.png");

await visitor.goto(BASE + "#/demo/pair", { waitUntil: "networkidle0" });
await visitor.waitForSelector("#view-pair:not(.hidden) .ut-card");
const vp = await inspectCard(visitor);
assert(vp.viewPair, "demo pair view visible");
assert(!vp.pairOwnerBar && !vp.copyPair, "demo pair has no copy button");
assert(!vp.waContact && !vp.waVisibleText && !vp.playtomic, "demo pair has no WhatsApp or external ratings");
assert(vp.ratingCount === 2, "demo pair has one rating line per player, got " + vp.ratingCount);
assert(vp.ratings.every((r) => r.value === "C1 · 3.5"), "demo pair ratings are C1 · 3.5");

// --- Owner: seeded localStorage, same way the app persists ---
const owner = await browser.newPage();
owner.on("pageerror", (err) => pageErrors.push("owner: " + err));
await owner.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await owner.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await owner.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
await owner.evaluate(() => localStorage.clear());
await seedOwner(owner, photoDataUrl());
await owner.reload({ waitUntil: "networkidle0", timeout: 30000 });
await hookClipboard(owner);
await owner.goto(BASE + "#/card", { waitUntil: "networkidle0", timeout: 30000 });
await owner.waitForSelector("#view-card:not(.hidden) .ut-card");
await owner.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 500));

const o = await inspectCard(owner);
console.log("OWNER", JSON.stringify({ ...o, text: undefined }, null, 2));
assert(o.viewCard, "owner is on card view");
assert(o.name === "מאיה שגב", "owner sees their name");
assert(o.ownerBar && o.copyOwn, "owner sees copy link button");
assert(o.copyPairFromCard && o.openPair && o.localActions, "owner with partner sees pair copy and local edit actions");
assert(!o.waContact && !o.waVisibleText, "owner card has no WhatsApp contact");
assert(!o.playtomic, "owner card has no Playtomic/federation rating");
assert(o.ratingCount === 1 && o.ratings[0].value === "B2 · 4.0", "owner rating is B2 · 4.0, got " + JSON.stringify(o.ratings[0]));
await snap(owner, "owner-card.png");

await owner.click("#copy-own-link");
await owner.waitForFunction(() => document.getElementById("toast")?.classList.contains("show"));
const afterCopy = await owner.evaluate(() => ({
  toast: document.getElementById("toast")?.textContent.trim() || "",
  copied: window.__copied || ""
}));
console.log("COPY", afterCopy.toast, afterCopy.copied.slice(0, 80));
assert(afterCopy.toast === "הקישור הועתק", "toast says הקישור הועתק");
assert(/#\/p\//.test(afterCopy.copied), "copied URL is a single card link");
assert(afterCopy.copied.startsWith(BASE), "copied URL points at this app");

const decoded = await owner.evaluate((url) => {
  const hash = url.split("#")[1] || "";
  const payload = hash.split("/").filter(Boolean)[1];
  const pad = payload.length % 4 === 0 ? "" : "=".repeat(4 - (payload.length % 4));
  const b64 = payload.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const raw = JSON.parse(new TextDecoder().decode(bytes));
  return { n: raw.n, lv: raw.lv, id: raw.id, ptm: raw.ptm, as: raw.as, tel: raw.tel };
}, afterCopy.copied);
console.log("DECODED", decoded);
assert(decoded.n === "מאיה שגב" && decoded.lv === "B2" && decoded.id === "local-verify-owner", "copied payload is the owner's card");
assert(!decoded.ptm && !decoded.as && !decoded.tel, "copied payload has no phone or external ratings");

// Owner opening their own shared link still sees copy
await owner.goto(afterCopy.copied, { waitUntil: "networkidle0" });
await owner.waitForSelector("#view-card:not(.hidden) .ut-card");
const ownLink = await inspectCard(owner);
assert(ownLink.copyOwn && ownLink.ownerBar, "owner opening their shared link still sees copy");
assert(!ownLink.localActions, "snapshot link does not show edit/retake (live local only)");

// Owner pair card
await owner.goto(BASE + "#/pair", { waitUntil: "networkidle0" });
await owner.waitForSelector("#view-pair:not(.hidden) .ut-card");
const op = await inspectCard(owner);
assert(op.pairOwnerBar && op.copyPair, "owner pair view shows copy button");
await hookClipboard(owner);
await owner.click("#copy-pair-link");
await owner.waitForFunction(() => document.getElementById("toast")?.classList.contains("show"));
const pairCopied = await owner.evaluate(() => window.__copied || "");
assert(/#\/pair\//.test(pairCopied), "pair copy URL is a pair link, got " + pairCopied.slice(0, 80));

// Organizer opens the owner's shared single link with empty storage
const organizer = await browser.newPage();
organizer.on("pageerror", (err) => pageErrors.push("organizer: " + err));
await organizer.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await organizer.goto(BASE, { waitUntil: "networkidle0" });
await organizer.evaluate(() => localStorage.clear());
await organizer.reload({ waitUntil: "networkidle0" });
await organizer.goto(afterCopy.copied, { waitUntil: "networkidle0" });
await organizer.waitForSelector("#view-card:not(.hidden) .ut-card");
const org = await inspectCard(organizer);
assert(org.name === "מאיה שגב", "organizer sees the owner's card");
assert(!org.ownerBar && !org.copyOwn && !org.localActions, "organizer does not see copy/owner controls");
assert(!org.waContact && !org.waVisibleText && !org.playtomic, "organizer card has no WhatsApp or external ratings");
assert(org.ratingCount === 1 && org.ratings[0].value === "B2 · 4.0", "organizer sees the quiz rating only");

// Old shared link with phone + playtomic should ignore those fields
const staleUrl = await organizer.evaluate(() => {
  function toBase64Url(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  const raw = {
    id: "stale-old",
    n: "דני ישן",
    g: "male",
    a: 33,
    h: "right",
    s: "right",
    c: "yes",
    lv: "B1",
    sc: 34,
    v: [],
    hp: "no",
    z: "haifa",
    ptm: "4.6",
    as: "4.5",
    tel: "0532223344",
    hd: 0
  };
  return location.origin + location.pathname + "#/p/" + toBase64Url(JSON.stringify(raw));
});
await organizer.goto(staleUrl, { waitUntil: "networkidle0" });
await organizer.waitForSelector("#view-card:not(.hidden) .ut-card");
const stale = await inspectCard(organizer);
assert(stale.name === "דני ישן", "old link still opens");
assert(stale.ratingCount === 1 && stale.ratings[0].value === "B1 · 4.5", "old link shows only quiz rating");
assert(!stale.playtomic && !stale.waContact && !stale.phoneLine && !stale.copyOwn, "old link ignores phone, Playtomic, and has no copy");

if (pageErrors.length) {
  console.error("PAGE ERRORS", pageErrors);
  failures.push("page errors: " + pageErrors.join(" | "));
}

await browser.close();

if (failures.length) {
  console.error("\n" + failures.length + " failure(s)");
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
