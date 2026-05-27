export type ApiErrorBody = {
  error: string;
  code: string;
  message: string;
  hint?: string;
  field?: string;
};

type ApiErrorOptions = {
  status?: number;
  message: string;
  hint?: string;
  field?: string;
  headers?: HeadersInit;
};

type ValidationErrorLike = {
  error: string;
  message: string;
  field?: string;
};

export function buildApiErrorBody(
  code: string,
  options: Omit<ApiErrorOptions, "status" | "headers">,
): ApiErrorBody {
  return {
    error: code,
    code,
    message: options.message,
    ...(options.hint ? { hint: options.hint } : {}),
    ...(options.field ? { field: options.field } : {}),
  };
}

export function jsonApiError(
  code: string,
  options: ApiErrorOptions,
): Response {
  return Response.json(buildApiErrorBody(code, options), {
    status: options.status ?? 400,
    headers: buildJsonErrorHeaders(options.headers),
  });
}

export function jsonValidationError(
  validation: ValidationErrorLike,
  options: Pick<ApiErrorOptions, "status" | "headers" | "hint"> = {},
): Response {
  return jsonApiError(validation.error, {
    status: options.status ?? 400,
    message: validation.message,
    field: validation.field,
    hint: options.hint,
    headers: options.headers,
  });
}

function buildJsonErrorHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json");
  return result;
}
