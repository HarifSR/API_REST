const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware'); // Protección de ruta

// GET: Obtener métricas consolidadas para el Dashboard
router.get('/dashboard', verificarAdmin, async (req, res) => {
  try {
    // 1. Calcular el total vendido en el día actual
    const ventasHoyQuery = `
      SELECT COALESCE(SUM(total), 0) AS total_hoy 
      FROM ventas 
      WHERE fecha::date = CURRENT_DATE;
    `;
    const ventasHoyRes = await pool.query(ventasHoyQuery);

    // 2. Obtener el Top 5 de productos más vendidos
    const masVendidosQuery = `
      SELECT p.nombre, SUM(dv.cantidad) AS unidades_vendidas, SUM(dv.cantidad * dv.precio_unitario) AS ingresos_totales
      FROM detalle_ventas dv
      JOIN productos p ON dv.producto_id = p.id
      GROUP BY p.id, p.nombre
      ORDER BY unidades_vendidas DESC
      LIMIT 5;
    `;
    const masVendidosRes = await pool.query(masVendidosQuery);

    // 3. Obtener productos con stock crítico (menos de 20 unidades)
    const bajoStockQuery = `
      SELECT id, nombre, cantidad_stock 
      FROM productos 
      WHERE cantidad_stock < 20
      ORDER BY cantidad_stock ASC;
    `;
    const bajoStockRes = await pool.query(bajoStockQuery);

    // Responder con la analítica consolidada
    res.json({
      totalHoy: parseFloat(ventasHoyRes.rows[0].total_hoy),
      masVendidos: masVendidosRes.rows,
      bajoStock: bajoStockRes.rows
    });

  } catch (err) {
    console.error("Error en Dashboard:", err.message);
    res.status(500).json({ error: 'Error interno del servidor al procesar las analíticas.' });
  }
});

module.exports = router;