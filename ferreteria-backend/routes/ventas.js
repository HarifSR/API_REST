const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// GET: Historial de ventas recientes (con tipo, estado y cantidad de artículos)
router.get('/', verificarAdmin, async (req, res) => {
  try {
    const query = `
      SELECT v.id, v.fecha, v.total, v.tipo_venta, v.estado, v.cliente, COUNT(dv.id) AS items
      FROM ventas v
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      GROUP BY v.id, v.fecha, v.total, v.tipo_venta, v.estado, v.cliente
      ORDER BY v.fecha DESC
      LIMIT 30;
    `;
    const resultado = await pool.query(query);
    res.json(resultado.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el historial de ventas.' });
  }
});

// GET: Detalle de artículos de una venta puntual
router.get('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT dv.producto_id, p.nombre, dv.cantidad, dv.precio_unitario, (dv.cantidad * dv.precio_unitario) AS subtotal
      FROM detalle_ventas dv
      LEFT JOIN productos p ON dv.producto_id = p.id
      WHERE dv.venta_id = $1
      ORDER BY dv.id ASC;
    `;
    const resultado = await pool.query(query, [id]);
    res.json({ items: resultado.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la venta.' });
  }
});

// POST: Registrar una venta (Contado o Crédito), verificar y descontar stock (Transaccional)
router.post('/', verificarAdmin, async (req, res) => {
  const { items, tipoVenta, cliente } = req.body;
  const tipoVentaFinal = (tipoVenta === 'Crédito' || tipoVenta === 'Credito') ? 'Crédito' : 'Contado';
  const estadoInicial = tipoVentaFinal === 'Crédito' ? 'Pendiente' : 'Pagado';

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a la venta.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let total = 0;
    for (const item of items) {
      const resStock = await client.query('SELECT cantidad_stock, nombre, precio FROM productos WHERE id = $1', [item.producto_id]);
      if (resStock.rows.length === 0) {
        throw new Error(`El producto con ID ${item.producto_id} ya no existe en el catálogo.`);
      }
      const stockActual = parseFloat(resStock.rows[0].cantidad_stock);
      if (stockActual < item.cantidad) {
        throw new Error(`¡Stock insuficiente para "${resStock.rows[0].nombre}"! Quedan ${stockActual} uds y solicitaste ${item.cantidad}.`);
      }
      total += item.cantidad * item.precio_unitario;
    }

    const resVenta = await client.query(
      'INSERT INTO ventas (total, tipo_venta, estado, cliente) VALUES ($1, $2, $3, $4) RETURNING id, fecha, total, tipo_venta, estado, cliente',
      [total, tipoVentaFinal, estadoInicial, cliente || null]
    );
    const ventaId = resVenta.rows[0].id;

    for (const item of items) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock - $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      await client.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
        [ventaId, item.producto_id, item.cantidad, item.precio_unitario]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: tipoVentaFinal === 'Crédito' ? 'Venta a crédito registrada. Queda pendiente de cobro.' : 'Venta al contado registrada y sumada a la ganancia.',
      venta: resVenta.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error en venta:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// PATCH: Marcar una venta a crédito como cobrada (pasa a sumar la ganancia)
router.patch('/:id/pagar', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const resultado = await pool.query(
      `UPDATE ventas SET estado = 'Pagado' WHERE id = $1 AND estado = 'Pendiente' RETURNING *`,
      [id]
    );
    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'La venta no existe o ya estaba pagada.' });
    }
    res.json({ mensaje: 'Venta marcada como cobrada.', venta: resultado.rows[0] });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al marcar la venta como pagada.' });
  }
});

module.exports = router;