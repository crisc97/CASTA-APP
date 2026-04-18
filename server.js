const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- BASE DE DATOS DE CANALES ---
const dbCanales = {
    // Aquí pegamos la parte de la URL antes del signo "?"
    'dsports': 'https://j8nte.envivoslatam.org/dsports/tracks-v1a1/mono.m3u8',
    'tnt': 'https://j8nte.envivoslatam.org/hotflix/tntsports/index.m3u8',
    'espn': 'https://j8nte.envivoslatam.org/hotflix/espnpremium/index.m3u8',
    'fox': 'https://j8nte.envivoslatam.org/hotflix/foxsports/index.m3u8'
};

app.get('/api/get-stream/:canal', (req, res) => {
    const canalId = req.params.canal;
    const baseUrl = dbCanales[canalId];
    
    // --- AQUÍ PEGAS LO QUE VA DESPUÉS DEL "?" ---
    // He incluido el IP y el Token que me pasaste
    const parametros = "ip=181.228.90.195&token=0b8484e94d78af9184c60015330fa06fbff9749e-3c-1776600035-1776546035";
    
    if (baseUrl) {
        res.json({ 
            exito: true, 
            url: `${baseUrl}?${parametros}` 
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