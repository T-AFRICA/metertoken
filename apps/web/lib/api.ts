export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfToken = '';
export const setCsrfToken = (t: string) => {
  csrfToken = t;
};

export async function api<T>(path: string, opts: { method?: 'GET' | 'POST' | 'PATCH'; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const hasBody = method !== 'GET';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      ...opts.headers,
    },
    body: hasBody ? JSON.stringify(opts.body ?? {}) : undefined,
  });
  // Customer pages handle their own sign-in, so a 401 there must not bounce to the staff login.
  if (res.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/customer/') && typeof window !== 'undefined') {
    window.location.href = '/login';
  }
  const isJson = (res.headers.get('content-type') ?? '').includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const body = (isJson ? data : {}) as Record<string, unknown>;
    throw new ApiError(res.status, String(body.error ?? 'ERROR'), String(body.message ?? `Request failed (${res.status})`), body);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
