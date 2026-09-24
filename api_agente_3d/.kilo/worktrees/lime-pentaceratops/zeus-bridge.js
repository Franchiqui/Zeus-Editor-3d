const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();
const PORT = 4001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '200mb' }));

const upload = multer({ 
  dest: 'zeus-uploads/',
  limits: { fileSize: 5 * 1024 * 1024 * 1024 } 
});

app.get('/ping', (req, res) => res.send('pong'));

app.get('/api/local/list', (req, res) => {
  const { folder } = req.query;
  if (!folder || !fs.existsSync(folder)) return res.status(404).send('No existe');
  const files = fs.readdirSync(folder).map(f => {
    const p = path.join(folder, f);
    const s = fs.statSync(p);
    return { id: `bridge-${Buffer.from(p).toString('base64')}`, name: f, path: p, isDirectory: s.isDirectory(), uploadedAt: s.mtime };
  });
  res.json({ files });
});

app.get('/api/local/view', (req, res) => {
  const f = req.query.f || req.query.p;
  if (f && fs.existsSync(f)) res.sendFile(f);
  else res.status(404).send('No encontrado');
});

app.post('/api/local/delete', (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath) return res.status(400).json({ error: 'Ruta no proporcionada' });

  try {
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'El archivo o carpeta no existe' });
    
    const stats = fs.statSync(targetPath);
    if (stats.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(targetPath);
    }
    
    console.log(`🗑️ Eliminado: ${targetPath}`);
    res.json({ success: true });
  } catch (e) {
    console.error('Error eliminando:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/local/save', (req, res) => {
  const { folder, fileName, data } = req.body;
  if (!folder || !fileName || !data) return res.status(400).json({ error: 'Faltan datos' });

  try {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`✅ Archivo guardado: ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (e) {
    console.error('Error guardando archivo:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/local/create-project-full', upload.array('assets'), (req, res) => {
  const { projectName, rootPath, projectData } = req.body;
  const projectFolder = path.join(rootPath, projectName);
  const projectFilePath = path.join(projectFolder, `${projectName}.zeus`);
  
  if (!fs.existsSync(projectFolder)) fs.mkdirSync(projectFolder, { recursive: true });
  const assetsFolder = path.join(projectFolder, 'assets');
  if (!fs.existsSync(assetsFolder)) fs.mkdirSync(assetsFolder, { recursive: true });

  fs.writeFileSync(projectFilePath, projectData);
  
  if (req.files) {
    req.files.forEach(file => {
      const destPath = path.join(assetsFolder, file.originalname);
      fs.renameSync(file.path, destPath);
    });
  }
  
  console.log(`✅ Proyecto ${projectName} creado.`);
  res.json({ success: true, path: projectFolder });
});

app.get('/api/local/load-project', (req, res) => {
  let { path: projectPath, rootPath, name } = req.query;
  if (rootPath && name && !projectPath) projectPath = path.join(rootPath, name);
  if (!projectPath) return res.status(400).send('Ruta no proporcionada');

  const normalizedPath = path.normalize(projectPath);
  if (!fs.existsSync(normalizedPath)) return res.status(404).send('No existe la ruta');

  const stats = fs.statSync(normalizedPath);
  let zeusFile = '';
  let projectName = path.basename(normalizedPath);
  let finalProjectPath = normalizedPath;

  if (stats.isDirectory()) {
    const files = fs.readdirSync(normalizedPath);
    const found = files.find(f => f.toLowerCase().endsWith('.zeus'));
    if (found) zeusFile = path.join(normalizedPath, found);
  } else {
    zeusFile = normalizedPath;
    projectName = path.basename(normalizedPath).replace(/\.[^/.]+$/, "");
    finalProjectPath = path.dirname(normalizedPath);
  }

  if (!zeusFile || !fs.existsSync(zeusFile)) return res.status(404).send('No se encontró el archivo .zeus');

  try {
    const data = fs.readFileSync(zeusFile, 'utf8');
    res.json({ data: JSON.parse(data), projectName, projectPath: finalProjectPath });
  } catch (e) {
    res.status(500).send('Error leyendo el proyecto');
  }
});

app.listen(PORT, () => console.log(`🚀 Zeus Bridge Terminal en puerto ${PORT}`));
