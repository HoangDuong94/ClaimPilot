const manifestVersion = '0.1.0';

function clone(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

const toolDefinitions = [
  {
    name: 'mail.latestMessage.get',
    description: 'Liest deterministisch die neueste Nachricht aus einem Mailordner und liefert Metadaten.',
    inputSchema: {
      type: 'object',
      required: ['folderId'],
      properties: {
        folderId: { type: 'string', description: 'ID oder bekannter Name des Zielordners, z. B. inbox.' },
        select: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optionale Microsoft Graph $select Felder zur Optimierung.'
        },
        includeBodyPreview: {
          type: 'boolean',
          default: false,
          description: 'Steuert, ob die Body-Vorschau geladen werden soll.'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        subject: { type: 'string' },
        receivedDateTime: { type: 'string' },
        from: { type: 'string' },
        webLink: { type: 'string' }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.Read'],
      resource: 'https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}/messages'
    }
  },
  {
    name: 'mail.message.fetch',
    description: 'Liest eine Nachricht anhand ihrer ID inklusive Body und Debug-Headern.',
    inputSchema: {
      type: 'object',
      required: ['messageId'],
      properties: {
        messageId: { type: 'string', description: 'Graph-Nachrichten-ID für den Abruf.' },
        preferTextBody: {
          type: 'boolean',
          default: true,
          description: 'Verwendet Prefer: outlook.body-content-type="text" wenn true.'
        },
        expandAttachments: {
          type: 'boolean',
          default: false,
          description: 'Steuert, ob Anhänge sofort mitgeladen werden.'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        headers: { type: 'array', items: { type: 'object' } }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.Read'],
      resource: 'https://graph.microsoft.com/v1.0/me/messages/{messageId}'
    }
  },
  {
    name: 'mail.message.replyDraft',
    description: 'Erstellt einen Reply-Draft, patcht den Body deterministisch und sendet ihn mit SaveToSentItems Option.',
    inputSchema: {
      type: 'object',
      required: ['messageId', 'body'],
      properties: {
        messageId: { type: 'string', description: 'ID der Originalnachricht, die beantwortet wird.' },
        body: { type: 'string', description: 'Antworttext oder HTML-Body.' },
        contentType: {
          type: 'string',
          enum: ['Text', 'HTML'],
          default: 'Text',
          description: 'ContentType für den Patch-Schritt (Text empfohlen laut Troubleshooting-Doku).'
        },
        preferHeaders: {
          type: 'array',
          items: { type: 'string' },
          description: 'Zusätzliche Prefer-Header (z. B. return=representation).'
        },
        saveToSentItems: {
          type: 'boolean',
          default: true,
          description: 'Ob der Draft-Send in Gesendete Objekte gespeichert wird.'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['sent'] },
        draftId: { type: 'string' },
        etag: { type: 'string' }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.ReadWrite', 'Mail.Send'],
      resource: 'https://graph.microsoft.com/v1.0/me/messages/{messageId}/reply'
    }
  },
  {
    name: 'mail.message.send',
    description: 'Sendet eine neue Nachricht oder Quasi-Reply mit expliziten Internet-Headern und Anhängen.',
    inputSchema: {
      type: 'object',
      required: ['subject', 'body', 'to'],
      properties: {
        subject: { type: 'string', description: 'Betreff der Nachricht.' },
        body: { type: 'string', description: 'Body-Inhalt als Text oder HTML.' },
        to: {
          type: 'array',
          items: { type: 'string' },
          description: 'Liste der Empfänger (UPN oder SMTP).'
        },
        bodyContentType: {
          type: 'string',
          enum: ['Text', 'HTML'],
          default: 'Text'
        },
        internetHeaders: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Zusätzliche Internet-Header wie In-Reply-To für Threading.'
        },
        attachments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'path'],
            properties: {
              name: { type: 'string' },
              path: { type: 'string' }
            }
          }
        },
        saveToSentItems: { type: 'boolean', default: true }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['sent'] },
        internetMessageId: { type: 'string' }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.Send'],
      resource: 'https://graph.microsoft.com/v1.0/me/sendMail'
    }
  },
  {
    name: 'mail.attachment.download',
    description: 'Lädt einen bestimmten Anhang einer Nachricht und speichert ihn deterministisch im Zielpfad.',
    inputSchema: {
      type: 'object',
      required: ['messageId', 'attachmentId', 'targetPath'],
      properties: {
        messageId: { type: 'string' },
        attachmentId: { type: 'string' },
        targetPath: { type: 'string', description: 'Ablageort für den heruntergeladenen Anhang.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['saved'] },
        filePath: { type: 'string' }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.Read'],
      resource: 'https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments/{attachmentId}'
    }
  },
  {
    name: 'mail.attachment.uploadAndAttach',
    description: 'Lädt eine lokale Datei hoch und hängt sie an eine bestehende oder neue Nachricht an.',
    inputSchema: {
      type: 'object',
      required: ['messageId', 'filePath'],
      properties: {
        messageId: { type: 'string' },
        filePath: { type: 'string' },
        contentType: { type: 'string', description: 'Explorer MIME Type, falls bekannt.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['attached'] },
        attachmentId: { type: 'string' }
      }
    },
    metadata: {
      category: 'mail',
      deterministic: true,
      scopes: ['Mail.ReadWrite'],
      resource: 'https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments'
    }
  },
  {
    name: 'calendar.events.list',
    description: 'Listet Kalenderereignisse in einem Zeitraum mit deterministischer Filterung.',
    inputSchema: {
      type: 'object',
      required: ['startDateTime', 'endDateTime'],
      properties: {
        startDateTime: { type: 'string', description: 'IS0-8601 Startzeitpunkt.' },
        endDateTime: { type: 'string', description: 'IS0-8601 Endzeitpunkt.' },
        calendarId: { type: 'string', description: 'Optionaler Zielkalender, Standard ist primary.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        events: { type: 'array', items: { type: 'object' } }
      }
    },
    metadata: {
      category: 'calendar',
      deterministic: true,
      scopes: ['Calendars.Read'],
      resource: 'https://graph.microsoft.com/v1.0/me/calendarview'
    }
  },
  {
    name: 'calendar.event.createOrUpdate',
    description: 'Erstellt oder aktualisiert ein Ereignis mit klaren Start-/Endzeiten und Teilnehmern.',
    inputSchema: {
      type: 'object',
      required: ['subject', 'start', 'end'],
      properties: {
        eventId: { type: 'string', description: 'Optional vorhandene Event-ID für Update.' },
        subject: { type: 'string' },
        body: { type: 'string' },
        start: { type: 'string' },
        end: { type: 'string' },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'Liste der Teilnehmer-Adressen.'
        },
        location: { type: 'string' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['created', 'updated'] },
        eventId: { type: 'string' }
      }
    },
    metadata: {
      category: 'calendar',
      deterministic: true,
      scopes: ['Calendars.ReadWrite'],
      resource: 'https://graph.microsoft.com/v1.0/me/events'
    }
  },
  {
    name: 'calendar.event.cancel',
    description: 'Sagt ein Ereignis deterministisch mit optionaler Begründung ab.',
    inputSchema: {
      type: 'object',
      required: ['eventId', 'comment'],
      properties: {
        eventId: { type: 'string' },
        comment: { type: 'string', description: 'Optionale Nachricht an Teilnehmer.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['cancelled'] },
        eventId: { type: 'string' }
      }
    },
    metadata: {
      category: 'calendar',
      deterministic: true,
      scopes: ['Calendars.ReadWrite'],
      resource: 'https://graph.microsoft.com/v1.0/me/events/{eventId}/cancel'
    }
  },
  {
    name: 'drive.file.upload',
    description: 'Lädt eine lokale Datei nach OneDrive hoch und gibt den DriveItem-Bezug zurück.',
    inputSchema: {
      type: 'object',
      required: ['sourcePath', 'drivePath'],
      properties: {
        sourcePath: { type: 'string' },
        drivePath: { type: 'string', description: 'Zielpfad in der Dokumentbibliothek.' },
        conflictBehavior: {
          type: 'string',
          enum: ['replace', 'fail', 'rename'],
          default: 'replace'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['uploaded'] },
        driveItemId: { type: 'string' }
      }
    },
    metadata: {
      category: 'drive',
      deterministic: true,
      scopes: ['Files.ReadWrite.All'],
      resource: 'https://graph.microsoft.com/v1.0/me/drive/root:{drivePath}:/content'
    }
  },
  {
    name: 'excel.workbook.listSheets',
    description: 'Listet Arbeitsblattnamen in einem Workbook über die Graph Excel API.',
    inputSchema: {
      type: 'object',
      required: ['driveItemId'],
      properties: {
        driveItemId: { type: 'string' },
        workbookSession: { type: 'string', description: 'Optional: Graph Workbook Session ID für deterministische Zugriffe.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        sheets: { type: 'array', items: { type: 'string' } }
      }
    },
    metadata: {
      category: 'excel',
      deterministic: true,
      scopes: ['Files.ReadWrite.All'],
      resource: 'https://graph.microsoft.com/v1.0/me/drive/items/{driveItemId}/workbook/worksheets'
    }
  },
  {
    name: 'excel.workbook.readRange',
    description: 'Liest deterministisch Werte aus einem Workbook-Bereich, optional über usedRange.',
    inputSchema: {
      type: 'object',
      required: ['driveItemId'],
      properties: {
        driveItemId: { type: 'string' },
        workbookSession: { type: 'string', description: 'Optional: Workbook Session für konsistente Ergebnisse.' },
        sheetName: { type: 'string', description: 'Name des Arbeitsblatts.' },
        range: { type: 'string', description: 'Optionaler Bereich, z. B. A1:D20.' },
        valuesOnly: { type: 'boolean', default: true, description: 'Gibt nur Werte zurück (wie usedRange(valuesOnly=true)).' },
        preferValues: { type: 'boolean', default: false, description: 'Setzt Prefer-Header für ValueOnly.' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        values: { type: 'array', items: { type: 'array', items: { type: ['string', 'number', 'null'] } } },
        address: { type: 'string' }
      }
    },
    metadata: {
      category: 'excel',
      deterministic: true,
      scopes: ['Files.ReadWrite.All'],
      resource: 'https://graph.microsoft.com/v1.0/me/drive/items/{driveItemId}/workbook/worksheets/{sheetName}'
    }
  },
  {
    name: 'excel.workbook.updateRange',
    description: 'Schreibt Werte in einen definierten Workbook-Bereich mit optionalem Wertevergleich.',
    inputSchema: {
      type: 'object',
      required: ['driveItemId', 'sheetName', 'range', 'values'],
      properties: {
        driveItemId: { type: 'string' },
        workbookSession: { type: 'string', description: 'Optional: Workbook Session für konsistente Ergebnisse.' },
        sheetName: { type: 'string' },
        range: { type: 'string' },
        values: {
          type: 'array',
          items: { type: 'array', items: { type: ['string', 'number', 'null'] } }
        },
        matchExpected: {
          type: 'array',
          items: { type: 'array', items: { type: ['string', 'number', 'null'] } },
          description: 'Optionaler Sollwert zum Patchen bei Optimistic Concurrency.'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['updated'] },
        modifiedRange: { type: 'string' }
      }
    },
    metadata: {
      category: 'excel',
      deterministic: true,
      scopes: ['Files.ReadWrite.All'],
      resource: 'https://graph.microsoft.com/v1.0/me/drive/items/{driveItemId}/workbook/worksheets/{sheetName}/range(address={range})'
    }
  },
  {
    name: 'graph.health.check',
    description: 'Prüft Token-Gültigkeit, Tenant und grundlegende Konnektivität zur Graph API.',
    inputSchema: {
      type: 'object',
      required: [],
      properties: {
        pingEndpoint: { type: 'string', default: 'https://graph.microsoft.com/v1.0/me' }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'degraded'] },
        latencyMs: { type: 'number' }
      }
    },
    metadata: {
      category: 'graph',
      deterministic: true,
      scopes: ['User.Read'],
      resource: 'https://graph.microsoft.com/v1.0'
    }
  },
  {
    name: 'graph.token.acquire',
    description: 'Erzwingt den Erwerb eines Access Tokens und liefert Ablaufinformationen.',
    inputSchema: {
      type: 'object',
      required: ['scopeSet'],
      properties: {
        scopeSet: {
          type: 'array',
          items: { type: 'string' },
          description: 'Scopes, die für den Token erforderlich sind.'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['acquired'] },
        expiresOn: { type: 'string' }
      }
    },
    metadata: {
      category: 'graph',
      deterministic: true,
      scopes: [],
      resource: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token'
    }
  },
  {
    name: 'tooling.feature.toggle',
    description: 'Aktiviert oder deaktiviert deterministisch eine Funktion (z. B. MCP vs CLI Fallback).',
    inputSchema: {
      type: 'object',
      required: ['feature', 'enabled'],
      properties: {
        feature: { type: 'string' },
        enabled: { type: 'boolean' },
        context: { type: 'object', additionalProperties: true }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['updated'] },
        feature: { type: 'string' }
      }
    },
    metadata: {
      category: 'tooling',
      deterministic: true,
      scopes: [],
      resource: 'internal-policy://feature-toggle'
    }
  }
];

function createM365ToolManifest() {
  return {
    namespace: 'm365',
    version: manifestVersion,
    tools: toolDefinitions.map((tool) => clone(tool))
  };
}

module.exports = { createM365ToolManifest };
