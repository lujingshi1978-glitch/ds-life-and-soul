import {tuningFor} from '../runtime-tuning.js';
import {qualifyRecallMemory} from './recall-relevance.js';
import {planRecallBudget,finishRecallBudget} from './recall-budget.js';

// A turn-local material budget. It changes a view, never stored memories or permissions.
export function packRecall(retriever,rows,{query,entities=[],depth='shallow',purpose='general',budgetChars,budgetPolicy,signals={},...packOptions}){
 const tuning=tuningFor(retriever),base=purpose==='stimulus-associate'?tuning.memory.associationBudgetChars:depth==='deep'?tuning.memory.deepRecallBudgetChars:tuning.memory.recallBudgetChars;
 const contextual=retriever.relevanceMode!=='legacy',scopeEntity=/^private:\d+$/.test(packOptions.expressionScope||'')?'qq:'+packOptions.expressionScope.slice(8):null,contextEntities=entities.length?entities:scopeEntity?[scopeEntity]:[];
 const qualified=contextual?rows.filter(m=>qualifyRecallMemory(m,{query,...signals,entities:contextEntities})):rows;
 const elastic=tuning.memory.elasticRecallEnabled===1&&budgetPolicy?.elastic!==false&&(budgetChars===undefined||budgetPolicy?.elastic===true);
 // Existing explicit per-call budgets remain finite unless the host opts into an elastic turn.
 const ceiling=budgetPolicy?.ceilingChars??(!elastic&&budgetChars!==undefined?budgetChars:Math.max(base,tuning.memory.deepRecallBudgetChars));
 const common={entities,depth,query,...packOptions},demand=retriever.pack(qualified,{...common,budgetChars:Math.max(ceiling,tuning.text.thoughtInputChars)});
 const plan=planRecallBudget({baseChars:base,requestedChars:budgetChars,elastic,maxExpansionRatio:tuning.memory.elasticRecallMaxRatio,callerCeilingChars:ceiling,contextAllowanceChars:budgetPolicy?.contextAllowanceChars,demandChars:demand.chars});
 const packed=retriever.pack(qualified,{...common,budgetChars:plan.effective});
 return {...packed,budget:finishRecallBudget(plan,{actualChars:packed.chars,omittedForBudget:packed.omittedForBudget}),relevance:{mode:contextual?'contextual':'legacy',candidates:rows.length,qualified:qualified.length,excludedBackground:rows.length-qualified.length}};
}
