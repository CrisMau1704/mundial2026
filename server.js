const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Servir archivos estáticos
app.use(express.static('public'));

// ============ CONEXIÓN A MySQL EN CPANEL ============
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
    } else {
        console.log('✅ Conectado a MySQL en cPanel');
    }
});

// ============ API ENDPOINTS ============
app.get('/api/usuarios', (req, res) => {
    db.query('SELECT id, nombre FROM usuarios ORDER BY nombre', (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

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
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

app.get('/api/apuestas/:usuarioId', (req, res) => {
    const sql = `
        SELECT partido_id, equipo_apostado, puntos, fecha_apuesta
        FROM apuestas
        WHERE usuario_id = ?
    `;
    db.query(sql, [req.params.usuarioId], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const apuestasMap = {};
        results.forEach(apuesta => {
            apuestasMap[apuesta.partido_id] = apuesta;
        });
        res.json(apuestasMap);
    });
});

app.post('/api/apostar', (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    const checkSql = `SELECT fecha, estado FROM partidos WHERE id = ?`;
    
    db.query(checkSql, [partido_id], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const partido = results[0];
        const fechaPartido = new Date(partido.fecha);
        const ahora = new Date();
        
        if (ahora > fechaPartido && partido.estado !== 'pendiente') {
            return res.status(400).json({ 
                error: 'El partido ya comenzó o terminó, no se puede modificar la apuesta' 
            });
        }
        
        const upsertSql = `
            INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            equipo_apostado = VALUES(equipo_apostado),
            fecha_apuesta = NOW()
        `;
        
        db.query(upsertSql, [usuario_id, partido_id, equipo_apostado], (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ success: true });
        });
    });
});

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
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

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
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

app.post('/api/admin/resultado', (req, res) => {
    const { partido_id, ganador_real } = req.body;
    
    const updatePartido = `
        UPDATE partidos 
        SET ganador_real = ?, estado = 'jugado'
        WHERE id = ?
    `;
    
    db.query(updatePartido, [ganador_real, partido_id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        const updatePuntos = `
            UPDATE apuestas 
            SET puntos = CASE WHEN equipo_apostado = ? THEN 1 ELSE 0 END
            WHERE partido_id = ?
        `;
        
        db.query(updatePuntos, [ganador_real, partido_id], (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ success: true });
        });
    });
});

// Para Vercel, exportamos la app
module.exports = app;