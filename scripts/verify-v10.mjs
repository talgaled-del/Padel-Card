import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const PHOTO = "/tmp/maya-photo.jpg";

fs.mkdirSync(OUT, { recursive: true });

const failures = [];
function assert(cond, msg) {
  if (!cond) { failures.push(msg); console.error("FAIL", msg); }
  else console.log("OK  ", msg);
}

function photoDataUrl() {
  if (!fs.existsSync(PHOTO)) return "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  return "data:image/jpeg;base64," + fs.readFileSync(PHOTO).toString("base64");
}

function decodeWaHref(href) {
  try {
    const u = new URL(href, BASE);
    if (u.hostname !== "wa.me") return { host: u.hostname, text: "", message: "", link: "" };
    const text = u.searchParams.get("text") || "";
    const nl = text.indexOf("\n");
    return {
      host: u.hostname,
      text,
      message: nl === -1 ? text : text.slice(0, nl),
      link: nl === -1 ? "" : text.slice(nl + 1)
    };
  } catch (err) {
    return { host: "", text: "", message: "", link: "" };
  }
}

function vis(el) {
  return !!(el && !el.classList.contains("hidden") && el.offsetParent !== null);
}

async function inspect(page) {
  return page.evaluate(() => {
    const vis = (el) => !!(el && !el.classList.contains("hidden") && el.offsetParent !== null);
    const waOwn = document.getElementById("wa-share-own");
    const waPair = document.getElementById("wa-share-pair");
    const brand = document.querySelector(".brand");
    const chevron = brand?.querySelector(".home-back-chevron");
    const label = brand?.querySelector(".home-back-label");
    const brandText = brand?.querySelector(".brand-text");
    const br = brand ? brand.getBoundingClientRect() : { width: 0, height: 0 };
    const st = brand ? getComputedStyle(brand) : null;
    return {
      viewCard: vis(document.getElementById("view-card")),
      viewPair: vis(document.getElementById("view-pair")),
      viewHome: vis(document.getElementById("view-home")),
      ownerBar: vis(document.getElementById("owner-actions")),
      pairOwnerBar: vis(document.getElementById("pair-owner-actions")),
      copyOwn: vis(document.getElementById("copy-own-link")),
      copyPair: vis(document.getElementById("copy-pair-link")),
      waOwn: vis(waOwn),
      waPair: vis(waPair),
      waOwnHref: waOwn?.getAttribute("href") || "",
      waPairHref: waPair?.getAttribute("href") || "",
      waOwnText: (waOwn?.textContent || "").replace(/\s+/g, " ").trim(),
      waPairText: (waPair?.textContent || "").replace(/\s+/g, " ").trim(),
      waOwnTarget: waOwn?.getAttribute("target") || "",
      waOwnRel: waOwn?.getAttribute("rel") || "",
      waPairTarget: waPair?.getAttribute("target") || "",
      waPairRel: waPair?.getAttribute("rel") || "",
      brandVisible: !!(brand && br.height > 0 && br.width > 0),
      brandHref: brand?.getAttribute("href") || "",
      brandAria: brand?.getAttribute("aria-label") || "",
      homeLabel: (label?.textContent || "").trim(),
      homeLabelVisible: !!(label && getComputedStyle(label).display !== "none" && label.getBoundingClientRect().height > 0),
      chevronVisible: !!(chevron && brand?.querySelector(".home-back") && getComputedStyle(brand.querySelector(".home-back")).display !== "none" && chevron.getBoundingClientRect().width > 0),
      chevronPath: chevron?.querySelector("path")?.getAttribute("d") || "",
      brandTextHidden: !brandText || getComputedStyle(brandText).display === "none",
      brandHeight: br.height,
      brandWidth: br.width,
      brandMinHeight: st ? parseFloat(st.minHeight) || 0 : 0,
      name: document.querySelector(".ut-id h1")?.textContent.trim() || "",
      copied: window.__copied || null,
      hash: location.hash
    };
  });
}

async function hookClipboard(page) {
  await page.evaluate(() => {
    window.__copied = null;
    if (navigator.clipboard) {
      navigator.clipboard.writeText = (text) => {
        window.__copied = text;
        return Promise.resolve();
      };
    }
  });
}

async function seedOwner(page, photo, extra = {}) {
  await page.evaluate(({ photo, extra }) => {
    const profile = Object.assign({
      id: "local-verify-owner",
      name: "טל גלעד",
      gender: "male",
      age: "36",
      hand: "right",
      side: "right",
      competitor: "no",
      hasPartner: "yes",
      partnerId: "seed-michal",
      photo: photo || null,
      region: "center",
      courts: [],
      frequency: "2-3",
      tenure: "3plus",
      style: "both",
      shots: ["volley", "smash"]
    }, extra);
    localStorage.setItem("padelCard.v2", JSON.stringify({
      levelId: "A2",
      profile,
      answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      videos: []
    }));
  }, { photo, extra });
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL"
});
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE.replace(/\/$/, "") });

const pageErrors = [];
function attachErrors(page, label) {
  page.on("pageerror", (err) => {
    console.log("PAGEERROR", label, err.message);
    pageErrors.push(label + ": " + err.message);
  });
}

// ---------- Visitor: demo card must not show WA share, but must show home pill ----------
const visitor = await context.newPage();
attachErrors(visitor, "visitor");
await visitor.goto(BASE, { waitUntil: "networkidle" });
await visitor.evaluate(() => localStorage.clear());
await visitor.goto(BASE + "#/demo/michal", { waitUntil: "networkidle" });
await visitor.waitForSelector("#view-card:not(.hidden) .ut-card");
await visitor.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));

const v = await inspect(visitor);
console.log("VISITOR", JSON.stringify({ ...v, waOwnHref: v.waOwnHref.slice(0, 80) }, null, 2));
assert(v.viewCard, "visitor is on card view");
assert(!v.ownerBar && !v.copyOwn && !v.waOwn, "visitor does not see WhatsApp share or copy on single card");
assert(v.brandVisible && v.homeLabelVisible && v.homeLabel === "בית", "visitor card shows בית home button");
assert(v.chevronVisible, "visitor card shows back chevron");
assert(/M9 6l6 6-6 6/i.test(v.chevronPath), "visitor chevron path points right");
assert(v.brandHeight >= 44 || v.brandMinHeight >= 44, "visitor home button is at least 44px tall, got " + v.brandHeight);
assert(/בית/.test(v.brandAria), "visitor home button aria-label mentions בית");
assert(v.brandHref === "#/" || v.brandHref.endsWith("#/"), "home button href is #/");

await visitor.click(".brand");
await visitor.waitForSelector("#view-home:not(.hidden)", { timeout: 5000 });
const vHome = await inspect(visitor);
assert(vHome.viewHome && !vHome.viewCard, "visitor home button navigates to home");

await visitor.goto(BASE + "#/demo/pair", { waitUntil: "networkidle" });
await visitor.waitForSelector("#view-pair:not(.hidden) .ut-card");
const vp = await inspect(visitor);
assert(vp.viewPair, "visitor is on demo pair view");
assert(!vp.pairOwnerBar && !vp.copyPair && !vp.waPair, "visitor does not see WhatsApp share on pair card");
assert(vp.homeLabelVisible && vp.homeLabel === "בית" && vp.chevronVisible, "visitor pair card shows בית home button");

// ---------- Owner ----------
const page = await context.newPage();
attachErrors(page, "owner");
await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await seedOwner(page, photoDataUrl());
await page.reload({ waitUntil: "networkidle" });
await hookClipboard(page);
await page.goto(BASE + "#/card", { waitUntil: "networkidle" });
await page.waitForSelector("#view-card:not(.hidden) .ut-card");
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 400));

const o = await inspect(page);
console.log("OWNER", JSON.stringify({ ...o, waOwnHref: o.waOwnHref.slice(0, 120) }, null, 2));
assert(o.viewCard, "owner is on card view");
assert(o.ownerBar && o.copyOwn, "owner sees copy link button");
assert(o.waOwn, "owner sees WhatsApp share button");
assert(/שיתוף לוואטסאפ/.test(o.waOwnText), "owner WhatsApp button label is שיתוף לוואטסאפ");
assert(o.waOwnTarget === "_blank" && /\bnoopener\b/.test(o.waOwnRel), "WhatsApp link is target=_blank rel=noopener");
assert(o.waOwnHref.startsWith("https://wa.me/?text="), "owner WhatsApp href is wa.me with text param");

await page.click("#copy-own-link");
await new Promise((r) => setTimeout(r, 200));
const copiedSingle = await page.evaluate(() => window.__copied);
console.log("COPIED SINGLE", copiedSingle);
assert(!!copiedSingle, "copy-link produced a URL");
const waSingle = decodeWaHref(o.waOwnHref);
assert(waSingle.message === "הכרטיס שחקן פאדל שלי 🎾", "single WhatsApp message is the short Hebrew line, got " + JSON.stringify(waSingle.message));
assert(copiedSingle && waSingle.link === copiedSingle, "WhatsApp href contains the same link copy-link copies");
assert(copiedSingle && copiedSingle.includes("#/p/"), "copied single link is a #/p/ share URL");

assert(o.homeLabelVisible && o.homeLabel === "בית", "owner card shows בית label");
assert(o.chevronVisible && /M9 6l6 6-6 6/i.test(o.chevronPath), "owner card shows RTL-right back chevron");
assert(o.brandHeight >= 44 || o.brandMinHeight >= 44, "owner home button is at least 44px tall, got " + o.brandHeight);
assert(o.brandTextHidden, "brand wordmark is hidden on card view in favor of בית");
assert(/בית/.test(o.brandAria), "owner home button aria-label mentions בית");

await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
await page.mouse.move(0, 0);
await new Promise((r) => setTimeout(r, 200));
const shot = path.join(OUT, "owner-whatsapp.png");
await page.screenshot({ path: shot, fullPage: true });
console.log("SNAP", shot);

await page.click(".brand");
await page.waitForSelector("#view-home:not(.hidden)", { timeout: 5000 });
const oHome = await inspect(page);
assert(oHome.viewHome && !oHome.viewCard, "owner home button navigates to home");

// ---------- Owner pair card ----------
await hookClipboard(page);
await page.goto(BASE + "#/pair", { waitUntil: "networkidle" });
await page.waitForSelector("#view-pair:not(.hidden) .ut-card");
await new Promise((r) => setTimeout(r, 250));
const op = await inspect(page);
console.log("OWNER PAIR", JSON.stringify({ ...op, waPairHref: op.waPairHref.slice(0, 120) }, null, 2));
assert(op.viewPair, "owner is on pair view");
assert(op.pairOwnerBar && op.copyPair, "owner sees pair copy link");
assert(op.waPair, "owner sees WhatsApp share on pair card");
assert(!op.waOwn, "single-card WhatsApp button is not visible on pair view");
assert(/שיתוף לוואטסאפ/.test(op.waPairText), "pair WhatsApp button label is שיתוף לוואטסאפ");
assert(op.waPairTarget === "_blank" && /\bnoopener\b/.test(op.waPairRel), "pair WhatsApp link is target=_blank rel=noopener");
assert(op.waPairHref.startsWith("https://wa.me/?text="), "pair WhatsApp href is wa.me with text param");
assert(op.homeLabelVisible && op.chevronVisible, "pair card shows בית home button");

await page.click("#copy-pair-link");
await new Promise((r) => setTimeout(r, 200));
const copiedPair = await page.evaluate(() => window.__copied);
console.log("COPIED PAIR", copiedPair && copiedPair.slice(0, 80));
assert(!!copiedPair, "pair copy-link produced a URL");
const waPair = decodeWaHref(op.waPairHref);
assert(waPair.message === "כרטיס הזוג שלנו בפאדל 🎾", "pair WhatsApp message is the short Hebrew line, got " + JSON.stringify(waPair.message));
assert(copiedPair && waPair.link === copiedPair, "pair WhatsApp href contains the same pair link copy-link copies");
assert(copiedPair && copiedPair.includes("#/pair/"), "copied pair link is a #/pair/ share URL");

// ---------- Visitor opening the owner's share link ----------
const otherContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL"
});
const other = await otherContext.newPage();
attachErrors(other, "other");
await other.goto(copiedSingle, { waitUntil: "networkidle" });
await other.waitForSelector("#view-card:not(.hidden) .ut-card");
const org = await inspect(other);
console.log("ORGANIZER", JSON.stringify({ ownerBar: org.ownerBar, copyOwn: org.copyOwn, waOwn: org.waOwn, homeLabel: org.homeLabel, name: org.name }, null, 2));
assert(!org.ownerBar && !org.copyOwn && !org.waOwn, "organizer viewing someone else's card does not see WhatsApp share");
assert(org.homeLabelVisible && org.homeLabel === "בית", "organizer still sees בית home button");

await other.click(".brand");
await other.waitForSelector("#view-home:not(.hidden)", { timeout: 5000 });
const orgHome = await inspect(other);
assert(orgHome.viewHome && !orgHome.viewCard, "organizer home button navigates to home");

await otherContext.close();
await browser.close();

if (pageErrors.length) {
  pageErrors.forEach((e) => {
    failures.push("pageerror: " + e);
    console.error("FAIL pageerror:", e);
  });
}

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V10 TESTS PASSED");
