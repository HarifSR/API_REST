// Análisis de la variación de los costos de compra de un producto.
// El costo se guarda siempre POR UNIDAD BASE (detalle_compras.costo_unitario), así que
// compras hechas por unidad o por caja/lote son comparables entre sí.

const redondear = (n, decimales = 2) => {
  const factor = 10 ** decimales;
  return Math.round((Number(n) + Number.EPSILON) * factor) / factor;
};

// Variación porcentual entre un costo y el anterior (null si no hay base de comparación)
const variacionPct = (costo, previo) => (previo > 0 ? redondear(((costo - previo) / previo) * 100, 1) : null);

// filas: líneas de compra del producto ordenadas de la más antigua a la más reciente
//        [{ compra_id, fecha, proveedor, cantidad, costo_unitario }]
function analizarCostos(filas, { precioVenta = null, limite = 100 } = {}) {
  const compras = filas.map((f) => ({
    compraId: f.compra_id,
    fecha: f.fecha,
    proveedor: f.proveedor || null,
    cantidad: Number(f.cantidad),
    costo: Number(f.costo_unitario),
  }));

  compras.forEach((c, i) => {
    if (i === 0) { c.variacionAbs = null; c.variacionPct = null; return; }
    const previo = compras[i - 1].costo;
    c.variacionAbs = redondear(c.costo - previo);
    c.variacionPct = variacionPct(c.costo, previo);
  });

  if (compras.length === 0) return { resumen: null, historial: [] };

  const n = compras.length;
  const costos = compras.map((c) => c.costo);
  const cantidadTotal = compras.reduce((acc, c) => acc + c.cantidad, 0);
  const valorTotal = compras.reduce((acc, c) => acc + c.cantidad * c.costo, 0);
  const primero = compras[0].costo;
  const ultimo = compras[n - 1].costo;

  const resumen = {
    compras: n,
    ultimo: redondear(ultimo),
    anterior: n > 1 ? redondear(compras[n - 2].costo) : null,
    variacionUltimaPct: compras[n - 1].variacionPct,
    variacionTotalPct: n > 1 ? variacionPct(ultimo, primero) : null,
    minimo: redondear(Math.min(...costos)),
    maximo: redondear(Math.max(...costos)),
    // Promedio ponderado por cantidad: refleja lo que realmente costó cada unidad comprada
    promedio: cantidadTotal > 0 ? redondear(valorTotal / cantidadTotal) : null,
    // Margen sobre el precio de venta actual, usando el último costo
    margenPct: precioVenta > 0 ? redondear(((precioVenta - ultimo) / precioVenta) * 100, 1) : null,
    ultimaFecha: compras[n - 1].fecha,
    ultimoProveedor: compras[n - 1].proveedor,
  };

  // El historial se entrega de lo más reciente a lo más antiguo
  return { resumen, historial: compras.slice().reverse().slice(0, limite) };
}

module.exports = { analizarCostos, variacionPct, redondear };