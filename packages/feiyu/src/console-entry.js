// This 401 shell contains no credentials or privileged data. APIs still require authentication.
export function consoleEntryPage(){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>连接生活台</title><body><p>正在恢复生活台登录。若令牌已失效，请输入当前控制台访问令牌。</p><script>
const fragment=location.hash;
const supplied=new URLSearchParams(location.search).has('token');
let saved='';try{saved=localStorage.getItem('consoleToken')||'';}catch{}
if(saved&&!supplied){location.replace('/?token='+encodeURIComponent(saved)+fragment);}
else{const token=prompt('请输入控制台访问令牌：');if(token&&token.trim()){location.replace('/?token='+encodeURIComponent(token.trim())+fragment);}else{document.querySelector('p').textContent='尚未登录。请使用“启动肥鱼”重新打开控制台，或刷新后输入访问令牌。';}}
</script></body></html>`;}
