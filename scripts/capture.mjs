import puppeteer from "/tmp/pw/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://127.0.0.1:8765/";
const OUT = "/workspace/padel-card/screens";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome-stable";
const PHOTO = "/tmp/maya-photo.jpg";

fs.mkdirSync(OUT, { recursive: true });

async function snap(name) {
  await page.evaluate(() => document.getElementById("toast")?.classList.remove("show"));
  await page.mouse.move(0, 0);
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: path.join(OUT, name), fullPage: true });
}

for (const f of fs.readdirSync(OUT)) {
  if (f.endsWith(".png")) fs.unlinkSync(path.join(OUT, f));
}

const pageErrors = [];
const consoleErrors = [];
const otherErrors = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"]
});

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);

page.on("pageerror", (err) => pageErrors.push(String(err)));
page.on("error", (err) => otherErrors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

await page.goto(BASE, { waitUntil: "networkidle0", timeout: 30000 });
await page.evaluate(() => {
  localStorage.clear();
});
await page.reload({ waitUntil: "networkidle0" });

await page.waitForSelector("#start-quiz");
await page.click("#start-quiz");
await page.waitForSelector("#view-quiz:not(.hidden) .option");
await page.evaluate(() => document.fonts && document.fonts.ready);

const picks = [2, 2, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1];
for (let i = 0; i < picks.length; i++) {
  await page.waitForFunction(
    (step) => {
      const t = document.getElementById("quiz-step")?.textContent || "";
      return t === `שאלה ${step} מתוך 12`;
    },
    {},
    i + 1
  );
  const options = await page.$$("#options .option");
  if (!options[picks[i]]) throw new Error("Missing option at question " + (i + 1));
  await options[picks[i]].click();
  if (i < picks.length - 1) {
    await page.waitForFunction(
      (step) => {
        const t = document.getElementById("quiz-step")?.textContent || "";
        return t === `שאלה ${step} מתוך 12`;
      },
      {},
      i + 2
    );
  }
}

await page.waitForSelector("#view-result:not(.hidden)");
const resultLetter = await page.$eval("#result-letter", (el) => el.textContent.trim());
console.log("RESULT", resultLetter, await page.$eval("#result-score", (el) => el.textContent.trim()));

await page.click("#goto-profile");
await page.waitForSelector("#view-profile:not(.hidden) #name");

const photoInput = await page.$("#photo-file");
await photoInput.uploadFile(PHOTO);
await page.waitForSelector("#photo-preview.has-photo");

await page.click("#name", { clickCount: 3 });
await page.type("#name", "מאיה שגב");
await page.click("#age", { clickCount: 3 });
await page.type("#age", "31");
await page.click('label:has(input[name="gender"][value="female"])');
await page.click('label:has(input[name="hand"][value="right"])');
await page.click('label:has(input[name="side"][value="left"])');
await page.click('label:has(input[name="competitor"][value="no"])');
await page.select("#region", "telaviv");
await page.type("#court-input", "פאדל יד אליהו");
await page.click("#add-court");
await page.type("#court-input", "פאדל פארק הירקון");
await page.click("#add-court");
await page.click('label:has(input[name="frequency"][value="2-3"])');
await page.click('label:has(input[name="tenure"][value="1-2"])');
await page.click('label:has(input[name="style"][value="both"])');
for (const shot of ["bandeja", "volley", "lob"]) {
  await page.click(`label:has(input[name="shots"][value="${shot}"])`);
}
await page.type("#playtomic", "3.25");
await page.type("#association", "3.5");
await page.type("#phone", "0501234567");
await page.click('label:has(input[name="hasPartner"][value="yes"])');
await page.waitForSelector("#partner-search-wrap:not(.hidden)");
await page.click("#partner-query", { clickCount: 3 });
await page.type("#partner-query", "מיכל");
await page.waitForFunction(() => {
  return [...document.querySelectorAll("#partner-results .player-hit")].some((b) => b.textContent.includes("מיכל לוי"));
});
const hits = await page.$$("#partner-results .player-hit");
for (const hit of hits) {
  const text = await page.evaluate((el) => el.textContent, hit);
  if (text.includes("מיכל לוי")) {
    await hit.click();
    break;
  }
}
await page.waitForSelector("#partner-selected:not(.hidden)");
await page.type("#video-link", "https://youtu.be/padel-maya");
await page.click("#add-link");
await page.waitForSelector("#video-list .video-item");
await snap("01-profile.png");

await page.evaluate(() => document.getElementById("profile-form").requestSubmit());
await page.waitForSelector("#view-card:not(.hidden) #card-name");
await page.evaluate(() => document.fonts && document.fonts.ready);
await new Promise((r) => setTimeout(r, 300));
await snap("02-card.png");

const cardName = await page.$eval("#card-name", (el) => el.textContent.trim());
const cardLevel = await page.$eval("#card-level-letter", (el) => el.textContent.trim());
const hasPhoto = await page.$eval("#card-avatar", (el) => el.classList.contains("has-photo"));
const partnerText = await page.$eval("#card-has-partner", (el) => el.textContent.trim());
const extrasText = await page.$eval("#card-extras", (el) => el.innerText.replace(/\s+/g, " ").trim());
const contactText = await page.$eval("#card-contact", (el) => el.innerText.replace(/\s+/g, " ").trim());
const waBtn = await page.$eval("#card-contact a.btn-contact", (el) => el.getAttribute("href"));
console.log("CARD", cardName, cardLevel, "photo", hasPhoto, "partner", partnerText);
console.log("EXTRAS", extrasText);
console.log("CONTACT", contactText, waBtn);
await page.click("#open-pair");
await page.waitForSelector("#view-pair:not(.hidden) #pair-grid .pair-col");
await new Promise((r) => setTimeout(r, 350));
await snap("03-pair.png");
const pairTitle = await page.$eval("#pair-title", (el) => el.textContent.trim());
const pairLetter = await page.$eval("#pair-level-letter", (el) => el.textContent.trim());
const pairNames = await page.$eval("#pair-names", (el) => el.textContent.trim());
console.log("PAIR", pairLetter, pairTitle, pairNames);

await page.click("#pair-open-share");
await page.waitForSelector("#view-share:not(.hidden) #share-opt-pair");
await new Promise((r) => setTimeout(r, 300));
await snap("04-share.png");

const shareSingle = await page.$eval("#share-single-meta", (el) => el.textContent.trim());
const sharePair = await page.$eval("#share-pair-meta", (el) => el.textContent.trim());
const pairSelected = await page.$eval("#share-opt-pair", (el) => el.classList.contains("selected"));
const singleUrl = await page.evaluate(() => {
  document.getElementById("share-opt-single").click();
  return document.getElementById("share-url").textContent.trim();
});
const pairUrl = await page.evaluate(() => {
  document.getElementById("share-opt-pair").click();
  return document.getElementById("share-url").textContent.trim();
});
console.log("SHARE", { shareSingle, sharePair, pairSelected, singleUrl: singleUrl.slice(0, 80), pairUrl: pairUrl.slice(0, 80) });

async function openPublic(url, label) {
  const p2 = await browser.newPage();
  const errs = [];
  p2.on("pageerror", (err) => errs.push(String(err)));
  p2.on("console", (msg) => { if (msg.type() === "error") errs.push("console: " + msg.text()); });
  await p2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p2.goto(url, { waitUntil: "networkidle0" });
  const info = await p2.evaluate(() => {
    const view = [...document.querySelectorAll(".view")].find((v) => !v.classList.contains("hidden"))?.id;
    return {
      view,
      banner: !document.getElementById("public-banner")?.classList.contains("hidden") ||
              !document.getElementById("pair-banner")?.classList.contains("hidden"),
      name: document.getElementById("card-name")?.textContent.trim() || "",
      pairNames: document.getElementById("pair-names")?.textContent.trim() || "",
      pairLetter: document.getElementById("pair-level-letter")?.textContent.trim() || "",
      cols: document.querySelectorAll("#pair-grid .pair-col").length,
      photo: document.getElementById("card-avatar")?.classList.contains("has-photo") || false,
      extras: document.getElementById("card-extras")?.innerText.replace(/\s+/g, " ").trim() || "",
      contact: document.getElementById("card-contact")?.innerText.replace(/\s+/g, " ").trim() || "",
      wa: document.querySelector("#card-contact a.btn-contact, .pair-col .btn-contact")?.getAttribute("href") || "",
      pairExtras: [...document.querySelectorAll("#pair-grid .card-extras")].map((el) => el.innerText.replace(/\s+/g, " ").trim())
    };
  });
  console.log("PUBLIC_" + label, JSON.stringify(info));
  if (errs.length) console.log("PUBLIC_ERR_" + label, JSON.stringify(errs));
  await p2.close();
  return { info, errs };
}

const pubSingle = await openPublic(singleUrl, "SINGLE");
const pubPair = await openPublic(pairUrl, "PAIR");

console.log("PAGE_ERRORS", JSON.stringify(pageErrors));
console.log("CONSOLE_ERRORS", JSON.stringify(consoleErrors));
console.log("OTHER_ERRORS", JSON.stringify(otherErrors));

await browser.close();

let code = 0;
if (pageErrors.length || otherErrors.length) code = 2;
if (pubSingle.errs.length || pubPair.errs.length) code = 2;
if (pubSingle.info.view !== "view-card" || pubSingle.info.name !== "מאיה שגב") code = 3;
if (!pubSingle.info.extras.includes("תל אביב") || !pubSingle.info.wa.includes("wa.me/972501234567")) code = 3;
if (pubPair.info.view !== "view-pair" || pubPair.info.cols !== 2 || !pubPair.info.pairNames.includes("מיכל לוי")) code = 3;
if (!pubPair.info.pairExtras.some((t) => t.includes("תל אביב"))) code = 3;
if (!hasPhoto || partnerText.indexOf("מיכל") === -1) code = 3;
if (!extrasText.includes("תל אביב") || !waBtn.includes("972501234567")) code = 3;
process.exitCode = code;
