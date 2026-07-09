const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// GET: Obtener todas las categorías
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM categorias ORDER BY nombre ASC');
    res.json(resultado.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Crear una nueva categoría (Protegido)
router.post('/', verificarAdmin, async (req, res) => {
  const { nombre } = req.body;
  try {
    const nueva = await pool.query(
      'INSERT INTO categorias (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json({ mensaje: 'Categoría creada', categoria: nueva.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'La categoría ya existe o hubo un error.' });
  }
});

module.exports = router;