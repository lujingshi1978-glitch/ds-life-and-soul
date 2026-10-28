import path from 'node:path';

// Inspect only the two non-secret scalar fields needed for the legacy dependency.
export function legacyOpenBiliEmbeddingHost(toml,projectRoot){
  let section='',model,baseUrl;const seen=new Set();
  for(const line of String(toml).split(/\r?\n/)){
    const header=line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if(header){section=header[1].trim();continue;}
    if(section!=='llm.embedding')continue;
    const assignment=line.match(/^\s*(model|base_url)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?$/);
    if(!assignment)continue;
    const [,key,value]=assignment;if(seen.has(key))return null;seen.add(key);
    let text;try{text=value.startsWith('"')?JSON.parse(value):value.slice(1,-1);}catch{return null;}
    if(key==='model')model=text;else baseUrl=text;
  }
  if(typeof model!=='string'||!/^BAAI\/bge-small-zh-v1\.5(?:@|$)/.test(model))return null;
  let endpoint;try{endpoint=new URL(baseUrl);}catch{return null;}
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.port!=='3114'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||!['/v1','/v1/'].includes(endpoint.pathname))return null;
  const runtime=path.resolve(projectRoot,'../../work/cognition-v2-embedding');
  return {runtime,root:path.join(runtime,'compat-root')};
}

export function openBiliEmbeddingConfig(embedding){
  const endpoint=new URL(embedding.endpoint);
  if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/v1/embeddings'||!Number.isSafeInteger(embedding.dimensions)||embedding.dimensions<1)throw Error('Invalid local OpenBiliClaw embedding configuration');
  return {baseUrl:endpoint.origin+'/v1',dimensions:embedding.dimensions};
}
