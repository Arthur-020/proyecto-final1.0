const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const crearTablas = async () => {
  try {
    // Crear tabla categorias
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL
      );
    `);

    // Crear tabla ubicaciones
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ubicaciones (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL
      );
    `);

    // Crear tabla componentes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS componentes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(100) NOT NULL,
        descripcion TEXT,
        cantidad INTEGER DEFAULT 0,
        tipo INTEGER REFERENCES categorias(id),
        ubicacion INTEGER REFERENCES ubicaciones(id),
        estado VARCHAR(50),
        imagen VARCHAR(255),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Crear tabla historial
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historial (
        id SERIAL PRIMARY KEY,
        componente_id INTEGER REFERENCES componentes(id),
        movimiento TEXT,
        cantidad INTEGER,
        persona TEXT,
        observaciones TEXT,
        fecha TIMESTAMP DEFAULT now()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL,
        usuario TEXT UNIQUE NOT NULL,
        contrasena TEXT NOT NULL,
        rol TEXT NOT NULL CHECK (rol IN ('docente', 'estudiante'))
      );
    `);

    console.log("✅ Tablas creadas correctamente.");
  } catch (err) {
    console.error("❌ Error creando las tablas:", err);
  } finally {
    await pool.end();
  }
};

crearTablas();
