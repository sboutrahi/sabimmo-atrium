const express = require('express');
const AtriumCDVIAgent = require('http-atrium-cdvi');
const app = express();
app.use(express.json());

const API_SECRET = 'sabimmo2026';
const PORT = process.env.PORT || 3099;

const BUILDINGS = {
    'philanthropie': {
        atrium_url:  'http://philanthropie.ddns.net:9001',
        atrium_user: 'samir',
        atrium_pass: 'samir123',
        rooms: {
            'brusseleir':  { fn: 'BRUSSELEIR', ln: '1ER DROIT'  },
            'zinneke':     { fn: 'ZINNEKE',    ln: '1ER GAUCHE' },
            'boentje':     { fn: 'BOENTJE',    ln: '2E DROIT'   },
            'vogelpik':    { fn: 'VOGELPIK',   ln: '2E GAUCHE'  },
            'babbeleir':   { fn: 'BABBELEIR',  ln: '3E DROIT'   },
            'schieve':     { fn: 'SCHIEVE',    ln: '3E GAUCHE'  },
        }
    }
};

const pendingCodes = {};

function generatePin() {
    const num = Math.floor(1 + Math.random() * 50000);
    return String(num).padStart(5, '0');
}

function authenticate(req, res) {
    if (req.headers['x-api-key'] !== API_SECRET) {
        res.status(401).json({ error: 'Non autorisé' });
        return false;
    }
    return true;
}

function detectBuilding(name) {
    name = name.toLowerCase();
    if (name.includes('philant')) return 'philanthropie';
    return null;
}

function detectRoom(name) {
    name = name.toLowerCase();
    if (name.includes('brusseleir')) return 'brusseleir';
    if (name.includes('zinneke'))    return 'zinneke';
    if (name.includes('boentje'))    return 'boentje';
    if (name.includes('vogelpik'))   return 'vogelpik';
    if (name.includes('babbeleir'))  return 'babbeleir';
    if (name.includes('schieve'))    return 'schieve';
    return null;
}

// J-5 : génère et stocke le code
app.post('/generate-code', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id, property_name, guest_name, checkin_date } = req.body;
    if (!reservation_id || !property_name) return res.status(400).json({ error: 'reservation_id et property_name requis' });

    const buildingKey = detectBuilding(property_name);
    const roomKey = detectRoom(property_name);
    if (!buildingKey) return res.status(400).json({ error: `Immeuble non reconnu: ${property_name}` });
    if (!roomKey) return res.status(400).json({ error: `Chambre non reconnue: ${property_name}` });

    const pin = generatePin();
    pendingCodes[reservation_id] = { building: buildingKey, room: roomKey, pin, checkin_date, guest_name };
    console.log(`[${new Date().toISOString()}] ✅ Code généré — ${property_name} | ${guest_name} | PIN: ${pin}`);
    res.json({ success: true, pin, room: roomKey, building: buildingKey });
});

// Jour J à 12h : active dans Atrium
app.post('/activate-code', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id } = req.body;
    if (!reservation_id) return res.status(400).json({ error: 'reservation_id requis' });

    const entry = pendingCodes[reservation_id];
    if (!entry) return res.status(404).json({ error: `Aucun code en attente pour: ${reservation_id}` });

    const building = BUILDINGS[entry.building];
    const roomConfig = building.rooms[entry.room];
    const log = { extend: () => () => {} };
    const agent = new AtriumCDVIAgent(log, building.atrium_url, building.atrium_user, building.atrium_pass);

    try {
        console.log(`[${new Date().toISOString()}] 🔐 Activation — ${entry.room} | ${entry.guest_name} | PIN: ${entry.pin}`);
        await agent.login();
        const userId = await agent.getUserId(`${roomConfig.fn} ${roomConfig.ln}`);
        await agent.setUserKeyCode(userId, entry.pin);
        await agent.setUserStatus(`${roomConfig.fn} ${roomConfig.ln}`, true);
        delete pendingCodes[reservation_id];
        console.log(`  ✅ Code ${entry.pin} activé pour ${entry.room}`);
        res.json({ success: true, room: entry.room, pin: entry.pin, guest: entry.guest_name });
    } catch (err) {
        console.error(`  ❌ Échec:`, err);
        res.status(500).json({ success: false, error: String(err), room: entry.room, pin: entry.pin, guest: entry.guest_name });
    }
});

app.get('/pending', (req, res) => {
    if (!authenticate(req, res)) return;
    res.json({ pending: pendingCodes, count: Object.keys(pendingCodes).length });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), pending: Object.keys(pendingCodes).length });
});

app.listen(PORT, () => {
    console.log(`\n🏠 SABIMMO Atrium API — Port ${PORT} — Prêt ✅\n`);
});
