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
            if (canalActual.nombre && canalActual.url) {
                canales.push({ ...canalActual });
            }
        }
    }
    return canales;
}

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
    const tieneBotones = datosCanal.opcionesBotones && datosCanal.opcionesBotones.length > 0;
    
   // 🛑 MAGIA ANTI-RAM Y ANTI-BLOQUEOS
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-gpu',
            '--single-process',
            // --- NUEVOS ATAQUES ---
            '--disable-web-security', // Rompe el bloqueo de iframes
            '--disable-features=IsolateOrigins,site-per-process', // Permite clics cruzados
            '--blink-settings=imagesEnabled=false' // Corta las imágenes desde la raíz
        ]
    });
    
    let linkVideoPuro = null;

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });
        
        // ACÁ LE PONEMOS LA MÁSCARA AL BOT
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        
        // 🛑 MAGIA ANTI-RAM Y MODO TURBO RED
        await page.setRequestInterception(true);
        page.on('request', req => {
            const tipo = req.resourceType();
            const urlReq = req.url().toLowerCase();
            
            // Bloqueamos imágenes, CSS, fuentes y además agregamos basuras de "ads" o "analytics"
            if (['image', 'stylesheet', 'font', 'media'].includes(tipo) || urlReq.includes('ads') || urlReq.includes('analytics')) { 
                req.abort(); 
                return; 
            }
            if (esStream(urlReq) && !linkVideoPuro) {
                linkVideoPuro = req.url(); // Guardamos el original
            }
            req.continue();
        });

        // 🕵️‍♂️ ESPÍA EN LA RESPUESTA (A veces el video no lo pide la página, se lo mandan por detrás)
        page.on('response', async (response) => {
            const urlRespuesta = response.url().toLowerCase();
            if (esStream(urlRespuesta) && !urlRespuesta.includes('ad') && !linkVideoPuro) {
                linkVideoPuro = response.url(); // Lo atrapamos en el aire
            }
        });

        // Bajamos el timeout de 60s a 30s. ¡Si en 30s no cargó, no sirve!
        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        if (tieneBotones) {
            await new Promise(r => setTimeout(r, 500)); // Esperamos medio segundo en vez de uno
            for (const variantes of datosCanal.opcionesBotones) {
                if (linkVideoPuro) break;
                const clicOk = await clickBotonPorVariantes(page, variantes);
                if (clicOk) {
                    let espera = 0;
                    // Espera rápida mientras chequea si apareció el link
                    while (!linkVideoPuro && espera < 30) { await new Promise(r => setTimeout(r, 100)); espera++; }
                }
            }
        } 
        
        // 🥊 ATAQUE DE IFRAMES Y CLICS NINJA (Ideal para PelotaLibre)
        if (!linkVideoPuro) {
            const viewport = page.viewport();
            
            // 1. Buscamos Iframes y les hacemos clic
            const frames = page.frames();
            for (const frame of frames) {
                if (linkVideoPuro) break;
                try {
                    await frame.click('body', { delay: 50 });
                    await new Promise(r => setTimeout(r, 100));
                } catch (e) {
                    // Si el iframe está bloqueado, lo ignoramos y pasamos al siguiente
                }
            }

            // 2. Hacemos clics rápidos en el centro para romper publicidades invisibles
            for (let i = 0; i < 4; i++) {
                if (linkVideoPuro) break; 
                await page.mouse.click(viewport.width / 2, viewport.height / 2);
                await new Promise(r => setTimeout(r, 400)); // Pausas más cortitas
            }
            
            let esperaExtra = 0;
            while (!linkVideoPuro && esperaExtra < 30) { await new Promise(r => setTimeout(r, 200)); esperaExtra++; }
        }
        
    } catch (e) {
        console.error(`❌ Error en el bot para ${canalId}:`, e.message);
    } finally {
        try { await browser.close(); } catch (e) {}
    }
    return linkVideoPuro;
}

// ============================================================
// 🧠 CACHÉ EN SEGUNDO PLANO (EL CEREBRO NINJA)
// ============================================================
async function actualizarCacheEnBackground() {
    console.log("🤖 Iniciando patrullaje en segundo plano...");
    for (const [idCanal, datosCanal] of Object.entries(dbCanales)) {
        if (datosCanal.urlScraping) {
            try {
                const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, idCanal));
                if (linkVideoPuro) {
                    const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                    memoriaCache[idCanal] = { url: urlFinal, tiempo: Date.now() };
                    console.log(`✅ [${idCanal}] Guardado en caché (Background)`);
                }
            } catch (e) {
                console.log(`❌ Error en background para ${idCanal}`);
            }
        }
    }
    console.log("💤 Patrullaje terminado. Durmiendo 15 minutos.");
}

// Inicia el patrullaje 5 segundos después de que arranque el servidor
setTimeout(actualizarCacheEnBackground, 5000);
// Repite el patrullaje CADA 15 MINUTOS exactos
setInterval(actualizarCacheEnBackground, 15 * 60 * 1000);

// ============================================================
// API STREAM: REPRODUCTOR MAESTRO UNIVERSAL
// ============================================================
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    if (!datosCanal) return res.status(404).json({ exito: false, error: "Canal no encontrado en JSON" });

    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            
            // 1. REVISAR LA MEMORIA CACHÉ (Responde en 1 milisegundo)
            // Solo renovamos si pasaron más de 20 minutos (1200000 ms) para estar seguros
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 1200000)) { 
                return res.json({ exito: true, url: memoriaCache[canalId].url, clearkey: datosCanal.clearkey });
            }
            
            // 2. Si por algún motivo la caché está vacía, buscamos de emergencia
            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));
            
            if (linkVideoPuro) {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                return res.json({ exito: true, url: urlFinal, clearkey: datosCanal.clearkey });
            } else {
                return res.status(500).json({ exito: false, error: "No se pudo extraer el video de la página" });
            }
        } 
        else if (datosCanal.base) {
            // Canales directos (Sin bot): Agregamos rompe-cachés ?v=fecha
            const separador = datosCanal.base.includes('?') ? '&' : '?';
            const urlConAntiCache = `${datosCanal.base}${separador}v=${Date.now()}`;
            
            const paramsFinales = datosCanal.parametros ? `&${datosCanal.parametros}` : '';
            const urlCompleta = `${urlConAntiCache}${paramsFinales}`;
            
            if (datosCanal.usarProxy === false) {
                return res.json({ exito: true, url: urlCompleta, clearkey: datosCanal.clearkey });
            } else {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`;
                return res.json({ exito: true, url: urlFinal, clearkey: datosCanal.clearkey });
            }
        } 
        else {
            return res.status(400).json({ exito: false, error: "Configuración inválida en canal" });
        }
    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
});

// ============================================================
// (SIGUEN TUS RUTAS DE CONVERSIÓN M3U, PROXY Y EPG INTACTAS...)
// ============================================================
app.post('/api/convertir-m3u', express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
    // ... [Mismo código original] ...
    try {
        const contenidoM3U = req.body;
        if (!contenidoM3U || !contenidoM3U.includes('#EXTM3U')) {
            return res.status(400).json({ exito: false, error: "El archivo no parece ser un M3U válido." });
        }

        const canalesExtraidos = parsearM3U(contenidoM3U);
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `m3u_canal_${index}`; 
            
            nuevoFrontend.push({
                nombre: canal.nombre,
                categoria: canal.categoria,
                logo: canal.logo,
                opciones: [{ nombre: "Opción 1", id: idGenerado }]
            });

            nuevoBackend[idGenerado] = {
                base: canal.url,
                parametros: "",
                usarProxy: false 
            };
        });

        res.json({
            exito: true,
            total_canales: canalesExtraidos.length,
            estructura_generada: {
                frontend: nuevoFrontend,
                backend: nuevoBackend
            }
        });

    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

app.post('/api/convertir-m3u-url', async (req, res) => {
    // ... [Mismo código original] ...
    try {
        const urlM3U = req.body.url;
        if (!urlM3U) return res.status(400).json({ exito: false, error: "Falta enviar la URL." });

        const respuesta = await axios.get(urlM3U);
        const contenidoM3U = respuesta.data;

        if (!contenidoM3U || typeof contenidoM3U !== 'string' || !contenidoM3U.includes('#EXTM3U')) {
            return res.status(400).json({ exito: false, error: "El enlace no devuelve un formato M3U válido." });
        }

        const canalesExtraidos = parsearM3U(contenidoM3U);
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `link_${Date.now()}_${index}`; 
            
            nuevoFrontend.push({
                nombre: canal.nombre,
                categoria: canal.categoria,
                logo: canal.logo,
                opciones: [{ nombre: "Opción 1", id: idGenerado }]
            });

            nuevoBackend[idGenerado] = {
                base: canal.url,
                parametros: "",
                usarProxy: false 
            };
        });

        res.json({
            exito: true,
            total_canales: canalesExtraidos.length,
            estructura_generada: {
                frontend: nuevoFrontend,
                backend: nuevoBackend
            }
        });

    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
    }
});

app.post('/api/convertir-json-url', async (req, res) => {
    // ... [Mismo código original] ...
    try {
        const urlJson = req.body.url;
        if (!urlJson) return res.status(400).json({ exito: false, error: "Falta enviar la URL." });

        const respuesta = await axios.get(urlJson);
        let datos = respuesta.data;

        let canalesExtraidos = [];
        if (Array.isArray(datos)) canalesExtraidos = datos;
        else if (datos.channels) canalesExtraidos = datos.channels;
        else if (datos.canales) canalesExtraidos = datos.canales;
        else return res.status(400).json({ exito: false, error: "No se encontró una lista de canales reconocible." });

        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `json_${Date.now()}_${index}`; 
            
            const nombreCanal = canal.name || canal.nombre || canal.title || "Canal Desconocido";
            const categoriaCanal = canal.group || canal.categoria || canal.category || "General";
            const logoCanal = canal.logo || canal.icon || canal.imagen || "";
            const urlCanal = canal.url || canal.link || canal.stream || "";

            if (urlCanal) {
                nuevoFrontend.push({
                    nombre: nombreCanal,
                    categoria: categoriaCanal,
                    logo: logoCanal,
                    opciones: [{ nombre: "Opción 1", id: idGenerado }]
                });

                nuevoBackend[idGenerado] = {
                    base: urlCanal,
                    parametros: "",
                    usarProxy: false 
                };
            }
        });

        res.json({
            exito: true,
            total_canales: nuevoFrontend.length,
            estructura_generada: {
                frontend: nuevoFrontend,
                backend: nuevoBackend
            }
        });

    } catch (error) {
        res.status(500).json({ exito: false, error: error.message });
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

// ============================================================
// GUÍA DE PROGRAMACIÓN (EPG - XMLTV)
// ============================================================
let guiaTV = {}; 

async function actualizarEPG() {
    console.log("⏳ Descargando Guía EPG gratuita...");
    try {
        const epgUrl = 'https://raw.githubusercontent.com/globetvapp/epg/main/Argentina/argentina1.xml';
        const { data } = await axios.get(epgUrl);
        
        const programas = data.split('<programme');
        guiaTV = {}; 

        for (let i = 1; i < programas.length; i++) {
            const bloque = programas[i];
            
            const canalMatch = bloque.match(/channel="([^"]+)"/);
            const startMatch = bloque.match(/start="([^\\s]+) /); 
            const stopMatch = bloque.match(/stop="([^\\s]+) /);
            const titleMatch = bloque.match(/<title[^>]*>([^<]+)<\/title>/);

            if (canalMatch && startMatch && stopMatch && titleMatch) {
                const idCanal = canalMatch[1];
                const titulo = titleMatch[1];
                
                const formatearHora = (fechaSTR) => `${fechaSTR.substring(8, 10)}:${fechaSTR.substring(10, 12)}`;
                
                if (!guiaTV[idCanal]) guiaTV[idCanal] = [];
                
                guiaTV[idCanal].push({
                    inicio: startMatch[1], 
                    horario: `${formatearHora(startMatch[1])} - ${formatearHora(stopMatch[1])}`,
                    titulo: titulo
                });
            }
        }
        console.log("✅ Guía EPG actualizada correctamente.");
    } catch (error) {
        console.log("⚠️ No se pudo descargar la EPG:", error.message);
    }
}

actualizarEPG();
setInterval(actualizarEPG, 12 * 60 * 60 * 1000);

app.get('/api/epg/:canalId', (req, res) => {
    try {
        const idApp = req.params.canalId.toLowerCase(); 

        const diccionario = {
            "telefe": ["telefe"],
            "eltrece": ["eltrece", "trece", "canal13"],
            "elnueve": ["elnueve", "nueve", "canal9"],
            "america": ["america"],
            "tvpublica": ["publica", "tvp"],
            "espn_premium": ["espnpremium"],
            "espn": ["espn"],
            "tnt": ["tntsports"],
            "fox": ["foxsports"],
            "tyc": ["tyc"],
            "dsports": ["dsports", "directv"],
            "ciudad": ["ciudadmagazine", "ciudad"],
            "discovery": ["discovery"]
        };

        let palabrasClave = [idApp.split('_')[0]]; 
        for (const key in diccionario) {
            if (idApp.includes(key)) {
                palabrasClave = diccionario[key];
                break;
            }
        }

        const idCanalXML = Object.keys(guiaTV).find(clave => {
            const claveLimpia = clave.toLowerCase();
            return palabrasClave.some(palabra => claveLimpia.includes(palabra));
        });

        if (idCanalXML && guiaTV[idCanalXML]) {
            const programas = guiaTV[idCanalXML];
            
            const fechaAr = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"}));
            const año = fechaAr.getFullYear();
            const mes = String(fechaAr.getMonth() + 1).padStart(2, '0');
            const dia = String(fechaAr.getDate()).padStart(2, '0');
            const hora = String(fechaAr.getHours()).padStart(2, '0');
            const min = String(fechaAr.getMinutes()).padStart(2, '0');
            
            const ahoraNum = parseInt(`${año}${mes}${dia}${hora}${min}00`); 

            let ahora = null;
            let siguiente = null;

            for (let i = 0; i < programas.length; i++) {
                const progInicio = parseInt(programas[i].inicio);
                const progFin = programas[i+1] ? parseInt(programas[i+1].inicio) : progInicio + 20000; 

                if (ahoraNum >= progInicio && ahoraNum < progFin) {
                    ahora = programas[i];
                    siguiente = programas[i+1] || { titulo: "Continuación de transmisión", horario: "--:--" };
                    break;
                }
            }

            if (ahora) {
                return res.json({ exito: true, ahora, siguiente });
            }
        }

        res.json({ exito: false });

    } catch (error) {
        console.error("Error en EPG:", error);
        res.json({ exito: false });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    setInterval(async () => { try { await axios.get(`${API_URL}/ping`); } catch (e) {} }, 14 * 60 * 1000);
});