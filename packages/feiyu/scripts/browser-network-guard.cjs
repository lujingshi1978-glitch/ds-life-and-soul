// Host-side, context-wide guards cover popup first requests and all frames.
const contexts=new WeakMap(),downloads=new WeakSet();
function watchDownloads(page){if(downloads.has(page))return;downloads.add(page);page.on('download',download=>{try{Promise.resolve(download.cancel()).catch(()=>{});}catch{}});}
exports.default=async({page})=>{
 const context=page.context();let ready=contexts.get(context);
 if(!ready){ready=(async()=>{const {pathToFileURL}=require('node:url'),path=require('node:path'),{validateFetchUrl}=await import(pathToFileURL(path.resolve(__dirname,'../src/safe-fetch.js')).href);
  await context.route('**/*',async route=>{try{const request=route.request();if(process.env.FEIYU_BROWSER_READONLY==='1'&&!['GET','HEAD','OPTIONS'].includes(request.method())){await route.abort('blockedbyclient');return;}await validateFetchUrl(request.url(),{recoverProxyDns:true});await route.continue();}catch{await route.abort('blockedbyclient');}});
  if(typeof context.routeWebSocket!=='function')throw Error('BROWSER_CONTEXT_WEBSOCKET_GUARD_UNAVAILABLE');await context.routeWebSocket(/.*/,socket=>socket.close());context.on('page',watchDownloads);for(const existing of context.pages())watchDownloads(existing);
 })();contexts.set(context,ready);}await ready;watchDownloads(page);
};
