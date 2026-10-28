import {randomUUID} from 'node:crypto';
import {fail,assertSignal} from './contracts.js';

export class CognitiveAttention {
  constructor(){this.active=null;this.queue=[];this.closed=false;}
  acquire(kind,peer,{signal,background=false}={}){
    if(this.closed)fail('CLOSED');assertSignal(signal);
    return new Promise((resolve,reject)=>{
      const item={kind,peer,background,resolve,reject,signal};
      item.cancel=()=>{this.queue=this.queue.filter(x=>x!==item);reject(signal.reason||new Error('Aborted'));};signal?.addEventListener('abort',item.cancel,{once:true});
      if(background&&(this.active||this.queue.length)){signal?.removeEventListener('abort',item.cancel);resolve(null);return;}
      this.queue.push(item);if(!background&&this.active?.background)this.active.abort.abort(new Error('FOREGROUND_PREEMPTION'));this.drain();
    });
  }
  drain(){
    if(this.active||!this.queue.length||this.closed)return;const item=this.queue.shift();item.signal?.removeEventListener('abort',item.cancel);
    if(item.signal?.aborted){item.reject(item.signal.reason);this.drain();return;}
    const abort=new AbortController(),lease={id:randomUUID(),kind:item.kind,peer:item.peer,background:item.background,abort};
    lease.signal=item.signal?AbortSignal.any([item.signal,abort.signal]):abort.signal;
    lease.assert=()=>{if(this.active!==lease||lease.signal.aborted)fail('ACTIVITY_LEASE_REVOKED');};
    lease.release=()=>{if(this.active===lease){this.active=null;this.drain();}};this.active=lease;item.resolve(lease);
  }
  status(){return {active:this.active?{id:this.active.id,kind:this.active.kind,peer:this.active.peer,background:this.active.background}:null,queued:this.queue.map(q=>({kind:q.kind,peer:q.peer}))};}
  close(){this.closed=true;this.active?.abort.abort(new Error('CLOSED'));for(const i of this.queue){i.signal?.removeEventListener('abort',i.cancel);i.reject(new Error('CLOSED'));}this.queue=[];}
}
