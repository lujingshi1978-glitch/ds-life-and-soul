import { createHmac } from 'node:crypto';

const J = JSON.stringify;

export function parseThought(raw) {
  const s = String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (s.length > 24000) throw Error('Thought JSON too large');
  try{return JSON.parse(s);}catch(original){
    // Some providers return the documented object shape with bare identifier
    // keys. Quote only that syntax outside JSON strings. Never eval or accept
    // expressions, function calls, comments, single-quoted values or NaN.
    let fixed='',quoted=false,escaped=false;
    for(let i=0;i<s.length;i++){
      const c=s[i];fixed+=c;
      if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
      if(c==='"'){quoted=true;continue;}
      if(c==='{'||c===','){const m=s.slice(i+1).match(/^(\s*)([A-Za-z_$][\w$]*)(\s*):/);if(m){fixed+=m[1]+JSON.stringify(m[2])+m[3]+':';i+=m[0].length;}}
    }
    if(fixed===s)throw original;return JSON.parse(fixed);
  }
}

// Shared by current cognition and legacy tooling; no memory store is loaded here.
export async function callThought(api, secret, input, signal) {
  const payload = J(input), signature = createHmac('sha256', secret).update(payload).digest('hex');
  const response = await api.doFetch(new URL('/api/feiyu-thought', api.baseUrl), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: J({ payload, signature }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(190000)]) : AbortSignal.timeout(190000),
  });
  const data = await response.json(); if (!response.ok || !data.ok) throw Error(data.error || 'Thought unavailable');
  if (data.receipt?.transcriptPersisted !== false || data.receipt?.disposed !== true) throw Error('Thought isolation unverified');
  return { data: input.json === false ? data.text : parseThought(data.text), receipt: data.receipt };
}
