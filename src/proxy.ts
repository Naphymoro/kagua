import { NextResponse } from "next/server";
import { auth, isAllowedEmail } from "@/auth";

const publicPaths = ["/sign-in", "/access-denied", "/api/auth"];

export default auth((req) => {
  const path = req.nextUrl.pathname;
  if (publicPaths.some((p) => path.startsWith(p))) return NextResponse.next();

  const email = req.auth?.user?.email;
  if (!req.auth || !isAllowedEmail(email)) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Kagua access is restricted to verified @aimsric.org Google accounts." }, { status: 403 });
    }
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
