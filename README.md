# 🐾 Huellitas de Esperanza

Plataforma web para mascotas perdidas y encontradas. Proyecto de Desarrollo Web – CUN.
Autoras: Heidy Katherin Gonzalez Sierra y Sharith Juliana Rodriguez. Docente: John Fredy Cespedes.

## Ejecutar
`npm install` y `npm start` → puerto 3000.

## Temas aplicados
- **Backend / API REST:** Node.js + Express, rutas GET/POST/PUT/PATCH/DELETE en `/api/mascotas` y `/api/auth`.
- **Capas:** configuración → dominio → puertos → adaptadores → servicios → middlewares → rutas (`server.js`).
- **Puertos:** puerto de red 3000 (`index.js`) y puerto de repositorio (interfaz para JSON o Firebase).
- **SOLID:** responsabilidad única por capa; repositorios intercambiables; inversión de dependencias.
- **Base de datos:** archivos en `/data`; Firebase Firestore si hay credenciales en `.env`.
- **JWT:** token obligatorio para publicar, actualizar o eliminar.
- **Bcrypt:** contraseñas cifradas con bcryptjs.
- **Seguridad:** Helmet, validaciones, límite de fotos de 5 MB, textContent contra XSS, `.env` fuera de GitHub.
- **DOM:** `public/app.js` crea tarjetas, mapa (Leaflet + OpenStreetMap), buscador y formularios.