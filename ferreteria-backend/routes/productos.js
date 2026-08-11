const express = require('express');
const router = express.Router();
const pool = require('../db');
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
  const {
    id, nombre, categoria_id, marca, precio, cantidad_stock, descripcion, unidad_base_id, url_imagen,
    precio_secundario, unidad_secundaria_cantidad, unidad_secundaria_nombre
  } = req.body;
  try {
    const query = `
      INSERT INTO productos (
        id, nombre, categoria_id, marca, precio, cantidad_stock, descripcion, unidad_base_id, url_imagen,
        precio_secundario, unidad_secundaria_cantidad, unidad_secundaria_nombre
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *;
    `;
    const valores = [
      id,
      nombre,
      categoria_id || 1,
      marca || 'Genérica',
      precio,
      cantidad_stock || 0,
      descripcion || '',
      unidad_base_id || 1,
      url_imagen || null,
      precio_secundario || null,
      unidad_secundaria_cantidad || null,
      unidad_secundaria_nombre || null
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
  const {
    nombre, precio, cantidad_stock, categoria_id, unidad_base_id, marca, descripcion, url_imagen,
    precio_secundario, unidad_secundaria_cantidad, unidad_secundaria_nombre
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE productos 
       SET nombre = $1, precio = $2, cantidad_stock = $3, categoria_id = $4, unidad_base_id = $5, marca = $6, descripcion = $7, url_imagen = $8,
           precio_secundario = $9, unidad_secundaria_cantidad = $10, unidad_secundaria_nombre = $11
       WHERE id = $12 RETURNING *`,
      [
        nombre, precio, cantidad_stock, categoria_id, unidad_base_id, marca || 'Genérica', descripcion || '', url_imagen || null,
        precio_secundario || null, unidad_secundaria_cantidad || null, unidad_secundaria_nombre || null,
        id
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    res.json({ mensaje: 'Producto actualizado correctamente', producto: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar el producto. Verifica que no tenga registros relacionados (categoría, unidad o conversiones).' });
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
    res.status(500).json({ error: 'Error al eliminar el producto. Verifica que no tenga registros relacionados (categoría, unidad o conversiones).' });
  }
});

module.exports = router;