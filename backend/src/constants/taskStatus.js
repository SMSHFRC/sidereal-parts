// 任務狀態機：合法轉換 + 各轉換允許的角色
export const TASK_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
};

// 由某狀態 -> 可到達的狀態
export const STATUS_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['processing', 'rejected', 'cancelled'],
  processing: ['completed', 'cancelled'],
  completed: [], // 終態
  rejected: [], // 終態
  cancelled: [], // 終態
};

// 每個目標狀態由誰觸發：
//   'assignee' = 被指派的加工者本人、'creator' = 建立任務的設計者本人
//   admin 一律放行（在 service 內判斷）
export const TRANSITION_ACTORS = {
  accepted: ['assignee'],
  rejected: ['assignee'],
  processing: ['assignee'],
  completed: ['assignee'],
  cancelled: ['creator'],
};

export const isValidTransition = (from, to) =>
  Array.isArray(STATUS_TRANSITIONS[from]) && STATUS_TRANSITIONS[from].includes(to);
