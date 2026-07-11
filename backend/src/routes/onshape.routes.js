import { Router } from 'express';
import { onshapeController } from '../controllers/onshape.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  resolveSchema,
  elementRefSchema,
  partThumbnailSchema,
  importItemsQuerySchema,
  updateImportItemSchema,
  importPreviewSchema,
  importBomSchema,
} from '../validators/onshape.schema.js';

const router = Router();

// OAuth callback：Onshape redirect 進來，無 JWT，靠簽名 state 識別（放在 authenticate 之前）
router.get('/callback', onshapeController.callback);

router.use(authenticate);

router.get('/status', onshapeController.status); // 是否已連結
router.get('/auth-url', onshapeController.authUrl); // 取授權跳轉網址
router.delete('/connection', onshapeController.disconnect); // 解除連結

router.post('/resolve', validate(resolveSchema), onshapeController.resolve); // 解析+驗證連結
router.get('/parts', validate(elementRefSchema), onshapeController.parts); // Part Studio 零件清單
router.get('/bom', validate(elementRefSchema), onshapeController.bom); // Assembly BOM
router.post('/import/preview', validate(importPreviewSchema), onshapeController.importPreview);
router.post('/import', validate(importBomSchema), onshapeController.importBom);
router.get('/thumbnail', validate(elementRefSchema), onshapeController.thumbnail); // element 縮圖代理
router.get('/part-thumbnail', validate(partThumbnailSchema), onshapeController.partThumbnail); // 單一零件縮圖
router.get('/import-items', validate(importItemsQuerySchema), onshapeController.importItems); // COTS/跳過清單
router.get('/assembly-progress', validate(elementRefSchema), onshapeController.assemblyProgress); // 此組合加工進度

router.patch('/import-items/:id', validate(updateImportItemSchema), onshapeController.updateImportItem);

export default router;
