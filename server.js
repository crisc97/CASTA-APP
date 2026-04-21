const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;
const nodemailer = require('nodemailer');

app.use(cors());

// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    'dsports': {
        base: 'https://j8nte.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=0b8484e94d78af9184c60015330fa06fbff9749e-3c-1776600035-1776546035'
    },
    'tnt': {
        // AQUÍ REEMPLAZAMOS CON TU NUEVO ENLACE
        base: 'https://antv10.ddns.net/hls/stream.m3u8',
        parametros: 'v=1776625742405'
    },
    'espn': {
        base: 'https://kh5vy.envivoslatam.org/espnpremium/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=d62ed86a56a0d0ff40d8feeb4b0590f74c83c28c-12-1776601177-1776547177' // Actualizar cuando lo busques
    },
    'fox': {
        base: 'https://wf6kt.envivoslatam.org/foxsports/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=9aaf0c939f786e629d2fa948addcd760f6c1a75a-cb-1776601238-1776547238' // Actualizar cuando lo busques
    }
};

app.get('/api/get-stream/:canal', (req, res) => {
    const canalId = req.params.canal;
    const datosCanal = dbCanales[canalId];
    
    if (datosCanal) {
        res.json({ 
            exito: true, 
            url: `${datosCanal.base}?${datosCanal.parametros}` 
        });
    } else {
        res.status(404).json({ exito: false, mensaje: "Canal no encontrado" });
    }
});

app.get('/', (req, res) => { 
    res.send('<h1>🚀 Servidor CASTA-APP Online</h1>'); 
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
                user: process.env.MI_CORREO, // Se configura en Render
                pass: process.env.MI_CONTRASENA // Se configura en Render
            }
        });

        // 2. Armamos el correo
        const mailOptions = {
            from: `"App Casta" <${process.env.MI_CORREO}>`,
            to: process.env.MI_CORREO, // Te lo envías a ti mismo (o pon otro mail aquí)
            subject: `🚨 ALERTA CASTA-APP: El canal ${canal} está fallando`,
            text: `Hola,\n\nUn usuario acaba de reportar desde la App que el canal "${canal}" no carga o está caído.\n\nPor favor, revisa y actualiza el enlace.\n\nSaludos,\nTu Servidor Bot 🤖`
        };

        // 3. Enviamos el correo
        await transporter.sendMail(mailOptions);
        
        console.log(`[ALERTA] Correo enviado por falla en: ${canal}`);
        res.json({ exito: true, mensaje: "Reporte enviado" });

    } catch (error) {
        console.error("[ERROR] No se pudo enviar el correo:", error);
        res.status(500).json({ exito: false, error: "Error interno del servidor" });
    }
});

app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Servidor corriendo en puerto ${PORT}`); 
});