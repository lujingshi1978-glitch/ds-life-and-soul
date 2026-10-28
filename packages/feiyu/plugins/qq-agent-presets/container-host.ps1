$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 $request=[Console]::In.ReadToEnd()|ConvertFrom-Json
 Add-Type -Path (Join-Path $PSScriptRoot 'AppContainer.cs')
 switch ($request.action) {
  'runtime-sid' { @{sid=[FeiyuContainer]::RuntimeSid()}|ConvertTo-Json -Compress }
  'drive-defined' { @{defined=[FeiyuContainer]::DriveDefined([string]$request.drive)}|ConvertTo-Json -Compress }
  'reap-lease' { @{ok=$true;reaped=[FeiyuContainer]::ReapLease([string]$request.record,[string]$request.mountBase)}|ConvertTo-Json -Compress }
  'prepare' { @{sid=[FeiyuContainer]::Prepare([string]$request.name)}|ConvertTo-Json -Compress }
  'grant' { [FeiyuContainer]::Grant([string]$request.path,[string]$request.sid,[bool]$request.write,[bool]$request.directory);@{ok=$true}|ConvertTo-Json -Compress }
  'run' { [FeiyuContainer]::Run([string]$request.name,[string]$request.executable,[string[]]$request.args,[string]$request.cwd,[string[]]$request.environment,[int]$request.timeout,[string]$request.cancelFile,[string]$request.mount,[string]$request.workspace,[string]$request.runtime)|ConvertTo-Json -Compress }
  'remove' { [FeiyuContainer]::Remove([string]$request.name);@{ok=$true}|ConvertTo-Json -Compress }
  default { throw 'INVALID_HOST_ACTION' }
 }
} catch { $cause=$_.Exception;while($cause.InnerException){$cause=$cause.InnerException};@{ok=$false;error=$cause.Message;nativeCode=$cause.NativeErrorCode;type=$cause.GetType().FullName}|ConvertTo-Json -Compress;exit 1 }
