export function qqIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).map(v => v.trim()).filter(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) && Number(v) > 0))];
}

export function friendAuthorizationList(manual, friends, denied, selfId) {
  const blocked = new Set(qqIds(denied));
  return qqIds([...qqIds(manual), ...qqIds(friends)])
    .filter(id => id !== String(selfId) && !blocked.has(id));
}
