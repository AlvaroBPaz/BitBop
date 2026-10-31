// ============================================================================
// WEBHOOK INTEGRADO: GOOGLE AGENDA + GOOGLE KEEP (GOOGLE APPS SCRIPT)
// ============================================================================
// 1. Acesse https://script.google.com, abra o seu projeto existente (ou crie um novo) e cole este código.
// 2. Clique em "Implantar" > "Gerenciar implantações" > ícone de Lápis (Editar) > Versão: "Nova versão" > "Implantar".
// 3. Este script atende:
//    - Criar compromissos no Google Agenda
//    - CONSULTAR / LER compromissos agendados no Google Agenda
//    - Criar, ler e atualizar notas e listas do Google Keep
// ============================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return buildJsonOutput({ ok: false, error: 'Payload JSON ausente na requisição POST.' });
    }

    var data = JSON.parse(e.postData.contents);
    var action = String(data.action || '').toLowerCase();

    // -------------------------------------------------------------
    // ROTA 1: GOOGLE KEEP - CRIAR NOTA OU LISTA
    // -------------------------------------------------------------
    if (action === 'create_note' || action === 'criar_nota') {
      var sheet = getOrCreateKeepSheet();
      var title = String(data.title || 'Sem Título').trim();
      var content = String(data.content || '').trim();
      var isList = Boolean(data.is_list);
      var noteId = String(data.id || ('keep_' + new Date().getTime()));
      var nowIso = new Date().toISOString();

      sheet.appendRow([noteId, nowIso, title, content, isList ? 'LISTA' : 'TEXTO', nowIso]);

      return buildJsonOutput({
        ok: true,
        action: 'create_note',
        id: noteId,
        title: title,
        speech_response: data.speech_response || ('Anotei no seu Keep: ' + title)
      });
    }

    // -------------------------------------------------------------
    // ROTA 2: GOOGLE KEEP - ADICIONAR CONTEÚDO EM NOTA EXISTENTE
    // -------------------------------------------------------------
    if (action === 'append_note' || action === 'adicionar_nota') {
      var sheet = getOrCreateKeepSheet();
      var query = String(data.search_query || data.title || '').toLowerCase().trim();
      var newContent = String(data.new_content || '').trim();
      var rows = sheet.getDataRange().getValues();
      var foundRow = -1;

      for (var i = rows.length - 1; i >= 1; i--) {
        var rowTitle = String(rows[i][2] || '').toLowerCase();
        var rowContent = String(rows[i][3] || '').toLowerCase();
        if (rowTitle.indexOf(query) !== -1 || rowContent.indexOf(query) !== -1) {
          foundRow = i + 1;
          break;
        }
      }

      var nowIso = new Date().toISOString();
      if (foundRow > 0) {
        var currentContent = sheet.getRange(foundRow, 4).getValue();
        var isList = String(sheet.getRange(foundRow, 5).getValue()).toUpperCase() === 'LISTA';
        var separator = isList ? '\n' : '\n\n';
        var updatedContent = (currentContent ? currentContent + separator : '') + newContent;
        sheet.getRange(foundRow, 4).setValue(updatedContent);
        sheet.getRange(foundRow, 6).setValue(nowIso);

        var titleUpdated = sheet.getRange(foundRow, 3).getValue();
        return buildJsonOutput({
          ok: true,
          action: 'append_note',
          title: titleUpdated,
          content: updatedContent,
          speech_response: data.speech_response || ('Adicionei na sua nota ' + titleUpdated)
        });
      } else {
        var newId = 'keep_' + new Date().getTime();
        sheet.appendRow([newId, nowIso, data.search_query || 'Anotações', newContent, 'TEXTO', nowIso]);
        return buildJsonOutput({
          ok: true,
          action: 'create_note',
          id: newId,
          title: data.search_query || 'Anotações',
          speech_response: data.speech_response || ('Criei uma nota no Keep chamada ' + (data.search_query || 'Anotações'))
        });
      }
    }

    // -------------------------------------------------------------
    // ROTA 3: GOOGLE KEEP - LER NOTAS SALVAS
    // -------------------------------------------------------------
    if (action === 'read_notes' || action === 'ler_notas' || action === 'get_notes') {
      var sheet = getOrCreateKeepSheet();
      var rows = sheet.getDataRange().getValues();
      var query = String(data.search_query || '').toLowerCase().trim();
      var limit = Number(data.limit) || 5;
      var notes = [];

      for (var i = rows.length - 1; i >= 1; i--) {
        var id = rows[i][0];
        var title = rows[i][2];
        var content = rows[i][3];
        var type = rows[i][4];
        var updated = rows[i][5];

        if (!query || String(title).toLowerCase().indexOf(query) !== -1 || String(content).toLowerCase().indexOf(query) !== -1) {
          notes.push({
            id: id,
            title: title,
            content: content,
            is_list: type === 'LISTA',
            updated_at: updated
          });
          if (notes.length >= limit) break;
        }
      }

      return buildJsonOutput({
        ok: true,
        action: 'read_notes',
        count: notes.length,
        notes: notes
      });
    }

    // -------------------------------------------------------------
    // ROTA 4: GOOGLE AGENDA - CONSULTAR / LER COMPROMISSOS AGENDADOS
    // -------------------------------------------------------------
    if (action === 'read_calendar' || action === 'consultar_agenda' || action === 'get_calendar_events') {
      var calendar = CalendarApp.getDefaultCalendar();
      var now = new Date();
      var timeMin = data.time_min ? new Date(data.time_min) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      var timeMax = data.time_max ? new Date(data.time_max) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      if (isNaN(timeMin.getTime())) timeMin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      if (isNaN(timeMax.getTime()) || timeMax <= timeMin) timeMax = new Date(timeMin.getTime() + 24 * 60 * 60 * 1000);

      var rawEvents = calendar.getEvents(timeMin, timeMax);
      var eventsList = [];

      for (var k = 0; k < rawEvents.length; k++) {
        var ev = rawEvents[k];
        var sDate = ev.getStartTime();
        var eDate = ev.getEndTime();
        var pad = function(n) { return (n < 10 ? '0' : '') + n; };
        var startFormatted = pad(sDate.getHours()) + ':' + pad(sDate.getMinutes());
        var endFormatted = pad(eDate.getHours()) + ':' + pad(eDate.getMinutes());
        var timeLabel = ev.isAllDayEvent() ? 'Dia inteiro' : (startFormatted + ' às ' + endFormatted);

        eventsList.push({
          id: ev.getId(),
          title: ev.getTitle(),
          start_time: sDate.toISOString(),
          end_time: eDate.toISOString(),
          time_label: timeLabel,
          description: ev.getDescription() || '',
          is_all_day: ev.isAllDayEvent()
        });
      }

      return buildJsonOutput({
        ok: true,
        action: 'read_calendar',
        count: eventsList.length,
        time_min: timeMin.toISOString(),
        time_max: timeMax.toISOString(),
        query_date_label: data.query_date_label || '',
        events: eventsList
      });
    }

    // -------------------------------------------------------------
    // ROTA 5: GOOGLE AGENDA - CRIAR NOVO COMPROMISSO
    // -------------------------------------------------------------
    var title = String(data.title || 'Compromisso BitBop').trim();
    var startTime = new Date(data.start_time);

    if (isNaN(startTime.getTime())) {
      return buildJsonOutput({ ok: false, error: 'Data de início inválida: ' + data.start_time });
    }

    var endTime = data.end_time ? new Date(data.end_time) : new Date(startTime.getTime() + 60 * 60 * 1000);
    if (isNaN(endTime.getTime()) || endTime <= startTime) {
      endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
    }

    var description = data.description ? String(data.description).trim() : '';
    var calendar = CalendarApp.getDefaultCalendar();

    var event = calendar.createEvent(title, startTime, endTime, {
      description: description
    });

    return buildJsonOutput({
      ok: true,
      action: 'calendar',
      eventId: event.getId(),
      title: title,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      speech_response: data.speech_response || ('Agendado: ' + title)
    });
  } catch (err) {
    return buildJsonOutput({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet(e) {
  var sheet = getOrCreateKeepSheet();
  var rows = sheet.getDataRange().getValues();
  return buildJsonOutput({
    ok: true,
    service: 'BitBop Google Keep & Agenda Webhook',
    total_notes: Math.max(0, rows.length - 1)
  });
}

function getOrCreateKeepSheet() {
  var fileName = 'Stack-chan Google Keep Notes';
  var files = DriveApp.getFilesByName(fileName);
  var spreadsheet;

  if (files.hasNext()) {
    spreadsheet = SpreadsheetApp.open(files.next());
  } else {
    spreadsheet = SpreadsheetApp.create(fileName);
    var initSheet = spreadsheet.getActiveSheet();
    initSheet.setName('Notas');
    initSheet.appendRow(['ID', 'Criado_Em', 'Titulo', 'Conteudo', 'Tipo', 'Atualizado_Em']);
    initSheet.getRange('A1:F1').setFontWeight('bold').setBackground('#f1f5f9');
  }

  return spreadsheet.getSheetByName('Notas') || spreadsheet.getActiveSheet();
}

function buildJsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
