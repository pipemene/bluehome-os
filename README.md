# BlueHome OT Frontend (Completo)
App React para radicar y gestionar órdenes de trabajo conectada al backend (Railway) y a S3.

## Variables
- Crear `.env` con: `REACT_APP_API_URL=https://<tu-backend>.railway.app`

## Desarrollo
```bash
npm install
npm start
```

## Producción (GitHub Pages o tu hosting)
```bash
npm run build
# sube la carpeta build/ a tu hosting, o configura gh-pages si prefieres
```

## Flujo
- Inquilino: radica orden (sube fotos/video a S3 o en base64 si no hay S3).
- Admin: lista y cambia estados.
- Técnico: inicia sesión (usuario: tecnico), toma orden, sube evidencias, firma, genera PDF y lo sube a S3 + envía por email.
