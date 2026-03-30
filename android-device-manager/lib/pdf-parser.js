const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

async function parsePrd(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.md' || ext === '.txt') {
    const text = fs.readFileSync(filePath, 'utf-8');
    return { type: 'text', name: path.basename(filePath), content: text };
  }

  if (ext === '.pdf') {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    await parser.load();
    const result = await parser.getText();
    const text = result.pages.map((p) => p.text).join('\n');
    await parser.destroy();
    return { type: 'text', name: path.basename(filePath), content: text };
  }

  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
    return { type: 'image', name: path.basename(filePath), mimeType: mimeMap[ext], data: base64 };
  }

  throw new Error(`지원하지 않는 파일 형식: ${ext}`);
}

async function parseFiles(filePaths) {
  const results = { texts: [], images: [], errors: [] };

  for (const fp of filePaths) {
    try {
      const parsed = await parsePrd(fp);
      if (parsed.type === 'text') {
        results.texts.push(parsed);
      } else {
        results.images.push(parsed);
      }
    } catch (e) {
      results.errors.push({ name: path.basename(fp), error: e.message });
    }
  }

  return results;
}

module.exports = { parsePrd, parseFiles };
