import {isStickerMedia,stickerDialogueRole,stickerSocialCue} from './media-conversation.js';
import {shareCardReadView} from './qq-link-share.js';
// Only the model-facing view is compacted. Stored messages and console/API data
// retain the original fields for display, media retrieval and troubleshooting.
const DEFAULT_FALSE_FIELDS = new Set([
  'quoteTargetIsSelf', 'isOwner', 'isSelf', 'hasMedia', 'hasForward'
]);
const OPTIONAL_FIELDS = new Set([
  'seq', 'messageId', 'sender', 'userId', 'text', 'plain', 'tail', 'kind',
  'ownerLabel', 'media', 'forwardIds', 'nestedForwardIds'
]);

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isEmpty(value) {
  return value == null || value === '' || (Array.isArray(value) && value.length === 0);
}

function compactMedia(media, canResolveByMessage, dialogueText) {
  return media.map((item, index) => {
    if (!isRecord(item)) return item;
    const result = { ...item };
    if(isStickerMedia(item)) {
      result.conversationUse='emotional-expression';
      result.dialogueRole=stickerDialogueRole(dialogueText);
      if(result.dialogueRole!=='inspect-media') {
        const cue=stickerSocialCue(item);
        if(cue)result.socialCue=cue;
        // Full visual annotations remain in storage and can be requested by seq.
        for(const key of ['description','desc','summary'])delete result[key];
        result.interpretation='结合整段话理解语气；用法候选不代表发送者真实情绪。需要看画面可按消息序号取图。';
      }
    }
    // A local seq is a bridge message handle accepted by qq_get_message_images.
    // Forwarded nodes only have messageSeq, and may not be locally resolvable:
    // keep their transport references, even when they happen to have messageId.
    if (canResolveByMessage) {
      delete result.file;
      delete result.url;
      // Match the image tool's one-based ordering; never filter/reorder items.
      if (result.index == null) result.index = index + 1;
    } else if (result.file === result.url) {
      delete result.file;
    }
    for (const key of ['file', 'url', 'faceId']) {
      if (isEmpty(result[key])) delete result[key];
    }
    return result;
  });
}

export function compactModelMessage(message, options={}) {
  if (!isRecord(message)) return message;
  const result = { ...message };
  // Explicit dialogue roles are easier to ground than an omitted false flag.
  // Only host-authored identity metadata can establish who spoke; the words
  // "我/你" or a quoted claim inside the body must never establish that role.
  if(typeof message.isSelf==='boolean')result.role=message.isSelf?'assistant':'user';
  // No trimming or truncation: differing plain text can contain resolved quote
  // context, and tail can carry the end of a long message absent from text.
  const seenText = new Set();
  for (const key of ['text', 'plain', 'tail']) {
    if (typeof result[key] !== 'string') continue;
    // Retired host guidance is not sender speech. Project it before deduping
    // or any caller's model budget; keep the original message untouched.
    result[key] = shareCardReadView(result[key]);
    if (seenText.has(result[key])) delete result[key];
    else seenText.add(result[key]);
  }
  for (const key of OPTIONAL_FIELDS) {
    if (isEmpty(result[key])) delete result[key];
  }
  for (const key of DEFAULT_FALSE_FIELDS) {
    if (result[key] === false) delete result[key];
  }
  if (Array.isArray(result.media)) {
    const canResolveByMessage = Number.isSafeInteger(message.seq) && message.seq > 0;
    result.media = compactMedia(result.media, canResolveByMessage, shareCardReadView(options.dialogueText??message.plain??message.text??''));
  }
  return result;
}

export function compactModelData(data) {
  if (Array.isArray(data)) return data.map(compactModelData);
  if (!isRecord(data)) return data;
  // An archived source (including structured homepage data) is original
  // evidence, even if its own content happens to contain a messages array.
  if (data.source === 'resources-not-memory') return data;
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [
    key,
    (key === 'messages' || key === 'newMessages' || key === 'recent') && Array.isArray(value)
      ? value.map(compactModelMessage)
      : compactModelData(value)
  ]));
}

export function serializeModelData(data) {
  return JSON.stringify(compactModelData(data));
}
