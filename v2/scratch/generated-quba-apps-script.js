// Google Sheets Webhook & Auto-Sync Entegrasyonu
const WEBHOOK_URL = "https://quba.baskent.com/api/sheets-webhook";
const TENANT_SLUG = "baskent";
const WEBHOOK_SECRET = "wh_sec_testsecret123456";
const FORM_SHEET_NAME = "Form Yanıtları 1";

// ═══════════════════════════════════════════════════════
// AUTOMATIC TRIGGER SETUP (RUN THIS ONCE)
// ═══════════════════════════════════════════════════════

// Bu fonksiyonu editörde seçip "Çalıştır" (Run) butonuna basmanız yeterlidir.
function setupQubaTriggers() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Temizlik yap
  removeQubaTriggers();
  
  // 2. onFormSubmit tetikleyicisi (Form Gönderildiğinde çalışır - anlık)
  ScriptApp.newTrigger("onFormSubmit")
    .forSpreadsheet(ss)
    .onFormSubmit()
    .create();
    
  // 3. catchUpSync tetikleyicisi (Periyodik kontrol - 15 dakikada bir)
  ScriptApp.newTrigger("catchUpSync")
    .timeBased()
    .everyMinutes(15)
    .create();
    
  Logger.log("✓ Quba tetikleyicileri kuruldu:");
  Logger.log("- onFormSubmit (Anlık Form Gönderimi)");
  Logger.log("- catchUpSync (Zamanlayıcı: 15 dakikada bir)");
  
  // 4. Bağlantı Testini Çalıştır
  testQubaConnection();
}

// Quba tetikleyicilerini temizleme
function removeQubaTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fnName = triggers[i].getHandlerFunction();
    if (fnName === "onFormSubmit" || fnName === "catchUpSync") {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  Logger.log("✓ Eski Quba tetikleyicileri temizlendi (Sayı: " + count + ").");
}

// ═══════════════════════════════════════════════════════
// WEBHOOK & CRON HANDLERS
// ═══════════════════════════════════════════════════════

// Anlık form gönderimlerini yakalar
function onFormSubmit(e) {
  try {
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    
    // Sadece seçili sekmeyi işle
    if (sheetName !== FORM_SHEET_NAME) {
      Logger.log("Farklı sekme (" + sheetName + "), işlem atlandı.");
      return;
    }
    
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
      tenant_slug: TENANT_SLUG
    };
    
    sendToQuba('/sheets-webhook', payload, false);
  } catch (err) {
    Logger.log("onFormSubmit Hatası: " + err.toString());
  }
}

// 15 dakikada bir yedek tarama tetikler
function catchUpSync() {
  try {
    var payload = {
      trigger: 'time_driven_catchup',
      tenant_slug: TENANT_SLUG,
      timestamp: new Date().toISOString()
    };
    sendToQuba('/cron-form-sync', payload, false);
  } catch (err) {
    Logger.log("catchUpSync Hatası: " + err.toString());
  }
}

// Bağlantı Doğrulama Testi (Dry-Run)
function testQubaConnection() {
  Logger.log("Quba bağlantısı test ediliyor...");
  var payload = {
    trigger: 'health_ping',
    tenant_slug: TENANT_SLUG,
    timestamp: new Date().toISOString()
  };
  sendToQuba('/cron-form-sync', payload, true);
}

// ═══════════════════════════════════════════════════════
// HTTP & SECURITY HELPERS
// ═══════════════════════════════════════════════════════

function buildQubaUrl(endpoint, params) {
  var baseUrl = WEBHOOK_URL.split('?')[0];

  if (baseUrl.charAt(baseUrl.length - 1) === '/') {
    baseUrl = baseUrl.substring(0, baseUrl.length - 1);
  }

  if (baseUrl.indexOf('/sheets-webhook') !== -1) {
    baseUrl = baseUrl.replace('/sheets-webhook', endpoint);
  } else {
    baseUrl = baseUrl + endpoint;
  }

  var queryParts = [];
  for (var key in params) {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
  }

  return baseUrl + '?' + queryParts.join('&');
}

function sendToQuba(endpoint, payload, isDryRun) {
  var params = { tenant: TENANT_SLUG };
  if (isDryRun) {
    params.dryRun = 'true';
  }
  var targetUrl = buildQubaUrl(endpoint, params);

  var bodyStr = JSON.stringify(payload);
  var timestamp = Math.floor(Date.now() / 1000).toString();
  
  // HMAC SHA256 İmzası Üret
  var signatureData = timestamp + '.' + bodyStr;
  var signature = 'sha256=' + computeHmacSha256(WEBHOOK_SECRET, signatureData);

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-sheets-signature': signature,
      'x-sheets-timestamp': timestamp
    },
    payload: bodyStr,
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(targetUrl, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    
    if (code >= 200 && code < 300) {
      if (isDryRun) {
        Logger.log("✓ Quba bağlantı testi başarılı! Sunucu yanıtı: " + text);
      } else {
        Logger.log("✓ İstek başarıyla gönderildi (HTTP " + code + ")");
      }
    } else {
      Logger.log("❌ İstek başarısız oldu (HTTP " + code + "): " + text);
    }
  } catch (err) {
    Logger.log("❌ Gönderim hatası: " + err.toString());
  }
}

function computeHmacSha256(secret, data) {
  var signatureBytes = Utilities.computeHmacSignature(
    Utilities.MacAlgorithm.HMAC_SHA_256,
    data,
    secret
  );
  
  var signature = '';
  for (var i = 0; i < signatureBytes.length; i++) {
    var byteVal = signatureBytes[i];
    if (byteVal < 0) byteVal += 256;
    var byteString = byteVal.toString(16);
    if (byteString.length === 1) byteString = '0' + byteString;
    signature += byteString;
  }
  return signature;
}