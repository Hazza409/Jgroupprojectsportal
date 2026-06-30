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

// Brute-force lockout: after this many consecutive failed logins, lock the
// account for the cooldown below. Cleared on the next successful sign-in.
const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_MINUTES = 15;

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

        // Locked out from too many recent failed attempts? Reject without
        // checking the password (and don't disclose the lock — avoids leaking
        // which emails exist / are under attack).
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null;

        // Trim to match how passwords are stored (all set-paths .trim()), so an
        // accidental trailing space on either side never blocks a valid login.
        const ok = await bcrypt.compare(credentials.password.trim(), user.passwordHash);
        if (!ok) {
          // Count the failure; lock the account once the threshold is reached.
          const attempts = user.failedLoginAttempts + 1;
          await db.user.update({
            where: { id: user.id },
            data:
              attempts >= MAX_FAILED_ATTEMPTS
                ? { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
                : { failedLoginAttempts: attempts },
          });
          return null;
        }

        // Success — clear any prior failed-attempt / lock state.
        if (user.failedLoginAttempts > 0 || user.lockedUntil) {
          await db.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockedUntil: null },
          });
        }
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
