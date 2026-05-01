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
};
 
const memoriaCache = {};
 
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
// Reescribe las URLs de segmentos para que también pasen por el proxy (evita CORS)
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
 
        // Si es playlist .m3u8, reescribimos URLs de segmentos
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
 
        // Si es segmento de video (.ts, .aac, etc.), lo streameamos en binario
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
 
// --- RUTA INTELIGENTE PARA OBTENER ENLACES ---
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
 
    if (!datosCanal) {
        return res.status(404).json({ exito: false, mensaje: "Canal no encontrado en la base de datos" });
    }
 
    try {
 
        // 🤖 MODO BOT (Puppeteer)
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                console.log(`✅ Cache válida para ${canalId}`);
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }
 
            console.log(`🕵️‍♂️ Iniciando bot para: ${canalId}...`);
 
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
 
            try {
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
 
                let linkVideoPuro = null;
 
                // Escuchamos todos los targets nuevos que cree el browser
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
                    if (['image', 'stylesheet', 'font'].includes(resourceType)) {
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
                await new Promise(resolve => setTimeout(resolve, 3000));
 
                // 🎯 Intentamos cada grupo de botones en orden de prioridad
                const gruposBotones = datosCanal.opcionesBotones || [];
 
                for (const variantes of gruposBotones) {
                    if (linkVideoPuro) break;
 
                    console.log(`\n🖱️ Intentando: ${JSON.stringify(variantes)}`);
                    const clicOk = await clickBotonPorVariantes(page, variantes);
 
                    if (clicOk) {
                        console.log(`⏳ Esperando .m3u8 hasta 15s...`);
                        let espera = 0;
                        while (!linkVideoPuro && espera < 15) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            espera++;
                        }
                        if (linkVideoPuro) break;
                        console.log(`⚠️ Sin .m3u8 con "${clicOk}", probando siguiente...`);
                    }
                }
 
                // Fallback: clics en el centro de la pantalla
                if (!linkVideoPuro) {
                    console.log(`👆 Fallback clics centro...`);
                    const viewport = page.viewport();
                    await page.mouse.click(viewport.width / 2, viewport.height / 2);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await page.mouse.click(viewport.width / 2, viewport.height / 2);
                    let espera = 0;
                    while (!linkVideoPuro && espera < 10) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        espera++;
                    }
                }
 
                await browser.close();
 
                if (linkVideoPuro) {
                    const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                    memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                    console.log(`✅ Listo: ${urlFinal}`);
                    return res.json({ exito: true, url: urlFinal });
                } else {
                    return res.status(500).json({ exito: false, mensaje: "El bot no encontró ningún .m3u8." });
                }
 
            } catch (errorBot) {
                await browser.close();
                console.error("❌ Error Puppeteer:", errorBot.message);
                return res.status(500).json({ exito: false, mensaje: "El bot falló." });
            }
 
        // 🎬 MODO DASH (dominio + token + ruta)
        } else if (datosCanal.dominio && datosCanal.token && datosCanal.ruta) {
            const urlCompleta = `${datosCanal.dominio}${datosCanal.token}${datosCanal.ruta}`;
            return res.json({ exito: true, url: urlCompleta });
 
        // 📡 MODO DIRECTO (base + parámetros)
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