const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

// 1. PRIMERO CREAMOS LA VARIABLE 'app' (¡Esto era lo que faltaba!)
const app = express();

// 2. LUEGO LE APLICAMOS LOS MIDDLEWARES Y EL CORS LIBRE
app.use(cors({ origin: '*' }));
app.use(express.json()); 

const PORT = process.env.PORT || 3000;

// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    // --- TNT SPORTS ---
    'tnt_1': {
        base: 'https://serviciosatv78.ddns.net/live/stream.m3u8',
        parametros: ''
    },
    'tnt_2': {
        base: 'https://tk0hz.envivoslatam.org/hotflix/tntsports/index.m3u8',
        parametros: 'token=2d31ee61fa39e8f26d1ae2817536cdfaa0304243-1e-1776893748-1776839748'
    },
    'tnt_3': {
        base: 'https://cdn2.zohanayaan.com:1686/hls/tntarg.m3u8',
        parametros: 'md5=2JItcM4Z7jUmJVO9EcYyAA&expires=1776856069'
    },

    // --- ESPN PREMIUM ---
    'espn_1': {
        base: 'https://deportes.ksdjugfsddeports.com:9092/MTgxLjIyOC45MC4xOTU=/5_.m3u8',
        parametros: 'token=_hoXlZBpvnPFpXqkXpj5Tg&expires=1777011046'
    },
    'espn_2': {
        dominio: 'https://edge-live03-hr.cvattv.com.ar/',
        token: 'tok_eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOiIxNzc3MTUxNjE2Iiwic2lwIjoiMTgxLjIyOC45MC4xOTUiLCJwYXRoIjoiL2xpdmUvYzdlZHMvRm94X1Nwb3J0c19QcmVtaXVuX0hEL1NBX0xpdmVfZGFzaF9lbmNfQy8iLCJzZXNzaW9uX2Nkbl9pZCI6IjM0NTUyMGVkYjUxMDFhYTIiLCJzZXNzaW9uX2lkIjoiIiwiY2xpZW50X2lkIjoiIiwiZGV2aWNlX2lkIjoiIiwibWF4X3Nlc3Npb25zIjowLCJzZXNzaW9uX2R1cmF0aW9uIjowLCJ1cmwiOiJodHRwczovLzE4MS4xMi4zNi4xNTAiLCJhdWQiOiIyOTYiLCJzb3VyY2VzIjpbODUsMTQ0LDg2LDg4XX0=.7jnZqLSgob2q-NhgBBrAD8MNwd5Lpwjo3xlmLqWEzQ835_Q9p6YLZRohnJFpbog3SUitFdnpnlBh6QxLwtcAIQ==/',
        ruta: 'live/c7eds/Fox_Sports_Premiun_HD/SA_Live_dash_enc_C/Fox_Sports_Premiun_HD.mpd'
    },  
    'espn_3': {
        base: 'https://cdn4.zohanayaan.com:1686/hls/espnar.m3u8',
        parametros: 'md5=iJutx_apVGzpxL9Chcs-kA&expires=1776856173'
    },
    // 🔥 CANAL AUTOMÁTICO (BOT SCRAPER)
    'espn_scraper': {
        urlScraping: 'https://tvlibr3.com/en-vivo/espn-premium/', 
        selectorScraping: 'iframe#iframe'
    },

    // --- DSPORTS ---
    'dsports_1': {
        base: 'https://deportes.ksdjugfsddeports.com:9092/MTgxLjIyOC45MC4xOTU=/3_.m3u8',
        parametros: 'token=BWsZ9wuhVtu2q0f-H3_08A&expires=1776880331'
    },
    'dsports_2': {
        base: 'https://vg7ie.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
        parametros: 'token=df20d1345ddf914c84aa7caced8870ce365e82af-9a-1776893584-1776839584'
    },
    'dsports_3': {
        base: 'https://cdn4.zohanayaan.com:1686/hls/dsportshd1.m3u8',
        parametros: 'md5=RgzpbSywI-eUiFOwnwx0dw&expires=1776855896'
    }
};

// --- RUTA INTELIGENTE PARA OBTENER ENLACES ---
app.get('/api/get-stream/:canal', async (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    
    if (!datosCanal) {
        return res.status(404).json({ exito: false, mensaje: "Canal no encontrado en la base de datos" });
    }

    try {
        // 🤖 CASO 1: ES UN CANAL AUTOMÁTICO (SCRAPER CON PUPPETEER)
        if (datosCanal.urlScraping) {
            console.log(`Ejecutando Bot Scraper (Navegador Real) para: ${canalId}`);
            
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36');
            
            try {
                // AQUÍ ESTÁ EL CAMBIO DE TIEMPOS ⏳
                await page.goto(datosCanal.urlScraping, { waitUntil: 'domcontentloaded', timeout: 60000 });
                await page.waitForSelector(datosCanal.selectorScraping, { timeout: 15000 });
                
                let enlaceExtraido = await page.evaluate((selector) => {
                    const elemento = document.querySelector(selector);
                    return elemento ? elemento.src : null;
                }, datosCanal.selectorScraping);

                await browser.close();

                if (enlaceExtraido) {
                    if (enlaceExtraido.startsWith('/')) {
                        const urlBase = new URL(datosCanal.urlScraping).origin;
                        enlaceExtraido = urlBase + enlaceExtraido;
                    }
                    return res.json({ exito: true, url: enlaceExtraido });
                } else {
                    return res.status(404).json({ exito: false, mensaje: "El iframe no apareció en la página web." });
                }

            } catch (err) {
                await browser.close();
                console.error("Error en el navegador:", err.message);
                return res.status(404).json({ exito: false, mensaje: "La página bloqueó al bot o el video tardó mucho." });
            }
        } 
        // 📺 CASO 2: ES UN CANAL NORMAL (ESTÁTICO)
        else {
            let urlFinal = "";
            if (datosCanal.dominio && datosCanal.ruta) {
                urlFinal = datosCanal.dominio + datosCanal.token + datosCanal.ruta;
            } else {
                urlFinal = datosCanal.parametros ? `${datosCanal.base}?${datosCanal.parametros}` : datosCanal.base;
            }
            return res.json({ exito: true, url: urlFinal });
        }
    } catch (error) {
        console.error(`Error procesando el canal ${canalId}:`, error.message);
        res.status(500).json({ exito: false, mensaje: "Error interno del servidor al procesar el canal." });
    }
});

// --- RUTA PRINCIPAL DE BIENVENIDA ---
app.get('/', (req, res) => { 
    res.send('<h1>🚀 Servidor CASTA-APP PRO Online</h1><p>Sistema de subcanales y alertas activo.</p>'); 
});

// --- RUTA PARA RECIBIR ALERTAS Y ENVIAR MAIL ---
app.post('/api/reportar', async (req, res) => {
    const { canal } = req.body;
    if (!canal) return res.status(400).json({ error: "Falta el nombre del canal" });

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail', 
            auth: {
                user: process.env.MI_CORREO, 
                pass: process.env.MI_CONTRASENA 
            }
        });

        const mailOptions = {
            from: `"App Casta" <${process.env.MI_CORREO}>`,
            to: process.env.MI_CORREO, 
            subject: `🚨 ALERTA CASTA-APP: Falló ${canal}`,
            text: `Hola,\n\nUn usuario acaba de reportar desde la App que el canal:\n\n👉 "${canal}"\n\nNo carga o está caído.\n\nPor favor, revisa tu servidor y actualiza el enlace.\n\nSaludos,\nTu Servidor Bot 🤖`
        };

        await transporter.sendMail(mailOptions);
        console.log(`[ALERTA ENVIADA] Correo enviado por falla en: ${canal}`);
        res.json({ exito: true, mensaje: "Reporte enviado correctamente" });

    } catch (error) {
        console.error("[ERROR] No se pudo enviar el correo:", error);
        res.status(500).json({ exito: false, error: "Error interno del servidor al enviar correo" });
    }
});

// --- INICIAR SERVIDOR ---
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Servidor corriendo sin problemas en el puerto ${PORT}`); 
});