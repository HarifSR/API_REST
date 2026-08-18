const jwt = require('jsonwebtoken');

// Verifica que exista un token válido y extrae el usuario. No revisa el rol.
const verificarToken = (req, res) => {
  const token = req.header('Authorization');
  if (!token) {
    res.status(401).json({ error: 'Acceso denegado. No hay token de seguridad.' });
    return null;
  }
  try {
    const tokenLimpio = token.replace('Bearer ', '');
    return jwt.verify(tokenLimpio, process.env.JWT_SECRET);
  } catch (error) {
    res.status(400).json({ error: 'Token no válido o expirado.' });
    return null;
  }
};

// Middleware de ACCESO GENERAL: administradores y operadores pueden usar
// el sistema (productos, ventas, compras, reportes, catálogos, etc.)
const verificarAdmin = (req, res, next) => {
  const usuario = verificarToken(req, res);
  if (!usuario) return; // verificarToken ya respondió el error

  req.usuario = usuario;
  if (!['administrador', 'operador'].includes(usuario.rol)) {
    return res.status(403).json({ error: 'Acceso denegado. Tu cuenta no tiene permiso para usar el sistema.' });
  }
  next();
};

// Middleware de ACCESO EXCLUSIVO: solo el rol "administrador" puede gestionar
// usuarios. Los operadores tienen prohibido crear, editar o eliminar cuentas.
const verificarSoloAdministrador = (req, res, next) => {
  const usuario = verificarToken(req, res);
  if (!usuario) return;

  req.usuario = usuario;
  if (usuario.rol !== 'administrador') {
    return res.status(403).json({ error: 'Solo un administrador puede gestionar usuarios.' });
  }
  next();
};

module.exports = { verificarAdmin, verificarSoloAdministrador };