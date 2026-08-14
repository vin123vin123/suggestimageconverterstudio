// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. FIXED: Added 'family: 4' to force IPv4 connection routing on Cloud hosts
mongoose.connect(process.env.MONGODB_URI, {
  family: 4,
  serverSelectionTimeoutMS: 10000
})
  .then(() => console.log('🟢 Fully connected to MongoDB Atlas!'))
  .catch(err => console.error('🔴 Database connection error:', err));

// Database structural schema validation configuration rules
const ImageSchema = new mongoose.Schema({
  originalName: String,
  grayscaleBuffer: { type: Buffer, default: null },
  asciiText: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, expires: 3600 } // Auto-destruct after 1 hour
});
const ImageModel = mongoose.model('ProcessedImage', ImageSchema);

// Configure multer limits carefully for small cloud nodes
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 5 * 1024 * 1024 } 
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Processing Engine: Convert picture to Grayscale binary chunk
async function makeGrayscale(buffer) {
  const image = await Jimp.read(buffer);
  const grayBuffer = await image.grayscale().getBufferAsync(Jimp.MIME_PNG);
  return Buffer.from(grayBuffer); // 2. FIXED: Explicit transformation to clean Node Buffer element
}

// Processing Engine: Convert picture to layout string array mappings
async function makeAscii(buffer) {
  const image = await Jimp.read(buffer);
  image.resize(60, Jimp.AUTO).grayscale(); 
  
  const chars = '@%#*+=-:. ';
  let asciiStr = '';

  for (let y = 0; y < image.bitmap.height; y++) {
    for (let x = 0; x < image.bitmap.width; x++) {
      const pixelColor = image.getPixelColor(x, y);
      const rgba = Jimp.intToRGBA(pixelColor);
      const brightness = (rgba.r + rgba.g + rgba.b) / 3; 
      const charIndex = Math.floor((brightness / 255) * (chars.length - 1));
      asciiStr += chars[charIndex];
    }
    asciiStr += '\n';
  }
  return asciiStr;
}

// Route: Creates dynamic ASCII preview array layouts
app.post('/preview-ascii', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const text = await makeAscii(req.file.buffer);
    res.json({ ascii: text });
  } catch (err) { 
    console.error("Preview Error:", err.message);
    res.status(500).json({ error: err.message }); 
  }
});

// Route: Confirms structure values and commits items to MongoDB Atlas
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const { mode } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    let gray = null, txt = null;
    if (mode === 'grayscale') gray = await makeGrayscale(req.file.buffer);
    if (mode === 'ascii') txt = await makeAscii(req.file.buffer);

    const doc = await new ImageModel({ 
      originalName: req.file.originalname, 
      grayscaleBuffer: gray, 
      asciiText: txt 
    }).save();

    // 3. FIXED: Using dynamic path mapping standard instead of protocol bindings to guarantee secure SSL downloads on Render
    res.json({ downloadUrl: `/download/${doc._id}/${mode}` });
  } catch (err) { 
    console.error("Upload Error:", err.message);
    res.status(500).json({ error: err.message }); 
  }
});

// Route: Downloads document payloads and completely wipes target records inside database collection
app.get('/download/:id/:type', async (req, res) => {
  try {
    const doc = await ImageModel.findById(req.params.id);
    if (!doc) return res.status(404).send('Expired or already downloaded.');

    if (req.params.type === 'grayscale') {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="grayscale-${doc.originalName}.png"`);
      res.send(doc.grayscaleBuffer);
    } else {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="ascii-${doc.originalName}.txt"`);
      res.send(doc.asciiText);
    }
    
    // Purge record asynchronously right after request routing clears out
    process.nextTick(async () => {
       await ImageModel.findByIdAndDelete(req.params.id);
       console.log(`Successfully purged data tracking entry ${req.params.id}`);
    });

  } catch (err) { 
    res.status(500).send('Download connection loop failure.'); 
  }
});

// 4. FIXED: Explicit hosting IP definition '0.0.0.0' allowing Render's edge proxies to attach traffic smoothly
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server fully operational on port ${PORT}`));
