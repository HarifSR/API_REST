const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Requerido para conectar Render con Neon
  }
});

pool.on('connect', () => {
  console.log(' Conectado a la base de datos PostgreSQL');
});

module.exports = pool;