const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://casta-app.onrender.com';

// ============================================================
// CARGAR LISTA DE CANALES IPTV (JSON)
// ============================================================
let dbCanales = {};
let frontendCanales = [];

function cargarConfiguracion() {
    try {
        const rawData = fs.readFileSync(path.join(__dirname, 'config_canales.json'), 'utf8');
        const data = JSON.parse(rawData);
        dbCanales = data.backend || {};
        frontendCanales = data.frontend || [];
        console.log(`✅ Lista cargada: ${frontendCanales.length} canales.`);
    } catch (error) {
        console.error("❌ Error al leer config_canales.json:", error.message);
    }
}
cargarConfiguracion(); // Cargar al encender

// ============================================================
// RUTAS 
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ping', (req, res) => res.send('ok'));

// Ruta donde el index.html busca la lista de canales
app.get('/api/canales', (req, res) => {
    res.json(frontendCanales);
});

// Truco: Si editás el archivo JSON, entrá a tuweb.com/api/recargar-lista para actualizar sin reiniciar
app.get('/api/recargar-lista', (req, res) => {
    cargarConfiguracion();
    res.json({ exito: true, mensaje: "Lista recargada exitosamente" });
});

const memoriaCache = {};
app.get('/api/clear-cache/:canal', (req, res) => {
    const canalId = req.params.canal;
    if (memoriaCache[canalId]) delete memoriaCache[canalId];
    res.json({ ok: true });
});

// ============================================================
// BOTS: COLA Y FUNCIONES DE CLIC
// ============================================================
let botEnEjecucion = false;
const colaDeBots = [];

function ejecutarSiguienteBot() {
    if (botEnEjecucion || colaDeBots.length === 0) return;
    botEnEjecucion = true;
    const siguiente = colaDeBots.shift();
    siguiente();
}

function encolarBot(fn) {
    return new Promise((resolve, reject) => {
        colaDeBots.push(async () => {
            try { resolve(await fn()); } 
            catch (e) { reject(e); } 
            finally { botEnEjecucion = false; ejecutarSiguienteBot(); }
        });
        ejecutarSiguienteBot();
    });
}

// Función que le da "manos" al bot para que toque los botones
async function clickBotonPorVariantes(page, variantes) {
    try {
        return await page.evaluate((textos) => {
            const elementos = Array.from(document.querySelectorAll('button, a, span, div, li, p'));
            for (const texto of textos) {
                const el = elementos.find(e => (e.innerText || e.textContent || '').trim() === texto || (e.innerText || '').startsWith(texto));
                if (el) { el.click(); return texto; }
            }
            return null;
        }, variantes);
    } catch (e) { return null; }
}

function esStream(url) {
    return url ? (url.includes('.m3u8') || url.includes('.mpd')) : false;
}

async function correrBot(datosCanal, canalId) {
    console.log(`🕵️ BOT: Scrapeando ${canalId}`);
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    let linkVideoPuro = null;

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });
        await page.setRequestInterception(true);
        page.on('request', req => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) { req.abort(); return; }
            if (esStream(req.url()) && !linkVideoPuro) linkVideoPuro = req.url();
            req.continue();
        });

        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        await new Promise(r => setTimeout(r, 1000));
        for (const variantes of (datosCanal.opcionesBotones || [])) {
            if (linkVideoPuro) break;
            const clicOk = await clickBotonPorVariantes(page, variantes);
            if (clicOk) {
                let espera = 0;
                while (!linkVideoPuro && espera < 50) { await new Promise(r => setTimeout(r, 100)); espera++; }
            }
        }
        
        if (!linkVideoPuro) {
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            await new Promise(r => setTimeout(r, 3000));
        }
    } finally {
        try { await browser.close(); } catch (e) {}
    }
    return linkVideoPuro;
}

// ============================================================
// API STREAM Y PROXY IPTV
// ============================================================
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    if (!datosCanal) return res.status(404).json({ exito: false });

    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }
            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));
            if (linkVideoPuro) {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                return res.json({ exito: true, url: urlFinal });
            }
            return res.status(500).json({ exito: false });
        }

        const separador = datosCanal.parametros ? '?' : '';
        const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
        
        if (datosCanal.usarProxy) {
            return res.json({ exito: true, url: `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}` });
        }
        return res.json({ exito: true, url: urlCompleta });
    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

function armarHeaders(targetUrl) {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'Accept': '*/*', 'Connection': 'keep-alive', 'Accept-Encoding': 'identity', 'Origin': '*', 'Referer': targetUrl
    };
}

app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta URL');

    try {
        const headers = armarHeaders(targetUrl);
        if (req.headers.range) headers['Range'] = req.headers.range;

        const response = await axios({
            method: 'GET', url: targetUrl, responseType: 'stream', headers, timeout: 20000,
            validateStatus: status => status >= 200 && status < 500
        });

        const contentType = response.headers['content-type'] || '';

        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || contentType.includes('dash+xml')) {
            let data = '';
            response.data.on('data', chunk => data += chunk);
            response.data.on('end', () => {
                if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
                    let contenido = data.split('\n').map(linea => {
                        let l = linea.trim();
                        if (!l) return linea;

                        if (l.includes('URI="')) {
                            return l.replace(/URI="([^"]+)"/, (match, p1) => {
                                try {
                                    const urlAbsoluta = new URL(p1, targetUrl).href;
                                    return `URI="${API_URL}/proxy/stream?url=${encodeURIComponent(urlAbsoluta)}"`;
                                } catch(e) { return match; }
                            });
                        }
                        if (l.startsWith('#')) return l;
                        try {
                            const urlSegmento = new URL(l, targetUrl).href;
                            return `${API_URL}/proxy/stream?url=${encodeURIComponent(urlSegmento)}`;
                        } catch (e) { return l; }
                    }).join('\n');

                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.send(contenido);
                } else {
                    res.setHeader('Content-Type', 'application/dash+xml');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.send(data);
                }
            });
            return;
        }

        res.setHeader('Content-Type', contentType || 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.status === 206) res.status(206);

        req.on('close', () => { try { if (!response.data.destroyed) response.data.destroy(); } catch (e) {} });
        response.data.pipe(res);
    } catch (err) {
        if (!res.headersSent) res.status(500).json({ exito: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    setInterval(async () => { try { await axios.get(`${API_URL}/ping`); } catch (e) {} }, 14 * 60 * 1000);
});