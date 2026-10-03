'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const STUDENT = Object.freeze({ id: '22CK031380', name: 'Osarenkhoe Osamudiamen' });
const pendingPayments = new Map();
const completedPayments = new Map();
const MAX_BODY_BYTES = 16 * 1024;
const PAYMENT_TTL_MS = 30 * 60 * 1000;

loadEnvFile();

const PORT = readInteger(process.env.PORT, 3000, 1, 65535);
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const APP_BASE_URL = parseBaseUrl(process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://${HOST}:${PORT}`);
const MAX_PAYMENT_NAIRA = readInteger(process.env.MAX_PAYMENT_NAIRA, 2083295, 100, 100000000);

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;

  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;

    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    process.env[match[1]] = value;
  }
}

function readInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new Error(`Configuration value must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function parseBaseUrl(value) {
  const url = new URL(value);
  const localHttp = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHttp)) {
    throw new Error('APP_BASE_URL must use HTTPS, except for localhost development.');
  }
  return url;
}

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

function redirect(response, destination) {
  response.writeHead(303, { Location: destination, 'Cache-Control': 'no-store' });
  response.end();
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Send a valid JSON request.'), { statusCode: 400 });
  }
}

function getSecretKey() {
  const key = (process.env.PAYSTACK_SECRET_KEY || '').trim();
  if (!/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) {
    throw Object.assign(new Error('Add your Paystack secret key to the project .env file.'), { statusCode: 503 });
  }
  if (key.startsWith('sk_live_') && process.env.ALLOW_LIVE_PAYMENTS !== 'true') {
    throw Object.assign(new Error('Live payments are disabled. Set ALLOW_LIVE_PAYMENTS=true in .env only when ready.'), { statusCode: 503 });
  }
  return key;
}

async function callPaystack(endpoint, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const result = await fetch(`https://api.paystack.co${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${getSecretKey()}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const payload = await result.json().catch(() => null);
    if (!result.ok || !payload || payload.status !== true) {
      const reason = payload && typeof payload.message === 'string' ? payload.message : 'Paystack could not complete the request.';
      throw Object.assign(new Error(reason), { statusCode: 502 });
    }
    return payload.data;
  } finally {
    clearTimeout(timeout);
  }
}

function cleanExpiredPayments() {
  const cutoff = Date.now() - PAYMENT_TTL_MS;
  for (const [reference, payment] of pendingPayments) {
    if (payment.createdAt < cutoff) pendingPayments.delete(reference);
  }
  for (const [reference, payment] of completedPayments) {
    if (payment.createdAt < cutoff) completedPayments.delete(reference);
  }
}

async function initializePayment(request, response) {
  const body = await readJson(request);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const amountNaira = Number(body.amountNaira);
  const method = body.method;

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(response, 400, { error: 'Enter a valid email address for the Paystack receipt.' });
  }
  if (!Number.isSafeInteger(amountNaira) || amountNaira < 100 || amountNaira > MAX_PAYMENT_NAIRA) {
    return sendJson(response, 400, { error: `Enter a whole-naira amount between ₦100 and ₦${MAX_PAYMENT_NAIRA.toLocaleString('en-NG')}.` });
  }
  if (!['Paystack Card', 'Paystack Others'].includes(method)) {
    return sendJson(response, 400, { error: 'Choose a Paystack payment option to continue.' });
  }

  const amountKobo = amountNaira * 100;
  const reference = `CU-${crypto.randomUUID()}`;
  const callbackUrl = new URL('/api/payments/callback', APP_BASE_URL).toString();
  const channels = method === 'Paystack Card'
    ? ['card']
    : ['bank', 'ussd', 'qr', 'mobile_money', 'bank_transfer', 'eft'];

  const authorization = await callPaystack('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email,
      amount: String(amountKobo),
      currency: 'NGN',
      reference,
      callback_url: callbackUrl,
      channels,
      metadata: {
        student_id: STUDENT.id,
        student_name: STUDENT.name,
        expected_amount_kobo: amountKobo,
        payment_method: method,
      },
    }),
  });

  if (typeof authorization.authorization_url !== 'string' || !authorization.authorization_url.startsWith('https://checkout.paystack.com/')) {
    throw Object.assign(new Error('Paystack returned an invalid checkout link.'), { statusCode: 502 });
  }

  cleanExpiredPayments();
  pendingPayments.set(reference, {
    reference,
    email,
    amountKobo,
    amountNaira,
    method,
    createdAt: Date.now(),
  });
  sendJson(response, 200, { authorizationUrl: authorization.authorization_url, reference });
}

async function handleCallback(url, response) {
  const reference = url.searchParams.get('reference') || '';
  const pending = pendingPayments.get(reference);
  if (!pending) {
    const destination = new URL('/', APP_BASE_URL);
    destination.searchParams.set('payment', 'failed');
    destination.searchParams.set('reason', 'unknown_reference');
    return redirect(response, destination.toString());
  }

  try {
    const transaction = await callPaystack(`/transaction/verify/${encodeURIComponent(reference)}`);
    const successful = transaction.reference === reference
      && transaction.status === 'success'
      && transaction.currency === 'NGN'
      && Number(transaction.amount) === pending.amountKobo;

    const destination = new URL('/', APP_BASE_URL);
    if (!successful) {
      destination.searchParams.set('payment', 'failed');
      destination.searchParams.set('reference', reference);
      return redirect(response, destination.toString());
    }

    completedPayments.set(reference, {
      reference,
      amountNaira: pending.amountNaira,
      email: pending.email,
      method: pending.method,
      channel: typeof transaction.channel === 'string' ? transaction.channel : '',
      date: typeof transaction.paid_at === 'string' ? transaction.paid_at : new Date().toISOString(),
      createdAt: Date.now(),
    });
    pendingPayments.delete(reference);
    destination.searchParams.set('payment', 'success');
    destination.searchParams.set('reference', reference);
    return redirect(response, destination.toString());
  } catch (error) {
    console.error('Paystack callback verification failed:', error.message);
    const destination = new URL('/', APP_BASE_URL);
    destination.searchParams.set('payment', 'failed');
    destination.searchParams.set('reference', reference);
    destination.searchParams.set('reason', 'verification_error');
    return redirect(response, destination.toString());
  }
}

function serveStatic(urlPath, request, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return sendJson(response, 400, { error: 'Invalid path.' });
  }

  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  if (relativePath.split(/[\\/]/).some((part) => part === '.' || part === '..')) {
    return sendJson(response, 404, { error: 'Not found.' });
  }
  const isRootAsset = ['index.html', 'reference-app.js', 'reference.css'].includes(relativePath);
  const isImageAsset = relativePath.startsWith('assets/') && !relativePath.slice('assets/'.length).includes('\\');
  if (!isRootAsset && !isImageAsset) return sendJson(response, 404, { error: 'Not found.' });

  const filePath = path.resolve(ROOT, relativePath);
  const allowedRoot = isImageAsset ? path.resolve(ROOT, 'assets') + path.sep : ROOT + path.sep;
  if (!filePath.startsWith(allowedRoot)) return sendJson(response, 404, { error: 'Not found.' });

  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    return sendJson(response, 404, { error: 'File not found.' });
  }
  if (!stats.isFile()) return sendJson(response, 404, { error: 'File not found.' });

  response.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
  });
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(filePath).pipe(response);
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'DENY');

  let url;
  try {
    url = new URL(request.url, APP_BASE_URL);
  } catch {
    return sendJson(response, 400, { error: 'Invalid request URL.' });
  }

  try {
    if (request.method === 'POST' && url.pathname === '/api/payments/initialize') {
      return await initializePayment(request, response);
    }
    if (request.method === 'GET' && url.pathname === '/api/payments/callback') {
      return await handleCallback(url, response);
    }
    if (request.method === 'GET' && url.pathname === '/api/payments/receipt') {
      const reference = url.searchParams.get('reference') || '';
      const receipt = completedPayments.get(reference);
      return receipt
        ? sendJson(response, 200, { receipt })
        : sendJson(response, 404, { error: 'A verified payment receipt was not found.' });
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && !url.pathname.startsWith('/api/')) {
      return serveStatic(url.pathname, request, response);
    }
    return sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    if (status >= 500) console.error('Payment request failed:', error.message);
    return sendJson(response, status, { error: status === 503 ? error.message : (status >= 500 ? 'Payment service is temporarily unavailable. Please try again.' : error.message) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Student portal is running at http://${HOST}:${PORT}`);
  if (!process.env.PAYSTACK_SECRET_KEY || process.env.PAYSTACK_SECRET_KEY.includes('paste_your_secret_key')) {
    console.log('Add your Paystack test secret key to .env before starting checkout.');
  }
});

