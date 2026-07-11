const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST: Procesar una venta, verificar y reducir stock (Transaccional)
router.post('/', async (req, res) => {
  const { carrito, total, tipoVenta } = req.body;
  const tipoVentaFinal = (tipoVenta === 'Crédito' || tipoVenta === 'Credito') ? 'Crédito' : 'Contado';

  if (!carrito || carrito.length === 0) {
    return res.status(400).json({ error: 'El carrito de compras está vacío.' });
  }

  // Solicitamos un cliente dedicado del pool para manejar la transacción de forma aislada
  const client = await pool.connect();

  try {
    // Iniciamos la transacción atómica
    await client.query('BEGIN'); 

    // 1. Insertar la cabecera de la venta (con su tipo: Contado o Crédito)
    const resVenta = await client.query(
      'INSERT INTO ventas (total, tipo_venta) VALUES ($1, $2) RETURNING id, fecha, total, tipo_venta',
      [total, tipoVentaFinal]
    );
    const ventaId = resVenta.rows[0].id;

    // 2. Iterar sobre los productos del carrito para comprobar stock y descontar
    for (const item of carrito) {
      const resStock = await client.query('SELECT cantidad_stock, nombre FROM productos WHERE id = $1', [item.id]);
      
      if (resStock.rows.length === 0) {
        throw new Error(`El producto con ID ${item.id} ya no existe en el catálogo.`);
      }
      
      const stockActual = parseFloat(resStock.rows[0].cantidad_stock);
      
      if (stockActual < item.cantidad) {
        throw new Error(`¡Stock insuficiente para "${resStock.rows[0].nombre}"! Quedan ${stockActual} uds y solicitaste ${item.cantidad}.`);
      }

      // Restar existencias en la base de datos
      await client.query(
        'UPDATE productos SET cantidad_stock = cantidad_stock - $1 WHERE id = $2',
        [item.cantidad, item.id]
      );

      // Registrar el desglose en el detalle de la venta
      await client.query(
        'INSERT INTO detalle_ventas (venta_id, producto_id, cantidad, precio_unitario) VALUES ($1, $2, $3, $4)',
        [ventaId, item.id, item.cantidad, item.precio]
      );
    }

    // Si todo salió bien, guardamos definitivamente todos los cambios en Postgres
    await client.query('COMMIT'); 
    res.status(201).json({
      mensaje: tipoVentaFinal === 'Crédito' ? '🧾 ¡Factura de crédito generada!' : '🧾 ¡Venta cobrada con éxito!',
      ventaId,
      fecha: resVenta.rows[0].fecha,
      total: parseFloat(resVenta.rows[0].total),
      tipoVenta: resVenta.rows[0].tipo_venta
    });

  } catch (err) {
    // Si ocurre CUALQUIER error en el ciclo, deshacemos todo lo que se alteró en esta consulta
    await client.query('ROLLBACK'); 
    console.error("Error en venta:", err.message);
    res.status(400).json({ error: err.message });
  } finally {
    // Liberamos el cliente para que vuelva al pool
    client.release();
  }
});

module.exports = router;