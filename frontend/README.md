# Proyecto Unergy ForestID - Frontend

Este es el frontend de la herramienta de Clasificación Forestal Inteligente creado para la hackathon.
La estructura está construida en **React**, empaquetado por **Vite**, y estilado con **Tailwind CSS**. 

## Pasos para ejecutar:

Acabo de detectar que Node.js no está instalado o no se encuentra en el PATH de tu máquina (por eso no ejecuté Vite automáticamente). Para iniciar el proyecto, sigue estos sencillos pasos:

1. **Instala Node.js**: 
   Descárgalo desde [nodejs.org](https://nodejs.org/) e instálalo (la versión LTS está bien).
   Asegúrate de cerrar y volver a abrir tu terminal (o VS Code) después de instalarlo.

2. **Abre la carpeta `frontend` en tu terminal**.

3. **Instala las dependencias**:
   Ejecuta el siguiente comando para descargar React, Tailwind y Lucide Icons:
   ```bash
   npm install
   ```

4. **Inicia el servidor de desarrollo**:
   ```bash
   npm run dev
   ```

5. Dirígete a la URL local (normalmente `http://localhost:5173`) para ver la interfaz en funcionamiento.

## Estructura generada
- `src/App.jsx`: Contiene la lógica visual principal (Drag&Drop, galería, botones y zona de resultados).
- `tailwind.config.js`: Contiene la configuración de colores del branding corporativo ("Unergy green").

¡Mucha suerte en la hackathon! Avisame cuando instalemos y levantemos esto para continuar con la comunicación con tu Backend de Python/YOLO.
