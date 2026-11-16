import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = [
  "https://padelcard.app",
  "https://www.padelcard.app",
  "https://padel-card.onrender.com",
  "http://127.0.0.1:8876",
  "http://localhost:8876",
];

function corsHeaders(origin: string | null) {
  const allow = origin && (ORIGINS.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
    ? origin
    : ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function skipAddress(email: string | null | undefined) {
  const em = String(email || "").trim().toLowerCase();
  if (!em || !em.includes("@")) return true;
  if (em.endsWith("@example.com") || em.endsWith(".example.com")) return true;
  return false;
}

function escapeHtml(str: string) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brandedEmail(opts: {
  title: string;
  lead: string;
  message?: string | null;
  ctaLabel: string;
  ctaUrl: string;
  foot: string;
}) {
  const msg = opts.message
    ? `<p style="margin:16px 0 0;padding:12px 14px;background:#1a2418;border-radius:14px;border:1px solid rgba(240,193,74,0.25);color:#f3f7f1;font-size:15px;line-height:1.6;">${escapeHtml(opts.message)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#07120e;font-family:Heebo,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 16px 36px;direction:rtl;text-align:right;">
    <div style="display:inline-block;background:#c8ff3c;color:#08140c;font-weight:800;border-radius:8px;padding:4px 10px;margin-bottom:16px;">Padel Card</div>
    <h1 style="margin:0 0 10px;color:#ffe08a;font-size:22px;line-height:1.35;">${escapeHtml(opts.title)}</h1>
    <p style="margin:0;color:#f3f7f1;font-size:16px;line-height:1.65;">${escapeHtml(opts.lead)}</p>
    ${msg}
    <p style="margin:24px 0 0;">
      <a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;background:linear-gradient(180deg,#ffe7a3,#f0c14a);color:#3a2808;text-decoration:none;font-weight:800;padding:12px 20px;border-radius:999px;">${escapeHtml(opts.ctaLabel)}</a>
    </p>
    <p style="margin:28px 0 0;color:#9aa79a;font-size:12px;line-height:1.5;">${escapeHtml(opts.foot)}</p>
  </div>
</body>
</html>`;
}

async function recordEmail(
  supabase: ReturnType<typeof createClient>,
  requestId: string | null,
  status: "sent" | "failed" | "skipped",
) {
  if (!requestId) return;
  try {
    await supabase.rpc("record_rating_request_email", {
      p_request_id: requestId,
      p_status: status,
    });
  } catch {
    // Recording is best-effort; never fail the mail response on it.
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  const auth = req.headers.get("authorization") || "";
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return json({ error: "not authorized" }, 401, origin);
  }

  let body: { request_id?: string; card_id?: string; kind?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400, origin);
  }
  const requestId = String(body.request_id || "").trim();
  const cardId = String(body.card_id || "").trim();
  const kind = String(body.kind || "new");
  if (!["new", "done", "declined", "rated"].includes(kind)) {
    return json({ error: "invalid kind" }, 400, origin);
  }
  if (kind === "rated" && !cardId) return json({ error: "missing card_id" }, 400, origin);
  if (kind !== "rated" && !requestId) return json({ error: "missing request_id" }, 400, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  if (!supabaseUrl || !supabaseAnon) {
    return json({ error: "not configured" }, 503, origin);
  }

  const supabase = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: auth } },
  });

  let row: {
    id?: string;
    status?: string;
    message?: string | null;
    player_name?: string | null;
    player_level?: string | null;
    rater_name?: string | null;
    rater_email?: string | null;
    requester_email?: string | null;
    card_id?: string;
  };

  if (kind === "rated") {
    const { data, error } = await supabase.rpc("get_certified_rating_notify_payload", {
      p_card_id: cardId,
    });
    if (error) {
      const status = /not authorized/i.test(error.message || "") ? 403 : 400;
      return json({ error: error.message || "lookup failed" }, status, origin);
    }
    row = data as typeof row;
  } else {
    const { data, error } = await supabase.rpc("get_rating_request_notify_payload", {
      p_id: requestId,
    });
    if (error) {
      const status = /not authorized/i.test(error.message || "") ? 403 : 400;
      return json({ error: error.message || "lookup failed" }, status, origin);
    }
    row = data as typeof row;
  }

  const from = "Padel Card <login@padelcard.app>";
  const appUrl = "https://padelcard.app";
  const rateUrl = row.id ? `${appUrl}/#/rate/${row.id}` : `${appUrl}/#/card`;
  const cardUrl = `${appUrl}/#/card`;
  const playerName = row.player_name || "שחקן";
  const raterName = row.rater_name || "מוסמך";
  let to = "";
  let subject = "";
  let html = "";

  if (kind === "new") {
    to = row.rater_email || "";
    subject = `${playerName} מבקש ממך דירוג מוסמך`;
    html = brandedEmail({
      title: `${playerName} מבקש ממך דירוג מוסמך`,
      lead: `${playerName} ביקש שתדרגו את הרמה שלו בכרטיס שחקן פאדל` +
        (row.player_level ? ` (רמה נוכחית לפי השאלון: ${row.player_level})` : "") + ".",
      message: row.message || null,
      ctaLabel: "לדירוג הכרטיס",
      ctaUrl: rateUrl,
      foot: "התקבלה בקשת דירוג מוסמך ב־Padel Card. אם לא ציפיתם למייל הזה, אפשר להתעלם ממנו.",
    });
  } else if (kind === "done" || kind === "rated") {
    to = row.requester_email || "";
    subject = `${raterName} דירג אותך`;
    html = brandedEmail({
      title: `${raterName} דירג אותך`,
      lead: `${raterName} דירג את הכרטיס שלכם. הדירוג המוסמך מופיע עכשיו בכרטיס.`,
      ctaLabel: "לצפייה בכרטיס",
      ctaUrl: cardUrl,
      foot: "הודעה אוטומטית מ־Padel Card.",
    });
  } else {
    to = row.requester_email || "";
    subject = `${raterName} דחה את בקשת הדירוג`;
    html = brandedEmail({
      title: "בקשת הדירוג נדחתה",
      lead: `${raterName} דחה את בקשת הדירוג המוסמך. אפשר לבקש ממוסמך אחר.`,
      ctaLabel: "לכרטיס שלי",
      ctaUrl: cardUrl,
      foot: "הודעה אוטומטית מ־Padel Card.",
    });
  }

  const trackId = kind === "rated" ? "" : requestId;

  if (skipAddress(to)) {
    await recordEmail(supabase, trackId || null, "skipped");
    return json({ ok: true, skipped: true, reason: "test_or_empty_address" }, 200, origin);
  }
  if (!resendKey) {
    await recordEmail(supabase, trackId || null, "failed");
    return json({ error: "mail not configured", skipped: true }, 200, origin);
  }

  const sendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + resendKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
  });
  const sendBody = await sendRes.json().catch(() => ({}));
  if (!sendRes.ok) {
    await recordEmail(supabase, trackId || null, "failed");
    return json({ error: "send failed", status: sendRes.status }, 502, origin);
  }
  await recordEmail(supabase, trackId || null, "sent");
  return json({ ok: true, id: sendBody && (sendBody as { id?: string }).id }, 200, origin);
});
