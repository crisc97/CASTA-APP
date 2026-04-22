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
        base: 'https://antv10.ddns.net/hls/stream.m3u8',
        parametros: 'v=1776625742405'
    },
    'tnt_2': {
        base: 'AQUI_VA_EL_LINK_DE_TNT_OPCION_2',
        parametros: 'v=xyz' // Reemplazar con el parámetro real si tiene
    },
    'tnt_3': {
        base: 'AQUI_VA_EL_LINK_DE_TNT_OPCION_3',
        parametros: 'v=xyz' // Reemplazar con el parámetro real si tiene
    },

    // --- ESPN PREMIUM ---
    'espn_1': {
        base: 'https://kh5vy.envivoslatam.org/espnpremium/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=d62ed86a56a0d0ff40d8feeb4b0590f74c83c28c-12-1776601177-1776547177'
    },
    'espn_2': {
        base: 'https://smjt9q.envivoslatam.org/hotflix/espnpremium/index.m3u8',
        parametros: 'ip=xyz&token=xyz' // Reemplazar con el parámetro real si tiene
     },    
    'espn_3': {
        base: 'AQUI_VA_EL_LINK_DE_ESPN_OPCION_3',
        parametros: 'ip=xyz&token=xyz' // Reemplazar con el parámetro real si tiene
    },

    // --- DSPORTS ---
    'dsports_1': {
        base: 'https://j8nte.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=0b8484e94d78af9184c60015330fa06fbff9749e-3c-1776600035-1776546035'
    },
    'dsports_2': {
        base: 'AQUI_VA_EL_LINK_DE_DSPORTS_OPCION_2',
        parametros: 'ip=xyz&token=xyz' // Reemplazar con el parámetro real si tiene
     },
    'dsports_3': {
        base: 'AQUI_VA_EL_LINK_DE_DSPORTS_OPCION_3',
        parametros: 'ip=xyz&token=xyz' // Reemplazar con el parámetro real si tiene
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