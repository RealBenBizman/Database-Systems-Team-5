// Loads a plain browser module (src/**/*.js with `export` and no imports) inside Jest, which only
// understands CommonJS. Only for small pure helper files such as src/shared/reportFormat.js.
const fs = require('fs');
const path = require('path');

function loadEsm(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  const source = fs.readFileSync(file, 'utf8');
  if (/^\s*import\s/m.test(source)) throw new Error(`${relativePath} has imports; loadEsm only handles pure files.`);
  const names = [...source.matchAll(/^export\s+(?:function|const|let)\s+(\w+)/gm)].map((m) => m[1]);
  const code = `${source.replace(/^export\s+/gm, '')}\nreturn { ${names.join(', ')} };`;
  return new Function(code)();
}

module.exports = { loadEsm };
