import {monitorEventLoopDelay} from 'node:perf_hooks';
export function runtimeHealth({ready=()=>true,now=Date.now}={}){
 const started=now(),delay=monitorEventLoopDelay({resolution:20});delay.enable();
 let heartbeat=now(),max=0,p99=0;const timer=setInterval(()=>{heartbeat=now();max=Number.isFinite(delay.max)?delay.max/1e6:0;p99=delay.percentile(99)/1e6;delay.reset();},1000);timer.unref();
 return {snapshot:()=>({ok:true,pid:process.pid,uptimeMs:now()-started,heartbeatAt:heartbeat,eventLoop:{maxMs:Math.round(max),p99Ms:Math.round(p99)},ready:!!ready()}),close:()=>{clearInterval(timer);delay.disable();}};
}
