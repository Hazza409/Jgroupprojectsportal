import { assertProjectAccess } from "@/lib/scope";
import { db } from "@/lib/db";
import { ModuleHeader } from "@/components/ModuleHeader";
import { createContact, deleteContact } from "./actions";

export default async function ContactsPage({ params }: { params: { projectId: string } }) {
  const user = await assertProjectAccess(params.projectId);
  const projectId = params.projectId;
  const isBuilder = user.role === "BUILDER";

  const contacts = await db.projectContact.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
  });

  return (
    <div>
      <ModuleHeader
        title="J Group Contacts"
        description={
          isBuilder
            ? "Add the J Group people your client can contact for this project."
            : "Your key contacts at J Group for this project."
        }
      />

      {isBuilder && (
        <form action={createContact.bind(null, projectId)} className="card mb-6 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input name="name" required className="input" placeholder="e.g. Jordan Smith" />
          </div>
          <div>
            <label className="label">Role</label>
            <input name="role" className="input" placeholder="e.g. Project Manager" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input name="phone" className="input" placeholder="0400 000 000" />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" className="input" placeholder="name@jgroupprojects.com" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary" type="submit">Add contact</button>
          </div>
        </form>
      )}

      {contacts.length === 0 ? (
        <div className="card text-stone-500">
          {isBuilder ? "No contacts yet — add your project team above." : "No contacts have been added yet."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {contacts.map((c) => (
            <div key={c.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  {c.role && <p className="text-sm text-stone-500">{c.role}</p>}
                  <div className="mt-2 space-y-1 text-sm">
                    {c.phone && (
                      <p>
                        <a href={`tel:${c.phone.replace(/\s+/g, "")}`} className="text-brand hover:underline">
                          {c.phone}
                        </a>
                      </p>
                    )}
                    {c.email && (
                      <p>
                        <a href={`mailto:${c.email}`} className="text-brand hover:underline break-all">
                          {c.email}
                        </a>
                      </p>
                    )}
                  </div>
                </div>
                {isBuilder && (
                  <form action={deleteContact.bind(null, projectId, c.id)}>
                    <button className="text-xs text-red-700 dark:text-red-300 hover:text-red-200" type="submit">
                      Remove
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
