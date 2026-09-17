$ErrorActionPreference = 'Stop'

# A stale Expo process can keep Metro's default port after the terminal closes.
# Only stop Node listeners on that port; a different service needs inspection.
$owners = @(netstat -ano -p TCP | ForEach-Object {
  if ($_ -match '^\s*TCP\s+\S+:8081\s+\S+\s+LISTENING\s+(\d+)\s*$') {
    [int]$Matches[1]
  }
} | Select-Object -Unique)

foreach ($ownerId in $owners) {
  $listener = Get-Process -Id $ownerId -ErrorAction Stop
  if ($listener.ProcessName -ne 'node') {
    throw "Port 8081 is held by $($listener.ProcessName) (PID $ownerId). Stop it manually before starting Expo."
  }

  Write-Host "Stopping stale Node listener on port 8081 (PID $ownerId)."
  Stop-Process -Id $ownerId -Force
}

if ($owners.Count -gt 0) {
  Start-Sleep -Seconds 2
}

npx expo start --clear
exit $LASTEXITCODE
