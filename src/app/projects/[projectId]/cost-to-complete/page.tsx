import { redirect } from "next/navigation";

// The Cost to Complete tab was folded into Budget (Harry, 21 Aug 2026): one
// money page instead of two telling overlapping stories. The route stays so
// every old link — emails, bookmarks, the Xero OAuth callback — still lands
// somewhere sensible. The components and actions in this folder are imported
// by the Budget page; only the standalone page is gone.
export default function CostToCompleteRedirect({
  params,
  searchParams,
}: {
  params: { projectId: string };
  searchParams: { xero?: string };
}) {
  const suffix = searchParams.xero ? `?xero=${encodeURIComponent(searchParams.xero)}` : "";
  redirect(`/projects/${params.projectId}/budget${suffix}`);
}
