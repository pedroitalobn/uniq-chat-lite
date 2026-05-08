// sw.js — Service Worker do Uniq.chat
//
// Estratégias:
//   • API (/v1, /api):        network-first sem cache (dados sempre frescos)
//   • Mesma origem static:    stale-while-revalidate (cache responde rápido,
//                              atualização em background pra próxima visita)
//   • HTML / navigation:      network-first com fallback pro cache, e em
//                              último caso pra /offline.html
//
// Bump CACHE_VERSION quando publicar mudanças que invalidam o cache antigo
// (ex: trocar formato de manifest, atualizar offline shell). O activate handler
// limpa caches que não casam com a versão atual.

const CACHE_VERSION = "uniq-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Shell mínimo pré-cacheado no install — garante que o app abre offline
// mesmo na primeira vez sem rede. /offline.html é a página fallback.
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/logo-dark.png",
  "/logo-light.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/v1/")
    || url.pathname.startsWith("/api/")
    || url.pathname.startsWith("/auth/");
}

function isStaticAsset(url) {
  // _next/static é imutável (hash no nome), .png/.jpg/.svg/.woff2/.css/.js
  // são candidatos a cache longo.
  return url.pathname.startsWith("/_next/static/")
    || /\.(png|jpe?g|svg|webp|avif|ico|woff2?|ttf|otf|css|js)$/.test(url.pathname);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Só lida com same-origin — cross-origin (WS, CDN externo, Stripe…) deixa
  // o navegador resolver direto.
  if (url.origin !== self.location.origin) return;

  // API: network-first, sem cache. Se falhar, deixa propagar — caller decide.
  if (isApiRequest(url)) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ error: "offline" }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      ))
    );
    return;
  }

  // Navegação (HTML): network-first com fallback offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          // Guarda copia no runtime cache pra fallback futuro.
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return resp;
        })
        .catch(async () => {
          const cached = await caches.match(req);
          if (cached) return cached;
          return caches.match("/offline.html");
        })
    );
    return;
  }

  // Estáticos: stale-while-revalidate.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const networkFetch = fetch(req).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(req, copy));
          }
          return resp;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }
});
