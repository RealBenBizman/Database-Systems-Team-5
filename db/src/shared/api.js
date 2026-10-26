export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function withQuery(url, params) {
  if (!params) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value));
  }
  const text = search.toString();
  return text ? `${url}${url.includes('?') ? '&' : '?'}${text}` : url;
}

async function request(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (_) {
    throw new ApiError(0, 'Cannot reach the server. Check your connection and try again.', 'NETWORK');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = null; }
  }

  if (!res.ok) {
    const message = (data && data.error) || 'Something went wrong. Please try again.';
    throw new ApiError(res.status, message, data && data.code);
  }
  return data;
}

export const api = {
  get: (url, params) => request('GET', withQuery(url, params)),
  post: (url, body) => request('POST', url, body === undefined ? {} : body),
  put: (url, body) => request('PUT', url, body === undefined ? {} : body),
  patch: (url, body) => request('PATCH', url, body === undefined ? {} : body),
  delete: (url) => request('DELETE', url),
};