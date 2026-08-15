import {
  authBindings,
  getSession,
  SESSION_COOKIE,
} from "../../../lib/auth";

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return Response.json(
      {
        authenticated: false,
        providers: {
          google: Boolean(
            authBindings().GOOGLE_AUTH_CLIENT_ID &&
              authBindings().GOOGLE_AUTH_CLIENT_SECRET,
          ),
          apple: Boolean(
            authBindings().APPLE_CLIENT_ID &&
              authBindings().APPLE_TEAM_ID &&
              authBindings().APPLE_KEY_ID &&
              authBindings().APPLE_PRIVATE_KEY,
          ),
        },
      },
      { status: 401 },
    );
  }
  return Response.json({
    authenticated: true,
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      avatarUrl: session.avatarUrl,
    },
    workspaceId: session.workspaceId,
  });
}

export async function DELETE(request: Request) {
  const { deleteSession } = await import("../../../lib/auth");
  await deleteSession(request);
  const response = Response.json({ signedOut: true });
  response.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  );
  return response;
}
