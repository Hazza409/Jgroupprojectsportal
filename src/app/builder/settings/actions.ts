"use server";

// Company (white-label) settings actions — builder only. SAAS-PLAN M1.

import { revalidatePath } from "next/cache";
import { assertBuilder } from "@/lib/scope";
import { db } from "@/lib/db";
import { getCompany } from "@/lib/company";
import { storage } from "@/lib/storage";

export interface SettingsResult {
  ok: boolean;
  message: string;
}

// Branding is read app-wide (TopBar, landing, emails, claim documents), so
// refresh everything, not one path.
function refreshBranding() {
  revalidatePath("/", "layout");
}

const HEX = /^#?[0-9a-fA-F]{6}$/;

function normaliseHex(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return v.startsWith("#") ? v : `#${v}`;
}

export async function updateCompany(formData: FormData): Promise<SettingsResult> {
  await assertBuilder();
  const company = await getCompany();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Company name is required." };

  const shortName = String(formData.get("shortName") ?? "").trim();
  const tagline = String(formData.get("tagline") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim();
  const printFooter = String(formData.get("printFooter") ?? "").trim();

  const brandColorDark = String(formData.get("brandColorDark") ?? "").trim();
  const brandColorLight = String(formData.get("brandColorLight") ?? "").trim();
  for (const [label, v] of [["Dark-theme", brandColorDark], ["Light-theme", brandColorLight]] as const) {
    if (v && !HEX.test(v)) return { ok: false, message: `${label} colour must be a 6-digit hex code like #C8A25A.` };
  }

  const marginPercent = Number(formData.get("marginPercent"));
  if (!Number.isFinite(marginPercent) || marginPercent < 0 || marginPercent > 100) {
    return { ok: false, message: "Builder's margin must be between 0 and 100%." };
  }
  const gstPercent = Number(formData.get("gstPercent"));
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 50) {
    return { ok: false, message: "GST must be between 0 and 50%." };
  }

  await db.company.update({
    where: { id: company.id },
    data: {
      name,
      shortName: shortName || null,
      tagline: tagline || null,
      location: location || null,
      printFooter: printFooter || null,
      brandColorDark: normaliseHex(brandColorDark),
      brandColorLight: normaliseHex(brandColorLight),
      marginPercent,
      gstPercent,
    },
  });

  refreshBranding();
  return { ok: true, message: "Company settings saved." };
}

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

export async function uploadLogo(formData: FormData): Promise<SettingsResult> {
  await assertBuilder();
  const company = await getCompany();

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a logo file first." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, message: "Logo must be a PNG, JPG, SVG or WebP image." };
  if (file.size > LOGO_MAX_BYTES) return { ok: false, message: "Logo must be under 2 MB." };

  const store = await storage();
  // company/ keys are served publicly (the logo appears on the public landing
  // and login pages) — see src/app/api/files/[...key]/route.ts.
  const key = `company/${company.id}/logo-${Date.now()}.${ext}`;
  await store.put({ key, body: Buffer.from(await file.arrayBuffer()), contentType: file.type });

  const oldKey = company.logoKey;
  await db.company.update({ where: { id: company.id }, data: { logoKey: key } });
  if (oldKey) await store.delete(oldKey).catch(() => {});

  refreshBranding();
  return { ok: true, message: "Logo updated." };
}

export async function removeLogo(): Promise<SettingsResult> {
  await assertBuilder();
  const company = await getCompany();
  if (company.logoKey) {
    const store = await storage();
    await store.delete(company.logoKey).catch(() => {});
    await db.company.update({ where: { id: company.id }, data: { logoKey: null } });
  }
  refreshBranding();
  return { ok: true, message: "Logo removed — using the built-in mark." };
}
