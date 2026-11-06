/* 由 tools/build-sw.js 生成，勿手改。版本：v1
 * 策略：应用外壳 cache-first（离线可用），同时在后台静默更新；
 *       导航请求 network-first，断网时回落到缓存的 index.html。 */
const VERSION = 'v1';
const CACHE = 'wordfun-' + VERSION;

const PRECACHE = [
  "./",
  "index.html",
  "style.css",
  "words.js",
  "app.js",
  "manifest.webmanifest",
  "tools/legacy-map.js",
  "assets/fonts/kenpixel.ttf",
  "assets/icons/alt-scenery-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/icon-180.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-512.png",
  "assets/sprites.css",
  "assets/tex/edge.png",
  "assets/tex/grass.png",
  "assets/tex/soil.png",
  "assets/tex/wood-dark.png",
  "assets/tex/wood.png",
  "assets/tinyfarm/tile_0000.png",
  "assets/tinyfarm/tile_0001.png",
  "assets/tinyfarm/tile_0002.png",
  "assets/tinyfarm/tile_0003.png",
  "assets/tinyfarm/tile_0004.png",
  "assets/tinyfarm/tile_0005.png",
  "assets/tinyfarm/tile_0006.png",
  "assets/tinyfarm/tile_0007.png",
  "assets/tinyfarm/tile_0008.png",
  "assets/tinyfarm/tile_0009.png",
  "assets/tinyfarm/tile_0010.png",
  "assets/tinyfarm/tile_0011.png",
  "assets/tinyfarm/tile_0012.png",
  "assets/tinyfarm/tile_0013.png",
  "assets/tinyfarm/tile_0014.png",
  "assets/tinyfarm/tile_0015.png",
  "assets/tinyfarm/tile_0016.png",
  "assets/tinyfarm/tile_0017.png",
  "assets/tinyfarm/tile_0018.png",
  "assets/tinyfarm/tile_0019.png",
  "assets/tinyfarm/tile_0020.png",
  "assets/tinyfarm/tile_0021.png",
  "assets/tinyfarm/tile_0022.png",
  "assets/tinyfarm/tile_0023.png",
  "assets/tinyfarm/tile_0024.png",
  "assets/tinyfarm/tile_0025.png",
  "assets/tinyfarm/tile_0026.png",
  "assets/tinyfarm/tile_0027.png",
  "assets/tinyfarm/tile_0028.png",
  "assets/tinyfarm/tile_0029.png",
  "assets/tinyfarm/tile_0030.png",
  "assets/tinyfarm/tile_0031.png",
  "assets/tinyfarm/tile_0032.png",
  "assets/tinyfarm/tile_0033.png",
  "assets/tinyfarm/tile_0034.png",
  "assets/tinyfarm/tile_0035.png",
  "assets/tinyfarm/tile_0036.png",
  "assets/tinyfarm/tile_0037.png",
  "assets/tinyfarm/tile_0038.png",
  "assets/tinyfarm/tile_0039.png",
  "assets/tinyfarm/tile_0040.png",
  "assets/tinyfarm/tile_0041.png",
  "assets/tinyfarm/tile_0042.png",
  "assets/tinyfarm/tile_0043.png",
  "assets/tinyfarm/tile_0044.png",
  "assets/tinyfarm/tile_0045.png",
  "assets/tinyfarm/tile_0046.png",
  "assets/tinyfarm/tile_0047.png",
  "assets/tinyfarm/tile_0048.png",
  "assets/tinyfarm/tile_0049.png",
  "assets/tinyfarm/tile_0050.png",
  "assets/tinyfarm/tile_0051.png",
  "assets/tinyfarm/tile_0052.png",
  "assets/tinyfarm/tile_0053.png",
  "assets/tinyfarm/tile_0054.png",
  "assets/tinyfarm/tile_0055.png",
  "assets/tinyfarm/tile_0056.png",
  "assets/tinyfarm/tile_0057.png",
  "assets/tinyfarm/tile_0058.png",
  "assets/tinyfarm/tile_0059.png",
  "assets/tinyfarm/tile_0060.png",
  "assets/tinyfarm/tile_0061.png",
  "assets/tinyfarm/tile_0062.png",
  "assets/tinyfarm/tile_0063.png",
  "assets/tinyfarm/tile_0064.png",
  "assets/tinyfarm/tile_0065.png",
  "assets/tinyfarm/tile_0066.png",
  "assets/tinyfarm/tile_0067.png",
  "assets/tinyfarm/tile_0068.png",
  "assets/tinyfarm/tile_0069.png",
  "assets/tinyfarm/tile_0070.png",
  "assets/tinyfarm/tile_0071.png",
  "assets/tinyfarm/tile_0072.png",
  "assets/tinyfarm/tile_0073.png",
  "assets/tinyfarm/tile_0074.png",
  "assets/tinyfarm/tile_0075.png",
  "assets/tinyfarm/tile_0076.png",
  "assets/tinyfarm/tile_0077.png",
  "assets/tinyfarm/tile_0078.png",
  "assets/tinyfarm/tile_0079.png",
  "assets/tinyfarm/tile_0080.png",
  "assets/tinyfarm/tile_0081.png",
  "assets/tinyfarm/tile_0082.png",
  "assets/tinyfarm/tile_0083.png",
  "assets/tinyfarm/tile_0084.png",
  "assets/tinyfarm/tile_0085.png",
  "assets/tinyfarm/tile_0086.png",
  "assets/tinyfarm/tile_0087.png",
  "assets/tinyfarm/tile_0088.png",
  "assets/tinyfarm/tile_0089.png",
  "assets/tinyfarm/tile_0090.png",
  "assets/tinyfarm/tile_0091.png",
  "assets/tinyfarm/tile_0092.png",
  "assets/tinyfarm/tile_0093.png",
  "assets/tinyfarm/tile_0094.png",
  "assets/tinyfarm/tile_0095.png",
  "assets/tinyfarm/tile_0096.png",
  "assets/tinyfarm/tile_0097.png",
  "assets/tinyfarm/tile_0098.png",
  "assets/tinyfarm/tile_0099.png",
  "assets/tinyfarm/tile_0100.png",
  "assets/tinyfarm/tile_0101.png",
  "assets/tinyfarm/tile_0102.png",
  "assets/tinyfarm/tile_0103.png",
  "assets/tinyfarm/tile_0104.png",
  "assets/tinyfarm/tile_0105.png",
  "assets/tinyfarm/tile_0106.png",
  "assets/tinyfarm/tile_0107.png",
  "assets/tinyfarm/tile_0108.png",
  "assets/tinyfarm/tile_0109.png",
  "assets/tinyfarm/tile_0110.png",
  "assets/tinyfarm/tile_0111.png",
  "assets/tinyfarm/tile_0112.png",
  "assets/tinyfarm/tile_0113.png",
  "assets/tinyfarm/tile_0114.png",
  "assets/tinyfarm/tile_0115.png",
  "assets/tinyfarm/tile_0116.png",
  "assets/tinyfarm/tile_0117.png",
  "assets/tinyfarm/tile_0118.png",
  "assets/tinyfarm/tile_0119.png",
  "assets/tinyfarm/tile_0120.png",
  "assets/tinyfarm/tile_0121.png",
  "assets/tinyfarm/tile_0122.png",
  "assets/tinyfarm/tile_0123.png",
  "assets/tinyfarm/tile_0124.png",
  "assets/tinyfarm/tile_0125.png",
  "assets/tinyfarm/tile_0126.png",
  "assets/tinyfarm/tile_0127.png",
  "assets/tinyfarm/tile_0128.png",
  "assets/tinyfarm/tile_0129.png",
  "assets/tinyfarm/tile_0130.png",
  "assets/tinyfarm/tile_0131.png"
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 跨域（发音等）直接走网络

  // 页面导航：先网络（拿到新版本），断网再用缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 其余静态资源：先用缓存（秒开），后台顺便更新
  e.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
