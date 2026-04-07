# SABIMMO — Atrium Automation API
## Guide d'installation (Mac mini)

---

## ÉTAPE 1 — Installer Node.js (si pas déjà fait)

Ouvre le Terminal et colle :
```bash
brew install node
```
Si tu n'as pas Homebrew :
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

---

## ÉTAPE 2 — Installer et démarrer le serveur

```bash
# Copier le dossier atrium-api sur ton Mac mini, puis :
cd ~/atrium-api
npm install
node server.js
```

Tu dois voir :
```
🏠 SABIMMO Atrium API démarrée
   URL: http://localhost:3099
   Atrium: http://philanthropie.ddns.net:9001
```

---

## ÉTAPE 3 — Ajuster les noms de chambres

Dans server.js, la section ROOM_MAPPING doit correspondre exactement
aux noms (prénom + nom) des utilisateurs dans ton Atrium.

Ouvre Atrium → Users → note le prénom et nom exact de chaque chambre.
Puis modifie le fichier server.js en conséquence.

Exemple actuel (à vérifier) :
```
'etage 1 droite' → fn: 'Etage1', ln: 'Droite'
```

---

## ÉTAPE 4 — Rendre accessible depuis internet (pour Make.com)

Option A — ngrok (le plus simple, gratuit) :
```bash
brew install ngrok
ngrok http 3099
```
→ ngrok te donne une URL publique genre : https://abc123.ngrok.io
→ Utilise cette URL dans Make.com

Option B — Port forwarding sur ta box internet :
- Accède à ta box → Redirection de ports
- Redirige le port 3099 vers l'IP locale du Mac mini
- Utilise ton IP publique dans Make.com

---

## ÉTAPE 5 — Démarrage automatique (Mac mini toujours allumé)

Pour que le serveur redémarre automatiquement :
```bash
npm install -g pm2
pm2 start server.js --name "atrium-api"
pm2 startup
pm2 save
```

---

## TEST MANUEL

Une fois le serveur lancé, teste depuis Terminal :
```bash
curl -X POST http://localhost:3099/change-code \
  -H "Content-Type: application/json" \
  -H "x-api-key: sabimmo2026" \
  -d '{"room": "etage 1 droite", "guest_name": "Test Guest"}'
```

Réponse attendue :
```json
{
  "success": true,
  "room": "etage 1 droite",
  "pin": "47382",
  "message": "Code mis à jour avec succès"
}
```

---

## SCÉNARIO MAKE.COM

1. Trigger : Hospitable → Watch new reservations
2. HTTP POST vers ton URL ngrok/publique :
   - URL : https://ton-url/change-code
   - Header : x-api-key: sabimmo2026
   - Body : {"room": "{{nom_chambre}}", "guest_name": "{{guest_name}}", "checkin": "{{checkin}}", "checkout": "{{checkout}}"}
3. Récupère le PIN depuis la réponse : {{pin}}
4. Hospitable → Send message avec le PIN injecté dans le template
