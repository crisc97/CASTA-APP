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

// 🏓 Ruta de ping para mantener el servidor despierto
app.get('/ping', (req, res) => res.send('ok'));

// 🗑️ Ruta para limpiar caché de un canal (usada en reintento automático)
app.get('/api/clear-cache/:canal', (req, res) => {
    const canalId = req.params.canal;
    if (memoriaCache[canalId]) {
        delete memoriaCache[canalId];
        console.log(`🗑️ Caché borrada para: ${canalId}`);
    }
    res.json({ ok: true });
});

// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    'tnt_1': { base: 'https://anden26.ddns.net/live/stream.m3u8', parametros: 'v=1777146764944' },
    'telefe_directo': { base: 'http://45.5.151.147:8000/play/a00g/index.m3u8', parametros: '',
        usarProxy: true  },
    'eltrece_directo': { base: 'http://45.5.151.147:8000/play/a00g/index.m3u8', parametros: '',
        usarProxy: true  },
    'elnueve_directo': { base: 'http://45.5.151.147:8000/play/a00e/index.m3u8', parametros: '',
        usarProxy: true },
    'america_directo': { base: 'http://45.5.151.147:8000/play/a00c/index.m3u8', parametros: '',
        usarProxy: true },
    'tvpublica_directo': { base: 'http://45.5.151.147:8000/play/a00h/index.m3u8', parametros: '',
        usarProxy: true },
    
     'ciudadmagazine_arg': { 
        base: 'http://45.5.151.147:8000/play/a03i/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
    'espn_premium_HD': { 
        base: 'http://latinapro.net:25461/live/lazaroperez/perez3/index.m3u8', 
        parametros: '',
        usarProxy: true // Esto obliga al server a inyectar las credenciales
    },
    'espn_premium': { 
        base: 'http://45.5.151.147:8000/play/a00m/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
    
    'espn_1': { 
        base: 'http://45.5.151.147:8000/play/a00i/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
    'espn_2': { 
        base: 'http://45.5.151.147:8000/play/a00j/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
    'espn_3': { 
        base: 'http://45.5.151.147:8000/play/a00k/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'tnt_premium': { 
        base: 'http://45.5.151.147:8000/play/a00r/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'tyc_arg': { 
        base: 'http://45.5.151.147:8000/play/a00s/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'foxsports_arg': { 
        base: 'http://45.5.151.147:8000/play/a00n/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'foxsports_arg3': { 
        base: 'http://45.5.151.147:8000/play/a00p/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'discovery_arg': { 
        base: 'http://45.5.151.147:8000/play/a01s/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
     'discoveryid_arg': { 
        base: 'http://45.5.151.147:8000/play/a01u/index.m3u8', 
        parametros: '',
        usarProxy: true // <-- Esto hace que pase por /proxy/stream
    },
    // 🔥 CANALES BOT (Puppeteer scraper)
    'espn_scraper1': {
        urlScraping: 'https://tvlibr3.com/en-vivo/espn-premium/',
        opcionesBotones: [
            ['Opción 3', 'Opción3'],
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
        ]
    },
 'espn_scraper2': {
    urlScraping: 'https://latamvidz1.com/canal.php?stream=espnpremium',
    opcionesBotones: [] // sin botones, el stream sale solo al cargar
},
    'dsports_scraper1': {
        urlScraping: 'https://tvlibr3.com/en-vivo/dsports/',
        opcionesBotones: [
            ['Opción 2', 'Opción2'],
        ]
    },
    'dsports_scraper2': {
    urlScraping: 'https://latamvidz1.com/canal.php?stream=dsports',
    opcionesBotones: []
},
    'tnt_scraper1': {
        urlScraping: 'https://tvlibr3.com/en-vivo/tnt-sports/',
        opcionesBotones: [
            ['Opción 2', 'Opción2'],
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
        ]
    },
    'tnt_scraper2': {
    urlScraping: 'https://latamvidz1.com/canal.php?stream=tntsports',
    opcionesBotones: []
},
    'fox_scraper1': {
    urlScraping: 'https://tvlibr3.com/en-vivo/fox-sports/',
    opcionesBotones: [
        ['Opción 3', 'Opcion 3', 'Opción3'],  // 🆕 Opción 3 primero — da .m3u8
        ['Opción 2', 'Opcion 2', 'Opción2'],  // 🆕 Opción 2 como fallback
    ]
},
    'fox_scraper2': {
    urlScraping: 'https://latamvidz1.com/canal.php?stream=foxsports',
    opcionesBotones: []
},
   'tyc_scraper1': {
    urlScraping: 'https://tvlibr3.com/en-vivo/tyc-sports/',
    opcionesBotones: [
        ['Opción 3', 'Opcion 3', 'Opción3'],
        ['Opción 2', 'Opcion 2', 'Opción2'],
    ]
},
    'tyc_scraper2': {
    urlScraping: 'https://latamvidz1.com/canal.php?stream=tycsports',
    opcionesBotones: []
},
    'telefe_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/telefe/',
        opcionesBotones: [
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
        ]
    },
    'eltrece_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/el-trece/',
        opcionesBotones: [
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
        ]
    },
    'elnueve_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/el-nueve/',
        opcionesBotones: [
            ['Opción 1 (FL)', 'Opcion 1 (FL)'],
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

// ⭐ Helper: detecta si una URL es un stream válido y descarta basura
function esStream(url) {
    if (!url || url === 'about:blank' || url === 'about:srcdoc') return false;
    
    // Ignorar típicas URLs de ads o tracking que a veces camuflan como m3u8
    const basura = ['ad', 'tracker', 'dummy', 'blank', 'pixel'];
    if (basura.some(palabra => url.toLowerCase().includes(palabra))) return false;

    return url.includes('.m3u8') || url.includes('.mpd');
}

// Helper: arma headers correctos según el dominio del stream
function armarHeaders(targetUrl) {
    // 🔥 NUEVO: Si es de latinapro o de la nueva IP de Boca TV, inyectamos su User-Agent obligatorio
    if (targetUrl.includes('latinapro.net') || targetUrl.includes('45.5.151.147')) {
        return {
            'User-Agent': 'bocatvplay.beta/9.8 (Linux;Android 11) AndroidXMedia3/1.1.1',
            'Referer': '', // Dejar vacío para evitar bloqueos por referer inválido
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
};

// 🔀 Ruta Proxy optimizada para Streaming (Cero latencia de memoria)
app.get('/proxy/stream', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send("Falta la URL de destino.");
    }

    try {
        // Usamos tu función armarHeaders para inyectar el User-Agent correcto
        const customHeaders = armarHeaders(targetUrl);

        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream', // 🔥 VITAL: No guarda en memoria, lo trata como un flujo de datos continuo
            headers: customHeaders,
            timeout: 15000 // Corta si el servidor original se cuelga
        });

        // Copiamos el Content-Type original (ej. video/MP2T o application/vnd.apple.mpegURL)
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }
        
        // Habilitamos CORS para que tu web no lo bloquee
        res.setHeader('Access-Control-Allow-Origin', '*');

        // 🔥 MAGIA PURA: Conectamos la manguera de entrada directo a la manguera de salida (pipe)
        // Esto evita que Render se sature guardando los fragmentos en la memoria RAM
        response.data.pipe(res);

    } catch (error) {
        console.error(`❌ Error en proxy para ${targetUrl}:`, error.message);
        
        // Solo respondemos con error si todavía no habíamos empezado a mandarle datos al reproductor
        if (!res.headersSent) {
            res.status(500).send("Error conectando con el servidor de origen.");
        }
    }
});

        const contentType = response.headers['content-type'] || '';
        console.log(`🔀 Proxy HTTP ${response.status}: ${targetUrl} [${contentType}]`);

        // A. SI ES UNA PLAYLIST (.m3u8) o DASH (.mpd)
        if (targetUrl.includes('.m3u8') || targetUrl.includes('.mpd') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || contentType.includes('dash+xml')) {
            let data = '';
            response.data.on('data', chunk => data += chunk);
            response.data.on('end', () => {
                
                // Si es m3u8 reescribimos las rutas inteligentemente
                if (targetUrl.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
                    let contenido = data.split('\n').map(linea => {
                        const l = linea.trim();
                        if (!l || l.startsWith('#')) return linea;
                        
                        // 🔥 MEJORA: Usamos la API URL nativa de Node para resolver rutas relativas perfectas
                        try {
                            const urlSegmento = new URL(l, targetUrl).href;
                            return `${API_URL}/proxy/stream?url=${encodeURIComponent(urlSegmento)}`;
                        } catch (e) {
                            return l; // Fallback por si la URL es rarísima
                        }
                    }).join('\n');

                    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.send(contenido);
                } else {
                    // Si es DASH, mandamos directo
                    res.setHeader('Content-Type', 'application/dash+xml');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.send(data);
                }
            });
            return;
        }

        // B. SI ES SEGMENTO DE VIDEO (.ts, .mp4, etc) -> Pipe directo en binario
        res.setHeader('Content-Type', contentType || 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        
        // 🔥 MEJORA CLAVE: Decirle al reproductor que aceptamos fragmentos
        res.setHeader('Accept-Ranges', 'bytes');
        
        if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
        if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
        
        if (response.status === 206) res.status(206);

        // Si la conexión se corta del lado del cliente, destruimos el stream para no saturar la RAM
        req.on('close', () => {
            if (!response.data.destroyed) {
                response.data.destroy();
            }
        });

        response.data.pipe(res);

    } catch (err) {
        console.error(`❌ Error en proxy para ${targetUrl}:`, err.message);
        res.status(502).send('Error al obtener el stream');
    }
});

// --- FUNCIÓN DEL BOT (aislada para la cola) ---
async function correrBot(datosCanal, canalId) {
    console.log(`🕵️‍♂️ Bot iniciando para: ${canalId}...`);
    console.log(`📊 RAM antes del bot: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);

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
            '--single-process',
            '--memory-pressure-off',
            '--js-flags=--max-old-space-size=128',
        ]
    });

    let linkVideoPuro = null;

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');

        // ⭐ Ahora detecta tanto .m3u8 como .mpd en todos los listeners
        browser.on('targetcreated', async (target) => {
            const newPage = await target.page();
            if (!newPage) return;
            await newPage.setRequestInterception(true).catch(() => {});
            newPage.on('request', (req) => {
                const url = req.url();
                if (esStream(url) && !linkVideoPuro) {
                    linkVideoPuro = url;
                    console.log(`🎯 Stream en TARGET nuevo: ${url}`);
                }
                req.continue().catch(() => {});
            });
            newPage.on('response', async (response) => {
                const url = response.url();
                if (esStream(url) && !linkVideoPuro) {
                    linkVideoPuro = url;
                    console.log(`🎯 Stream en RESPONSE TARGET: ${url}`);
                }
            });
        });

        await page.setRequestInterception(true);

        page.on('request', (req) => {
            const url = req.url();
            const resourceType = req.resourceType();
            
            // ⚠️ Quitamos 'media' para no bloquear la petición del playlist del video
            if (['image', 'stylesheet', 'font', 'websocket'].includes(resourceType)) {
                req.abort();
                return;
            }
            if (esStream(url) && !linkVideoPuro) {
                linkVideoPuro = url;
                console.log(`🎯 Stream en REQUEST principal: ${url}`);
            }
            req.continue().catch(() => {});
        });

        page.on('response', async (response) => {
            const url = response.url();
            if (esStream(url) && !linkVideoPuro) {
                linkVideoPuro = url;
                console.log(`🎯 Stream en RESPONSE principal: ${url}`);
            }
        });

        page.on('framenavigated', async (frame) => {
            const frameUrl = frame.url();
            // Ignorar frames en blanco explícitamente
            if (frameUrl === 'about:blank' || frameUrl === '') return;
            
            console.log(`📄 Frame: ${frameUrl}`);
            if (esStream(frameUrl) && !linkVideoPuro) linkVideoPuro = frameUrl;
        });

        console.log(`🌐 Navegando a: ${datosCanal.urlScraping}`);
        await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 1000));

        const gruposBotones = datosCanal.opcionesBotones || [];

        for (const variantes of gruposBotones) {
            if (linkVideoPuro) break;

            console.log(`\n🖱️ Intentando: ${JSON.stringify(variantes)}`);
            const clicOk = await clickBotonPorVariantes(page, variantes);

            if (clicOk) {
                console.log(`⏳ Esperando stream hasta 6s...`);
                let espera = 0;
                // Cambiamos a pasos de 100ms. 60 pasos = 6 segundos máximo.
                while (!linkVideoPuro && espera < 60) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    espera++;
                }
                if (linkVideoPuro) break;
                console.log(`⚠️ Sin stream con "${clicOk}", probando siguiente...`);
            }
        }

        // Fallback clics centro
        if (!linkVideoPuro) {
            console.log(`👆 Fallback clics centro...`);
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            await new Promise(resolve => setTimeout(resolve, 500)); // Espera más corta entre clics
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            
            let espera = 0;
            // 30 pasos de 100ms = 3 segundos máximo
            while (!linkVideoPuro && espera < 30) {
                await new Promise(resolve => setTimeout(resolve, 100));
                espera++;
            }
        }

    } finally {
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

            const linkVideoPuro = await encolarBot(() => correrBot(datosCanal, canalId));

            if (linkVideoPuro) {
                const urlFinal = `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;
                memoriaCache[canalId] = { url: urlFinal, tiempo: Date.now() };
                console.log(`✅ Listo: ${urlFinal}`);
                return res.json({ exito: true, url: urlFinal });
            } else {
                return res.status(500).json({ exito: false, mensaje: "El bot no encontró ningún stream (.m3u8 o .mpd)." });
            }

        // 🎬 MODO DASH
        } else if (datosCanal.dominio && datosCanal.token && datosCanal.ruta) {
            const urlCompleta = `${datosCanal.dominio}${datosCanal.token}${datosCanal.ruta}`;
            return res.json({ exito: true, url: urlCompleta });

       // 📡 MODO DIRECTO
        } else {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            
            // 🔥 Si el canal exige pasar por nuestro proxy para inyectar headers
            if (datosCanal.usarProxy) {
                const urlProxy = `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`;
                return res.json({ exito: true, url: urlProxy });
            }

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

    // 🔄 Auto-ping cada 14 minutos para mantener Render despierto
    setInterval(async () => {
        try {
            await axios.get(`${API_URL}/ping`);
            console.log('🏓 Ping enviado — servidor activo');
        } catch (e) {
            console.log('⚠️ Ping fallido:', e.message);
        }
    }, 14 * 60 * 1000);
});