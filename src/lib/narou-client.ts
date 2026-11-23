interface FetchRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException && err.name === "AbortError"
  ) || (err instanceof Error && err.name === "AbortError");
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === "string" && data.error.trim()) {
      return data.error;
    }
  } catch {
    // Ignore JSON parse errors
  }
  return `Request failed with status ${res.status}`;
}

async function fetchViaCorsProxies(
  targetUrl: string,
  signal?: AbortSignal
): Promise<string> {
  const attempts: Array<{
    name: string;
    run: () => Promise<string>;
  }> = [
    {
      name: "allorigins-raw",
      run: async () => {
        const res = await fetch(
          `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
          { signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
    },
    {
      name: "allorigins-json",
      run: async () => {
        const res = await fetch(
          `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`,
          { signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return typeof data?.contents === "string" ? data.contents : "";
      },
    },
    {
      name: "codetabs",
      run: async () => {
        const res = await fetch(
          `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(
            targetUrl
          )}`,
          { signal }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      },
    },
  ];

  for (const attempt of attempts) {
    try {
      const html = await attempt.run();
      if (html && html.trim().length > 0) {
        return html;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      console.warn(`CORS proxy "${attempt.name}" failed:`, err);
    }
  }

  throw new Error(
    "All client-side CORS proxies failed to fetch content. Try unchecking Force Client-Side Download to use the server."
  );
}

export async function fetchWithFallback<T>(
  apiEndpoint: string,
  options: FetchRequestOptions,
  fallbackType: "parse-info" | "parse-episode",
  fallbackUrl: string,
  setStatus: (status: string) => void,
  forceClientSide: boolean = false,
  onFallback?: () => void
): Promise<T> {
  let useFallback = forceClientSide;

  if (!useFallback) {
    try {
      const res = await fetch(apiEndpoint, options);
      if (res.ok) {
        return (await res.json()) as T;
      }

      const errorMessage = await readErrorMessage(res);

      // Do not fall back to CORS proxies on client/not-found errors (e.g. bad URL or 404)
      if (res.status === 400 || res.status === 404) {
        throw new Error(errorMessage);
      }

      // 403 (IP block), 429, or 5xx: fall back to client-side proxy
      console.warn(
        `Primary server fetch returned ${res.status}: ${errorMessage}`
      );
      setStatus("Server fetch blocked/failed, trying client-side fallback...");
      useFallback = true;
      if (onFallback) onFallback();
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Re-throw non-network explicit 400/404 errors thrown above
      if (
        err instanceof Error &&
        !useFallback &&
        err.name !== "TypeError"
      ) {
        throw err;
      }
      if (!useFallback) {
        console.warn("Primary fetch network error, trying fallback...", err);
        setStatus("Server unreachable, trying client-side fallback...");
        useFallback = true;
        if (onFallback) onFallback();
      }
    }
  }

  const html = await fetchViaCorsProxies(fallbackUrl, options.signal);

  const originalBody = options.body ? JSON.parse(options.body) : {};
  const parseRes = await fetch(apiEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      ...originalBody,
      type: fallbackType,
      html,
    }),
  });

  if (!parseRes.ok) {
    const parseErr = await readErrorMessage(parseRes);
    throw new Error(parseErr);
  }

  return (await parseRes.json()) as T;
}
