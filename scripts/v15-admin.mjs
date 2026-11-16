/* Test-only Admin helpers for v15. Reads SUPABASE_ACCESS_TOKEN from the
   environment (or SUPABASE_SERVICE_ROLE_KEY). Never logs or writes secrets. */
const PROJECT = "ehcsbtbcelfoxfgraytl";
const SUPABASE_URL = "https://ehcsbtbcelfoxfgraytl.supabase.co";
export const TEST_EMAIL = process.env.PADEL_TEST_EMAIL || "padel.test.v15@example.com";

let serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
let resolved = false;

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "Aa1!";
}

async function loadServiceRoleKey() {
  if (resolved) return serviceRoleKey;
  if (serviceRoleKey) {
    resolved = true;
    return serviceRoleKey;
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("Set SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY in the environment");
  const res = await fetch("https://api.supabase.com/v1/projects/" + PROJECT + "/api-keys?reveal=true", {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" }
  });
  if (!res.ok) throw new Error("Management API api-keys HTTP " + res.status);
  const keys = await res.json();
  const list = Array.isArray(keys) ? keys : [];
  const service = list.find((k) => k && (k.id === "service_role" || k.name === "service_role"));
  const value = service && (service.api_key || service.apiKey);
  if (!value) throw new Error("service_role key not found in Management API response");
  serviceRoleKey = value;
  resolved = true;
  return serviceRoleKey;
}

async function adminFetch(path, opts = {}) {
  const key = await loadServiceRoleKey();
  const headers = Object.assign({
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json"
  }, opts.headers || {});
  const res = await fetch(SUPABASE_URL + path, Object.assign({}, opts, { headers }));
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (err) { body = text; }
  return { ok: res.ok, status: res.status, body };
}

function errMsg(res, fallback) {
  const b = res && res.body;
  if (b && typeof b === "object") return b.message || b.error_description || b.error || fallback;
  if (typeof b === "string" && b) return b.slice(0, 200);
  return fallback + " HTTP " + (res && res.status);
}

export async function ensureUser(email) {
  const addr = String(email || TEST_EMAIL).toLowerCase();
  const password = process.env.PADEL_TEST_PASSWORD || randomPassword();
  const created = await adminFetch("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email: addr,
      password: password,
      email_confirm: true,
      user_metadata: { purpose: "padel-automated-test" }
    })
  });
  if (created.ok && created.body && created.body.id) {
    const user = { id: created.body.id, email: addr, password: password };
    if (/@example\.com$/i.test(addr)) await setLegalAcceptance(user.id).catch(function () {});
    return user;
  }
  const listed = await adminFetch("/auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
  if (!listed.ok) throw new Error("list users failed: " + errMsg(listed, "list"));
  const users = (listed.body && (listed.body.users || listed.body)) || [];
  const existing = users.find((u) => u && String(u.email || "").toLowerCase() === addr);
  if (!existing) throw new Error("could not create or find test user: " + errMsg(created, "create"));
  const updated = await adminFetch("/auth/v1/admin/users/" + existing.id, {
    method: "PUT",
    body: JSON.stringify({ password: password, email_confirm: true })
  });
  if (!updated.ok) throw new Error("could not reset test user password: " + errMsg(updated, "update"));
  const user = { id: existing.id, email: addr, password: password };
  if (/@example\.com$/i.test(addr)) await setLegalAcceptance(user.id).catch(function () {});
  return user;
}

export async function ensureTestUser() {
  return ensureUser(TEST_EMAIL);
}

export async function deleteTestUser(userId) {
  if (!userId) return;
  await adminFetch("/rest/v1/cards?user_id=eq." + encodeURIComponent(userId), { method: "DELETE" });
  await adminFetch("/rest/v1/admin_actions?or=(target_user_id.eq." + userId + ",admin_id.eq." + userId + ")", { method: "DELETE" });
  await adminFetch("/rest/v1/admins?user_id=eq." + userId, { method: "DELETE" });
  await adminFetch("/auth/v1/admin/users/" + userId, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: "none" })
  });
  let res = await adminFetch("/auth/v1/admin/users/" + userId, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    res = await adminFetch("/auth/v1/admin/users/" + userId, { method: "DELETE" });
  }
  if (!res.ok && res.status !== 404) throw new Error("delete test user failed: " + errMsg(res, "delete") + " HTTP " + res.status);
}

export async function deleteCard(userId) {
  if (!userId) return;
  const res = await adminFetch("/rest/v1/cards?user_id=eq." + encodeURIComponent(userId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("delete card failed: " + errMsg(res, "delete card"));
}

export async function upsertCard(userId, card) {
  const res = await adminFetch("/rest/v1/cards", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ user_id: userId, card: card, updated_at: new Date().toISOString() })
  });
  if (!res.ok) throw new Error("upsert card failed: " + errMsg(res, "upsert"));
  return res.body;
}

export async function getCard(userId) {
  const res = await adminFetch("/rest/v1/cards?user_id=eq." + encodeURIComponent(userId) + "&select=card,updated_at", {
    method: "GET",
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error("get card failed: " + errMsg(res, "get card"));
  const rows = Array.isArray(res.body) ? res.body : [];
  return rows[0] || null;
}

export const DEVICE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: "he-IL",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
};


export async function addAdmin(email, userId) {
  const res = await adminFetch("/rest/v1/admins", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ email: String(email).toLowerCase(), user_id: userId || null })
  });
  if (!res.ok && res.status !== 409) throw new Error("addAdmin failed: " + errMsg(res, "add admin"));
}

export async function removeAdmin(email) {
  const res = await adminFetch("/rest/v1/admins?email=eq." + encodeURIComponent(String(email).toLowerCase()), {
    method: "DELETE"
  });
  if (!res.ok && res.status !== 404) throw new Error("removeAdmin failed: " + errMsg(res, "remove admin"));
}

export async function deleteDisabledCard(cardId) {
  if (!cardId) return;
  const res = await adminFetch("/rest/v1/disabled_cards?card_id=eq." + encodeURIComponent(cardId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("delete disabled card failed: " + errMsg(res, "delete disabled"));
}


export async function listAuthUsers() {
  const res = await adminFetch("/auth/v1/admin/users?page=1&per_page=200", { method: "GET" });
  if (!res.ok) throw new Error("list users failed: " + errMsg(res, "list"));
  const users = (res.body && (res.body.users || res.body)) || [];
  return Array.isArray(users) ? users : [];
}

// Removes only disposable @example.com padel.test accounts. Never touches real users.
export async function cleanupExampleTestUsers(pattern) {
  const re = pattern instanceof RegExp ? pattern : /padel\.test\.v16/i;
  const users = await listAuthUsers();
  const matches = users.filter((u) => {
    const email = String(u && u.email || "").toLowerCase();
    return email.endsWith("@example.com") && re.test(email);
  });
  for (const u of matches) {
    await removeAdmin(u.email).catch(function () {});
    await deleteTestUser(u.id);
  }
  return matches.length;
}


export async function setLegalAcceptance(userId, opts = {}) {
  if (!userId) return;
  const body = {
    user_id: userId,
    terms_version: opts.version || "2026-11-16",
    accepted_at: opts.acceptedAt || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  if (opts.media) body.media_consent_at = opts.mediaAt || new Date().toISOString();
  const res = await adminFetch("/rest/v1/legal_acceptances", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body)
  });
  if (!res.ok && res.status !== 409) throw new Error("setLegalAcceptance failed: " + errMsg(res, "legal"));
}

export async function clearLegalAcceptance(userId) {
  if (!userId) return;
  const res = await adminFetch("/rest/v1/legal_acceptances?user_id=eq." + encodeURIComponent(userId), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("clearLegalAcceptance failed: " + errMsg(res, "clear legal"));
}

// Test-only: remove certified raters/ratings created for disposable @example.com accounts.
// Never deletes the seeded Hebrew-name raters that have no email.
export async function cleanupCertifiedTestData() {
  const ratersRes = await adminFetch("/rest/v1/certified_raters?select=id,email,full_name", { method: "GET" });
  if (!ratersRes.ok) throw new Error("list raters failed: " + errMsg(ratersRes, "raters"));
  const raters = Array.isArray(ratersRes.body) ? ratersRes.body : [];
  const testRaters = raters.filter((r) => {
    const email = String(r && r.email || "").toLowerCase();
    const name = String(r && r.full_name || "");
    if (email.endsWith("@example.com") && /padel\.test/.test(email)) return true;
    if (/v20|בדיקה/.test(name) && !/עמית נאור|אהרון|דניאל|נועם|סער|עמית שחר/.test(name)) return true;
    return false;
  });
  for (const r of testRaters) {
    await adminFetch("/rest/v1/rating_requests?rater_id=eq." + encodeURIComponent(r.id), { method: "DELETE" });
    await adminFetch("/rest/v1/certified_ratings?rater_id=eq." + encodeURIComponent(r.id), { method: "DELETE" });
    await adminFetch("/rest/v1/certified_raters?id=eq." + encodeURIComponent(r.id), { method: "DELETE" });
  }
  return testRaters.length;
}
