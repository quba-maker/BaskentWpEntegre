import axios from 'axios';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY || 'AIzaSyAxNUHQCrXzmATX4YuMgcFP3u4EW_jsJYc';
  const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ';
  const BASE_URL = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}`;

  try {
    const { action, sheet } = req.query;

    // Sekmeleri (sheet tab isimlerini) getir - gizli sekmeleri filtrele
    if (action === 'tabs') {
      const resp = await axios.get(BASE_URL, {
        params: { key: SHEETS_API_KEY, fields: 'sheets.properties' }
      });
      const tabs = resp.data.sheets
        .filter(s => !s.properties.hidden)
        .map(s => ({
          id: s.properties.sheetId,
          title: s.properties.title,
          index: s.properties.index
        }));
      return res.json({ success: true, tabs });
    }

    // Hücre güncelle (POST)
    if (action === 'update' && req.method === 'POST') {
      const { sheetName, row, col, value } = req.body;
      // Google Apps Script üzerinden güncelle
      const APPS_SCRIPT_URL = process.env.GOOGLE_SHEET_UPDATE_URL || process.env.GOOGLE_SHEET_URL || 'https://script.google.com/macros/s/AKfycbw_iaJ0zqgOFYAGlkCnGnKQOzYQtPJWtbLMIEMIPuVbVkXOnDyq_1jMmII554s85sxu/exec';
      
      try {
        await axios.post(APPS_SCRIPT_URL, {
          action: 'updateCell',
          sheet: sheetName,
          row: row + 2, // +2 çünkü: 1-indexed + header satırı
          col: col + 1, // 1-indexed
          value: value
        }, { timeout: 10000 });
        
        return res.json({ success: true, message: 'Hücre güncellendi' });
      } catch (e) {
        console.error('Sheets güncelleme hatası:', e.message);
        return res.json({ success: false, error: e.message });
      }
    }

    // Belirli bir sekmenin verilerini getir
    if (action === 'data') {
      const sheetName = sheet || 'Sheet1';
      const resp = await axios.get(`${BASE_URL}/values/${encodeURIComponent(sheetName)}`, {
        params: { key: SHEETS_API_KEY, valueRenderOption: 'FORMATTED_VALUE' }
      });

      const values = resp.data.values || [];
      if (values.length === 0) {
        return res.json({ success: true, headers: [], rows: [], total: 0 });
      }

      const headers = values[0];
      const rows = values.slice(1);

      return res.json({
        success: true,
        headers,
        rows,
        total: rows.length,
        sheetName
      });
    }

    // TÜM sekmeleri tek seferde çek (Load Once, Filter Locally)
    if (action === 'all') {
      const metaResp = await axios.get(BASE_URL, {
        params: { key: SHEETS_API_KEY, fields: 'sheets.properties' }
      });
      const tabs = metaResp.data.sheets
        .filter(s => !s.properties.hidden)
        .map(s => ({ id: s.properties.sheetId, title: s.properties.title, index: s.properties.index }));

      // Google Sheets batchGet — tüm sekmeleri tek HTTP çağrısında çek
      const ranges = tabs.map(t => encodeURIComponent(t.title)).join('&ranges=');
      const batchResp = await axios.get(`${BASE_URL}/values:batchGet`, {
        params: { key: SHEETS_API_KEY, ranges: tabs.map(t => t.title), valueRenderOption: 'FORMATTED_VALUE' }
      });

      const allData = {};
      (batchResp.data.valueRanges || []).forEach((vr, i) => {
        const tabName = tabs[i]?.title;
        const values = vr.values || [];
        allData[tabName] = {
          headers: values[0] || [],
          rows: values.slice(1),
          total: Math.max(values.length - 1, 0)
        };
      });

      return res.json({ success: true, tabs, allData });
    }

    // Default: tüm sekmeleri ve ilk sekmenin verilerini getir (gizliler hariç)
    const metaResp = await axios.get(BASE_URL, {
      params: { key: SHEETS_API_KEY, fields: 'sheets.properties' }
    });
    const tabs = metaResp.data.sheets
      .filter(s => !s.properties.hidden)
      .map(s => ({
        id: s.properties.sheetId,
        title: s.properties.title,
        index: s.properties.index
      }));

    const firstSheet = tabs[0]?.title || 'Sheet1';
    const dataResp = await axios.get(`${BASE_URL}/values/${encodeURIComponent(firstSheet)}`, {
      params: { key: SHEETS_API_KEY, valueRenderOption: 'FORMATTED_VALUE' }
    });

    const values = dataResp.data.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1);

    return res.json({
      success: true,
      tabs,
      headers,
      rows,
      total: rows.length,
      activeSheet: firstSheet
    });

  } catch (error) {
    console.error('Google Sheets API hatası:', error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.error?.message || error.message
    });
  }
}
