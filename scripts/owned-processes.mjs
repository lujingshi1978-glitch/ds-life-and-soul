// Process ownership is established only by a previously recorded full identity.
// Importing this module performs no process inspection or termination.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const powershell = (script) =>
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script,
    ],
    { encoding: "utf8", windowsHide: true },
  ).trim();
const identityFields = "ProcessId,ExecutablePath,CommandLine,CreationDate";
const validPid = (pid) => Number.isSafeInteger(Number(pid)) && Number(pid) > 0;
const validIdentity = (value) =>
  value &&
  validPid(value.ProcessId) &&
  ["ExecutablePath", "CommandLine", "CreationDate"].every(
    (key) => typeof value[key] === "string" && value[key].length > 0,
  );
// A Windows ParentProcessId is a number, not a durable parent identity. After
// PID reuse, an unrelated older process may report the new root's PID as PPID.
export function creationTime(value) {
  if(typeof value !== 'string')return null;
  const legacy=value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/);
  const n=legacy?Number(legacy[1]):Date.parse(value);
  return Number.isFinite(n)?n:null;
}
export function identityHash(value) {
  // This field order matches the original deployment registry format.
  const identity = {
    ProcessId: value.ProcessId,
    ExecutablePath: value.ExecutablePath,
    CommandLine: value.CommandLine,
    CreationDate: value.CreationDate,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}
export function inspectProcess(pid) {
  if (process.platform !== "win32")
    throw Error("Process ownership inspection is verified only on Windows");
  if (!validPid(pid)) return null;
  const raw = powershell(
    '$ErrorActionPreference="Stop";$p=Get-CimInstance Win32_Process -Filter "ProcessId = ' +
      Number(pid) +
      '";if($p){$p|Select-Object ' +
      identityFields +
      "|ConvertTo-Json -Compress}",
  );
  return raw ? JSON.parse(raw) : null;
}
function listTree(rootPids) {
  if (!rootPids.length) return [];
  const raw = powershell(
    "$all=@(Get-CimInstance Win32_Process);$ids=@(" +
      rootPids.map(Number).join(",") +
      ");do{$before=$ids.Count;$ids+=@($all|Where-Object{$ids -contains $_.ParentProcessId -and $ids -notcontains $_.ProcessId}|ForEach-Object{$_.ProcessId})}while($ids.Count -gt $before);@($all|Where-Object{$ids -contains $_.ProcessId}|Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate)|ConvertTo-Json -Compress",
  );
  if (!raw) return [];
  const value = JSON.parse(raw);
  return Array.isArray(value) ? value : [value];
}
function terminateExact(record, expected) {
  // Hold the .NET process handle before the final CIM comparison. Killing that
  // handle cannot accidentally target a later process that reuses the PID.
  const expected64 = Buffer.from(JSON.stringify(expected), "utf8").toString(
    "base64",
  );
  // Compare the exact original PowerShell date serialization: its legacy
  // millisecond rounding differs from DateTimeOffset.ToUnixTimeMilliseconds.
  const creationCheck =
    "$createdJson=$actual|Select-Object CreationDate|ConvertTo-Json -Compress;$created=[regex]::Match($createdJson,'\"CreationDate\":\"([^\"]+)\"').Groups[1].Value.Replace('\\/','/');";
  const script =
    '$ErrorActionPreference="Stop";$held=$null;try{$held=Get-Process -Id ' +
    Number(record.pid) +
    ' -ErrorAction SilentlyContinue;if(-not $held){"gone";exit};$null=$held.Handle;$expected=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' +
    expected64 +
    '"))|ConvertFrom-Json;$actual=Get-CimInstance Win32_Process -Filter "ProcessId = ' +
    Number(record.pid) +
    '";if(-not $actual){"gone";exit};' +
    creationCheck +
    'if($actual.ProcessId -ne $expected.ProcessId -or [string]$actual.ExecutablePath -cne [string]$expected.ExecutablePath -or [string]$actual.CommandLine -cne [string]$expected.CommandLine -or $created -cne [string]$expected.CreationDate){"changed";exit};$held.Kill();if(-not $held.WaitForExit(5000)){"error";exit};"stopped"}catch{"error"}finally{if($held){$held.Dispose()}}';
  return powershell(script).split(/\r?\n/).at(-1);
}

// backend is injectable so safety behavior can be checked without killing any
// real process. Production callers leave it omitted.
export function snapshotOwned(records, { backend = {} } = {}) {
  const inspect = backend.inspect || inspectProcess,
    list = backend.list || listTree;
  const verified = [],
    unverified = [],
    gone = [];
  for (const record of records) {
    if (!validPid(record.pid) || !record.identityHash) {
      unverified.push(record);
      continue;
    }
    let current;
    try {
      current = inspect(Number(record.pid));
    } catch {
      unverified.push(record);
      continue;
    }
    if (!current) {
      gone.push(record);
      continue;
    }
    if (
      !validIdentity(current) ||
      identityHash(current) !== record.identityHash
    ) {
      unverified.push(record);
      continue;
    }
    verified.push({ ...record, identity: current });
  }
  let tree;
  try {
    tree = verified.length
      ? list(verified.map((record) => Number(record.pid)))
      : [];
  } catch {
    return { owned: [], unverified: [...unverified, ...verified], gone };
  }
  const owned = [],
    seen = new Set();
  for (const parent of verified) {
    let current;
    try {
      current = inspect(Number(parent.pid));
    } catch {
      unverified.push(parent);
      continue;
    }
    if (!current) {
      gone.push(parent);
      continue;
    }
    if (identityHash(current) !== parent.identityHash) {
      unverified.push(parent);
      continue;
    }
    const rootInTree = tree.find((row) => row.ProcessId === Number(parent.pid));
    if (!rootInTree || identityHash(rootInTree) !== parent.identityHash) {
      unverified.push(parent);
      continue;
    }
    const queue = [{ row: rootInTree, record: parent }];
    for (let index = 0; index < queue.length; index++) {
      const { row, record } = queue[index];
      if (seen.has(row.ProcessId)) continue;
      seen.add(row.ProcessId);
      owned.push({
        ...record,
        pid: row.ProcessId,
        identityHash: identityHash(row),
        identity: {
          ProcessId: row.ProcessId,
          ExecutablePath: row.ExecutablePath,
          CommandLine: row.CommandLine,
          CreationDate: row.CreationDate,
        },
      });
      for (const child of tree.filter(
        (candidate) =>
          candidate.ParentProcessId === row.ProcessId &&
          candidate.ProcessId !== row.ProcessId,
      )) {
        const parentTime=creationTime(row.CreationDate),childTime=creationTime(child.CreationDate);
        if(parentTime!==null&&childTime!==null&&childTime<parentTime)continue;
        if(!validIdentity(child)||parentTime===null||childTime===null){
          unverified.push({id:parent.id+":child:"+child.ProcessId,pid:child.ProcessId,parentId:parent.id,parentPid:row.ProcessId,identityHash:null,reason:"child-identity-unavailable"});
          continue;
        }
        queue.push({
          row: child,
          record: {
            id: parent.id + ":child:" + child.ProcessId,
            pid: child.ProcessId,
            command: child.ExecutablePath,
            entry: null,
            parentId: parent.id,
            parentPid: row.ProcessId,
            identityHash: identityHash(child),
          },
        });
      }
    }
  }
  return { owned, unverified, gone };
}

export function stopOwned(records, { backend = {} } = {}) {
  if (process.platform !== "win32" && !backend.inspect)
    throw Error("Automatic stop is verified only on Windows");
  const inspect = backend.inspect || inspectProcess,
    terminate = backend.terminate || terminateExact;
  const snapshot = snapshotOwned(records, { backend });
  const remaining = [...snapshot.unverified],
    stopped = [],
    stoppedPids = [],
    failures = [];
  for (const record of [...snapshot.owned].reverse()) {
    let current;
    try {
      current = inspect(Number(record.pid));
    } catch {
      remaining.push(record);
      continue;
    }
    if (!current) continue;
    if (
      !validIdentity(current) ||
      identityHash(current) !== record.identityHash
    ) {
      remaining.push(record);
      continue;
    }
    try {
      const status = terminate(record, current);
      if (status === "stopped") {
        stopped.push(record.id);
        stoppedPids.push(record.pid);
      } else if (status !== "gone") {
        remaining.push(record);
        if (status === "error") failures.push(record.id);
      }
    } catch {
      remaining.push(record);
      failures.push(record.id);
    }
  }
  const clean = remaining.map(({ identity, ...record }) => record);
  return {
    ok: clean.length === 0,
    stopped,
    stoppedPids,
    remaining: clean,
    unverified: clean.map((record) => record.id),
    failures,
    dataRemoved: false,
  };
}
