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
export function log(
  event: string,
  fields: Record<string, string | number | boolean | null> = {},
) {
  console.log(
    JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }),
  );
}
