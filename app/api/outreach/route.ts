import { draftOutreach, type OutreachLead, type OutreachProduct } from "../../lib/outreach-core";
import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { workspaceContentLocale } from "../../lib/workspace-locale";
import { enforceUsageLimit } from "../../lib/usage-limits";

// The copy generation lives in app/lib/outreach-core.ts so the pipeline
// prepares its drafts with the same prompt the composer uses.

type OutreachPayload = {
  locale?: "ru" | "en";
  channel?: "email" | "telegram" | "linkedin";
  product?: OutreachProduct;
  lead?: OutreachLead;
};

export async function POST(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const quota = await enforceUsageLimit(auth.workspaceId, "aiMessages");
  if (!quota.allowed) return quota.response!;
  const payload = (await request.json()) as OutreachPayload;
  const outcome = await draftOutreach(
    {
      product: payload.product,
      lead: payload.lead,
      channel: payload.channel,
      locale: await workspaceContentLocale(auth.workspaceId),
    },
    { workspaceId: auth.workspaceId },
  );
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  return Response.json({
    subject: outcome.subject,
    body: outcome.body,
    locale: outcome.locale,
  });
}
