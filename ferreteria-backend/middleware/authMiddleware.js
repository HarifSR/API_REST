const jwt = require('jsonwebtoken');

// Middleware para verificar que el usuario tenga un token válido y sea Administrador
const verificarAdmin = (req, res, next) => {
  // Leer el token del encabezado (Header) de la petición
  const token = req.header('Authorization');

  if (!token) {
    return res.status(401).json({ error: 'Acceso denegado. No hay token de seguridad.' });
  }

  try {
    // Quitar la palabra "Bearer " si viene incluida
    const tokenLimpio = token.replace('Bearer ', '');
    
    // Desencriptar el token
    const verificado = jwt.verify(tokenLimpio, process.env.JWT_SECRET);
    req.usuario = verificado; // Guardamos los datos del usuario en la petición

    // Verificar si el rol es administrador
    if (req.usuario.rol !== 'administrador') {
      return res.status(403).json({ error: 'Acceso denegado. Solo los administradores pueden hacer esto.' });
    }

    next(); // Si todo está bien, dejamos que la petición continúe
  } catch (error) {
    res.status(400).json({ error: 'Token no válido o expirado.' });
  }
};

module.exports = { verificarAdmin };