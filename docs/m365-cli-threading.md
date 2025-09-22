# CLI M365 – Reply/Threading Troubleshooting

## Ziel
- Echte Antworten (Threading) testen, Fehlerdetails auslesen und Alternativen mit Prefer‑Headern verifizieren.

## 1) Schnelltest: reply mit comment und Marker

- Datei‑Payload vermeidet PowerShell‑Quoting/Encoding‑Probleme.
```
powershell
# 1) Neueste Nachricht holen
$msgId = (m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=id' --output json | ConvertFrom-Json).value[0].id
# 2) Marker + comment in Datei schreiben
$ts = (Get-Date).ToString('yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Force -Path tmp | Out-Null
'{"comment":"THREAD-TEST-' + $ts + ': reply comment"}' | Set-Content -Path tmp\reply-thread.json -Encoding UTF8
# 3) reply ausführen (mit Debug für volle Antwort/Headers)
m365 request --method post --url ("@graph/me/messages/{0}/reply" -f $msgId) --content-type 'application/json' --body @tmp\reply-thread.json --debug
# 4) Kontrolle: Body der letzten gesendeten Mails nach Marker durchsuchen
$sent = m365 request --url '@graph/me/mailFolders/SentItems/messages?$orderby=sentDateTime desc&$top=10&$select=id,subject' --output json | ConvertFrom-Json
$sent.value | ForEach-Object {
  $b = m365 request --url ("@graph/me/messages/{0}?$select=body" -f $_.id) --output json | ConvertFrom-Json
  if($b.body.content -match 'THREAD-TEST-'){ Write-Output ("Marker gefunden in: " + $_.subject) }
}
```

## 2) Draft‑Flow: createReply → PATCH body → send
```
powershell
$origId = (m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=id' --output json | ConvertFrom-Json).value[0].id
$reply = m365 request --method post --url ("@graph/me/messages/{0}/createReply" -f $origId) --output json | ConvertFrom-Json
$draftId = $reply.id; $etag = $reply.'@odata.etag'
# Einfache Text‑Antwort setzen; If‑Match mit ETag verwenden
$payload = @{ body = @{ contentType = 'Text'; content = 'DRAFT-FLOW body' } } | ConvertTo-Json -Depth 5 -Compress
m365 request --method patch --url ("@graph/me/messages/{0}" -f $draftId) --content-type 'application/json' --if-match $etag --body $payload --debug
# Senden
m365 request --method post --url ("@graph/me/messages/{0}/send" -f $draftId) --debug
```

Hinweise:
- 400 bei PATCH: Prüfe, ob `--if-match` exakt das `@odata.etag` des Entwurfs trägt und `--content-type application/json` gesetzt ist.
- Manche Tenants filtern HTML im Draft‑Flow. Teste zunächst `Text` statt `HTML`.

## 3) sendMail als „Quasi‑Reply“ (mit Thread‑Headern)
```
powershell
$orig = m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=subject,from,internetMessageId' --output json | ConvertFrom-Json
$to = $orig.value[0].from.emailAddress.address; $sub = 'RE: ' + $orig.value[0].subject; $inReplyTo = $orig.value[0].internetMessageId
$payload = @{ message = @{ subject = $sub; body = @{ contentType = 'Text'; content = 'sendMail threaded body' }; toRecipients = @(@{ emailAddress = @{ address = $to } }); internetMessageHeaders = @(@{ name='In-Reply-To'; value=$inReplyTo }) }; saveToSentItems = $true } | ConvertTo-Json -Depth 8 -Compress
# Debug aktivieren, um 500‑Fehlerdetails einzusehen
m365 request --method post --url 'https://graph.microsoft.com/v1.0/me/sendMail' --content-type 'application/json' --body $payload --debug
```

Hinweise:
- 500 bei sendMail: deutet oft auf Richtlinien/Transportregeln hin. Mit `--debug` werden Response‑Headers und ggf. Fehlermeldungen ausgegeben.

## 4) Prefer‑Header testen
- `Prefer: return=representation` auf mutierenden Calls kann eine Antwort mit Ressourcendarstellung liefern.
- `Prefer: outlook.body-content-type="text"` ist vor allem für GET relevant (Text statt HTML im Body).

Beispiele:
```
# reply mit Prefer: return=representation
m365 request --method post --url "@graph/me/messages/{id}/reply" --content-type 'application/json' --body @tmp\reply-thread.json --prefer 'return=representation' --debug
# GET Body als Text
m365 request --url "@graph/me/messages/{id}?$select=body" --prefer 'outlook.body-content-type="text"'
```

## 5) Empfehlungen
- Für produktive Antworten solange Non‑Threaded‑Weg nutzen (`m365 outlook mail send`), bis Reply/Policies geklärt sind.
- Für Diagnose immer `--debug` aktivieren und Fehlerausgaben sichern.

## Empfohlen: Threaded Reply per Script (Draft‑Flow)

Dieser geprüfte Ablauf nutzt ein PowerShell‑Skript, das den Draft‑Flow robust ausführt und Quoting/Encoding‑Probleme umgeht.

- Script: `scripts/reply-draft.ps1`
- Schritte: `createReply` → `PATCH` Body (Text) → `send` → Verifikation in Sent Items
- Voraussetzungen: `m365 login` (Delegiert, inkl. Mail.Send), Microsoft 365 CLI installiert

Verwendung
- Standard (betrefft „Excel bitte bearbeiten“, Textkörper als Plain Text):
  - `powershell -ExecutionPolicy Bypass -File scripts/reply-draft.ps1`
- Mit Parametern (Betreff und Body anpassen):
  - `powershell -ExecutionPolicy Bypass -File scripts/reply-draft.ps1 -Subject 'Excel bitte bearbeiten' -BodyText 'Hallo, ich habe die Excel geprüft und melde mich mit den Ergebnissen.'`

Was das Script macht
- Sucht die neueste Inbox‑Mail mit dem angegebenen Betreff
- Erstellt einen Draft via Graph `createReply`
- Setzt den Antwort‑Body als Text via `PATCH` (JSON aus Datei, ASCII, um Encoding‑Probleme zu vermeiden)
- Sendet den Draft und verifiziert anschließend die gesendete Nachricht (Betreff + Body)

Troubleshooting
- 404 beim Senden: Verwende stets die ID aus der PATCH‑Antwort (das Script macht das automatisch).
- 400 beim PATCH: Meist JSON/Encoding – das Script verwendet eine Datei (`tmp/reply-patch.json`) im ASCII‑Encoding, um das zu vermeiden.
- HTML‑Antwort: Aktuell setzt das Script `contentType='Text'`. Für HTML kann `contentType` im Script auf `HTML` geändert und `BodyText` mit HTML übergeben werden. Beachte mögliche Tenant‑Policies.
