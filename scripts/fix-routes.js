const fs = require('fs');
let content = fs.readFileSync('index.js', 'utf8');
content = content.replace("app.use('/admin-ui', express.static(path.join(__dirname, 'admin-ui/dist')));", "app.use('/admin', express.static(path.join(__dirname, 'admin-ui/dist')));");
content = content.replace("app.get('/admin', (req, res) => {\n  res.sendFile(path.join(__dirname, 'admin.html'));\n});", "app.get('/admin*', (req, res) => {\n  res.sendFile(path.join(__dirname, 'admin-ui/dist', 'index.html'));\n});");
fs.writeFileSync('index.js', content);
