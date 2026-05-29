const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/logos_canales', express.static(path.join(__dirname, 'logos_canales')));

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://casta-app.onrender.com';

// ============================================================
// CONFIGURACIÓN DE LISTAS EXTERNAS (EL TRUCO AVANZADO)
// ============================================================
const URLS_EXTERNAS = [
    { id: 'tvlibre_2', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/TVLIBRE-2.json', categoria: 'CineCity TV Libre' },
    { id: 'canales_m3u8', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/Canales_m3u8.json', categoria: 'Canales M3U8 Directos' },
    { id: 'pluto_tv', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/Pluto-TV.json', categoria: 'Pluto TV (CineCity)' },
    { id: 'claro_video', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/clarovideo.json', categoria: 'Claro Video' },
    { id: 'futbol_libre', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/futbol-libre.json', categoria: 'Fútbol Libre Eventos' },
    { id: 'bola_loca', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/BolaLoca.json', categoria: 'Bola Loca Deportes' },
    { id: 'ddeports', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/ddeports.json', categoria: 'DDeports Agenda' },
    { id: 'coin_tv', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/CoinTV.json', categoria: 'Coin TV' },
    { id: 'cine_2026', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/Cine_2026.json', categoria: 'Cine 2026' },
    { id: 'peliculas_hd', url: 'https://raw.githubusercontent.com/CINECITY2023/cinecity/refs/heads/cinecity.net/scripts-album/Peliculas_HD.json', categoria: 'Películas HD' }
];

let dbCanales = {};
let frontendCanales = [];

// Función para orquestar la carga total
async function inicializarBaseDeDatos() {
    try {
        console.log("-------------------------------------------------------");
        console.log("⚙️ Cargando configuración local (config_canales.json)...");
        
        const rawData = fs.readFileSync(path.join(__dirname, 'config_canales.json'), 'utf8');
        const data = JSON.parse(rawData);
        dbCanales = data.backend || {};
        frontendCanales = data.frontend || [];
        console.log(`✅ Base local cargada: ${frontendCanales.length} canales principales.`);

        await cargarListasExternas();
        console.log("-------------------------------------------------------");
    } catch (error) {
        console.error("❌ Error general al inicializar base de datos:", error.message);
    }
}

// Adaptador flexible para procesar listas dinámicas
async function cargarListasExternas() {
    console.log("🔄 Conectando con los repositorios remotos de GitHub...");
    
    for (const lista of URLS_EXTERNAS) {
        try {
            const response = await axios.get(lista.url, { timeout: 12000 });
            let datos = response.data;

            if (typeof datos === 'string') {
                datos = JSON.parse(datos);
            }

            let items = [];
            if (Array.isArray(datos)) {
                items = datos;
            } else if (datos && typeof datos === 'object') {
                const claveArray = Object.keys(datos).find(k => Array.isArray(datos[k]));
                if (claveArray) items = datos[claveArray];
            }

            if (items.length === 0) continue;

            items.forEach((item, index) => {
                const nombre = item.name || item.title || item.nombre || item.label || `${lista.id} - Item ${index + 1}`;
                const urlVideo = item.link || item.url || item.enlace || item.file || item.stream;
                const logoItem = item.logo || item.image || item.img || item.thumbnail || "";

                if (!urlVideo) return; 

                const idUnico = `ext_${lista.id}_${index}`;
                const requiereScraping = lista.id === 'futbol_libre' || lista.id === 'bola_loca' || lista.id === 'ddeports' || urlVideo.toLowerCase().includes('html');

                if (requiereScraping) {
                    dbCanales[idUnico] = {
                        urlScraping: urlVideo,
                        opcionesBotones: [["Opción 1"], ["Opción 2"], ["Reproducir"], ["VIVO"]]
                    };
                } else {
                    // FILTRO ULTRA-SEGURO: Si la URL directa contiene .mpd, usarProxy pasa a ser FALSE automáticamente
                    const esMpd = urlVideo.toLowerCase().includes('.mpd');
                    const esPluto = urlVideo.toLowerCase().includes('pluto.tv') || urlVideo.toLowerCase().includes('plutotv');

                    dbCanales[idUnico] = {
                        base: urlVideo,
                        parametros: "",
                        usarProxy: !esPluto && !esMpd
                    };
                }

                frontendCanales.push({
                    nombre: nombre,
                    categoria: lista.categoria,
                    logo: logoItem.startsWith('http') ? logoItem : `${API_URL}/logos_canales/cinecity.png`,
                    opciones: [{ nombre: "Reproducir", id: idUnico }]
                });
            });

            console.log(`📦 Lista [${lista.categoria}] sincronizada. +${items.length} elementos añadidos.`);
        } catch (err) {
            console.error(`⚠️ No se pudo sincronizar la lista externa [${lista.categoria}]:`, err.message);
        }
    }
}

inicializarBaseDeDatos();

// ============================================================
// RUTAS BÁSICAS Y FRONTEND
// ============================================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/ping', (req, res) => res.send('ok'));

app.get('/api/canales', (req, res) => {
    res.json(frontendCanales);
});

app.get('/api/clear-cache/:canal', (req, res) => {
    const canalId = req.params.canal;
    if (memoriaCache[canalId]) {
        delete memoriaCache[canalId];
        console.log(`🗑️ Caché borrada para: ${canalId}`);
    }
    res.json({ ok: true });
});

// ============================================================
// 📄 GENERADOR DE LISTA M3U DINÁMICA
// ============================================================
app.get('/lista.m3u', (req, res) => {
    let m3u = "#EXTM3U\n\n";
    frontendCanales.forEach(canal => {
        const categoria = canal.categoria || "General";
        let logo = "";
        if (canal.logo) {
            logo = canal.logo.startsWith('http') ? canal.logo : `${API_URL}/${canal.logo}`;
        }
        canal.opciones.forEach((opcion) => {
            m3u += `#EXTINF:-1 tvg-logo="${logo}" group-title="${categoria}", ${canal.nombre} (${opcion.nombre})\n`;
            m3u += `${API_URL}/play/${opcion.id}\n\n`;
        });
    });
    res.setHeader('Content-Type', 'audio/x-mpegurl; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="canales.m3u"');
    res.send(m3u);
});

const memoriaCache = {};

// ============================================================
// 🧠 COLA DE BOTS
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
            try {
                const resultado = await fn();
                resolve(resultado);
            } catch (e) {
                reject(e);
            } finally {
                botEnEjecucion = false;
                if (global.gc) global.gc();
                ejecutarSiguienteBot();
            }
        });
        ejecutarSiguienteBot();
    });
}

function esStream(url) {
    if (!url || url === 'about:blank' || url === 'about:srcdoc') return false;
    const basura = ['ad', 'tracker', 'dummy', 'blank', 'pixel'];
    if (basura.some(palabra => url.toLowerCase().includes(palabra))) return false;
    return url.includes('.m3u8') || url.includes('.mpd');
}

function armarHeaders(targetUrl) {
    if (targetUrl.includes('latinapro.net') || targetUrl.includes('45.5.151.147')) {
        return {
            'User-Agent': 'bocatvplay.beta/9.8 (Linux;Android 11) AndroidXMedia3/1.1.1',
            'Referer': '', 
            'Connection': 'keep-alive'
        };
    }
    let referer = 'https://tvlibr3.com/';
    let origin = 'https://tvlibr3.com';

    if (targetUrl.includes('streameasthd') || targetUrl.includes('streamtpnew')) {
        referer = 'https://streamtpnew.com/';
        origin = 'https://streamtpnew.com';
    } else if (targetUrl.includes('nebunexa') || targetUrl.includes('cvattv')) {
        referer = 'https://pcn.nebunexa.life/';
        origin = 'https://pcn.nebunexa.life';
    } else if (targetUrl.includes('pelotalibretv')) {
        referer = 'https://pelotalibretv.su/';
        origin = 'https://pelotalibretv.su';
    }

    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Referer': referer,
        'Origin': origin,
        'Accept': '*/*',
        'Accept-Language': 'es-AR,es;q=0.9',
        'Connection': 'keep-alive',
    };
}

// ============================================================
// SÚPER PROXY INTELIGENTE
// ============================================================
app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta el parámetro url');

    const headers = armarHeaders(targetUrl);
    headers['Accept-Encoding'] = 'identity';

    if (req.headers.range) headers['Range'] = req.headers.range;

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream', 
            headers,
            timeout: 15000,
            validateStatus: (status) => status >= 200 && status < 400
        });

        const contentType = response.headers['content-type'] || '';

        if (targetUrl.includes('.m3u8') || targetUrl.includes('.mpd') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || contentType.includes('dash+xml')) {
            let data = '';
            response.data.on('data', chunk => data += chunk);
            response.data.on('end', () => {
                if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
                    let contenido = data.split('\n').map(linea => {
                        const l = linea.trim();
                        if (!l) return linea;

                        if (l.startsWith('#EXT-X-KEY')) {
                            const match = l.match(/URI="([^"]+)"/);
                            if (match) {
                                try {
                                    const keyUrl = new URL(match[1], targetUrl).href;
                                    const proxyKeyUrl = `${API_URL}/proxy/stream?url=${encodeURIComponent(keyUrl)}`;
                                    return l.replace(`URI="${match[1]}"`, `URI="${proxyKeyUrl}"`);
                                } catch(e) {}
                            }
                            return l;
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
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Accept-Ranges', 'bytes');
        
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        if (response.status === 206) res.status(206);

        req.on('close', () => {
            if (!response.data.destroyed) response.data.destroy();
        });

        response.data.pipe(res);

    } catch (err) {
        if (!res.headersSent) res.status(502).send('Error al obtener el stream');
    }
});

// ============================================================
// FUNCIONES BOT Y SCRAPING
// ============================================================
async function clickBotonPorVariantes(page, variantes) {
    try {
        return await page.evaluate((textos) => {
            const elementos = Array.from(document.querySelectorAll('button, a, span, div, li, p'));
            for (const texto of textos) {
                const el = elementos.find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t === texto || t.startsWith(texto);
                });
                if (el) {
                    el.click();
                    return texto;
                }
            }
            return null;
        }, variantes);
    } catch (e) { return null; }
}

async function correrBot(datosCanal, canalId) {
    console.log(`🕵️‍♂️ Bot iniciando para: ${canalId}...`);
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-gpu', '--single-process', '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    let linkVideoPuro = null;

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const tipo = req.resourceType();
            const urlReq = req.url().toLowerCase();
            
            if (['image', 'stylesheet', 'font', 'media'].includes(tipo) || urlReq.includes('ads') || urlReq.includes('analytics')) { 
                req.abort(); 
                return; 
            }
            if (esStream(urlReq) && !linkVideoPuro) linkVideoPuro = req.url(); 
            req.continue();
        });

        page.on('response', async (response) => {
            const urlRespuesta = response.url().toLowerCase();
            if (esStream(urlRespuesta) && !urlRespuesta.includes('ad') && !linkVideoPuro) linkVideoPuro = response.url(); 
        });

        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 500));

        for (const variantes of (datosCanal.opcionesBotones || [])) {
            if (linkVideoPuro) break;
            const clicOk = await clickBotonPorVariantes(page, variantes);
            if (clicOk) {
                let espera = 0;
                while (!linkVideoPuro && espera < 30) { await new Promise(r => setTimeout(r, 100)); espera++; }
            }
        }

        if (!linkVideoPuro) {
            const viewport = page.viewport();
            const frames = page.frames();
            for (const frame of frames) {
                if (linkVideoPuro) break;
                try {
                    await frame.click('body', { delay: 50 });
                    await new Promise(r => setTimeout(r, 100));
                } catch (e) {}
            }
            for (let i = 0; i < 4; i++) {
                if (linkVideoPuro) break; 
                await page.mouse.click(viewport.width / 2, viewport.height / 2);
                await page.keyboard.press('Space');
                await page.keyboard.press('Enter');
                await new Promise(r => setTimeout(r, 400)); 
            }
        }
    } catch (e) {
        console.error(`❌ Error bot:`, e.message);
    } finally {
        try { await browser.close(); } catch (e) {}
    }
    return linkVideoPuro;
}

// ============================================================
// RUTA PARA LA APP (COMPATIBILIDAD INDEX.HTML)
// ============================================================
app.get(['/api/get-stream/:canal', '/api/stream/:canal'], async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];

    if (!datosCanal) return res.status(404).json({ exito: false, mensaje: "Canal no encontrado" });

    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }

            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));

            if (linkVideoPuro) {
                // BYPASS DINÁMICO EN BOT: Si el bot extrajo un .mpd, se lo mandamos directo al celu
                const esMpdDescubierto = linkVideoPuro.toLowerCase().includes('.mpd');
                const urlFinal = esMpdDescubierto 
                    ? linkVideoPuro 
                    : `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;

                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                return res.json({ exito: true, url: urlFinal });
            } else {
                return res.status(500).json({ exito: false, mensaje: "El bot no encontró ningún stream." });
            }
        } else {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            
            if (datosCanal.usarProxy) {
                return res.json({ exito: true, url: `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}` });
            }
            return res.json({ exito: true, url: urlCompleta });
        }
    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// ============================================================
// RUTA DE REPRODUCCIÓN DIRECTA M3U (REDIRECT 302)
// ============================================================
app.get('/play/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];

    if (!datosCanal) return res.status(404).send("Error: Canal no encontrado.");

    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                return res.redirect(302, memoriaCache[canalId].url);
            }

            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));

            if (linkVideoPuro) {
                const esMpdDescubierto = linkVideoPuro.toLowerCase().includes('.mpd');
                const urlFinal = esMpdDescubierto 
                    ? linkVideoPuro 
                    : `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;

                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                return res.redirect(302, urlFinal);
            } else {
                return res.status(500).send("Error: El bot no encontró ningún stream.");
            }
        } else {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            
            if (datosCanal.usarProxy) {
                return res.redirect(302, `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`);
            }
            return res.redirect(302, urlCompleta);
        }
    } catch (error) {
        return res.status(500).send(`Error: ${error.message}`);
    }
});

// --- ENCENDIDO ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Casta-App corriendo en el puerto ${PORT}`);
    
    setInterval(async () => {
        try { await axios.get(`${API_URL}/ping`); } catch (e) {}
    }, 14 * 60 * 1000);

    setInterval(async () => {
        console.log("🕒 Ejecutando Auto-Refresh programado de listas de GitHub...");
        await inicializarBaseDeDatos();
    }, 3 * 60 * 60 * 1000);
});