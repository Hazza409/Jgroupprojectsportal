import { getCompany } from "@/lib/company";
import { LoginForm } from "./LoginForm";

// Server shell: company branding from settings; the form itself is a client
// component (LoginForm).
export default async function LoginPage() {
  const company = await getCompany();
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="wordmark text-xl text-ink">{company.name}</p>
          {company.tagline && (
            <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-stone-500">
              {company.tagline}
            </p>
          )}
          <h1 className="mt-6 text-2xl font-semibold">Sign in</h1>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
