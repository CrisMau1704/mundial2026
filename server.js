const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============ CONEXIÓN A MYSQL EN CPANEL ============
const db = mysql.createConnection({
    host: process.env.DB_HOST || '69.61.33.107',
    user: process.env.DB_USER || 'alianzab_administrador',
    password: process.env.DB_PASSWORD || 'Alianza-2026*',
    database: process.env.DB_NAME || 'alianzab_mundial2026',
    port: 3306,
    connectTimeout: 10000,
    // Para evitar desconexiones en Render
    keepAliveInitialDelay: 10000,
    enableKeepAlive: true
});

db.connect((err) => {
    if (err) {
        console.error('❌ Error conectando a MySQL:', err.message);
        console.error('Código:', err.code);
        console.log('\n📌 Verificá que:');
        console.log('   1. El hosting permita conexiones externas');
        console.log('   2. Las credenciales sean correctas');
        console.log('   3. La base de datos "alianzab_mundial2026" exista');
    } else {
        console.log('✅ Conectado a MySQL en cPanel');
    }
});

// ============ API PARA USUARIOS ============
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

// ============ API PARA PARTIDOS ============
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

// ============ API PARA APUESTAS DE UN USUARIO ============
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
        if (err) {
            console.error('Error en /api/apuestas:', err);
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

// ============ GUARDAR APUESTA ============
app.post('/api/apostar', (req, res) => {
    const { usuario_id, partido_id, equipo_apostado } = req.body;
    
    // Validar datos
    if (!usuario_id || !partido_id || !equipo_apostado) {
        res.status(400).json({ error: 'Faltan datos requeridos' });
        return;
    }
    
    // Verificar si el partido ya comenzó
    const checkSql = `SELECT fecha, estado, ganador_real FROM partidos WHERE id = ?`;
    
    db.query(checkSql, [partido_id], (err, results) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        
        if (results.length === 0) {
            res.status(404).json({ error: 'Partido no encontrado' });
            return;
        }
        
        const partido = results[0];
        
        // Si el partido ya tiene ganador, no se puede apostar
        if (partido.ganador_real) {
            res.status(400).json({ error: 'El partido ya finalizó, no se puede apostar' });
            return;
        }
        
        const fechaPartido = new Date(partido.fecha);
        const ahora = new Date();
        
        if (ahora > fechaPartido) {
            res.status(400).json({ 
                error: 'El partido ya comenzó, no se puede apostar' 
            });
            return;
        }
        
        // Guardar o actualizar apuesta (INSERT o UPDATE)
        const upsertSql = `
            INSERT INTO apuestas (usuario_id, partido_id, equipo_apostado, fecha_apuesta)
            VALUES (?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
            equipo_apostado = VALUES(equipo_apostado),
            fecha_apuesta = NOW()
        `;
        
        db.query(upsertSql, [usuario_id, partido_id, equipo_apostado], (err) => {
            if (err) {
                console.error('Error guardando apuesta:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ success: true, message: 'Apuesta guardada exitosamente' });
        });
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

// ============ PANEL ADMIN - OBTENER PARTIDOS ============
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
        if (err) {
            console.error('Error en /api/admin/partidos:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(results);
    });
});

// ============ PANEL ADMIN - CARGAR RESULTADO ============
app.post('/api/admin/resultado', (req, res) => {
    const { partido_id, ganador_real, goles_local, goles_visitante } = req.body;
    
    if (!partido_id || !ganador_real) {
        res.status(400).json({ error: 'Faltan datos requeridos' });
        return;
    }
    
    // Actualizar el partido
    const updatePartido = `
        UPDATE partidos 
        SET ganador_real = ?, 
            resultado_local = ?, 
            resultado_visitante = ?,
            estado = 'jugado'
        WHERE id = ?
    `;
    
    db.query(updatePartido, [ganador_real, goles_local || 0, goles_visitante || 0, partido_id], (err) => {
        if (err) {
            console.error('Error actualizando partido:', err);
            res.status(500).json({ error: err.message });
            return;
        }
        
        // Actualizar puntos de las apuestas
        const updatePuntos = `
            UPDATE apuestas 
            SET puntos = CASE 
                WHEN equipo_apostado = ? THEN 1 
                ELSE 0 
            END
            WHERE partido_id = ?
        `;
        
        db.query(updatePuntos, [ganador_real, partido_id], (err) => {
            if (err) {
                console.error('Error actualizando puntos:', err);
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ success: true, message: 'Resultado cargado y puntos actualizados' });
        });
    });
});

// ============ RUTA DE PRUEBA PARA VERIFICAR CONEXIÓN ============
app.get('/api/health', (req, res) => {
    db.query('SELECT 1', (err) => {
        if (err) {
            res.status(500).json({ status: 'error', message: err.message });
        } else {
            res.json({ status: 'ok', message: 'Base de datos conectada' });
        }
    });
});

// ============ INICIAR SERVIDOR ============
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor en http://localhost:${PORT}`);
    console.log(`📱 App disponible en https://mundial2026.onrender.com`);
    console.log(`🔧 Panel Admin: /admin.html`);
    console.log(`✅ Servidor listo para aceptar conexiones`);
});