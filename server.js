const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ CONEXIÓN A MYSQL ============
const db = mysql.createConnection({
    host: '69.61.33.107',
    user: 'alianzab_administrador',
    password: 'Alianza-2026*',
    database: 'alianzab_mundial2026',
    port: 3306
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        process.exit(1);
    } else {
        console.log('✅ Conectado a MySQL');
    }
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
    db.query('SELECT 1', (err) => {
        if (err) {
            res.status(500).json({ status: 'error', message: err.message });
        } else {
            res.json({ status: 'ok', message: 'Base de datos conectada' });
        }
    });
});

// ============ USUARIOS ============
app.get('/api/usuarios', (req, res) => {
    db.query('SELECT id, nombre FROM usuarios ORDER BY nombre', (err, results) => {
        if (err) {
            console.error('Error en /api/usuarios:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

// ============ PARTIDOS ============
app.get('/api/partidos', (req, res) => {
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
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error en /api/partidos:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

// ============ APUESTAS ============
app.get('/api/apuestas/:usuarioId', (req, res) => {
    db.query('SELECT partido_id, equipo_apostado, puntos FROM apuestas WHERE usuario_id = ?',
        [req.params.usuarioId],
        (err, results) => {
            if (err) {
                console.error('Error en /api/apuestas:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            const apuestasMap = {};
            results.forEach(a => { apuestasMap[a.partido_id] = a; });
            res.json(apuestasMap);
        }
    );
});

// ============ GUARDAR APUESTA ============
app.post('/api/apostar', (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    if (!usuario_id || !partido_id || !equipo_apostado) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    
    const sql = `
        INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
        VALUES (?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
        equipo_apostado = VALUES(equipo_apostado),
        fecha_apuesta = VALUES(fecha_apuesta)
    `;
    
    db.query(sql, [usuario_id, partido_id, equipo_apostado], (err) => {
        if (err) {
            console.error('Error guardando apuesta:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true });
    });
});

// ============ RANKING ============
app.get('/api/ranking', (req, res) => {
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
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error en /api/ranking:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

// ============ ADMIN - PARTIDOS ============
app.get('/api/admin/partidos', (req, res) => {
    const sql = `
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
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error('Error en /api/admin/partidos:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

// ============ ADMIN - RESULTADO ============
app.post('/api/admin/resultado', (req, res) => {
    const { partido_id, ganador_real } = req.body;
    
    if (!partido_id || !ganador_real) {
        return res.status(400).json({ error: 'Faltan datos' });
    }
    
    db.query('UPDATE partidos SET ganador_real = ?, estado = ? WHERE id = ?',
        [ganador_real, 'jugado', partido_id],
        (err) => {
            if (err) {
                console.error('Error actualizando partido:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            
            db.query('UPDATE apuestas SET puntos = CASE WHEN equipo_apostado = ? THEN 1 ELSE 0 END WHERE partido_id = ?',
                [ganador_real, partido_id],
                (err) => {
                    if (err) {
                        console.error('Error actualizando puntos:', err);
                        res.status(500).json({ error: err.message });
                        return;
                    }
                    res.json({ success: true });
                }
            );
        }
    );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
});