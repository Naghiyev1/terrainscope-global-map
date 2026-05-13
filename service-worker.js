const CACHE_NAME="terrainscope-v1-0";
const APP_SHELL=["./","./index.html","./style-v1-0.css","./app-v1-0.js","./icon.svg","./manifest.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_SHELL)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ns=>Promise.all(ns.filter(n=>n!==CACHE_NAME).map(n=>caches.delete(n)))));self.clients.claim()});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{
    const c=r.clone();
    caches.open(CACHE_NAME).then(cache=>cache.put(e.request,c));
    return r;
  }).catch(()=>caches.match(e.request)));
});
