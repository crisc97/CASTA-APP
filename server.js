const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    'dsports': {
        base: 'https://j8nte.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=0b8484e94d78af9184c60015330fa06fbff9749e-3c-1776600035-1776546035'
    },
    'tnt': {
        base: 'https://bd2ih.envivoslatam.org/tntsports/tracks-v1a1/mono.m3u8',
        parametros: 'ip=181.228.90.195&token=8e2d37e7d6ff7c74dfb48cec3b61ebdb43c1c62a-0d-1776600674-1776546674'
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

app.listen(PORT, '0.0.0.0', () => { 
    console.log(`Servidor corriendo en puerto ${PORT}`); 
});