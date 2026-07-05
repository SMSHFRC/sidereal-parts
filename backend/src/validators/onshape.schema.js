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

const importBody = z.object({
  url: z.string().trim().max(2048).url('必須是合法 URL'),
  systemId: z.coerce.number().int().positive(),
  manufacturingMethodId: z.coerce.number().int().positive(),
  materialId: z.coerce.number().int().positive().optional(),
  postProcessId: z.coerce.number().int().positive().optional(),
});

export const importPreviewSchema = { body: importBody.pick({ url: true }) };
export const importBomSchema = { body: importBody };
