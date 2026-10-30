import {configuredOneBotEnabled,validateOneBotHttpUrl} from '../src/onebot-client.js';
import {knowledgePageView} from '../src/knowledge-presentation.js';
import {buildTrace} from '../src/life-trace-view.js';
import {mediaPython} from '../src/portable-paths.js';
import {chatWindowView} from '../src/chat-window-budget.js';
import * as runtimeTuning from '../src/runtime-tuning.js';
import {RuntimeTuningControl} from '../src/runtime-tuning-control.js';
import {DailyCostBudget} from '../src/daily-cost-budget.js';
import {embeddingCompatibilityStatus} from '../src/cognition/embedding.js';
import {CONVERSATION_RESPONSE,conversationReply,recordChannelOutcome} from '../src/conversation-response.js';
import {TransportInbox} from '../src/transport-inbox.js';
import {buildExpressionContext} from '../src/conversation-expression.js';
import {createSelfUnderstandingGetter} from '../src/self-understanding.js';
import {buildAutonomyOpportunities} from '../src/agency-context.js';
import * as behaviorArmor from '../src/behavior-armor.js';
import {DelegationIntentGate} from '../src/delegation-intent.js';
import * as knowledgeCompat from '../src/knowledge-compat.js';
import {executionGuard} from '../src/cognition/execution-guard.js';
import {backgroundThought} from '../src/background-thought.js';
import {normalizeCognitionConfig} from '../src/cognition/config.js';
import {DisabledKnowledge} from '../src/cognition/disabled-knowledge.js';
import {LiveCognition,LiveKnowledge} from '../src/cognition/live.js';
import {callThought as nativeCallThought} from '../src/thought-client.js';
import {LEARNING_HINT} from '../src/learning-hint.js';
import * as conversationStage from '../src/conversation-stage.js';
import * as energyContext from '../src/energy-context.js';
import {adminRuntimeStatus,adminRuntimeTest} from '../src/admin-runtime.js';
import * as selfActionEvidence from '../src/cognition/self-action-evidence.js';
import * as dialogueGrounding from '../src/dialogue-grounding.js';
import * as dialogueUnderstanding from '../src/dialogue-understanding.js';
import * as operationalMaterial from '../src/operational-material.js';
import {recoverRoleRename,renameRoleCatalog} from '../src/role-catalog.js';
import {runtimeHealth} from '../src/runtime-health.js';
import {RoleWriteCoordinator,consoleResource} from '../src/role-write.js';
import {internetPanelStatus} from '../src/internet-panel.js';
import {CapabilityCenter} from '../src/capability-center.js';
import {prepareVisionImage,ADAPTIVE_VISION_HINT} from '../src/adaptive-vision.js';
import {createQzoneReplies} from '../src/qzone-replies.js';
import {qzoneTarget} from '../src/web-reading.js';
import {SocialPlatforms} from '../src/social-platforms.js';
import {Birthdays} from '../src/birthdays.js';
import {OccasionObservations,publishOccasionObservation} from '../src/occasion-observations.js';
import {FriendOccasions,HolidayGreetings,holidaysOn} from '../src/friend-occasions.js';
import {readStickerAsset} from '../src/sticker-assets.js';
import {petAudioHandlers} from '../src/pet-audio.js';
import {SocialSelfTest} from '../src/social-self-test.js';
import {WechatDesktop,desktopWechatArgs} from '../src/wechat-desktop.js';
import {WechatChannel,archiveWechatMessage} from '../src/wechat-channel.js';
import {AppIntegrations} from '../src/app-integrations.js';
import {READING_EVIDENCE_HINT} from '../src/reading-runtime.js';
import {TaskCenter} from '../src/task-center.js';
import {FileReader} from '../src/file-reader.js';
import {MultiSiteActivity} from '../src/multi-site-activity.js';
import {startCompanionGateway} from '../src/companion-gateway.js';
import * as modelFailurePolicy from '../src/model-failure-policy.js';
import {biliShareText,shareCardReadView} from '../src/qq-link-share.js';
import {NaturalExpression} from '../src/natural-expression.js';
import {RelationshipPacing} from '../src/relationship-pacing.js';
import {consoleEntryPage} from '../src/console-entry.js';
import {DialogueExpression,PUN_HINT,CROSS_CONTACT_HINT} from '../src/dialogue-expression.js';
import {resolveBiliVideo} from '../src/bili-link.js';
import {internetMaterial} from '../src/internet-activity.js';
import {SpeechCircuit} from '../src/speech-circuit.js';
import * as mediaConversation from '../src/media-conversation.js';
import {initialSnowLumaWsToken} from '../src/snowluma-conn.js';
import {affinityChatPolicy,affinityPolicyHint,innerChatPolicy} from '../src/affinity-chat-policy.js';
import {retireRelationshipRules,retireSocialControls} from '../src/cognition/relationship-rules.js';
import {ThoughtUsageReader} from '../src/thought-meter.js';
import * as nightRestModule from '../src/night-rest.js';
import {temporalContext} from '../src/temporal-context.js';
import {accountThought,foregroundThought} from '../src/cognition/thought-accounting.js';
// Execute the real bridge initialization/functions against temporary files and fake peers.
// No production config, QQ connection, DSH process, or persistent home is accessed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as markdown from '../src/md-to-plain.js';
import * as sensitive from '../src/sensitive.js';
import * as wait from '../src/v2-wait.js';
import * as safeFetch from '../src/safe-fetch.js';
import * as forward from '../src/forward.js';
import * as slang from '../src/slang-learner.js';
import * as sticker from '../src/sticker-lib.js';
import * as modelPrices from '../src/model-prices.js';
import * as tokenLedger from '../src/token-ledger.js';
import * as voiceLib from '../src/send-voice-lib.js';
import * as presetPrompt from '../src/preset-prompt.js';
import * as friendAuthorization from '../src/friend-authorization.js';
import * as stateAcl from '../src/state-acl.mjs';
import * as characterProfiles from '../src/character-profile.js';
import * as behaviorHistory from '../src/behavior-history.js';
import * as contactStore from '../src/contact-store.js';
import * as contactMemory from '../src/contact-memory.js';
import * as biliAdapter from '../src/bili-adapter.js';
import * as internetStore from '../src/internet-store.js';
import * as internetActivityModule from '../src/internet-activity.js';
import {webSearch} from '../src/web-search.js';
import * as unreadReview from '../src/unread-review.js';
import {ReplyRepair} from '../src/reply-repair.js';
import {ReplyDeliveryRecovery,REPLY_DELIVERY_RECOVERY_HINT} from '../src/reply-delivery-recovery.js';
import {OutboundQueue} from '../src/outbound-queue.js';
import {planModelFailureRecovery} from '../src/model-failure-recovery.js';
import {QQDeliveryOutbox} from '../src/qq-delivery-outbox.js';
import * as energyPolicy from '../src/energy-policy.js';
import * as dialoguePolicy from '../src/dialogue-policy.js';
import {DialogueAttention} from '../src/dialogue-attention.js';
import {dialogueState} from '../plugins/qq-agent-presets/dialogue-state.mjs';
import * as proactive from '../src/proactive-policy.js';
import * as relationships from '../src/relationship-policy.js';
import * as chatAccess from '../src/chat-access.js';
import * as voiceAccess from '../src/voice-access.js';
import * as speakingStyle from '../src/speaking-style.js';
import * as roleCards from '../src/role-card.js';
import * as qzone from '../src/qzone.js';
import * as systemServices from '../src/system-services.js';
import {encodeDialogueEvent,decodeDialogueEvent} from '../plugins/qq-agent-presets/dialogue-protocol.mjs';
import { unwrap, createTurnCollector } from '../src/dsh-client.js';

const root = fileURLToPath(new URL('..', import.meta.url));
export async function bridgeHarness({ config = {}, savedState, files = {}, globals = {} } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-audit-bridge-'));
  fs.mkdirSync(path.join(temp, 'src'));
  fs.mkdirSync(path.join(temp, 'state'));
  fs.mkdirSync(path.join(temp,'roles'));
  fs.writeFileSync(path.join(temp,'roles','大肥鱼内定性格.md'),'# Fixture character\nA short test personality.');
  fs.writeFileSync(path.join(temp,'state','console-token'),'fixture-console-token');
  const fixtureConfig={
    dsh: { authToken: 'fixture-only' }, ownerQQ: 123,
    allow: { private: ['123'], groups: ['456'] }, consolePort: 0,
    consoleToken: 'fixture-console-token', slang: { enabled: false }, ...config,
  };
  fixtureConfig.nightRest={enabled:false,...config.nightRest};
  // Legacy transport tests must not call a real model or introduce reply delays.
  // Individual tests can explicitly opt into the new subsystems.
  fixtureConfig.socialV2={...fixtureConfig.socialV2,
    mind:{enabled:false,...fixtureConfig.socialV2?.mind},
    intimacy:{enabled:false,...fixtureConfig.socialV2?.intimacy},
    qzone:{enabled:false,...fixtureConfig.socialV2?.qzone}};
  fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify(fixtureConfig));
  if (savedState) fs.writeFileSync(path.join(temp, 'state/sessions.json'), JSON.stringify(savedState));
  // 额外状态文件（用于测试"启动时读到损坏/旧版文件"这类路径）。
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(temp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string'||Buffer.isBuffer(content) ? content : JSON.stringify(content));
  }
  const calls = { modelSelections: [], created: [], archived: [], sent: [], prompts: [], follows: [], cancelled: [], images: [], faces: [], http: [] };
  // 语音发送在桥接里是**直接 fetch 网关**（与文本/表情共用 sendChain，但要自己带 record 段），
  // 所以这里给 VM 注入一个记录型 fetch：既不让测试真的发 QQ 消息，又能断言发出的段内容。
  const fakeFetch = async (url, init = {}) => {
    const body = (() => { try { return JSON.parse(init.body ?? '{}'); } catch { return init.body; } })();
    calls.http.push({ url: String(url), body });
    const action = String(url).split('/').pop();
    if (action === 'fetch_ptt_text') {
      return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { text: 'fixture-transcript' } }) };
    }
    // get_msg：语音落地校验用 —— 回一个带 record 段的消息，模拟真实网关
    if (action === 'get_msg') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          retcode: 0,
          data: { message_id: 9001, message: [{ type: 'record', data: { file: 'fixture-record.amr', duration: 3 } }] }
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 9001 } }) };
  };
  const success = (value) => ({ result: { ok: true, value } });
  const api = {
    baseUrl:'http://fixture.invalid',
    doFetch:async(url,init)=>{
      if(new URL(url).pathname!=='/api/qq-chat-cycle/submit')throw Error('Unexpected fixture native endpoint');
      const payload=JSON.parse(init.body);
      const content=payload.content.map(part=>part.type==='text'?{...part,text:decodeDialogueEvent(part.text,'fixture-console-token',payload.sessionId)?.context||part.text}:part);
      const accepted=await api.sessions.prompt({...payload,content});
      // The native fixture has no event mux. Model its immediate completed turn
      // so transport tests do not leave the foreground lane held forever.
      bridge.dialogueAttention.observe(payload.sessionId,{type:'turn/start',data:{turn:calls.prompts.length}});
      bridge.dialogueAttention.observe(payload.sessionId,{type:'turn/end',data:{turn:calls.prompts.length}});
      return {ok:true,status:200,json:async()=>({ok:true,value:unwrap(accepted,'fixture native prompt')})};
    },
    events: { follow: (id) => calls.follows.push(id) },
    // settings.describe 的默认桩：没有 qq-mode 命名空间 ⇒ refreshMode() 回退到本地 mode.json。
    // 测试可覆盖它来验证「DSH 设置里的空 ownerQQ 不得覆盖 config.json」等契约。
    settings: {
      describe: async () => success({ namespaces: [] }),
      update: async () => success({ updated: true })
    },
    workspace: {
      create: async () => success({ created: false, workspace: { workspaceId: 'fixture-workspace' } }),
      archiveSession: async ({ sessionId }) => { calls.archived.push(sessionId); return success({}); },
    },
    sessions: {
      create: async (params) => { calls.created.push(params); return success({ sessionId: `fixture-${calls.created.length}` }); },
      selectModel: async (selection) => {calls.modelSelections.push(selection);return success({selected:selection});},
      prompt: async (params) => { calls.prompts.push(params); return success({}); },
    },
    respond: async () => success({}),
    stopSessionWork: async (sessionId) => { calls.cancelled.push(sessionId); return { removed: 0 }; },
    callUnary: async (method, params) => { calls.cancelled.push({ method, params }); return success({ accepted: true }); },
  };
  class FakeBot {
    async sendPrivateMessage(id, text) { calls.sent.push({ kind: 'private', id, text }); }
    async sendGroupMessage(id, text) { calls.sent.push({ kind: 'group', id, text }); }
    async getImage({ file }) {
      calls.images.push(file);
      // Valid 1 × 1 PNG, supplied entirely in memory by the fixture gateway.
      return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=' };
    }
    async fetchFaceEntity(id) { calls.faces.push(id); return null; }
    async request() { return { status: 'ok', retcode: 0, data: [{ emoji_id: 'fixture-sticker', url: 'https://public.invalid/sticker' }] }; }
  }
  let source = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
  // 去掉顶层 import（VM 里靠 context 注入提供这些绑定）。
  // 必须按行处理：这些 import 有**多行**写法，用单行正则（/^import[\s\S]*?;/gm）会在
  // 第一个分号处停下，把紧跟其后的正常代码一起删掉（曾把 `cfg.socialV2.voice = {…}`
  // 整段吞掉，导致语音相关断言在虚拟环境里悄悄失真）。
  source = source.split(/\r?\n/).reduce((acc, line) => {
    if (acc.droppingImport) {
      if (/;\s*$/.test(line)) acc.droppingImport = false;
      return acc;
    }
    if (/^import[\s{*]/.test(line) || /^import\s+['"]/.test(line)) {
      if (!/;\s*$/.test(line)) acc.droppingImport = true;
      return acc;
    }
    acc.out.push(line);
    return acc;
  }, { out: [], droppingImport: false }).out.join('\n');
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(temp, 'src/bridge.js')).href));
  source = source.slice(0, source.indexOf("process.on('SIGINT'"));
  source = source.replace('  bot.onPrivateMessage(async (event) => {', `
  return {
    async closeStores(){transportInbox.close();roleWrites.close();capabilityCenter.close();multiSite?.close();companion?.close();await applications.close();nightRest?.close();internetActivity?.close();knowledgeSystem.close();contactStore.close();await mindSystem?.close();behaviorHistory.close();},
    applications,wechatTurns,birthdays,occasionDirectory,holidayGreetings,occasionObservations,tickOccasions,transportInbox,drainTransportInbox,drainInboundLedger,nightRest,contactStore,mindSystem,getSelfUnderstanding,internetActivity,knowledgeSystem,expressionPolicy,roleWrites,ingestPrivate,withSlangContext,knowledgeCues,replyRepair,unreadReview,restoreUnansweredV2,acknowledgeMessagesV2,
    ensureSession, ensureChatModel, scheduleWakeV2, resolvePresetName, deliverPrompt, drainPromptQueue,
    sendToQQ, sendStickerV2, handleIncoming, startConsoleServer, cfg, state, api, promptQueues,
    getSocialV2State, appendSocialV2Message, recordSentMessagesV2, sendMessagesV2, replyBudgets, reserveReplyBudget,
    scheduleProactiveCheckV2,requestProactiveIntentDispatch,dispatchProactiveIntentV3,buildWakePromptV2, buildWakeSnapshotV2, sendWakePromptV2, socialV2, dialogueAttention, noteModelMessagesV2,
    refreshMode, modeAllowed, trackTurnEvent, replayPendingWakeReasonsV2,
    behaviorFrames, captureBehaviorGuard, bindBehaviorFrame, observeBehaviorTurn,
    collectors, setupSleepTimerV2,pending,registerPending,
    getInitialPrompt, setInitialPrompt, loadInitialPrompts, formatInitialPromptV2,
    initialPrompts, initialPromptMaxChars,
    extractMediaFromSegments, segmentsToText, fetchOneBotImage, fetchMediaData, resolveMediaList,
    emojiCdnCandidates, getImageDimensions, acceptImageBuffer, MAX_MEDIA_BYTES, bot,
    isConversationBusyV2, v2TurnStartAt, turnLeaseNoted, TURN_BUSY_LEASE_MS,
    settingFromDshNamespace, selfIdentityTextV2, buildWakeReminderPromptV2,
    getMode() { return currentMode; },
    setSelfIdentity(display, id) {
      selfDisplayName = String(display ?? '');
      selfUserId = String(id ?? '');
      selfNickname = selfDisplayName.toLowerCase() || 'deepseek';
    },
    flushQueue, retireSession, replyDeliveryRecovery, pendingWakeKeys, disarmPendingWakeLease, pumpMux, outboundQueue, deliveryOutbox, recoverFailedOutputV2,
    voiceCfg, voiceLibrary, resolveVoicePathForV2, resolveVoicePathForOperator,
    voiceBudgetCheck, sendVoiceV2, sendVoiceForV2, assertOutboundAuditOk,
    setMode(value) { currentMode = value; },
    setReady(value) { dshReady = value; },
    setQQConnected(value) { snowlumaHealth.connected = value; },
    setPresets(value) { dshPresetIds = value; dshDefaultPreset = 'standard'; },
    resetEpoch() { sessionEpoch++; },
  };
  bot.onPrivateMessage(async (event) => {`);
  const timers = new Set();
  const context = vm.createContext({
    fs, os, path, http, crypto, fileURLToPath, URL, Buffer, AbortSignal, AbortController, console: { log() {}, error() {} },
    fetch: fakeFetch,
    // 锁文件探测用（bridge.js 顶层的 consolePortInUse）；
    // 固定桩掉：测试不应该真去 netstat 宿主机。
    execFileSync: () => '',
    // process 桩要带 env：voice-core / bridge 会读 process.env.FFMPEG_PATH、FFPROBE_PATH 等。
    // 之前只给 pid/platform/kill/exit，导致 `process.env.FFMPEG_PATH` 直接抛 TypeError。
    process: { pid: process.pid, platform: process.platform, kill: process.kill, env: {}, exit: (code) => { throw new Error('unexpected exit ' + code); } },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout, setImmediate, setInterval: () => ({ unref() {} }), clearInterval: () => {},
    NodeApiClient: class { constructor() { return api; } },
    initialSnowLumaWsToken:cfg=>initialSnowLumaWsToken(cfg,{accounts:[]}),
    SnowLumaWebSocketClient: FakeBot, text: (s) => s,
    discoverDshLaunchToken: () => '', unwrap, createTurnCollector,
    ...markdown, ...sensitive, ...wait, ...safeFetch, ...forward, ...slang, ...sticker,
    ...modelPrices, ...tokenLedger, ...voiceLib, ...stateAcl, ...presetPrompt,
    CONVERSATION_RESPONSE,conversationReply,recordChannelOutcome,...friendAuthorization,Birthdays,FriendOccasions,HolidayGreetings,holidaysOn,OccasionObservations,publishOccasionObservation,readStickerAsset,petAudioHandlers,SocialSelfTest,WechatDesktop,desktopWechatArgs,WechatChannel,archiveWechatMessage,
    runtimeHealth,RoleWriteCoordinator,consoleResource,recoverRoleRename,renameRoleCatalog,internetPanelStatus,CapabilityCenter,prepareVisionImage,ADAPTIVE_VISION_HINT,createQzoneReplies,qzoneTarget,SocialPlatforms,AppIntegrations,READING_EVIDENCE_HINT,FileReader,MultiSiteActivity,startCompanionGateway,...modelFailurePolicy,biliShareText,shareCardReadView,DialogueExpression,NaturalExpression,RelationshipPacing,PUN_HINT,CROSS_CONTACT_HINT,resolveBiliVideo,internetMaterial,SpeechCircuit,queueMicrotask,affinityChatPolicy,affinityPolicyHint,innerChatPolicy,retireRelationshipRules,retireSocialControls,ThoughtUsageReader,...nightRestModule,temporalContext,...biliAdapter,...internetStore,...internetActivityModule,webSearch,...characterProfiles,...behaviorHistory,...contactStore,...contactMemory,...unreadReview,...energyPolicy,ReplyRepair,
    ...conversationStage,...proactive,...relationships,...chatAccess,...voiceAccess,...dialoguePolicy,DialogueAttention,dialogueState,ReplyDeliveryRecovery,REPLY_DELIVERY_RECOVERY_HINT,OutboundQueue,planModelFailureRecovery,QQDeliveryOutbox,
    ...knowledgeCompat,...behaviorArmor,DelegationIntentGate,TaskCenter,TransportInbox,DisabledKnowledge,LiveCognition,LiveKnowledge,nativeCallThought,LEARNING_HINT,executionGuard,backgroundThought,accountThought,foregroundThought,buildExpressionContext,createSelfUnderstandingGetter,buildAutonomyOpportunities,
    // Imported pure validation sees a different VM Object prototype; serialize only at this boundary.
    normalizeCognitionConfig:(mind,options)=>normalizeCognitionConfig(mind==null?mind:JSON.parse(JSON.stringify(mind)),options),
    configuredOneBotEnabled,validateOneBotHttpUrl,mediaPython,chatWindowView,...runtimeTuning,mergeRuntimeTuning:(a,b)=>runtimeTuning.mergeRuntimeTuning(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b))),normalizeRuntimeTuning:(value,options)=>runtimeTuning.normalizeRuntimeTuning(JSON.parse(JSON.stringify(value)),options),RuntimeTuningControl,DailyCostBudget,embeddingCompatibilityStatus,...energyContext,adminRuntimeStatus,adminRuntimeTest,...dialogueGrounding,...selfActionEvidence,...dialogueUnderstanding,...operationalMaterial,...mediaConversation,...speakingStyle,...roleCards,...qzone,...systemServices,encodeDialogueEvent,consoleEntryPage,
    startServices:async()=>{throw Error('Process control must be explicitly mocked in isolated tests');},
    systemStatus:async()=>[],
    synthesizeEdgeSpeech: async () => { throw new Error('TTS must be explicitly mocked in isolated tests'); },
    startQwenSpeechWorker: async () => {},
    // ACL 收紧会 spawn icacls 去改**真实**文件系统；测试不该做这件事（同理见下面的
    // cleanupTemp / processAudioVolume 桩）。桩成成功，让 hardenStateDirAcl 走正常分支。
    hardenDir: () => ({ ok: true, detail: 'stub' }),hardenPrivatePath:()=>({ok:true,detail:'stub'}),
    // 音量靠 ffmpeg；测试环境不该真跑 ffmpeg（也不该在沙箱里 spawn）。
    // 默认桩成"按倍数记账但不转码"，调用方可用 globals 覆盖来断言真实行为。
    processAudioVolume: async (file, { volume = 1, normalize = false, loudness = 'normal' } = {}) => {
      const v = Number(volume);
      const changed = normalize === true || Math.abs(v - 1) > 1e-9;
      return {
        path: changed ? `${file}.vol` : file,
        converted: changed,
        applied: changed,
        volume: normalize ? 1 : v,
        loudness: normalize ? -16 : null,
        mode: normalize ? 'loudnorm' : (changed ? 'volume' : 'original'),
        detail: normalize ? `智能音量（响度归一 ${loudness === 'loud' ? -13 : loudness === 'quiet' ? -20 : -16} LUFS）`
          : (changed ? `音量 ${Math.round(v * 100)}%` : '原始音量')
      };
    },
    cleanupTemp: () => {},
    // Exercise the real gateway on an ephemeral port, never the live desktop listener.
    startCompanionGateway: options=>startCompanionGateway({...options,port:0}),
    knowledgePageView,buildTrace,...globals,
  });
  // Execute the pure model view in the bridge realm. Its plain-object checks
  // should see the same prototypes as real bridge messages, just as in Node.
  const modelViewSource = fs.readFileSync(path.join(root, 'src/qq-model-view.js'), 'utf8').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm, '');
  vm.runInContext(`Object.assign(globalThis, (() => { ${modelViewSource}\nreturn { compactModelMessage, compactModelData, serializeModelData }; })());`, context);
  vm.runInContext(source + '\nglobalThis.auditReady = main();', context);
  const bridge = await context.auditReady;
  bridge.setPresets(['standard', 'qq-chat', 'qq-chat-v2']);
  bridge.setReady(true);
  return { ...bridge, calls, temp, async close() {
    bridge.replyDeliveryRecovery.clear();
    for (const timer of timers) clearTimeout(timer);
    await bridge.closeStores?.();
    if(path.dirname(temp)!==os.tmpdir()||!path.basename(temp).startsWith('qq-audit-bridge-'))throw Error('Unexpected fixture cleanup path');
    fs.rmSync(temp, { recursive: true, force: true });
  } };
}
