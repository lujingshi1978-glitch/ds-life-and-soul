import {randomUUID} from 'node:crypto';
import {json,fail,assertSignal} from './contracts.js';

// DSH's public llm service, used without Agent/SessionController or global memory providers.
export function dshModelAdapter(llm,{provider,model,maxTokens=6000}={}){
  if(typeof llm?.stream!=='function'||!provider||!model)fail('EXPLICIT_DSH_MODEL_REQUIRED');
  return async(input,signal)=>{
    const messages=[{role:'user',content:[{type:'text',text:json(input.material)}]}];let text='',finish,usage;
    try{
      for await(const chunk of llm.stream({provider,model,system:input.system,messages,tools:[],reasoningEffort:'low',maxTokens,signal})){
        assertSignal(signal);if(chunk.type==='text-delta')text+=chunk.text;if(text.length>24000)fail('MODEL_OUTPUT_TOO_LARGE');if(chunk.type==='usage')usage=chunk.usage;if(chunk.type==='finish')finish=chunk.reason;
      }
      assertSignal(signal);if(finish?.kind!=='stop')fail('MODEL_NOT_COMPLETED');
      const clean=text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');return {data:JSON.parse(clean),receipt:{id:randomUUID(),usage,disposed:true,transcriptPersisted:false}};
    }finally{messages.length=0;text='';}
  };
}
