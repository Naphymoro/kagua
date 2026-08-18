import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const allowedDomain = "@aimsric.org";
const isAllowedEmail = (email?: string | null) => Boolean(email?.trim().toLowerCase().endsWith(allowedDomain));

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
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
