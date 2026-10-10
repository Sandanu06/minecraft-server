export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, form } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/login') onUnauthorized();
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  }
  return data;
}

// Remember that a change needs a restart until the server next starts.
const KEY = 'tz.restartNeededSince';
export const markRestartNeeded = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* storage may be blocked */ } window.dispatchEvent(new Event('tz-restart')); };
export const restartNeededSince = () => { try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; } };
export const clearRestartNeeded = () => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } window.dispatchEvent(new Event('tz-restart')); };
