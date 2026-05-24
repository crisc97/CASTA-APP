const fs = require('fs');

// 1. Leemos el archivo M3U que creaste recién
const contenidoM3U = fs.readFileSync('lista_prueba.m3u', 'utf8');

// 2. Le pegamos a tu propio servidor (asegurate de tener node server.js corriendo en otra pestaña)
fetch('http://localhost:3000/api/convertir-m3u', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: contenidoM3U
})
.then(res => res.json())
.then(data => {
    // 3. Guardamos el resultado en un archivo JSON nuevo
    fs.writeFileSync('canales_convertidos.json', JSON.stringify(data, null, 2));
    console.log("¡Éxito! Revisá el archivo canales_convertidos.json");
})
.catch(err => console.error("Error:", err));