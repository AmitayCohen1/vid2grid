import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/* Clerk lives only under /admin (see proxy.ts); the studio has no accounts. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <ClerkProvider dynamic>{children}</ClerkProvider>;
}
