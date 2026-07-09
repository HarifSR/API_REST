const express = require('express');
const router = express.Router();
const pool = require('../db');
// Ruta corregida apuntando a la nueva carpeta middleware
const { verificarAdmin } = require('../middleware/authMiddleware');

// 1. GET: Obtener todos los productos (Público - Vitrina)
router.get('/', async (req, res) => {
  try {
    const query = `
      SELECT p.*, c.nombre AS categoria_nombre, u.abreviacion AS unidad_codigo 
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN unidades_medida u ON p.unidad_base_id = u.id
      ORDER BY p.id ASC;
    `;
    const resultado = await pool.query(query);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener los productos desde PostgreSQL.' });
  }
});

// 2. POST: Crear un producto nuevo (Privado - Requiere Token)
router.post('/', verificarAdmin, async (req, res) => {
  const { id, nombre, categoria_id, marca, precio, cantidad_stock, descripcion, unidad_base_id } = req.body;
  try {
    const query = `
      INSERT INTO productos (id, nombre, categoria_id, marca, precio, cantidad_stock, descripcion, unidad_base_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *;
    `;
    const valores = [
      id, 
      nombre, 
      categoria_id || 1, 
      marca || 'Genérica', 
      precio, 
      cantidad_stock || 0, 
      descripcion || '', 
      unidad_base_id || 1
    ];
    const resultado = await pool.query(query, valores);
    res.status(201).json({ mensaje: '¡Producto registrado con éxito!', producto: resultado.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al crear el producto. ¿Quizás el ID ya existe en la base de datos?' });
  }
});

// PUT: Actualizar un producto existente (Protegido)
router.put('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const { nombre, precio, cantidad_stock, categoria_id, unidad_base_id, marca, descripcion } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE productos 
       SET nombre = $1, precio = $2, cantidad_stock = $3, categoria_id = $4, unidad_base_id = $5, marca = $6, descripcion = $7
       WHERE id = $8 RETURNING *`,
      [nombre, precio, cantidad_stock, categoria_id, unidad_base_id, marca || 'Genérica', descripcion || '', id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Producto actualizado correctamente', producto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el producto. Verifica los datos.' });
  }
});

// 4. DELETE: Eliminar un producto (Privado - Requiere Token)
router.delete('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query('DELETE FROM productos WHERE id = $1 RETURNING *', [id]);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'El producto no existe o ya fue eliminado.' });
    }
    res.json({ mensaje: `El producto con ID ${id} fue eliminado definitivamente.` });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al eliminar. Asegúrate de que este producto no esté amarrado a una venta existente.' });
  }
});

module.exports = router;