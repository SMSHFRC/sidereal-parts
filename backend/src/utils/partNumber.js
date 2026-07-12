// 並發安全的零件編號產生：PREFIX-0001
// 靠 upsert + atomic increment（DB 端 UPDATE ... SET last_value = last_value + 1）
// 搭配 tasks.part_number 的 UNIQUE 作為最後防線。必須在 transaction 內呼叫。
export async function nextPartNumber(tx, prefix, pad = 4) {
  const seq = await tx.taskNumberSequence.upsert({
    where: { prefix },
    create: { prefix, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  let value = seq.lastValue; // BigInt

  // 自我修復：計數器若落後於實際最大序號（資料曾被清空/還原、或計數器未同步），
  // 直接跳到最大序號之後，避免產生已存在的零件編號（唯一鍵衝突）。
  const maxRow = await tx.task.findFirst({
    where: { partNumberPrefix: prefix },
    orderBy: { partNumberSeq: 'desc' },
    select: { partNumberSeq: true },
  });
  if (maxRow && maxRow.partNumberSeq >= value) {
    value = maxRow.partNumberSeq + 1n;
    await tx.taskNumberSequence.update({ where: { prefix }, data: { lastValue: value } });
  }

  const partNumber = `${prefix}-${value.toString().padStart(pad, '0')}`;
  return { partNumber, seq: value };
}
