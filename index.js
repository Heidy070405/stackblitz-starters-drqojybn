import 'dotenv/config';
import { crearServidor } from './server.js';

const PUERTO = Number(process.env.PORT) || 3000;

crearServidor()
  .then((app) => {
    app.listen(PUERTO, () => {
      console.log(`Huellitas de Esperanza corriendo en el puerto ${PUERTO}`);
    });
  })
  .catch((error) => {
    console.error('No se pudo iniciar el servidor:', error);
  });