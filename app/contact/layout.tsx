import type { Metadata } from "next";

// The page itself is a client component (it owns a form and the language
// switch), and a client component cannot export metadata — hence this layout,
// whose only job is to give the route its own title and description instead of
// letting it inherit the home page's.
export const metadata: Metadata = {
  title: "Contact",
  description:
    "Ask about Chanlyst before you subscribe: what it finds, how outreach is approved, and what a plan covers.",
  alternates: { canonical: "/contact" },
};

export default function ContactLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
