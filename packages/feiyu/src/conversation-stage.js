import {randomUUID} from 'node:crypto';

// Delivery guard only. The character decides what to say without a relationship quota.
export function conversationBatchLimit(config={}){
  return null; // Retired behavioral quota, retained export for existing callers.
}

export function stageShouldClose(stage,now,settings={}){
  if(!stage?.messages?.some(m=>m.role==='user'))return false;
  const incoming=[...stage.messages].reverse().find(m=>m.role==='user');
  const farewell=/^(?:那我先)?(?:晚安|拜拜|不聊了|先下了|我下了|睡了|再见)[呀啦哦哈吧!！。～~\s]*$/.test(incoming?.text?.trim()||'');
  const required=farewell?Number(settings.farewellIdleMs)||60000:Number(settings.stageIdleMs)||600000;
  return now-Number(stage.lastAt||stage.startedAt)>=required;
}

// Stage collection feeds the existing memory queues. A pending close is persisted
// before its consumer runs and survives failures or restart under the same stage ID.
export function createConversationStageSystem({conversations,settings=()=>({}),persist,onStageClosed=()=>{},ready=()=>true,now=Date.now}){
  let running=false;
  const privateKey=key=>key.startsWith('private:');
  function ensure(key,state){
    return {scoring:false,stage:state.conversationStage||null,pending:state.conversationStagePending||null};
  }
  function record(key,state,role,text,at=now(),messageId=''){
    if(!privateKey(key))return;
    let stage=state.conversationStage;
    if(!stage)stage=state.conversationStage={id:randomUUID(),startedAt:at,lastAt:at,messages:[]};
    if(messageId&&stage.messages.some(m=>m.id===String(messageId)&&m.role===role))return;
    stage.messages.push({role,text:String(text).slice(0,4000),at,id:String(messageId||'')});stage.lastAt=at;
  }
  async function evaluate(key,force=false){
    if(running||!ready()||!privateKey(key))return {skipped:true};
    running=true;
    try{
      const state=conversations().get(key);if(!state)return {skipped:true};
      if(!state.conversationStagePending){
        const stage=state.conversationStage;
        if(!stage||(!force&&!stageShouldClose(stage,now(),settings()))||!stage.messages.some(m=>m.role==='user'))return {skipped:true};
        const {score,...plain}=stage;
        state.conversationStagePending={...plain,closedAt:now()};state.conversationStage=null;persist();
      }
      const pending=state.conversationStagePending;
      await onStageClosed({key,...pending});
      delete state.conversationStagePending;persist();
      return {ok:true,scoring:false,stageId:pending.id};
    }finally{running=false;}
  }
  async function tick(){
    if(!ready()||running)return;
    for(const [key]of conversations()){if(running)break;await evaluate(key);}
  }
  // Retain the current contextual API for existing bridge callers.
  async function waitToSend(){}
  function adjust(){throw Object.assign(Error('RELATIONSHIP_SCORING_RETIRED'),{statusCode:410});}
  return {record,ensure,evaluate,tick,waitToSend,adjust};
}
