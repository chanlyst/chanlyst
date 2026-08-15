import InviteScreen from "./invite-screen";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const query = await searchParams;
  return <InviteScreen token={query?.token || ""} />;
}
