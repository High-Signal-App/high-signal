// Plan 0009 — brief email transport over Cloudflare Email Routing's native
// `send_email` binding. No third-party API. The worker constructs a minimal
// multipart/alternative MIME and hands it to the binding; Cloudflare relays it
// using the zone's outbound DKIM/SPF.
//
// Constraint: Cloudflare's binding only relays to addresses Email Routing
// recognises as valid destinations. For an open daily-brief use case the
// sending domain must be configured for outbound on Cloudflare, with the
// recipient either (a) listed in `allowed_destination_addresses` on the
// binding, or (b) accepted by the zone's outbound policy. If neither holds,
// the binding throws and the cron records `status='failed'` with the raw
// reason — visible on /admin/delivery.

import { EmailMessage } from "cloudflare:email";

export interface EmailEnv {
  SEND_EMAIL?: SendEmailBinding;
  EMAIL_FROM?: string;
}

interface SendEmailBinding {
  send(message: EmailMessage): Promise<void>;
}

export interface BriefEmailBody {
  sections: Array<{ title: string; items: Array<{ text: string; links: string[] }> }>;
}

export interface SendBriefArgs {
  to: string;
  subject: string;
  briefDate: string;
  region: string;
  body: BriefEmailBody;
}

export interface SendResult {
  ok: boolean;
  reason?: string;
  providerMessageId?: string;
}

export async function sendBriefEmail(env: EmailEnv, args: SendBriefArgs): Promise<SendResult> {
  if (!env.SEND_EMAIL) {
    return { ok: false, reason: "no_send_email_binding" };
  }
  const from = env.EMAIL_FROM ?? "brief@high-signal.app";
  const raw = buildMime({
    from,
    to: args.to,
    subject: args.subject,
    briefDate: args.briefDate,
    region: args.region,
    html: renderHtml(args),
    text: renderText(args),
  });
  try {
    await env.SEND_EMAIL.send(new EmailMessage(from, args.to, raw));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `transport_${String(e).slice(0, 200)}` };
  }
}

// ─── MIME assembly ────────────────────────────────────────────────────────
// multipart/alternative with text/plain + text/html. Both bodies base64-encoded
// so UTF-8 in claim text never breaks the encoding. Headers stay ASCII.

interface MimeArgs {
  from: string;
  to: string;
  subject: string;
  briefDate: string;
  region: string;
  html: string;
  text: string;
}

function buildMime(m: MimeArgs): string {
  const boundary = `hs-${crypto.randomUUID()}`;
  const date = new Date().toUTCString();
  const subject = encodeHeaderValue(m.subject);
  const messageId = `<${crypto.randomUUID()}@high-signal.app>`;
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `X-High-Signal-Brief-Date: ${m.briefDate}`,
    `X-High-Signal-Region: ${m.region}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const textPart = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    chunkBase64(m.text),
  ];
  const htmlPart = [
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: base64`,
    ``,
    chunkBase64(m.html),
  ];
  return [
    ...headers,
    ``,
    ...textPart,
    ...htmlPart,
    `--${boundary}--`,
    ``,
  ].join("\r\n");
}

// RFC 5322 encoded-word for non-ASCII subjects. If the subject is pure ASCII
// we leave it alone (cleaner). Otherwise wrap in =?utf-8?B?...?=.
function encodeHeaderValue(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  return `=?utf-8?B?${btoa(unescape(encodeURIComponent(s)))}?=`;
}

// Base64-encode a UTF-8 string and break it into 76-char lines per RFC 2045.
function chunkBase64(s: string): string {
  const encoded = btoa(unescape(encodeURIComponent(s)));
  const out: string[] = [];
  for (let i = 0; i < encoded.length; i += 76) {
    out.push(encoded.slice(i, i + 76));
  }
  return out.join("\r\n");
}

// ─── Body rendering (unchanged from earlier iteration) ────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow http(s) hrefs in transactional email anchors. Other schemes
// (javascript:, data:, vbscript:, file:, mailto: with embedded params) get
// dropped — we render the plain-text URL without a link instead.
function safeHref(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function renderHtml(args: SendBriefArgs): string {
  const sectionsHtml = args.body.sections
    .map((s) => {
      const items = s.items
        .map(
          (i) =>
            `<li style="margin-bottom:8px"><span>${escapeHtml(i.text)}</span>${
              i.links.length
                ? ` <span style="color:#666">[${i.links
                    .slice(0, 2)
                    .map((l) => {
                      const href = safeHref(l);
                      return href
                        ? `<a href="${escapeHtml(href)}" style="color:#0aa">source</a>`
                        : `<span>source</span>`;
                    })
                    .join(", ")}]</span>`
                : ""
            }</li>`,
        )
        .join("");
      return `<h2 style="font-size:14px;letter-spacing:0.18em;text-transform:uppercase;color:#888;margin-top:24px">${escapeHtml(s.title)}</h2><ul style="padding-left:18px;margin:8px 0">${items}</ul>`;
    })
    .join("");
  return `<!doctype html><html><body style="font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:24px"><div style="max-width:640px;margin:0 auto"><div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:#888">High Signal</div><div style="font-size:11px;color:#666;margin-top:4px">${escapeHtml(args.briefDate)} · ${escapeHtml(args.region)}</div>${sectionsHtml}<p style="margin-top:32px;font-size:11px;color:#666">Manage delivery: https://high-signal.app/settings/delivery</p></div></body></html>`;
}

function renderText(args: SendBriefArgs): string {
  const sections = args.body.sections
    .map((s) => {
      const items = s.items
        .map(
          (i) =>
            `- ${i.text}${i.links.length ? ` [${i.links.slice(0, 2).join(", ")}]` : ""}`,
        )
        .join("\n");
      return `${s.title.toUpperCase()}\n${items}`;
    })
    .join("\n\n");
  return `HIGH SIGNAL\n${args.briefDate} · ${args.region}\n\n${sections}\n\nManage delivery: https://high-signal.app/settings/delivery`;
}
