import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../../lib/auth";
import { csvDocument, slugifyAscii } from "../../../lib/csv.mjs";
import { engagementModeForLead } from "../../../lib/engagement-mode";

type ExportRow = {
  company?: string;
  url?: string;
  channelType?: string;
  engagementMode?: string;
  opportunityType?: string;
  actionType?: string;
  score?: number;
  status?: string;
  stage?: string;
  email?: string;
  telegram?: string;
  contact?: string;
  nextAction?: string;
  pricingSummary?: string;
  placementRequirements?: string;
  registrationUrl?: string;
  revenueCents?: number;
  createdAt?: string;
};

const csvHeader = [
  "company",
  "url",
  "channel_type",
  "engagement_mode",
  "score",
  "status",
  "stage",
  "email",
  "telegram",
  "contact",
  "next_action",
  "pricing_summary",
  "placement_requirements",
  "registration_url",
  "revenue_cents",
  "created_at",
];

function database() {
  return (env as unknown as { DB?: D1Database }).DB;
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const db = database();
  const productId = new URL(request.url).searchParams.get("productId") || "";
  if (!db || !productId) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const product = await db
    .prepare("SELECT id, name FROM products WHERE id=? AND workspace_id=?")
    .bind(productId, auth.workspaceId)
    .first<{ id: string; name?: string }>();
  if (!product) {
    return Response.json({ error: "product_not_found" }, { status: 404 });
  }
  const result = await db
    .prepare(
      `SELECT company, url, channel_type as channelType,
       engagement_mode as engagementMode, opportunity_type as opportunityType,
       action_type as actionType, commercial_model as commercialModel,
       score, status, stage, email, telegram,
       contact, next_action as nextAction, pricing_summary as pricingSummary,
       placement_requirements as placementRequirements,
       registration_url as registrationUrl, revenue_cents as revenueCents,
       created_at as createdAt
       FROM prospects WHERE product_id=? AND workspace_id=?
         AND record_kind='channel'
       ORDER BY score DESC, company ASC`,
    )
    .bind(productId, auth.workspaceId)
    .all();
  const rows = result.results as ExportRow[];
  const csv = csvDocument([
    csvHeader,
    ...rows.map((row) => [
      row.company || "",
      row.url || "",
      row.channelType || "",
      engagementModeForLead(row),
      row.score ?? 0,
      row.status || "",
      row.stage || "",
      row.email || "",
      row.telegram || "",
      row.contact || "",
      row.nextAction || "",
      row.pricingSummary || "",
      row.placementRequirements || "",
      row.registrationUrl || "",
      row.revenueCents ?? 0,
      row.createdAt || "",
    ]),
  ]);
  const filename = `${slugifyAscii(product.name, "prospects")}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
