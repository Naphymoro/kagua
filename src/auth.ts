import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedDomain = "@aimsric.org";
const isAllowedEmail = (email?: string | null) => Boolean(email?.trim().toLowerCase().endsWith(allowedDomain));
const authSecret =
  process.env.AUTH_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  (process.env.NODE_ENV === "development" ? "kagua-local-development-secret-do-not-use-in-production" : undefined);
const googleClientId = process.env.AUTH_GOOGLE_ID || process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.AUTH_GOOGLE_SECRET || process.env.GOOGLE_CLIENT_SECRET;
const googleProvider = googleClientId && googleClientSecret ? Google({ clientId: googleClientId, clientSecret: googleClientSecret }) : Google;
export const googleOAuthReady = Boolean(googleClientId && googleClientSecret);
export const localAuthBypass = process.env.NODE_ENV === "development" && !googleOAuthReady;

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  providers: [googleProvider],
  pages: { signIn: "/sign-in", error: "/access-denied" },
  callbacks: {
    async signIn({ profile, user }) {
      const email = profile?.email ?? user.email;
      return isAllowedEmail(email);
    },
    async jwt({ token, profile }) {
      if (profile?.email) token.email = profile.email.toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = String(token.email).toLowerCase();
      return session;
    },
  },
  session: { strategy: "jwt" },
});

export { isAllowedEmail };
