// Builds and publishes the Gumroad landing page for every Chanlyst plan.
//
// Gumroad's checkout is theirs and cannot be restyled, but the product page it
// opens from can be replaced wholesale (`custom_html`), and that is the part a
// buyer actually reads. The default page put the seller's personal name, a
// placeholder cover and a wall of other tiers in front of someone who had
// already chosen one; these pages carry the service's own palette and say one
// thing per page.
//
// The block carries its own background on purpose. Gumroad's shell does not
// follow prefers-color-scheme, so styling for it produced dark cards sitting
// on their white page. One look, whatever their chrome does.
//
// Usage (token needs the edit_products scope):
//   GUMROAD_ACCESS_TOKEN=… node deploy/gumroad-landing.mjs preview
//   GUMROAD_ACCESS_TOKEN=… node deploy/gumroad-landing.mjs publish
//   GUMROAD_ACCESS_TOKEN=… node deploy/gumroad-landing.mjs clear

const API = "https://api.gumroad.com/v2";

/** The service's own tokens, copied from app/globals.css. */
const T = {
  ink: "#14251f",
  muted: "#6f7d77",
  line: "#dce4df",
  paper: "#f2f5f2",
  card: "#ffffff",
  dark: "#102820",
  side: "#0c251d",
  lime: "#c8ff4f",
  green: "#5e7c1f",
};

/**
 * One entry per Gumroad product. `permalink` is the public URL slug and `id`
 * is what the write endpoints take: the preview endpoint accepts either, the
 * PUT accepts only the id and answers "product not found" for a permalink.
 * The tier name has to match the Gumroad variant exactly, or the checkout
 * silently opens on the product's default tier — silently, so it is worth
 * reading the names back from the API rather than assuming them. The monthly
 * Starter tier was called "Untitled" until this was checked, which is what a
 * buyer would have seen on the checkout line.
 */
export const PLANS = [
  {
    permalink: "starter-monthly",
    id: "JxF1u_G0AhkX2gLnT7Wg6g==",
    tier: "Starter",
    recurrence: "monthly",
    name: "Starter",
    price: "$49",
    period: "per month",
    switchTo: { label: "Save with annual billing — $490 a year", url: "/l/starter-annual" },
    limits: ["1 active product", "100 qualified channels a month", "60 contact checks a month", "1 seat"],
  },
  {
    permalink: "starter-annual",
    id: "_RA8QfDOjPHZ_NKLcaPqeg==",
    tier: "Starter",
    recurrence: "yearly",
    name: "Starter",
    price: "$490",
    period: "per year",
    note: "Two months free versus monthly billing.",
    switchTo: { label: "Prefer monthly? $49 a month", url: "/l/starter-monthly" },
    limits: ["1 active product", "100 qualified channels a month", "60 contact checks a month", "1 seat"],
  },
  {
    permalink: "pro-monthly",
    id: "0MMiKqD2O0pLnUEgLMhn-Q==",
    tier: "Pro",
    recurrence: "monthly",
    name: "Pro",
    price: "$99",
    period: "per month",
    popular: true,
    switchTo: { label: "Save with annual billing — $990 a year", url: "/l/pro-annual" },
    limits: ["5 active products", "300 qualified channels a month", "150 contact checks a month", "3 seats"],
  },
  {
    permalink: "pro-annual",
    id: "zLa25yF0bFQvzMc5gSx51w==",
    tier: "Pro",
    recurrence: "yearly",
    name: "Pro",
    price: "$990",
    period: "per year",
    popular: true,
    note: "Two months free versus monthly billing.",
    switchTo: { label: "Prefer monthly? $99 a month", url: "/l/pro-monthly" },
    limits: ["5 active products", "300 qualified channels a month", "150 contact checks a month", "3 seats"],
  },
  {
    permalink: "scale-monthly",
    id: "JdzDyclRR9JZyrCcYK2UOA==",
    tier: "Scale",
    recurrence: "monthly",
    name: "Scale",
    price: "$249",
    period: "per month",
    switchTo: { label: "Save with annual billing — $2,490 a year", url: "/l/scale-annual" },
    limits: ["20 active products", "1 000 qualified channels a month", "350 contact checks a month", "10 seats"],
  },
  {
    permalink: "scale-annual",
    id: "syiCfeIXdjJaOYrWyCPa-A==",
    tier: "Scale",
    recurrence: "yearly",
    name: "Scale",
    price: "$2,490",
    period: "per year",
    note: "Two months free versus monthly billing.",
    switchTo: { label: "Prefer monthly? $249 a month", url: "/l/scale-monthly" },
    limits: ["20 active products", "1 000 qualified channels a month", "350 contact checks a month", "10 seats"],
  },
];

/** Escapes text that goes into HTML. Plan copy is ours, but this is cheap. */
const esc = (value) =>
  String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * The product mark: an open ring, the same one the service uses. The tile is
 * dropped here because the hero it sits on is already dark.
 *
 * The gap is an arc rather than a dashed circle: Gumroad's sanitizer strips
 * `stroke-dasharray` as "not in allowlist", which would have closed the ring
 * and quietly turned the logo into a different one. The arc runs clockwise
 * from 3 o'clock to 12 o'clock, leaving the upper-right quadrant open.
 */
const MARK =
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M 46 32 A 14 14 0 1 1 32 18" fill="none" stroke="#c8ff4f" stroke-width="6"/>' +
  "</svg>";

const STEPS = [
  ["01", "Strategy", "Your paying audience, the offer, and which acquisition motions are worth your time."],
  ["02", "Channels", "Directories, communities, creators, ad networks and partners — each with the reason it fits."],
  ["03", "Outreach", "A drafted message per channel. Nothing sends until you press send."],
];

export function buildLanding(plan) {
  const limits = plan.limits
    .map((item) => `<li>${esc(item)}</li>`)
    .join("");
  const steps = STEPS.map(
    ([n, title, text]) => `
      <article>
        <span>${n}</span>
        <div><h3>${esc(title)}</h3><p>${esc(text)}</p></div>
      </article>`,
  ).join("");

  return `<div class="cl">
  <style>
    .cl{--ink:${T.ink};--muted:${T.muted};--line:${T.line};--paper:${T.paper};--card:${T.card};--dark:${T.dark};--lime:${T.lime};--green:${T.green};
      box-sizing:border-box;margin:0 auto;padding:20px 20px 44px;max-width:840px;
      background:var(--paper);border-radius:24px;
      font-family:ui-sans-serif,-apple-system,"Segoe UI",Arial,sans-serif;color:var(--ink);line-height:1.5}
    .cl *,.cl *::before,.cl *::after{box-sizing:inherit}
    .cl-hero{margin-top:28px;padding:34px 32px;border-radius:22px;background:${T.side};color:#eaf3ee}
    .cl-mark{display:inline-flex;align-items:center;gap:11px;font-size:20px;font-weight:800;letter-spacing:-.6px}
    .cl-mark svg{display:block;width:38px;height:38px}
    .cl-hero h1{margin:22px 0 10px;font-size:35px;line-height:1.12;letter-spacing:-1px}
    .cl-hero p{margin:0;max-width:52ch;color:#b6cabf;font-size:15px}
    .cl-badge{display:inline-block;margin-bottom:2px;padding:5px 11px;border-radius:999px;background:#1d4234;color:var(--lime);font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase}
    .cl-buy{margin:26px 0 0;padding:24px;border:1px solid var(--line);border-radius:18px;background:var(--card);
      display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center}
    .cl-price{display:flex;align-items:baseline;gap:9px}
    .cl-price b{font-size:40px;letter-spacing:-1.5px}
    .cl-price span{color:var(--muted);font-size:14px}
    .cl-note{margin:7px 0 0;color:var(--muted);font-size:12px}
    .cl-cta{display:inline-block;padding:15px 30px;border:0;border-radius:12px;background:var(--lime);color:#1d3313;
      font:800 15px/1 inherit;text-decoration:none;cursor:pointer;white-space:nowrap}
    .cl-cta:hover{filter:brightness(1.05)}
    .cl-switch{display:inline-block;margin-top:14px;color:var(--green);font-size:13px;font-weight:700;text-decoration:none}
    .cl-switch:hover{text-decoration:underline}
    .cl h2{margin:38px 0 14px;font-size:13px;font-weight:850;letter-spacing:.9px;text-transform:uppercase;color:var(--muted)}
    .cl-steps{display:grid;gap:9px}
    .cl-steps article{display:grid;grid-template-columns:46px 1fr;gap:14px;align-items:start;
      padding:17px 19px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
    .cl-steps span{display:grid;place-items:center;width:42px;height:40px;border-radius:11px;background:#eef4e4;color:var(--green);font:800 12px/1 ui-monospace,monospace}
    .cl-steps h3{margin:0 0 4px;font-size:15px}
    .cl-steps p{margin:0;color:var(--muted);font-size:13px}
    .cl-limits{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin:0;padding:0;list-style:none}
    .cl-limits li{padding:13px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);font-size:13px;font-weight:650}
    .cl-limits li::before{content:"✓";margin-right:9px;color:var(--green);font-weight:800}
    .cl-safe{margin-top:34px;padding:19px 21px;border:1px solid #cfe0a8;border-radius:15px;background:#fbffef}
    .cl-safe b{display:block;margin-bottom:5px;font-size:14px}
    .cl-safe p{margin:0;color:#55665d;font-size:13px}
    .cl-foot{margin-top:30px;color:var(--muted);font-size:12px;text-align:center}
    .cl-foot a{color:var(--green);text-decoration:none}
    @media (max-width:640px){
      .cl-hero{padding:26px 21px}.cl-hero h1{font-size:27px}
      .cl-buy{grid-template-columns:1fr}.cl-cta{width:100%;text-align:center}
      .cl-limits{grid-template-columns:1fr}
    }
  </style>

  <section class="cl-hero">
    <div class="cl-mark">${MARK}Chanlyst</div>
    <h1 data-gumroad-field="name">Chanlyst ${esc(plan.name)}</h1>
    <p>Chanlyst finds where your paying customers already are — directories, communities, creators, partners and ad networks — explains why each one fits, and drafts the first message for you to review.</p>
  </section>

  <div class="cl-buy">
    <div>
      ${plan.popular ? '<div class="cl-badge">Most chosen</div>' : ""}
      <div class="cl-price"><b>${esc(plan.price)}</b><span>${esc(plan.period)}</span></div>
      <p class="cl-note">${esc(plan.note || "Cancel any time — access runs to the end of the period you paid for.")}</p>
      <a class="cl-switch" href="${esc(plan.switchTo.url)}">${esc(plan.switchTo.label)}</a>
    </div>
    <a class="cl-cta" data-gumroad-action="buy" data-gumroad-option="${esc(plan.tier)}" data-gumroad-recurrence="${esc(plan.recurrence)}">Subscribe</a>
  </div>

  <h2>How it works</h2>
  <div class="cl-steps">${steps}</div>

  <h2>What ${esc(plan.name)} includes</h2>
  <ul class="cl-limits">${limits}</ul>

  <div class="cl-safe">
    <b>Nothing sends without you</b>
    <p>A single email goes out when you click send. A sequence starts only after you press Start, and it stops itself as soon as a reply arrives. Telegram and LinkedIn open for you to send by hand — Chanlyst never drives your accounts from its own servers.</p>
  </div>

  <p class="cl-foot">Questions before you subscribe? <a href="https://chanlyst.com">chanlyst.com</a></p>
</div>`;
}

async function call(path, method, body, token) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, payload };
}

async function main() {
  const mode = process.argv[2] || "preview";
  const token = process.env.GUMROAD_ACCESS_TOKEN;
  if (!token) throw new Error("GUMROAD_ACCESS_TOKEN не задан");

  for (const plan of PLANS) {
    const html = mode === "clear" ? "" : buildLanding(plan);
    const label = `${plan.permalink.padEnd(16)}`;
    if (mode === "preview") {
      const { status, payload } = await call(
        `/products/${encodeURIComponent(plan.id)}/preview_custom_html`,
        "POST",
        { custom_html: html },
        token,
      );
      const stripped = payload?.sanitization_report;
      console.log(
        `${label} http:${status} предупреждение:${payload?.warning || "нет"} вырезано:${
          stripped ? JSON.stringify(stripped).slice(0, 160) : "нет"
        }`,
      );
      continue;
    }
    const { status, payload } = await call(
      `/products/${encodeURIComponent(plan.id)}`,
      "PUT",
      { custom_html: mode === "clear" ? null : html },
      token,
    );
    console.log(
      `${label} http:${status} ${payload?.success ? "ok" : JSON.stringify(payload).slice(0, 200)} ${
        payload?.landing_url || ""
      }`,
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
