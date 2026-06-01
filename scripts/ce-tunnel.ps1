#requires -Version 5.1
<#
  ce-tunnel.ps1 — keeps a permanent SSH reverse tunnel from this laptop to
  the EC2 demo box, so the dashboard's Video Analytics and Agentic AI proxies
  can reach the private 192.168.10.x services via this machine.

  Run via Task Scheduler. Loops forever, auto-restarting ssh on any failure.
  Logs to %USERPROFILE%\ce-tunnel.log. Use Stop-Process via Task Manager (or
  Task Scheduler "End" action) to stop it.
#>

$ErrorActionPreference = 'Continue'

# ── Config ──────────────────────────────────────────────────────────────
$Key      = Join-Path $env:USERPROFILE 'Downloads\connected-enterprise.pem'
$Remote   = 'ubuntu@52.3.31.129'
$LogFile  = Join-Path $env:USERPROFILE 'ce-tunnel.log'
$Retry    = 10            # seconds between restart attempts
$Forwards = @(
  '5000:192.168.10.100:5000',   # nvidia inference  → EC2 :5000
  '5001:192.168.10.160:5000',   # hailo  inference  → EC2 :5001
  '5006:192.168.10.160:5006'    # agentic AI server → EC2 :5006
)

# ── Helpers ─────────────────────────────────────────────────────────────
function Log([string]$Msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 's'), $Msg
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

if (-not (Test-Path $Key)) {
  Log "FATAL: SSH key not found at $Key"
  Start-Sleep 30; exit 1
}

# Build ssh args once
$sshArgs = @(
  '-i', $Key,
  '-N',                                      # no remote command, just hold forwards
  '-o', 'ServerAliveInterval=30',
  '-o', 'ServerAliveCountMax=3',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'BatchMode=yes',                     # never prompt — fail fast if key is wrong
  '-o', 'TCPKeepAlive=yes'
)
foreach ($f in $Forwards) { $sshArgs += @('-R', $f) }
$sshArgs += $Remote

Log "ce-tunnel started · key=$Key · remote=$Remote · forwards=$($Forwards -join ', ')"

# ── Forever loop ────────────────────────────────────────────────────────
while ($true) {
  Log "starting ssh tunnel…"
  $proc = Start-Process -FilePath 'ssh.exe' -ArgumentList $sshArgs `
            -NoNewWindow -PassThru -Wait `
            -RedirectStandardError "$LogFile.err" `
            -RedirectStandardOutput "$LogFile.out"
  Log "ssh exited (code $($proc.ExitCode)); reconnecting in ${Retry}s…"
  # Surface any stderr from the last run into the main log
  if (Test-Path "$LogFile.err") {
    Get-Content "$LogFile.err" -ErrorAction SilentlyContinue | ForEach-Object { Log "  ssh: $_" }
    Remove-Item "$LogFile.err" -ErrorAction SilentlyContinue
    Remove-Item "$LogFile.out" -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds $Retry
}
