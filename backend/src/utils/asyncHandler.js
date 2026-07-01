// 包住 async controller，讓拋出的錯誤自動進 error middleware（免每支寫 try/catch）
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
