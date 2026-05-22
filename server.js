const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer');
const path = require('path');
const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_URL = process.env.API_URL || 'https://casta-app.onrender.com';

// ============================================================
// INDEX
// ============================================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// PING
// ============================================================

app.get('/ping', (req, res) => {
    res.send('ok');
});

// ============================================================
// CACHE
// ============================================================

const memoriaCache = {};

app.get('/api/clear-cache/:canal', (req, res) => {

    const canalId = req.params.canal;

    if (memoriaCache[canalId]) {
        delete memoriaCache[canalId];
        console.log(`🗑️ Caché eliminada: ${canalId}`);
    }

    res.json({ ok: true });

});

// ============================================================
// BASE DE CANALES
// ============================================================

const dbCanales = {

    'tnt_1': {
        base: 'https://anden26.ddns.net/live/stream.m3u8',
        parametros: 'v=1777146764944'
    },

    'telefe_directo': {
        base: 'http://45.5.151.147:8000/play/a00g/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'eltrece_directo': {
        base: 'http://45.5.151.147:8000/play/a00g/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'elnueve_directo': {
        base: 'http://45.5.151.147:8000/play/a00e/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'america_directo': {
        base: 'http://45.5.151.147:8000/play/a00c/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'tvpublica_directo': {
        base: 'http://45.5.151.147:8000/play/a00h/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'espn_premium': {
        base: 'http://45.5.151.147:8000/play/a00m/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'espn_1': {
        base: 'http://45.5.151.147:8000/play/a00i/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'espn_2': {
        base: 'http://45.5.151.147:8000/play/a00j/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'espn_3': {
        base: 'http://45.5.151.147:8000/play/a00k/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'tnt_premium': {
        base: 'http://45.5.151.147:8000/play/a00r/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'tyc_arg': {
        base: 'http://45.5.151.147:8000/play/a00s/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'foxsports_arg': {
        base: 'http://45.5.151.147:8000/play/a00n/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    'foxsports_arg3': {
        base: 'http://45.5.151.147:8000/play/a00p/index.m3u8',
        parametros: '',
        usarProxy: true
    },

    // ============================================================
    // SCRAPERS
    // ============================================================

    'espn_scraper1': {
        urlScraping: 'https://tvlibr3.com/en-vivo/espn-premium/',
        opcionesBotones: [
            ['Opción 3', 'Opción3'],
            ['Opción 1 (FL)', 'Opcion 1 (FL)']
        ]
    },

    'tnt_scraper1': {
        urlScraping: 'https://tvlibr3.com/en-vivo/tnt-sports/',
        opcionesBotones: [
            ['Opción 2', 'Opción2']
        ]
    }

};

// ============================================================
// COLA BOTS
// ============================================================

let botEnEjecucion = false;
const colaDeBots = [];

function ejecutarSiguienteBot() {

    if (botEnEjecucion || colaDeBots.length === 0) {
        return;
    }

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

                ejecutarSiguienteBot();

            }

        });

        ejecutarSiguienteBot();

    });

}

// ============================================================
// DETECTAR STREAM
// ============================================================

function esStream(url) {

    if (!url) return false;

    return (
        url.includes('.m3u8') ||
        url.includes('.mpd')
    );

}

// ============================================================
// HEADERS IPTV
// ============================================================

function armarHeaders(targetUrl) {

    return {

        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',

        'Accept': '*/*',

        'Connection': 'keep-alive',

        'Accept-Encoding': 'identity',

        'Origin': '*',

        'Referer': targetUrl

    };

}

// ============================================================
// PROXY IPTV HLS
// ============================================================

app.get('/proxy/stream', async (req, res) => {

    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).send('Falta URL');
    }

    try {

        const headers = armarHeaders(targetUrl);

        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        const response = await axios({

            method: 'GET',

            url: targetUrl,

            responseType: 'stream',

            headers,

            timeout: 20000,

            validateStatus: status =>
                status >= 200 && status < 500

        });

        const contentType =
            response.headers['content-type'] || '';

        console.log(`📡 ${targetUrl}`);

        console.log(`📦 ${contentType}`);

        // =====================================================
        // PLAYLIST M3U8
        // =====================================================

        if (
            targetUrl.includes('.m3u8') ||
            contentType.includes('mpegurl') ||
            contentType.includes('x-mpegURL')
        ) {

            let playlist = '';

            response.data.on('data', chunk => {
                playlist += chunk.toString();
            });

            response.data.on('end', () => {

                const nuevaPlaylist = playlist
                    .split('\n')
                    .map(linea => {

                        const l = linea.trim();

                        if (!l) return linea;

                        // =====================================================
                        // COMENTARIOS HLS
                        // =====================================================

                        if (l.startsWith('#')) {

                            // =====================================================
                            // KEYS PROXY
                            // =====================================================

                            if (l.startsWith('#EXT-X-KEY')) {

                                const match =
                                    l.match(/URI="([^"]+)"/);

                                if (match) {

                                    try {

                                        const keyUrl =
                                            new URL(
                                                match[1],
                                                targetUrl
                                            ).href;

                                        const proxyKey =
                                            `${API_URL}/proxy/stream?url=${encodeURIComponent(keyUrl)}`;

                                        return l.replace(
                                            `URI="${match[1]}"`,
                                            `URI="${proxyKey}"`
                                        );

                                    } catch (e) {
                                        return l;
                                    }

                                }

                            }

                            return l;

                        }

                        // =====================================================
                        // 🔥 SEGMENTOS DIRECTOS
                        // =====================================================

                        try {

                            const absoluteUrl =
                                new URL(l, targetUrl).href;

                            return absoluteUrl;

                        } catch (e) {

                            return l;

                        }

                    })
                    .join('\n');

                res.setHeader(
                    'Content-Type',
                    'application/vnd.apple.mpegurl'
                );

                res.setHeader(
                    'Access-Control-Allow-Origin',
                    '*'
                );

                res.setHeader(
                    'Access-Control-Allow-Headers',
                    '*'
                );

                res.setHeader(
                    'Access-Control-Allow-Methods',
                    '*'
                );

                res.setHeader(
                    'Cache-Control',
                    'no-cache'
                );

                res.send(nuevaPlaylist);

            });

            return;

        }

        // =====================================================
        // DASH MPD
        // =====================================================

        if (
            targetUrl.includes('.mpd') ||
            contentType.includes('dash+xml')
        ) {

            res.setHeader(
                'Content-Type',
                'application/dash+xml'
            );

            res.setHeader(
                'Access-Control-Allow-Origin',
                '*'
            );

            response.data.pipe(res);

            return;

        }

        // =====================================================
        // VIDEO / TS
        // =====================================================

        res.setHeader(
            'Content-Type',
            contentType || 'video/mp2t'
        );

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        );

        res.setHeader(
            'Access-Control-Allow-Headers',
            '*'
        );

        res.setHeader(
            'Access-Control-Allow-Methods',
            '*'
        );

        res.setHeader(
            'Accept-Ranges',
            'bytes'
        );

        if (response.headers['content-range']) {

            res.setHeader(
                'Content-Range',
                response.headers['content-range']
            );

        }

        if (response.status === 206) {
            res.status(206);
        }

        req.on('close', () => {

            try {

                if (!response.data.destroyed) {
                    response.data.destroy();
                }

            } catch (e) {}

        });

        response.data.pipe(res);

    } catch (err) {

        console.error('❌ ERROR PROXY:', err.message);

        if (!res.headersSent) {

            res.status(500).json({
                exito: false,
                error: err.message
            });

        }

    }

});

// ============================================================
// FUNCION PARA HACER CLIC EN LOS BOTONES DEL SCRAPER
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
    } catch (e) {
        return null;
    }
}

// ============================================================
// BOT SCRAPER
// ============================================================

async function correrBot(datosCanal, canalId) {

    console.log(`🕵️ BOT: ${canalId}`);

    const browser = await puppeteer.launch({

        headless: true,

        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu'
        ]

    });

    let linkVideoPuro = null;

    try {

        const page = await browser.newPage();

        await page.setViewport({
            width: 800,
            height: 600
        });

        await page.setRequestInterception(true);

        page.on('request', req => {

            const url = req.url();

            if (
                ['image', 'stylesheet', 'font']
                .includes(req.resourceType())
            ) {

                req.abort();

                return;

            }

            if (
                esStream(url) &&
                !linkVideoPuro
            ) {

                linkVideoPuro = url;

            }

            req.continue();

        });

        await page.goto(
            datosCanal.urlScraping,
            {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            }
        );

        // Esperamos a que cargue la página
        await new Promise(r => setTimeout(r, 1000));

        // Leemos los botones que configuraste en dbCanales y los clickeamos
        for (const variantes of (datosCanal.opcionesBotones || [])) {
            if (linkVideoPuro) break;
            const clicOk = await clickBotonPorVariantes(page, variantes);
            if (clicOk) {
                // Si hizo clic, esperamos un poco a ver si aparece el video
                let espera = 0;
                while (!linkVideoPuro && espera < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    espera++;
                }
            }
        }

        // Clic de emergencia en el medio de la pantalla por si hay publicidad superpuesta
        if (!linkVideoPuro) {
            const viewport = page.viewport();
            await page.mouse.click(viewport.width / 2, viewport.height / 2);
            await new Promise(r => setTimeout(r, 3000));
        }

    } finally {

        try {

            await browser.close();

        } catch (e) {}

    }

    return linkVideoPuro;

}

// ============================================================
// API STREAM
// ============================================================

app.get('/api/get-stream/:canal', async (req, res) => {

    const canalId = req.params.canal;

    const datosCanal = dbCanales[canalId];

    if (!datosCanal) {

        return res.status(404).json({
            exito: false
        });

    }

    try {

        // =====================================================
        // BOT
        // =====================================================

        if (datosCanal.urlScraping) {

            const ahora = Date.now();

            if (
                memoriaCache[canalId] &&
                (ahora - memoriaCache[canalId].tiempo < 7200000)
            ) {

                return res.json({
                    exito: true,
                    url: memoriaCache[canalId].url
                });

            }

            const linkVideoPuro =
                await encolarBot(() =>
                    correrBot(datosCanal, canalId)
                );

            if (linkVideoPuro) {

                const urlFinal =
                    `${API_URL}/proxy/stream?url=${encodeURIComponent(linkVideoPuro)}`;

                memoriaCache[canalId] = {
                    url: urlFinal,
                    tiempo: Date.now()
                };

                return res.json({
                    exito: true,
                    url: urlFinal
                });

            }

            return res.status(500).json({
                exito: false
            });

        }

        // =====================================================
        // STREAM NORMAL
        // =====================================================

        const separador =
            datosCanal.parametros
                ? '?'
                : '';

        const urlCompleta =
            `${datosCanal.base}${separador}${datosCanal.parametros}`;

        if (datosCanal.usarProxy) {

            return res.json({

                exito: true,

                url:
                    `${API_URL}/proxy/stream?url=${encodeURIComponent(urlCompleta)}`

            });

        }

        return res.json({

            exito: true,

            url: urlCompleta

        });

    } catch (error) {

        return res.status(500).json({

            exito: false,

            error: error.message

        });

    }

});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {

    console.log(
        `🚀 Servidor IPTV iniciado en puerto ${PORT}`
    );

    setInterval(async () => {

        try {

            await axios.get(`${API_URL}/ping`);

        } catch (e) {}

    }, 14 * 60 * 1000);

});