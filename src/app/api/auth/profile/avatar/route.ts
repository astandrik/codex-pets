import { NextResponse } from "next/server";

import { clearUserAvatar } from "@/lib/auth/avatar-repository";
import { getUserById } from "@/lib/auth/repository";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(): Promise<Response> {
  if (!isYdbConfigured()) {
    return NextResponse.json({ error: "service_not_configured" }, { status: 503 });
  }

  const principal = await getCurrentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const existing = await getUserById(principal.userId);
  if (!existing) {
    return NextResponse.json(
      {
        error: "profile_not_editable",
        message: "This auth mode does not have an editable local profile.",
      },
      { status: 403 },
    );
  }

  await clearUserAvatar(existing.userId);
  revalidateSitemapCache();

  return NextResponse.json({
    ok: true,
    profile: {
      avatarUrl: null,
    },
  });
}
