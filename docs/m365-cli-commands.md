# CLI for Microsoft 365 – Use Cases

## Use Case: Aktuellste Outlook‑Mail ausgeben

- Zweck: Neueste Nachricht aus dem Posteingang (Inbox) anzeigen.
- Voraussetzungen:
  - CLI for Microsoft 365 installiert (`m365 --version`).
  - Anmelden: `m365 login` (delegierte Berechtigung verlangt mindestens `Mail.Read`).

### Direkt über Microsoft Graph (empfohlen)

- Aktueller Benutzer (neuste Mail aus Inbox als kompaktes JSON):
  - PowerShell-sicher (vermeidet `$`-Interpolation und `&`-Parsing):
    - `m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].{subject:subject,from:from.emailAddress.address,received:receivedDateTime,webLink:webLink}' --output json`

- Für einen bestimmten Benutzer (User Principal Name einsetzen):
  - `m365 request --url 'https://graph.microsoft.com/v1.0/users/<user@contoso.com>/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].{subject:subject,from:from.emailAddress.address,received:receivedDateTime,webLink:webLink}' --output json`
  - Hinweis: Erfordert passende App-/Tenant‑Berechtigungen, falls nicht mit dem Zielpostfach eingeloggt.

### Alternative: Outlook-Command mit JMESPath

- Neuste Mail aus Inbox kompakt ausgeben (nimmt das erste Element der Liste):
  - `m365 outlook message list --folderName inbox --output json --query '[0].{subject:subject,from:from.emailAddress.address,received:receivedDateTime,webLink:webLink}'`

### Notizen

- Ordnernamen: Übliche Ordner sind `Inbox`, `Archive`, etc. Siehe Microsoft Graph Mailfolder-Referenz.
- Für Skripting kann `--output text|json|csv|md` und `--query` (JMESPath) genutzt werden.
- PowerShell-Hinweis: URLs mit `$`/`&` in einfache Anführungszeichen setzen (') oder Parameter URL‑encoden, sonst interpretiert PowerShell Variablen/Operatoren.
- Vor der ersten Nutzung ggf. zusätzliche Zustimmung (Consent) für `Mail.Read` erteilen, wenn die CLI danach fragt.

## Use Case: Excel‑Anhang der neusten Mail herunterladen

- Zweck: Ersten Excel‑Anhang (`.xlsx`) der aktuellsten Inbox‑Nachricht speichern.
- Voraussetzungen:
  - `m365 login` (mind. `Mail.Read`) und für Download `attachments:read` implizit via Graph `Mail.Read` abgedeckt.

### Schritt-für-Schritt (PowerShell, getestet)

1) Neueste Nachricht ermitteln (liefert `id`):
   - `m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].{id:id,subject:subject,received:receivedDateTime}' --output json`

2) Excel‑Anhang herunterladen (nimmt den ersten .xlsx‑Anhang und speichert nach `tmp/`):
   - `powershell
     $messageId = (m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].id' --output text).Trim()
     $attachListUrl = ('https://graph.microsoft.com/v1.0/me/messages/{0}/attachments' -f $messageId)
     $attId = (m365 request --url $attachListUrl --output json --query 'value[?contentType==`"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`"] | [0].id' | Out-String).Trim()
     $attachGetUrl = ('https://graph.microsoft.com/v1.0/me/messages/{0}/attachments/{1}' -f $messageId, $attId)
     $attJson = m365 request --url $attachGetUrl --output json --query '{name:name,contentBytes:contentBytes}'
     $att = $attJson | ConvertFrom-Json
     $bytes = [Convert]::FromBase64String($att.contentBytes)
     $outDir = Join-Path (Resolve-Path .) 'tmp'
     New-Item -ItemType Directory -Force -Path $outDir | Out-Null
     $outFile = Join-Path $outDir $att.name
     [IO.File]::WriteAllBytes($outFile, $bytes)
     Write-Host "Saved:" $outFile
     `

Hinweise:
- Mehrere Anhänge: Die JMESPath‑Query wählt `[0]` (ersten Treffer). Entferne `[0]`, um alle `id/name` zu listen.
- Anderer Benutzer: Ersetze `me` durch `users/<user@contoso.com>` in den URLs.
- PowerShell‑Quoting: Verwende einfache Anführungszeichen (') für URLs mit `$`/`&` oder baue die URL in eine Variable.

## Use Case: Auf die neueste Mail antworten

- Zweck: Auf die aktuellste Mail im Posteingang antworten (Reply bzw. ReplyAll).
- Voraussetzung: `m365 login` mit Berechtigung zum Senden (delegiert: `Mail.Send`).

### Reply (nur an Absender)

- PowerShell (getestet):
  - `powershell
    $messageId = (m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].id' --output text).Trim()
    $payload = @{ comment = 'Hello from CLI – this reply includes body text.' } | ConvertTo-Json -Compress
    $url = ('https://graph.microsoft.com/v1.0/me/messages/{0}/reply' -f $messageId)
    m365 request --method post --url $url --content-type 'application/json' --body $payload
    `

Präzises JSON ohne PowerShell-Quoting (empfohlen):
- Lege den Body in eine Datei ab und referenziere ihn (vermeidet alle `&`/`$`/Quote‑Probleme):
  - `powershell
    $msgId = (m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=id' --output json | ConvertFrom-Json).value[0].id
    New-Item -ItemType Directory -Force -Path tmp | Out-Null
    '{"comment":"Reply via file payload – visible content."}' | Set-Content -Path tmp\reply-body.json -Encoding UTF8
    m365 request --method post --url ("@graph/me/messages/{0}/reply" -f $msgId) --content-type 'application/json' --body @tmp\reply-body.json
    `

### ReplyAll (Antwort an alle)

- PowerShell:
  - `powershell
    $messageId = (m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1' --query 'value[0].id' --output text).Trim()
    $payload = @{ comment = 'Reply all via CLI – body text included.' } | ConvertTo-Json -Compress
    $url = ('https://graph.microsoft.com/v1.0/me/messages/{0}/replyAll' -f $messageId)
    m365 request --method post --url $url --content-type 'application/json' --body $payload
    `

Notizen
- Die Graph‑Actions `reply`/`replyAll` senden direkt. Für Entwurf zuerst `createReply` nutzen, dann `PATCH` und `send`.
- Für andere Postfächer ersetze `me` durch `users/<user@contoso.com>`.
- Wenn der empfangene Reply leer wirkt: Stelle sicher, dass das JSON den Schlüssel `comment` enthält und `--content-type application/json` gesetzt ist. Alternativ `replyAll` verwenden oder die Variante `createReply` → `send` nutzen.
- Troubleshooting (leere Antworten):
  - Verwende die Datei‑Variante (siehe oben), um Quoting/Encoding‑Fehler zu umgehen (keine Here‑Strings mit NUL‑Bytes/BOM).
  - Nutze exakt `comment` (klein) im JSON. Optional kannst du zusätzlich `message.toRecipients` setzen; der Body stammt aber ausschließlich aus `comment`.
  - Prüfe Inhalt serverseitig: `m365 request --url '@graph/me/mailFolders/SentItems/messages?$orderby=sentDateTime desc&$top=1&$select=id' --output json` und dann `.../messages/{id}?$select=body`.
  - Falls HTML benötigt wird: wechsle auf `createReply` + `PATCH body` + `send`. Einige Tenants filtern unsichere HTML‑Snippets.

### Alternative via Graph sendMail (Quasi‑Reply)

- Wenn reply/replyAll in deinem Tenant keinen Body persistiert: Sende eine “Quasi‑Reply” mit `sendMail` (sichtbarer Body, optional Threading über Header). Achtung: Bei manchen Tenants schlägt `sendMail` mit 500 fehl (Richtlinien/Transportregeln).

- Minimal (ohne Threading):
  - `powershell
    $m = m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=subject,from' --output json | ConvertFrom-Json
    $to = $m.value[0].from.emailAddress.address; $sub = 'RE: ' + $m.value[0].subject
    m365 request --method post --url 'https://graph.microsoft.com/v1.0/me/sendMail' --content-type 'application/json' --body (@{ message = @{ subject=$sub; body=@{ contentType='HTML'; content='<p>Antwort aus CLI – sichtbar.</p>' }; toRecipients=@(@{ emailAddress=@{ address=$to } }) }; saveToSentItems=$true } | ConvertTo-Json -Depth 8 -Compress)
    `

- Mit Threading (In-Reply-To Header):
  - `powershell
    $m = m365 request --url '@graph/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=subject,from,internetMessageId' --output json | ConvertFrom-Json
    $to = $m.value[0].from.emailAddress.address; $sub = 'RE: ' + $m.value[0].subject; $inReplyTo = $m.value[0].internetMessageId
    $payload = @{ message=@{ subject=$sub; body=@{ contentType='Text'; content='Antwort per sendMail (threaded)'; } ; toRecipients=@(@{ emailAddress=@{ address=$to } }) ; internetMessageHeaders=@(@{ name='In-Reply-To'; value=$inReplyTo }) }; saveToSentItems=$true } | ConvertTo-Json -Depth 8 -Compress
    m365 request --method post --url 'https://graph.microsoft.com/v1.0/me/sendMail' --content-type 'application/json' --body $payload
    `

## Use Case: Sichtbare Antwort ohne Threading

- Ziel: Antwort mit sichtbarem Body senden, ohne Konversations‑Threading zu erzwingen.
- Vorgehen (getestet): Verwende `m365 outlook mail send` mit RE:-Betreff.

```
powershell
$m = m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=subject,from' --output json | ConvertFrom-Json
$to = $m.value[0].from.emailAddress.address
$sub = 'RE: ' + $m.value[0].subject
m365 outlook mail send --to $to --subject $sub --bodyContents '<p>Antwort ohne Threading (neue Konversation) aus der CLI.</p>' --bodyContentType HTML --saveToSentItems true
```

Verifikation (BodyPreview prüfen):
- `m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$orderby=sentDateTime desc&$top=1&$select=id,subject,bodyPreview' --output json`

## Use Case: Antwort mit Excel‑Anhang senden

- Ziel: Auf eine eingegangene Mail antworten und die zuvor gespeicherte Excel erneut anhängen.
- Voraussetzungen: Datei liegt lokal unter `tmp/Planung_SAP_Stamtisch_Events.xlsx` (siehe Abschnitt „Excel‑Anhang herunterladen“). Optional: Inhalte auslesen, siehe `docs/m365-cli-excel.md`.

```
powershell
$subj = 'Excel bitte bearbeiten'
$inbox = m365 outlook message list --folderName inbox --output json | ConvertFrom-Json
$msg = $inbox | Where-Object { $_.subject -eq $subj } | Sort-Object -Property receivedDateTime -Descending | Select-Object -First 1
$to = $msg.from.emailAddress.address
$replySub = 'RE: ' + $msg.subject
$attPath = (Resolve-Path 'tmp\Planung_SAP_Stamtisch_Events.xlsx').Path
m365 outlook mail send --to $to --subject $replySub --bodyContents '<p>Hallo, ich hänge die Excel wieder an. Ich melde mich mit dem Ergebnis.</p><p>Viele Grüße<br/>Hoang</p>' --bodyContentType HTML --attachment $attPath --saveToSentItems true
```

Verifikation (Anhang prüfen):
```
powershell
$last = m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/SentItems/messages?$orderby=sentDateTime desc&$top=1&$select=id,subject,hasAttachments' --output json | ConvertFrom-Json
$id = $last.value[0].id
m365 request --url ("https://graph.microsoft.com/v1.0/me/messages/{0}/attachments?$select=name,contentType,size" -f $id) --output json
```

Hinweis: Dieser Ablauf erzeugt eine neue E‑Mail (kein echtes Reply/Threading), auch wenn der Betreff mit „RE:“ beginnt.

## Use Case: Neue Mail ohne Anhang senden

- Ziel: Eine einfache, sichtbare E‑Mail ohne Anhang senden (keine Konversation/kein Threading).

Variante A (Empfänger explizit):
```
m365 outlook mail send --to "empfaenger@contoso.com" --subject "Status Update" --bodyContents "Kurzes Update: Datei geprüft, Ergebnis folgt." --bodyContentType Text --saveToSentItems true
```

Variante B (an Absender der neuesten Inbox‑Mail):
```
powershell
$m = m365 request --url 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$orderby=receivedDateTime desc&$top=1&$select=subject,from' --output json | ConvertFrom-Json
$to = $m.value[0].from.emailAddress.address
$sub = 'RE: ' + $m.value[0].subject
m365 outlook mail send --to $to --subject $sub --bodyContents '<p>Kurzes Update zur Anfrage – Details folgen.</p>' --bodyContentType HTML --saveToSentItems true
```

## Use Case: Teams-Besprechung erstellen (Online-Meeting)

- Ziel: Eine Teams-Besprechung anlegen und Einladung versenden.
- Voraussetzungen:
  - `m365 login` (delegiert), Graph Kalenderrechte (`Calendars.ReadWrite`).
  - Zeitzone anpassen (Beispiel: `Europe/Zurich`).

Beispiel (Start in 15 Minuten, Dauer 30 Minuten):
```
powershell
$to='hoang.duong@pureconsulting.ch'
$subject='Teams-Besprechung (ClaimPilot Test)'
$start=(Get-Date).AddMinutes(15)
$end=$start.AddMinutes(30)
$tz='Europe/Zurich'
$bodyHtml = '<p>Hallo, dies ist eine automatisch erstellte Teams-Besprechung (Test).</p>'
$event = @{ subject = $subject
            body = @{ contentType='HTML'; content=$bodyHtml }
            start = @{ dateTime = $start.ToString('yyyy-MM-ddTHH:mm:ss'); timeZone=$tz }
            end   = @{ dateTime = $end.ToString('yyyy-MM-ddTHH:mm:ss'); timeZone=$tz }
            attendees = @(@{ emailAddress = @{ address = $to; name = 'Hoang Duong' }; type = 'required' })
            isOnlineMeeting = $true
            onlineMeetingProvider = 'teamsForBusiness' } | ConvertTo-Json -Depth 8 -Compress

New-Item -ItemType Directory -Force -Path tmp | Out-Null
Set-Content -Path tmp\teams-event.json -Value $event -Encoding ASCII

m365 request --method post --url 'https://graph.microsoft.com/v1.0/me/events' --content-type 'application/json' --prefer 'return=representation' --body @tmp\teams-event.json --output json
```

Verifikation (Join-Link/Meeting): Antwort enth�lt u. a. `isOnlineMeeting`, `onlineMeetingProvider`, `webLink` und ggf. `onlineMeeting.joinUrl`.

Variante: Fester Start/Ende (ISO 8601) und mehrere Teilnehmer (required/optional)
```
powershell
$attendees = @(
  @{ emailAddress = @{ address = 'hoang.duong@pureconsulting.ch'; name = 'Hoang Duong' }; type = 'required' },
  @{ emailAddress = @{ address = 'second.person@contoso.com'   ; name = 'Second Person' }; type = 'optional' }
)
$event = @{ subject = 'Teams-Meeting (ISO Beispiel)'
            body = @{ contentType='HTML'; content='<p>Agenda Punkte...</p>' }
            start = @{ dateTime = '2025-10-01T09:00:00'; timeZone='Europe/Zurich' }
            end   = @{ dateTime = '2025-10-01T09:30:00'; timeZone='Europe/Zurich' }
            attendees = $attendees
            isOnlineMeeting = $true
            onlineMeetingProvider = 'teamsForBusiness' } | ConvertTo-Json -Depth 8 -Compress
New-Item -ItemType Directory -Force -Path tmp | Out-Null
Set-Content -Path tmp\teams-event-iso.json -Value $event -Encoding ASCII
m365 request --method post --url 'https://graph.microsoft.com/v1.0/me/events' --content-type 'application/json' --prefer 'return=representation' --body @tmp\teams-event-iso.json --output json
```
