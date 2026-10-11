import { clerkMiddleware } from "@clerk/nextjs/server";

/* Clerk runs only for /admin: the studio itself has no accounts, and its
   visitors never load Clerk. The auth checks live in the page (lib/admin.ts). */
export default clerkMiddleware();

export const config = { matcher: ["/admin(.*)"] };
