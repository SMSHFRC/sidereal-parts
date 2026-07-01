// 以 zod schema 驗證 body/params/query，並用清洗後的值取代原輸入（防注入、型別安全）
import { ApiError } from '../utils/ApiError.js';

export const validate = (schemas) => (req, _res, next) => {
  try {
    for (const key of ['body', 'params', 'query']) {
      if (schemas[key]) {
        const result = schemas[key].safeParse(req[key]);
        if (!result.success) {
          const details = result.error.issues.map((i) => ({
            field: i.path.join('.'),
            message: i.message,
          }));
          throw ApiError.badRequest('輸入驗證失敗', 'VALIDATION_ERROR', details);
        }
        // query 為 getter，只覆蓋可寫的 body/params；query 值另存
        if (key === 'query') req.validatedQuery = result.data;
        else req[key] = result.data;
      }
    }
    next();
  } catch (err) {
    next(err);
  }
};
