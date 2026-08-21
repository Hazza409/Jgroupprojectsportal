import { db } from "@/lib/db";
import { fmtDateTime } from "@/lib/dates";

/**
 * Internal-only client activity (Jake §2). Answers "they say they never saw
 * variation #14" — here is the record of them opening it twice before
 * approving. Builder-only; never rendered in a client view.
 */
export async function ClientActivityCard({ projectId }: { projectId: string }) {
  const [recent, totals] = await Promise.all([
    db.viewLog.findMany({
      where: { projectId },
      orderBy: { viewedAt: "desc" },
      take: 40,
      select: { id: true, userName: true, label: true, path: true, viewedAt: true },
    }),
    db.viewLog.groupBy({
      by: ["label"],
      where: { projectId },
      _count: { _all: true },
      _max: { viewedAt: true },
    }),
  ]);

  const last7 = await db.viewLog.count({
    where: { projectId, viewedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
  });

  return (
    <div className="card">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Client activity</h3>
        <span className="text-xs text-stone-400">{last7} view{last7 === 1 ? "" : "s"} in the last 7 days</span>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        Internal only — never shown to the client. Records which client-side users signed in and what they opened.
      </p>

      {recent.length === 0 ? (
        <p className="text-sm text-stone-500">No client activity recorded yet.</p>
      ) : (
        <>
          {/* Weekly-digest style roll-up: what's been looked at, and how often. */}
          <div className="mb-3 flex flex-wrap gap-2">
            {totals
              .filter((t) => t.label)
              .sort((a, b) => b._count._all - a._count._all)
              .slice(0, 8)
              .map((t) => (
                <span key={t.label} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs">
                  {t.label} · <span className="tabular-nums font-medium">{t._count._all}</span>
                </span>
              ))}
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full min-w-[36rem] table-fixed text-xs">
              <colgroup>
                <col className="w-[26%]" />
                <col className="w-[40%]" />
                <col className="w-[34%]" />
              </colgroup>
              <thead className="sticky top-0 border-b border-stone-200 bg-panel text-left uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-2">Who</th>
                  <th className="py-2">Viewed</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {recent.map((v) => (
                  <tr key={v.id}>
                    <td className="py-1.5 break-words">{v.userName}</td>
                    <td className="py-1.5 break-words">{v.label ?? v.path}</td>
                    <td className="py-1.5 whitespace-nowrap text-stone-500">{fmtDateTime(v.viewedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
