/* BOT EĞİTİMİ */
async function loadPrompt() {
  const s = await api('settings'); 
  if(s) {
    document.getElementById('prompt-editor-wp').value = s.system_prompt_whatsapp || s.system_prompt || '';
    document.getElementById('prompt-editor-tr').value = s.system_prompt_tr || s.system_prompt || '';
    document.getElementById('prompt-editor-en').value = s.system_prompt_foreign || '';
    document.getElementById('foreign-page-id').value = s.foreign_page_id || '';
  }
}
async function savePrompt() {
  await api('settings','POST',{key:'system_prompt_whatsapp', value:document.getElementById('prompt-editor-wp').value});
  await api('settings','POST',{key:'system_prompt_tr', value:document.getElementById('prompt-editor-tr').value});
  await api('settings','POST',{key:'system_prompt_foreign', value:document.getElementById('prompt-editor-en').value});
  await api('settings','POST',{key:'foreign_page_id', value:document.getElementById('foreign-page-id').value});
  toast('Sistem Promptları güncellendi!');
}
async function resetPrompt() {
  if(!confirm('Orijinal (Başkent Hastanesi) ayarlara dönülecek. Emin misiniz?')) return;
  const d = await api('default-prompt');
  if(d) { 
    document.getElementById('prompt-editor-wp').value = d.wp || ''; 
    document.getElementById('prompt-editor-tr').value = d.tr || ''; 
    document.getElementById('prompt-editor-en').value = d.en || ''; 
    toast('Varsayılan metinler yüklendi! Kalıcı olması için KAYDET butonuna basın.');
  }
}

