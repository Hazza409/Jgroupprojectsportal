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
// A fixed throwaway bcrypt hash compared against on the no-user / locked paths,
// so every failed login takes ~the same time — an attacker can't tell which
// emails exist or are locked from response latency (no account enumeration).
const DUMMY_HASH = bcrypt.hashSync("timing-equaliser-not-a-real-password", 10);

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
        // Trim to match how passwords are stored (all set-paths .trim()), so an
        // accidental trailing space on either side never blocks a valid login.
        const password = credentials.password.trim();
        const user = await db.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });

        // No such email, or locked out: still run one bcrypt.compare (against a
        // dummy hash) so the response time matches the wrong-password path. Don't
        // disclose the reason — avoids account enumeration / lock probing.
        if (!user) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }
        if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          await bcrypt.compare(password, DUMMY_HASH);
          return null;
        }

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          // Atomic increment (SET col = col + 1) so concurrent guesses can't
          // outrun the counter via a lost-update race; lock once at threshold.
          const updated = await db.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: { increment: 1 } },
            select: { failedLoginAttempts: true },
          });
          if (updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
            await db.user.update({
              where: { id: user.id },
              data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
            });
          }
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
