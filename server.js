const express = require('express');
const https = require('https');
const http = require('http');
const { createHash } = require('crypto');
const { parse, stringify } = require('querystring');
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

// ─── RC4 Implementation ───────────────────────────────────────────────────────
String.prototype.pad = function(inC, inL) {
    var str = this;
    while (str.length < inL) str = inC + str;
    return str;
};

function rc4(key, text) {
    var s = new Array();
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
    var s = new Array();
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

// ─── HTTP Helper ──────────────────────────────────────────────────────────────
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
        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(body);
        }
        const proto = urlObj.protocol === 'https:' ? https : http;
        const req = proto.request(options, (res) => {
            let data = '';
            const cookies = res.headers['set-cookie'] || [];
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ body: data, cookies, status: res.statusCode }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
        if (body) req.write(body);
        req.end();
    });
}

// ─── Atrium Client ────────────────────────────────────────────────────────────
async function atriumLogin(baseUrl, username, password) {
    // 1. GET login.xml to get KEY
    const loginUrl = baseUrl + '/login.xml';
    const getResp = await httpRequest('GET', loginUrl, null, {});
    
    // Parse KEY from XML
    const keyMatch = getResp.body.match(/<KEY>([^<]+)<\/KEY>/);
    if (!keyMatch) throw new Error('Cannot get Atrium KEY: ' + getResp.body.substr(0, 200));
    const key = keyMatch[1];
    
    // 2. Encrypt credentials
    const encUser = rc4(key, username);
    const encPass = createHash('md5').update(key + password).digest('hex');
    
    // 3. POST login
    const body = 'login_user=' + encUser + '&login_pass=' + encPass;
    const postResp = await httpRequest('POST', loginUrl, body, {
        'Content-Type': 'application/x-www-form-urlencoded'
    });
    
    // Parse new KEY from response
    const newKeyMatch = postResp.body.match(/<KEY>([^<]+)<\/KEY>/);
    if (!newKeyMatch) throw new Error('Login failed: ' + postResp.body.substr(0, 200));
    const sessionKey = newKeyMatch[1];
    
    // Parse cookies
    const cookieStr = postResp.cookies.map(c => c.split(';')[0]).join('; ');
    
    console.log('Atrium login OK, key=' + sessionKey.substr(0, 8) + '...');
    return { key: sessionKey, cookie: cookieStr };
}

async function atriumGetUserId(baseUrl, session, firstName, lastName) {
    const url = baseUrl + '/users.xml?page_nb=1&user_name=' + encodeURIComponent(firstName.toLowerCase()) + '&_=' + Date.now();
    const resp = await httpRequest('GET', url, null, {
        'Cookie': session.cookie
    });
    
    const decrypted = decryptResponse(resp.body, session.key);
    console.log('getUserId decrypted (first 300):', decrypted.substr(0, 300));
    
    // Find user with matching fn and ln
    const userRegex = /id="(\d+)"[^>]*fn="([^"]*)"[^>]*ln="([^"]*)"/g;
    let match;
    while ((match = userRegex.exec(decrypted)) !== null) {
        if (match[2] === firstName && match[3] === lastName) {
            console.log('Found user ID:', match[1]);
            return match[1];
        }
    }
    throw new Error('User not found: ' + firstName + ' ' + lastName);
}

async function atriumSetKeyCode(baseUrl, session, userId, pin) {
    const bodyStr = 'T_user_id=' + userId + '&T_user_code_cmd=add&T_user_code_num=' + pin + '&T_user_code_ld_act=0&T_user_code_ld_deact=0&T_user_code_ld_over=0&T_user_code_ld_ack=0';
    const encrypted = encryptBody(bodyStr, session.key);
    const resp = await httpRequest('POST', baseUrl + '/users_T_user.xml', encrypted, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookie
    });
    console.log('setKeyCode response:', resp.body.substr(0, 100));
    return resp;
}

async function atriumSetUserStatus(baseUrl, session, userId, firstName, lastName, active) {
    const bodyStr = 'T_user_cmd=edit&T_user_id=' + userId + '&T_user_fn=' + firstName + '&T_user_ln=' + lastName + '&T_user_lang=0&T_user_a_yr=&T_user_a_month=&T_user_a_day=&T_user_a_hr=&T_user_a_min=&T_user_yr=&T_user_month=&T_user_day=&T_user_hr=&T_user_min=&T_user_en=' + (active ? 1 : 0) + '&T_user_program=0&T_user_ext_dly=0&T_user_o_anti=0&T_user_o_inter=0&T_user_can_arm=0&T_user_can_disarm=0';
    const encrypted = encryptBody(bodyStr, session.key);
    const resp = await httpRequest('POST', baseUrl + '/users_T_user.xml', encrypted, {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': session.cookie
    });
    console.log('setUserStatus response:', resp.body.substr(0, 100));
    return resp;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Routes ───────────────────────────────────────────────────────────────────
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
    console.log('Code genere - ' + roomKey + ' | PIN: ' + pin);
    res.json({ success: true, pin, room: roomKey, building: buildingKey });
});

app.post('/activate-code', async (req, res) => {
    if (!authenticate(req, res)) return;
    const { reservation_id } = req.body;
    if (!reservation_id) return res.status(400).json({ error: 'reservation_id requis' });
    const entry = pendingCodes[reservation_id];
    if (!entry) return res.status(404).json({ error: 'Aucun code en attente pour: ' + reservation_id });
    const building = BUILDINGS[entry.building];
    const roomConfig = building.rooms[entry.room];
    try {
        console.log('Activation - ' + entry.room + ' | PIN: ' + entry.pin);
        const session = await atriumLogin(building.atrium_url, building.atrium_user, building.atrium_pass);
        const userId = await atriumGetUserId(building.atrium_url, session, roomConfig.fn, roomConfig.ln);
        await atriumSetKeyCode(building.atrium_url, session, userId, entry.pin);
        await atriumSetUserStatus(building.atrium_url, session, userId, roomConfig.fn, roomConfig.ln, true);
        delete pendingCodes[reservation_id];
        console.log('Code active: ' + entry.pin + ' pour ' + entry.room);
        res.json({ success: true, room: entry.room, pin: entry.pin, guest: entry.guest_name });
    } catch (err) {
        console.error('Echec activation:', err.message);
        res.status(500).json({ success: false, error: err.message, room: entry.room, pin: entry.pin, guest: entry.guest_name });
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
    console.log('SABIMMO Atrium API v3 - Port ' + PORT + ' - Pret');
});
