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
    'tnt_2': { base: 'https://edge-live03-hr.cvattv.com.ar/', parametros: 'token=2d31ee61fa39e8f26d1ae2817536cdfaa0304243-1e-1776893748-1776839748' },
    'tnt_3': { base: 'https://cdn2.zohanayaan.com:1686/hls/tntarg.m3u8', parametros: 'md5=2JItcM4Z7jUmJVO9EcYyAA&expires=1776856069' },
 
    'espn_1': { base: 'https://serviciosatv78.ddns.net/live/stream.m3u8', parametros: '' },
    'espn_2': { dominio: 'https://edge-live03-hr.cvattv.com.ar/', token: 'tok_eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOiIxNzc3MTUxNjE2Iiwic2lwIjoiMTgxLjIyOC45MC4xOTUiLCJwYXRoIjoiL2xpdmUvYzdlZHMvRm94X1Nwb3J0c19QcmVtaXVuX0hEL1NBX0xpdmVfZGFzaF9lbmNfQy8iLCJzZXNzaW9uX2Nkbl9pZCI6IjM0NTUyMGVkYjUxMDFhYTIiLCJzZXNzaW9uX2lkIjoiIiwiY2xpZW50X2lkIjoiIiwiZGV2aWNlX2lkIjoiIiwibWF4X3Nlc3Npb25zIjowLCJzZXNzaW9uX2R1cmF0aW9uIjowLCJ1cmwiOiJodHRwczovLzE4MS4xMi4zNi4xNTAiLCJhdWQiOiIyOTYiLCJzb3VyY2VzIjpbODUsMTQ0LDg2LDg4XX0=.7jnZqLSgob2q-NhgBBrAD8MNwd5Lpwjo3xlmLqWEzQ835_Q9p6YLZRohnJFpbog3SUitFdnpnlBh6QxLwtcAIQ==/', ruta: 'live/c7eds/Fox_Sports_Premiun_HD/SA_Live_dash_enc_C/Fox_Sports_Premiun_HD.mpd' },
    'espn_3': { base: 'https://cdn4.zohanayaan.com:1686/hls/espnar.m3u8', parametros: 'md5=iJutx_apVGzpxL9Chcs-kA&expires=1776856173' },
 
    // 🔥 CANAL AUTOMÁTICO (BOT SCRAPER)
    'espn_scraper': { urlScraping: 'https://tvlibr3.com/en-vivo/espn-premium/', selectorScraping: 'iframe#iframe' },
 
    'dsports_1': { base: 'https://deportes.ksdjugfsddeports.com:9092/MTgxLjIyOC45MC4xOTU=/3_.m3u8', parametros: 'token=BWsZ9wuhVtu2q0f-H3_08A&expires=1776880331' },
    'dsports_2': { base: 'https://vg7ie.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8', parametros: 'token=df20d1345ddf914c84aa7caced8870ce365e82af-9a-1776893584-1776839584' },
    'dsports_3': { base: 'https://cdn4.zohanayaan.com:1686/hls/dsportshd1.m3u8', parametros: 'md5=RgzpbSywI-eUiFOwnwx0dw&expires=1776855896' }
};
 
const memoriaCache = {};
 
// Helper: detecta si una URL es un stream válido
function esStreamValido(url) {
    return url.includes('.m3u8') || url.includes('.mpd');
}
 
// Helper: intenta decodificar base64 del parámetro ?get= de frames tipo mpdk
function decodificarMpdk(frameUrl) {
    try {
        const urlObj = new URL(frameUrl);
        const encoded = urlObj.searchParams.get('get');
        if (encoded) {
            const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
            console.log(`🔓 URL decodificada del frame mpdk: ${decoded}`);
            if (esStreamValido(decoded)) {
                return decoded;
            }
        }
    } catch (e) {}
    return null;
}
 
// --- PROXY DE STREAM (soluciona errores CORS / 241403) ---
app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('Falta el parámetro url');
 
    try {
        const response = await axios.get(targetUrl, {
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Referer': 'https://tvlibr3.com/',
                'Origin': 'https://tvlibr3.com',
                'Accept': '*/*',
                'Accept-Language': 'es-AR,es;q=0.9',
            },
            timeout: 15000
        });
 
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
 
        response.data.pipe(res);
 
    } catch (err) {
        console.error('Error en proxy:', err.message);
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
 
        // 🤖 MODO BOT (Puppeteer + intercepción de red mejorada)
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                console.log(`✅ Cache válida para ${canalId}, devolviendo URL guardada.`);
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }
 
            console.log(`🕵️‍♂️ Iniciando intercepción de red para: ${canalId}...`);
 
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
 
            try {
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
 
                let linkVideoPuro = null;
 
                // 🔑 Escuchamos TODAS las páginas/targets que cree el browser
                browser.on('targetcreated', async (target) => {
                    const newPage = await target.page();
                    if (!newPage) return;
 
                    await newPage.setRequestInterception(true).catch(() => {});
 
                    newPage.on('request', (req) => {
                        const url = req.url();
                        if (esStreamValido(url) && !linkVideoPuro) {
                            linkVideoPuro = url;
                            console.log(`🎯 Stream encontrado en TARGET nuevo: ${url}`);
                        }
                        req.continue().catch(() => {});
                    });
 
                    newPage.on('response', async (response) => {
                        const url = response.url();
                        if (esStreamValido(url) && !linkVideoPuro) {
                            linkVideoPuro = url;
                            console.log(`🎯 Stream encontrado en RESPONSE de TARGET: ${url}`);
                        }
                    });
                });
 
                // Interceptamos la página principal
                await page.setRequestInterception(true);
 
                page.on('request', (req) => {
                    const url = req.url();
                    const resourceType = req.resourceType();
 
                    if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                        req.abort();
                        return;
                    }
 
                    if (esStreamValido(url) && !linkVideoPuro) {
                        linkVideoPuro = url;
                        console.log(`🎯 Stream en página principal REQUEST: ${url}`);
                    }
                    req.continue().catch(() => {});
                });
 
                page.on('response', async (response) => {
                    const url = response.url();
                    if (esStreamValido(url) && !linkVideoPuro) {
                        linkVideoPuro = url;
                        console.log(`🎯 Stream en página principal RESPONSE: ${url}`);
                    }
                });
 
                // 🔍 Escuchamos frames navegados — incluyendo decodificación de mpdk
                page.on('framenavigated', async (frame) => {
                    const frameUrl = frame.url();
                    console.log(`📄 Frame navegado: ${frameUrl}`);
 
                    if (esStreamValido(frameUrl) && !linkVideoPuro) {
                        linkVideoPuro = frameUrl;
                        return;
                    }
 
                    // 🆕 Frame tipo mpdk: decodificamos base64 del parámetro ?get=
                    if (frameUrl.includes('mpdk') && frameUrl.includes('get=') && !linkVideoPuro) {
                        const decoded = decodificarMpdk(frameUrl);
                        if (decoded) {
                            linkVideoPuro = decoded;
                            console.log(`✅ Stream extraído del frame mpdk: ${linkVideoPuro}`);
                        }
                    }
                });
 
                console.log(`🌐 Navegando a: ${datosCanal.urlScraping}`);
                await page.goto(datosCanal.urlScraping, { waitUntil: 'networkidle2', timeout: 60000 });
 
                await new Promise(resolve => setTimeout(resolve, 4000));
 
                // 🔍 Buscamos iframes en el DOM
                const iframeSrcs = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(Boolean);
                });
 
                console.log(`🖼️ Iframes encontrados: ${JSON.stringify(iframeSrcs)}`);
 
                // Visitamos cada iframe directamente
                for (const iframeSrc of iframeSrcs) {
                    if (!linkVideoPuro && iframeSrc && iframeSrc.startsWith('http')) {
                        console.log(`➡️ Visitando iframe: ${iframeSrc}`);
                        await page.goto(iframeSrc, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
                        await new Promise(resolve => setTimeout(resolve, 3000));
 
                        const viewport = page.viewport();
                        await page.mouse.click(viewport.width / 2, viewport.height / 2);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await page.mouse.click(viewport.width / 2, viewport.height / 2);
                    }
                }
 
                // Si todavía no encontramos nada, volvemos a la página principal y hacemos clic
                if (!linkVideoPuro) {
                    console.log(`👆 Intentando clics en página principal...`);
                    await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    const viewport = page.viewport();
                    await page.mouse.click(viewport.width / 2, viewport.height / 2);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await page.mouse.click(viewport.width / 2, viewport.height / 2);
                }
 
                // Esperamos hasta 20 segundos más
                console.log(`⏳ Esperando stream...`);
                let paciencia = 0;
                while (!linkVideoPuro && paciencia < 20) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    paciencia++;
                }
 
                await browser.close();
 
                if (linkVideoPuro) {
                    const urlProxeada = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                    memoriaCache[canalId] = { url: urlProxeada, tiempo: Date.now() };
                    console.log(`✅ Listo: ${urlProxeada}`);
                    return res.json({ exito: true, url: urlProxeada });
                } else {
                    return res.status(500).json({ exito: false, mensaje: "El bot no encontró ningún stream (.m3u8 o .mpd) después de revisar todos los frames." });
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