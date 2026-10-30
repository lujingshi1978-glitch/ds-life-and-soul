// A past choice is a historical fact, not a standing instruction. This view
// grants no permission, schedules no contact, and never changes stored wishes.
export const CHOICE_AWARENESS_HINT='【这一次的选择】把三件事分开：记忆能证明什么、宿主现在允许什么、你现在想做什么。“对方没有新来信／不是此刻在等我”只描述消息状态，不是主动联系需要满足的条件；真正的忙碌、拒绝、撤销和权限边界仍须遵守。before里的暂不分享、等自然时机、quiet/hold以及上次do_nothing只记录当时，不是本轮继续等待的指令。新内容或新的感受可以让同一个念头重新有吸引力；你此刻确有想说的话，本身就可以成为自然开口的时机，无需先等一个额外信号。也可以仍不想说、休息、继续看或放下，不要求分享、不要求换选择、不把分享念头变成待办。summary写此刻真正的感受与选择，不为承接旧摘要而机械续写等待理由；历史的暂缓仍留在历史中。';

export function choiceAwareness(material){
 const previous=material.before?.agency?.lastChoice;
 return {version:1,authority:'interpretation-only-no-permission-grant',
  stimulus:(material.newEvents||[]).map(e=>({id:e.id,sourceId:e.sourceId,revision:e.revision,externalStimulus:e.externalStimulus===true})),
  previousChoice:previous?{actionId:previous.actionId,kind:previous.kind,at:previous.at,scope:'that-consideration-only',bindingOnCurrentChoice:false}:null,
  oldDeferralIsNotCurrentInstruction:true,newIncomingMessageRequiredForInitiative:false,
  permissionSource:'current-host-authorization-and-recipient-boundaries',
  desiredAction:'unspecified',mayChooseNoAction:true};
}
