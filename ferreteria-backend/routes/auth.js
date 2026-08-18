const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// Ruta para hacer Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Buscar si el usuario existe
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const usuario = result.rows[0];

    // 2. Verificar contraseña
    // Los usuarios nuevos se guardan con bcrypt (el hash siempre empieza con "$2").
    // Si un usuario viejo todavía tiene la contraseña en texto plano, se compara
    // directo por compatibilidad, pero debe actualizarse cuanto antes.
    const passwordValida = usuario.password_hash.startsWith('$2')
      ? await bcrypt.compare(password, usuario.password_hash)
      : password === usuario.password_hash;

    if (!passwordValida) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    // 3. Generar el Token JWT
    const token = jwt.sign(
      { id: usuario.id, rol: usuario.rol }, 
      process.env.JWT_SECRET, 
      { expiresIn: '8h' }
    );

    // 4. Enviar respuesta al Frontend
    res.json({
      mensaje: 'Login exitoso',
      token: token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol
      }
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;