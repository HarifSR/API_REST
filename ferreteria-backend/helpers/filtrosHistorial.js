// Utilidades para construir búsquedas filtradas del historial (ventas y compras).
// Todos los valores del usuario viajan como PARÁMETROS ($1, $2...) y nunca se
// concatenan al SQL, para evitar inyección SQL.

class ErrorFiltro extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.status = 400;
  }
}

// Acumula condiciones WHERE y sus valores, numerando los parámetros automáticamente.
class Condiciones {
  constructor() {
    this.sql = [];
    this.valores = [];
  }
  // fn recibe una función p(valor) que registra el valor y devuelve su marcador ($n)
  agregar(fn) {
    this.sql.push(fn((valor) => {
      this.valores.push(valor);
      return `$${this.valores.length}`;
    }));
  }
  where() {
    return this.sql.length ? `WHERE ${this.sql.join(' AND ')}` : '';
  }
}

const texto = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');

// Escapa los comodines de LIKE para que "%" o "_" escritos por el usuario se busquen literalmente
const escaparLike = (t) => t.replace(/[\\%_]/g, (c) => '\\' + c);

// Búsqueda insensible a acentos y mayúsculas, sin depender de extensiones de la base de datos.
// En JS se normaliza lo que escribe el usuario; en SQL se normaliza la columna con translate().
const sinAcentosJs = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const sinAcentosSql = (columna) => `lower(translate(${columna}, 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'))`;

// Fecha calendario en hora de Guatemala (la que ve el usuario en pantalla),
// a partir de un timestamp guardado en UTC.
const fechaLocalSql = (columna) => `((${columna} AT TIME ZONE 'UTC') AT TIME ZONE 'America/Guatemala')::date`;

function leerFecha(valor, nombre) {
  const t = texto(valor);
  if (!t) return null;
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(t) && new Date(`${t}T00:00:00Z`).toISOString().slice(0, 10) === t;
  if (!valida) throw new ErrorFiltro(`La fecha "${nombre}" no es válida. Usa el formato AAAA-MM-DD.`);
  return t;
}

function leerLimite(valor, porDefecto = 50, maximo = 200) {
  const n = parseInt(valor, 10);
  if (Number.isNaN(n) || n < 1) return porDefecto;
  return Math.min(n, maximo);
}

// Agrega el filtro por rango de fechas (desde / hasta, ambos inclusivos)
function agregarRangoFechas(cond, query, columna) {
  const desde = leerFecha(query.desde, 'desde');
  const hasta = leerFecha(query.hasta, 'hasta');
  if (desde && hasta && desde > hasta) {
    throw new ErrorFiltro('La fecha "desde" no puede ser posterior a la fecha "hasta".');
  }
  if (desde) cond.agregar((p) => `${fechaLocalSql(columna)} >= ${p(desde)}::date`);
  if (hasta) cond.agregar((p) => `${fechaLocalSql(columna)} <= ${p(hasta)}::date`);
}

// Si el error es de validación de filtros responde 400; si no, 500.
function responderError(res, err, mensajeGenerico) {
  if (err instanceof ErrorFiltro) return res.status(err.status).json({ error: err.message });
  console.error(err.message);
  return res.status(500).json({ error: mensajeGenerico });
}

module.exports = { ErrorFiltro, Condiciones, texto, escaparLike, sinAcentosJs, sinAcentosSql, fechaLocalSql, leerFecha, leerLimite, agregarRangoFechas, responderError };