// The dashboard itself is rendered once by app/dashboard/layout.tsx, which
// reads this route's segment to decide which section to show. The page exists
// so the segment exists — and so a direct link to the section still resolves.
//
// Deliberately not force-dynamic: it renders nothing, so there is nothing to
// re-render per request, and being static is what lets the router prefetch the
// segment and switch sections without waiting for the server.
export default function WorkspacePage() {
  return null;
}
