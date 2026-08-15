import Link from "next/link";
import { BrandMark } from "./brand-mark";

/**
 * The frame around every guide.
 *
 * Deliberately a server component with no locale switch. These pages exist to
 * be found in English search results, so they render as English on the server
 * and never re-render into something else — a page whose text changes after
 * hydration is a page a crawler and a reader disagree about.
 */
export default function GuideShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="legal-shell">
      <header className="public-header compact">
        <Link className="public-brand" href="/">
          <BrandMark />
          <span>Chanlyst</span>
        </Link>
        <Link className="public-app-link" href="/login">
          Open app
        </Link>
      </header>
      {children}
      <footer className="legal-footer">
        <Link href="/guides">Guides</Link>
        <Link href="/contact">Contact</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </main>
  );
}
