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
            // Extraer nombre del canal (lo que está después de la última coma)
            const partes = linea.split(',');
            canalActual.nombre = partes.length > 1 ? partes.pop().trim() : "Canal Desconocido";
            
            // Extraer logo si existe (tvg-logo="url")
            const logoMatch = linea.match(/tvg-logo="([^"]+)"/);
            canalActual.logo = logoMatch ? logoMatch[1] : "logos_canales/default.png";
            
            // Extraer categoría si existe (group-title="categoria")
            const grupoMatch = linea.match(/group-title="([^"]+)"/);
            canalActual.categoria = grupoMatch ? grupoMatch[1] : "General";
            
        } else if (linea && !linea.startsWith('#')) {
            // Si no empieza con # y no está vacía, es la URL del stream
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

    // REEMPLAZÁS TODO TU BLOQUE TRY/CATCH DESDE ACÁ:
    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            // 1. Revisar Caché para no abrir navegadores de más
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 600000)) { // 2 horas de caché
                return res.json({ exito: true, url: memoriaCache[canalId].url, clearkey: datosCanal.clearkey });
            }
            
            // 2. Mandar el Bot a trabajar
            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));
            
            if (linkVideoPuro) {
                // Siempre usamos proxy para los enlaces raspados para evitar bloqueos
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                return res.json({ exito: true, url: urlFinal, clearkey: datosCanal.clearkey });
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
                return res.json({ exito: true, url: urlCompleta, clearkey: datosCanal.clearkey });
            } else {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`;
                return res.json({ exito: true, url: urlFinal, clearkey: datosCanal.clearkey });
            }
        } 
        
        else {
            return res.status(400).json({ exito: false, error: "El canal no tiene 'base' ni 'urlScraping' configurado" });
        }

    } catch (error) {
        return res.status(500).json({ exito: false, error: error.message });
    }
    // HASTA ACÁ. ABAJO YA SIGUE LA RUTA DEL PROXY (app.get('/proxy/stream'...)
});

// ============================================================
// RUTA: CONVERTIR M3U (Sube una lista y te devuelve el JSON)
// ============================================================
app.post('/api/convertir-m3u', express.text({ type: '*/*', limit: '50mb' }), (req, res) => {
    try {
        const contenidoM3U = req.body;
        if (!contenidoM3U || !contenidoM3U.includes('#EXTM3U')) {
            return res.status(400).json({ exito: false, error: "El archivo no parece ser un M3U válido." });
        }

        const canalesExtraidos = parsearM3U(contenidoM3U);
        
        // Formatear para tu estructura actual (frontend y backend)
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `m3u_canal_${index}`; // Ej: m3u_canal_0
            
            nuevoFrontend.push({
                nombre: canal.nombre,
                categoria: canal.categoria,
                logo: canal.logo,
                opciones: [{ nombre: "Opción 1", id: idGenerado }]
            });

            nuevoBackend[idGenerado] = {
                base: canal.url,
                parametros: "",
                usarProxy: false // Por defecto, intentamos reproducir directo
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
// ============================================================
// RUTA: CONVERTIR M3U DESDE UN LINK (URL)
// ============================================================
app.post('/api/convertir-m3u-url', async (req, res) => {
    try {
        const urlM3U = req.body.url;
        if (!urlM3U) return res.status(400).json({ exito: false, error: "Falta enviar la URL." });

        // 1. El servidor va a buscar la lista a internet
        const respuesta = await axios.get(urlM3U);
        const contenidoM3U = respuesta.data;

        if (!contenidoM3U || typeof contenidoM3U !== 'string' || !contenidoM3U.includes('#EXTM3U')) {
            return res.status(400).json({ exito: false, error: "El enlace no devuelve un formato M3U válido." });
        }

        // 2. Lo convierte usando la función que ya armamos
        const canalesExtraidos = parsearM3U(contenidoM3U);
        
        const nuevoFrontend = [];
        const nuevoBackend = {};

        canalesExtraidos.forEach((canal, index) => {
            // Le ponemos un número aleatorio al ID para que no se repitan si subís varias listas
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
// ============================================================
// RUTA: CONVERTIR LISTAS JSON EXTERNAS A TU FORMATO
// ============================================================
app.post('/api/convertir-json-url', async (req, res) => {
    try {
        const urlJson = req.body.url;
        if (!urlJson) return res.status(400).json({ exito: false, error: "Falta enviar la URL." });

        // 1. Descargamos el JSON de internet
        const respuesta = await axios.get(urlJson);
        let datos = respuesta.data;

        // Intentamos detectar dónde están los canales (a veces es un Array directo, a veces está dentro de "channels" o "canales")
        let canalesExtraidos = [];
        if (Array.isArray(datos)) canalesExtraidos = datos;
        else if (datos.channels) canalesExtraidos = datos.channels;
        else if (datos.canales) canalesExtraidos = datos.canales;
        else {
            return res.status(400).json({ exito: false, error: "No se encontró una lista de canales reconocible en este JSON." });
        }

        const nuevoFrontend = [];
        const nuevoBackend = {};

        // 2. Traducimos canal por canal a TU formato
        canalesExtraidos.forEach((canal, index) => {
            const idGenerado = `json_${Date.now()}_${index}`; 
            
            // Buscamos cómo se llama la propiedad (cubrimos las palabras más comunes en inglés y español)
            const nombreCanal = canal.name || canal.nombre || canal.title || "Canal Desconocido";
            const categoriaCanal = canal.group || canal.categoria || canal.category || "General";
            const logoCanal = canal.logo || canal.icon || canal.imagen || "";
            const urlCanal = canal.url || canal.link || canal.stream || "";

            if (urlCanal) { // Solo lo agregamos si tiene un enlace válido
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
let guiaTV = {}; // Acá guardamos los horarios en la memoria

// Función para descargar y entender el XML
async function actualizarEPG() {
    console.log("⏳ Descargando Guía EPG gratuita...");
    try {
        // Enlace público y gratuito de EPG (podés cambiarlo a futuro)
        const epgUrl = 'https://raw.githubusercontent.com/globetvapp/epg/main/Argentina/argentina1.xml';
        const { data } = await axios.get(epgUrl);
        
        // Un conversor casero y rápido de XML a JSON para no instalar librerías pesadas
        const programas = data.split('<programme');
        guiaTV = {}; // Vaciamos la guía vieja

        for (let i = 1; i < programas.length; i++) {
            const bloque = programas[i];
            
            // Extraer el ID del canal, inicio, fin y título
            const canalMatch = bloque.match(/channel="([^"]+)"/);
            const startMatch = bloque.match(/start="([^\\s]+) /); // Ej: 20240523130000
            const stopMatch = bloque.match(/stop="([^\\s]+) /);
            const titleMatch = bloque.match(/<title[^>]*>([^<]+)<\/title>/);

            if (canalMatch && startMatch && stopMatch && titleMatch) {
                const idCanal = canalMatch[1];
                const titulo = titleMatch[1];
                
                // Formatear hora (de "20240523130000" a "13:00")
                const formatearHora = (fechaSTR) => `${fechaSTR.substring(8, 10)}:${fechaSTR.substring(10, 12)}`;
                
                if (!guiaTV[idCanal]) guiaTV[idCanal] = [];
                
                guiaTV[idCanal].push({
                    inicio: startMatch[1], // Guardamos el número crudo para calcular si está en vivo
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

// Descargar EPG al iniciar el servidor y luego cada 12 horas
actualizarEPG();
setInterval(actualizarEPG, 12 * 60 * 60 * 1000);

// ============================================================
// RUTA PARA QUE EL FRONTEND PREGUNTE QUÉ HAY EN LA TELE (REAL)
// ============================================================
app.get('/api/epg/:canalId', (req, res) => {
    try {
        const idApp = req.params.canalId.toLowerCase(); 

        // 1. Diccionario inteligente basado en tus IDs del config_canales.json
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

        // Determinamos las palabras a buscar en el XML
        let palabrasClave = [idApp.split('_')[0]]; 
        for (const key in diccionario) {
            if (idApp.includes(key)) {
                palabrasClave = diccionario[key];
                break;
            }
        }

        // 2. Buscar si el canal existe en el XML descargado
        const idCanalXML = Object.keys(guiaTV).find(clave => {
            const claveLimpia = clave.toLowerCase();
            return palabrasClave.some(palabra => claveLimpia.includes(palabra));
        });

        // 3. Si lo encuentra, calculamos el horario actual
        if (idCanalXML && guiaTV[idCanalXML]) {
            const programas = guiaTV[idCanalXML];
            
            // Forzamos el reloj a la zona horaria de Argentina (UTC-3)
            const fechaAr = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"}));
            const año = fechaAr.getFullYear();
            const mes = String(fechaAr.getMonth() + 1).padStart(2, '0');
            const dia = String(fechaAr.getDate()).padStart(2, '0');
            const hora = String(fechaAr.getHours()).padStart(2, '0');
            const min = String(fechaAr.getMinutes()).padStart(2, '0');
            
            // Creamos el número de hora actual para comparar (Ej: 20240523130000)
            const ahoraNum = parseInt(`${año}${mes}${dia}${hora}${min}00`); 

            let ahora = null;
            let siguiente = null;

            // Recorremos los horarios para ver cuál coincide con este instante
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

        // Si el canal no está en la guía o no hay horarios, manda error para que el Frontend muestre el texto por defecto
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