export function monitorChildHttp(child,{url,graceMs=120000,intervalMs=15000,timeoutMs=2000,threshold=3,fetchImpl=fetch,now=Date.now,isCurrent=()=>true,onStatus=()=>{},onUnresponsive=()=>child.kill()}={}){
 const started=now();let failures=0,checking=false,closed=false;
 const eligible=()=>!closed&&isCurrent()&&child.exitCode===null&&!child.killed;
 const check=async()=>{if(checking||!eligible()||now()-started<graceMs)return;checking=true;const start=now();try{
   const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'}),body=await response.json();
   if(!eligible())return;if(!response.ok||body.ok!==true||body.pid!==child.pid)throw Error('HTTP_LIVENESS_FAILED');failures=0;onStatus({ok:true,childPid:child.pid,at:now(),ms:now()-start,failures});
  }catch(error){if(!eligible())return;failures++;onStatus({ok:false,childPid:child.pid,at:now(),ms:now()-start,failures});if(failures>=threshold){closed=true;clearInterval(timer);onUnresponsive({childPid:child.pid,failures});}}
  finally{checking=false;}};
 const timer=setInterval(()=>void check().catch(()=>{}),intervalMs);timer.unref?.();
 return {check,close(){closed=true;clearInterval(timer);},status:()=>({failures,checking,closed})};
}
