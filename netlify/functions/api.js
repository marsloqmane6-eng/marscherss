'use strict';

// Netlify invokes this function for every /api/* request. serverless-http
// translates the event into the request/response objects used by server.js.
const serverless = require('serverless-http');
const { requestListener } = require('../../server');

const proxy = serverless(requestListener, { binary: false });

exports.handler = async (event, context) => {
  // The /api/* redirect puts the original API suffix in __mc_path. This is
  // more reliable than event.path, which can be rewritten to the function URL.
  try {
    let restoredFromQuery = false;
    const query = event.queryStringParameters || {};
    if (query.__mc_path !== undefined) {
      const suffix = String(query.__mc_path || '');
      event.path = '/api/' + suffix.replace(/^\/+/, '');
      delete query.__mc_path;
      event.queryStringParameters = query;
      restoredFromQuery = true;
    }

    const raw = event.rawUrl || event.raw_url;
    if (raw) {
      const publicUrl = new URL(raw);
      if (!restoredFromQuery && publicUrl.pathname.startsWith('/api/')) {
        event.path = publicUrl.pathname;
      }
    }
  } catch (e) {
    // Fall back to the path Netlify supplied.
  }
  return proxy(event, context);
};
