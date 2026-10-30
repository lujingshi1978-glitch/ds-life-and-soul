// Console-only projection. Never changes a knowledge entry, archive or prompt.
const text=(v,max=600)=>typeof v==='string'?Array.from(v.replace(/\bsk-(?:or-v1-|nous-)?[A-Za-z0-9_-]{12,}/gi,'[凭据已隐藏]').replace(/\b(?:token|password|secret|api[_-]?key|authorization)["']?\s*[:=：]\s*(?:"[^"]*"|'[^']*'|[^\s,，;；]+)/gi,'[凭据已隐藏]').trim()).slice(0,max).join(''):'';
const link=value=>{try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}};
const labels={internet:'网络资料','web-reading':'网页资料',chat:'聊天记录','search-snippet':'搜索摘要',bilibili:'哔哩哔哩',youtube:'YouTube',douyin:'抖音',zhihu:'知乎',file:'文件资料',configuration:'角色设定',unavailable:'依据不可用','curated-knowledge':'整理的资料'};
export function knowledgeSourcePresentation(source={},record){
  if(source.kind==='unavailable'||record&&record.available===false)return {...source,kind:'unavailable',title:'依据暂不可用',url:'',excerpt:'',sourceLabel:'依据不可用',presentationVersion:1,notice:'原始依据当前不可用，需重新核对。'};
  const raw=typeof record?.text==='string'?record.text:typeof source.excerpt==='string'?source.excerpt:'',structured=/^[\s]*[\[{"]/.test(raw);let root=raw;
  for(let i=0;i<3&&typeof root==='string'&&/^[\s]*[\[{"]/.test(root);i++)try{root=JSON.parse(root);}catch{break;}
  const fields={title:text(source.title,200),url:link(source.url),platform:'',excerpt:''};let visited=0;
  function walk(value,depth=0){if(!value||typeof value!=='object'||depth>4||++visited>64)return;
    if(Array.isArray(value)){for(const item of value.slice(0,8))walk(item,depth+1);return;}
    if(!fields.title)fields.title=text(value.title||value.name,200);if(!fields.url)fields.url=link(value.url||value.sourceUrl||value.webpage_url);if(!fields.platform)fields.platform=text(value.platform,40);
    if(!fields.excerpt)for(const k of ['description','text','excerpt','summary','subtitle','content','body']){const v=value[k];if(typeof v==='string'&&v.trim()&&!/^[\s]*[\[{]/.test(v)){fields.excerpt=text(v);break;}}
    for(const k of ['info','data','result','video','article','source','content','body','comments']){let child=value[k];if(typeof child==='string'&&/^[\s]*[\[{]/.test(child))try{child=JSON.parse(child);}catch{}walk(child,depth+1);}
  }
  if(root&&typeof root==='object')walk(root);
  else if(typeof root==='string'&&root!==raw&&!/^[\s]*[\[{]/.test(root))fields.excerpt=text(root);
  else if(structured){
    // The safe reader may return only the first page of a long record. Extract
    // complete JSON string fields only; never invent a missing closing value.
    const values={};for(const m of raw.matchAll(/"(title|name|url|sourceUrl|platform|description|text|excerpt|summary|subtitle)"\s*:\s*("(?:[^"\\]|\\.)*")/g))try{if(values[m[1]]===undefined)values[m[1]]=JSON.parse(m[2]);}catch{}
    walk(values);
  }else fields.excerpt=text(typeof root==='string'?root:raw);
  if(!fields.url)fields.url=link(record?.url);if(!fields.title)fields.title=text(record?.title,200);
  const sourceLabel=labels[fields.platform]||labels[source.kind]||'来源资料';return {...source,title:fields.title||sourceLabel,url:fields.url,sourceLabel,excerpt:fields.excerpt,presentationVersion:1,
    notice:structured&&!fields.excerpt?'此记录为结构化资料，可打开来源查看已保存的原文。':''};
}
export function knowledgePageView(page,{readSource}={}){
  const cache=new Map();return {...page,entries:(page.entries||[]).map(entry=>({...entry,sources:(entry.sources||[]).map(source=>{
    const ref=String(source.resourceId||'').match(/^(.+)@(\d+)$/);let record;
    if(readSource&&ref){const key=source.resourceId;if(!cache.has(key))try{cache.set(key,readSource({sourceId:ref[1],revision:Number(ref[2])}));}catch{cache.set(key,{available:false});}record=cache.get(key);}
    return knowledgeSourcePresentation(source,record);
  })}))};
}
