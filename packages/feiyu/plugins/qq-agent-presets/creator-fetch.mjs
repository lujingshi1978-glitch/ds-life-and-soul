// Trusted, tool-free host child; only public GET, no candidate code evaluation.
import {safeFetch} from '../../src/safe-fetch.js';
let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>10000)throw Error('FETCH_INPUT_TOO_LARGE');}
try{const {url}=JSON.parse(raw);const result=await safeFetch(url,120000,{recoverProxyDns:true});process.stdout.write(JSON.stringify({ok:true,result}));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:String(e.code||e.message).slice(0,200)}));process.exitCode=1;}
