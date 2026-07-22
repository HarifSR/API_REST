const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// GET: Historial de compras recientes
router.get('/', verificarAdmin, async (req, res) => {
  try {
    const query = `
      SELECT c.id, c.fecha, c.proveedor, c.total, COUNT(dc.id) AS items
      FROM compras c
      LEFT JOIN detalle_compras dc ON dc.compra_id = c.id
      GROUP BY c.id, c.fecha, c.proveedor, c.total
      ORDER BY c.fecha DESC
      LIMIT 30;
    `;
    const resultado = await pool.query(query);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el historial de compras.' });
  }
});

// GET: Detalle de artículos de una compra puntual
router.get('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT dc.producto_id, p.nombre, dc.cantidad, dc.costo_unitario, (dc.cantidad * dc.costo_unitario) AS subtotal
      FROM detalle_compras dc
      LEFT JOIN productos p ON dc.producto_id = p.id
      WHERE dc.compra_id = $1
      ORDER BY dc.id ASC;
    `;
    const resultado = await pool.query(query, [id]);
    res.json({ items: resultado.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la compra.' });
  }
});

// POST: Registrar una compra (reabastecimiento) y aumentar stock (Transaccional)
router.post('/', verificarAdmin, async (req, res) => {
  const { items, proveedor } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a la compra.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    for (const item of items) {
      const resProd = await client.query('SELECT id, nombre FROM productos WHERE id = $1', [item.producto_id]);
      if (resProd.rows.length === 0) {
        throw new Error(`El producto con ID ${item.producto_id} no existe en el catálogo.`);
      }
      total += item.cantidad * item.costo_unitario;
    }

    const resCompra = await client.query(
      'INSERT INTO compras (proveedor, total) VALUES ($1, $2) RETURNING id, fecha, proveedor, total',
      [proveedor || null, total]
    );
    const compraId = resCompra.rows[0].id;

    for (const item of items) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock + $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      await client.query(
        'INSERT INTO detalle_compras (compra_id, producto_id, cantidad, costo_unitario) VALUES ($1, $2, $3, $4)',
        [compraId, item.producto_id, item.cantidad, item.costo_unitario]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ mensaje: 'Compra registrada. El stock fue actualizado.', compra: resCompra.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error en compra:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;