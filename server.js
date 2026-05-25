const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();

// ============================================================
// 🔥 SOLUCIÓN CORS GLOBAL
// ============================================================
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200); // Responder OK rápido a las verificaciones del navegador
    }
    next();
});
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
        console.log(`✅ Lista cargada: ${frontendCanales.length} canales frontend, ${Object.keys(dbCanales).length} backend.`);
    } catch (error) {
        console.error("❌ Error al leer config_canales.json:", error.message);
    }
}
cargarConfiguracion();

// ============================================================
// CONVERTIDOR M3U A JSON (PARSER)
// ============================================================
function parsearM3U(contenidoM3U) {
    const lineas = contenidoM3U.split('\n');
    const canales = [];
    let canalActual = {};

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        if (linea.startsWith('#EXTINF:')) {
            canalActual = {};
            const partes = linea.split(',');
            canalActual.nombre = partes.length > 1 ? partes.pop().trim() : "Canal Desconocido";
            const logoMatch = linea.match(/tvg-logo="([^"]+)"/);
            canalActual.logo = logoMatch ? logoMatch[1] : "logos_canales/default.png";
            const grupoMatch = linea.match(/group-title="([^"]+)"/);
            canalActual.categoria = grupoMatch ? grupoMatch[1] : "General";
        } else if (linea && !linea.startsWith('#')) {
            canalActual.url = linea;
            if (canalActual.nombre && canalActual.url) canales.push({ ...canalActual });
        }
    }
    return canales;
}

// ============================================================
// RUTAS BASE
// ============================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use(express.static(path.join(__dirname)));
app.get('/ping', (req, res) => res.send('ok'));
app.get('/api/canales', (req, res) => res.json(frontendCanales));
app.get('/api/recargar-lista', (req, res) => {
    cargarConfiguracion();
    res.json({ exito: true, mensaje: "Lista recargada exitosamente" });
});

const memoriaCache = {};
app.get('/api/clear-cache/:canal', (req, res) => {
    const canalId = req.params.canal;
    if (memoriaCache[canalId]) delete memoriaCache[canalId];
    console.log(`🗑️ Caché borrada para: ${canalId}`);
    res.json({ ok: true });
});

// ============================================================
// BOTS: COLA Y FUNCIONES
// ============================================================
let botEnEjecucion = false;
const colaDeBots = [];

function ejecutarSiguienteBot() {
    if (botEnEjecucion || colaDeBots.length === 0) return;
    botEnEjecucion = true;
    colaDeBots.shift()();
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
                const el = elementos.find(e => {
                    const t = (e.innerText || e.textContent || '').trim();
                    return t === texto || t.startsWith(texto);
                });
                if (el) { el.click(); return texto; }
            }
            return null;
        }, variantes);
    } catch (e) { return null; }
}

function esStream(url) {
    if (!url || url === 'about:blank') return false;
    return url.includes('.m3u8') || url.includes('.mpd');
}

async function correrBot(datosCanal, canalId) {
    const tieneBotones = datosCanal.opcionesBotones && datosCanal.opcionesBotones.length > 0;
    console.log(`🕵️ BOT: Scrapeando [${canalId}] | Modo: ${tieneBotones ? '🤖 Complejo (Con Clics)' : '⚡ Rápido (Sin clics)'}`);
    
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });
    let linkVideoPuro = null;

    try {
        const page = await browser.newPage();
        
        // 🔥 TRUCO 1: Máscara humana (User-Agent falso) y pantalla de PC real
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });
        
        await page.setRequestInterception(true);
        
        page.on('request', req => {
            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) { req.abort(); return; }
            
            if (esStream(req.url()) && !linkVideoPuro) {
                // 🔥 TRUCO 2: Ignorar los videos falsos de advertencias o publicidades
                const urlDetectada = req.url().toLowerCase();
                if (!urlDetectada.includes('aviso') && !urlDetectada.includes('extension') && !urlDetectada.includes('dummy') && !urlDetectada.includes('blank')) {
                    linkVideoPuro = req.url();
                    console.log(`✅ [${canalId}] Enlace capturado exitosamente.`);
                } else {
                    console.log(`⚠️ [${canalId}] Se ignoró un video falso/publicidad: ${urlDetectada.substring(0, 40)}...`);
                }
            }
            req.continue();
        });

        // Cargamos la página
        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 60000 });
        
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
        
        if (!linkVideoPuro) {
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            let esperaExtra = 0;
            while (!linkVideoPuro && esperaExtra < 30) { await new Promise(r => setTimeout(r, 100)); esperaExtra++; }
        }
        
   } catch (e) {
        console.error(`❌ Error en el bot para ${canalId}:`, e.message);
    } finally {
        // Esto es VITAL para que Render no se quede sin memoria y tire Error 502
        try { 
            if (browser) {
                const pages = await browser.pages();
                for (let i = 0; i < pages.length; i++) await pages[i].close();
                await browser.close(); 
            }
        } catch (e) {}
    }
    
    return linkVideoPuro;
}

// ============================================================
// OBTENER STREAM FINAL DEL CANAL
// ============================================================
app.get('/api/get-stream/:id', async (req, res) => {
    // 🔥 Asegurar que tu frontend accede sin problemas (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    const canalId = req.params.id;
    // 🔥 CORRECCIÓN: Se usa dbCanales que es donde se carga tu config dinámica
    const canal = dbCanales[canalId];

    if (!canal) {
        return res.status(404).send('Canal no encontrado');
    }

    try {
        let urlFinal = '';

        if (canal.urlDirecta) {
            urlFinal = canal.urlDirecta;
        } else {
            // Si es un bot, corre el scraper para sacar la URL fresca
            urlFinal = await correrBot(canal, canalId);
        }

        if (!urlFinal) {
            return res.status(500).send('No se pudo obtener el enlace del stream');
        }

        // 🔥 Si NO usa proxy, redirigimos directamente (esquiva el consumo de RAM en Render)
        if (canal.usarProxy === false) {
            return res.redirect(urlFinal);
        }

        // 🔥 Si SÍ usa proxy, hacemos el puente con la cañería fluida (.pipe)
        const respuestaStream = await axios({
            method: 'get',
            url: urlFinal,
            responseType: 'stream',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Referer': new URL(urlFinal).origin
            }
        });

        res.setHeader('Content-Type', respuestaStream.headers['content-type'] || 'application/x-mpegURL');
        respuestaStream.data.pipe(res);

        respuestaStream.data.on('error', (err) => {
            console.error(`Error en la transmisión del stream ${canalId}:`, err.message);
            if (!res.headersSent) res.status(500).send('Error en la transmisión');
        });

    } catch (error) {
        console.error(`Error en el proxy de ${canalId}:`, error.message);
        if (!res.headersSent) res.status(500).send('Error al conectar con el origen');
    }
});

// ============================================================
// CONVERTIDORES M3U / JSON
// ============================================================
app.post('/api/convertir-m3u', express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
        const contenidoM3U = req.body;
        if (!contenidoM3U || !contenidoM3U.includes('#EXTM3U'))
            return res.status(400).json({ exito: false, error: "No es un M3U válido." });

        const canalesExtraidos = parsearM3U(contenidoM3U);
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `m3u_canal_${index}`;
            nuevoFrontend.push({ nombre: canal.nombre, categoria: canal.categoria, logo: canal.logo, opciones: [{ nombre: "Opción 1", id: idGenerado }] });
            nuevoBackend[idGenerado] = { base: canal.url, parametros: "", usarProxy: false };
        });

        res.json({ exito: true, total_canales: canalesExtraidos.length, estructura_generada: { frontend: nuevoFrontend, backend: nuevoBackend } });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

app.post('/api/convertir-m3u-url', async (req, res) => {
    try {
        const urlM3U = req.body.url;
        if (!urlM3U) return res.status(400).json({ exito: false, error: "Falta la URL." });

        const respuesta = await axios.get(urlM3U, { timeout: 15000 });
        const contenidoM3U = respuesta.data;

        if (!contenidoM3U || typeof contenidoM3U !== 'string' || !contenidoM3U.includes('#EXTM3U'))
            return res.status(400).json({ exito: false, error: "El enlace no devuelve un M3U válido." });

        const canalesExtraidos = parsearM3U(contenidoM3U);
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `link_${Date.now()}_${index}`;
            nuevoFrontend.push({ nombre: canal.nombre, categoria: canal.categoria, logo: canal.logo, opciones: [{ nombre: "Opción 1", id: idGenerado }] });
            nuevoBackend[idGenerado] = { base: canal.url, parametros: "", usarProxy: false };
        });

        res.json({ exito: true, total_canales: canalesExtraidos.length, estructura_generada: { frontend: nuevoFrontend, backend: nuevoBackend } });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

app.post('/api/convertir-json-url', async (req, res) => {
    try {
        const urlJson = req.body.url;
        if (!urlJson) return res.status(400).json({ exito: false, error: "Falta la URL." });

        const respuesta = await axios.get(urlJson, { timeout: 15000 });
        let datos = respuesta.data;

        let canalesExtraidos = [];
        if (Array.isArray(datos)) canalesExtraidos = datos;
        else if (datos.channels) canalesExtraidos = datos.channels;
        else if (datos.canales) canalesExtraidos = datos.canales;
        else return res.status(400).json({ exito: false, error: "No se encontró lista de canales en este JSON." });

        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `json_${Date.now()}_${index}`;
            const nombreCanal = canal.name || canal.nombre || canal.title || "Canal Desconocido";
            const categoriaCanal = canal.group || canal.categoria || canal.category || "General";
            const logoCanal = canal.logo || canal.icon || canal.imagen || "";
            const urlCanal = canal.url || canal.link || canal.stream || "";

            if (urlCanal) {
                nuevoFrontend.push({ nombre: nombreCanal, categoria: categoriaCanal, logo: logoCanal, opciones: [{ nombre: "Opción 1", id: idGenerado }] });
                nuevoBackend[idGenerado] = { base: urlCanal, parametros: "", usarProxy: false };
            }
        });

        res.json({ exito: true, total_canales: nuevoFrontend.length, estructura_generada: { frontend: nuevoFrontend, backend: nuevoBackend } });
    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

// ============================================================
// PROXY MEJORADO
// ============================================================
function armarHeaders(targetUrl) {
    if (targetUrl.includes('45.5.151.147') || targetUrl.includes('latinapro')) {
        return {
            'User-Agent': 'okhttp/4.9.0',
            'Accept': '*/*',
            'Connection': 'keep-alive'
        };
    }

    let referer = 'https://tvlibre-online.com/';
    let origin = 'https://tvlibre-online.com';

    if (targetUrl.includes('streameasthd') || targetUrl.includes('streamtpnew')) {
        referer = 'https://streamtpnew.com/';
        origin = 'https://streamtpnew.com';
    } else if (targetUrl.includes('nebunexa') || targetUrl.includes('cvattv') || targetUrl.includes('bestleague')) {
        referer = 'https://pcn.nebunexa.life/';
        origin = 'https://pcn.nebunexa.life';
    }

    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
        'Referer': referer,
        'Origin': origin,
        'Accept': '*/*',
        'Connection': 'keep-alive',
        'Accept-Encoding': 'identity'
    };
}

app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta URL');

    const headers = armarHeaders(targetUrl);
    if (req.headers.range) headers['Range'] = req.headers.range;

    const esPlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('.mpd');

    try {
        if (esPlaylist) {
            const response = await axios.get(targetUrl, {
                responseType: 'text',
                headers,
                timeout: 15000,
                maxRedirects: 10,
                validateStatus: s => s >= 200 && s < 400
            });

            console.log(`🔀 Proxy HTTP ${response.status}: ${targetUrl} [playlist]`);

            if (targetUrl.includes('.m3u8')) {
                const contenido = response.data.split('\n').map(linea => {
                    const l = linea.trim();
                    if (!l) return linea;

                    if (l.includes('URI="')) {
                        return l.replace(/URI="([^"]+)"/, (match, p1) => {
                            try {
                                const urlAbs = new URL(p1, targetUrl).href;
                                return `URI="${API_URL}/proxy/stream?url=${encodeURIComponent(urlAbs)}"`;
                            } catch (e) { return match; }
                        });
                    }

                    if (l.startsWith('#')) return linea;

                    try {
                        const urlSegmento = new URL(l, targetUrl).href;
                        return `${API_URL}/proxy/stream?url=${encodeURIComponent(urlSegmento)}`;
                    } catch (e) { return linea; }
                }).join('\n');

                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(contenido);
            } else {
                res.setHeader('Content-Type', 'application/dash+xml');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(response.data);
            }

        } else {
            const response = await axios.get(targetUrl, {
                responseType: 'stream',
                headers,
                timeout: 30000,
                maxRedirects: 10,
                validateStatus: s => s >= 200 && s < 400
            });

            const contentType = response.headers['content-type'] || 'video/mp2t';
            console.log(`🔀 Proxy HTTP ${response.status}: ${targetUrl} [${contentType.split(';')[0]}]`);

            res.setHeader('Content-Type', contentType);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Accept-Ranges', 'bytes');
            if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
            if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
            if (response.status === 206) res.status(206);

            req.on('close', () => { try { if (!response.data.destroyed) response.data.destroy(); } catch (e) {} });
            response.data.pipe(res);
        }

    } catch (err) {
        console.error(`❌ Proxy error [${targetUrl.substring(0, 80)}...]: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Error al obtener el stream');
    }
});

// ============================================================
// GUÍA EPG
// ============================================================
let guiaTV = {};

async function actualizarEPG() {
    console.log("⏳ Descargando EPG...");
    try {
        const { data } = await axios.get('https://raw.githubusercontent.com/globetvapp/epg/main/Argentina/argentina1.xml', { timeout: 30000 });
        const programas = data.split('<programme');
        guiaTV = {};

        for (let i = 1; i < programas.length; i++) {
            const bloque = programas[i];
            const canalMatch = bloque.match(/channel="([^"]+)"/);
            const startMatch = bloque.match(/start="([^\s]+) /);
            const stopMatch = bloque.match(/stop="([^\s]+) /);
            const titleMatch = bloque.match(/<title[^>]*>([^<]+)<\/title>/);

            if (canalMatch && startMatch && stopMatch && titleMatch) {
                const idCanal = canalMatch[1];
                const formatearHora = (s) => `${s.substring(8, 10)}:${s.substring(10, 12)}`;
                if (!guiaTV[idCanal]) guiaTV[idCanal] = [];
                guiaTV[idCanal].push({
                    inicio: startMatch[1],
                    horario: `${formatearHora(startMatch[1])} - ${formatearHora(stopMatch[1])}`,
                    titulo: titleMatch[1]
                });
            }
        }
        console.log("✅ EPG actualizada.");
    } catch (error) {
        console.log("⚠️ EPG no disponible:", error.message);
    }
}

actualizarEPG();
setInterval(actualizarEPG, 12 * 60 * 60 * 1000);

app.get('/api/epg/:canalId', (req, res) => {
    try {
        const idApp = req.params.canalId.toLowerCase();
        const diccionario = {
            "telefe": ["telefe"], "eltrece": ["eltrece", "trece", "canal13"],
            "elnueve": ["elnueve", "nueve", "canal9"], "america": ["america"],
            "tvpublica": ["publica", "tvp"], "espn_premium": ["espnpremium"],
            "espn": ["espn"], "tnt": ["tntsports"], "fox": ["foxsports"],
            "tyc": ["tyc"], "dsports": ["dsports", "directv"],
            "ciudad": ["ciudadmagazine", "ciudad"], "discovery": ["discovery"]
        };

        let palabrasClave = [idApp.split('_')[0]];
        for (const key in diccionario) {
            if (idApp.includes(key)) { palabrasClave = diccionario[key]; break; }
        }

        const idCanalXML = Object.keys(guiaTV).find(clave =>
            palabrasClave.some(p => clave.toLowerCase().includes(p))
        );

        if (idCanalXML && guiaTV[idCanalXML]) {
            const programas = guiaTV[idCanalXML];
            const fechaAr = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Argentina/Buenos_Aires" }));
            const año = fechaAr.getFullYear();
            const mes = String(fechaAr.getMonth() + 1).padStart(2, '0');
            const dia = String(fechaAr.getDate()).padStart(2, '0');
            const hora = String(fechaAr.getHours()).padStart(2, '0');
            const min = String(fechaAr.getMinutes()).padStart(2, '0');
            const ahoraNum = parseInt(`${año}${mes}${dia}${hora}${min}00`);

            for (let i = 0; i < programas.length; i++) {
                const progInicio = parseInt(programas[i].inicio);
                const progFin = programas[i + 1] ? parseInt(programas[i + 1].inicio) : progInicio + 20000;
                if (ahoraNum >= progInicio && ahoraNum < progFin) {
                    return res.json({
                        exito: true,
                        ahora: programas[i],
                        siguiente: programas[i + 1] || { titulo: "Continuación", horario: "--:--" }
                    });
                }
            }
        }
        res.json({ exito: false });
    } catch (error) {
        res.json({ exito: false });
    }
});

// ============================================================
// ARRANQUE
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    setInterval(async () => {
        try { await axios.get(`${API_URL}/ping`); console.log('🏓 Ping OK'); }
        catch (e) { console.log('⚠️ Ping fallido'); }
    }, 14 * 60 * 1000);
});