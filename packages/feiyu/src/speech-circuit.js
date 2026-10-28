// Prevent one failed voice task from monopolizing the serial chat lane.
export class SpeechCircuit {
 constructor({now=Date.now,cooldownMs=90000}={}){this.now=now;this.cooldownMs=cooldownMs;this.scopes=new Map();this.active=false;this.nextAt=0;}
 async run(scope,action){
  const entry=this.scopes.get(scope)||{attempts:0,failed:false};
  if(entry.failed)throw Error('本轮语音已失败，停止重试；可简短说明失败后结束本轮，不补发整段文字讲解');
  if(this.active||this.now()<this.nextAt)throw Error('语音通道正在处理或暂时冷却；本轮不等待、不重试，可简短说明后正常收尾');
  entry.attempts++;this.scopes.set(scope,entry);while(this.scopes.size>100)this.scopes.delete(this.scopes.keys().next().value);this.active=true;
  try{return await action();}catch(error){entry.failed=true;this.nextAt=this.now()+this.cooldownMs;throw Error('语音合成失败，本轮禁止重试，通道冷却90秒。可简短告知后收尾，不补发讲解、不重复已成功语音。原因：'+String(error.message||error).slice(0,180));}finally{this.active=false;}
 }
}
