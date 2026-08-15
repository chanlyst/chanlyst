import { env } from "cloudflare:workers";
import { isAuthResponse, requireApiSession } from "../../lib/auth";

export async function GET(request: Request) {
  const auth = await requireApiSession(request);
  if (isAuthResponse(auth)) return auth;
  const bindings = env as unknown as Record<string, unknown>;
  return Response.json({
    mode:
      bindings.SERPER_API_KEY || bindings.HUNTER_API_KEY || bindings.GOOGLE_CLIENT_ID
        ? "connected"
        : "demo",
    providers: {
      openWeb: Boolean(bindings.SERPER_API_KEY),
      maps: Boolean(bindings.GOOGLE_PLACES_API_KEY),
      publicRegistries: true,
      companyData: Boolean(bindings.HUNTER_API_KEY),
      emailVerification: Boolean(bindings.HUNTER_API_KEY),
      emailSending: Boolean(
        bindings.GOOGLE_CLIENT_ID && bindings.GOOGLE_CLIENT_SECRET,
      ),
      languageModel: Boolean(bindings.LLM_API_KEY),
    },
  });
}
