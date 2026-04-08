const express = require('express');
const https = require('https');
const http = require('http');
const { createHash } = require('crypto');
const app = express();
app.use(express.json());

const API_SECRET = 'sabimmo2026';
const PORT = process.env.PORT || 3099;
const TELEGRAM_TOKEN = '8673703990:AAHKnAmduUAQ3LKWdTw8Wt_IYfSJrJ4NLGI';
const TELEGRAM_CHAT_ID = '7506192018';

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

String.prototype.pad = function(inC, inL) {
    var str = this;
    while (str.length < inL) str = inC + str;
    return str;
};

function rc4(key, text) {
    var s = [];
    for (var i = 0; i < 256; i++) s[i] = i;
    var j = 0, x;
    for (i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        x = s[i]; s[i] = s[j]; s[j] = x;
    }
    i = 0; j = 0;
    var ct = '';
    for (var y = 0; y < text.length; y++) {
        i = (i + 1) % 256;
        j = (j + s[i]) % 256;
        x = s[i]; s[i] = s[j]; s[j] = x;
        ct += (text.charCodeAt(y) ^ s[(s[i] + s[j]) % 256]).toString(16).pad("0", 2).toUpperCase();
    }
    return ct;
}

function rc4Decrypt(key, text) {
    var s = [];
    for (var i = 0; i < 256; i++) s[i] = i;
    var j = 0, x;
    for (i = 0; i < 256; i++) {
        j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
        x = s[i]; s[i] = s[j]; s[j] = x;
    }
    i = 0; j = 0;
    var ct = '';
    if (0 == (text.length & 1)) {
        for (var y = 0; y < text.length; y += 2) {
            i = (i + 1) % 256;
            j = (j + s[i]) % 256;
            x = s[i]; s[i] = s[j]; s[j] = x;
            ct += String.fromCharCode((parseInt(text.substr(y, 2), 16) ^ s[(s[i] + s[j]) % 256]));
        }
    }
    return ct;
}

function postChkCalc(str) {
    var chk = 0;
    for (var i = 0; i < str.length; i++) chk += str.charCodeAt(i);
    return (chk & 0xFFFF).toString(16).pad("0", 4).toUpperCase();
}

function encryptBody(data, key) {
    return 'post_enc=' + rc4(key, data) + '&post_chk=' + postChkCalc(data);
}

function decryptResponse(text, key) {
    var postEnc = 'post_enc=';
    var IdxEnc = text.search(postEnc);
    if (IdxEnc >= 0) {
        IdxEnc += postEnc.length;
        var postChk = '&post_chk=';
        var IdxChk = text.search(postChk);
        if (IdxChk >= 0) {
            var encrypted = text.substr(IdxEnc, IdxChk - IdxEnc);
            return rc4Decrypt(key, encrypted);
        }
    }
    return text;
}

function httpRequest(method, url, body, headers) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers || {}
        };
        if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
        const proto = urlObj.protocol === 'https:' ? https : http;
        const req = proto.request(options, (res) => {
            let data = '';
            const cookies = res.headers['set-cookie'] || [];
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ body: data, cookies, status: res.statusCode }));
        });
        req.on('error', reject);
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Timeout connexion Atrium')); });
        if (body) req.write(body);
        req.end();
    });
}

async function sendTelegram(message) {
    try {
        const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message });
        await httpRequest('POST',
            'https://api.telegram.org/bot' + TELEGRAM_TOKEN + '/sendMessage',
            body,
            { 'Content-Type': 'application/json' }
        );
    } catch (err) {
        console.error('Telegram error:', err.message);
    }
}

async function atriumLogin(baseUrl, username, password) {
    const loginUrl = baseUrl + '/login.xml';
    const getResp = await httpRequest('GET', loginUrl, null, {});
    const keyMatch = getResp.body.match(/<KEY>([^<]+)<\/KEY>/);
    if (!keyMatch) throw new Error('Impossible obtenir KEY Atrium');
    const key = keyMatch[1];
    const encUser = rc4(key, username);
    const encPass = createHash('md5').update(key + password).digest('hex');
    const body = 'login_user=' + encUser + '&login_pass=' + encPass;
    const postResp = await httpRequest('POST', loginUrl, body, {
        'Content-Type': 'application/x-www-form-urlencoded'
    });
    const newKeyMatch = postResp.body.match(/<KEY>([^<]+)<\/KEY>/);
    if (!newKeyMatch) throw new Error('Login Atrium echoue');
    const sessionKey = newKeyMatch[1];
    const cookieStr = postResp.cookies.map(c => c.split(';')[0]).join('; ');
    return { key: sessionKey, cookie: cookieStr };
}

async function atriumGetUserId(baseUrl, session, firstName, lastName) {
    const url = baseUrl + '/users.xml?page_nb=1&user_name=' + encodeURIComponent(firstName.toLowerCase()) + '&_=' + Date.now();
    const resp = await httpRequest('GET', url, null, { 'Cookie': session.cookie });
    const decrypted = decryptResponse(resp.body, session.key);
    const userTags = decrypted.match(/<USER[^>]*>/g) || [];
    for (const tag of userTags) {
        const idMatch = tag.match(/\bid="(\d+)"/);
        const fnMatch = tag.match(/\bfn="([^"]*)"/);
        const lnMatch = tag.match(/\bln="([^"]*)"/);
        if (idMatch && fnMatch && lnMatch) {
            if (fnMatch[1] === firstName && lnMatch[1] === lastName) {
                return idMatch[1];
            }
        }
    }
    throw new Error('User non trouve: ' + firstName + ' ' + lastName);
}

async function atriumSetKeyCode(baseUrl, session, userId, pin) {
    const bodyStr = 'T_user_id=' + userId + '&T_user_code_cmd=add&T_user_code_num=' + pin + '&T_user_code_ld_act=0&T_user_code_ld_deact=0&T_user_code_ld_over=0&T_user_code_ld_ack=0';
    const encrypted = encryptBody(bodyStr, session.key);
    await httpRequest('POST', baseUrl + '/users_T_user.xml', encrypted, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookie
    });
}

async function atriumSetUserStatus(baseUrl, session, userId, firstName, lastName, active, checkinDate, checkoutDate) {
    // Parse validity dates
    let a_yr='', a_month='', a_day='', a_hr='', a_min='';
    let e_yr='', e_month='', e_day='', e_hr='', e_min='';
    if (checkinDate) {
        const ci = new Date(checkinDate);
        a_yr = ci.getFullYear(); a_month = ci.getMonth()+1; a_day = ci.getDate();
        a_hr = 12; a_min = 0; // check-in à 12h00
    }
    if (checkoutDate) {
        const co = new Date(checkoutDate);
        e_yr = co.getFullYear(); e_month = co.getMonth()+1; e_day = co.getDate();
        e_hr = 11; e_min = 0; // check-out à 11h00
    }
    const bodyStr = 'T_user_cmd=edit&T_user_id=' + userId + '&T_user_fn=' + firstName + '&T_user_ln=' + lastName + '&T_user_lang=0&T_user_a_yr=' + a_yr + '&T_user_a_month=' + a_month + '&T_user_a_day=' + a_day + '&T_user_a_hr=' + a_hr + '&T_user_a_min=' + a_min + '&T_user_yr=' + e_yr + '&T_user_month=' + e_month + '&T_user_day=' + e_day + '&T_user_hr=' + e_hr + '&T_user_min=' + e_min + '&T_user_en=' + (active ? 1 : 0) + '&T_user_program=0&T_user_ext_dly=0&T_user_o_anti=0&T_user_o_inter=0&T_user_can_arm=0&T_user_can_disarm=0';
    const encrypted = encryptBody(bodyStr, session.key);
    await httpRequest('POST', baseUrl + '/users_T_user.xml', encrypted, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookie
    });
}

async function activateInAtrium(room, pin, guest, building, checkinDate, checkoutDate) {
    const roomConfig = building.rooms[room];
    const session = await atriumLogin(building.atrium_url, building.atrium_user, building.atrium_pass);
    const userId = await atriumGetUserId(building.atrium_url, session, roomConfig.fn, roomConfig.ln);
    await atriumSetKeyCode(building.atrium_url, session, userId, pin);
    await atriumSetUserStatus(building.atrium_url, session, userId, roomConfig.fn, roomConfig.ln, true, checkinDate, checkoutDate);
    console.log('Validite: ' + checkinDate + ' 12h00 -> ' + checkoutDate + ' 11h00');
}

function generatePin() {
    const num = Math.floor(1 + Math.random() * 50000);
    return String(num).padStart(5, '0');
}

function authenticate(req, res) {
    if (req.headers['x-api-key'] !== API_SECRET) {
        res.status(401).json({ error: 'Non autorise' });
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

// J-5 : génère et stocke le code en mémoire
app.post('/generate-code', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id, property_name, guest_name, checkin_date } = req.body;
    if (!reservation_id || !property_name) return res.status(400).json({ error: 'reservation_id et property_name requis' });
    const buildingKey = detectBuilding(property_name);
    const roomKey = detectRoom(property_name);
    if (!buildingKey) return res.status(400).json({ error: 'Immeuble non reconnu: ' + property_name });
    if (!roomKey) return res.status(400).json({ error: 'Chambre non reconnue: ' + property_name });
    const pin = generatePin();
    pendingCodes[reservation_id] = { building: buildingKey, room: roomKey, pin, checkin_date, guest_name };
    console.log('Code genere - ' + roomKey + ' | PIN: ' + pin + ' | ' + guest_name);
    res.json({ success: true, pin, room: roomKey, building: buildingKey });
});

// Jour J à 12h : active depuis Make.com avec pin et room directement
app.post('/activate-direct', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id, pin, room, guest_name, building_name } = req.body;
    if (!reservation_id || !pin || !room) return res.status(400).json({ error: 'reservation_id, pin et room requis' });

    const buildingKey = building_name ? detectBuilding(building_name) : 'philanthropie';
    const building = BUILDINGS[buildingKey];
    if (!building) return res.status(400).json({ error: 'Immeuble non reconnu' });
    if (!building.rooms[room]) return res.status(400).json({ error: 'Chambre non reconnue: ' + room });

    const checkin_date = req.body.checkin_date;
    const checkout_date = req.body.checkout_date;
    try {
        console.log('=== ACTIVATION DIRECTE ' + room + ' | PIN:' + pin + ' | ' + guest_name + ' | ' + checkin_date + ' -> ' + checkout_date + ' ===');
        await activateInAtrium(room, pin, guest_name, building, checkin_date, checkout_date);
        console.log('=== SUCCES ===');
        await sendTelegram('✅ Code activé - Chambre ' + room + ' - Code: ' + pin + ' B - Guest: ' + (guest_name || '?'));
        res.json({ success: true, room, pin, guest: guest_name });
    } catch (err) {
        console.error('=== ECHEC:', err.message, '===');
        await sendTelegram('❌ ERREUR activation Philanthropie\nChambre: ' + room + '\nGuest: ' + (guest_name || '?') + '\nCode: ' + pin + '\nErreur: ' + err.message + '\n👉 Intervenir manuellement!');
        res.status(500).json({ success: false, error: err.message, room, pin, guest: guest_name });
    }
});

// Ancien endpoint (garde pour compatibilité)
app.post('/activate-code', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id } = req.body;
    if (!reservation_id) return res.status(400).json({ error: 'reservation_id requis' });
    const entry = pendingCodes[reservation_id];
    if (!entry) return res.status(404).json({ error: 'Aucun code en attente pour: ' + reservation_id });
    const building = BUILDINGS[entry.building];
    try {
        await activateInAtrium(entry.room, entry.pin, entry.guest_name, building, entry.checkin_date, entry.checkout_date);
        delete pendingCodes[reservation_id];
        await sendTelegram('✅ Code activé - Chambre ' + entry.room + ' - Code: ' + entry.pin + ' B - Guest: ' + (entry.guest_name || '?'));
        res.json({ success: true, room: entry.room, pin: entry.pin, guest: entry.guest_name });
    } catch (err) {
        await sendTelegram('❌ ERREUR activation Philanthropie\nChambre: ' + entry.room + '\nGuest: ' + (entry.guest_name || '?') + '\nErreur: ' + err.message + '\n👉 Intervenir!');
        res.status(500).json({ success: false, error: err.message, room: entry.room, pin: entry.pin });
    }
});

app.get('/pending', (req, res) => {
    if (!authenticate(req, res)) return;
    res.json({ pending: pendingCodes, count: Object.keys(pendingCodes).length });
});


// GET /check-code - verifie le code actuel dans Atrium pour une chambre
app.get('/check-code', async (req, res) => {
    if (req.headers['x-api-key'] !== API_SECRET) return res.status(401).json({ error: 'Non autorise' });
    const room = req.query.room;
    const buildingKey = req.query.building || 'philanthropie';
    if (!room) return res.status(400).json({ error: 'room requis (ex: ?room=vogelpik)' });
    const bldg = BUILDINGS[buildingKey];
    if (!bldg) return res.status(400).json({ error: 'Immeuble non reconnu: ' + buildingKey });
    const roomConfig = bldg.rooms[room];
    if (!roomConfig) return res.status(400).json({ error: 'Chambre non reconnue: ' + room });
    try {
        const session = await atriumLogin(bldg.atrium_url, bldg.atrium_user, bldg.atrium_pass);
        const url = bldg.atrium_url + '/users.xml?page_nb=1&user_name=' + encodeURIComponent(roomConfig.fn.toLowerCase()) + '&_=' + Date.now();
        const resp = await httpRequest('GET', url, null, { 'Cookie': session.cookie });
        const decrypted = decryptResponse(resp.body, session.key);
        // Extract code and status from user tags
        const userTags = decrypted.match(/<USER[^>]*>/g) || [];
        let code = 'non trouve';
        let active = 'inconnu';
        for (const tag of userTags) {
            const fnMatch = tag.match(/fn="([^"]*)"/);
            const lnMatch = tag.match(/ln="([^"]*)"/);
            if (fnMatch && lnMatch && fnMatch[1] === roomConfig.fn && lnMatch[1] === roomConfig.ln) {
                const enMatch = tag.match(/en="([^"]*)"/);
                active = enMatch ? (enMatch[1] === '1' ? 'actif' : 'inactif') : 'inconnu';
                break;
            }
        }
        // Get key codes for this user
        const codeMatch = decrypted.match(/code_num="([^"]+)"/);
        if (codeMatch) code = codeMatch[1];
        res.json({ success: true, room, fn: roomConfig.fn, ln: roomConfig.ln, code, active });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message, room });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), pending: Object.keys(pendingCodes).length });
});

app.listen(PORT, () => {
    console.log('SABIMMO Atrium API v5 - Port ' + PORT + ' - Pret');
});

// PATCH: add check-code endpoint - insert before app.listen
