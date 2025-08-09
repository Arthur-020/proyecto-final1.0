const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

const app = express();
const port = process.env.PORT || 3000;

// Configurar Cloudinary con variables de entorno
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Conexión a PostgreSQL
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// Middleware y configuración
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'servidor')));

// Configurar sesiones
app.use(session({
  secret: 'clave_super_secreta',
  resave: false,
  saveUninitialized: false,
}));

// Multer: almacenar en memoria para luego subir a Cloudinary
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Middleware para verificar si está autenticado
function checkAuth(req, res, next) {
  if (req.session && req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Middleware para control de rol
function checkRole(role) {
  return (req, res, next) => {
    if (req.session.user && req.session.user.rol === role) {
      next();
    } else {
      res.status(403).send('Acceso denegado');
    }
  };
}

// Función para extraer public_id de Cloudinary desde la URL
function getPublicIdFromUrl(url) {
  if (!url) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    let publicIdWithExtension = parts[1];
    const lastDot = publicIdWithExtension.lastIndexOf('.');
    if (lastDot === -1) return publicIdWithExtension;
    return publicIdWithExtension.substring(0, lastDot);
  } catch {
    return null;
  }
}

// =================== LOGIN Y LOGOUT ===================
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  try {
    const result = await pool.query(
      'SELECT * FROM usuarios WHERE usuario = $1 AND contrasena = $2',
      [usuario, contrasena]
    );
    if (result.rows.length > 0) {
      req.session.user = {
        id: result.rows[0].id,
        nombre: result.rows[0].nombre,
        usuario: result.rows[0].usuario,
        rol: result.rows[0].rol
      };
      res.redirect('/');
    } else {
      res.render('login', { error: 'Usuario o contraseña incorrectos' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Error en el servidor');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// Proteger todas las rutas excepto login/logout
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/logout') return next();
  checkAuth(req, res, next);
});

// =================== MENÚ PRINCIPAL ===================
app.get('/', (req, res) => {
  res.render('menu', { user: req.session.user });
});

// =================== GESTIÓN DE USUARIOS (solo docente) ===================
app.get('/usuarios', checkRole('docente'), async (req, res) => {
  try {
    const usuarios = await pool.query('SELECT id, nombre, usuario, rol FROM usuarios ORDER BY id');
    res.render('usuarios', { usuarios: usuarios.rows, user: req.session.user, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar usuarios');
  }
});

app.post('/usuarios', checkRole('docente'), async (req, res) => {
  const { nombre, usuario, contrasena, rol } = req.body;
  try {
    await pool.query(
      'INSERT INTO usuarios (nombre, usuario, contrasena, rol) VALUES ($1, $2, $3, $4)',
      [nombre, usuario, contrasena, rol]
    );
    res.redirect('/usuarios');
  } catch (err) {
    console.error(err);
    const usuarios = await pool.query('SELECT id, nombre, usuario, rol FROM usuarios ORDER BY id');
    res.render('usuarios', { usuarios: usuarios.rows, user: req.session.user, error: 'Error: el usuario ya existe' });
  }
});

app.post('/usuarios/eliminar/:id', checkRole('docente'), async (req, res) => {
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.redirect('/usuarios');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al eliminar usuario');
  }
});

// =================== INVENTARIO ===================
app.get('/inventario', async (req, res) => {
  try {
    const { busqueda, tipo } = req.query;
    let query = `
      SELECT c.id, c.nombre, c.descripcion, c.cantidad, c.estado, c.imagen,
             cat.nombre AS tipo_nombre,
             ubi.nombre AS ubicacion_nombre
      FROM componentes c
      LEFT JOIN categorias cat ON c.tipo = cat.id
      LEFT JOIN ubicaciones ubi ON c.ubicacion = ubi.id
      WHERE 1=1
    `;
    const valores = [];
    let index = 1;
    if (busqueda) {
      query += ` AND LOWER(c.nombre) LIKE LOWER($${index++})`;
      valores.push(`%${busqueda}%`);
    }
    if (tipo) {
      query += ` AND c.tipo = $${index++}`;
      valores.push(tipo);
    }
    query += ` ORDER BY c.id`;
    const result = await pool.query(query, valores);
    const categorias = await pool.query('SELECT * FROM categorias');
    res.render('inventario', {
      componentes: result.rows,
      categorias: categorias.rows,
      user: req.session.user,
      busqueda: busqueda || '',
      tipo: tipo || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar inventario');
  }
});

// =================== CRUD COMPONENTES (solo docente) ===================
app.get('/registro', checkRole('docente'), async (req, res) => {
  try {
    const categorias = await pool.query('SELECT * FROM categorias ORDER BY nombre');
    const ubicaciones = await pool.query('SELECT * FROM ubicaciones ORDER BY nombre');
    res.render('registro', { categorias: categorias.rows, ubicaciones: ubicaciones.rows, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar formulario de registro');
  }
});

app.post('/agregar', checkRole('docente'), upload.single('imagen'), async (req, res) => {
  const { nombre, descripcion, cantidad, tipo, ubicacion, estado } = req.body;
  try {
    let imagenUrl = null;

    if (req.file) {
      imagenUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'inventario' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );
        stream.end(req.file.buffer);
      });
    }

    await pool.query(
      `INSERT INTO componentes (nombre, descripcion, cantidad, tipo, ubicacion, estado, imagen)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [nombre, descripcion, cantidad, tipo, ubicacion, estado, imagenUrl]
    );
    res.redirect('/inventario');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al guardar componente');
  }
});

app.get('/editar/:id', checkRole('docente'), async (req, res) => {
  try {
    const id = req.params.id;
    const compRes = await pool.query('SELECT * FROM componentes WHERE id = $1', [id]);
    const categorias = await pool.query('SELECT * FROM categorias ORDER BY nombre');
    const ubicaciones = await pool.query('SELECT * FROM ubicaciones ORDER BY nombre');
    if (compRes.rows.length === 0) return res.status(404).send('Componente no encontrado');
    res.render('editar', { 
      componente: compRes.rows[0], 
      categorias: categorias.rows, 
      ubicaciones: ubicaciones.rows,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar componente');
  }
});

app.post('/editar/:id', checkRole('docente'), upload.single('imagen'), async (req, res) => {
  const id = req.params.id;
  const { nombre, descripcion, cantidad, tipo, ubicacion, estado } = req.body;
  try {
    let imagenUrl;
    if (req.file) {
      imagenUrl = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'inventario' },
          (error, result) => {
            if (error) reject(error);
            else resolve(result.secure_url);
          }
        );
        stream.end(req.file.buffer);
      });
    }

    let query, params;
    if (imagenUrl) {
      query = `UPDATE componentes SET nombre=$1, descripcion=$2, cantidad=$3, tipo=$4, ubicacion=$5, estado=$6, imagen=$7 WHERE id=$8`;
      params = [nombre, descripcion, cantidad, tipo, ubicacion, estado, imagenUrl, id];
    } else {
      query = `UPDATE componentes SET nombre=$1, descripcion=$2, cantidad=$3, tipo=$4, ubicacion=$5, estado=$6 WHERE id=$7`;
      params = [nombre, descripcion, cantidad, tipo, ubicacion, estado, id];
    }

    await pool.query(query, params);
    res.redirect('/inventario');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al actualizar componente');
  }
});

// =================== ELIMINAR COMPONENTE Y SU IMAGEN EN CLOUDINARY ===================
function getPublicIdFromUrl(url) {
  if (!url) return null;
  const parts = url.split('/');
  const filename = parts.pop();
  const uploadIndex = parts.indexOf('upload');
  if (uploadIndex === -1) return null;
  const folderParts = parts.slice(uploadIndex + 1);
  const folder = folderParts.join('/');
  const publicId = folder ? `${folder}/${filename}` : filename;
  return publicId.replace(/\.[^/.]+$/, "");
}

app.get('/eliminar/:id', checkRole('docente'), async (req, res) => {
  try {
    const id = req.params.id;

    // Eliminar historial relacionado
    await pool.query('DELETE FROM historial WHERE componente_id = $1', [id]);

    // Obtener URL de la imagen antes de borrar el componente
    const compRes = await pool.query('SELECT imagen FROM componentes WHERE id = $1', [id]);
    if (compRes.rows.length > 0 && compRes.rows[0].imagen) {
      const publicId = getPublicIdFromUrl(compRes.rows[0].imagen);
      console.log('PublicId a eliminar en Cloudinary:', publicId); // Para depurar
      if (publicId) {
        await cloudinary.uploader.destroy(publicId);
      }
    }

    // Eliminar componente
    await pool.query('DELETE FROM componentes WHERE id = $1', [id]);

    res.redirect('/inventario');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al eliminar componente');
  }
});

// =================== CATEGORÍAS Y UBICACIONES ===================
app.get('/categorias_ubicaciones', async (req, res) => {
  try {
    const categoria = req.query.categoria || '';
    const ubicacion = req.query.ubicacion || '';
    const categoriasRes = await pool.query('SELECT * FROM categorias ORDER BY nombre');
    const ubicacionesRes = await pool.query('SELECT * FROM ubicaciones ORDER BY nombre');
    let query = `
      SELECT c.id, c.nombre, c.descripcion, c.cantidad,
             cat.nombre AS categoria_nombre,
             ubi.nombre AS ubicacion_nombre
      FROM componentes c
      LEFT JOIN categorias cat ON c.tipo = cat.id
      LEFT JOIN ubicaciones ubi ON c.ubicacion = ubi.id
      WHERE 1=1
    `;
    const valores = [];
    let idx = 1;
    if (categoria) {
      query += ` AND c.tipo = $${idx++}`;
      valores.push(categoria);
    }
    if (ubicacion) {
      query += ` AND c.ubicacion = $${idx++}`;
      valores.push(ubicacion);
    }
    query += ' ORDER BY c.nombre';
    const componentesRes = await pool.query(query, valores);
    res.render('categorias_ubicaciones', {
      categorias: categoriasRes.rows,
      ubicaciones: ubicacionesRes.rows,
      componentes: componentesRes.rows,
      categoria,
      ubicacion,
      user: req.session.user
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Error al cargar categorías, ubicaciones y componentes');
  }
});

app.post('/categorias_ubicaciones/categorias', checkRole('docente'), async (req, res) => {
  try {
    const { nombre } = req.body;
    await pool.query('INSERT INTO categorias (nombre) VALUES ($1)', [nombre]);
    res.redirect('/categorias_ubicaciones');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear categoría');
  }
});

app.post('/categorias_ubicaciones/ubicaciones', checkRole('docente'), async (req, res) => {
  try {
    const { nombre } = req.body;
    await pool.query('INSERT INTO ubicaciones (nombre) VALUES ($1)', [nombre]);
    res.redirect('/categorias_ubicaciones');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al crear ubicación');
  }
});

app.post('/categorias_ubicaciones/categorias/eliminar/:id', checkRole('docente'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM categorias WHERE id = $1', [id]);
    res.redirect('/categorias_ubicaciones');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al eliminar categoría');
  }
});

app.post('/categorias_ubicaciones/ubicaciones/eliminar/:id', checkRole('docente'), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM ubicaciones WHERE id = $1', [id]);
    res.redirect('/categorias_ubicaciones');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al eliminar ubicación');
  }
});

// =================== HISTORIAL ===================
app.get('/historial', async (req, res) => {
  try {
    const movimientosRes = await pool.query(`
      SELECT h.*, c.nombre AS componente_nombre 
      FROM historial h 
      JOIN componentes c ON h.componente_id = c.id
      ORDER BY h.fecha DESC
    `);
    const componentesRes = await pool.query('SELECT id, nombre FROM componentes ORDER BY nombre');
    res.render('historial', {
      movimientos: movimientosRes.rows,
      componentes: componentesRes.rows,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al cargar historial');
  }
});

app.get('/historial/buscar', async (req, res) => {
  try {
    const { persona } = req.query;
    const movimientosRes = await pool.query(`
      SELECT h.*, c.nombre AS componente_nombre 
      FROM historial h 
      JOIN componentes c ON h.componente_id = c.id
      WHERE LOWER(h.persona) LIKE LOWER($1)
      ORDER BY h.fecha DESC
    `, [`%${persona}%`]);
    const componentesRes = await pool.query('SELECT id, nombre FROM componentes ORDER BY nombre');
    res.render('historial', {
      movimientos: movimientosRes.rows,
      componentes: componentesRes.rows,
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al buscar en historial');
  }
});

app.post('/historial', checkRole('docente'), async (req, res) => {
  try {
    let { componente_id, movimiento, cantidad, persona, observaciones } = req.body;
    cantidad = parseInt(cantidad);
    await pool.query(
      `INSERT INTO historial (componente_id, movimiento, cantidad, persona, observaciones) 
       VALUES ($1, $2, $3, $4, $5)`,
      [componente_id, movimiento, cantidad, persona, observaciones]
    );
    if (movimiento === 'ingreso' || movimiento === 'devolución') {
      await pool.query('UPDATE componentes SET cantidad = cantidad + $1 WHERE id = $2', [cantidad, componente_id]);
    } else if (movimiento === 'salida' || movimiento === 'préstamo') {
      await pool.query('UPDATE componentes SET cantidad = cantidad - $1 WHERE id = $2', [cantidad, componente_id]);
    }
    res.redirect('/historial');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al registrar movimiento');
  }
});

// =================== INICIO SERVIDOR ===================
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
