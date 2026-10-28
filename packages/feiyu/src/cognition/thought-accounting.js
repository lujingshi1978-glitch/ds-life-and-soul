import {AsyncLocalStorage} from 'node:async_hooks';
import {hash} from './contracts.js';
import {energyContext} from '../energy-context.js';
const reservations=new AsyncLocalStorage();
export const foregroundThought=fn=>reservations.run({foreground:true},fn);
export const withThoughtReservation=(fn,reservation={reserved:true})=>reservations.run(reservation,fn);
export function thoughtInput(input){return JSON.stringify({core:input.core,prompt:input.prompt,imageCount:input.images?.length||0});}
export async function accountThought(budget,input,invoke,{dailyCostBudget}={}){
  const reservation=reservations.getStore();
  const context=energyContext();
  dailyCostBudget?.assertStart({foreground:reservation?.foreground===true,finishing:context.finishCurrent===true,startedAt:context.costStartedAt});
  if(!budget||reservation?.foreground)return invoke();
  const text=thoughtInput(input),purpose='auxiliary-thought';
  if(reservation?.reserved){
    if(!reservation.budget)return invoke();
    if(!reservation.invoked){
      // Measure again at the final adapter boundary, after the complete role core is added.
      reservation.budget.adjustInputChars(Math.max(0,text.length-reservation.chargedChars),reservation.hour);
      reservation.chargedChars=Math.max(text.length,reservation.chargedChars);reservation.inputHash=hash(text);reservation.invoked=true;
      return invoke();
    }
  }
  const ticket=budget.reserve(purpose,text.length);
  const result=await invoke();
  budget.receipt({purpose,inputHash:hash(text),inputChars:text.length,budgetHour:ticket?.hour,outputChars:JSON.stringify(result.data??'').length,usage:result.receipt?.usage||null,disposed:result.receipt?.disposed,transcriptPersisted:result.receipt?.transcriptPersisted});
  return result;
}
