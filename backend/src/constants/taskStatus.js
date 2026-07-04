// 任務狀態機
// 有後處理的任務：processing 必須先交 post_processing，後處理者完成才 completed。
// 無後處理的任務：processing 直接 completed（post_processing 不可用）。
// （「有無後處理」為任務屬性，條件式限制在 task.service 內判斷）
export const TASK_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  POST_PROCESSING: 'post_processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

// 由某狀態 -> 可到達的狀態（結構上限；per-task 條件另於 service 檢查）
export const STATUS_TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['processing', 'rejected', 'cancelled'],
  processing: ['post_processing', 'completed', 'rejected', 'cancelled'],
  post_processing: ['completed', 'cancelled'],
  completed: [], // 終態
  rejected: [], // 終態
  cancelled: [], // 終態
};

export const isValidTransition = (from, to) =>
  Array.isArray(STATUS_TRANSITIONS[from]) && STATUS_TRANSITIONS[from].includes(to);
