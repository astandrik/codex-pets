import { NextResponse } from "next/server";

import { readUserAvatar } from "@/lib/auth/avatar-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ avatarId: string }>;
};

export async function GET(_req: Request, context: RouteContext): Promise<Response> {
  const { avatarId } = await context.params;
  let decodedAvatarId: string;
  try {
    decodedAvatarId = decodeURIComponent(avatarId);
  } catch {
    return NextResponse.json({ error: "avatar_not_found" }, { status: 404 });
  }

  const avatar = await readUserAvatar(decodedAvatarId);
  if (!avatar) {
    return NextResponse.json({ error: "avatar_not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(avatar.buffer), {
    headers: {
      "Content-Type": avatar.contentType || "image/webp",
      "Content-Length": String(avatar.buffer.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
