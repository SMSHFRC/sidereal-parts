import { ApiError } from './ApiError.js';
import { ROLES } from '../constants/roles.js';

const isPlateMaterial = (materialCode) =>
  typeof materialCode === 'string' && (materialCode.startsWith('PC_') || materialCode.includes('PLATE'));

export function downloadSpecForTask(task) {
  const methodCode = task.manufacturingMethod?.code;

  if (methodCode === '3DP') return { format: 'stl', contentType: 'model/stl' };
  if (methodCode === 'LASER') return { format: 'dxf', contentType: 'application/dxf' };
  if (methodCode === 'CNC' && isPlateMaterial(task.material?.code)) {
    return { format: 'dxf', contentType: 'application/dxf' };
  }
  return null;
}

export function assertDownloadPermission(task, actor) {
  if (actor.role === ROLES.ADMIN || String(task.assigneeId) === String(actor.id)) return;
  throw ApiError.forbidden('只有此任務的加工者或管理員可以下載加工檔案', 'TASK_DOWNLOAD_FORBIDDEN');
}
