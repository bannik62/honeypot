# Flux du projet — diagrammes Mermaid

Visualisation des enchaînements (cron, manuel, fichiers → `data.json`).  
À prévisualiser dans VS Code (extension Mermaid), GitHub, ou [mermaid.live](https://mermaid.live).

---

## 1. Ordre d’exécution — `run-all-scans.sh` (cron)

```mermaid
flowchart LR
  subgraph cron["⏰ Cron → run-all-scans.sh"]
    A1["1. nmap-to-csv.sh"] --> A2["2. web-capture.sh"]
    A2 --> A3["3. dig-ip.sh"]
    A3 --> A4["4. vuln-scan.sh"]
    A4 --> A5["5. cleanup-old-data.sh"]
    A5 --> A6["6. generate-data.sh"]
  end
```

---

## 2. Vue « fichiers » : d’où viennent les rapports

```mermaid
flowchart TB
  CSV[(connections.csv)]
  WI[(web_interfaces.csv)]

  CSV --> NMAP[nmap-to-csv.sh]
  NMAP --> WI

  WI --> CAP[web-capture.sh]
  CAP --> PNG["screenshotAndLog/&lt;IP&gt;/*.png"]
  CAP --> NIKTO[Nikto → SQLite]

  CSV --> DIG[dig-ip.sh]
  WI --> DIG
  TRFILES["*_traceroute.txt\n(union des IPs hops)"] -.->|optionnel| DIG
  DIG --> DNSF["&lt;IP&gt;_dns.txt"]

  CSV --> VULN[vuln-scan.sh]
  VULN --> NMAPF["&lt;IP&gt;_nmap.txt"]

  TRMAN["traceroute-ip.sh\n(sudo, manuel)"] --> TRF["&lt;IP&gt;_traceroute.txt"]

  subgraph agg["generate-data.sh"]
    G[data.json]
  end

  DNSF --> agg
  TRF --> agg
  NMAPF --> agg
  PNG --> agg
  agg --> G
```

> Note : le schéma simplifie les chemins ; tout part de `data/` selon `config`.

---

## 3. Traceroute & DNS : **hors cron** vs **cron**

```mermaid
flowchart TB
  subgraph auto["Automatique (cron)"]
    R[run-all-scans.sh]
    R --> DIG[dig-ip.sh]
    R --> GEN[generate-data.sh]
  end

  subgraph manuel["Manuel (toi, ponctuel)"]
    TR[traceroute-ip.sh\nsudo + nmap --traceroute]
    TR --> TRF["*_traceroute.txt"]
  end

  TRF --> GEN
  DIG --> DNSF["*_dns.txt"]
  DNSF --> GEN
  GEN --> JSON[(data.json)]
```

---

## 4. Champs `data.json` ↔ fichiers (résumé)

```mermaid
flowchart LR
  subgraph fichiers["Fichiers par IP"]
    F1["_nmap.txt"]
    F2["_dns.txt"]
    F3["_traceroute.txt"]
    F4["screenshots .png"]
    F5["_nikto.txt"]
  end

  subgraph json["Entrée data.json"]
    J1["ports, vuln_high, nmap"]
    J2["dns, name, hop_names"]
    J3["traceroute, hops"]
    J4["screenshot"]
    J5["nikto"]
  end

  F1 --> J1
  F2 --> J2
  F3 --> J3
  F4 --> J4
  F5 --> J5
```

---

## 5. Visualiseur web (tunnel)

```mermaid
sequenceDiagram
  participant VPS as VPS server.py
  participant T as Tunnel SSH
  participant B as Navigateur

  B->>T: localhost:8765
  T->>VPS: 127.0.0.1:8765
  VPS-->>B: honeypot-dashboard.html
  VPS-->>B: data.json
  VPS-->>B: rapports / screenshots (optionnel)
```

---

## 6. Onglet Réseau (D3) — données consommées

```mermaid
flowchart LR
  JSON[(data.json)]
  JSON -->|"hops, hop_names,\nhop_countries"| NET[network-tab.js]
  NET --> G[Graphe force + tooltips]
```

---

*Pour le schéma global du pipeline, voir aussi `FLOWCHART.md`.*
