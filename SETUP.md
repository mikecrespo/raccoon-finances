# Puesta en marcha de Raccoon Finances

Vas a hacer 3 cosas, en este orden:

1. **Firebase** — la nube donde viven y se sincronizan tus datos (gratis).
2. **Netlify** — donde vive la app, con su dirección web (gratis).
3. **Instalar la app** en tu teléfono y tu computadora.

Tiempo total: ~15 minutos. No necesitas saber programar; solo copiar y pegar.

> Mientras no termines el paso 1, la app igual funciona: guarda todo en el
> dispositivo donde la abras, pero **no** se sincroniza entre equipos.

---

## Parte 1 · Firebase (la nube)

### 1.1 Crear el proyecto
1. Entra a **https://console.firebase.google.com** con tu cuenta de Google.
2. Clic en **"Crear un proyecto"** (o *Add project*).
3. Nombre: `raccoon-finances` (o el que quieras). **Siguiente**.
4. Google Analytics: **desactívalo** (no hace falta). **Crear proyecto**.
5. Espera a que termine y clic en **Continuar**.

### 1.2 Registrar la app web
1. En la pantalla principal del proyecto, clic en el ícono **`</>`** ("Web").
2. Apodo de la app: `raccoon`. **NO** marques "Firebase Hosting". Clic en **Registrar app**.
3. Te va a mostrar un bloque de código parecido a esto:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy........",
     authDomain: "raccoon-finances.firebaseapp.com",
     projectId: "raccoon-finances",
     storageBucket: "raccoon-finances.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef123456"
   };
   ```
4. **Copia esos 6 valores.** Los vas a pegar en el archivo `firebase-config.js`
   (paso 1.5). Puedes cerrar el asistente de Firebase con "Continuar a la consola".

### 1.3 Activar el inicio de sesión por correo
1. Menú izquierdo → **Compilación (Build) → Authentication**.
2. Clic en **"Comenzar"**.
3. En la lista de proveedores, elige **"Correo electrónico/contraseña"**.
4. Activa el primer interruptor (**Habilitar**). Deja el de "vínculo por correo" apagado. **Guardar**.

### 1.4 Crear la base de datos y poner las reglas
1. Menú izquierdo → **Compilación (Build) → Firestore Database**.
2. Clic en **"Crear base de datos"**.
3. Ubicación: la que te sugiera (por ej. `nam5` / EE. UU.). **Siguiente**.
4. Elige **"Empezar en modo de producción"**. **Crear**.
5. Cuando cargue, ve a la pestaña **"Reglas"** (arriba).
6. Borra todo lo que haya y pega **exactamente** esto:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
7. Clic en **"Publicar"**. (Este mismo texto está en el archivo `firestore.rules`.)

### 1.5 Pegar tus claves en la app
1. Abre el archivo **`firebase-config.js`** de esta carpeta con cualquier editor de texto.
2. Reemplaza cada `"PON_AQUI..."` con el valor correspondiente que copiaste en el paso 1.2.
   Deben quedar los 6: `apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId`, `appId`.
3. Guarda el archivo.

Listo Firebase. **No creamos tu usuario todavía**: lo harás desde la propia app,
con el botón "Crear una cuenta", después de publicarla.

---

## Parte 2 · Netlify (publicar la app)

### 2.1 Cuenta
1. Entra a **https://app.netlify.com** y crea una cuenta (puedes usar tu correo o tu cuenta de Google/GitHub).

### 2.2 Subir la carpeta
1. Ya con la sesión abierta, ve a **https://app.netlify.com/drop**.
2. Arrastra **toda la carpeta `raccoon-finances`** (la que contiene `index.html`)
   y suéltala en esa página.
3. En unos segundos te da una dirección tipo
   **`https://algo-al-azar-123.netlify.app`**. Esa es tu app.

### 2.3 (Opcional) Ponerle un nombre bonito
1. En el panel del sitio: **Site configuration → Change site name**.
2. Ponle, por ejemplo, `raccoon-finances-tunombre` →
   queda `https://raccoon-finances-tunombre.netlify.app`.

### 2.4 Autorizar el dominio en Firebase
1. Vuelve a Firebase → **Authentication → Settings (Configuración) → Dominios autorizados**.
2. Clic en **"Agregar dominio"** y escribe tu dominio de Netlify **sin `https://`**,
   por ejemplo `raccoon-finances-tunombre.netlify.app`. **Agregar**.
   (Sin esto, el inicio de sesión falla en el sitio publicado.)

### 2.5 Cuando cambies algo más adelante
Vuelve a `https://app.netlify.com/drop` y arrastra la carpeta otra vez, **o**
conéctala a GitHub para que se publique sola. Cada vez que vuelvas a publicar,
sube el número en `sw.js` (`CACHE = 'raccoon-v2'`, `v3`, …) para que la nueva
versión llegue sin demora.

---

## Parte 3 · Entrar, migrar tus datos e instalar

### 3.1 Crear tu cuenta y traer tus datos
1. Abre tu dirección de Netlify en el navegador.
2. En la pantalla de acceso, toca **"Crear una cuenta"**, escribe tu correo y una
   contraseña (mínimo 6 caracteres) y entra.
3. Al entrar por primera vez, la app ya trae tus finanzas al 28-ago-2026.
   Si en el artifact viejo tenías cambios más nuevos:
   - abre el artifact viejo, toca **"Exportar respaldo"** y guarda el `.json`;
   - en la app nueva toca **"Importar respaldo"** y elige ese archivo.
   Eso sube tus datos a la nube y quedan en los dos lados.

### 3.2 Instalar en el teléfono
- **Android (Chrome):** menú de 3 puntos → **"Instalar aplicación"** / "Agregar a
  pantalla principal". Queda con su ícono y sin barra de direcciones.
- **iPhone (Safari):** botón Compartir → **"Agregar a inicio"**.

### 3.3 Instalar en la computadora
- **Windows (Chrome o Edge):** en la barra de direcciones aparece un ícono de
  instalar (una pantallita con una flecha) → **Instalar**. Queda como app con su
  ventana y aparece en el menú Inicio.
- **Mac (Chrome):** menú **⋮ → Transmitir, guardar y compartir → Instalar página
  como aplicación…** Queda en el Launchpad y en el Dock.
- **Mac (Safari):** menú **Archivo → Añadir al Dock**.

### 3.4 Cómo se comporta a partir de ahora
- Abres la app desde su ícono. Sin barra del navegador.
- Escribes un gasto **sin internet** → se guarda al instante en ese dispositivo;
  el indicador arriba dice **"Sin conexión"**.
- Cuando ese dispositivo recupera internet (basta con abrir la app) → sube tus
  cambios y baja lo del otro equipo. El indicador pasa a **"Sincronizado"**.
- En el otro dispositivo ves los mismos datos.

---

## Preguntas rápidas

**¿Es seguro subir `firebase-config.js` con mis claves?**
Sí. Esos valores no son secretos (viajan al navegador de todas formas). Lo que
protege tus datos son las reglas de Firestore del paso 1.4: nadie sin tu correo y
contraseña puede leer nada.

**¿Y si un día Netlify o Firebase fallan?**
Tus datos siguen en cada dispositivo donde uses la app, y siempre puedes
**Exportar respaldo** a un archivo.

**¿Puedo usarla en más de 2 dispositivos?**
Sí, los que quieras. Solo inicia sesión con el mismo correo.
