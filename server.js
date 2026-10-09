// =============================================================
// HUELLITAS DE ESPERANZA - BACKEND (Node.js + Express)
// Organizado en CAPAS:
//   1. Configuración   2. Dominio (reglas)   3. Puertos (interfaces)
//   4. Adaptadores (base de datos: archivo JSON o Firebase)
//   5. Servicios (lógica)   6. Middlewares (JWT, errores)
//   7. Controladores + Rutas (API REST)
// =============================================================
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// -------------------------------------------------------------
// 1. CONFIGURACIÓN
// -------------------------------------------------------------
const CONFIG = {
  jwtSecret: process.env.JWT_SECRET || 'clave-solo-para-desarrollo-cambiar',
  jwtExpira: '2h',
  carpetaDatos: path.join(__dirname, 'data'),
  carpetaUploads: path.join(__dirname, 'public', 'uploads'),
  usarFirebase: Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY),
};

// -------------------------------------------------------------
// 2. DOMINIO: reglas y validaciones (no depende de Express)
// -------------------------------------------------------------
class ErrorApp extends Error {
  constructor(mensaje, status = 500, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

const TIPOS_REPORTE = ['Perdida', 'Encontrada'];
const ESPECIES = ['Perro', 'Gato', 'Conejo', 'Otro'];
const ESTADOS = ['Activa', 'En proceso', 'Reencontrado'];
const CAMPOS = ['tipoReporte', 'nombre', 'especie', 'raza', 'color', 'descripcion',
  'fecha', 'ubicacion', 'latitud', 'longitud', 'telefono', 'estado'];

function limpiarMascota(body = {}) {
  const datos = {};
  for (const campo of CAMPOS) {
    const valor = body[campo];
    if (valor === undefined || valor === null || String(valor).trim() === '') continue;
    datos[campo] = String(valor).trim().slice(0, campo === 'descripcion' ? 500 : 100);
  }
  if (datos.latitud) datos.latitud = Number(datos.latitud);
  if (datos.longitud) datos.longitud = Number(datos.longitud);
  return datos;
}

function validarMascota(d, parcial = false) {
  const errores = [];
  const obligatorios = ['tipoReporte', 'nombre', 'especie', 'descripcion', 'ubicacion', 'telefono'];
  if (!parcial) {
    for (const c of obligatorios) if (!d[c]) errores.push(`El campo "${c}" es obligatorio`);
  }
  if (d.tipoReporte && !TIPOS_REPORTE.includes(d.tipoReporte)) errores.push('Tipo de reporte inválido');
  if (d.especie && !ESPECIES.includes(d.especie)) errores.push('Especie inválida');
  if (d.estado && !ESTADOS.includes(d.estado)) errores.push('Estado inválido');
  if (d.telefono && !/^[0-9+\s-]{7,15}$/.test(d.telefono)) errores.push('Teléfono inválido');
  if (d.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha)) errores.push('La fecha debe ser AAAA-MM-DD');
  if (d.latitud !== undefined && (Number.isNaN(d.latitud) || d.latitud < -90 || d.latitud > 90)) errores.push('Latitud inválida');
  if (d.longitud !== undefined && (Number.isNaN(d.longitud) || d.longitud < -180 || d.longitud > 180)) errores.push('Longitud inválida');
  if (errores.length) throw new ErrorApp('Datos inválidos', 400, errores);
}

const normalizar = (t = '') => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// -------------------------------------------------------------
// 3. PUERTOS: contrato que debe cumplir cualquier base de datos
//    (principio de Inversión de Dependencias - SOLID)
// -------------------------------------------------------------
const PUERTO_REPOSITORIO = ['listar', 'buscarPorId', 'crear', 'actualizar', 'eliminar'];
function verificarPuerto(repo, nombre) {
  for (const m of PUERTO_REPOSITORIO) {
    if (typeof repo[m] !== 'function') throw new Error(`${nombre} no implementa "${m}"`);
  }
  return repo;
}

// -------------------------------------------------------------
// 4. ADAPTADORES de base de datos
// -------------------------------------------------------------
// 4a. Archivo JSON en la carpeta /data (persiste al reiniciar)
function repositorioJSON(archivo) {
  const ruta = path.join(CONFIG.carpetaDatos, archivo);
  const leer = async () => {
    try { return JSON.parse(await fs.readFile(ruta, 'utf8')); } catch { return []; }
  };
  const guardar = (lista) => fs.writeFile(ruta, JSON.stringify(lista, null, 2));

  return {
    listar: leer,
    async buscarPorId(id) { return (await leer()).find((x) => x.id === id) ?? null; },
    async buscarPor(campo, valor) { return (await leer()).find((x) => x[campo] === valor) ?? null; },
    async crear(datos) {
      const lista = await leer();
      const nuevo = { id: randomUUID(), ...datos };
      lista.push(nuevo);
      await guardar(lista);
      return nuevo;
    },
    async actualizar(id, cambios) {
      const lista = await leer();
      const i = lista.findIndex((x) => x.id === id);
      if (i === -1) return null;
      lista[i] = { ...lista[i], ...cambios, id };
      await guardar(lista);
      return lista[i];
    },
    async eliminar(id) {
      const lista = await leer();
      const filtrada = lista.filter((x) => x.id !== id);
      await guardar(filtrada);
      return filtrada.length !== lista.length;
    },
  };
}

// 4b. Firebase Firestore (se activa si el .env tiene las credenciales)
async function repositorioFirebase(coleccion) {
  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    // preferRest: necesario en StackBlitz (no soporta gRPC)
    admin.firestore().settings({ preferRest: true, ignoreUndefinedProperties: true });
  }
  const col = admin.firestore().collection(coleccion);
  const aObj = (d) => (d.exists ? { id: d.id, ...d.data() } : null);

  return {
    async listar() { return (await col.get()).docs.map(aObj); },
    async buscarPorId(id) { return aObj(await col.doc(id).get()); },
    async buscarPor(campo, valor) {
      const s = await col.where(campo, '==', valor).limit(1).get();
      return s.empty ? null : aObj(s.docs[0]);
    },
    async crear(datos) { const ref = await col.add(datos); return { id: ref.id, ...datos }; },
    async actualizar(id, cambios) {
      const ref = col.doc(id);
      if (!(await ref.get()).exists) return null;
      await ref.update(cambios);
      return aObj(await ref.get());
    },
    async eliminar(id) {
      const ref = col.doc(id);
      if (!(await ref.get()).exists) return false;
      await ref.delete();
      return true;
    },
  };
}

// -------------------------------------------------------------
// 5. SERVICIOS: lógica de negocio
// -------------------------------------------------------------
function servicioAuth(repoUsuarios) {
  const firmar = (u) => jwt.sign({ id: u.id, nombre: u.nombre, email: u.email }, CONFIG.jwtSecret, { expiresIn: CONFIG.jwtExpira });
  const publico = ({ passwordHash, ...resto }) => resto;

  return {
    async registrar({ nombre, email, password } = {}) {
      const errores = [];
      if (!nombre || nombre.trim().length < 2) errores.push('El nombre es obligatorio');
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errores.push('Correo inválido');
      if (!password || password.length < 8) errores.push('La contraseña debe tener mínimo 8 caracteres');
      if (errores.length) throw new ErrorApp('Datos inválidos', 400, errores);

      const correo = email.trim().toLowerCase();
      if (await repoUsuarios.buscarPor('email', correo)) throw new ErrorApp('Ese correo ya está registrado', 409);

      // BCRYPT: la contraseña nunca se guarda en texto plano
      const passwordHash = await bcrypt.hash(password, 10);
      const usuario = await repoUsuarios.crear({ nombre: nombre.trim(), email: correo, passwordHash, creado: new Date().toISOString() });
      return { usuario: publico(usuario), token: firmar(usuario) };
    },
    async login({ email, password } = {}) {
      const usuario = email ? await repoUsuarios.buscarPor('email', email.trim().toLowerCase()) : null;
      const ok = usuario && password && (await bcrypt.compare(password, usuario.passwordHash));
      if (!ok) throw new ErrorApp('Correo o contraseña incorrectos', 401);
      return { usuario: publico(usuario), token: firmar(usuario) };
    },
    verificar(token) {
      try { return jwt.verify(token, CONFIG.jwtSecret); } catch { throw new ErrorApp('Sesión vencida, ingresa de nuevo', 401); }
    },
  };
}

function servicioMascotas(repo) {
  async function propia(id, usuario) {
    const m = await repo.buscarPorId(id);
    if (!m) throw new ErrorApp('El reporte no existe', 404);
    // Los reportes de ejemplo (sin dueño) los puede gestionar cualquier usuario registrado
    if (m.creadoPor && m.creadoPor !== usuario.id) throw new ErrorApp('Solo quien creó el reporte puede modificarlo', 403);
    return m;
  }

  return {
    async listar(f = {}) {
      let lista = await repo.listar();
      if (f.tipoReporte) lista = lista.filter((m) => m.tipoReporte === f.tipoReporte);
      if (f.especie) lista = lista.filter((m) => normalizar(m.especie) === normalizar(f.especie));
      if (f.estado) lista = lista.filter((m) => m.estado === f.estado);
      if (f.color) lista = lista.filter((m) => normalizar(m.color).includes(normalizar(f.color)));
      if (f.ubicacion) lista = lista.filter((m) => normalizar(m.ubicacion).includes(normalizar(f.ubicacion)));
      if (f.q) {
        const q = normalizar(f.q);
        lista = lista.filter((m) => [m.nombre, m.especie, m.raza, m.color, m.ubicacion].some((v) => normalizar(v).includes(q)));
      }
      return lista;
    },
    async obtener(id) {
      const m = await repo.buscarPorId(id);
      if (!m) throw new ErrorApp('El reporte no existe', 404);
      return m;
    },
    async crear(body, foto, usuario) {
      const datos = limpiarMascota(body);
      validarMascota(datos);
      const ahora = new Date().toISOString();
      return repo.crear({
        ...datos,
        fecha: datos.fecha || ahora.slice(0, 10),
        estado: 'Activa',
        foto: foto ? `/uploads/${foto.filename}` : null,
        creadoPor: usuario.id,
        fechaCreacion: ahora,
        fechaActualizacion: ahora,
      });
    },
    async actualizar(id, body, usuario, parcial) {
      await propia(id, usuario);
      const datos = limpiarMascota(body);
      validarMascota(datos, parcial);
      return repo.actualizar(id, { ...datos, fechaActualizacion: new Date().toISOString() });
    },
    async eliminar(id, usuario) {
      const m = await propia(id, usuario);
      await repo.eliminar(id);
      if (m.foto?.startsWith('/uploads/')) {
        await fs.unlink(path.join(__dirname, 'public', m.foto)).catch(() => {});
      }
    },
  };
}

// -------------------------------------------------------------
// 6. MIDDLEWARES
// -------------------------------------------------------------
const asincrono = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const requiereToken = (auth) => (req, _res, next) => {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return next(new ErrorApp('Debes iniciar sesión', 401));
  try { req.usuario = auth.verificar(token); next(); } catch (e) { next(e); }
};

const validarId = (req, _res, next) =>
  /^[A-Za-z0-9_-]{1,64}$/.test(req.params.id) ? next() : next(new ErrorApp('Identificador inválido', 400));

// Carga de fotos: solo imágenes JPG/PNG/WEBP de máximo 5 MB
const subirFoto = multer({
  storage: multer.diskStorage({
    destination: CONFIG.carpetaUploads,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)
      ? cb(null, true)
      : cb(new ErrorApp('La foto debe ser JPG, PNG o WEBP', 400)),
});

// -------------------------------------------------------------
// 7. CONTROLADORES + RUTAS (API REST)
// -------------------------------------------------------------
export async function crearServidor() {
  await fs.mkdir(CONFIG.carpetaDatos, { recursive: true });
  await fs.mkdir(CONFIG.carpetaUploads, { recursive: true });

  const repoMascotas = verificarPuerto(
    CONFIG.usarFirebase ? await repositorioFirebase('mascotas') : repositorioJSON('mascotas.json'), 'Repositorio mascotas');
  const repoUsuarios = CONFIG.usarFirebase ? await repositorioFirebase('usuarios') : repositorioJSON('usuarios.json');
  console.log(`Base de datos: ${CONFIG.usarFirebase ? 'Firebase Firestore' : 'archivo JSON (/data)'}`);

  const auth = servicioAuth(repoUsuarios);
  const mascotas = servicioMascotas(repoMascotas);
  const conToken = requiereToken(auth);

  const app = express();

  // Seguridad de cabeceras HTTP (Helmet)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'https://unpkg.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        // Permite que la vista previa de StackBlitz muestre la página
        'frame-ancestors': null,
        'upgrade-insecure-requests': null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    frameguard: false,
    // Permite que el servidor de mapas sepa desde qué página se piden los mapas
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // --- Autenticación (JWT + bcrypt) ---
  app.post('/api/auth/registro', asincrono(async (req, res) => res.status(201).json(await auth.registrar(req.body))));
  app.post('/api/auth/login', asincrono(async (req, res) => res.json(await auth.login(req.body))));

  // --- Mascotas (CRUD REST) ---
  app.get('/api/mascotas', asincrono(async (req, res) => res.json(await mascotas.listar(req.query))));
  app.get('/api/mascotas/:id', validarId, asincrono(async (req, res) => res.json(await mascotas.obtener(req.params.id))));
  app.post('/api/mascotas', conToken, subirFoto.single('foto'),
    asincrono(async (req, res) => res.status(201).json(await mascotas.crear(req.body, req.file, req.usuario))));
  app.put('/api/mascotas/:id', conToken, validarId,
    asincrono(async (req, res) => res.json(await mascotas.actualizar(req.params.id, req.body, req.usuario, false))));
  app.patch('/api/mascotas/:id', conToken, validarId,
    asincrono(async (req, res) => res.json(await mascotas.actualizar(req.params.id, req.body, req.usuario, true))));
  app.delete('/api/mascotas/:id', conToken, validarId,
    asincrono(async (req, res) => { await mascotas.eliminar(req.params.id, req.usuario); res.status(204).end(); }));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // --- Manejo central de errores (sin exponer detalles técnicos) ---
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ErrorApp) return res.status(err.status).json({ error: err.message, detalles: err.detalles });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'La foto no puede pesar más de 5 MB' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return app;
}