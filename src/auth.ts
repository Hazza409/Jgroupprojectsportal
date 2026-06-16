import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user) return null;
        // Trim to match how passwords are stored (all set-paths .trim()), so an
        // accidental trailing space on either side never blocks a valid login.
        const ok = await bcrypt.compare(credentials.password.trim(), user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role };
      },
    }),
  ],
  callbacks: {
    // Persist id + role onto the JWT so scope checks don't hit the DB for identity.
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as { id: string; role: Role };
        token.uid = u.id;
        token.role = u.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as SessionUser).id = token.uid as string;
        (session.user as SessionUser).role = token.role as Role;
      }
      return session;
    },
  },
};

/** Server-side accessor for the current user, typed. Returns null if signed out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const u = session.user as SessionUser;
  if (!u.id) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}
