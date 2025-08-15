import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticateToken } from '../middleware/auth';
import { asyncHandler } from '../utils/AppError';
import { prisma } from '../lib/prisma';

const router = express.Router();

// Configurar multer para upload de arquivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const { user } = req as any;
    const uploadPath = path.join(process.cwd(), 'uploads', user.tenantId);
    
    // Criar diretório se não existir
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    // Gerar nome único para o arquivo
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const filename = `${file.fieldname}-${uniqueSuffix}${extension}`;
    cb(null, filename);
  }
});

// Filtro para tipos de arquivo permitidos
const fileFilter = (req: any, file: any, cb: any) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Tipo de arquivo não permitido'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.UPLOAD_MAX_SIZE || '10485760') // 10MB default
  }
});

// Aplicar middleware de autenticação
router.use(authenticateToken);

/**
 * POST /api/upload/single
 * Upload de arquivo único
 */
router.post('/single', upload.single('file'), asyncHandler(async (req, res) => {
  const { user } = req;
  const file = req.file;
  
  if (!file) {
    return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
  }
  
  // Salvar informações do arquivo no banco de dados
  const fileRecord = await prisma.file.create({
    data: {
      filename: file.filename,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: file.path,
      tenantId: user!.tenantId,
      uploadedBy: user!.userId
    }
  });
  
  // Log de auditoria
  await prisma.auditLog.create({
    data: {
      action: 'FILE_UPLOAD',
      resourceType: 'FILE',
      resourceId: fileRecord.id,
      userId: user!.userId,
      tenantId: user!.tenantId,
      details: {
        filename: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      }
    }
  });
  
  res.json({
    message: 'Arquivo enviado com sucesso',
    file: {
      id: fileRecord.id,
      filename: fileRecord.filename,
      originalName: fileRecord.originalName,
      mimetype: fileRecord.mimetype,
      size: fileRecord.size,
      url: `/api/upload/file/${fileRecord.id}`
    }
  });
}));

/**
 * GET /api/upload/file/:id
 * Servir arquivo
 */
router.get('/file/:id', asyncHandler(async (req, res) => {
  const { user } = req;
  const { id } = req.params;
  
  const file = await prisma.file.findFirst({
    where: {
      id,
      tenantId: user!.tenantId
    }
  });
  
  if (!file) {
    return res.status(404).json({ error: 'Arquivo não encontrado' });
  }
  
  // Verificar se o arquivo existe no sistema de arquivos
  if (!fs.existsSync(file.path)) {
    return res.status(404).json({ error: 'Arquivo não encontrado no sistema' });
  }
  
  // Definir headers apropriados
  res.setHeader('Content-Type', file.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${file.originalName}"`);
  
  // Enviar arquivo
  res.sendFile(path.resolve(file.path));
}));

/**
 * GET /api/upload/files
 * Listar arquivos do tenant
 */
router.get('/files', asyncHandler(async (req, res) => {
  const { user } = req;
  const { page = 1, limit = 20, type } = req.query;
  
  const where: any = {
    tenantId: user!.tenantId
  };
  
  if (type) {
    where.mimetype = {
      startsWith: type as string
    };
  }
  
  const files = await prisma.file.findMany({
    where,
    include: {
      uploadedByUser: {
        select: {
          email: true,
          name: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit)
  });
  
  const total = await prisma.file.count({ where });
  
  res.json({
    files: files.map(file => ({
      id: file.id,
      filename: file.filename,
      originalName: file.originalName,
      mimetype: file.mimetype,
      size: file.size,
      url: `/api/upload/file/${file.id}`,
      uploadedBy: file.uploadedByUser?.name || file.uploadedByUser?.email,
      createdAt: file.createdAt
    })),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

export { router as uploadRoutes };