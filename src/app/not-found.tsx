import Link from "next/link";

// Friendly 404 (replaces Next's bare default) so a not-found never looks broken.
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-stone-500">
        That page doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link href="/projects" className="btn-primary mt-5">Back to my projects</Link>
    </div>
  );
}
