const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Conexión a MySQL
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'mundial2026'
});

db.connect(err => {
    if (err) throw err;
    console.log('✅ Conectado a MySQL');
});

// ============ API PARA USUARIOS ============

// Obtener lista de usuarios (para el selector)
app.get('/api/usuarios', (req, res) => {
    db.query('SELECT id, nombre FROM usuarios ORDER BY nombre', (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

// Verificar login simple (sin contraseña por ahora)
app.post('/api/login', (req, res) => {
    const { usuario_id } = req.body;
    db.query('SELECT id, nombre FROM usuarios WHERE id = ?', [usuario_id], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            res.json({ success: true, usuario: results[0] });
        } else {
            res.json({ success: false });
        }
    });
});

// ============ API PARA PARTIDOS ============

// Obtener todos los partidos con sus grupos
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
        if (err) throw err;
        res.json(results);
    });
});

// ============ API PARA APUESTAS ============

// Obtener apuestas de un usuario
app.get('/api/apuestas/:usuarioId', (req, res) => {
    const sql = `
        SELECT 
            partido_id,
            equipo_apostado,
            puntos,
            fecha_apuesta
        FROM apuestas
        WHERE usuario_id = ?
    `;
    db.query(sql, [req.params.usuarioId], (err, results) => {
        if (err) throw err;
        // Convertir a objeto para fácil acceso
        const apuestasMap = {};
        results.forEach(apuesta => {
            apuestasMap[apuesta.partido_id] = apuesta;
        });
        res.json(apuestasMap);
    });
});

// Guardar o actualizar apuesta
app.post('/api/apostar', (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    // Verificar si el partido ya comenzó
    const checkSql = `
        SELECT fecha, estado FROM partidos WHERE id = ?
    `;
    
    db.query(checkSql, [partido_id], (err, results) => {
        if (err) throw err;
        
        const partido = results[0];
        const fechaPartido = new Date(partido.fecha);
        const ahora = new Date();
        
        if (ahora > fechaPartido && partido.estado !== 'pendiente') {
            return res.status(400).json({ 
                error: 'El partido ya comenzó o terminó, no se puede modificar la apuesta' 
            });
        }
        
        // Guardar o actualizar apuesta
        const upsertSql = `
            INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            equipo_apostado = VALUES(equipo_apostado),
            fecha_apuesta = NOW()
        `;
        
        db.query(upsertSql, [usuario_id, partido_id, equipo_apostado], (err) => {
            if (err) throw err;
            res.json({ success: true });
        });
    });
});

// ============ API PARA RANKING ============

// Obtener ranking actualizado
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
        if (err) throw err;
        res.json(results);
    });
});

// ============ PANEL ADMIN (cargar resultados) ============

// Obtener partidos para admin
app.get('/api/admin/partidos', (req, res) => {
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
    db.query(sql, (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

// Cargar resultado de un partido y actualizar puntos
app.post('/api/admin/resultado', (req, res) => {
    const { partido_id, ganador_real, goles_local, goles_visitante } = req.body;
    
    // Actualizar el partido
    const updatePartido = `
        UPDATE partidos 
        SET ganador_real = ?, 
            resultado_local = ?, 
            resultado_visitante = ?,
            estado = 'jugado'
        WHERE id = ?
    `;
    
    db.query(updatePartido, [ganador_real, goles_local, goles_visitante, partido_id], (err) => {
        if (err) throw err;
        
        // Actualizar puntos de las apuestas
        const updatePuntos = `
            UPDATE apuestas a
            SET a.puntos = CASE 
                WHEN a.equipo_apostado = ? THEN 1
                ELSE 0
            END
            WHERE a.partido_id = ?
        `;
        
        db.query(updatePuntos, [ganador_real, partido_id], (err) => {
            if (err) throw err;
            
            // Registrar en historial
            const historialSql = `
                INSERT INTO historial_puntajes (usuario_id, partido_id, puntos_antes, puntos_despues)
                SELECT a.usuario_id, a.partido_id, 0, a.puntos
                FROM apuestas a
                WHERE a.partido_id = ?
            `;
            
            db.query(historialSql, [partido_id], (err) => {
                if (err) throw err;
                res.json({ success: true });
            });
        });
    });
});

// Puerto del servidor
app.listen(3000, () => {
    console.log('🚀 Servidor en http://localhost:3000');
    console.log('📱 Abrí desde cualquier celular en la misma red WiFi');
    console.log('🔧 Panel Admin: http://localhost:3000/admin.html');
});