import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { fileTypeFromFile } from 'file-type';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const uploadRoot =
  process.env.UPLOAD_DIR ||
  path.join(__dirname, '..', 'public', 'uploads', 'avatars');

if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const allowedExtensionsByMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadRoot),
  filename: (req, file, callback) => {
    const employeeCode = String(req.user?.employeeCode || 'employee').replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase();
    const originalExt = path.extname(file.originalname).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(originalExt) ? originalExt : '.upload';
    callback(null, `${employeeCode}-${randomUUID()}${safeExt}`);
  },
});

export const uploadAvatar = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) return callback(new Error('Only JPG, PNG, and WEBP images are allowed.'));
    callback(null, true);
  },
});

export async function validateAvatarMagicBytes(req, res, next) {
  try {
    if (!req.file?.path) return res.status(400).json({ message: 'لم يتم رفع صورة' });

    const detected = await fileTypeFromFile(req.file.path);
    if (!detected || !allowedMimeTypes.has(detected.mime)) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(400).json({ message: 'الملف المرفوع ليس صورة حقيقية. المسموح JPG أو PNG أو WEBP فقط.' });
    }

    const expectedExt = allowedExtensionsByMime[detected.mime];
    if (expectedExt) {
      const currentExt = path.extname(req.file.path).toLowerCase();
      if (currentExt !== expectedExt) {
        const safePath = req.file.path.replace(/\.[^.]+$/, expectedExt);
        try {
          fs.renameSync(req.file.path, safePath);
          req.file.path = safePath;
          req.file.filename = path.basename(safePath);
        } catch {
          try { fs.unlinkSync(req.file.path); } catch {}
          return res.status(500).json({ message: 'تعذر تأمين ملف الصورة بعد الرفع' });
        }
      }
    }

    req.file.detectedMime = detected.mime;
    req.file.detectedExt = detected.ext;
    return next();
  } catch (error) {
    if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch {} }
    console.error('Avatar magic-byte validation failed:', error);
    return res.status(400).json({ message: 'تعذر التحقق من أمان الصورة' });
  }
}
