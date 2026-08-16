const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// GET: Historial de ventas recientes (con tipo, estado y cantidad de artículos)
router.get('/', verificarAdmin, async (req, res) => {
  try {
    const query = `
      SELECT v.id, v.fecha, v.total, v.tipo_venta, v.estado, v.cliente, v.cliente_direccion, v.cliente_nit, COUNT(dv.id) AS items
      FROM ventas v
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      GROUP BY v.id, v.fecha, v.total, v.tipo_venta, v.estado, v.cliente, v.cliente_direccion, v.cliente_nit
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

// GET: Detalle de artículos de una venta puntual (incluye datos del comprador)
router.get('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const ventaQuery = `
      SELECT id, fecha, total, tipo_venta, estado, cliente, cliente_direccion, cliente_nit
      FROM ventas WHERE id = $1;
    `;
    const ventaResultado = await pool.query(ventaQuery, [id]);
    if (ventaResultado.rows.length === 0) {
      return res.status(404).json({ error: 'La venta no existe.' });
    }

    const query = `
      SELECT dv.producto_id, p.nombre, dv.cantidad, dv.precio_unitario, (dv.cantidad * dv.precio_unitario) AS subtotal
      FROM detalle_ventas dv
      LEFT JOIN productos p ON dv.producto_id = p.id
      WHERE dv.venta_id = $1
      ORDER BY dv.id ASC;
    `;
    const resultado = await pool.query(query, [id]);
    res.json({ venta: ventaResultado.rows[0], items: resultado.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la venta.' });
  }
});

// POST: Registrar una venta (Contado o Crédito), verificar y descontar stock (Transaccional)
router.post('/', verificarAdmin, async (req, res) => {
  const { items, tipoVenta, cliente, clienteDireccion, clienteNit } = req.body;
  const tipoVentaFinal = (tipoVenta === 'Crédito' || tipoVenta === 'Credito') ? 'Crédito' : 'Contado';
  const estadoInicial = tipoVentaFinal === 'Crédito' ? 'Pendiente' : 'Pagado';

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un producto a la venta.' });
  }

  // En una venta a crédito es indispensable saber a quién se le está fiando
  if (tipoVentaFinal === 'Crédito' && (!cliente || !cliente.trim())) {
    return res.status(400).json({ error: 'Para ventas a crédito debes indicar el nombre del comprador.' });
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
      'INSERT INTO ventas (total, tipo_venta, estado, cliente, cliente_direccion, cliente_nit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, fecha, total, tipo_venta, estado, cliente, cliente_direccion, cliente_nit',
      [total, tipoVentaFinal, estadoInicial, cliente || null, clienteDireccion || null, clienteNit || null]
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

// PUT: Editar una venta ya registrada (corrige errores de captura).
// Revierte el stock de los productos originales, valida y aplica los nuevos.
router.put('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const { items, tipoVenta, cliente, clienteDireccion, clienteNit } = req.body;
  const tipoVentaFinal = (tipoVenta === 'Crédito' || tipoVenta === 'Credito') ? 'Crédito' : 'Contado';

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto.' });
  }
  if (tipoVentaFinal === 'Crédito' && (!cliente || !cliente.trim())) {
    return res.status(400).json({ error: 'Para ventas a crédito debes indicar el nombre del comprador.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ventaActualRes = await client.query('SELECT * FROM ventas WHERE id = $1 FOR UPDATE', [id]);
    if (ventaActualRes.rows.length === 0) throw new Error('La venta no existe.');
    const ventaActual = ventaActualRes.rows[0];

    // 1. Revertir el stock de los artículos originales de esta venta
    const itemsOriginales = await client.query('SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = $1', [id]);
    for (const item of itemsOriginales.rows) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock + $1 WHERE id = $2', [item.cantidad, item.producto_id]);
    }
    await client.query('DELETE FROM detalle_ventas WHERE venta_id = $1', [id]);

    // 2. Validar y aplicar los nuevos artículos (ya con el stock restaurado)
    let total = 0;
    for (const item of items) {
      const resStock = await client.query('SELECT cantidad_stock, nombre FROM productos WHERE id = $1', [item.producto_id]);
      if (resStock.rows.length === 0) throw new Error(`El producto con ID ${item.producto_id} ya no existe en el catálogo.`);
      const stockActual = parseFloat(resStock.rows[0].cantidad_stock);
      if (stockActual < item.cantidad) throw new Error(`¡Stock insuficiente para "${resStock.rows[0].nombre}"! Quedan ${stockActual} uds y solicitaste ${item.cantidad}.`);
      total += item.cantidad * item.precio_unitario;
    }

    // El estado se mantiene igual que antes salvo que el tipo de venta haya cambiado
    let estadoFinal = ventaActual.estado;
    if (tipoVentaFinal !== ventaActual.tipo_venta) {
      estadoFinal = tipoVentaFinal === 'Crédito' ? 'Pendiente' : 'Pagado';
    }

    const ventaActualizada = await client.query(
      `UPDATE ventas SET total = $1, tipo_venta = $2, estado = $3, cliente = $4, cliente_direccion = $5, cliente_nit = $6
       WHERE id = $7 RETURNING *`,
      [total, tipoVentaFinal, estadoFinal, cliente || null, clienteDireccion || null, clienteNit || null, id]
    );

    for (const item of items) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock - $1 WHERE id = $2', [item.cantidad, item.producto_id]);
      await client.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
        [id, item.producto_id, item.cantidad, item.precio_unitario]
      );
    }

    await client.query('COMMIT');
    res.json({ mensaje: 'Venta actualizada correctamente.', venta: ventaActualizada.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al editar venta:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// DELETE: Eliminar una venta (revierte el stock de todos sus artículos)
router.delete('/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const itemsRes = await client.query('SELECT producto_id, cantidad FROM detalle_ventas WHERE venta_id = $1', [id]);
    for (const item of itemsRes.rows) {
      await client.query('UPDATE productos SET cantidad_stock = cantidad_stock + $1 WHERE id = $2', [item.cantidad, item.producto_id]);
    }

    const resultado = await client.query('DELETE FROM ventas WHERE id = $1 RETURNING id', [id]);
    if (resultado.rowCount === 0) throw new Error('La venta no existe o ya fue eliminada.');

    await client.query('COMMIT');
    res.json({ mensaje: `Venta #${id} eliminada. El stock de sus productos fue restaurado.` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar venta:', err.message);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;