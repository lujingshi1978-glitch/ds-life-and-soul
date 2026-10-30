import {terms} from './contracts.js';
import {currentTopicCue} from './memory-activation.js';

// These are discourse cues, not subjects. Remove whole phrases before CJK
// tokenization so overlapping trigrams such as "在干什" do not become topics.
const discourse=/(?:你现在在干什么|你最近在干什么|在干什么|在干嘛|在干吗|在做什么|在做啥|在忙啥|忙什么|忙啥|在吗|还记不记得|还记得|有没有|能不能|怎么样|怎么办|怎么说|说说看|为什么|好久不见|你好呀|你好|\b(?:hello|hi)\b|\b(?:the|and|what|how|are|you|your|have|has|been|doing|recently)\b|你对我|你和我|你跟我|对我|和我|跟我|自己|我们|你们|他们|对方|现在|今天|最近|目前|之前|刚才|这回|上回|以后|当时|时候|什么|怎么|觉得|想法|感觉|东西|一点|愿意|没有|不会|不是|可以|一起|好奇|了解|实际|确实|有点|还有|还是|不用|不急|这个|那个|那段|我的|你的|本来|一些|有些|也是|就是|究竟|了吗)/giu;
const trivial=new Set(['我','你','他','她','它','的','了','吗','呢','啊','呀','哦','吧','嗯','在','很','都','也','就','再','和','与','说','聊','想','问','请','好','有','是']);

export function recallQueryTerms(query=''){
 const cue=currentTopicCue(query).query.normalize('NFKC').toLowerCase().replace(discourse,' ');
 return terms(cue).filter(t=>!trivial.has(t));
}

// Relevance never changes memory bytes, evidence, subject, status or authority.
// Detail and topic fields matter: an accurate short gist need not repeat every
// distinctive name/item that was retained in a longer, source-backed detail.
export function queryRelevance(memory,query=''){
 const queryTerms=Array.isArray(query)?query:recallQueryTerms(query),d=memory?.metadata?.disposition;
 const text=[memory?.gist,memory?.detail,memory?.metadata?.topic,d?.target,d?.facet,...(memory?.metadata?.tags||[]),...(memory?.metadata?.aliases||[])].filter(Boolean).join(' '),tokens=new Set(terms(text));
 const matchedTerms=queryTerms.filter(t=>tokens.has(t)),coverage=queryTerms.length?matchedTerms.length/queryTerms.length:0;
 return {queryTerms,matchedTerms,coverage,specific:queryTerms.length>0,direct:matchedTerms.length>0,kind:!queryTerms.length?'generic':matchedTerms.length?'direct':'unrelated'};
}

export function isContactReflectionQuery(query=''){
 const q=currentTopicCue(query).query;
 return /(?:对我(?:这个人|本人)?(?:是|有|的|现在|还|什么|怎么|怎样|怎么样|如何|到底|究竟|一点|多大)*(?:感觉|感受|印象|看法)|(?:愿不愿意|还愿意|愿意|想不想|喜欢|讨厌|不想).{0,3}(?:和我|跟我).{0,4}(?:聊|相处|说话)|我们.{0,4}(?:关系|相处)|我在你.{0,4}(?:心里|眼里)|你(?:现在|还|会|是|不是|是不是|有没有|有点|真的|到底|很|更|特别|那么|多么|不|再)*(?:喜欢|讨厌|恨|爱|想念|信任|在乎)我|feel.{0,10}about me|our relationship|like talking to me)/iu.test(q);
}

const ownContactAttitude=(memory,entities)=>memory?.metadata?.disposition?.kind==='attitude'&&entities.includes(memory.metadata.disposition.target);

export function recallRelevance(memory,query='',{primaryIds=new Set(),semanticIds=new Set(),associationIds=new Set(),supplementalRefs=new Map(),entities=[],contactReflection=false}={}){
 const q=queryRelevance(memory,query),semantic=semanticIds.has(memory.id)&&q.specific,association=associationIds.has(memory.id)&&q.specific,supplemental=supplementalRefs.has(memory.id)&&Number.isSafeInteger(memory.revision)&&supplementalRefs.get(memory.id)===memory.revision&&q.specific,primary=primaryIds.has(memory.id),contact=contactReflection&&ownContactAttitude(memory,entities);
 const route=contact?'contact-reflection':q.direct?'direct':semantic?'semantic':association?'association':supplemental?'reviewed-supplement':q.specific?'background':'generic';
 const strength=contact?.8:q.direct?Math.sqrt(q.coverage):semantic?.75:association?.45:supplemental?.65:0;
 return {...q,primary,semantic,association,supplemental,contact,route,strength,expandable:contact||q.direct||semantic||association||supplemental};
}

// This is a relevance qualifier after the host's existing eligibility/privacy
// checks, never a replacement for them. It does not fetch arbitrary neighbors.
export function qualifyRecallMemory(memory,{query='',entities=[],primaryIds=new Set(),semanticIds=new Set(),associationIds=new Set(),supplementalRefs=new Map()}={}){
 return recallRelevance(memory,query,{entities,primaryIds,semanticIds,associationIds,supplementalRefs,contactReflection:isContactReflectionQuery(query)}).expandable;
}


