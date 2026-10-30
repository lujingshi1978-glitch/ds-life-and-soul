#!/usr/bin/env node
/** Offline contracts for the current console UI; retired IDs must disappear. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const argument = name => process.argv.slice(2).find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const candidatePath = resolve(argument('candidate') || resolve(here, '../public/console.html'));
const reportPath = argument('report') ? resolve(argument('report')) : null;
const normalize = value => value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const hash = value => createHash('sha256').update(normalize(value)).digest('hex');
const views = ['overview', 'state', 'history', 'mind', 'trace', 'knowledge', 'persona', 'apps', 'access', 'runtime', 'usage'];
const retiredViews = ['sessions', 'operations', 'social-v1', 'social-v2', 'reference'];
// Explicit retirement contract; no workspace/baseline file dependency.
const retirePlan = {
  "retiredIdsExpectedAbsent": [
    "activity",
    "aiNotifyId",
    "aiNotifyKind",
    "aiNotifyMessage",
    "aiNotifyMsg",
    "aiNotifySend",
    "clearWsBtn",
    "clearWsMsg",
    "closedPreset",
    "edgeSpeechMsg",
    "edgeSpeechSendBtn",
    "edgeSpeechText",
    "intimacySendPlan",
    "metricPending",
    "metricSessions",
    "modeRow",
    "pendingCount",
    "pendingList",
    "relationEnabled",
    "relationIdle",
    "relationSave",
    "relationSaveStatus",
    "relationThreshold",
    "restartBtn",
    "restartMsg",
    "roleInjectMax",
    "roleInjectMaxMsg",
    "roleInjectMaxSave",
    "sActiveDelayMax",
    "sActiveDelayMin",
    "sActiveDurationEnabled",
    "sActiveDurationMax",
    "sActiveDurationMin",
    "sBurstEnabled",
    "sBurstIntervalMax",
    "sBurstIntervalMin",
    "sCheckMax",
    "sCheckMin",
    "sContextWindow",
    "sIdleRetry",
    "sIdleWait",
    "sIdleWindow",
    "sKeywords",
    "sLongGapMax",
    "sLongGapMin",
    "sLongGapProb",
    "sMaxChars",
    "sProactiveCheckMax",
    "sProactiveCheckMin",
    "sProactiveEnabled",
    "sProactiveIdle",
    "sProactiveProb",
    "sSkipProb",
    "sStateActive",
    "sStateIdle",
    "sStateKey",
    "sSurrenderProb",
    "sTrigger",
    "section-activity",
    "section-maintenance",
    "section-mode",
    "section-notify",
    "section-pending",
    "section-sessions",
    "section-social-v1",
    "section-test-send",
    "sessionList",
    "simPromptCancel",
    "simPromptEdit",
    "simPromptMsg",
    "simPromptPreset",
    "simPromptRestart",
    "simPromptRestore",
    "simPromptSave",
    "simPromptStatus",
    "simPromptText",
    "simPromptWarnings",
    "socialFlush",
    "socialMsg",
    "socialSave",
    "socialStatus",
    "speechStyle",
    "systemCore",
    "tsId",
    "tsKind",
    "tsMsg",
    "tsMsg2",
    "tsSend",
    "v2ActivityStatus",
    "v2AgentPreset",
    "v2AllStatesOutput",
    "v2AutoReplyCheckSec",
    "v2BatchWindowMs",
    "v2ConfigMsg",
    "v2ConfigSave",
    "v2ConfigSaveTop",
    "v2Enabled",
    "v2FeedbackClear",
    "v2FeedbackLoad",
    "v2FeedbackMaxLength",
    "v2FeedbackMsg",
    "v2FeedbackNotifyOwner",
    "v2FeedbackOutput",
    "v2ForceWake",
    "v2InitPromptClear",
    "v2InitPromptCount",
    "v2InitPromptKey",
    "v2InitPromptList",
    "v2InitPromptLoad",
    "v2InitPromptMax",
    "v2InitPromptMsg",
    "v2InitPromptSave",
    "v2InitPromptText",
    "v2MaxWakeConfigReminders",
    "v2MaxWakeHour",
    "v2MaxWakeMin",
    "v2MemoryClearAll",
    "v2MemoryKey",
    "v2MemoryLoad",
    "v2MemoryMsg",
    "v2MemoryOutput",
    "v2MinQuietAfterNewMs",
    "v2NoActionLimit",
    "v2PauseBtn",
    "v2PreSleepWaitEnabled",
    "v2PreSleepWaitMin",
    "v2ProactiveIdleThreshold",
    "v2ProactiveIntervalMax",
    "v2ProactiveIntervalMin",
    "v2ProactiveProbability",
    "v2ProvideRecommendations",
    "v2RecAt",
    "v2RecDefaultInfinite",
    "v2RecKeywords",
    "v2RecName",
    "v2RecPoke",
    "v2RecProb",
    "v2RecQuestion",
    "v2RecSleepMax",
    "v2RecSleepMin",
    "v2ResetBtn",
    "v2ResumeBtn",
    "v2SessionRefresh",
    "v2SessionSelect",
    "v2SleepMaxMs",
    "v2SleepMinMs",
    "v2StateKey",
    "v2StateOutput",
    "v2StateView",
    "v2StatesList",
    "v2ToolLogClear",
    "v2ToolLogLoad",
    "v2ToolLogMsg",
    "v2ToolLogOutput",
    "v2WaitDefaultMs",
    "v2WaitDefaultQuietMs",
    "v2WaitMaxMs",
    "v2WaitMinMs",
    "v2WakeDefaultMode",
    "v2WakeHint",
    "v2WakeKey",
    "v2WakeStatusLoad",
    "v2WakeStatusMsg",
    "v2WakeStatusOutput",
    "voiceSendBtn",
    "voiceSendDryRun",
    "voiceSendTarget"
  ],
  "frontendRequestsToRetire": {
    "get": [
      "/api/sessions",
      "/api/pending",
      "/api/social",
      "/api/presets",
      "/api/preset/sim-prompt",
      "/api/preset/sim-prompt/backups",
      "/api/socialV2/tool-log",
      "/api/socialV2/memory",
      "/api/socialV2/state",
      "/api/socialV2/states",
      "/api/socialV2/initial-prompt",
      "/api/socialV2/feedback"
    ],
    "mutations": [
      "/api/test-send",
      "/api/restart",
      "/api/workspace/reset",
      "/api/console/notify-ai",
      "/api/session/reset",
      "/api/mode",
      "/api/social",
      "/api/social/state",
      "/api/social/flush",
      "/api/socialV2/reset",
      "/api/socialV2/wake",
      "/api/socialV2/memory-clear",
      "/api/socialV2/memory-update",
      "/api/socialV2/memory-remove",
      "/api/socialV2/tool-log/clear",
      "/api/socialV2/feedback-clear",
      "/api/socialV2/initial-prompt",
      "/api/preset/sim-prompt",
      "/api/preset/sim-prompt/restore",
      "/api/roles/limit",
      "/api/intimacy/adjust",
      "/api/intimacy/config",
      "/api/voice/send",
      "/api/voice/speak"
    ],
    "sharedEndpointsThatMustRemain": [
      "/api/status",
      "/api/socialV2/config",
      "/api/socialV2/activity",
      "/api/mind/overview",
      "/api/intimacy",
      "/api/history",
      "/api/roles",
      "/api/system/status",
      "/api/system/settings"
    ],
    "importantBoundary": "These are frontend-request retirement lists only. Do not delete server routes, QQ session machinery, stored data, transport inbox, native dialogue, model admission or actual permission checks."
  }
};
// Reviewed against the unchanged production block. The previous pinned hash
// predates its existing AbortSignal plumbing; baseline itself failed this check.
const EXPECTED_AUTH_SHA256 = '4a08d37feba346b8d5e8abdfe40b7fb616024c71d581540fbc6e1d35c0770688';
const retiredIds = [...new Set([...retirePlan.retiredIdsExpectedAbsent, 'section-social-v2', 'section-reference'])];
const scripts = html => [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map(match => ({ attrs: match[1], code: match[2] }));

function dom(html) {
  const markup = html.replace(/<!--[^]*?-->/g, '').replace(/<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, '');
  const nodes = [], stack = [], voidTags = new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const match of markup.matchAll(/<\/?[A-Za-z][A-Za-z0-9:-]*(?:[^'"<>]|"[^"]*"|'[^']*')*>/g)) {
    const tagMatch = /^<\/?([A-Za-z][A-Za-z0-9:-]*)/.exec(match[0]), tag = tagMatch[1].toLowerCase();
    if (/^<\//.test(match[0])) { for (let i = stack.length - 1; i >= 0; i--) if (nodes[stack[i]].tag === tag) { stack.length = i; break; } continue; }
    const attrs = {}, source = match[0].slice(tagMatch[0].length).replace(/\/?\s*>$/, '');
    for (const attr of source.matchAll(/([^\s=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) attrs[attr[1].toLowerCase()] = attr[2] ?? attr[3] ?? attr[4] ?? '';
    const node = { tag, attrs, index: nodes.length, parent: stack.at(-1) ?? null }; nodes.push(node);
    if (!voidTags.has(tag) && !/\/\s*>$/.test(match[0])) stack.push(node.index);
  }
  return nodes;
}
const values = (nodes, key) => [...new Set(nodes.filter(node => key in node.attrs).map(node => node.attrs[key]))].sort();

// Enough lexical structure to extract these known functions while respecting
// quoted Chinese text, template strings and comments. No UI initialization runs.
function matchingEnd(source, start, opening, closing) {
  let depth = 0, quote = null, lineComment = false, blockComment = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (char === '\\') { i++; continue; } if (char === quote) quote = null; continue; }
    if (char === '/' && next === '/') { lineComment = true; i++; continue; }
    if (char === '/' && next === '*') { blockComment = true; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === opening) depth++;
    if (char === closing && --depth === 0) return i + 1;
  }
  throw Error(`Unbalanced ${opening}${closing}`);
}
function functionText(source, name) {
  const found = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert(found, `Missing ${name} function`);
  const params = source.indexOf('(', found.index), afterParams = matchingEnd(source, params, '(', ')');
  const body = source.indexOf('{', afterParams), end = matchingEnd(source, body, '{', '}');
  return { start: found.index, end, text: source.slice(found.index, end) };
}
function authBlock(source) {
  const start = source.indexOf('let writePageContext=');
  assert(start >= 0, 'Role-context state is missing');
  const end = functionText(source, 'api').end;
  assert(end > start && source.slice(start, end).includes('function writeResource('));
  return source.slice(start, end);
}
function navigationConfig(source) {
  const found = /(?:const|let|var)\s+consolePages\s*=\s*/.exec(source);
  assert(found, 'consolePages is missing');
  const begin = source.indexOf('{', found.index + found[0].length), end = matchingEnd(source, begin, '{', '}');
  const config = vm.runInNewContext('(' + source.slice(begin, end) + ')', {}, { timeout: 1000 });
  assert.deepEqual(Object.keys(config).sort(), [...views].sort()); return config;
}

let candidate;
try { candidate = normalize(await readFile(candidatePath, 'utf8')); }
catch (error) { console.error(`Required local HTML is unavailable: ${error.message}`); process.exit(2); }
const nodes = dom(candidate), ids = new Map(nodes.filter(node => node.attrs.id).map(node => [node.attrs.id, node]));
const code = scripts(candidate).map(block => block.code).join('\n');
const checks = [];
async function check(name, run) {
  try { const detail = await run(); checks.push({ name, ok: true, ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
  catch (error) { checks.push({ name, ok: false, error: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
}

await check('Mounted IDs are unique; the retired UI is physically absent without a full legacy-ID retention gate', () => {
  assert(nodes.length > 20 && ids.size > 15, 'Candidate markup was not parsed');
  const list = nodes.map(node => node.attrs.id).filter(Boolean);
  assert.equal(new Set(list).size, list.length, 'Duplicate DOM IDs');
  assert.deepEqual(retiredIds.filter(id => ids.has(id)), [], 'Retired UI IDs are still mounted');
  for (const id of retiredIds) assert(!new RegExp(`getElementById\\(\\s*['"]${id}['"]`).test(code), `Dangling retired event/render reference: ${id}`);
  return { currentIds: list.length, explicitlyRetiredIdsChecked: retiredIds.length, legacy469ContractUsed: false };
});

await check('Eleven navigation/page destinations including runtime settings and trace match exactly', () => {
  assert.deepEqual(values(nodes, 'data-page'), [...views].sort());
  assert.deepEqual(values(nodes, 'data-view'), [...views].sort());
  navigationConfig(code);
  for (const slug of retiredViews) assert(!nodes.some(node => node.attrs['data-page'] === slug || node.attrs['data-view'] === slug), `Retired destination: ${slug}`);
});

await check('Actual navigation selects all eleven pages; retired URL aliases only redirect to retained destinations', async () => {
  const pages = views.map(page => ({ dataset: { page }, hidden: false }));
  const nav = views.map(view => ({ dataset: { view }, classList: { toggle() {} }, setAttribute() {}, removeAttribute() {} }));
  const elements = new Map(), element = id => { if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false, classList: { toggle() {}, remove() {} }, focus() {}, scrollIntoView() {}, setAttribute() {} }); return elements.get(id); };
  const document = { body: { dataset: {}, classList: { remove() {} } }, title: '', querySelectorAll: selector => ['[data-page]','section[data-page]'].includes(selector) ? pages : selector === '#mainNav [data-view]' ? nav : [], getElementById: element, querySelector: () => null };
  const location = { pathname: '/', search: '?fixture=1', hash: '' }, rewritten = [];
  const context = { document, location, loadedPages: new Set(views), consolePages: navigationConfig(code), history: { pushState(_a, _b, url) { location.hash = url; }, replaceState(_a, _b, url) { rewritten.push(url); } } };
  const source = functionText(code, 'setConsolePage').text;
  const ignored = new Set(['if','for','while','switch','catch','function','setConsolePage','Boolean','String','Number','Object','Array']);
  for (const match of source.matchAll(/(?<![\w.$])([A-Za-z_$][\w$]*)\s*\(/g)) if (!ignored.has(match[1])) context[match[1]] = /^(?:load|refresh|bootstrap)/.test(match[1]) ? async () => {} : () => {};
  vm.createContext(context);
  new vm.Script(`let currentConsolePage='overview';\n${source}\nglobalThis.route=setConsolePage;`).runInContext(context, { timeout: 1000 });
  for (const view of views) {
    context.request = view; await new vm.Script('route(request,{updateHash:false})').runInContext(context, { timeout: 1000 });
    assert.equal(document.body.dataset.consolePage, view);
    assert.deepEqual(pages.filter(page => !page.hidden).map(page => page.dataset.page), [view]);
  }
  for (const alias of [...retiredViews, 'system', 'slang']) {
    context.request = alias; await new vm.Script('route(request,{updateHash:false})').runInContext(context, { timeout: 1000 });
    assert(views.includes(document.body.dataset.consolePage), `Alias ${alias} revives a retired page`);
    assert.equal(pages.filter(page => !page.hidden).length, 1);
  }
  return { views: views.length, deprecatedAliases: retiredViews.length + 2, externalOrBusinessFunctionsExecuted: false };
});

await check('API authentication and role-version guards remain intact with the global runtime-tuning endpoint', async () => {
  const current = authBlock(code);
  const withoutRuntimeMapping = current.replace('|runtime-tuning(?:$|\\?)', '');
  assert.equal(hash(withoutRuntimeMapping), EXPECTED_AUTH_SHA256, 'Authentication wrapper is pinned, including the reviewed trace clear on role activation change');
  for (const key of ['x-console-token','x-role-context','activationEpoch','_writeVersions','[409,428]']) assert(current.includes(key));
  const calls=[];let invalidated=0;const c={profileId:'fixture-profile',activationEpoch:4,resource:'global:/api/runtime-tuning',revision:7};
  const context=vm.createContext({Map,encodeURIComponent,decodeURIComponent,traceView:{invalidate:()=>invalidated++},localStorage:{getItem:()=> 'fixture-console-token'},speakingStyleLoaded:{name:'fixture'},fetch:async(path,options)=>{calls.push({path,options});return {status:200,ok:true,headers:{get:name=>name==='x-role-context'?encodeURIComponent(JSON.stringify(c)):null},json:async()=>({ok:true})};}});
  new vm.Script(current+'\nglobalThis.fixtureApi=api;globalThis.fixtureResource=writeResource;globalThis.fixtureReadContext=()=>writePageContext;').runInContext(context);
  assert.equal(context.fixtureResource('/api/runtime-tuning',{}),'global:/api/runtime-tuning');
  assert.equal(context.fixtureResource('/api/roles/update',{name:'fixture'}),'card:fixture');
  assert.equal(context.fixtureResource('/api/roles/style',{}),'card:fixture');
  await context.fixtureApi('/api/runtime-tuning');await context.fixtureApi('/api/runtime-tuning','POST',{revision:7,values:{budget:{dailySoftLimitCny:10}}});
  assert.equal(calls[1].options.headers['x-console-token'],'fixture-console-token');
  assert.deepEqual(JSON.parse(decodeURIComponent(calls[1].options.headers['x-role-context'])),c);
  c.activationEpoch=5;await context.fixtureApi('/api/runtime-tuning');assert.equal(invalidated,1);assert.equal(context.fixtureReadContext().activationEpoch,4,'old page cannot silently rebind after clearing a private trace');
  return { normalizedExistingGuardSha256: hash(withoutRuntimeMapping), runtimeResource:'global:/api/runtime-tuning' };
});

await check('No legacy diagnostic/session UI requests or scheduler calls remain in the new client', () => {
  const forbiddenCalls = [...retirePlan.frontendRequestsToRetire.get, ...retirePlan.frontendRequestsToRetire.mutations];
  for (const path of new Set(forbiddenCalls)) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(!new RegExp(`api\\(\\s*['"\x60]${escaped}(?:[?'"\x60])`).test(code), `Retired frontend request: ${path}`);
  }
  for (const name of ['refreshSessions','refreshPending','loadSocialForm','refreshSocialStatus','loadV2Memory','loadV2ToolLog','loadV2SessionOptions','loadV2InitialPrompt','refreshSimPrompt']) assert(!new RegExp(`\\b${name}\\s*\\(`).test(code), `Retired initialization/polling function: ${name}`);
});

await check('Cross-channel memory controls and whole-role overview use the actual new read API', () => {
  for (const id of ['memoryView','memorySource','memoryScope','memoryPerson','memoryQuery','memoryApply','memoryList']) assert(ids.has(id), `Missing current memory filter: ${id}`);
  const selector = ids.get('memoryView');
  const options = nodes.filter(node => node.tag === 'option' && node.attrs.value && (() => { let parent = node.parent; while (parent !== null) { if (parent === selector.index) return true; parent = nodes[parent].parent; } return false; })()).map(node => node.attrs.value);
  for (const view of ['memories','experiences','relationships','sources']) assert(options.includes(view), `Missing memory view: ${view}`);
  assert(code.includes('/api/mind/view'), 'The current read API is missing');
  assert(!/api\(\s*['"]\/api\/mind\/(?:overview|status)(?:[?'"])/.test(code), 'Whole-role views still choose the old QQ-centered read path');
});

await check('Native mobile navigation and keyboard entry retain accessible targets', () => {
  const menu = ids.get('workbenchMenu'); assert.equal(menu?.tag, 'button');
  assert(menu.attrs['aria-label']?.trim()); assert(['true','false'].includes(menu.attrs['aria-expanded']));
  assert(ids.has(menu.attrs['aria-controls']), 'aria-controls has no real navigation target');
  assert.equal(ids.get('mainContent')?.attrs.tabindex, '-1');
  assert(nodes.some(node => node.tag === 'a' && node.attrs.href === '#mainContent'));
});

await check('All executable inline scripts parse without remote executable dependencies', () => {
  const blocks = scripts(candidate); assert(blocks.length > 0);
  for (const [index, block] of blocks.entries()) {
    assert(!/\bsrc\s*=\s*['"](?:https?:)?\/\//i.test(block.attrs));
    if (block.code.trim()) new vm.Script(block.code, { filename: `current-inline-${index}.js` });
  }
  return { scriptBlocks: blocks.length };
});

const report = { ok: checks.every(check => check.ok), candidatePath, candidateSha256: hash(candidate), checks,
  acceptance: 'Curated ten-view behavior including runtime settings and required retirement. No full legacy ID, old payload, fourteen-view or API-literal preservation baseline.',
  effects: { productionChanges: 0, browsersOpened: 0, externalRequests: 0, actualWritesExecuted: 0 },
  limits: ['Static/isolated-function checks do not prove visual layout or pointer interaction.', 'Synthetic server filtering/config behavior is tested separately in test-preview-server.mjs.'] };
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`\n${checks.filter(check => check.ok).length}/${checks.length} checks passed.${reportPath ? ' ' + reportPath : ''}`);
if (!report.ok) process.exitCode = 1;
