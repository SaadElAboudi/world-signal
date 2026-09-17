import { DataError } from "../server/log";
export type HttpResult = { text: string; headers: Headers };
export async function fetchText(
  url: string,
  options: {
    fetcher?: typeof fetch;
    attempts?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<HttpResult> {
  const fetcher = options.fetcher ?? fetch;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let retryDelay = 1000 * 2 ** attempt;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
        headers: {
          Accept: "application/json,text/csv,*/*",
          "User-Agent":
            "WorldSignal/0.2 (public environmental data observatory)",
        },
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          retryDelay = retryAfter
            ? Math.max(
                Number(retryAfter) * 1000 ||
                  Date.parse(retryAfter) - Date.now(),
                1000,
              )
            : retryDelay;
          if (!Number.isFinite(retryDelay)) retryDelay = 1000 * 2 ** attempt;
          if (retryDelay > 60000) throw new DataError("rate_limited");
        } else if (response.status < 500)
          throw new DataError(`upstream_http_${response.status}`);
        if (attempt === attempts - 1)
          throw new DataError(`upstream_http_${response.status}`);
        await response.body?.cancel();
        await sleep(retryDelay);
        continue;
      }
      const limit = 128 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > limit)
        throw new DataError("response_too_large");
      const reader = response.body?.getReader();
      if (!reader) throw new DataError("empty_response");
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          await reader.cancel();
          throw new DataError("response_too_large");
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return { text, headers: response.headers };
    } catch (error) {
      if (error instanceof DataError) throw error;
      if (attempt === attempts - 1) throw new DataError("network_or_timeout");
      await sleep(retryDelay);
    }
  }
  throw new DataError("fetch_failed");
}
