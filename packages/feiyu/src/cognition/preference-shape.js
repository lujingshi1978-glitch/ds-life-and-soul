const fields={attraction:180,reservations:180,scope:140};
export function preferenceShape(op,{required=false}={}){
 if(op.kind!=='interest')return {text:op.text,preference:null};
 const p=op.preference;if(p===undefined&&!required)return {text:op.text,preference:null};
 const invalid=(code,path)=>{const e=new Error(code);e.code=code;e.details={path,expected:'interest.preference={attraction:具体吸引或排斥点,reservations:保留意见可为空,scope:实际认识范围与未知；经历复述、与谁分享、行动安排另存}'};throw e;};
 if(p===undefined)invalid('INTEREST_PREFERENCE_REQUIRED','dispositions.interest.preference');
 if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!Object.hasOwn(fields,k)))invalid('INVALID_INTEREST_PREFERENCE','dispositions.interest.preference');
 for(const [key,max]of Object.entries(fields))if(typeof p[key]!=='string'||[...p[key]].length>max||key!=='reservations'&&!p[key].trim())invalid('INVALID_INTEREST_PREFERENCE','dispositions.interest.preference.'+key);
 const preference=Object.fromEntries(Object.keys(fields).map(k=>[k,p[k].trim()]));return {preference,text:'吸引点：'+preference.attraction+(preference.reservations?'\n保留：'+preference.reservations:'')+'\n认识范围：'+preference.scope};
}
