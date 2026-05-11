/* DOSYA YÜKLEME */
let pendingFile = null;
async function handleFileUpload(e) {
  const file = e.target.files[0];
  if (!file || !currentPhone) return;
  
  const maxSize = 16 * 1024 * 1024; // 16MB
  if (file.size > maxSize) { toast('Dosya 16MB\'dan büyük olamaz', 'error'); return; }
  
  const preview = document.getElementById('upload-preview');
  const isImage = file.type.startsWith('image/');
  
  if (isImage) {
    const url = URL.createObjectURL(file);
    preview.innerHTML = `<div class="preview-card"><img src="${url}" style="max-height:80px;border-radius:6px;"><div><strong>${file.name}</strong><div style="font-size:11px;color:var(--text-muted)">${(file.size/1024).toFixed(0)} KB</div></div><button class="btn btn-sm btn-danger" onclick="cancelUpload()">✕</button></div>`;
  } else {
    preview.innerHTML = `<div class="preview-card"><span style="font-size:24px">📄</span><div><strong>${file.name}</strong><div style="font-size:11px;color:var(--text-muted)">${(file.size/1024).toFixed(0)} KB</div></div><button class="btn btn-sm btn-danger" onclick="cancelUpload()">✕</button></div>`;
  }
  preview.style.display = 'block';
  pendingFile = file;
}

function cancelUpload() {
  pendingFile = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('file-upload').value = '';
}

async function sendFileMessage() {
  if (!pendingFile || !currentPhone) return;
  
  toast('Dosya hazırlanıyor...');
  
  // Dosyayı base64'e çevir
  const reader = new FileReader();
  reader.onload = async function() {
    try {
      toast('Dosya gönderiliyor...');
      const r = await fetch('/api/upload-media', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + AUTH_TOKEN 
        },
        body: JSON.stringify({
          phone: currentPhone,
          channel: currentChannel,
          caption: document.getElementById('chat-input').value || '',
          fileName: pendingFile.name,
          fileType: pendingFile.type,
          fileBase64: reader.result
        })
      });
      const data = await r.json();
      if (data.success) { toast('Dosya gönderildi ✅'); loadChat(currentPhone, currentChannel); }
      else toast('Dosya gönderilemedi: ' + (data.error||''), 'error');
    } catch(e) { toast('Dosya hatası: ' + e.message, 'error'); }
    cancelUpload();
    document.getElementById('chat-input').value = '';
  };
  reader.readAsDataURL(pendingFile);
}


// ═══ EVRENSEL: Stage → Sheets senkronizasyonu (SADECE lokal cache güncelle, gerçek sync backend'de) ═══
async function syncStageToSheets(phone, newStage) {
  // Backend update-patient API zaten Google Sheets'e yazıyor.
  // Burada sadece frontend _sheetRows cache'ini güncelliyoruz (form yönetimi badge'leri için)
  if (!newStage || !window._sheetRows || !window._sheetHeaders) return;
  try {
    const stageLabels = { new: 'Yeni', contacted: 'İlk Temas', discovery: 'Analiz', negotiation: 'İkna', hot_lead: 'Sıcak Lead', appointed: 'Randevu Alındı', lost: 'Kayıp' };
    const cleanP = (phone || '').replace(/\D/g, '');
    const last10 = cleanP.length > 10 ? cleanP.slice(-10) : cleanP;
    
    const phoneColIdx = window._sheetHeaders.findIndex(h => /phone|telefon|tel|whatsapp|cep/i.test(h.toLowerCase()));
    // lead_status sütununu öncelikli ara
    let statusColIdx = window._sheetHeaders.findIndex(h => /^lead[_\s]?status$/i.test((h||'').trim()));
    if (statusColIdx === -1) statusColIdx = window._sheetHeaders.findIndex(h => /^(durum|aşama|lead[_\s]?stage)$/i.test((h||'').trim()));
    if (statusColIdx === -1) statusColIdx = window._sheetHeaders.findIndex(h => /lead_status|lead_stage/i.test((h||'').toLowerCase()));
    if (phoneColIdx === -1 || statusColIdx === -1) return;
    
    const rowIdx = window._sheetRows.findIndex(row => {
      const cellPhone = (row[phoneColIdx] || '').replace(/\D/g, '');
      return cellPhone.length >= 10 && (cellPhone.endsWith(last10) || last10.endsWith(cellPhone.slice(-10)));
    });
    
    if (rowIdx > -1) {
      window._sheetRows[rowIdx][statusColIdx] = stageLabels[newStage] || newStage;
    }
  } catch(e) { /* sessiz */ }
}

// ═══ EVRENSEL: Tüm view'lardaki cache/UI senkronizasyonu ═══
function syncStageToAllViews(phone, newStage) {
  const cleanP = (phone || '').replace(/\D/g, '');
  const last10 = cleanP.length > 10 ? cleanP.slice(-10) : cleanP;
  
  // 1. Inbox cache güncelle
  if (typeof cachedConversations !== 'undefined') {
    const cIdx = cachedConversations.findIndex(c => {
      const cp = (c.phone_number || '').replace(/\D/g, '');
      return cp.endsWith(last10) || last10.endsWith(cp.slice(-10));
    });
    if (cIdx > -1) {
      cachedConversations[cIdx].lead_stage = newStage;
      cachedConversations[cIdx]._effectiveStage = newStage;
    }
  }
  
  // 2. Enrich cache temizle (form yönetimi listesi — geri dönüldüğünde taze data çekilir)
  if (window._enrichCache) {
    Object.keys(window._enrichCache).forEach(key => {
      const keyClean = key.replace(/\D/g, '');
      if (keyClean.endsWith(last10) || last10.endsWith(keyClean.slice(-10))) {
        delete window._enrichCache[key];
      }
    });
  }
  
  // 3. İnbox sağ paneldeki label güncelle
  const stageCfg = PIPELINE_STAGES[newStage] || { emoji: '❓', label: newStage || '—' };
  const stageLabel = document.getElementById('crm-lead-stage');
  if (stageLabel) stageLabel.textContent = stageCfg.emoji + ' ' + stageCfg.label;
  
  // 4. İnbox dropdown'ı da güncelle (varsa)
  const stageSelect = document.getElementById('crm-stage');
  if (stageSelect) stageSelect.value = newStage;
  
  // 5. Inbox conversation list güncelle
  if (typeof renderConversationList === 'function') renderConversationList();
  
  // 6. Form yönetimi satırlarını güncelle (sayfa aktifse)
  if (typeof refreshLeadRowUI === 'function') refreshLeadRowUI(phone);
  
  // 7. Lokal sheet cache'ini de güncelle
  syncStageToSheets(phone, newStage);
}


function navigateToChat(phone) {
  if (!phone) return toast('Telefon numarası yok', 'error');
  // Form detay sayfasından çık
  const fdPage = document.getElementById('page-form-detail');
  if (fdPage) fdPage.style.display = 'none';
  // Conversations sayfasına geç
  document.querySelectorAll('.nav-btn').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => { x.classList.remove('active'); x.style.display = ''; });
  const convBtn = document.querySelector('[data-page="conversations"]');
  if (convBtn) convBtn.classList.add('active');
  const convPage = document.getElementById('page-conversations');
  if (convPage) convPage.classList.add('active');
  loadConversations();
  setTimeout(function(){ loadChat(phone, 'whatsapp'); }, 500);
}

async function instantStageUpdate(newStage) {
  if(!currentPhone) return;
  
  // Evrensel senkronizasyon: tüm view'lar + cache + lokal sheets
  syncStageToAllViews(currentPhone, newStage);
  
  // DB'ye kaydet → backend otomatik Google Sheets'e yazar
  await api('update-patient', 'POST', { phone: currentPhone, lead_stage: newStage });
  toast(`${(PIPELINE_STAGES[newStage] || {}).emoji || '✓'} ${(PIPELINE_STAGES[newStage] || {}).label || newStage}`, 'success');
}

async function autoSaveCRM() {
  if(!currentPhone) return;

  const newName = document.getElementById('crm-name').value;
  const newNotes = document.getElementById('crm-notes').value;
  const newDepartment = document.getElementById('crm-department').value;
  const newStage = document.getElementById('crm-stage').value;

  const payload = {
    phone: currentPhone, 
    patient_name: newName, 
    tags: "[]",
    notes: newNotes,
    department: newDepartment,
    patient_type: 'Yerli',
    lead_stage: newStage
  };

  // Lokal listeyi anında güncelle (isim/not/bölüm de dahil)
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) {
    cachedConversations[idx].patient_name = newName;
    cachedConversations[idx].notes = newNotes;
    cachedConversations[idx].department = newDepartment;
  }
  
  // Evrensel stage senkronizasyonu (tüm view'lar + cache + lokal sheets)
  syncStageToAllViews(currentPhone, newStage);

  // API'ye kaydet → backend otomatik Google Sheets'e yazar
  try {
    await api('update-patient', 'POST', payload);
    toast('✓ Kaydedildi', 'success');
  } catch(e) {
    console.error('AutoSave Error', e);
  }
}

async function setConvStatus(s) {
  if(!currentPhone) return;
  await api('conversation-status','POST',{phone:currentPhone, status:s});
  document.getElementById('btn-status-bot').className = `handover-btn ${s==='active' ? 'active-bot' : ''}`;
  document.getElementById('btn-status-human').className = `handover-btn ${s==='human' ? 'active-human' : ''}`;
  toast(s==='human'?'Manuel kontrole geçildi':'Yapay Zeka devrede');
  loadConversations();
}

async function deleteMessages() {
  if(!currentPhone || !confirm('Tüm geçmiş silinecek ve lead durumu sıfırlanacak. Onaylıyor musunuz?')) return;
  await api('delete-messages','POST',{phone:currentPhone});
  toast('Sohbet ve lead durumu tamamen sıfırlandı');
  document.getElementById('chat-messages').innerHTML = '<div class="empty">Sohbet temizlendi.</div>';
  
  // UI'yı da sıfırla
  document.getElementById('btn-status-bot').className = 'handover-btn active-bot';
  document.getElementById('btn-status-human').className = 'handover-btn';
  const stageSelect = document.getElementById('crm-stage');
  if (stageSelect) stageSelect.value = 'new';
  
  // Hasta Kartı arayüzünü (Sağ panel) temizle
  const deptArea = document.getElementById('dept-area');
  if (deptArea) deptArea.style.display = 'none';
  const notesDiv = document.getElementById('special-notes');
  if (notesDiv) {
    notesDiv.innerHTML = '';
    notesDiv.style.display = 'none';
  }
  const formAnswersBox = document.getElementById('form-answers-box');
  if (formAnswersBox) {
    formAnswersBox.innerHTML = '';
    document.getElementById('form-answers-wrapper').style.display = 'none';
  }
  document.getElementById('lead-score').textContent = '0 / 100';
  document.getElementById('lead-score-fill').style.width = '0%';
  document.getElementById('patient-score-badge').style.display = 'none';
  document.getElementById('patient-score-badge').className = 'score-badge bg-gray-500';
  document.getElementById('patient-score-badge').innerHTML = '<i class="fas fa-star" style="font-size:10px;"></i> 0p';
  
  // Local cache'i de temizle ki liste anında güncellensin
  const idx = cachedConversations.findIndex(c => c.phone_number === currentPhone);
  if (idx > -1) {
    cachedConversations[idx].status = 'active';
    cachedConversations[idx].lead_stage = 'new';
    cachedConversations[idx].phase = 'greeting';
    cachedConversations[idx].notes = null;
    cachedConversations[idx].tags = '[]';
    cachedConversations[idx].lead_score = 0;
    cachedConversations[idx].temperature = 'cold';
    cachedConversations[idx].message_count = 0;
    cachedConversations[idx].last_message = '';
    cachedConversations[idx].last_message_at = null;
    cachedConversations[idx]._effectiveStage = 'new';
  }
  
  // Listeyi ve tüm verileri sunucudan temiz şekilde çek ki UI senkronizasyonu şaşmasın
  loadConversations();
}

async function hardDeleteLead() {
  if(!currentPhone || !confirm('⚠️ DİKKAT! Bu hastanın TÜM form, log, mesaj ve randevu kayıtları veritabanından kalıcı olarak silinecek. SADECE test için kullanın. Onaylıyor musunuz?')) return;
  
  const deletingPhone = currentPhone;
  
  try {
    const result = await api('hard-delete-lead', 'POST', { phone: deletingPhone });
    console.log('Hard delete result:', result);
  } catch(e) {
    console.error('Hard delete API error:', e);
    toast('Silme işlemi başarısız oldu!', 'error');
    return;
  }
  
  toast('Kayıt tamamen yok edildi (Hard Reset)');
  
  // Sohbet alanını temizle
  document.getElementById('chat-messages').innerHTML = '<div class="empty">Kayıt silindi.</div>';
  document.getElementById('btn-status-bot').className = 'handover-btn active-bot';
  document.getElementById('btn-status-human').className = 'handover-btn';
  
  // Üst bar (chat header) temizle
  const chatTitle = document.getElementById('chat-title');
  if (chatTitle) chatTitle.textContent = '';
  const chatSubtitle = document.getElementById('chat-subtitle');
  if (chatSubtitle) chatSubtitle.textContent = '';
  
  // Hasta Kartını temizle
  const deptArea = document.getElementById('dept-area'); if (deptArea) deptArea.style.display = 'none';
  const notesDiv = document.getElementById('special-notes'); if (notesDiv) { notesDiv.innerHTML = ''; notesDiv.style.display = 'none'; }
  const formAnswersBox = document.getElementById('form-answers-box'); if (formAnswersBox) formAnswersBox.innerHTML = '';
  const faw = document.getElementById('form-answers-wrapper'); if (faw) faw.style.display = 'none';
  document.getElementById('lead-score').textContent = '0 / 100';
  document.getElementById('lead-score-fill').style.width = '0%';
  const scoreBadge = document.getElementById('patient-score-badge'); 
  if (scoreBadge) { scoreBadge.style.display = 'none'; }
  const stageSelect = document.getElementById('crm-stage'); if (stageSelect) stageSelect.value = 'new';
  const patientNameInput = document.getElementById('patient-name'); if (patientNameInput) patientNameInput.value = '';

  // Listeden çıkar ve currentPhone'u sıfırla
  cachedConversations = cachedConversations.filter(c => c.phone_number !== deletingPhone);
  currentPhone = null;
  renderConversationList();
  
  // Sunucudan listeyi tümüyle yeniden çek
  setTimeout(loadConversations, 300);
}

async function clearAllAppointments() {
  if(!confirm('Gelen randevu/ön görüşme taleplerinin tümü silinecektir. Test aşamasındaysanız onaylayın.')) return;
  await api('clear-appointments', 'POST');
  toast('Tüm talepler sıfırlandı.');
  loadAppointments();
}

