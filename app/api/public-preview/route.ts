import {
  runPublicPreview,
  type PublicPreviewInput,
} from "../../lib/public-preview";

const MAX_REQUEST_BYTES = 8_000;

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return Response.json({ error: "invalid_request" }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "invalid_request" }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "invalid_request" }, { status: 413 });
  }
  const payload = (() => {
    try {
      return JSON.parse(raw) as PublicPreviewInput;
    } catch {
      return null;
    }
  })();
  if (!payload) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const outcome = await runPublicPreview(request, payload);
  if (!outcome.ok) {
    return Response.json({ error: outcome.error }, { status: outcome.status });
  }
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "Content-Type": "application/json",
  });
  if (outcome.cookie) headers.append("Set-Cookie", outcome.cookie);
  return new Response(JSON.stringify(outcome.payload), { status: 200, headers });
}
