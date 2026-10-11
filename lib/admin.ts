import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";

/** ADMIN_EMAILS: comma-separated, case-insensitive. */
export function adminEmails(): Set<string> {
  return new Set((process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

/** The signed-in user, and whether one of their *verified* addresses is on the list.
    Anyone signed out is sent to Clerk's sign-in and back. */
export async function adminUser() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn();
  const user = await currentUser();
  if (!user) return redirectToSignIn();
  const allowed = adminEmails();
  const isAdmin = user.emailAddresses.some((e) => e.verification?.status === "verified" && allowed.has(e.emailAddress.toLowerCase()));
  return { user, isAdmin };
}
