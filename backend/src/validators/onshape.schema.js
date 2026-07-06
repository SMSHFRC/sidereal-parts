import { z } from 'zod';

const hex24 = z.string().regex(/^[0-9a-f]{24}$/i, '格式錯誤');

// did/wvm/wvmId/eid 皆必填的元素參照
const elementRef = z.object({
  did: hex24,
  wvm: z.enum(['w', 'v', 'm']),
  wvmId: hex24,
  eid: hex24,
});

export const resolveSchema = {
  body: z.object({ url: z.string().trim().max(2048).url('必須是合法 URL') }),
};

export const elementRefSchema = { query: elementRef };

// 單一零件縮圖：element 參照 + partId（partId 非 hex，Onshape 用短碼如 'JHD'）
export const partThumbnailSchema = {
  query: elementRef.extend({ partId: z.string().min(1).max(64) }),
};

// 逐件覆寫：由前端在預覽後可調整分類/加工方式/材料/後處理/數量
const importItem = z.object({
  rowKey: z.string().min(1).max(512),
  classification: z.enum(['made', 'cots', 'skip']).optional(),
  manufacturingMethodId: z.coerce.number().int().positive().nullable().optional(),
  materialId: z.coerce.number().int().positive().nullable().optional(),
  postProcessId: z.coerce.number().int().positive().nullable().optional(),
  quantity: z.coerce.number().int().positive().max(100000).optional(),
});

const importBaseBody = z.object({
  url: z.string().trim().max(2048).url('必須是合法 URL'),
  systemId: z.coerce.number().int().positive().optional(),
  robotId: z.coerce.bigint().optional(),
  subsystemId: z.coerce.bigint().optional(),
  // 全域「預設值」；逐件未指定時採用（皆選填）
  manufacturingMethodId: z.coerce.number().int().positive().optional(),
  materialId: z.coerce.number().int().positive().optional(),
  postProcessId: z.coerce.number().int().positive().optional(),
  items: z.array(importItem).max(1000).optional(),
});

const importBody = importBaseBody.refine((v) => v.systemId || v.subsystemId, {
  message: '請選擇系統或從子系統匯入',
  path: ['systemId'],
});

export const importPreviewSchema = { body: importBaseBody.pick({ url: true }) };
export const importBomSchema = { body: importBody };
