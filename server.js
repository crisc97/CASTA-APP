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
cargarConfiguracion(); 

// ============================================================
// RUTAS 
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ping', (req, res) => res.send('ok'));

app.get('/api/canales', (req, res) => {
    res.json(frontendCanales);
});

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
// BOTS: COLA Y FUNCIONES INTELIGENTES
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
    // Inteligencia del bot: Determina si debe buscar botones o es directo
    const tieneBotones = datosCanal.opcionesBotones && datosCanal.opcionesBotones.length > 0;
    console.log(`🕵️ BOT: Scrapeando [${canalId}] | Modo: ${tieneBotones ? '🤖 Complejo (Con Clics)' : '⚡ Rápido (Sin clics)'}`);
    
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
            if (esStream(req.url()) && !linkVideoPuro) {
                linkVideoPuro = req.url();
                console.log(`✅ [${canalId}] Enlace capturado exitosamente.`);
            }
            req.continue();
        });

        // Cargamos la página
        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
        // Si el canal exige hacer clics (TV Libre), ejecutamos el bucle
        if (tieneBotones) {
            await new Promise(r => setTimeout(r, 1000));
            for (const variantes of datosCanal.opcionesBotones) {
                if (linkVideoPuro) break;
                const clicOk = await clickBotonPorVariantes(page, variantes);
                if (clicOk) {
                    let espera = 0;
                    while (!linkVideoPuro && espera < 50) { await new Promise(r => setTimeout(r, 100)); espera++; }
                }
            }
        } 
        
        // Si el video no arrancó solo (suele pasar en las listas nuevas), simulamos un clic en el centro de la pantalla
        if (!linkVideoPuro) {
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            let esperaExtra = 0;
            while (!linkVideoPuro && esperaExtra < 30) { await new Promise(r => setTimeout(r, 100)); esperaExtra++; }
        }
        
    } catch (e) {
        console.error(`❌ Error en el bot para ${canalId}:`, e.message);
    } finally {
        try { await browser.close(); } catch (e) {}
    }
    return linkVideoPuro;
}

// ============================================================
// API STREAM: REPRODUCTOR MAESTRO UNIVERSAL
// ============================================================
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    if (!datosCanal) return res.status(404).json({ exito: false, error: "Canal no encontrado en JSON" });

    try {
        let urlFinal = "";

        // CASO A: Es un link que requiere el BOT (URL web, reproductores HTML, TVLibre)
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            // 1. Revisar Caché para no abrir navegadores de más
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) { // 2 horas de caché
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }
            
            // 2. Mandar el Bot a trabajar
            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));
            
            if (linkVideoPuro) {
                // Siempre usamos proxy para los enlaces raspados para evitar bloqueos
                urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
            } else {
                return res.status(500).json({ exito: false, error: "No se pudo extraer el video de la página" });
            }
        } 
        
        // CASO B: Es un link de video puro DIRECTO (M3U8 o .ts)
        else if (datosCanal.base) {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            
            // Si le pusiste false, va directo al cliente. Si es true, pasa por el servidor.
            if (datosCanal.usarProxy === false) {
                urlFinal = urlCompleta; 
            } else {
                urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`;
            }
        } 
        
        else {
            return res.status(400).json({ exito: false, error: "El canal no tiene 'base' ni 'urlScraping' configurado" });
        }

        return res.json({ exito: true, url: urlFinal });

    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// ============================================================
// PROXY
// ============================================================
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