#!/bin/bash
# Vercel Environment Variables — Eksik olanları ekle
# Bu scripti internet bağlantısı olduğunda çalıştır

cd "/Users/mustafa/Desktop/Başkent WP ENTEGRE"

echo "📋 Mevcut env vars kontrol ediliyor..."
vercel env ls 2>/dev/null

echo ""
echo "🔧 Eksik olan değişkenleri ekliyorum..."

# PANEL_PASSWORD
echo "baskent2024" | vercel env add PANEL_PASSWORD production preview development 2>/dev/null && echo "✅ PANEL_PASSWORD eklendi" || echo "⏭️ PANEL_PASSWORD zaten mevcut"

# WEBHOOK_VERIFY_TOKEN  
echo "baskent_wp_secret_token_123" | vercel env add WEBHOOK_VERIFY_TOKEN production preview development 2>/dev/null && echo "✅ WEBHOOK_VERIFY_TOKEN eklendi" || echo "⏭️ WEBHOOK_VERIFY_TOKEN zaten mevcut"

# GOOGLE_SHEETS_API_KEY
echo "AIzaSyAxNUHQCrXzmATX4YuMgcFP3u4EW_jsJYc" | vercel env add GOOGLE_SHEETS_API_KEY production preview development 2>/dev/null && echo "✅ GOOGLE_SHEETS_API_KEY eklendi" || echo "⏭️ GOOGLE_SHEETS_API_KEY zaten mevcut"

# GOOGLE_SPREADSHEET_ID
echo "1oSKJ-iYiZPltYUQ73_O-FaFdelhwAwtf09wVKKVs1GQ" | vercel env add GOOGLE_SPREADSHEET_ID production preview development 2>/dev/null && echo "✅ GOOGLE_SPREADSHEET_ID eklendi" || echo "⏭️ GOOGLE_SPREADSHEET_ID zaten mevcut"

# GOOGLE_SHEET_UPDATE_URL
echo "https://script.google.com/macros/s/AKfycbw_iaJ0zqgOFYAGlkCnGnKQOzYQtPJWtbLMIEMIPuVbVkXOnDyq_1jMmII554s85sxu/exec" | vercel env add GOOGLE_SHEET_UPDATE_URL production preview development 2>/dev/null && echo "✅ GOOGLE_SHEET_UPDATE_URL eklendi" || echo "⏭️ GOOGLE_SHEET_UPDATE_URL zaten mevcut"

echo ""
echo "✅ Tamamlandı! Şimdi deploy et: vercel --prod"
