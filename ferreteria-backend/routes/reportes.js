const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware'); // Protección de ruta

// GET: Obtener métricas consolidadas para el Dashboard de Inventario
router.get('/dashboard', verificarAdmin, async (req, res) => {
  try {
    // 1. Salud general del inventario: total de productos, valor total,
    //    productos agotados y productos con stock crítico
    const inventarioQuery = `
      SELECT
        COUNT(*) AS total_productos,
        COALESCE(SUM(precio * cantidad_stock), 0) AS valor_inventario,
        COUNT(*) FILTER (WHERE cantidad_stock <= 0) AS agotados,
        COUNT(*) FILTER (WHERE cantidad_stock > 0 AND cantidad_stock < 20) AS stock_bajo
      FROM productos;
    `;
    const inventarioRes = await pool.query(inventarioQuery);

    // 2. Detalle de productos que requieren reabastecimiento (menos de 20 unidades)
    const bajoStockQuery = `
      SELECT id, nombre, cantidad_stock 
      FROM productos 
      WHERE cantidad_stock < 20
      ORDER BY cantidad_stock ASC;
    `;
    const bajoStockRes = await pool.query(bajoStockQuery);

    // 3. Valor de inventario distribuido por categoría (dónde está invertido el capital)
    const valorPorCategoriaQuery = `
      SELECT COALESCE(c.nombre, 'Sin categoría') AS categoria,
             COALESCE(SUM(p.precio * p.cantidad_stock), 0) AS valor,
             COUNT(p.id) AS cantidad_productos
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      GROUP BY c.nombre
      ORDER BY valor DESC;
    `;
    const valorPorCategoriaRes = await pool.query(valorPorCategoriaQuery);

    // 4. Top 5 productos con mayor valor inmovilizado en inventario (precio × stock)
    const topValorQuery = `
      SELECT id, nombre, marca, precio, cantidad_stock, (precio * cantidad_stock) AS valor_total
      FROM productos
      WHERE precio IS NOT NULL AND cantidad_stock IS NOT NULL
      ORDER BY valor_total DESC
      LIMIT 5;
    `;
    const topValorRes = await pool.query(topValorQuery);

    // 5. Ganancia: suma de ventas ya cobradas (Contado + Crédito ya pagado)
    const gananciaQuery = `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE fecha::date = CURRENT_DATE), 0) AS ganancia_hoy,
        COALESCE(SUM(total) FILTER (WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)), 0) AS ganancia_mes,
        COALESCE(SUM(total), 0) AS ganancia_historica
      FROM ventas
      WHERE estado = 'Pagado';
    `;
    const gananciaRes = await pool.query(gananciaQuery);

    // 6. Pendiente de cobro: ventas a crédito que aún no se han pagado
    const pendienteQuery = `
      SELECT COALESCE(SUM(total), 0) AS total_pendiente, COUNT(*) AS cantidad_pendiente
      FROM ventas
      WHERE estado = 'Pendiente';
    `;
    const pendienteRes = await pool.query(pendienteQuery);

    // 7. Costo de compras (reabastecimiento) de hoy, del mes y total histórico
    const comprasQuery = `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE fecha::date = CURRENT_DATE), 0) AS compras_hoy,
        COALESCE(SUM(total) FILTER (WHERE date_trunc('month', fecha) = date_trunc('month', CURRENT_DATE)), 0) AS compras_mes,
        COALESCE(SUM(total), 0) AS compras_historico
      FROM compras;
    `;
    const comprasRes = await pool.query(comprasQuery);

    // 8. Historial reciente combinado de ventas y compras
    const historialVentasQuery = `
      SELECT v.id, v.fecha, v.total, v.tipo_venta, v.estado, COUNT(dv.id) AS items
      FROM ventas v
      LEFT JOIN detalle_ventas dv ON dv.venta_id = v.id
      GROUP BY v.id, v.fecha, v.total, v.tipo_venta, v.estado
      ORDER BY v.fecha DESC
      LIMIT 10;
    `;
    const historialVentasRes = await pool.query(historialVentasQuery);

    const historialComprasQuery = `
      SELECT c.id, c.fecha, c.proveedor, c.total, COUNT(dc.id) AS items
      FROM compras c
      LEFT JOIN detalle_compras dc ON dc.compra_id = c.id
      GROUP BY c.id, c.fecha, c.proveedor, c.total
      ORDER BY c.fecha DESC
      LIMIT 10;
    `;
    const historialComprasRes = await pool.query(historialComprasQuery);

    // 9. Comparativas: semana/mes/año actual vs el periodo anterior (ventas y ganancia)
    const comparativaVentasQuery = `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE)), 0) AS v_semana_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE) - interval '7 days' AND fecha < date_trunc('week', CURRENT_DATE)), 0) AS v_semana_anterior,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0) AS v_mes_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND fecha < date_trunc('month', CURRENT_DATE)), 0) AS v_mes_anterior,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('year', CURRENT_DATE)), 0) AS v_anio_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('year', CURRENT_DATE) - interval '1 year' AND fecha < date_trunc('year', CURRENT_DATE)), 0) AS v_anio_anterior,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('week', CURRENT_DATE)), 0) AS g_semana_actual,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('week', CURRENT_DATE) - interval '7 days' AND fecha < date_trunc('week', CURRENT_DATE)), 0) AS g_semana_anterior,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('month', CURRENT_DATE)), 0) AS g_mes_actual,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND fecha < date_trunc('month', CURRENT_DATE)), 0) AS g_mes_anterior,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('year', CURRENT_DATE)), 0) AS g_anio_actual,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Pagado' AND fecha >= date_trunc('year', CURRENT_DATE) - interval '1 year' AND fecha < date_trunc('year', CURRENT_DATE)), 0) AS g_anio_anterior
      FROM ventas;
    `;
    const comparativaVentasRes = await pool.query(comparativaVentasQuery);

    const comparativaComprasQuery = `
      SELECT
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE)), 0) AS c_semana_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('week', CURRENT_DATE) - interval '7 days' AND fecha < date_trunc('week', CURRENT_DATE)), 0) AS c_semana_anterior,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE)), 0) AS c_mes_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('month', CURRENT_DATE) - interval '1 month' AND fecha < date_trunc('month', CURRENT_DATE)), 0) AS c_mes_anterior,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('year', CURRENT_DATE)), 0) AS c_anio_actual,
        COALESCE(SUM(total) FILTER (WHERE fecha >= date_trunc('year', CURRENT_DATE) - interval '1 year' AND fecha < date_trunc('year', CURRENT_DATE)), 0) AS c_anio_anterior
      FROM compras;
    `;
    const comparativaComprasRes = await pool.query(comparativaComprasQuery);

    // 10. Serie mensual (últimos 12 meses) de ventas vs compras, para la gráfica
    const serieMensualQuery = `
      SELECT
        to_char(serie.mes, 'YYYY-MM') AS mes,
        to_char(serie.mes, 'Mon YYYY') AS etiqueta,
        COALESCE(v.total, 0) AS ventas,
        COALESCE(c.total, 0) AS compras
      FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '11 months', date_trunc('month', CURRENT_DATE), interval '1 month') AS serie(mes)
      LEFT JOIN (SELECT date_trunc('month', fecha) AS mes, SUM(total) AS total FROM ventas GROUP BY 1) v ON v.mes = serie.mes
      LEFT JOIN (SELECT date_trunc('month', fecha) AS mes, SUM(total) AS total FROM compras GROUP BY 1) c ON c.mes = serie.mes
      ORDER BY serie.mes ASC;
    `;
    const serieMensualRes = await pool.query(serieMensualQuery);

    // Responder con la analítica consolidada de inventario
    res.json({
      totalProductos: parseInt(inventarioRes.rows[0].total_productos, 10),
      valorInventario: parseFloat(inventarioRes.rows[0].valor_inventario),
      agotados: parseInt(inventarioRes.rows[0].agotados, 10),
      stockBajoCantidad: parseInt(inventarioRes.rows[0].stock_bajo, 10),
      bajoStock: bajoStockRes.rows,
      valorPorCategoria: valorPorCategoriaRes.rows,
      topValorInventario: topValorRes.rows,
      gananciaHoy: parseFloat(gananciaRes.rows[0].ganancia_hoy),
      gananciaMes: parseFloat(gananciaRes.rows[0].ganancia_mes),
      gananciaHistorica: parseFloat(gananciaRes.rows[0].ganancia_historica),
      pendienteTotal: parseFloat(pendienteRes.rows[0].total_pendiente),
      pendienteCantidad: parseInt(pendienteRes.rows[0].cantidad_pendiente, 10),
      comprasHoy: parseFloat(comprasRes.rows[0].compras_hoy),
      comprasMes: parseFloat(comprasRes.rows[0].compras_mes),
      comprasHistorico: parseFloat(comprasRes.rows[0].compras_historico),
      historialVentas: historialVentasRes.rows,
      historialCompras: historialComprasRes.rows,
      comparativas: (() => {
        const v = comparativaVentasRes.rows[0];
        const c = comparativaComprasRes.rows[0];
        const periodo = (vActual, vAnterior, cActual, cAnterior, gActual, gAnterior) => ({
          ventas: { actual: parseFloat(vActual), anterior: parseFloat(vAnterior) },
          compras: { actual: parseFloat(cActual), anterior: parseFloat(cAnterior) },
          ganancia: { actual: parseFloat(gActual), anterior: parseFloat(gAnterior) }
        });
        return {
          semana: periodo(v.v_semana_actual, v.v_semana_anterior, c.c_semana_actual, c.c_semana_anterior, v.g_semana_actual, v.g_semana_anterior),
          mes: periodo(v.v_mes_actual, v.v_mes_anterior, c.c_mes_actual, c.c_mes_anterior, v.g_mes_actual, v.g_mes_anterior),
          anio: periodo(v.v_anio_actual, v.v_anio_anterior, c.c_anio_actual, c.c_anio_anterior, v.g_anio_actual, v.g_anio_anterior)
        };
      })(),
      serieMensual: serieMensualRes.rows.map(r => ({
        mes: r.mes,
        etiqueta: r.etiqueta,
        ventas: parseFloat(r.ventas),
        compras: parseFloat(r.compras)
      }))
    });

  } catch (err) {
    console.error("Error en Dashboard:", err.message);
    res.status(500).json({ error: 'Error interno del servidor al procesar las analíticas.' });
  }
});

module.exports = router;