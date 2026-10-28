import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../public/console.html',import.meta.url),'utf8'),begin=html.indexOf('// FEIYU_LIFE_PRESENTATION_BEGIN'),middle=html.indexOf('// Presentation only.',begin),end=html.indexOf('// FEIYU_LIFE_PRESENTATION_END',middle);
assert.ok(begin>=0&&middle>begin&&end>middle,'The real console presentation must be mounted');
const presenterSource=html.slice(begin,middle),summarizeLife=new Function(presenterSource+';return summarizeLife;')();


const freeze = value => { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; };

test('missing behavior remains unknown despite pause, night window and numeric states', () => {
  const result = summarizeLife({ state: { energy: 0, arousal: 0, valence: -1 } }, { paused: true, nightRest: { blocked: true } });
  assert.equal(result.behavior.label, '尚未记录当前活动');
  assert.equal(result.behavior.kind, null);
  assert.equal(result.behavior.recorded, false);
  assert.equal(result.psychological.mood, null);
  assert.equal(result.psychological.text, '');
  assert.deepEqual([result.runtime.paused, result.runtime.nightBlocked], [true, true]);
});

test('pause/night do not replace recorded chat, while a recorded sleep remains sleep', () => {
  const state = { paused: true, nightRest: { blocked: true } };
  const chat = summarizeLife({ state: { behavior: { kind: 'chat', label: '与朋友聊天' } } }, state);
  assert.equal(chat.behavior.kind, 'chat');
  assert.equal(chat.behavior.label, '与朋友聊天');
  assert.equal(summarizeLife({ state: { behavior: { kind: 'sleep' } } }, state).behavior.kind, 'sleep');
  assert.equal(summarizeLife({ state: { behavior: { kind: 'dream' } } }, state).behavior.label, '整理经历');
});

test('unknown future behavior kinds and explicit labels survive without guessed meanings', () => {
  assert.equal(summarizeLife({ state: { behavior: { kind: 'new-adapter' } } }).behavior.label, 'new-adapter');
  assert.equal(summarizeLife({ state: { behavior: { label: '正在手工验证' } } }).behavior.label, '正在手工验证');
  assert.equal(summarizeLife({ state: { behavior: { kind: 'idle' } } }).behavior.label, '发呆');
});

test('psychological timestamp comes from psychology, never energy update or receipt time', () => {
  const data = { state: { psychological: '仍有一点失望。', updated: 9000, psychologyStatus: { status: 'valid', updatedAt: 1000 } } };
  const result = summarizeLife(data, { now: 10000, fetchedAt: 9999 });
  assert.deepEqual(result.psychological.time, { at: 1000, source: 'state.psychologyStatus.updatedAt' });
  assert.equal(result.psychological.freshness.ageMs, 9000);
  assert.equal(result.snapshot.at, 9999);
  assert.equal(result.runtime.stateUpdatedTime.at, 9000);
  const noPsycheTime = summarizeLife({ state: { psychological: '一直在意', updated: 9000 } }, { now: 10000, fetchedAt: 9999 });
  assert.equal(noPsycheTime.psychological.time.at, null);
  assert.equal(noPsycheTime.psychological.freshness.status, 'unknown');
});

test('invalid timestamps fall through, timezone is explicit, and future clocks are not made fresh', () => {
  const result = summarizeLife({ state: { psychological: '已记录', psychologicalUpdated: '2026-10-28T01:00:00Z',
    psychologyStatus: { updatedAt: 'invalid' } } }, { now: '2026-10-28T00:59:00Z' });
  assert.equal(result.psychological.time.source, 'state.psychologicalUpdated');
  assert.equal(result.psychological.freshness.status, 'clock-ahead');
  assert.equal(result.psychological.freshness.ageMs, -60000);
  assert.equal(summarizeLife({ state: { psychologicalUpdated: '2026-10-28 12:00:00' } }).psychological.time.at, null);
  assert.equal(summarizeLife({ state: { psychologicalUpdated: 0 } }).psychological.time.at, 0);
});

test('needs-review preserves last text as a pending state, does not invent a new feeling', () => {
  const result = summarizeLife({ state: { psychological: '上次保存的感受', mood: '复杂', valence: 1,
    psychologyStatus: { status: 'needs-review' }, appraisal: { emotions: { hurt: 0.5, amusement: 0.4 }, originScope: 'source-a' } } });
  assert.equal(result.psychological.needsReview, true);
  assert.equal(result.psychological.text, '上次保存的感受');
  assert.equal(result.psychological.mood, '复杂');
  assert.deepEqual(result.psychological.appraisal.emotions, { hurt: 0.5, amusement: 0.4 });
  assert.equal(result.psychological.appraisal.originScope, 'source-a');
});

test('ongoing preserves every real status and never turns postponed or released items into tasks', () => {
  const rows = ['active', 'quiet', 'paused', 'released', 'resolved', 'contested', 'later-v4', null].map((status, index) => ({ id: String(index), status }));
  const result = summarizeLife({ innerV3: { ongoing: rows } });
  for (const status of rows.map(row => row.status || 'unknown')) assert.equal(result.ongoing.byStatus[status].length, 1);
  assert.equal(result.ongoing.byStatus.quiet[0].status, 'quiet');
  assert.equal(result.ongoing.byStatus.released[0].status, 'released');
  assert.equal(result.ongoing.currentAttentionInferred, false);
  assert.equal(result.ongoing.coverage, 'provided-items-only');
});

test('sorts both lists by actual at descending, selects latest, and leaves undated entries last', () => {
  const data = { activities: [{ id: 'a1', at: 10, summary: '早' }, { id: 'a3', at: 30, summary: '晚' }, { id: 'a?', summary: '无时间' }, { id: 'bad', at: NaN }],
    experiences: [{ id: 'e2', at: 20, feeling: '感受' }, { id: 'e4', at: 40, feeling: '新的感受' }] };
  const result = summarizeLife(data);
  assert.deepEqual(result.recent.activities.map(row => row.id), ['a3', 'a1', 'a?', 'bad']);
  assert.deepEqual(result.recent.experiences.map(row => row.id), ['e4', 'e2']);
  assert.equal(result.recent.latestActivity.id, 'a3');
  assert.equal(result.recent.latestExperience.id, 'e4');
  assert.equal(result.recent.latest.id, 'e4');
  assert.equal(result.recent.latest.entryType, 'experience');
  assert.equal(result.recent.activities[0].entryType, 'activity');
  assert.equal(result.recent.experienceMeaning, 'explicit-subjective-feeling');
  assert.equal(result.recent.activityMeaning, 'recorded-activity-summary');
  assert.deepEqual(data.activities.map(row => row.id), ['a1', 'a3', 'a?', 'bad']);
});

test('no dated entries means no most-recent claim; equal timestamps have stable input order', () => {
  assert.equal(summarizeLife({ activities: [{ summary: '无日期' }] }).recent.latestActivity, null);
  assert.deepEqual(summarizeLife({ experiences: [{ id: 'first', at: 5 }, { id: 'second', at: 5 }] }).recent.experiences.map(row => row.id), ['first', 'second']);
});

test('paged and bounded lists are never totals; explicit server counts remain distinct', () => {
  const data = { offset: 20, nextOffset: 40, memories: Array.from({ length: 20 }, (_, id) => ({ id, count: 999 })),
    activities: [{ at: 1 }], experiences: [{ at: 1 }], experienceCounts: { all: 120, current: 8 }, cognitionV2: { archiveCount: 500 } };
  const result = summarizeLife(data);
  assert.equal(result.counts.memoriesTotal, null);
  assert.equal(result.counts.activitiesTotal, null);
  assert.equal(result.counts.experiencesAll, 120);
  assert.equal(result.counts.experiencesCurrent, 8);
  const explicit = summarizeLife(data, { totals: { memories: 1000, activities: 2000 } });
  assert.equal(explicit.counts.memoriesTotal, 1000);
  assert.equal(explicit.counts.activitiesTotal, 2000);
  assert.equal(explicit.counts.memoriesTotalSource, 'activityState.totals.memories');
});

test('malformed shapes and noninteger totals stay unknown instead of producing fake zeroes', () => {
  const result = summarizeLife({ profile: [], state: null, activities: { count: 123 }, experiences: [null, 'bad'],
    experienceCounts: { all: '30', current: -1 } }, { totals: { memories: 2.5, activities: '10' } });
  assert.equal(result.profile.known, false);
  assert.equal(result.counts.memoriesTotal, null);
  assert.equal(result.counts.activitiesTotal, null);
  assert.equal(result.counts.experiencesAll, null);
  assert.deepEqual(result.recent.activities, []);
  assert.deepEqual(result.recent.experiences, []);
  assert.doesNotThrow(() => summarizeLife(null, null));
});

test('same inputs produce same outputs with frozen input; all result objects are detached', () => {
  const input = freeze({ profile: { id: 'example', name: '示例角色' }, state: { psychological: '有点好奇',
    appraisal: { emotions: { interest: 0.5 } } }, innerV3: { ongoing: [{ status: 'active', meaning: '看看', evidence: ['example'] }] },
    experiences: [{ at: 5, feeling: '喜欢又有保留', evidence: ['example'] }] });
  assert.deepEqual(summarizeLife(input), summarizeLife(input));
  const result = summarizeLife(input);
  result.ongoing.byStatus.active[0].evidence.push('new');
  result.recent.experiences[0].evidence.push('new');
  result.psychological.appraisal.emotions.interest = 1;
  assert.deepEqual(input.innerV3.ongoing[0].evidence, ['example']);
  assert.deepEqual(input.experiences[0].evidence, ['example']);
  assert.equal(input.state.appraisal.emotions.interest, 0.5);
  assert.equal(result.profile.name, '示例角色');
});
