# Zen YouTube Coach Pro

Applicazione Node.js minimale che espone un endpoint pubblico su Render per il progetto “Zen Salute e Benessere”.

Obiettivo: avere un endpoint ONLINE 24/7 che risponde:
✅ Zen YouTube Coach Pro è attivo e funzionante!  
🌍 Attivo 24/7 con relay esterno europeo gratuito.

---

## 1. Struttura del progetto

- `index.js` → server Express che risponde alla root `/`
- `package.json` → definisce gli script `npm start`
- (opzionale) `README_MONITOR.md` → note sul monitoraggio

---

## 2. Deploy su Render

1. Vai su https://render.com  
2. Crea un **Web Service**
3. Collega il repository GitHub: `slayd73/zen-youtube-coach-pro`
4. Imposta:
   - **Environment / Runtime**: Node  
   - **Build Command**: `npm install`  
   - **Start Command**: `npm start`
5. Salva e fai **Manual Deploy → Deploy latest commit**
6. Alla fine Render ti darà un URL tipo:
