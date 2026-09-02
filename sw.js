// hss-exam-video Service Worker
// index.html / config.js / data/*.json を変えたら CACHE_NAME を必ず上げる（README§当日運用）
var CACHE_NAME = "hss-exam-video-v6";
var ASSETS = [
  "./",
  "./index.html",
  "./config.js",
  "./data/questions.json",
  "./data/demo-questions.json",
  "./manifest.json",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      // {cache:"reload"}: ブラウザHTTPキャッシュを迂回し、新キャッシュに旧ファイルが混入しないようにする
      return cache.addAll(ASSETS.map(function(u) { return new Request(u, { cache: "reload" }); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(name) { return name !== CACHE_NAME; })
             .map(function(name) { return caches.delete(name); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function(event) {
  // Skip non-GET requests and webhook calls
  if (event.request.method !== "GET") return;
  if (event.request.url.includes("script.google.com")) return;
  if (event.request.url.includes("cdnjs.cloudflare.com")) return;
  if (event.request.url.includes("cdn.jsdelivr.net")) return;
  // 動画はSWで扱わない: <video> の Range(206) 応答をキャッシュすると再生不能になる事故があるため。
  // 事前読込は index.html 側が fetch→Blob で行い、ブラウザHTTPキャッシュに任せる
  if (event.request.url.includes("/videos/")) return;
  if (event.request.headers.get("range")) return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then(function(cached) {
      if (cached) {
        // Return cached, but also update cache in background
        var fetchPromise = fetch(event.request).then(function(response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function(cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function() {});
        return cached;
      }
      return fetch(event.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
