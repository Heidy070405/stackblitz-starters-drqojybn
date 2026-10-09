// =============================================================
// HUELLITAS DE ESPERANZA - FRONTEND (manipulación del DOM)
// Seguridad: los datos se insertan con textContent (nunca innerHTML) para evitar XSS.
// =============================================================
const API = '/api';
const $ = (selector) => document.querySelector(selector);

let mascotas = [];
let modoRegistro = false;
const marcadores = {};

// -------------------- Sesión (JWT) --------------------
const sesion = {
  get token() { return localStorage.getItem('huellitas_token'); },
  get usuario() { try { return JSON.parse(localStorage.getItem('huellitas_usuario')); } catch { return null; } },
  guardar({ token, usuario }) {
    localStorage.setItem('huellitas_token', token);
    localStorage.setItem('huellitas_usuario', JSON.stringify(usuario));
  },
  cerrar() {
    localStorage.removeItem('huellitas_token');
    localStorage.removeItem('huellitas_usuario');
  },
};

// -------------------- Cliente de la API REST --------------------
async function pedir(ruta, opciones = {}) {
  const headers = opciones.headers || {};
  if (sesion.token) headers.Authorization = `Bearer ${sesion.token}`;
  const res = await fetch(API + ruta, { ...opciones, headers });
  if (res.status === 204) return null;
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) { sesion.cerrar(); pintarSesion(); }
    const detalle = Array.isArray(datos.detalles) ? ': ' + datos.detalles.join('. ') : '';
    throw new Error((datos.error || 'Ocurrió un error') + detalle);
  }
  return datos;
}
const enviarJSON = (ruta, metodo, cuerpo) =>
  pedir(ruta, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

// -------------------- Utilidades DOM --------------------
function crear(etiqueta, { texto, clase, attrs } = {}, hijos = []) {
  const el = document.createElement(etiqueta);
  if (texto !== undefined) el.textContent = texto;
  if (clase) el.className = clase;
  Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
  hijos.filter(Boolean).forEach((h) => el.append(h));
  return el;
}

let temporizador;
function avisar(mensaje, esError = false) {
  const aviso = $('#aviso');
  aviso.textContent = mensaje;
  aviso.className = 'aviso visible' + (esError ? ' error' : '');
  clearTimeout(temporizador);
  temporizador = setTimeout(() => (aviso.className = 'aviso'), 4000);
}

// -------------------- Mapas (Leaflet + OpenStreetMap) --------------------
const capaOSM = () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; OpenStreetMap',
});
const icono = (clase) => L.divIcon({ className: '', html: `<div class="marcador ${clase}"></div>`, iconSize: [22, 22], iconAnchor: [11, 22], popupAnchor: [0, -22] });

const mapaReportes = L.map('mapa-reportes').setView([6.2, -74.5], 5);
capaOSM().addTo(mapaReportes);
const capaMarcadores = L.layerGroup().addTo(mapaReportes);

const mapaForm = L.map('mapa-form').setView([4.65, -74.1], 6);
capaOSM().addTo(mapaForm);
let marcadorNuevo = null;

mapaForm.on('click', (e) => {
  const lat = e.latlng.lat.toFixed(5);
  const lng = e.latlng.lng.toFixed(5);
  const form = $('#form-mascota');
  form.latitud.value = lat;
  form.longitud.value = lng;
  $('#coordenadas').textContent = `Ubicación seleccionada: ${lat}, ${lng}`;
  if (marcadorNuevo) marcadorNuevo.setLatLng(e.latlng);
  else marcadorNuevo = L.marker(e.latlng, { icon: icono('nuevo') }).addTo(mapaForm);
});

function pintarMarcadores(lista) {
  capaMarcadores.clearLayers();
  lista.forEach((m) => {
    if (typeof m.latitud !== 'number' || typeof m.longitud !== 'number') return;
    const popup = crear('div', {}, [
      crear('strong', { texto: m.nombre }),
      crear('br'),
      document.createTextNode(`${m.tipoReporte} · ${m.especie}`),
      crear('br'),
      document.createTextNode(m.ubicacion),
    ]);
    marcadores[m.id] = L.marker([m.latitud, m.longitud], { icon: icono(m.tipoReporte === 'Perdida' ? 'perdida' : 'encontrada') })
      .bindPopup(popup)
      .addTo(capaMarcadores);
  });
}

function verEnMapa(m) {
  if (!marcadores[m.id]) return avisar('Este reporte no tiene ubicación en el mapa', true);
  $('#mapa-seccion').scrollIntoView({ behavior: 'smooth' });
  setTimeout(() => {
    mapaReportes.setView([m.latitud, m.longitud], 13);
    marcadores[m.id].openPopup();
  }, 500);
}

// -------------------- Tarjetas de mascotas --------------------
function tarjeta(m) {
  const imagen = crear('img', { attrs: { src: m.foto || '', alt: `Foto de ${m.nombre}`, loading: 'lazy' } });
  imagen.onerror = () => { imagen.removeAttribute('src'); };

  const btnMapa = crear('button', { texto: 'Ver en el mapa', clase: 'btn-morado', attrs: { type: 'button' } });
  btnMapa.addEventListener('click', () => verEnMapa(m));

  const btnEliminar = crear('button', { texto: 'Eliminar', clase: 'btn-rojo', attrs: { type: 'button' } });
  btnEliminar.addEventListener('click', () => eliminar(m));

  let btnReencontrado = null;
  if (m.estado !== 'Reencontrado') {
    btnReencontrado = crear('button', { texto: '¡Reencontrado!', clase: 'btn-exito', attrs: { type: 'button' } });
    btnReencontrado.addEventListener('click', () => marcarReencontrado(m));
  }

  return crear('article', { clase: 'mascota' }, [
    imagen,
    crear('h3', { texto: m.nombre }),
    crear('p', { texto: `Reporte: ${m.tipoReporte}`, clase: 'reporte-tipo' }),
    m.estado === 'Reencontrado' ? crear('p', { texto: '💚 ¡Ya volvió a casa!', clase: 'reencontrado' }) : null,
    crear('p', { texto: `Animal: ${m.especie}` }),
    m.color ? crear('p', { texto: `Color: ${m.color}` }) : null,
    m.raza ? crear('p', { texto: `Raza: ${m.raza}` }) : null,
    crear('p', { texto: `Ubicación: ${m.ubicacion}` }),
    m.fecha ? crear('p', { texto: `Fecha: ${m.fecha}` }) : null,
    crear('p', { texto: m.descripcion }),
    crear('p', { texto: `📞 ${m.telefono}` }),
    crear('div', { clase: 'acciones' }, [btnMapa, btnEliminar, btnReencontrado]),
  ]);
}

function filtrar() {
  const texto = $('#buscar').value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const tipo = $('#filtro-tipo').value;
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return mascotas.filter((m) =>
    (!tipo || m.tipoReporte === tipo) &&
    (!texto || [m.nombre, m.especie, m.raza, m.color, m.ubicacion].some((v) => norm(v).includes(texto))));
}

function pintarLista() {
  const lista = filtrar();
  const perdidas = mascotas.filter((m) => m.tipoReporte === 'Perdida').length;
  $('#resumen').textContent = `Total: ${mascotas.length} | Perdidas: ${perdidas} | Encontradas: ${mascotas.length - perdidas}`;
  $('#lista').replaceChildren(...(lista.length
    ? lista.map(tarjeta)
    : [crear('p', { texto: 'No se encontraron mascotas con esa búsqueda.', clase: 'vacio' })]));
  pintarMarcadores(lista);
}

async function cargarMascotas() {
  try {
    mascotas = await pedir('/mascotas');
    pintarLista();
  } catch (err) {
    $('#resumen').textContent = 'No se pudieron cargar los reportes.';
    avisar(err.message, true);
  }
}

$('#buscar').addEventListener('input', pintarLista);
$('#filtro-tipo').addEventListener('change', pintarLista);

// -------------------- Acciones protegidas (requieren JWT) --------------------
function exigirSesion() {
  if (sesion.token) return true;
  avisar('Primero ingresa con tu cuenta', true);
  $('#panel-auth').hidden = false;
  $('#panel-auth').scrollIntoView({ behavior: 'smooth' });
  return false;
}

async function eliminar(m) {
  if (!exigirSesion()) return;
  if (!confirm(`¿Seguro que deseas eliminar el reporte de ${m.nombre}?`)) return;
  try {
    await pedir(`/mascotas/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
    avisar('Reporte eliminado');
    cargarMascotas();
  } catch (err) { avisar(err.message, true); }
}

async function marcarReencontrado(m) {
  if (!exigirSesion()) return;
  try {
    await enviarJSON(`/mascotas/${encodeURIComponent(m.id)}`, 'PATCH', { estado: 'Reencontrado' });
    avisar(`¡Qué alegría! ${m.nombre} volvió a casa 💚`);
    cargarMascotas();
  } catch (err) { avisar(err.message, true); }
}

// -------------------- Formulario de mascota --------------------
const formMascota = $('#form-mascota');
const inputFoto = formMascota.foto;

inputFoto.addEventListener('change', () => {
  const archivo = inputFoto.files[0];
  $('#nombre-archivo').textContent = archivo ? archivo.name : 'Sin archivos seleccionados';
  const vista = $('#vista-previa');
  if (archivo) { vista.src = URL.createObjectURL(archivo); vista.hidden = false; } else { vista.hidden = true; }
});

formMascota.fecha.max = new Date().toISOString().slice(0, 10);

formMascota.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!exigirSesion()) return;
  if (!inputFoto.files[0]) return avisar('Selecciona una fotografía de la mascota', true);
  if (!formMascota.latitud.value) return avisar('Marca en el mapa dónde fue vista la mascota', true);

  try {
    // FormData envía los datos y la foto juntos (multipart/form-data)
    await pedir('/mascotas', { method: 'POST', body: new FormData(formMascota) });
    avisar('¡Reporte publicado! Gracias por ayudar 🐾');
    formMascota.reset();
    $('#vista-previa').hidden = true;
    $('#nombre-archivo').textContent = 'Sin archivos seleccionados';
    $('#coordenadas').textContent = 'Aún no has seleccionado una ubicación.';
    if (marcadorNuevo) { mapaForm.removeLayer(marcadorNuevo); marcadorNuevo = null; }
    await cargarMascotas();
    $('#lista').scrollIntoView({ behavior: 'smooth' });
  } catch (err) { avisar(err.message, true); }
});

// -------------------- Ingreso y registro --------------------
function pintarSesion() {
  const usuario = sesion.usuario;
  $('#btn-sesion').textContent = sesion.token && usuario ? `Salir (${usuario.nombre})` : 'Ingresar';
  if (sesion.token) $('#panel-auth').hidden = true;
}

$('#btn-sesion').addEventListener('click', () => {
  if (sesion.token) {
    sesion.cerrar();
    pintarSesion();
    avisar('Sesión cerrada');
  } else {
    $('#panel-auth').hidden = false;
    $('#panel-auth').scrollIntoView({ behavior: 'smooth' });
  }
});

$('#cambiar-auth').addEventListener('click', () => {
  modoRegistro = !modoRegistro;
  $('#campo-nombre').hidden = !modoRegistro;
  $('#titulo-auth').textContent = modoRegistro ? 'Crear cuenta' : 'Ingresar';
  $('#btn-auth').textContent = modoRegistro ? 'Registrarme →' : 'Ingresar →';
  $('#cambiar-auth').textContent = modoRegistro ? '¿Ya tienes cuenta? Ingresa' : '¿No tienes cuenta? Regístrate';
});

$('#form-auth').addEventListener('submit', async (e) => {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData(e.target));
  try {
    const res = await enviarJSON(modoRegistro ? '/auth/registro' : '/auth/login', 'POST', datos);
    sesion.guardar(res);
    e.target.reset();
    pintarSesion();
    avisar(`¡Hola, ${res.usuario.nombre}!`);
  } catch (err) { avisar(err.message, true); }
});

// -------------------- Inicio --------------------
pintarSesion();
cargarMascotas();