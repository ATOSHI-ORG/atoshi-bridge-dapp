/**
 * 到账确认 —— 两个方向都是真查链，不猜。
 *
 * 这一层存在的理由：提交成功只说明**源链**收下了，钱到没到在目标链上。之前
 * 前端提交完就把记录标成「进行中」然后永远不再动，用户只能自己去区块浏览器
 * 上手查 —— 而桥入的目标链是 Atoshi，普通用户根本不知道去哪查。
 *
 * 两个方向的查法不一样，因为两条链能给的东西不一样：
 *
 *   桥入 (Sepolia -> Atoshi)
 *     Atoshi 上放款的那笔交易带一个 bridge_in 事件，属性里有 message_id。
 *     用 Cosmos 的事件检索按 message_id 精确查，能拿到目标链交易哈希、
 *     实际到账金额、收款地址。这是精确匹配，不是按金额和时间猜。
 *
 *     注意查询参数是 `query=` 不是 `events=` —— 后者在 SDK 0.50 已经废了，
 *     用它会报 "query cannot be empty"，看起来像是我们没传参数。
 *
 *   桥出 (Atoshi -> Sepolia)
 *     以太坊侧的 Mailbox 有 delivered(bytes32) 直接返回投递状态，一次
 *     eth_call 就够。拿不到目标链交易哈希（要翻日志），但「到没到」是确定的。
 *
 * 为什么不用「收款地址余额涨了」当信号：那会把别人转给他的钱也算成到账。
 * 我们刚花了很久修一个「显示成功但链上查不到」的问题，不能再引入一个同类的。
 */

import type { BridgeRecord } from '../types';
import { REST_BASE, restGet } from './chainRest';
import { NO_AUTH_LIST } from './bridgeApiChain';
import { getPublicClient } from 'wagmi/actions';
import { wagmiConfig } from '../wallet/config';
import { ETH_CHAIN_ID } from '../wallet/chains';
import { SEPOLIA_MAILBOX, mailboxAbi } from '../wallet/contracts';

export interface DeliveryResult {
  /** 明确查到已到账 */
  delivered: boolean;
  /** 目标链上的交易哈希。桥出查不到（需要翻日志），所以是可选的。 */
  destTxHash?: string;
  /** 实际到账金额（基本单位）。只有桥入拿得到。 */
  deliveredAmount?: string;
  /**
   * 查不动（节点不通、没配 RPC、没有 messageId）。
   *
   * 和 delivered:false 分开：false 是「查过了，还没到」，unknown 是
   * 「没查到结果」。混在一起会让「查不了」显示成「没到账」，那是在
   * 用户最焦虑的时候给他一个错的确定信息。
   */
  unknown?: boolean;
}

const UNKNOWN: DeliveryResult = { delivered: false, unknown: true };

/** 桥入：按 message_id 在 Atoshi 上找放款交易。 */
async function confirmBridgeIn(messageId: string): Promise<DeliveryResult> {
  if (!REST_BASE || !messageId) return UNKNOWN;

  // message_id 在事件里是带 0x 的小写十六进制。原样拼进查询，值要带单引号。
  const q = `bridge_in.message_id='${messageId.toLowerCase()}'`;
  const path = `/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(q)}&limit=1`;

  let res: any;
  try {
    res = await restGet<any>(path);
  } catch {
    return UNKNOWN;
  }

  const tx = (res?.tx_responses || [])[0];
  if (!tx) return { delivered: false };

  // code != 0 说明那笔交易失败了 —— 不算到账。
  // 这不是假设：今天就撞上过 relayer 提交成功但链上 out of gas（code 11），
  // 只看「有没有这笔交易」会把失败当成功。
  if (Number(tx.code ?? 0) !== 0) return { delivered: false };

  let amount: string | undefined;
  for (const ev of tx.events || []) {
    if (ev.type !== 'bridge_in') continue;
    for (const a of ev.attributes || []) {
      if (a.key === 'amount') amount = String(a.value);
    }
  }

  return { delivered: true, destTxHash: tx.txhash, deliveredAmount: amount };
}

/** 桥出：问以太坊侧的 Mailbox 投递了没。 */
async function confirmBridgeOut(messageId: string): Promise<DeliveryResult> {
  if (!messageId || !SEPOLIA_MAILBOX) return UNKNOWN;
  const client = getPublicClient(wagmiConfig, { chainId: ETH_CHAIN_ID });
  if (!client) return UNKNOWN;

  try {
    const ok = await client.readContract({
      address: SEPOLIA_MAILBOX,
      abi: mailboxAbi,
      functionName: 'delivered',
      args: [messageId as `0x${string}`],
      ...NO_AUTH_LIST,
    });
    return { delivered: Boolean(ok) };
  } catch {
    return UNKNOWN;
  }
}

/**
 * 确认一条记录到账了没。
 *
 * 没有 messageId 就查不了 —— 那是唯一能跨两条链把一笔对应起来的东西。
 * 我们现在两个方向都从提交收据的日志里解出它了（bridgeAdapter 的 BridgeOut
 * 事件 / Mailbox 的 DispatchId 事件），所以正常情况下都有。
 */
export async function confirmDelivery(record: BridgeRecord): Promise<DeliveryResult> {
  if (!record.messageId) return UNKNOWN;
  return record.direction === 'in'
    ? confirmBridgeIn(record.messageId)
    : confirmBridgeOut(record.messageId);
}

/** 已经是终态的记录不用再查。 */
export function isSettled(record: BridgeRecord): boolean {
  return record.status === 'completed' || record.status === 'failed';
}

/**
 * 把「查到到账了」变成一条更新后的记录。
 *
 * 只改状态相关的字段，提交时确定的那些（金额、收款地址、源链哈希）不动。
 */
export function applyDelivery(record: BridgeRecord, res: DeliveryResult): BridgeRecord {
  const now = Date.now();
  return {
    ...record,
    status: 'completed',
    currentStep: record.steps.length,
    destTxHash: res.destTxHash ?? record.destTxHash,
    steps: record.steps.map((s, i) => ({
      ...s,
      status: 'completed' as const,
      timestamp: s.timestamp ?? now,
      // 目标链的哈希挂在最后一步上，用户点进去就能查
      txHash: i === record.steps.length - 1 ? res.destTxHash ?? s.txHash : s.txHash,
    })),
    updatedAt: now,
  };
}
