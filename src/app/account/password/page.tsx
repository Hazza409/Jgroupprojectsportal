import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/auth";
import { TopBar } from "@/components/TopBar";
import { ModuleHeader } from "@/components/ModuleHeader";
import { ChangePasswordForm } from "./ChangePasswordForm";

// Any signed-in user (builder or client) can change their own password. This
// route is outside the project layout, so it guards the session itself (the
// middleware matcher also covers /account).
export default async function ChangePasswordPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <TopBar user={user} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <Link
          href={user.role === "BUILDER" ? "/builder" : "/projects"}
          className="text-sm text-stone-500 hover:text-ink"
        >
          ← Back
        </Link>
        <div className="mt-2">
          <ModuleHeader title="Change password" description="Update the password you use to sign in." />
        </div>
        <ChangePasswordForm />
      </div>
    </>
  );
}
