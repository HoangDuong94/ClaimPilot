# CLI M365 – Excel lesen

## Ziel
- Excel-Datei (z. B. E‑Mail‑Anhang) per CLI ansehen und Inhalte strukturiert ausgeben.

## Vorgehen (über OneDrive + Graph Excel API)

1) Datei nach OneDrive hochladen (Dokumente-Bibliothek)
- OneDrive-Dokumente-URL ermitteln (einmalig):
  - `m365 request --url '@graph/me/drive' --output json --query '{webUrl:webUrl}'`
- Datei hochladen (ersetze die URL durch deinen `webUrl`-Wert mit `/Documents`):
  - `m365 file add --filePath .\tmp\Planung_SAP_Stamtisch_Events.xlsx --folderUrl "https://<tenant>-my.sharepoint.com/personal/<upn>/Documents"`

2) Arbeitsblätter listen und Used Range lesen (PowerShell-sicher)
- Arbeitsblätter (liefert Namen):
  - `powershell
    $itemPath = '/Planung_SAP_Stamtisch_Events.xlsx'
    $wsUrl = ('https://graph.microsoft.com/v1.0/me/drive/root:{0}:/workbook/worksheets?$select=name' -f $itemPath)
    m365 request --url $wsUrl --output json
    `
- Wertebereich des gewünschten Blatts (Beispiel: „Stammtisch Planung“):
  - `powershell
    $itemPath = '/Planung_SAP_Stamtisch_Events.xlsx'
    $sheetName = 'Stammtisch Planung'
    $rangeUrl = ('https://graph.microsoft.com/v1.0/me/drive/root:{0}:/workbook/worksheets(''{1}'')/usedRange(valuesOnly=true)?$select=address,text' -f $itemPath,$sheetName)
    m365 request --url $rangeUrl --output json
    `

## Hinweise
- Alternativ fester Bereich: `.../range(address='A3:D20')` mit `$select=text` für reine Textwerte.
- Session nutzen (optional): `POST .../workbook/createSession` und Header `workbook-session-id` bei Folgeaufrufen mitsenden.
- Ohne OneDrive-Upload: Lokal via PowerShell-Modul „ImportExcel“ (nicht Teil der M365-CLI): `Install-Module ImportExcel; Import-Excel .\tmp\file.xlsx`.
