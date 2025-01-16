/// <reference types="@fastly/js-compute" />
import { env } from "fastly:env";


const CONFIG = {
  MAX_PROXY_DEPTH: env('MAX_PROXY_DEPTH') || 5,
  REQUEST_TIMEOUT_MS: env('REQUEST_TIMEOUT_MS') || 8000,
  ProxyChain: 'x-proxy-chain',
  LoopCount: 'x-loop-count', 
  TargetURL: 'x-target-url',
  HashMap: env('HashAuth') || 'xxx-xxx',
};

const headersToDelete = [
  CONFIG.HashMap,
  CONFIG.ProxyChain, 
  CONFIG.TargetURL,
  CONFIG.LoopCount,
  'traceparent',
  'x-amzn-trace-id',
  'cdn-loop',
  'cf-connecting-ip',
  'cf-ew-via',
  'cf-ray',
  'cf-visitor', 
  'cf-worker',
  'cf-ipcountry',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-real-ip',
  'forwarded',
  'client-ip',
];

const headersToDelete2 = headersToDelete.slice(4);

function parseProxyConfig(request) {
  const encodedProxyChain = request.headers.get(CONFIG.ProxyChain);
  const loopCount = parseInt(request.headers.get(CONFIG.LoopCount) ?? '0');
  let targetUrl = request.headers.get(CONFIG.TargetURL);

  let proxyChain = encodedProxyChain ? JSON.parse(atob(encodedProxyChain)) : [];
  if (loopCount > CONFIG.MAX_PROXY_DEPTH) {
    throw {
      message: `Proxy depth exceeds maximum limit (${CONFIG.MAX_PROXY_DEPTH})`,
      statusCode: 400
    };
  }

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set(CONFIG.LoopCount, (loopCount + 1).toString());

  if (proxyChain.length > 0) {
    targetUrl = proxyChain.shift();
    const remainingChain = proxyChain.length > 0 ? btoa(JSON.stringify(proxyChain)) : "e30=";
    proxyHeaders.set(CONFIG.ProxyChain, remainingChain);
    headersToDelete2.forEach(header => proxyHeaders.delete(header));
  } else {
    headersToDelete.forEach(header => proxyHeaders.delete(header));
  }

  proxyHeaders.set("host", (new URL(targetUrl)).hostname);

  return {
    targetUrl,
    method: request.method,
    headers: proxyHeaders,
    body: request.body
  };
}

async function proxyRequest(config) {
  try {
    const finalResponse = await fetch(config.targetUrl, {
      method: config.method,
      headers: config.headers,
      body: config.body
    });

    return new Response(finalResponse.body, {
      status: finalResponse.status,
      headers: finalResponse.headers
    });
  } catch (error) {
    return new Response(
      error.message || 'Proxy request failed',
      { status: 502 }
    );
  }
}

async function handleRequest(event) {
  try {
    const request = event.request;

    if (!request.headers.has(CONFIG.HashMap)) {
      return new Response("", { status: 444 });
    }

    const proxyConfig = parseProxyConfig(request);
    return await proxyRequest(proxyConfig);
  } catch (error) {
    return new Response(error.message || 'Internal Server Error', {
      status: error.statusCode || 500
    });
  }
}

// Register the fetch event listener
addEventListener("fetch", event => event.respondWith(handleRequest(event)));
