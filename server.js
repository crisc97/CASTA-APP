const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');
 
const app = express();
 
app.use(cors({ origin: '*' }));
app.use(express.json());
 
const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://casta-app.onrender.com';
 
// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
 
// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    'tnt_1': { base: 'https://anden26.ddns.net/live/stream.m3u8', parametros: 'v=1777146764944' },
    'eltrece_directo': { base: 'https://live-01-02-eltrece.vodgc.net/eltrecetv/index.m3u8', parametros: '' },
    'elnueve_directo': { base: 'https://octubre-live.cdn.vustreams.com/live/channel09/live.isml/live.m3u8', parametros: '' },
    'telefe_directo': { base: 'https://telefe.com/Api/Videos/GetSourceUrl/694564/0/HLS?.m3u8', parametros: '' },
    // 🔥 CANALES BOT (Puppeteer scraper)
    'espn_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/espn-premium/',
        opcionesBotones: [
            ['Opción 3', 'Opcion 3', 'Opción3', 'Opcion3', 'opción 3', 'opcion 3'],
            ['Opción 2', 'Opcion 2', 'Opción2', 'Opcion2', 'opción 2', 'opcion 2'],
        ]
    },
    'dsports_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/dsports/',
        opcionesBotones: [
            ['Opción 2', 'Opcion 2', 'Opción2', 'Opcion2', 'opción 2', 'opcion 2'],
            ['Opción 3', 'Opcion 3', 'Opción3', 'Opcion3', 'opción 3', 'opcion 3'],
        ]
    },
    'tnt_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/tnt-sports/',
        opcionesBotones: [
            ['Opción 2', 'Opcion 2', 'Opción2', 'Opcion2', 'opción 2', 'opcion 2'],
            ['Opción 3', 'Opcion 3', 'Opción3', 'Opcion3', 'opción 3', 'opcion 3'],
        ]
    },
    'fox_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/fox-sports/',
        opcionesBotones: [
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
            ['Opción 3', 'Opcion 3'],
        ]
    },
};
 
const memoriaCache = {};
 
// ============================================================
// 🧠 COLA DE BOTS — solo un browser a la vez para ahorrar RAM
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
                // Forzamos garbage collection si está disponible
                if (global.gc) {
                    global.gc();
                    console.log('🧹 Garbage collection forzado');
                }
                ejecutarSiguienteBot();
            }
        });
        ejecutarSiguienteBot();
    });
}
 
// Helper: detecta si una URL es HLS
function esM3u8(url) {
    return url.includes('.m3u8');
}
 
// Helper: arma headers correctos según el dominio del stream
function armarHeaders(targetUrl) {
    let referer = 'https://tvlibr3.com/';
    let origin = 'https://tvlibr3.com';
 
    if (targetUrl.includes('streameasthd') || targetUrl.includes('streamtpnew')) {
        referer = 'https://streamtpnew.com/';
        origin = 'https://streamtpnew.com';
    } else if (targetUrl.includes('nebunexa') || targetUrl.includes('cvattv')) {
        referer = 'https://pcn.nebunexa.life/';
        origin = 'https://pcn.nebunexa.life';
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
 
// Helper: clic en botón buscando múltiples variantes de texto
async function clickBotonPorVariantes(page, variantes) {
    try {
        const resultado = await page.evaluate((textos) => {
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
 
        if (resultado) {
            console.log(`✅ Clic exitoso en botón: "${resultado}"`);
        } else {
            console.log(`⚠️ No se encontró: ${JSON.stringify(variantes)}`);
            const textos = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('button, a'))
                    .map(e => (e.innerText || '').trim())
                    .filter(t => t.length > 0 && t.length < 50);
            });
            console.log(`🔍 Botones disponibles en la página:`, textos);
        }
        return resultado;
    } catch (e) {
        console.log(`❌ Error al hacer clic: ${e.message}`);
        return null;
    }
}
 
// --- PROXY PARA HLS (.m3u8) ---
app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta el parámetro url');
 
    const headers = armarHeaders(targetUrl);
    console.log(`🔀 Proxy: ${targetUrl}`);
 
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'text',
            headers,
            timeout: 30000
        });
 
        console.log(`✅ Proxy HTTP ${response.status} para: ${targetUrl}`);
 
        const contentType = response.headers['content-type'] || '';
 
        if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
            const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
            let contenido = response.data;
 
            contenido = contenido.split('\n').map(linea => {
                const l = linea.trim();
                if (!l || l.startsWith('#')) return linea;
 
                let urlSegmento;
                if (l.startsWith('http://') || l.startsWith('https://')) {
                    urlSegmento = l;
                } else {
                    urlSegmento = baseUrl + l;
                }
 
                return `${API_URL}/proxy/stream?url=${encodeURIComponent(urlSegmento)}`;
            }).join('\n');
 
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(contenido);
        }
 
        const binaryResponse = await axios.get(targetUrl, {
            responseType: 'stream',
            headers,
            timeout: 30000
        });
 
        res.setHeader('Content-Type', binaryResponse.headers['content-type'] || 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        binaryResponse.data.pipe(res);
 
    } catch (err) {
        console.error(`❌ Error en proxy: ${err.message}`);
        if (err.response) {
            console.error(`   HTTP Status: ${err.response.status}`);
            console.error(`   URL: ${targetUrl}`);
        }
        res.status(502).send('No se pudo obtener el stream');
    }
});
 
// --- FUNCIÓN DEL BOT (aislada para la cola) ---
async function correrBot(datosCanal, canalId) {
    console.log(`🕵️‍♂️ Bot iniciando para: ${canalId}...`);
    console.log(`📊 RAM antes del bot: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
 
    // 🧠 Argumentos para Chromium ultra liviano
    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-default-apps',
            '--disable-hang-monitor',
            '--disable-ipc-flooding-protection',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--no-first-run',
            '--safebrowsing-disable-auto-update',
            '--mute-audio',
            '--single-process',         // ⭐ un solo proceso = mucha menos RAM
            '--memory-pressure-off',
            '--js-flags=--max-old-space-size=128', // limita JS heap a 128MB
        ]
    });
 
    let linkVideoPuro = null;
 
    try {
        const page = await browser.newPage();
 
        // Viewport mínimo para ahorrar RAM
        await page.setViewport({ width: 800, height: 600 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
 
        // Escuchamos targets nuevos
        browser.on('targetcreated', async (target) => {
            const newPage = await target.page();
            if (!newPage) return;
            await newPage.setRequestInterception(true).catch(() => {});
            newPage.on('request', (req) => {
                const url = req.url();
                if (esM3u8(url) && !linkVideoPuro) {
                    linkVideoPuro = url;
                    console.log(`🎯 .m3u8 en TARGET nuevo: ${url}`);
                }
                req.continue().catch(() => {});
            });
            newPage.on('response', async (response) => {
                const url = response.url();
                if (esM3u8(url) && !linkVideoPuro) {
                    linkVideoPuro = url;
                    console.log(`🎯 .m3u8 en RESPONSE TARGET: ${url}`);
                }
            });
        });
 
        await page.setRequestInterception(true);
 
        page.on('request', (req) => {
            const url = req.url();
            const resourceType = req.resourceType();
            // Bloqueamos todo lo que no sea necesario para ahorrar RAM
            if (['image', 'stylesheet', 'font', 'media', 'websocket'].includes(resourceType)) {
                req.abort();
                return;
            }
            if (esM3u8(url) && !linkVideoPuro) {
                linkVideoPuro = url;
                console.log(`🎯 .m3u8 en REQUEST principal: ${url}`);
            }
            req.continue().catch(() => {});
        });
 
        page.on('response', async (response) => {
            const url = response.url();
            if (esM3u8(url) && !linkVideoPuro) {
                linkVideoPuro = url;
                console.log(`🎯 .m3u8 en RESPONSE principal: ${url}`);
            }
        });
 
        page.on('framenavigated', async (frame) => {
            const frameUrl = frame.url();
            console.log(`📄 Frame: ${frameUrl}`);
            if (esM3u8(frameUrl) && !linkVideoPuro) linkVideoPuro = frameUrl;
        });
 
        console.log(`🌐 Navegando a: ${datosCanal.urlScraping}`);
        await page.goto(datosCanal.urlScraping, { waitUntil: 'networkidle2', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
 
        // Intentamos cada grupo de botones
        const gruposBotones = datosCanal.opcionesBotones || [];
 
        for (const variantes of gruposBotones) {
            if (linkVideoPuro) break;
 
            console.log(`\n🖱️ Intentando: ${JSON.stringify(variantes)}`);
            const clicOk = await clickBotonPorVariantes(page, variantes);
 
            if (clicOk) {
                console.log(`⏳ Esperando .m3u8 hasta 8s...`);
                let espera = 0;
                while (!linkVideoPuro && espera < 8) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    espera++;
                }
                if (linkVideoPuro) break;
                console.log(`⚠️ Sin .m3u8 con "${clicOk}", probando siguiente...`);
            }
        }
 
        // Fallback clics centro
        if (!linkVideoPuro) {
            console.log(`👆 Fallback clics centro...`);
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            let espera = 0;
            while (!linkVideoPuro && espera < 5) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                espera++;
            }
        }
 
    } finally {
        // ⭐ Siempre cerramos el browser, pase lo que pase
        try {
            await browser.close();
            console.log(`🔒 Browser cerrado para: ${canalId}`);
            console.log(`📊 RAM después del bot: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
        } catch (e) {
            console.error(`⚠️ Error al cerrar browser: ${e.message}`);
        }
    }
 
    return linkVideoPuro;
}
 
// --- RUTA INTELIGENTE PARA OBTENER ENLACES ---
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
 
    if (!datosCanal) {
        return res.status(404).json({ exito: false, mensaje: "Canal no encontrado en la base de datos" });
    }
 
    try {
 
        // 🤖 MODO BOT (Puppeteer con cola)
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                console.log(`✅ Cache válida para ${canalId}`);
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }
 
            console.log(`📥 Encolando bot para: ${canalId} (bots en cola: ${colaDeBots.length}, activo: ${botEnEjecucion})`);
 
            // Encolamos el bot — si hay otro corriendo, espera su turno
            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));
 
            if (linkVideoPuro) {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                console.log(`✅ Listo: ${urlFinal}`);
                return res.json({ exito: true, url: urlFinal });
            } else {
                return res.status(500).json({ exito: false, mensaje: "El bot no encontró ningún .m3u8." });
            }
 
        // 🎬 MODO DASH
        } else if (datosCanal.dominio && datosCanal.token && datosCanal.ruta) {
            const urlCompleta = `${datosCanal.dominio}${datosCanal.token}${datosCanal.ruta}`;
            return res.json({ exito: true, url: urlCompleta });
 
        // 📡 MODO DIRECTO
        } else {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            return res.json({ exito: true, url: urlCompleta });
        }
 
    } catch (error) {
        console.error("❌ Error general:", error);
        return res.status(500).json({ exito: false, error: error.message });
    }
});
 
// --- ENCENDIDO DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Casta-App corriendo en el puerto ${PORT}`);
});