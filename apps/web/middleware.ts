import { db, eq, schema } from "@/lib/db";
import { authMiddleware, clerkClient } from "@clerk/nextjs";
import { redirectToSignIn } from "@clerk/nextjs";
import { NextFetchEvent, NextRequest, NextResponse } from "next/server";
const DEBUG_ON = process.env.CLERK_DEBUG === "true";
import { collectPageViewAnalytics } from "@/lib/analytics";

const findWorkspace = async ({ tenantId }: { tenantId: string }) => {
  const workspace = await db.query.workspaces.findFirst({
    where: eq(schema.workspaces.tenantId, tenantId),
  });
  return workspace;
};

const publicRoutes = [
  "/",
  "/auth(.*)",
  "/discord",
  "/pricing",
  "/about",
  "/blog",
  "/blog/(.*)",
  "/changelog",
  "/changelog(.*)",
  "/policies",
  "/policies/(.*)",
  "/docs",
  "/docs(.*)",
  "/og",
  "/og/(.*)",
  "/api/v1/stripe/webhooks",
  "/api/v1/cron/(.*)",
  "/api/v1/clerk/webhooks",
];

export default async function (req: NextRequest, evt: NextFetchEvent) {
  let userId: string | undefined = undefined;
  let tenantId: string | undefined = undefined;

  const res = await authMiddleware({
    publicRoutes,
    signInUrl: "/auth/sign-in",
    debug: true,

    afterAuth: async (auth, req) => {
      if (!(auth.userId || auth.isPublicRoute)) {
        return redirectToSignIn({ returnBackUrl: req.url });
      }
      userId = auth.userId ?? undefined;
      tenantId = auth.orgId ?? auth.userId ?? undefined;
      if (auth.orgId) {
        const workspace = await findWorkspace({ tenantId: auth.orgId });
        // okay if we don't find a workspace, we need to delete the orgId and send them to create a new workspace.
        // this should never happen, but if it does, we need to handle it.
        if (!workspace && req.nextUrl.pathname !== "/new") {
          console.error("Workspace not found for orgId", auth.orgId);
          await clerkClient.organizations.deleteOrganization(auth.orgId);
          console.log("Deleted orgId", auth.orgId, " sending to create new workspace.")
          return NextResponse.redirect(new URL("/new", req.url));
        }
        // this stops users if they haven't paid.
        if (!["/app/stripe", "/app/apis", "/app", "/new"].includes(req.nextUrl.pathname)) {
          if (workspace?.plan === "free") {
            return NextResponse.redirect(new URL("/app/stripe", req.url));
          }
          return NextResponse.next();
        }
        if (auth.userId && !auth.orgId && req.nextUrl.pathname === "/app/apis") {
          const workspace = await findWorkspace({ tenantId: auth.userId });
          if (!workspace) {
            return NextResponse.redirect(new URL("/new", req.url));
          }
        }
      }
    }
  })(req, evt);

  evt.waitUntil(collectPageViewAnalytics({ req, userId, tenantId }));

  return res;
}

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
