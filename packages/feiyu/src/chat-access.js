export function chatAllowed(kind, id, cfg) {
  const value = String(id);
  const denied = cfg.deny?.[kind] ?? cfg.deny?.[kind + 's'] ?? [];
  if (denied.map(String).includes(value)) return false;
  if(kind==='private'&&cfg.privateFriendsOnly===true&&value!==String(cfg.ownerQQ??'')) {
    const snapshot=cfg.privateFriendSnapshot;
    if(!snapshot||snapshot.account!==String(cfg.friendAuthorization?.selfId??'')||!Number.isFinite(snapshot.at)||Date.now()-snapshot.at>90000||snapshot.at>Date.now()+1000||!snapshot.ids?.includes(value))return false;
  }
  if (kind === 'private' && cfg.allowAllPrivate === true) return true;
  const list = cfg.allow?.[kind] ?? cfg.allow?.[kind + 's'] ?? [];
  if (list.length) return list.map(String).includes(value);
  return cfg.allowAllWhenEmpty === true;
}
