const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// GET: Obtener todas las unidades
router.get('/', async (req, res) => {
  try {
    const resultado = await pool.query('SELECT * FROM unidades_medida ORDER BY nombre ASC');
    res.json(resultado.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST: Crear una nueva unidad (Protegido)
router.post('/', verificarAdmin, async (req, res) => {
  const { nombre, codigo } = req.body;
  try {
    const nueva = await pool.query(
      'INSERT INTO unidades_medida (nombre, codigo) VALUES ($1, $2) RETURNING *',
      [nombre, codigo.toUpperCase()]
    );
    res.status(201).json({ mensaje: 'Unidad creada', unidad: nueva.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'El nombre o código ya existe.' });
  }
});

module.exports = router;