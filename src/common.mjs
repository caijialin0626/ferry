import { timingSafeEqual } from 'node:crypto';

export const maxImages = 6;
// Six images and a video can use 20 MiB before base64 and JSON encoding.
export const sendLimit = 28 * 1024 * 1024;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function secret(name) {
  const value = process.env[name];
  if (!value || value.length < 24) throw new Error(name + ' must contain at least 24 characters');
  return value;
}

export function sameSecret(left, right) {
  if (typeof left !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function body(req, limit = 128 * 1024) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new HttpError(415, 'Requests must use JSON.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new HttpError(400, 'The request is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'The request must be a JSON object.');
  }
  return value;
}

export function failure(res, error) {
  if (res.headersSent || res.destroyed) return res.end();
  if (error instanceof HttpError) return json(res, error.status, { error: error.message });
  console.error(error);
  json(res, 500, { error: 'The service ran into an error.' });
}

export function sse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();
}
