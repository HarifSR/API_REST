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
const ventasRoutes = require('./routes/ventas');
const reportesRoutes = require('./routes/reportes');
const categoriasRoutes = require('./routes/categorias');
const unidadesRoutes = require('./routes/unidades');

// Usar Rutas
app.use('/api/auth', authRoutes);
app.use('/api/productos', productosRoutes); // <-- AÑADE ESTA LÍNEA
app.use('/api/ventas', ventasRoutes);
app.use('/api/reportes', reportesRoutes);
app.use('/api/categorias', categoriasRoutes);
app.use('/api/unidades', unidadesRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('🛠️ API de FerreSistema funcionando correctamente');
});

// Iniciar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});