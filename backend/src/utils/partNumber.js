// 並發安全的零件編號產生：PREFIX-0001
// 靠 upsert + atomic increment（DB 端 UPDATE ... SET last_value = last_value + 1）
// 搭配 tasks.part_number 的 UNIQUE 作為最後防線。必須在 transaction 內呼叫。
export async function nextPartNumber(tx, prefix, pad = 4) {
  const seq = await tx.taskNumberSequence.upsert({
    where: { prefix },
    create: { prefix, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  const value = seq.lastValue; // BigInt
  const partNumber = `${prefix}-${value.toString().padStart(pad, '0')}`;
  return { partNumber, seq: value };
}
