import { Type } from '@google/genai';

// ─────────────────────────────────────────────
//  Declarations
// ─────────────────────────────────────────────
export const networkDeclarations = [
  {
    name: 'fetch_url',
    description:
      'Make an HTTP request to a URL and return the response. Supports GET, POST, PUT, DELETE. Can send JSON bodies and custom headers. Useful for calling APIs, checking endpoints, or fetching web content.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: 'The full URL to request, e.g. "https://api.github.com/users/octocat".',
        },
        method: {
          type: Type.STRING,
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'],
          description: 'HTTP method. Default: GET.',
        },
        headers: {
          type: Type.STRING,
          description: 'JSON string of request headers, e.g. \'{"Authorization": "Bearer token", "Content-Type": "application/json"}\'.',
        },
        body: {
          type: Type.STRING,
          description: 'Request body as a string (for POST/PUT/PATCH). For JSON, stringify it.',
        },
        timeout_seconds: {
          type: Type.INTEGER,
          description: 'Request timeout in seconds. Default: 15.',
        },
      },
      required: ['url'],
    },
  },
];

// ─────────────────────────────────────────────
//  Implementation
// ─────────────────────────────────────────────
export async function executeNetworkTool(name, args) {
  if (name !== 'fetch_url') throw new Error(`Unknown network tool: ${name}`);

  const method = args.method ?? 'GET';
  const timeout = (args.timeout_seconds ?? 15) * 1000;

  let headers = {};
  if (args.headers) {
    try {
      headers = JSON.parse(args.headers);
    } catch {
      throw new Error('Invalid headers JSON: ' + args.headers);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchOptions = {
      method,
      headers,
      signal: controller.signal,
    };

    if (args.body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      fetchOptions.body = args.body;
      if (!headers['Content-Type'] && !headers['content-type']) {
        fetchOptions.headers['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(args.url, fetchOptions);
    clearTimeout(timer);

    const contentType = res.headers.get('content-type') || '';
    let body;

    if (contentType.includes('application/json')) {
      try {
        body = await res.json();
      } catch {
        body = await res.text();
      }
    } else {
      const text = await res.text();
      // Trim large HTML responses
      body = text.length > 5000 ? text.slice(0, 5000) + '\n... [truncated]' : text;
    }

    // Collect response headers
    const responseHeaders = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      success: res.ok,
      url: args.url,
      method,
      status: res.status,
      status_text: res.statusText,
      headers: responseHeaders,
      body,
    };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${args.timeout_seconds ?? 15}s`);
    }
    throw new Error(`Fetch failed: ${err.message}`);
  }
}