const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verificarAdmin } = require('../middleware/authMiddleware');

// 1. RUTA GET: Obtener todos los productos (Pública, para la vitrina y el backoffice)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.id, p.nombre, p.marca, p.precio, p.cantidad_stock, p.descripcion, p.url_imagen,
             c.nombre AS categoria, u.nombre AS unidad_medida
      FROM productos p
      LEFT JOIN categorias c ON p.categoria_id = c.id
      LEFT JOIN unidades_medida u ON p.unidad_base_id = u.id
      ORDER BY p.fecha_registro DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al obtener el inventario' });
  }
});

// 2. RUTA POST: Crear un nuevo producto (Privada, SOLO ADMINISTRADORES)
router.post('/', verificarAdmin, async (req, res) => {
  const { 
    id, nombre, categoria_id, marca, precio, 
    cantidad_stock, descripcion, url_imagen, unidad_base_id 
  } = req.body;

  try {
    // Validar el formato del ID (FVXXX) desde el backend
    const regexID = /^FV[0-9]{3}$/;
    if (!regexID.test(id)) {
      return res.status(400).json({ error: 'El ID debe tener el formato FV seguido de 3 números (Ej: FV001)' });
    }

    // Insertar en PostgreSQL (Usamos $1, $2... para evitar inyecciones SQL por seguridad)
    const query = `
      INSERT INTO productos 
      (id, nombre, categoria_id, marca, precio, cantidad_stock, descripcion, url_imagen, unidad_base_id) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING *;
    `;
    
    const valores = [
      id, nombre, 
      categoria_id || null, // Si viene vacío, lo guarda como NULL
      marca || null, 
      precio || null, 
      cantidad_stock || 0, 
      descripcion || null, 
      url_imagen || null, 
      unidad_base_id // Este sí es obligatorio según nuestro diseño
    ];

    const nuevoProducto = await pool.query(query, valores);
    
    res.status(201).json({
      mensaje: '¡Producto registrado con éxito!',
      producto: nuevoProducto.rows[0]
    });

  } catch (err) {
    console.error(err.message);
    // Manejar el error de ID duplicado en PostgreSQL (código '23505')
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Ya existe un producto registrado con ese ID.' });
    }
    res.status(500).json({ error: 'Error en el servidor al registrar el producto.' });
  }
});

module.exports = router;