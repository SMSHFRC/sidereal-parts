// 統一的可預期錯誤；controller/service 主動丟這個，交給 error middleware 處理
export class ApiError extends Error {
  constructor(statusCode, message, code = undefined, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code; // 機器可讀錯誤碼，如 'INVALID_STATUS_TRANSITION'
    this.details = details;
    this.isOperational = true;
  }

  static badRequest(msg, code, details) { return new ApiError(400, msg, code, details); }
  static unauthorized(msg = '未授權', code = 'UNAUTHORIZED') { return new ApiError(401, msg, code); }
  static forbidden(msg = '權限不足', code = 'FORBIDDEN') { return new ApiError(403, msg, code); }
  static notFound(msg = '資源不存在', code = 'NOT_FOUND') { return new ApiError(404, msg, code); }
  static conflict(msg, code = 'CONFLICT') { return new ApiError(409, msg, code); }
}
