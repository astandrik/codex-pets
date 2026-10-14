export async function readJsonResponse(
  response: Response,
  fallbackMessage = `Request failed ${response.status}`,
): Promise<unknown> {
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    if (response.ok) throw error;
    throw new Error(fallbackMessage);
  }
  if (!response.ok) {
    let message: unknown;
    if (data !== null && typeof data === "object") {
      if ("message" in data) message = data.message;
      if (message == null && "error" in data) message = data.error;
    }
    throw new Error(String(message ?? fallbackMessage));
  }
  return data;
}
