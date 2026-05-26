/**
 * ═══════════════════════════════════════════════════════
 * QUBA AI — Google Sheets → Webhook Bridge v2
 * ═══════════════════════════════════════════════════════
 * 
 * DEPLOYMENT:
 *   1. Google Sheets → Extensions → Apps Script
 *   2. Bu kodu yapıştır
 *   3. CONFIG değerlerini doldur (WEBHOOK_URL, TENANT_SLUG, WEBHOOK_SECRET)
 *   4. Triggers → Add Trigger:
 *      - onFormSubmit → From spreadsheet → On form submit
 *   5. (Opsiyonel — P0.5) catchUpSync → Time-driven → Every 15 minutes
 * 
 * HMAC SECURITY:
 *   - Her istek X-Sheets-Signature (sha256 HMAC) + X-Sheets-Timestamp ile imzalanır
 *   - Server ±300 saniye replay window uygular
 *   - Secret: Vercel env'deki SHEETS_WEBHOOK_SECRET ile aynı olmalı
 * 
 * ERROR LOGGING:
 *   - Hatalar '_webhook_errors' sheet'ine yazılır
 *   - Auth hataları (401/403) retry edilmez
 */

var CONFIG = {
  WEBHOOK_URL: 'https://YOUR_DOMAIN/api/sheets-webhook',
  TENANT_SLUG: 'baskent',
  WEBHOOK_SECRET: 'YOUR_SECRET_HERE',
  MAX_RETRIES: 3,
  RETRY_DELAYS: [1000, 3000, 9000]
};

// ═══════════════════════════════════════════════════════
// TRIGGER: New form submission (real-time)
// ═══════════════════════════════════════════════════════

function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var rowNumber = e.range.getRow();
    var lastCol = sheet.getLastColumn();
    
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function(h) { return String(h).trim(); });
    var values = sheet.getRange(rowNumber, 1, 1, lastCol).getValues()[0]
      .map(function(v) { return String(v || ''); });
    
    var payload = {
      event_type: 'form_submit',
      sheet_name: sheetName,
      row_number: rowNumber,
      headers: headers,
      values: values,
      timestamp: new Date().toISOString(),
      tenant_slug: CONFIG.TENANT_SLUG
    };
    
    sendWithRetry(payload, CONFIG.WEBHOOK_URL);
  } catch (err) {
    logError('onFormSubmit', err);
  }
}

// ═══════════════════════════════════════════════════════
// CATCH-UP: Time-driven trigger (P0.5)
// Deploy: Triggers → catchUpSync → Time-driven → Every 15/30 min
// Uses POST (not GET) for proper HMAC body signing
// ═══════════════════════════════════════════════════════

function catchUpSync() {
  try {
    var payload = {
      trigger: 'time_driven_catchup',
      tenant_slug: CONFIG.TENANT_SLUG,
      timestamp: new Date().toISOString()
    };
    
    var bodyStr = JSON.stringify(payload);
    var timestamp = Math.floor(Date.now() / 1000).toString();
    var signatureData = timestamp + '.' + bodyStr;
    var signature = 'sha256=' + computeHmacSha256(CONFIG.WEBHOOK_SECRET, signatureData);
    
    var catchUpUrl = CONFIG.WEBHOOK_URL.replace('/sheets-webhook', '/cron-form-sync')
      + '?tenant=' + CONFIG.TENANT_SLUG;
    
    var response = UrlFetchApp.fetch(catchUpUrl, {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'X-Sheets-Signature': signature,
        'X-Sheets-Timestamp': timestamp,
        'X-Trigger-Source': 'apps_script_time_driven'
      },
      payload: bodyStr,
      muteHttpExceptions: true
    });
    
    var code = response.getResponseCode();
    Logger.log('[CATCHUP] ' + code + ': ' + response.getContentText().substring(0, 200));
    
    if (code >= 400) {
      logError('catchUpSync', 'HTTP ' + code + ': ' + response.getContentText().substring(0, 200));
    }
  } catch (err) {
    logError('catchUpSync', err);
  }
}

// ═══════════════════════════════════════════════════════
// HMAC + Retry Sender
// ═══════════════════════════════════════════════════════

function sendWithRetry(payload, url) {
  var bodyStr = JSON.stringify(payload);
  var timestamp = Math.floor(Date.now() / 1000).toString();
  
  var signatureData = timestamp + '.' + bodyStr;
  var signature = 'sha256=' + computeHmacSha256(CONFIG.WEBHOOK_SECRET, signatureData);
  
  var targetUrl = url + '?tenant=' + CONFIG.TENANT_SLUG;
  
  for (var attempt = 0; attempt < CONFIG.MAX_RETRIES; attempt++) {
    try {
      var response = UrlFetchApp.fetch(targetUrl, {
        method: 'POST',
        contentType: 'application/json',
        headers: {
          'X-Sheets-Signature': signature,
          'X-Sheets-Timestamp': timestamp
        },
        payload: bodyStr,
        muteHttpExceptions: true
      });
      
      var code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        Logger.log('[OK] Row ' + (payload.row_number || '?') + ' → ' + code);
        return;
      }
      
      // Don't retry auth failures
      if (code === 401 || code === 403) {
        logError('sendWithRetry', 'Auth failed: ' + code + ' ' + response.getContentText().substring(0, 200));
        return;
      }
      
      Logger.log('[RETRY] Attempt ' + (attempt + 1) + ' → ' + code);
    } catch (err) {
      Logger.log('[ERROR] Attempt ' + (attempt + 1) + ': ' + err.message);
    }
    
    if (attempt < CONFIG.MAX_RETRIES - 1) {
      Utilities.sleep(CONFIG.RETRY_DELAYS[attempt]);
    }
  }
  
  logError('sendWithRetry', 'All ' + CONFIG.MAX_RETRIES + ' retries exhausted for row ' + (payload.row_number || '?'));
}

// ═══════════════════════════════════════════════════════
// HMAC-SHA256 Helper
// ═══════════════════════════════════════════════════════

function computeHmacSha256(secret, data) {
  var raw = Utilities.computeHmacSha256Signature(data, secret);
  return raw.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

// ═══════════════════════════════════════════════════════
// Error Logger — writes to '_webhook_errors' sheet
// ═══════════════════════════════════════════════════════

function logError(fn, err) {
  Logger.log('[ERROR][' + fn + '] ' + (err.message || err));
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var errorSheet = ss.getSheetByName('_webhook_errors');
    if (!errorSheet) {
      errorSheet = ss.insertSheet('_webhook_errors');
      errorSheet.appendRow(['Timestamp', 'Function', 'Error']);
      errorSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
    }
    errorSheet.appendRow([new Date().toISOString(), fn, String(err.message || err)]);
    
    // Keep only last 100 errors to avoid bloat
    var lastRow = errorSheet.getLastRow();
    if (lastRow > 101) {
      errorSheet.deleteRows(2, lastRow - 101);
    }
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════
// TEST FUNCTION — Run manually from Apps Script editor
// ═══════════════════════════════════════════════════════

function testWebhook() {
  var payload = {
    event_type: 'test',
    sheet_name: 'TEST',
    headers: ['full_name', 'phone_number', 'email'],
    values: ['Debug Test ' + Date.now(), '+90 544 999 8877', 'debug@test.com'],
    timestamp: new Date().toISOString(),
    tenant_slug: CONFIG.TENANT_SLUG
  };
  
  var bodyStr = JSON.stringify(payload);
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var signatureData = timestamp + '.' + bodyStr;
  var signature = 'sha256=' + computeHmacSha256(CONFIG.WEBHOOK_SECRET, signatureData);
  var targetUrl = CONFIG.WEBHOOK_URL + '?tenant=' + CONFIG.TENANT_SLUG;
  
  var response = UrlFetchApp.fetch(targetUrl, {
    method: 'POST',
    contentType: 'application/json',
    headers: {
      'X-Sheets-Signature': signature,
      'X-Sheets-Timestamp': timestamp
    },
    payload: bodyStr,
    muteHttpExceptions: true
  });
  
  Logger.log('[TEST] HTTP ' + response.getResponseCode());
  Logger.log('[TEST] Body: ' + response.getContentText());
}
