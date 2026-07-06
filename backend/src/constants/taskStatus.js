// 任務狀態機
// 有後處理的任務：processing 必須先交 post_processing，後處理者完成才 completed。
// 無後處理的任務：processing 直接 completed（post_processing 不可用）。
// （「有無後處理」為任務屬性，條件式限制在 task.service 內判斷）
export const TASK_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  POST_PROCESSING: 'post_processing',
  PENDING_REVIEW: 'pending_review',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

// 由某狀態 -> 可到達的狀態（結構上限；per-task 條件另於 service 檢查）
// pending_review（待驗收）：需驗收的加工方式（如 CNC/車床），加工者送審後
// 由管理員驗收 → completed/post_processing，或退回 → processing。
export const STATUS_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['processing', 'rejected', 'cancelled'],
  processing: ['pending_review', 'post_processing', 'completed', 'rejected', 'cancelled'],
  pending_review: ['completed', 'post_processing', 'processing', 'cancelled'],
  post_processing: ['completed', 'cancelled'],
  completed: [], // 終態
  rejected: [], // 終態
  cancelled: [], // 終態
};

export const isValidTransition = (from, to) =>
  Array.isArray(STATUS_TRANSITIONS[from]) && STATUS_TRANSITIONS[from].includes(to);
