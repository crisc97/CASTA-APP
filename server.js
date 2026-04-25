const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');

// 1. CREAMOS LA VARIABLE 'app'
const app = express();

// 2. MIDDLEWARES
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Ruta principal para mostrar tu interfaz web
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

// --- RUTA INTELIGENTE PARA OBTENER ENLACES ---
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    
    if (!datosCanal) {
        return res.status(404).json({ exito: false, mensaje: "Canal no encontrado en la base de datos" });
    }

    try {
        if (datosCanal.urlScraping) {
            const ahora = Date.now();
            if (memoriaCache[canalId] && (ahora - memoriaCache[canalId].tiempo < 7200000)) {
                return res.json({ exito: true, url: memoriaCache[canalId].url });
            }

            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });

            try {
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
                await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForSelector(datosCanal.selectorScraping, { timeout: 10000 });
                const linkLimpio = await page.$eval(datosCanal.selectorScraping, iframe => iframe.src);

                memoriaCache[canalId] = { url: linkLimpio, tiempo: Date.now() };
                await browser.close();
                
                return res.json({ exito: true, url: linkLimpio });

            } catch (errorBot) {
                await browser.close();
                console.error("Error dentro del Bot Puppeteer:", errorBot.message);
                return res.status(500).json({ exito: false, mensaje: "El bot no pudo extraer el video." });
            }

        } else if (datosCanal.dominio && datosCanal.token && datosCanal.ruta) {
            const urlCompleta = `${datosCanal.dominio}${datosCanal.token}${datosCanal.ruta}`;
            return res.json({ exito: true, url: urlCompleta });

        } else {
            const separador = datosCanal.parametros ? '?' : '';
            const urlCompleta = `${datosCanal.base}${separador}${datosCanal.parametros}`;
            return res.json({ exito: true, url: urlCompleta });
        }

    } catch (error) { 
        console.error("Error general:", error);
        return res.status(500).json({ exito: false, error: error.message });
    }
}); 

// --- ENCENDIDO DEL SERVIDOR ---
app.listen(PORT, () => {
    console.log(`🚀 Servidor de Casta-App corriendo en el puerto ${PORT}`);
});