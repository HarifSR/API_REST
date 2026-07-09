const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Importar Rutas
const authRoutes = require('./routes/auth');
const productosRoutes = require('./routes/productos'); // <-- AÑADE ESTA LÍNEA

// Usar Rutas
app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes); // <-- AÑADE ESTA LÍNEA

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('🛠️ API de FerreSistema funcionando correctamente');
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});