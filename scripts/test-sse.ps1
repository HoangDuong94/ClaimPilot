param(
  [string]$Prompt = 'SSE MCP Test – zeig mir alle Teams',
  [string]$Url = 'http://localhost:9999/ai/agent/stream'
)

$ErrorActionPreference = 'Continue'

Write-Host "Starting CAP server (npm start) in background..."
Start-Process -FilePath npm -ArgumentList 'start' -WorkingDirectory "$PSScriptRoot\.." -WindowStyle Hidden | Out-Null

# Wait up to ~12 seconds for server
$max = 24
for ($i=0; $i -lt $max; $i++) {
  try { Invoke-WebRequest -UseBasicParsing http://localhost:9999/ | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}

$env:SSE_URL = $Url
Write-Host "Posting to $Url prompt=$Prompt"
Push-Location "$PSScriptRoot\.."
try {
  node scripts/sse-debug.js $Prompt
} finally {
  Pop-Location
}

Write-Host "Done."

