#!/bin/bash
cd "$(dirname "$0")"
echo "==============================================="
echo "🚀 Başkent WP Entegre - GitHub Push Başlatılıyor"
echo "==============================================="
echo ""

# Run git push
git push origin main

echo ""
echo "==============================================="
echo "✅ İşlem tamamlandı! Bu pencereyi kapatabilirsiniz."
echo "==============================================="
read -p "Çıkış yapmak için Enter'a basın..."
