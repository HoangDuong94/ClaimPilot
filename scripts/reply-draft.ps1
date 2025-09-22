param(
  [string]$Subject = 'Excel bitte bearbeiten',
  [string]$BodyText = 'Reply via draft flow plain text.'
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg){ Write-Host ('[reply-draft] ' + $msg) }

try {
  # 1) Find latest inbox message with the given subject
  Write-Step "Suche Inbox-Nachricht mit Betreff '$Subject'"
  $inboxJson = m365 outlook message list --folderName inbox --output json
  $inbox = $inboxJson | ConvertFrom-Json
  $msg = $inbox | Where-Object { $_.subject -eq $Subject } | Sort-Object -Property receivedDateTime -Descending | Select-Object -First 1
  if (-not $msg) { throw "Keine Nachricht mit Betreff '$Subject' gefunden." }

  $origId = $msg.id
  Write-Step "createReply für MessageId=$origId"
  $createUrl = 'https://graph.microsoft.com/v1.0/me/messages/' + $origId + '/createReply'
  $draft = (m365 request --method post --url $createUrl --output json | ConvertFrom-Json)
  if (-not $draft -or -not $draft.id) { throw 'createReply lieferte keine Draft-ID.' }
  $draftId = $draft.id
  $etag = $draft.'@odata.etag'
  Write-Step "DraftId=$draftId"

  # 2) Patch body (Text) using ASCII file to avoid encoding/quoting issues
  $safeBody = $BodyText
  $json = '{"body":{"contentType":"Text","content":"' + $safeBody + '"}}'
  $tmpDir = Join-Path (Resolve-Path .) 'tmp'
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  $patchPath = Join-Path $tmpDir 'reply-patch.json'
  Set-Content -Path $patchPath -Value $json -Encoding ASCII -NoNewline

  Write-Step 'Patch body (Text) auf Draft'
  $patchUrl = 'https://graph.microsoft.com/v1.0/me/messages/' + $draftId
  # Hinweis: CLI-Dateiargumente werden mit @<pfad> übergeben; keine Here-Strings nötig
  $patched = (m365 request --method patch --url $patchUrl --content-type 'application/json' --if-match $etag --prefer 'return=representation' --body @tmp\reply-patch.json --output json | ConvertFrom-Json)
  if (-not $patched -or -not $patched.id) { throw 'PATCH fehlgeschlagen (keine Antwort oder ID).' }
  $sendId = $patched.id
  Write-Step ("Patched. sendId=" + $sendId)

  # 3) Send draft
  Write-Step 'Sende Draft'
  $sendUrl = 'https://graph.microsoft.com/v1.0/me/messages/' + $sendId + '/send'
  m365 request --method post --url $sendUrl | Out-Null

  Start-Sleep -Seconds 6
  Write-Step 'Prüfe Sent Items'
  $sent = (m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$orderby=sentDateTime desc&$top=10&$select=id,subject' --output json | ConvertFrom-Json).value
  $hit = $sent | Where-Object { $_.subject -eq ('RE: ' + $Subject) } | Select-Object -First 1
  if (-not $hit) { throw 'Gesendete Antwort nicht gefunden.' }

  $getUrl = 'https://graph.microsoft.com/v1.0/me/messages/' + $hit.id + '?$select=body'
  $bodyText = (m365 request --url $getUrl --prefer 'outlook.body-content-type="text"' --output json | ConvertFrom-Json).body.content

  Write-Step 'OK'
  Write-Output ('Subject: ' + $hit.subject)
  Write-Output ('Body: ' + $bodyText)
  exit 0
}
catch {
  Write-Error $_
  exit 1
}
