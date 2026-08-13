// 力量 / PR 计算工具

/**
 * Epley 公式估算 1RM
 * 1RM = weight * (1 + reps / 30)
 * 仅当 reps > 0 且 weight > 0 时有效
 */
export function epley1rm(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!weight || !reps || reps <= 0) return null;
  return weight * (1 + reps / 30);
}

/** 训练容量 = weight * sets * reps */
export function volume(
  weight: number | null | undefined,
  sets: number | null | undefined,
  reps: number | null | undefined,
): number | null {
  if (!weight || !sets || !reps) return null;
  return weight * sets * reps;
}

/** 保留 1 位小数 */
export function r1(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(1);
}

/** 保留 2 位小数 */
export function r2(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}
