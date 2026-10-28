// Conversation ownership lives outside ReactLoopAgent. DSH's session controller
// is an execution backend; ordinary DSH sessions never enter this state machine.
export function createChatCycles({ resolve, execute, now = Date.now }) {
  const cycles = new Map();
  const inflight = new Map();
  let disposed = false;
  async function submit(event, content, requestId) {
    if (disposed) throw Error('Chat cycles disposed');
    const agent = await resolve(event.sessionId);
    if(disposed)throw Error('Chat cycles disposed');
    if (!agent || agent.session.header.agentPreset !== 'qq-chat-v2') throw Error('Only QQ chat sessions may enter a chat cycle');
    const previous = cycles.get(event.sessionId);
    if (previous && previous.key !== event.key) throw Error('Chat cycle contact mismatch');
    const duplicate = previous?.receipts.get(requestId);
    if (duplicate) return duplicate;
    const identity = event.sessionId + ':' + requestId;
    if (inflight.has(identity)) return inflight.get(identity);
    const cycle = previous ?? { sessionId:event.sessionId, key:event.key, openedAt:now(), phase:'open', events:0, receipts:new Map() };
    if (cycle.phase === 'closed') throw Error('Chat cycle closed; open a new session');
    cycles.set(event.sessionId, cycle);
    cycle.phase = 'receiving'; cycle.updatedAt = now(); cycle.events++;
    const work = (async()=>{
      try {
        const value = await execute({ sessionId:event.sessionId, requestId, mode:'queue', content },event);
        if(cycle.phase!=='closed')cycle.phase = agent.status === 'running' ? 'responding' : 'waiting';
        cycle.updatedAt = now();
        cycle.receipts.set(requestId,value);
        while(cycle.receipts.size>100)cycle.receipts.delete(cycle.receipts.keys().next().value);
        return value;
      } catch(error) { if(cycle.phase!=='closed')cycle.phase='failed';cycle.updatedAt=now();throw error; }
      finally { inflight.delete(identity); }
    })();
    inflight.set(identity,work);
    return work;
  }
  return {
    submit,
    observe(sessionId,event) {
      const cycle=cycles.get(sessionId);if(!cycle||cycle.phase==='closed')return;
      if(event.type==='turn/start')cycle.phase='responding';
      else if(event.type==='turn/end')cycle.phase=event.data?.reason?.kind==='error'?'failed':'waiting';
      else return;
      cycle.updatedAt=now();
    },
    close(sessionId) {const c=cycles.get(sessionId);if(c){c.phase='closed';c.updatedAt=now();}},
    status(){return [...cycles.values()].map(({receipts,...row})=>({...row}));},
    dispose(){disposed=true;for(const c of cycles.values()){c.phase='closed';c.receipts.clear();}cycles.clear();},
  };
}
