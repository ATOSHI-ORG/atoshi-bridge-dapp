/**
 * 桥的真链实现。
 *
 * 先说清楚现在能做到什么、做不到什么：
 *
 * ┌─────────────────┬──────────────────────────────────────────────────────┐
 * │ 桥参数           │ ✅ REST /atoshi/bridgeadapter/v1/params               │
 * │ migration_pool  │ ✅ module_accounts + bank balances                   │
 * │ 五层限流的「上限」 │ ✅ 前端照搬链上 ResolveLimits 算，逐条对过 Go 源码       │
 * │ 五层限流的「已用」 │ ✅ 从 Blockscout BridgeOut 日志重建 UTC 当日用量          │
 * │ ATOS 余额        │ ✅ bank balances                                     │
 * │ ERC20 余额       │ ✅ 以太坊合约调用                                     │
 * │ 桥入 (Ethereum→Atoshi)│ ✅ AtosCollateral.transferRemote，两笔交易        │
 * │ 桥出 (Atoshi→Ethereum)│ ✅ bridgeadapter 预编译 0x…0808，一笔交易         │
 * │ 交易历史 / 状态   │ ❌ 无查询接口，需要后端索引                            │
 * └─────────────────┴──────────────────────────────────────────────────────┘
 *
 * 桥出为什么要预编译：链上真正执行的是 MsgBridgeOut，一条 Cosmos 消息，而
 * MetaMask 这类钱包只签 EVM 交易。预编译（0x…0808）是它的 EVM 入口 ——
 * 和质押能用 EVM 钱包同理（0x…0800）。它是链上 evm params 里
 * active_static_precompiles 的一项，没有字节码，别用 eth_getCode 去判断它在不在。
 *
 * 做不到的方法一律抛出说明缺什么的错误，不返回假的 tx_hash —— 假成功比失败危险，
 * 用户会以为钱已经在路上了。
 */

import { tr } from '../i18n';

import type {
  AddressBookItem,
  BridgeDirection,
  BridgeLimits,
  BridgeParams,
  BridgeRecord,
} from '../types';
import {
  BOND_DENOM,
  ChainRestError,
  amountOf,
  atosToLiao,
  liaoToAtos,
  restGet,
} from './chainRest';
import { bridgeServiceMock } from './bridgeApiMock';

import {
  ATOSHI_CHAIN_ID,
  ATOSHI_EXPLORER_API,
  ETH_CHAIN_ID,
  atoshi,
  ethChain,
  toHex,
  toHyperlane32Bytes,
} from '../wallet/chains';
import { wagmiConfig } from '../wallet/config';
import {
  COLLATERAL_ADDRESS,
  ERC20_ATOS_ADDRESS,
  ETH_CONTRACTS_READY,
  GAS_LIMITS,
  BRIDGE_ADAPTER_PRECOMPILE,
  bridgeAdapterAbi,
  erc20Abi,
  mailboxAbi,
  tokenRouterAbi,
} from '../wallet/contracts';

/*
 * wagmi 用命令式 actions，这样 service 保持普通对象的形状，UI 不用改。
 *
 * 读合约走 viem 的 publicClient 而不是 wagmi 的 readContract：后者传了 chainId
 * 之后类型会塌成约束上界（要求 authorizationList 这种本该可选的字段）。
 * 桥必须指定链 —— 这几个调用都是读以太坊侧，不是 Atoshi —— 所以用 client 更直接。
 */
import {
  getAccount,
  getPublicClient,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions';
import { decodeEventLog, parseEventLogs, type Hex } from 'viem';

/**
 * viem 2.5x 的 ReadContractParameters 把 authorizationList（EIP-7702 用的）
 * 标成了必填，是联合类型塌陷导致的，不是真的需要它 —— 运行时 viem 会忽略。
 * 下面每个 readContract 都带 `...NO_AUTH_LIST` 就是为了满足这个类型。
 * viem 2.55 和 2.56 都有这个问题，不是版本回退能解决的。
 */
export const NO_AUTH_LIST = { authorizationList: undefined } as const;

/** 以太坊侧的只读 client。桥入的所有读操作都走这个。 */
function ethClient() {
  const client = getPublicClient(wagmiConfig, { chainId: ETH_CHAIN_ID });
  if (!client) {
    throw new ChainRestError(tr('err.no_rpc_client', { chainId: ETH_CHAIN_ID }));
  }
  return client;
}

const BPS_DENOMINATOR = 10000;

/* ─────────────────────────── 只读 ─────────────────────────── */

/** migration_pool 的模块账户地址。链上是 authtypes.NewModuleAddress 派生的，这里查出来。 */
let migrationPoolAddrCache: string | null = null;

async function migrationPoolAddress(): Promise<string> {
  if (migrationPoolAddrCache) return migrationPoolAddrCache;
  const res = await restGet<any>('/cosmos/auth/v1beta1/module_accounts');
  const acc = (res?.accounts ?? []).find((a: any) => a?.name === 'migration_pool');
  const addr = acc?.base_account?.address;
  if (!addr) {
    throw new ChainRestError(tr('err.no_migration_pool'));
  }
  migrationPoolAddrCache = addr;
  return addr;
}

async function getBridgeParams(): Promise<BridgeParams> {
  const poolAddr = await migrationPoolAddress();

  const [bridgeRes, tokenomicsRes, poolBalRes] = await Promise.all([
    restGet<any>('/atoshi/bridgeadapter/v1/params'),
    restGet<any>('/atoshi/tokenomics/v1/params'),
    restGet<any>(`/cosmos/bank/v1beta1/balances/${poolAddr}`),
  ]);

  const p = bridgeRes?.params ?? {};
  const tp = tokenomicsRes?.params ?? {};

  return {
    atos_per_erc20: Number(p.atos_per_erc20 ?? 100),
    min_transfer_out: liaoToAtos(p.min_transfer_out),
    global_daily_cap: liaoToAtos(p.global_daily_cap),
    global_daily_cap_bps_of_pool: Number(p.global_daily_cap_bps_of_pool ?? 0),
    per_address_daily_bps: Number(p.per_address_daily_bps ?? 0),
    small_transfer_threshold: liaoToAtos(p.small_transfer_threshold),
    small_quota_bps: Number(p.small_quota_bps ?? 0),
    crisis_pool_bps: Number(p.crisis_pool_bps ?? 0),
    bridge_enabled: Boolean(p.bridge_enabled),
    ethereum_domain: Number(p.ethereum_domain ?? 0),
    migration_pool_balance: liaoToAtos(amountOf(poolBalRes?.balances, BOND_DENOM)),
    migration_pool_total: liaoToAtos(tp.migration_pool_total),
  };
}

/**
 * 五层限流的上限。
 *
 * 这是链上 x/bridgeadapter/types/ratelimit.go 的 ResolveLimits 的前端翻版，
 * 逐条对着 Go 源码写的。**改动时必须同步改两边** —— 前端算得比链宽松会让用户
 * 提交后被拒，算得比链严格会让用户以为额度不够。
 *
 * 关键一条容易漏：全局日上限取「固定参数」和「池子余额 × bps」的**较小值**，
 * 所以池子缩水时额度自动收紧，不用等治理提案。
 */
function resolveLimits(p: BridgeParams): Omit<BridgeLimits, 'resets_at' | 'usage_available'> {
  const bps = (v: number, b: number) => (v > 0 && b > 0 ? Math.floor((v * b) / BPS_DENOMINATOR) : 0);

  let global = Math.max(0, p.global_daily_cap);
  if (p.global_daily_cap_bps_of_pool > 0) {
    const fromPool = bps(p.migration_pool_balance, p.global_daily_cap_bps_of_pool);
    if (global === 0 || fromPool < global) global = fromPool;
  }

  const reserved = bps(global, p.small_quota_bps);
  const largeBudget = Math.max(0, global - reserved);

  const crisis =
    p.crisis_pool_bps > 0 &&
    p.migration_pool_total > 0 &&
    p.migration_pool_balance < bps(p.migration_pool_total, p.crisis_pool_bps);

  const perAddress = bps(global, p.per_address_daily_bps);

  return {
    max_transferable: Math.floor(Math.min(global, perAddress)),
    global_remaining: global,
    global_total: global,
    large_remaining: largeBudget,
    large_total: largeBudget,
    address_remaining: perAddress,
    address_total: perAddress,
    crisis_mode: crisis,
  };
}

interface ExplorerBridgeOutLog {
  transaction_hash?: string;
  index?: number;
  block_timestamp?: string;
  data?: Hex;
  topics?: Array<Hex | null>;
}

interface ExplorerLogPage {
  items?: ExplorerBridgeOutLog[];
  next_page_params?: Record<string, string | number | boolean | null> | null;
}

interface DailyBridgeOut {
  amount: number;
  sender: string;
}

interface DailyUsageCache {
  dayStart: number;
  initialized: boolean;
  entries: Map<string, DailyBridgeOut>;
}

let dailyUsageCache: DailyUsageCache = {
  dayStart: 0,
  initialized: false,
  entries: new Map(),
};

function utcDayStart(now = Date.now()): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function currentUsageCache(): DailyUsageCache {
  const dayStart = utcDayStart();
  if (dailyUsageCache.dayStart !== dayStart) {
    dailyUsageCache = { dayStart, initialized: false, entries: new Map() };
  }
  return dailyUsageCache;
}

function bridgeOutLogKey(txHash: string | undefined, index = 0): string {
  return `${(txHash ?? '').toLowerCase()}:${index}`;
}

function bridgeOutFromLog(log: ExplorerBridgeOutLog): DailyBridgeOut | undefined {
  if (!log.data || !log.topics) return undefined;
  const topics = log.topics.filter((topic): topic is Hex => Boolean(topic));
  if (topics.length < 2) return undefined;

  try {
    const decoded = decodeEventLog({
      abi: bridgeAdapterAbi,
      eventName: 'BridgeOut',
      data: log.data,
      topics: topics as [Hex, ...Hex[]],
      strict: false,
    });
    const args = decoded.args as { sender?: string; amount?: bigint };
    if (!args.sender || args.amount === undefined) return undefined;
    return {
      sender: args.sender.toLowerCase(),
      amount: liaoToAtos(args.amount.toString()),
    };
  } catch {
    return undefined;
  }
}

function explorerLogUrl(cursor?: ExplorerLogPage['next_page_params']): string {
  const url = new URL(
    `${ATOSHI_EXPLORER_API}/addresses/${BRIDGE_ADAPTER_PRECOMPILE}/logs`,
  );
  if (cursor) {
    for (const [key, value] of Object.entries(cursor)) {
      if (value !== null) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/** Refresh UTC-today BridgeOut usage from the indexed, successful EVM events. */
async function refreshDailyUsage(): Promise<DailyUsageCache> {
  const cache = currentUsageCache();
  const staged = new Map<string, DailyBridgeOut>();
  let cursor: ExplorerLogPage['next_page_params'];
  let complete = false;

  // The first load may span several explorer pages. Later polls stop at the first
  // event already in the cache, so the 15-second refresh normally costs one request.
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let page: ExplorerLogPage;
    try {
      const response = await fetch(explorerLogUrl(cursor), {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Explorer HTTP ${response.status}`);
      page = (await response.json()) as ExplorerLogPage;
    } finally {
      clearTimeout(timer);
    }

    for (const log of page.items ?? []) {
      const timestamp = log.block_timestamp ? Date.parse(log.block_timestamp) : NaN;
      if (Number.isFinite(timestamp) && timestamp < cache.dayStart) {
        complete = true;
        break;
      }

      const key = bridgeOutLogKey(log.transaction_hash, log.index);
      if (cache.initialized && cache.entries.has(key)) {
        complete = true;
        break;
      }

      const entry = bridgeOutFromLog(log);
      if (entry) staged.set(key, entry);
    }

    if (complete || !page.next_page_params) {
      complete = true;
      break;
    }
    cursor = page.next_page_params;
  }

  if (!complete) throw new Error('Explorer pagination did not reach the UTC day boundary');
  for (const [key, entry] of staged) cache.entries.set(key, entry);
  cache.initialized = true;
  return cache;
}

function rememberBridgeOut(txHash: string, sender: string, amount: number): void {
  currentUsageCache().entries.set(bridgeOutLogKey(txHash), {
    sender: sender.toLowerCase(),
    amount,
  });
}

function limitsWithUsage(
  base: Omit<BridgeLimits, 'resets_at' | 'usage_available'>,
  params: BridgeParams,
  address: string,
  cache: DailyUsageCache,
): Omit<BridgeLimits, 'resets_at' | 'usage_available'> {
  const sender = toHex(address).toLowerCase();
  let globalUsed = 0;
  let largeUsed = 0;
  let addressUsed = 0;

  for (const entry of cache.entries.values()) {
    globalUsed += entry.amount;
    if (entry.amount > params.small_transfer_threshold) largeUsed += entry.amount;
    if (entry.sender === sender) addressUsed += entry.amount;
  }

  const globalRemaining = Math.max(0, base.global_total - globalUsed);
  const largeRemaining = Math.max(0, base.large_total - largeUsed);
  const addressRemaining = Math.max(0, base.address_total - addressUsed);
  const commonRemaining = Math.min(globalRemaining, addressRemaining);
  const smallCeiling = params.small_transfer_threshold > 0
    ? Math.min(commonRemaining, params.small_transfer_threshold)
    : commonRemaining;
  const largeCeiling = !base.crisis_mode && largeRemaining > params.small_transfer_threshold
    ? Math.min(commonRemaining, largeRemaining)
    : 0;

  return {
    ...base,
    max_transferable: Math.floor(Math.max(smallCeiling, largeCeiling)),
    global_remaining: globalRemaining,
    large_remaining: largeRemaining,
    address_remaining: addressRemaining,
  };
}

/** 今日额度重置时间：链上按 UTC 日切。 */
function nextResetTimestamp(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

async function getBridgeLimits(address?: string): Promise<BridgeLimits> {
  const params = await getBridgeParams();
  const base = resolveLimits(params);

  if (address) {
    try {
      const usage = await refreshDailyUsage();
      return {
        ...limitsWithUsage(base, params, address, usage),
        resets_at: nextResetTimestamp(),
        usage_available: true,
      };
    } catch (error) {
      console.warn('Unable to rebuild BridgeOut quota usage from explorer logs', error);
    }
  }

  return {
    ...base,
    resets_at: nextResetTimestamp(),
    usage_available: false,
  };
}

/* ─────────────────────────── 余额 ─────────────────────────── */

function connectedAddress(): `0x${string}` {
  const { address, isConnected } = getAccount(wagmiConfig);
  if (!isConnected || !address) {
    throw new ChainRestError(tr('err.connect_wallet'));
  }
  return address;
}

async function getUserBalanceAtos(bech32Address: string): Promise<number> {
  const res = await restGet<any>(`/cosmos/bank/v1beta1/balances/${bech32Address}`);
  return liaoToAtos(amountOf(res?.balances, BOND_DENOM));
}

async function getUserBalanceErc20(): Promise<number> {
  if (!ETH_CONTRACTS_READY) return 0;
  const owner = connectedAddress();
  const raw = await ethClient().readContract({
    address: ERC20_ATOS_ADDRESS!,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [owner],
    ...NO_AUTH_LIST,
  });
  // ERC20 ATOS 也是 18 位小数
  return liaoToAtos(raw.toString());
}

/* ─────────────────────────── 桥出 ─────────────────────────── */

/**
 * 确保钱包连在指定的链上，不对就请钱包切。
 *
 * 桥的两个方向在**不同的链**上发交易：桥入是以太坊交易，桥出是 Atoshi 交易。
 * 只报错「请先切链」的话用户没有能点的东西 —— 页面上没有切链按钮，
 * 而钱包里手动加一条 Atoshi 网络对测试同学是另一件事。
 *
 * 用户可能在钱包弹窗里拒绝，那就把原来那句话抛出去，此时它是准确的。
 */
async function ensureChain(want: number, errKey: string): Promise<void> {
  const { chainId } = getAccount(wagmiConfig);
  if (chainId === want) return;
  try {
    await switchChain(wagmiConfig, { chainId: want });
  } catch {
    throw new ChainRestError(tr(errKey, { want, got: String(chainId) }));
  }
  // 切完再核一遍：有些钱包的 switch 会 resolve 但实际没切（用户在钱包里
  // 手动切回去了，或者钱包里没有这条网络却没报错）。
  if (getAccount(wagmiConfig).chainId !== want) {
    throw new ChainRestError(tr(errKey, { want, got: String(getAccount(wagmiConfig).chainId) }));
  }
}

/**
 * 从收据里解 Hyperlane 的 messageId。
 *
 * EVM 交易拿不到函数返回值，messageId 只能从日志里解。没有它，用户手上只有
 * 一个源链 tx hash —— 那个 hash 在目标链上查不到任何东西，而「显示成功但目标链
 * 查不到」正是测试报上来最严重的那个问题的形状。
 *
 * 用 `parseEventLogs` 而不是自己比对 topic0：它会跳过解不开的日志，所以同一笔
 * 交易里其它合约的事件不会让整个解析失败。
 */
function messageIdFrom(logs: readonly unknown[]): string {
  for (const [abi, eventName, field] of [
    [bridgeAdapterAbi, 'BridgeOut', 'messageId'],
    [mailboxAbi, 'DispatchId', 'messageId'],
  ] as const) {
    const parsed = parseEventLogs({ abi, eventName, logs: logs as never });
    const hit = parsed[0]?.args as Record<string, unknown> | undefined;
    const id = hit?.[field];
    if (typeof id === 'string' && /^0x[0-9a-f]{64}$/i.test(id)) return id;
  }
  // 解不出来就给空串，不编一个 —— 上层显示成「暂无」，用户至少不会拿着假 id 去查。
  return '';
}

/**
 * 桥出：Atoshi → Ethereum。
 *
 * 走 bridgeadapter 预编译（0x…0808）。它是 MsgBridgeOut 的 EVM 入口 ——
 * 链上真正执行的是那条 Cosmos 消息，而 EVM 钱包只签 EVM 交易，所以没有这个
 * 预编译的话，这个按钮在钱包里根本没有能调的东西。
 *
 * 和桥入不一样，这边**只有一笔**交易：锁的是原生 ATOS，不是 ERC20，
 * 不需要 approve。
 *
 * 三条会 revert 的前提，都在发交易之前先查掉，因为链上的 revert 只有一句
 * 字符串，在钱包里看不出是哪一条：
 *   1. 钱包必须连在 Atoshi（不是以太坊侧）；
 *   2. 金额必须是 atos_per_erc20 的整数倍 —— 余数在以太坊侧表示不出来，
 *      链上宁可 revert 也不会悄悄吞掉；
 *   3. 金额必须 ≥ min_transfer_out。
 */
async function submitBridgeOut(data: {
  sender: string;
  recipient_eth_address: string;
  amount_atos: number;
}): Promise<{ tx_hash: string; message_id: string; record: BridgeRecord }> {
  const owner = connectedAddress();
  await ensureChain(ATOSHI_CHAIN_ID, 'err.wrong_chain_for_out');

  // 参数现查，不写死：peg 和下限都是治理可改的参数。
  const params = await getBridgeParams();
  if (!params.bridge_enabled) {
    throw new ChainRestError(tr('err.bridge_disabled'));
  }

  // getBridgeParams 返回的是 ATOS 单位，链上的参数是 liao —— 别混。
  const amount = BigInt(atosToLiao(data.amount_atos));

  // 整除判断按 **liao** 算，不是按 ATOS。
  //
  // 链上是 AtosToErc20 的 `liao.Mod(atos_per_erc20)`，所以粒度是 100 liao
  // = 1e-16 ATOS，不是 100 ATOS。按 ATOS 判会把 1,050 这种合法金额拒掉
  // （链上换出 10.5 ERC20，没问题）—— 我最初就写错成这样。
  const peg = BigInt(params.atos_per_erc20);
  if (peg > 0n && amount % peg !== 0n) {
    throw new ChainRestError(tr('err.not_peg_multiple', { peg: params.atos_per_erc20 }));
  }
  if (data.amount_atos < params.min_transfer_out) {
    throw new ChainRestError(tr('err.below_min_out', { min: params.min_transfer_out }));
  }

  const recipient = toHyperlane32Bytes(data.recipient_eth_address);

  const hash = await writeContract(wagmiConfig, {
    account: owner,
    chain: atoshi,
    address: BRIDGE_ADAPTER_PRECOMPILE,
    abi: bridgeAdapterAbi,
    functionName: 'bridgeOut',
    // maxFeeAmount = 0：不设跨链费上限。设了上限而费用涨过它就会 revert，
    // 而用户看到的是一句和金额无关的报错，比多付一点点费更难解释。
    args: [recipient, amount, 0n],
    gas: GAS_LIMITS.bridgeOut,
  });

  const receipt = await waitForTransactionReceipt(wagmiConfig, {
    hash,
    chainId: ATOSHI_CHAIN_ID,
  });
  if (receipt.status !== 'success') {
    throw new ChainRestError(tr('err.bridge_reverted', { tx: hash }));
  }

  // Blockscout can lag a few seconds behind the receipt. Record the successful
  // usage immediately; the next explorer refresh de-duplicates it by tx hash.
  rememberBridgeOut(hash, owner, data.amount_atos);

  const now = Date.now();
  return {
    tx_hash: hash,
    message_id: messageIdFrom(receipt.logs),
    record: {
      id: hash,
      // messageId 必须写进 record 里，不能只放在响应顶层。
      //
      // 到账确认（bridgeStatus.ts）唯一能跨两条链把一笔对应起来的东西就是它：
      // 桥入按 message_id 检索 Atoshi 的 bridge_in 事件，桥出问 Mailbox 的
      // delivered()。record.messageId 是 undefined 的话 confirmDelivery 一律
      // 返回 unknown，状态永远停在「进行中」—— 链上早就成功了，前端还显示
      // 进行中，正是测试反馈的那个问题。
      messageId: messageIdFrom(receipt.logs),
      direction: 'out' as BridgeDirection,
      amount: data.amount_atos,
      receivedAmount: data.amount_atos / Number(params.atos_per_erc20 || 100),
      sender: data.sender || owner,
      recipient: data.recipient_eth_address,
      status: 'dispatched',
      currentStep: 2,
      steps: [
        {
          id: 1,
          nameKey: 'step.out.1.name',
          descKey: 'step.out.1.desc',
          name: '',
          description: '',
          status: 'completed',
          timestamp: now,
          txHash: hash,
        },
        {
          id: 2,
          nameKey: 'step.out.2.name',
          descKey: 'step.out.2.desc',
          name: '',
          description: '',
          status: 'processing',
          timestamp: now,
        },
      ],
      sourceTxHash: hash,
      createdAt: now,
      updatedAt: now,
      estimatedTimeRange: '',
    },
  };
}

/* ─────────────────────────── 桥入 ─────────────────────────── */

/**
 * 桥入：Ethereum → Atoshi。
 *
 * 这条是通的（合约部署之后）—— 它本来就是一笔以太坊交易，EVM 钱包能签。
 *
 * 是**两笔**交易，不是一笔：
 *   1. ERC20.approve(collateral, amount)  让金库能来拉币
 *   2. collateral.transferRemote(...)     发起跨链，msg.value 付跨链 gas
 *
 * 第 2 笔的 msg.value 必须付够 quoteGasPayment，付少了 relayer 不转发，
 * 消息会一直挂着 —— 不是失败，是永远不到账，比失败难查得多。
 */
async function submitBridgeIn(data: {
  sender: string;
  recipient_atoshi_address: string;
  amount_erc20: number;
}): Promise<{ tx_hash: string; message_id: string; record: BridgeRecord }> {
  if (!ETH_CONTRACTS_READY) {
    throw new ChainRestError(
      tr('err.contracts_missing'),
    );
  }

  const owner = connectedAddress();
  await ensureChain(ETH_CHAIN_ID, 'err.wrong_chain_for_in');

  const amount = BigInt(atosToLiao(data.amount_erc20));
  const recipient = toHyperlane32Bytes(data.recipient_atoshi_address);
  const atoshiDomain = Number(import.meta.env.VITE_ATOSHI_CHAIN_ID ?? 88288);

  // 配错 ERC20 地址是个很难查的错：approve 会成功（授权了个无关代币），
  // 然后 transferRemote 在一个看不懂的地方 revert。先交叉验证一下。
  const wrapped = await ethClient().readContract({
    address: COLLATERAL_ADDRESS!,
    abi: tokenRouterAbi,
    functionName: 'wrappedToken',
    ...NO_AUTH_LIST,
  });
  if (wrapped.toLowerCase() !== ERC20_ATOS_ADDRESS!.toLowerCase()) {
    throw new ChainRestError(
      tr('err.token_mismatch', { wrapped, configured: String(ERC20_ATOS_ADDRESS) }),
    );
  }

  // 1. 授权（额度够了就跳过，省用户一笔 gas）
  const allowance = await ethClient().readContract({
    address: ERC20_ATOS_ADDRESS!,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, COLLATERAL_ADDRESS!],
    ...NO_AUTH_LIST,
  });

  if (allowance < amount) {
    const approveHash = await writeContract(wagmiConfig, {
      account: owner,
      chain: ethChain,
      address: ERC20_ATOS_ADDRESS!,
      abi: erc20Abi,
      functionName: 'approve',
      args: [COLLATERAL_ADDRESS!, amount],
      gas: GAS_LIMITS.approve,
    });
    const approveReceipt = await waitForTransactionReceipt(wagmiConfig, {
      hash: approveHash,
      chainId: ETH_CHAIN_ID,
    });
    if (approveReceipt.status !== 'success') {
      throw new ChainRestError(tr('err.approve_reverted', { tx: approveHash }));
    }
  }

  // 2. 发起跨链。gas 报价现查，不写死 —— 它随以太坊 gas price 浮动。
  const gasPayment = await ethClient().readContract({
    address: COLLATERAL_ADDRESS!,
    abi: tokenRouterAbi,
    functionName: 'quoteGasPayment',
    args: [atoshiDomain],
    ...NO_AUTH_LIST,
  });

  const hash = await writeContract(wagmiConfig, {
    account: owner,
    chain: ethChain,
    address: COLLATERAL_ADDRESS!,
    abi: tokenRouterAbi,
    functionName: 'transferRemote',
    args: [atoshiDomain, recipient, amount],
    value: gasPayment,
    gas: GAS_LIMITS.transferRemote,
  });

  const receipt = await waitForTransactionReceipt(wagmiConfig, { hash, chainId: ETH_CHAIN_ID });
  if (receipt.status !== 'success') {
    throw new ChainRestError(tr('err.bridge_reverted', { tx: hash }));
  }

  const now = Date.now();
  return {
    tx_hash: hash,
    // messageId 是 transferRemote 的返回值，但 EVM 交易拿不到返回值 ——
    // 从 Mailbox 的 DispatchId 事件里解。
    message_id: messageIdFrom(receipt.logs),
    record: {
      id: hash,
      // messageId 必须写进 record 里，不能只放在响应顶层。
      //
      // 到账确认（bridgeStatus.ts）唯一能跨两条链把一笔对应起来的东西就是它：
      // 桥入按 message_id 检索 Atoshi 的 bridge_in 事件，桥出问 Mailbox 的
      // delivered()。record.messageId 是 undefined 的话 confirmDelivery 一律
      // 返回 unknown，状态永远停在「进行中」—— 链上早就成功了，前端还显示
      // 进行中，正是测试反馈的那个问题。
      messageId: messageIdFrom(receipt.logs),
      direction: 'in' as BridgeDirection,
      amount: data.amount_erc20,
      receivedAmount: data.amount_erc20 * 100, // peg: 1 ERC20 = 100 ATOS
      sender: owner,
      recipient: data.recipient_atoshi_address,
      status: 'dispatched',
      currentStep: 2,
      steps: [
        {
          id: 1,
          nameKey: 'step.in.1.name',
          descKey: 'step.in.1.desc',
          name: '',
          description: '',
          status: 'completed',
          timestamp: now,
          txHash: hash,
        },
        {
          id: 2,
          nameKey: 'step.in.2.name',
          descKey: 'step.in.2.desc',
          name: '',
          description: '',
          status: 'processing',
          timestamp: now,
        },
      ],
      sourceTxHash: hash,
      createdAt: now,
      updatedAt: now,
      estimatedTimeRange: '',
    },
  };
}

/* ─────────────────────── 历史与状态（无查询） ─────────────────────── */

/**
 * 链上没有「某地址的跨链记录」这个查询。
 *
 * bridgeadapter 的 query.proto 只有 params 和 receipt_state，而 receipt_state
 * 是 tier 释放通道的回执状态，不是资产桥的转账记录 —— 两个不是一回事，
 * 不要拿它去顶。
 *
 * 正确做法是后端做一个索引服务，订阅两条链的事件（Atoshi 侧的 bridge_out 事件 +
 * 以太坊侧的 Mailbox Dispatch/Process 事件）拼成记录，前端读一个稳定接口。
 * 跨链记录天然需要两条链的数据，前端做不了。
 */
async function getBridgeHistory(
  _address?: string,
  _direction?: BridgeDirection,
  _cursor?: string,
): Promise<{ list: BridgeRecord[]; nextCursor?: string; total: number }> {
  return { list: [], nextCursor: undefined, total: 0 };
}

async function getBridgeStatus(_messageId: string): Promise<BridgeRecord | null> {
  return null;
}

async function retryBridgeIn(_recordId: string): Promise<boolean> {
  throw new ChainRestError(tr('err.retry_unavailable'));
}

/* ─────────────────────────── 导出 ─────────────────────────── */

export const bridgeServiceChain = {
  getBridgeParams,
  getBridgeLimits,
  getUserBalanceAtos,
  getUserBalanceErc20,
  submitBridgeOut,
  submitBridgeIn,
  getBridgeHistory,
  getBridgeStatus,
  retryBridgeIn,
  getNextResetTimestamp: nextResetTimestamp,

  // 地址簿存在 localStorage，跟链无关，直接复用 mock 那份实现
  getAddressBook: (): AddressBookItem[] => bridgeServiceMock.getAddressBook(),
  addAddressBookItem: (label: string, address: string, network: 'ethereum' | 'atoshi') =>
    bridgeServiceMock.addAddressBookItem(label, address, network),
};
