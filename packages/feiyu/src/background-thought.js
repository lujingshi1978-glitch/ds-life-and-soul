// A background model call must give its lane back only after cancellation completes.
export async function backgroundThought(attention,key,invoke){
 const abort=new AbortController(),slot=attention?.tryBackground(key,()=>abort.abort(new Error('BACKGROUND_PREEMPTED')));
 if(attention&&!slot){const error=Error('BACKGROUND_ATTENTION_BUSY');error.code='BACKGROUND_ATTENTION_BUSY';throw error;}
 try{return await invoke(abort.signal);}finally{slot?.release();}
}
