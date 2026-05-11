export async function toBufferedPngResponse(image: Response): Promise<Response> {
  const body = await image.arrayBuffer();

  return new Response(body, {
    status: image.status,
    statusText: image.statusText,
    headers: {
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Length": String(body.byteLength),
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
