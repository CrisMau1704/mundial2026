const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ CONEXIÓN A POSTGRESQL EN RENDER ============
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://mundial2026_db_user:DGTbaJENpRambu7eTFAicCQnBDSJr8BN@dpg-d8gflggjo6nc73eg5ls0-a/mundial2026_db',
    ssl: { rejectUnauthorized: false }
});

// Verificar conexión
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
    } else {
        console.log('✅ Conectado a PostgreSQL en Render');
        release();
    }
});

// ============ API PARA USUARIOS ============
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM usuarios ORDER BY nombre');
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/usuarios:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ API PARA PARTIDOS ============
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
        console.error('Error en /api/partidos:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ API PARA APUESTAS DE UN USUARIO ============
app.get('/api/apuestas/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT partido_id, equipo_apostado, puntos, fecha_apuesta FROM apuestas WHERE usuario_id = $1',
            [req.params.usuarioId]
        );
        const apuestasMap = {};
        result.rows.forEach(apuesta => {
            apuestasMap[apuesta.partido_id] = apuesta;
        });
        res.json(apuestasMap);
    } catch (err) {
        console.error('Error en /api/apuestas:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ GUARDAR APUESTA ============
app.post('/api/apostar', async (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    if (!usuario_id || !partido_id || !equipo_apostado) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    try {
        // Verificar si el partido ya comenzó
        const checkResult = await pool.query(
            'SELECT fecha, estado, ganador_real FROM partidos WHERE id = $1',
            [partido_id]
        );
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Partido no encontrado' });
        }
        
        const partido = checkResult.rows[0];
        
        if (partido.ganador_real) {
            return res.status(400).json({ error: 'El partido ya finalizó, no se puede apostar' });
        }
        
        const fechaPartido = new Date(partido.fecha);
        const ahora = new Date();
        
        if (ahora > fechaPartido) {
            return res.status(400).json({ error: 'El partido ya comenzó, no se puede apostar' });
        }
        
        // Guardar o actualizar apuesta
        await pool.query(
            `INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (usuario_id, partido_id) 
             DO UPDATE SET equipo_apostado = EXCLUDED.equipo_apostado, fecha_apuesta = CURRENT_TIMESTAMP`,
            [usuario_id, partido_id, equipo_apostado]
        );
        
        res.json({ success: true, message: 'Apuesta guardada exitosamente' });
    } catch (err) {
        console.error('Error guardando apuesta:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ RANKING ============
app.get('/api/ranking', async (req, res) => {
    try {
        const sql = `
            SELECT 
                u.id,
                u.nombre,
                COALESCE(SUM(a.puntos), 0) as puntos,
                COUNT(a.id) as total_apostados,
                SUM(CASE WHEN a.puntos > 0 THEN 1 ELSE 0 END) as aciertos
            FROM usuarios u
            LEFT JOIN apuestas a ON u.id = a.usuario_id
            GROUP BY u.id
            ORDER BY puntos DESC, aciertos DESC
        `;
        const result = await pool.query(sql);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/ranking:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ PANEL ADMIN - OBTENER PARTIDOS ============
app.get('/api/admin/partidos', async (req, res) => {
    try {
        const sql = `
            SELECT 
                p.id,
                e1.nombre as local,
                e2.nombre as visitante,
                p.fecha,
                p.ganador_real,
                p.resultado_local,
                p.resultado_visitante,
                p.estado
            FROM partidos p
            JOIN equipos e1 ON p.equipo_local_id = e1.id
            JOIN equipos e2 ON p.equipo_visitante_id = e2.id
            ORDER BY p.fecha, p.id
        `;
        const result = await pool.query(sql);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/admin/partidos:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ PANEL ADMIN - CARGAR RESULTADO ============
app.post('/api/admin/resultado', async (req, res) => {
    const { partido_id, ganador_real, goles_local, goles_visitante } = req.body;
    
    if (!partido_id || !ganador_real) {
        return res.status(400).json({ error: 'Faltan datos requeridos' });
    }
    
    try {
        // Actualizar el partido
        await pool.query(
            `UPDATE partidos 
             SET ganador_real = $1, 
                 resultado_local = $2, 
                 resultado_visitante = $3,
                 estado = 'jugado'
             WHERE id = $4`,
            [ganador_real, goles_local || 0, goles_visitante || 0, partido_id]
        );
        
        // Actualizar puntos de las apuestas
        await pool.query(
            `UPDATE apuestas 
             SET puntos = CASE 
                 WHEN equipo_apostado = $1 THEN 1 
                 ELSE 0 
             END
             WHERE partido_id = $2`,
            [ganador_real, partido_id]
        );
        
        res.json({ success: true, message: 'Resultado cargado y puntos actualizados' });
    } catch (err) {
        console.error('Error cargando resultado:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ RUTA DE PRUEBA ============
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', message: 'Base de datos conectada' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ============ INICIAR SERVIDOR ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`✅ Conectado a PostgreSQL en Render`);
});