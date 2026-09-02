/**
 * 桥的真链实现。
 *
 * 先说清楚现在能做到什么、做不到什么 —— 桥和质押页的处境完全不同，
 * 质押是「全部接通」，桥是「一半接不通」，而且卡点不在前端。
 *
 * ┌─────────────────┬──────────────────────────────────────────────────────┐
 * │ 桥参数           │ ✅ REST /atoshi/bridgeadapter/v1/params               │
 * │ migration_pool  │ ✅ module_accounts + bank balances                   │
 * │ 五层限流的「上限」 │ ✅ 前端照搬链上 ResolveLimits 算，逐条对过 Go 源码       │
 * │ 五层限流的「已用」 │ ❌ 链上有数据，但 query.proto 没暴露查询                │
 * │ ATOS 余额        │ ✅ bank balances                                     │
 * │ ERC20 余额       │ ⚠️ 以太坊合约调用，合约未部署                          │
 * │ 桥入 (ETH→Atoshi)│ ⚠️ 是以太坊交易，钱包能签，合约未部署                   │
 * │ 桥出 (Atoshi→ETH)│ ❌ MsgBridgeOut 是 Cosmos 消息，无预编译，钱包签不了     │
 * │ 交易历史 / 状态   │ ❌ 无查询接口                                        │
 * └─────────────────┴──────────────────────────────────────────────────────┘
 *
 * 「桥出签不了」这条是硬阻塞，和质押页形成对比：质押能用 EVM 钱包是因为链上开了
 * staking 预编译（0x…0800），桥出没有对应的预编译，而 Atoshi 钱包的原生层只实现了
 * eth_* / wallet_* 方法，没有 Cosmos 签名能力。两条出路都在链侧/钱包侧，见 README。
 *
 * 做不到的方法一律抛出说明缺什么的错误，不返回假的 tx_hash —— 假成功比失败危险，
 * 用户会以为钱已经在路上了。
 */

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

import { ETH_CHAIN_ID, ethChain, toHyperlane32Bytes } from '../wallet/chains';
import { wagmiConfig } from '../wallet/config';
import {
  COLLATERAL_ADDRESS,
  ERC20_ATOS_ADDRESS,
  ETH_CONTRACTS_READY,
  GAS_LIMITS,
  erc20Abi,
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
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions';

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
    throw new ChainRestError(`拿不到 chain id ${ETH_CHAIN_ID} 的 RPC client，检查 wagmi 配置。`);
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
    throw new ChainRestError('链上找不到 migration_pool 模块账户，无法读取桥的流动性。');
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
    // 拿不到已用量，所以「最多可转」只能按上限给。UI 依据 usage_available
    // 标明这一点，不要让用户以为这是精确值。
    max_transferable: Math.floor(Math.min(global, perAddress) / p.atos_per_erc20) * p.atos_per_erc20,
    global_remaining: global,
    global_total: global,
    large_remaining: largeBudget,
    large_total: largeBudget,
    address_remaining: perAddress,
    address_total: perAddress,
    crisis_mode: crisis,
  };
}

/** 今日额度重置时间：链上按 UTC 日切。 */
function nextResetTimestamp(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
}

async function getBridgeLimits(_address?: string): Promise<BridgeLimits> {
  const params = await getBridgeParams();
  return {
    ...resolveLimits(params),
    resets_at: nextResetTimestamp(),
    // 链上没有暴露已用量的查询接口，见文件头的表格
    usage_available: false,
  };
}

/* ─────────────────────────── 余额 ─────────────────────────── */

function connectedAddress(): `0x${string}` {
  const { address, isConnected } = getAccount(wagmiConfig);
  if (!isConnected || !address) {
    throw new ChainRestError('请先连接钱包。');
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

/* ─────────────────────────── 桥出（阻塞） ─────────────────────────── */

/**
 * 桥出：Atoshi → Ethereum。
 *
 * 现在做不了，原因很具体：链上的 MsgBridgeOut 是一条 Cosmos 消息，而
 *  - 链上没有 bridgeadapter 的 EVM 预编译（有的只有 staking/distribution/bank
 *    /gov/ics20 那几个官方的），所以它变不成一笔以太坊交易；
 *  - Atoshi 钱包原生层只实现了 eth_* / wallet_* 方法，没有 Cosmos 签名能力。
 *
 * 两条出路都不在前端，见 README「桥出为什么还不能用」。
 *
 * 抛错而不是返回假的 tx_hash：桥出涉及真金白银，假成功会让用户以为钱在路上，
 * 然后去等一笔根本不存在的到账。
 */
async function submitBridgeOut(_data: {
  sender: string;
  recipient_eth_address: string;
  amount_atos: number;
}): Promise<never> {
  throw new ChainRestError(
    '桥出功能尚未开通。链上的 MsgBridgeOut 是 Cosmos 消息，' +
      '需要链侧提供 bridgeadapter 预编译、或钱包支持 Cosmos 交易签名，' +
      '两者目前都没有。桥入不受影响。',
  );
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
      '以太坊侧合约还未部署。需要配置 VITE_ERC20_ATOS_ADDRESS 和 ' +
        'VITE_COLLATERAL_ADDRESS（Hyperlane HypERC20Collateral 的地址）。',
    );
  }

  const owner = connectedAddress();
  const { chainId } = getAccount(wagmiConfig);
  if (chainId !== ETH_CHAIN_ID) {
    throw new ChainRestError(
      `桥入需要钱包连在以太坊侧（chain id ${ETH_CHAIN_ID}），当前是 ${chainId}。请先切链。`,
    );
  }

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
      `配置不一致：金库锁的是 ${wrapped}，但 VITE_ERC20_ATOS_ADDRESS 配的是 ${ERC20_ATOS_ADDRESS}。`,
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
      throw new ChainRestError(`授权交易失败（reverted），tx: ${approveHash}`);
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
    throw new ChainRestError(`跨链交易已上链但执行失败（reverted），tx: ${hash}`);
  }

  const now = Date.now();
  return {
    tx_hash: hash,
    // messageId 是 transferRemote 的返回值，但 EVM 交易拿不到返回值 ——
    // 要从 Hyperlane Mailbox 的 Dispatch 事件里解。等有了合约地址再补，
    // 现在给空字符串而不是编一个假的。
    message_id: '',
    record: {
      id: hash,
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
          name: '以太坊已确认',
          description: 'ERC20 已锁入金库',
          status: 'completed',
          timestamp: now,
          txHash: hash,
        },
        {
          id: 2,
          name: '等待跨链消息投递',
          description: 'Hyperlane relayer 转发中',
          status: 'processing',
          timestamp: now,
        },
      ],
      sourceTxHash: hash,
      createdAt: now,
      updatedAt: now,
      estimatedTimeRange: '1–5 分钟',
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
  throw new ChainRestError('重试需要后端索引服务支持，目前不可用。');
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
