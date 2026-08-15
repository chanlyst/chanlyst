import { isAuthResponse, requireApiSession } from "../../lib/auth";
import { normaliseLocale } from "../../lib/response-language.mjs";
import {
  setWorkspaceContentLocale,
  staleContentCount,
  workspaceContentLocale,
} from "../../lib/workspace-locale";

// The language switch had no server side at all: it wrote a cookie and that
// was the whole of it. The cookie still paints the interface, but the language
// generated text is written in belongs to the workspace, so it is set here.

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const locale = await workspaceContentLocale(auth.workspaceId);
  return Response.json({
    locale,
    staleChannels: await staleContentCount(auth.workspaceId, locale),
  });
}

export async function PUT(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const payload = (await request.json().catch(() => ({}))) as {
    locale?: unknown;
  };
  const locale = await setWorkspaceContentLocale(
    auth.workspaceId,
    normaliseLocale(payload.locale),
  );
  // What is already stored stays in the language it was written in. Say how
  // much, so the interface can offer to translate rather than leave the user
  // to find a Russian card under an English heading.
  return Response.json({
    locale,
    staleChannels: await staleContentCount(auth.workspaceId, locale),
  });
}
