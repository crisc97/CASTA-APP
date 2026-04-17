const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// --- BASE DE DATOS DE CANALES (Deben coincidir con los IDs del index.html) ---
const dbCanales = {
    'dsports': 'https://j8nte.envivoslatam.org/hotflix/dsports/index.m3u8',
    'tnt': 'https://j8nte.envivoslatam.org/hotflix/tntsports/index.m3u8',
    'espn': 'https://j8nte.envivoslatam.org/hotflix/espnpremium/index.m3u8',
    'fox': 'https://j8nte.envivoslatam.org/hotflix/foxsports/index.m3u8'
};

// Ruta corregida para que coincida con lo que pide el index.html
app.get('/api/get-stream/:canal', (req, res) => {
    const canalId = req.params.canal;
    const baseUrl = dbCanales[canalId];
    
    // El token que encontraste
    const tokenFresco = "967ba5cfcfa26d227db233168c6187541f049a90-99-1776491791-1776437791";
    
    if (baseUrl) {
        console.log(`Enviando señal de: ${canalId}`);
        res.json({ 
            exito: true, 
            url: `${baseUrl}?token=${tokenFresco}` 
        });
    } else {
        console.log(`Canal no encontrado: ${canalId}`);
        res.status(404).json({ exito: false, mensaje: "Canal no registrado en el servidor" });
    }
});

// Ruta raíz para verificar que el servidor está vivo
app.get('/', (req, res) => { 
    res.send('🚀 Servidor CASTA-APP funcionando. Rutas listas para dsports, tnt, espn y fox.'); 
});

app.listen(PORT, '0.0.0.0', () => { 
    console.log('Servidor CASTA-APP corriendo en puerto ' + PORT); 
});