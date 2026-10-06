// Reglas de facturación del comprador en una venta.
//
//  - CONTADO: debe facturarse con datos (nombre y NIT) o registrarse como Consumidor Final (C/F).
//  - CRÉDITO: debe identificarse al comprador (nombre); dirección y NIT son opcionales.

// Acepta "CF", "C/F", "c/f", "C / F"...
const esConsumidorFinal = (nit) => /^c\s*\/?\s*f$/i.test(String(nit || '').trim());

const MAX_NOMBRE = 150;
const MAX_NIT = 20;
const MAX_DIRECCION = 255;

// Devuelve { ok: true, cliente, direccion, nit } con los datos ya normalizados,
// o { ok: false, error } con el mensaje a mostrar al usuario.
function resolverComprador(tipoVenta, { cliente, clienteDireccion, clienteNit } = {}) {
  const nombre = String(cliente ?? '').trim();
  const nit = String(clienteNit ?? '').trim();
  const direccion = String(clienteDireccion ?? '').trim();

  if (nombre.length > MAX_NOMBRE) return { ok: false, error: `El nombre del comprador no puede superar ${MAX_NOMBRE} caracteres.` };
  if (nit.length > MAX_NIT) return { ok: false, error: `El NIT no puede superar ${MAX_NIT} caracteres.` };
  if (direccion.length > MAX_DIRECCION) return { ok: false, error: `La dirección no puede superar ${MAX_DIRECCION} caracteres.` };

  if (tipoVenta === 'Crédito') {
    if (!nombre) return { ok: false, error: 'Para ventas a crédito debes indicar el nombre del comprador.' };
    if (esConsumidorFinal(nit) || /^consumidor\s+final$/i.test(nombre)) {
      return { ok: false, error: 'Una venta a crédito no puede registrarse como Consumidor Final: identifica al comprador.' };
    }
    return { ok: true, cliente: nombre, direccion: direccion || null, nit: nit || null };
  }

  // Contado
  if (esConsumidorFinal(nit)) {
    return { ok: true, cliente: 'Consumidor Final', direccion: null, nit: 'C/F' };
  }
  if (!nombre || !nit) {
    return { ok: false, error: 'En una venta al contado debes facturar con el nombre y el NIT del comprador, o registrarla como Consumidor Final (C/F).' };
  }
  return { ok: true, cliente: nombre, direccion: direccion || null, nit };
}

module.exports = { resolverComprador, esConsumidorFinal };