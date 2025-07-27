const multer = require('multer');
const path = require('path');
const fs = require('fs');

class UploadMiddleware {
  constructor() {
    // Configuração de armazenamento
    this.storage = multer.diskStorage({
      destination: (req, file, cb) => {
        let uploadPath;
        
        // Determinar pasta baseado no tipo de upload
        if (req.route.path.includes('scratchcards')) {
          uploadPath = 'public/uploads/scratchcards';
        } else if (req.route.path.includes('prizes')) {
          uploadPath = 'public/uploads/prizes';
        } else {
          uploadPath = 'public/uploads';
        }
        
        // Criar pasta se não existir
        if (!fs.existsSync(uploadPath)) {
          fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
      },
      filename: (req, file, cb) => {
        // Gerar nome único para o arquivo
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        const filename = file.fieldname + '-' + uniqueSuffix + extension;
        cb(null, filename);
      }
    });
    
    // Filtro de tipos de arquivo
    this.fileFilter = (req, file, cb) => {
      // Tipos de arquivo permitidos
      const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
      const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
      const mimetype = allowedTypes.test(file.mimetype);
      
      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Apenas arquivos de imagem são permitidos (JPEG, JPG, PNG, GIF, SVG, WEBP)'));
      }
    };
    
    // Configuração do multer
    this.upload = multer({
      storage: this.storage,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB máximo
        files: 5 // máximo 5 arquivos por vez
      },
      fileFilter: this.fileFilter
    });
  }
  
  /**
   * Middleware para upload de uma única imagem
   * @param {string} fieldName - Nome do campo do arquivo
   * @returns {Function} Middleware do multer
   */
  single(fieldName = 'image') {
    return this.upload.single(fieldName);
  }
  
  /**
   * Middleware para upload de múltiplas imagens
   * @param {string} fieldName - Nome do campo dos arquivos
   * @param {number} maxCount - Número máximo de arquivos
   * @returns {Function} Middleware do multer
   */
  array(fieldName = 'images', maxCount = 9) {
    return this.upload.array(fieldName, maxCount);
  }
  
  /**
   * Middleware para upload de campos múltiplos
   * @param {Array} fields - Array de objetos com name e maxCount
   * @returns {Function} Middleware do multer
   */
  fields(fields) {
    return this.upload.fields(fields);
  }
  
  /**
   * Middleware de tratamento de erros do multer
   * @param {Error} error - Erro do multer
   * @param {Object} req - Request object
   * @param {Object} res - Response object
   * @param {Function} next - Next function
   */
  handleError(error, req, res, next) {
    if (error instanceof multer.MulterError) {
      switch (error.code) {
        case 'LIMIT_FILE_SIZE':
          return res.status(400).json({
            success: false,
            message: 'Arquivo muito grande. Tamanho máximo: 5MB'
          });
        case 'LIMIT_FILE_COUNT':
          return res.status(400).json({
            success: false,
            message: 'Muitos arquivos. Máximo permitido: 5 arquivos'
          });
        case 'LIMIT_UNEXPECTED_FILE':
          return res.status(400).json({
            success: false,
            message: 'Campo de arquivo inesperado'
          });
        default:
          return res.status(400).json({
            success: false,
            message: `Erro no upload: ${error.message}`
          });
      }
    }
    
    if (error.message.includes('Apenas arquivos de imagem')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    next(error);
  }
  
  /**
   * Deletar arquivo do sistema
   * @param {string} filePath - Caminho do arquivo
   * @returns {Promise<boolean>} Sucesso da operação
   */
  async deleteFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Erro ao deletar arquivo:', error);
      return false;
    }
  }
  
  /**
   * Gerar URL pública para o arquivo
   * @param {string} filename - Nome do arquivo
   * @param {string} type - Tipo (scratchcards ou prizes)
   * @returns {string} URL pública
   */
  generatePublicUrl(filename, type = 'scratchcards') {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:7778';
    return `${baseUrl}/uploads/${type}/${filename}`;
  }
}

module.exports = new UploadMiddleware();