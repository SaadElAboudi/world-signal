export class DataError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DataError";
  }
}
export function errorCode(error: unknown): string {
  // Never log external exception messages: FIRMS embeds the credential in its URL.
  return error instanceof DataError ? error.code : "internal_failure";
}

export function safeErrorDetail(error: unknown): string {
  if (error instanceof DataError) return error.code;
  if (!(error instanceof Error)) return "internal_failure";
  // Keep operational PostgreSQL and timeout diagnostics while removing URLs and
  // query strings, which can carry provider credentials.
  return error.message
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/([?&][A-Za-z0-9_-]*(?:key|token|secret|password)[A-Za-z0-9_-]*=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 180) || "internal_failure";
}
export function log(
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
) {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }),
  );
}
