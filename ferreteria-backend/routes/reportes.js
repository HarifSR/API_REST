const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware'); // Protección de ruta

// GET: Obtener métricas consolidadas para el Dashboard
router.get('/dashboard', verificarAdmin, async (req, res) => {
  try {
    // 1. Ventas de hoy y del mes en curso
    const ventasResumenQuery = `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE fecha::date = CURRENT_DATE), 0) AS total_hoy,
        COALESCE(SUM(total) FILTER (WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)), 0) AS total_mes,
        COALESCE(SUM(total), 0) AS total_historico,
        COALESCE(AVG(total), 0) AS ticket_promedio,
        COUNT(*) AS cantidad_ventas
      FROM ventas;
    `;
    const ventasResumenRes = await pool.query(ventasResumenQuery);

    // 2. Top 5 de productos más vendidos (histórico)
    const masVendidosQuery = `
      SELECT p.id, p.nombre, SUM(dv.cantidad) AS unidades_vendidas, SUM(dv.cantidad * dv.precio_unitario) AS ingresos_totales
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id = p.id
      GROUP BY p.id, p.nombre
      ORDER BY unidades_vendidas DESC
      LIMIT 5;
    `;
    const masVendidosRes = await pool.query(masVendidosQuery);

    // 3. Productos con stock crítico (menos de 20 unidades)
    const bajoStockQuery = `
      SELECT id, nombre, cantidad_stock 
      FROM productos 
      WHERE cantidad_stock < 20
      ORDER BY cantidad_stock ASC;
    `;
    const bajoStockRes = await pool.query(bajoStockQuery);

    // 4. Salud del inventario: valor total, número de productos y sin stock
    const inventarioQuery = `
      SELECT
        COUNT(*) AS total_productos,
        COALESCE(SUM(precio * cantidad_stock), 0) AS valor_inventario,
        COUNT(*) FILTER (WHERE cantidad_stock <= 0) AS agotados
      FROM productos;
    `;
    const inventarioRes = await pool.query(inventarioQuery);

    // 5. Ventas por categoría (histórico), para ver qué línea de negocio rinde más
    const ventasPorCategoriaQuery = `
      SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria, SUM(dv.cantidad * dv.precio_unitario) AS ingresos
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id = p.id
      LEFT JOIN categorias c ON p.categoria_id = c.id
      GROUP BY c.nombre
      ORDER BY ingresos DESC;
    `;
    const ventasPorCategoriaRes = await pool.query(ventasPorCategoriaQuery);

    // 6. Comparación Contado vs Crédito
    const ventasPorTipoQuery = `
      SELECT tipo_venta, COUNT(*) AS cantidad, COALESCE(SUM(total), 0) AS total
      FROM ventas
      GROUP BY tipo_venta;
    `;
    const ventasPorTipoRes = await pool.query(ventasPorTipoQuery);

    // 7. Historial de ventas recientes (últimas 20), con su tipo y cantidad de artículos
    const historialQuery = `
      SELECT v.id, v.fecha, v.total, v.tipo_venta, COUNT(dv.id) AS items
      FROM ventas v
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      GROUP BY v.id, v.fecha, v.total, v.tipo_venta
      ORDER BY v.fecha DESC
      LIMIT 20;
    `;
    const historialRes = await pool.query(historialQuery);

    // Responder con la analítica consolidada
    res.json({
      totalHoy: parseFloat(ventasResumenRes.rows[0].total_hoy),
      totalMes: parseFloat(ventasResumenRes.rows[0].total_mes),
      totalHistorico: parseFloat(ventasResumenRes.rows[0].total_historico),
      ticketPromedio: parseFloat(ventasResumenRes.rows[0].ticket_promedio),
      cantidadVentas: parseInt(ventasResumenRes.rows[0].cantidad_ventas, 10),
      masVendidos: masVendidosRes.rows,
      bajoStock: bajoStockRes.rows,
      totalProductos: parseInt(inventarioRes.rows[0].total_productos, 10),
      valorInventario: parseFloat(inventarioRes.rows[0].valor_inventario),
      agotados: parseInt(inventarioRes.rows[0].agotados, 10),
      ventasPorCategoria: ventasPorCategoriaRes.rows,
      ventasPorTipo: ventasPorTipoRes.rows.map(r => ({
        tipoVenta: r.tipo_venta,
        cantidad: parseInt(r.cantidad, 10),
        total: parseFloat(r.total)
      })),
      historialVentas: historialRes.rows
    });

  } catch (err) {
    console.error("Error en Dashboard:", err.message);
    res.status(500).json({ error: 'Error interno del servidor al procesar las analíticas.' });
  }
});

// GET: Detalle de artículos de una venta puntual (para expandir en el historial)
router.get('/venta/:id', verificarAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const detalleQuery = `
      SELECT dv.producto_id, p.nombre, dv.cantidad, dv.precio_unitario, (dv.cantidad * dv.precio_unitario) AS subtotal
      FROM detalle_ventas dv
      LEFT JOIN productos p ON dv.producto_id = p.id
      WHERE dv.venta_id = $1
      ORDER BY dv.id ASC;
    `;
    const detalleRes = await pool.query(detalleQuery, [id]);
    res.json({ items: detalleRes.rows });
  } catch (err) {
    console.error("Error en detalle de venta:", err.message);
    res.status(500).json({ error: 'Error al obtener el detalle de la venta.' });
  }
});

module.exports = router;