/// <reference types="serviceworker" />

globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.skipWaiting());
});

globalThis.addEventListener('activate', (event) => {
  event.waitUntil(globalThis.clients.claim());
});

globalThis.addEventListener('fetch', (event) => {
  if (new URL(event.request.url).pathname !== '/sw-status') return;
  event.respondWith(new Response('sw ready!'));
});
