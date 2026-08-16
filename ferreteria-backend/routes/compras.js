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

// GET: Detalle de artículos de una compra puntual (incluye datos de la compra)
router.get('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const compraRes = await pool.query('SELECT id, fecha, proveedor, total FROM compras WHERE id = $1', [id]);
    if (compraRes.rows.length === 0) {
      return res.status(404).json({ error: 'La compra no existe.' });
    }
    const query = `
      SELECT dc.producto_id, p.nombre, dc.cantidad, dc.costo_unitario, (dc.cantidad * dc.costo_unitario) AS subtotal
      FROM detalle_compras dc
      LEFT JOIN productos p ON dc.producto_id = p.id
      WHERE dc.compra_id = $1
      ORDER BY dc.id ASC;
    `;
    const resultado = await pool.query(query, [id]);
    res.json({ compra: compraRes.rows[0], items: resultado.rows });
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

// PUT: Editar una compra ya registrada (corrige errores de captura).
// Revierte el stock que había sumado y aplica el nuevo. Si alguno de esos
// productos ya se vendió después, no se deja bajar el stock a negativo.
router.put('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const { items, proveedor } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La compra debe tener al menos un producto.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const compraActualRes = await client.query('SELECT * FROM compras WHERE id = $1 FOR UPDATE', [id]);
    if (compraActualRes.rows.length === 0) throw new Error('La compra no existe.');

    // 1. Revertir (restar) el stock que había sumado esta compra originalmente
    const itemsOriginales = await client.query('SELECT producto_id, cantidad FROM detalle_compras WHERE compra_id = $1', [id]);
    for (const item of itemsOriginales.rows) {
      const resStock = await client.query('SELECT cantidad_stock, nombre FROM productos WHERE id = $1 FOR UPDATE', [item.producto_id]);
      if (resStock.rows.length > 0) {
        const stockActual = parseFloat(resStock.rows[0].cantidad_stock);
        if (stockActual < item.cantidad) {
          throw new Error(`No se puede editar: parte del stock de "${resStock.rows[0].nombre}" que trajo esta compra ya se vendió. Quedan ${stockActual} uds y se necesitan revertir ${item.cantidad}.`);
        }
        await client.query('UPDATE productos SET cantidad_stock = cantidad_stock - $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      }
    }
    await client.query('DELETE FROM detalle_compras WHERE compra_id = $1', [id]);

    // 2. Aplicar los nuevos artículos
    let total = 0;
    for (const item of items) {
      const resProd = await client.query('SELECT id, nombre FROM productos WHERE id = $1', [item.producto_id]);
      if (resProd.rows.length === 0) throw new Error(`El producto con ID ${item.producto_id} no existe en el catálogo.`);
      total += item.cantidad * item.costo_unitario;
    }

    const compraActualizada = await client.query(
      'UPDATE compras SET total = $1, proveedor = $2 WHERE id = $3 RETURNING id, fecha, proveedor, total',
      [total, proveedor || null, id]
    );

    for (const item of items) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock + $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      await client.query(
        'INSERT INTO detalle_compras (compra_id, producto_id, cantidad, costo_unitario) VALUES ($1, $2, $3, $4)',
        [id, item.producto_id, item.cantidad, item.costo_unitario]
      );
    }

    await client.query('COMMIT');
    res.json({ mensaje: 'Compra actualizada correctamente.', compra: compraActualizada.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al editar compra:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE: Eliminar una compra (resta el stock que había sumado).
// No se permite si parte de ese stock ya fue vendido (quedaría en negativo).
router.delete('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemsRes = await client.query('SELECT producto_id, cantidad FROM detalle_compras WHERE compra_id = $1', [id]);
    for (const item of itemsRes.rows) {
      const resStock = await client.query('SELECT cantidad_stock, nombre FROM productos WHERE id = $1 FOR UPDATE', [item.producto_id]);
      if (resStock.rows.length > 0) {
        const stockActual = parseFloat(resStock.rows[0].cantidad_stock);
        if (stockActual < item.cantidad) {
          throw new Error(`No se puede eliminar: parte del stock de "${resStock.rows[0].nombre}" que trajo esta compra ya se vendió. Quedan ${stockActual} uds y se necesitan revertir ${item.cantidad}.`);
        }
        await client.query('UPDATE productos SET cantidad_stock = cantidad_stock - $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      }
    }

    const resultado = await client.query('DELETE FROM compras WHERE id = $1 RETURNING id', [id]);
    if (resultado.rowCount === 0) throw new Error('La compra no existe o ya fue eliminada.');

    await client.query('COMMIT');
    res.json({ mensaje: `Compra #${id} eliminada. El stock fue ajustado.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar compra:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;