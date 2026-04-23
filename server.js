const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// MIDDLEWARES (Muy importante express.json para que el botón de Reportar pueda enviar datos)
app.use(cors());
app.use(express.json()); 

// --- BASE DE DATOS DE CANALES (Alineada con el nuevo index.html) ---
const dbCanales = {
    // --- TNT SPORTS ---
    'tnt_1': {
        base: 'https://anden26.ddns.net/hls/stream.m3u8',
        parametros: 'v=1776976805930'
    },
    'tnt_2': {
        base: 'https://tk0hz.envivoslatam.org/hotflix/tntsports/index.m3u8',
        parametros: 'token=2d31ee61fa39e8f26d1ae2817536cdfaa0304243-1e-1776893748-1776839748' // Reemplazar con el parámetro real si tiene
    },
    'tnt_3': {
        base: 'https://cdn2.zohanayaan.com:1686/hls/tntarg.m3u8',
        parametros: 'md5=2JItcM4Z7jUmJVO9EcYyAA&expires=1776856069' // Reemplazar con el parámetro real si tiene
    },

    // --- ESPN PREMIUM ---
    'espn_1': {
        base: 'https://deportes.ksdjugfsddeports.com:9092/MTgxLjIyOC45MC4xOTU=/5_.m3u8',
        parametros: 'token=_hoXlZBpvnPFpXqkXpj5Tg&expires=1777011046'
    },
    'espn_2': {
        base: 'https://edge-live03-hr.cvattv.com.ar/tok_eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJleHAiOiIxNzc3MTUxNjE2Iiwic2lwIjoiMTgxLjIyOC45MC4xOTUiLCJwYXRoIjoiL2xpdmUvYzdlZHMvRm94X1Nwb3J0c19QcmVtaXVuX0hEL1NBX0xpdmVfZGFzaF9lbmNfQy8iLCJzZXNzaW9uX2Nkbl9pZCI6IjM0NTUyMGVkYjUxMDFhYTIiLCJzZXNzaW9uX2lkIjoiIiwiY2xpZW50X2lkIjoiIiwiZGV2aWNlX2lkIjoiIiwibWF4X3Nlc3Npb25zIjowLCJzZXNzaW9uX2R1cmF0aW9uIjowLCJ1cmwiOiJodHRwczovLzE4MS4xMi4zNi4xNTAiLCJhdWQiOiIyOTYiLCJzb3VyY2VzIjpbODUsMTQ0LDg2LDg4XX0=.7jnZqLSgob2q-NhgBBrAD8MNwd5Lpwjo3xlmLqWEzQ835_Q9p6YLZRohnJFpbog3SUitFdnpnlBh6QxLwtcAIQ==/live/c7eds/Fox_Sports_Premiun_HD/SA_Live_dash_enc_C/Fox_Sports_Premiun_HD.mpd',
        parametros: 'token=E9L55MEInA9i5_rr8YRNUQ&expires=1776880162' // Reemplazar con el parámetro real si tiene
     },    
    'espn_3': {
        base: 'https://cdn4.zohanayaan.com:1686/hls/espnar.m3u8',
        parametros: 'md5=iJutx_apVGzpxL9Chcs-kA&expires=1776856173' // Reemplazar con el parámetro real si tiene
    },

    // --- DSPORTS ---
    'dsports_1': {
        base: 'https://deportes.ksdjugfsddeports.com:9092/MTgxLjIyOC45MC4xOTU=/3_.m3u8',
        parametros: 'token=BWsZ9wuhVtu2q0f-H3_08A&expires=1776880331'
    },
    'dsports_2': {
        base: 'https://vg7ie.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
        parametros: 'token=df20d1345ddf914c84aa7caced8870ce365e82af-9a-1776893584-1776839584' // Reemplazar con el parámetro real si tiene
     },
    'dsports_3': {
        base: 'https://cdn4.zohanayaan.com:1686/hls/dsportshd1.m3u8',
        parametros: 'md5=RgzpbSywI-eUiFOwnwx0dw&expires=1776855896' // Reemplazar con el parámetro real si tiene
    }
};

// --- RUTA PARA OBTENER EL ENLACE DEL CANAL ---
app.get('/api/get-stream/:canal', (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    
    if (datosCanal) {
        // Si no hay parámetros definidos para las opciones de repuesto, solo enviamos la base
        let urlFinal = datosCanal.parametros ? `${datosCanal.base}?${datosCanal.parametros}` : datosCanal.base;
        
        res.json({ 
            exito: true, 
            url: urlFinal 
        });
    } else {
        res.status(404).json({ exito: false, mensaje: "Canal no encontrado en la base de datos" });
    }
});

// --- RUTA PRINCIPAL DE BIENVENIDA ---
app.get('/', (req, res) => { 
    res.send('<h1>🚀 Servidor CASTA-APP PRO Online</h1><p>Sistema de subcanales y alertas activo.</p>'); 
});

// --- RUTA PARA RECIBIR ALERTAS Y ENVIAR MAIL ---
app.post('/api/reportar', async (req, res) => {
    const { canal } = req.body;

    if (!canal) {
        return res.status(400).json({ error: "Falta el nombre del canal" });
    }

    try {
        // 1. Configuramos quién envía el correo
        const transporter = nodemailer.createTransport({
            service: 'gmail', 
            auth: {
                user: process.env.MI_CORREO, 
                pass: process.env.MI_CONTRASENA 
            }
        });

        // 2. Armamos el correo
        const mailOptions = {
            from: `"App Casta" <${process.env.MI_CORREO}>`,
            to: process.env.MI_CORREO, // Te lo envías a ti mismo
            subject: `🚨 ALERTA CASTA-APP: Falló ${canal}`,
            text: `Hola,\n\nUn usuario acaba de reportar desde la App que el canal y opción:\n\n👉 "${canal}"\n\nNo carga o está caído.\n\nPor favor, revisa tu servidor y actualiza el enlace.\n\nSaludos,\nTu Servidor Bot 🤖`
        };

        // 3. Enviamos el correo
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