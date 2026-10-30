<#
.SYNOPSIS
  Back up the LFCbot SQLite database on Windows.

.DESCRIPTION
  Stops the LFCbot scheduled task briefly so the copy is consistent, copies the
  database to a timestamped file, prunes old backups, and starts the task again.
  Point -BackupDir at a folder that is itself copied off the machine.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1
#>
param(
  [string]$DatabasePath = (Join-Path $PWD 'data\lfcbot.db'),
  [string]$BackupDir = (Join-Path $PWD 'backups'),
  [int]$Retention = 14,
  [string]$TaskName = 'LFCbot'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $DatabasePath)) {
  throw "No database at $DatabasePath. Run from the repository folder or pass -DatabasePath."
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$wasRunning = $task -and $task.State -eq 'Running'

if ($wasRunning) {
  Write-Host 'Stopping the bot for a consistent snapshot...'
  Stop-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
}

try {
  $stamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
  $archive = Join-Path $BackupDir "lfcbot-$stamp.zip"
  # The WAL and shared-memory files hold recent writes, so copy whichever exist.
  $files = @($DatabasePath, "$DatabasePath-wal", "$DatabasePath-shm") | Where-Object { Test-Path $_ }
  Write-Host "Copying database to $archive ..."
  Compress-Archive -Path $files -DestinationPath $archive
}
finally {
  if ($wasRunning) {
    Write-Host 'Restarting the bot...'
    Start-ScheduledTask -TaskName $TaskName
  }
}

Write-Host "Pruning backups older than $Retention days..."
Get-ChildItem $BackupDir -Filter 'lfcbot-*.zip' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Retention) } |
  Remove-Item

Write-Host "Backup complete: $archive"
