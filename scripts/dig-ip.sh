#!/bin/bash
# Script pour faire des requêtes DNS sur les IPs du honeypot

if [ -z "$1" ]; then
    echo "Usage: $0 <IP>"
    echo "   ou: honeypot-dig <IP>"
    exit 1
fi

IP="$1"

echo "🔍 Informations DNS pour $IP"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Reverse DNS
echo "📋 Reverse DNS (PTR):"
dig +short -x "$IP" 2>/dev/null || echo "  ❌ Aucun résultat"
echo ""

# WHOIS (si disponible)
if command -v whois &> /dev/null; then
    echo "📋 WHOIS (premières lignes):"
    whois "$IP" 2>/dev/null | head -20 || echo "  ❌ Erreur whois"
fi
