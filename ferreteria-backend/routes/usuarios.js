const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { verificarSoloAdministrador } = require('../middleware/authMiddleware');

// GET: Listar todos los usuarios (nunca se devuelve la contraseña)
router.get('/', verificarSoloAdministrador, async (req, res) => {
  try {
    const resultado = await pool.query(
      'SELECT id, nombre, email, rol, fecha_creacion FROM usuarios ORDER BY fecha_creacion ASC'
    );
    res.json(resultado.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener los usuarios.' });
  }
});

// POST: Crear un nuevo usuario (la contraseña se guarda con hash bcrypt)
router.post('/', verificarSoloAdministrador, async (req, res) => {
  const { nombre, email, password, rol } = req.body;

  if (!nombre || !email || !password) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña son obligatorios.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const resultado = await pool.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol) 
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol, fecha_creacion`,
      [nombre, email, hash, rol === 'operador' ? 'operador' : 'administrador']
    );
    res.status(201).json({ mensaje: 'Usuario creado correctamente.', usuario: resultado.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un usuario registrado con ese correo.' });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Error al crear el usuario.' });
  }
});

// PUT: Editar un usuario (nombre, correo, rol; la contraseña solo se cambia si se envía una nueva)
router.put('/:id', verificarSoloAdministrador, async (req, res) => {
  const { id } = req.params;
  const { nombre, email, rol, password } = req.body;

  if (!nombre || !email) {
    return res.status(400).json({ error: 'Nombre y correo son obligatorios.' });
  }

  try {
    let resultado;
    if (password && password.trim()) {
      if (password.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
      }
      const hash = await bcrypt.hash(password, 10);
      resultado = await pool.query(
        `UPDATE usuarios SET nombre = $1, email = $2, rol = $3, password_hash = $4
         WHERE id = $5 RETURNING id, nombre, email, rol, fecha_creacion`,
        [nombre, email, rol === 'operador' ? 'operador' : 'administrador', hash, id]
      );
    } else {
      resultado = await pool.query(
        `UPDATE usuarios SET nombre = $1, email = $2, rol = $3
         WHERE id = $4 RETURNING id, nombre, email, rol, fecha_creacion`,
        [nombre, email, rol === 'operador' ? 'operador' : 'administrador', id]
      );
    }

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'El usuario no existe.' });
    }
    res.json({ mensaje: 'Usuario actualizado correctamente.', usuario: resultado.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe otro usuario registrado con ese correo.' });
    }
    console.error(err.message);
    res.status(500).json({ error: 'Error al actualizar el usuario.' });
  }
});

// DELETE: Eliminar un usuario (no se permite auto-eliminarse, ni dejar el sistema sin administradores)
router.delete('/:id', verificarSoloAdministrador, async (req, res) => {
  const { id } = req.params;

  if (req.usuario.id === parseInt(id, 10)) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta mientras tienes la sesión abierta.' });
  }

  try {
    const usuarioRes = await pool.query('SELECT rol FROM usuarios WHERE id = $1', [id]);
    if (usuarioRes.rows.length === 0) {
      return res.status(404).json({ error: 'El usuario no existe.' });
    }

    if (usuarioRes.rows[0].rol === 'administrador') {
      const conteoAdmins = await pool.query(`SELECT COUNT(*) FROM usuarios WHERE rol = 'administrador'`);
      if (parseInt(conteoAdmins.rows[0].count, 10) <= 1) {
        return res.status(400).json({ error: 'No puedes eliminar al último administrador del sistema.' });
      }
    }

    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ mensaje: 'Usuario eliminado correctamente.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al eliminar el usuario.' });
  }
});

module.exports = router;