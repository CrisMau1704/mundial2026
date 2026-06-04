const { Pool } = require('pg');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ CONEXIÓN A POSTGRESQL ============
// Intentar obtener la URL desde diferentes variables de entorno
const databaseUrl = process.env.DATABASE_URL || process.env.INTERNAL_DATABASE_URL;

if (!databaseUrl) {
    console.error('❌ ERROR CRÍTICO: No se encontró DATABASE_URL en las variables de entorno');
    console.error('Variables disponibles:', Object.keys(process.env).join(', '));
    process.exit(1);
}

console.log('✅ Conectando a PostgreSQL...');
console.log(`📡 URL: ${databaseUrl.substring(0, 50)}...`);

const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
});

// Verificar conexión al iniciar
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Error conectando a PostgreSQL:', err.message);
        console.error('   Código:', err.code);
        if (err.code === 'ECONNREFUSED') {
            console.error('   📌 La URL de conexión es incorrecta o la base de datos no está accesible');
        }
        process.exit(1);
    } else {
        console.log('✅ Conectado exitosamente a PostgreSQL en Render');
        release();
    }
});

// ============ HEALTH CHECK ============
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT 1 as connected, NOW() as time');
        res.json({ 
            status: 'ok', 
            message: 'Base de datos conectada',
            timestamp: result.rows[0].time,
            db_url_configured: !!databaseUrl
        });
    } catch (err) {
        console.error('Health check error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// ============ USUARIOS ============
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query('SELECT id, nombre FROM usuarios ORDER BY nombre');
        console.log(`📊 Devolviendo ${result.rows.length} usuarios`);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/usuarios:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ PARTIDOS ============
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
        console.log(`📊 Devolviendo ${result.rows.length} partidos`);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/partidos:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ APUESTAS ============
app.get('/api/apuestas/:usuarioId', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT partido_id, equipo_apostado, puntos FROM apuestas WHERE usuario_id = $1',
            [req.params.usuarioId]
        );
        const apuestasMap = {};
        result.rows.forEach(a => { apuestasMap[a.partido_id] = a; });
        console.log(`📊 Usuario ${req.params.usuarioId}: ${result.rows.length} apuestas`);
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
        return res.status(400).json({ error: 'Faltan datos: usuario_id, partido_id, equipo_apostado' });
    }
    
    try {
        const result = await pool.query(
            `INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
             ON CONFLICT (usuario_id, partido_id) 
             DO UPDATE SET equipo_apostado = EXCLUDED.equipo_apostado, fecha_apuesta = CURRENT_TIMESTAMP
             RETURNING *`,
            [usuario_id, partido_id, equipo_apostado]
        );
        console.log(`✅ Apuesta guardada: usuario=${usuario_id}, partido=${partido_id}, equipo=${equipo_apostado}`);
        res.json({ success: true, apuesta: result.rows[0] });
    } catch (err) {
        console.error('Error guardando apuesta:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ RANKING ============
app.get('/api/ranking', async (req, res) => {
    try {
        const result = await pool.query(`
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
        `);
        console.log(`📊 Ranking: ${result.rows.length} usuarios`);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/ranking:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ ADMIN - PARTIDOS ============
app.get('/api/admin/partidos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                p.id, 
                e1.nombre as local, 
                e2.nombre as visitante,
                p.fecha, 
                p.ganador_real, 
                p.estado
            FROM partidos p
            JOIN equipos e1 ON p.equipo_local_id = e1.id
            JOIN equipos e2 ON p.equipo_visitante_id = e2.id
            ORDER BY p.id
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Error en /api/admin/partidos:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ ADMIN - RESULTADO ============
app.post('/api/admin/resultado', async (req, res) => {
    const { partido_id, ganador_real } = req.body;
    
    if (!partido_id || !ganador_real) {
        return res.status(400).json({ error: 'Faltan datos: partido_id, ganador_real' });
    }
    
    try {
        // Iniciar transacción
        await pool.query('BEGIN');
        
        // Actualizar el partido
        await pool.query(
            'UPDATE partidos SET ganador_real = $1, estado = $2 WHERE id = $3',
            [ganador_real, 'jugado', partido_id]
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
        
        // Confirmar transacción
        await pool.query('COMMIT');
        
        console.log(`✅ Resultado cargado: partido=${partido_id}, ganador=${ganador_real}`);
        res.json({ success: true, message: 'Resultado cargado y puntos actualizados' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error cargando resultado:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============ RUTA PRINCIPAL ============
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// ============ INICIAR SERVIDOR ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 ========================================`);
    console.log(`🚀 SERVICIO INICIADO CORRECTAMENTE`);
    console.log(`🚀 Puerto: ${PORT}`);
    console.log(`🚀 Base de datos: ${databaseUrl ? 'Configurada ✅' : 'NO CONFIGURADA ❌'}`);
    console.log(`🚀 ========================================\n`);
});