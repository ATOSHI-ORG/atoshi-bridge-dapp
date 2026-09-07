/**
 * 跨链记录的本地存储。
 *
 * 为什么需要它
 *
 * getBridgeHistory 返回空数组 —— 跨链记录天然需要两条链的数据拼起来，那是
 * 索引服务的活，前端做不了。但「没有索引服务」不等于「用户看不到自己刚发的
 * 那一笔」：交易哈希、金额、收款地址、messageId 都是提交时就在手上的。
 *
 * 之前这些只存在 React state 里，而 App 每次自动刷新都用那个空数组覆盖 ——
 * 所以记录不是「关掉弹窗就找不回来」，是**下一次刷新就没了**，连弹窗还开着
 * 都可能被清掉，状态永远停在「进行中」。
 *
 * 存在 localStorage 里只解决单浏览器单设备的问题，不能替代索引服务：换设备、
 * 清缓存都看不到。但对「我刚发的那笔到哪了」这个真正的问题够用，而且诚实 ——
 * 不需要编造任何数据。
 */

import type { BridgeRecord } from '../types';

const KEY = 'atoshi_bridge_records_v1';

/**
 * 存多少条。
 *
 * localStorage 每个域名通常 5MB，一条记录约 1KB，所以 200 条离上限很远。
 * 设上限只是防止长期使用后无声地涨下去 —— 超了从最旧的开始丢。
 */
const MAX_RECORDS = 200;

function readAll(): BridgeRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // 存的内容坏了（手工改过、版本不兼容）就当没有，不要让整个页面挂掉
    return [];
  }
}

function writeAll(list: BridgeRecord[]): void {
  try {
    const trimmed = [...list]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // 隐私模式下 setItem 会抛。记录丢了不影响跨链本身，不打扰用户。
  }
}

/**
 * 判断一条记录是不是「这个地址的」。
 *
 * 同一个账户有 0x 和 atoshi1 两种表示，而记录里的 sender/recipient 可能是
 * 任意一种（桥入的 sender 是以太坊地址，recipient 可能是用户填的 0x 或
 * bech32）。所以四个字段都比，大小写不敏感。
 *
 * 宁可多显示也不要漏：漏了用户会以为交易没发出去，而多显示最多是看到一条
 * 自己另一种地址形式发的记录 —— 那本来就是他自己的。
 */
function belongsTo(r: BridgeRecord, forms: string[]): boolean {
  if (forms.length === 0) return false;
  const fields = [r.sender, r.recipient].filter(Boolean).map((x) => x.toLowerCase());
  return fields.some((f) => forms.includes(f));
}

/** 读出属于这些地址形式的记录，新的在前。 */
export function loadRecords(addressForms: string[]): BridgeRecord[] {
  const forms = addressForms.filter(Boolean).map((a) => a.toLowerCase());
  return readAll()
    .filter((r) => belongsTo(r, forms))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** 新增或整条覆盖。id 相同视为同一条。 */
export function saveRecord(record: BridgeRecord): void {
  const all = readAll().filter((r) => r.id !== record.id);
  all.push(record);
  writeAll(all);
}

/**
 * 局部更新，返回更新后的记录（没找到返回 null）。
 *
 * 用于状态确认：查到到账之后只改 status / steps / destTxHash，
 * 不动提交时就确定的那些字段。
 */
export function patchRecord(id: string, patch: Partial<BridgeRecord>): BridgeRecord | null {
  const all = readAll();
  const i = all.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const updated = { ...all[i], ...patch, updatedAt: Date.now() };
  all[i] = updated;
  writeAll(all);
  return updated;
}

/**
 * 本地记录和服务端列表合并。
 *
 * 现在服务端恒为空，但以后接上索引服务之后这个函数不用改：同 id 以服务端为准
 * （它看得到两条链，本地只看得到提交那一侧），本地独有的补在后面。
 */
export function mergeRecords(local: BridgeRecord[], remote: BridgeRecord[]): BridgeRecord[] {
  const byId = new Map<string, BridgeRecord>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) byId.set(r.id, r);
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}
