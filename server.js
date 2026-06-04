const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ CONEXIÓN SIMPLIFICADA ============
const databaseUrl = process.env.DATABASE_URL || process.env.INTERNAL_DATABASE_URL;

if (!databaseUrl) {
    console.error('❌ ERROR: No se encontró DATABASE_URL');
    process.exit(1);
}

console.log('✅ Conectando a PostgreSQL...');

const pool = new Pool({
    connectionString: databaseUrl,
});

// Health check
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Usuarios
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM usuarios ORDER BY nombre');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Partidos
app.get('/api/partidos', async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.id,
                g.nombre as grupo,
                e1.nombre as local,
                e2.nombre as visitante,
                p.fecha,
                p.ganador_real,
                p.estado
            FROM partidos p
            JOIN grupos g ON p.grupo_id = g.id
            JOIN equipos e1 ON p.equipo_local_id = e1.id
            JOIN equipos e2 ON p.equipo_visitante_id = e2.id
            ORDER BY g.orden, p.fecha, p.id
        `;
        const result = await pool.query(sql);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Apuestas de usuario
app.get('/api/apuestas/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT partido_id, equipo_apostado, puntos FROM apuestas WHERE usuario_id = $1',
            [req.params.usuarioId]
        );
        const apuestasMap = {};
        result.rows.forEach(a => { apuestasMap[a.partido_id] = a; });
        res.json(apuestasMap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Guardar apuesta
app.post('/api/apostar', async (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    if (!usuario_id || !partido_id || !equipo_apostado) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    
    try {
        await pool.query(
            `INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (usuario_id, partido_id) 
             DO UPDATE SET equipo_apostado = EXCLUDED.equipo_apostado`,
            [usuario_id, partido_id, equipo_apostado]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ranking
app.get('/api/ranking', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.nombre,
                   COALESCE(SUM(a.puntos), 0) as puntos,
                   COUNT(a.id) as total_apostados,
                   SUM(CASE WHEN a.puntos > 0 THEN 1 ELSE 0 END) as aciertos
            FROM usuarios u
            LEFT JOIN apuestas a ON u.id = a.usuario_id
            GROUP BY u.id
            ORDER BY puntos DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin - Obtener partidos
app.get('/api/admin/partidos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p.id, e1.nombre as local, e2.nombre as visitante,
                   p.fecha, p.ganador_real, p.estado
            FROM partidos p
            JOIN equipos e1 ON p.equipo_local_id = e1.id
            JOIN equipos e2 ON p.equipo_visitante_id = e2.id
            ORDER BY p.id
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin - Cargar resultado
app.post('/api/admin/resultado', async (req, res) => {
    const { partido_id, ganador_real } = req.body;
    
    if (!partido_id || !ganador_real) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    
    try {
        await pool.query('BEGIN');
        await pool.query(
            'UPDATE partidos SET ganador_real = $1, estado = $2 WHERE id = $3',
            [ganador_real, 'jugado', partido_id]
        );
        await pool.query(
            `UPDATE apuestas 
             SET puntos = CASE WHEN equipo_apostado = $1 THEN 1 ELSE 0 END
             WHERE partido_id = $2`,
            [ganador_real, partido_id]
        );
        await pool.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await pool.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});
