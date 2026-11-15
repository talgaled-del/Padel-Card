import { chromium } from "/tmp/pw/node_modules/playwright/index.mjs";
import fs from "node:fs";

const BASE = "http://127.0.0.1:8765/";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const failures = [];
function assert(cond, msg) {
  if (!cond) { failures.push(msg); console.error("FAIL", msg); }
  else console.log("OK  ", msg);
}

const TINY_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

async function seed(page, extra = {}) {
  await page.evaluate(({ photo, tenure, shots }) => {
    const profile = {
      id: "local-tal-track",
      name: "טל גלעד",
      gender: "male",
      age: "36",
      hand: "right",
      side: "right",
      competitor: "no",
      hasPartner: "no",
      partnerId: null,
      photo: photo || null,
      region: "center",
      courts: [],
      frequency: "2-3",
      tenure: tenure || "5plus",
      style: "both",
      shots: shots || ["volley", "smash"]
    };
    localStorage.setItem("padelCard.v2", JSON.stringify({
      levelId: "A2",
      profile,
      answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      videos: []
    }));
  }, extra);
}

async function clickOpensChooser(page, selector, label) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  assert(!!box && box.height > 8 && box.width > 8, label + " is visible and tappable");
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return { tag: el.tagName, id: el.id, type: el.type || "", className: String(el.className).slice(0, 80) };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  console.log("HIT", label, hit);
  const atPoint = hit && (
    hit.type === "file" ||
    hit.id === "video-file" ||
    hit.id === "photo-file" ||
    hit.id === "card-photo-file" ||
    /upload|card-photo-upload-label/i.test(hit.className + hit.id)
  );
  assert(atPoint, label + " is the topmost control at its center, got " + JSON.stringify(hit));

  let opened = false;
  try {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 4000 }),
      loc.click({ force: false })
    ]);
    opened = !!chooser;
  } catch (err) {
    console.log("chooser error", label, err.message);
  }
  assert(opened, label + " opens a file chooser");
  return opened;
}

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL"
});
page.on("pageerror", (err) => {
  console.log("PAGEERROR", err.message);
  failures.push("pageerror: " + err.message);
});

await page.goto(BASE, { waitUntil: "networkidle" });
await seed(page, { photo: TINY_GIF, tenure: "5plus", shots: ["volley"] });
await page.reload({ waitUntil: "networkidle" });

// --- form ---
await page.goto(BASE + "#/profile", { waitUntil: "networkidle" });
await page.waitForSelector("#view-profile:not(.hidden) label.upload");

const formCopy = await page.evaluate(() => ({
  tenureLabels: [...document.querySelectorAll('input[name="tenure"]')].map((el) => ({
    value: el.value,
    text: el.parentElement.textContent.trim()
  })),
  shotsLabels: [...document.querySelectorAll('input[name="shots"]')].map((el) => ({
    value: el.value,
    text: el.parentElement.textContent.trim()
  })),
  strengthsLegend: [...document.querySelectorAll("legend")].map((el) => el.textContent.trim()).find((t) => /חוזקות|מכה/.test(t)),
  tenureChecked: (document.querySelector('input[name="tenure"]:checked') || {}).value || ""
}));
console.log("FORM", formCopy);
assert(formCopy.tenureLabels.map((x) => x.text).join("|") === "פחות משנה|1–2 שנים|2–3 שנים|מעל 3 שנים", "tenure options are the new set");
assert(formCopy.tenureLabels.some((x) => x.value === "2-3"), "new 2–3 years value exists");
assert(formCopy.tenureChecked === "3plus", "old 5plus maps to מעל 3 שנים in the form");
assert(/חוזקות/.test(formCopy.strengthsLegend || ""), "form legend is חוזקות");
assert(!/מכה חזקה/.test(formCopy.strengthsLegend || ""), "form legend is no longer מכה חזקה");
assert(formCopy.shotsLabels.some((x) => x.value === "volley" && x.text === "וולי/רשת"), "volley option is וולי/רשת");
assert(formCopy.shotsLabels.some((x) => x.value === "kicksmash" && x.text === "קיק סמאש"), "kick smash option exists");

await clickOpensChooser(page, 'label.upload[for="video-file"]', "form video upload");
await clickOpensChooser(page, 'label.upload[for="photo-file"]', "form photo upload");

// --- card (owner) ---
await page.goto(BASE + "#/card", { waitUntil: "networkidle" });
await page.waitForSelector("#view-card:not(.hidden) .ut-card");
const cardCopy = await page.evaluate(() => ({
  body: document.getElementById("card-root")?.innerText || "",
  tenure: [...document.querySelectorAll(".ut-card .ut-stat, .ut-card li, .ut-card .pill, .ut-card p, .ut-card span")]
    .map((el) => el.textContent.trim())
    .filter((t) => /ותק|שנה|שנים/.test(t)),
  shotsHeading: [...document.querySelectorAll(".ut-section")].map((el) => el.textContent.trim()),
  shotPills: [...document.querySelectorAll(".ut-shots .pill, .shot-pills .pill")].map((el) => el.textContent.trim()),
  photoPrompt: !!document.getElementById("card-photo-upload-label")
}));
console.log("CARD", cardCopy);
assert(cardCopy.body.includes("מעל 3 שנים"), "card maps old 5plus tenure to מעל 3 שנים");
assert(!cardCopy.body.includes("5+ שנים") && !cardCopy.body.includes("3–5 שנים"), "card does not show old tenure labels");
assert(cardCopy.shotsHeading.includes("חוזקות"), "card section is חוזקות");
assert(!cardCopy.shotsHeading.includes("מכה חזקה"), "card section is no longer מכה חזקה");
assert(cardCopy.shotPills.includes("וולי/רשת"), "old volley value displays as וולי/רשת");
assert(cardCopy.photoPrompt, "owner card shows photo re-upload control");
await clickOpensChooser(page, "#card-photo-upload-label", "card photo upload");

// no JS errors already collected via pageerror
await browser.close();

if (failures.length) {
  console.error("\n" + failures.length + " FAILURES");
  failures.forEach((f) => console.error(" -", f));
  process.exit(1);
}
console.log("\nALL V9 TESTS PASSED");
