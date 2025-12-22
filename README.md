# 🍯 Honeypot Monitor

Système de monitoring temps réel pour Endlessh (honeypot SSH).

## 🎯 Fonctionnalités

- ⚡ Monitoring temps réel des connexions
- 🌍 Géolocalisation des attaquants (GeoIP local)
- 📊 Dashboard ASCII avec stats live
- 📈 Logs CSV pour analyse
- 🚀 Léger : <1% CPU, ~10MB RAM

## 🚀 Installation

git clone https://github.com/bannik62/honeypot.git
cd honeypot
sudo ./install.sh## 📊 Utilisation

./scripts/stats.sh          # Stats rapides
./scripts/dashboard.sh      # Dashboard live
./scripts/monitor.sh start  # Lancer monitoring## 📂 Structure
./scripts/stats.sh          # Stats rapides
./scripts/dashboard.sh      # Dashboard live
./scripts/monitor.sh start  # Lancer monitoring


data/
├── logs/connections.csv    # Toutes les connexions
└── cache/geoip-cache.json  # Cache géolocalisation

scripts/
├── monitor.sh    # Monitoring temps réel
├── stats.sh      # Statistiques
└── dashboard.sh  # Dashboard ASCII
