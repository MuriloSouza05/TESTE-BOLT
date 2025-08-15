import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { ZodError } from 'zod';

interface PrismaError extends Error {
  code?: string;
  meta?: {
    target?: string[];
    field_name?: string;
  };
}

export const errorHandler = (
  error: Error | PrismaError | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error caught by errorHandler:', error);

  // Erros personalizados da aplicação
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      status: 'error',
      message: error.message,
      code: error.name
    });
  }

  // Erros de validação do Prisma
  if (error.name === 'PrismaClientValidationError') {
    return res.status(400).json({
      status: 'error',
      message: 'Erro de validação nos dados enviados',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  // Erros únicos do Prisma (ex: violação de unique constraint)
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as PrismaError;
    
    if (prismaError.code === 'P2002') {
      return res.status(409).json({
        status: 'error',
        message: 'Registro duplicado encontrado',
        field: prismaError.meta?.target?.[0] || 'campo único'
      });
    }
    
    if (prismaError.code === 'P2025') {
      return res.status(404).json({
        status: 'error',
        message: 'Registro não encontrado'
      });
    }
  }

  // Erros de validação do Zod
  if (error instanceof ZodError) {
    return res.status(400).json({
      status: 'error',
      message: 'Erro de validação',
      details: error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }))
    });
  }

  // Erros de JWT
  if (error.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token inválido'
    });
  }

  if (error.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token expirado'
    });
  }

  // Log do erro completo em desenvolvimento
  if (process.env.NODE_ENV === 'development') {
    console.error('Erro completo:', {
      name: error.name,
      message: error.message,
      stack: error.stack
    });
  }

  // Erro genérico para produção
  return res.status(500).json({
    status: 'error',
    message: 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { 
      details: error.message,
      stack: error.stack 
    })
  });
};