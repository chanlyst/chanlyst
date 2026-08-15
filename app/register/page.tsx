import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create an account",
  description:
    "Create a Chanlyst account and add your first product.",
  alternates: { canonical: "/register" },
  // Nothing here is worth a search result: it is an auth step, not content.
  // Indexed, it competes with the page that actually explains the product.
  robots: { index: false, follow: true },
};

import { redirect } from "next/navigation";

export default function RegisterPage() {
  redirect("/login?mode=register");
}
