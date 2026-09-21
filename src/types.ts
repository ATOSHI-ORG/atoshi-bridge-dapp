/**
 * Atoshi Cross-Chain Bridge Types & Schemas
 */

export interface BridgeParams {
  atos_per_erc20: number; // 固定 100: 100 ATOS = 1 ERC20 ATOS
  min_transfer_out: number; // 单笔下限 1,000 ATOS
  global_daily_cap: number; // 全局日上限（如 5e27 或 50,000,000 ATOS）
  global_daily_cap_bps_of_pool: number; // migration_pool * 5% (500 bps)
  per_address_daily_bps: number; // 全局额度的 2% (200 bps)
  small_transfer_threshold: number; // 100,000 ATOS (小额阈值)
  small_quota_bps: number; // 20% 专属小额配额 (2000 bps)
  crisis_pool_bps: number; // 10% 危机池阈值 (1000 bps)
  bridge_enabled: boolean; // 跨链开关
  ethereum_domain: number; // Hyperlane Ethereum Domain ID (e.g. 1 / 11155111)
  migration_pool_balance: number; // 当前 Atoshi migration_pool 余额
  migration_pool_total: number; // Atoshi migration_pool 总量
}

export interface BridgeLimits {
  max_transferable: number; // 用户当前最多可转金额（综合全局、个人、小额/大额通道后向下取整至整数 ATOS）
  global_remaining: number; // 全网今日剩余额度
  global_total: number; // 全网今日总额度
  large_remaining: number; // 大额可用剩余配额 (80% 共享池剩余)
  large_total: number; // 大额总配额 (80% 共享上限)
  address_remaining: number; // 当前地址今日剩余额度 (2%)
  address_total: number; // 当前地址今日总额度
  crisis_mode: boolean; // 是否处于危机模式（流动性 < 10%）
  resets_at: number; // 今日额度重置时间戳 (ms)

  inbound_cap: number; // 桥入每日上限（0 = 未配置，不限）
  inbound_remaining: number; // 桥入今日剩余

  /**
   * 链上把限流整个关掉了（bridgeadapter 的 rate_limits_disabled）。
   *
   * 关掉之后上面那些 cap / remaining 仍然会返回真实数字 —— 它们是「如果开着
   * 会是多少」，参数原样留在链上没被删。所以**画额度条之前必须先看这个**，
   * 否则会告诉用户「今日剩余 29.99 亿」，而根本没有人在执行这个限制。
   */
  rate_limits_disabled: boolean;

  /**
   * 「今日已用量」这几个 remaining 字段是不是真实数据。
   *
   * 现在链上直接给：/atoshi/bridgeadapter/v1/limits 返回的是 keeper 里的真实
   * 计数器。以前 query.proto 没导出这些字段，DApp 只能从 Blockscout 的 BridgeOut
   * 日志重建当日用量 —— 要翻页、要缓存、浏览器挂了就降级，而且只看得到出站。
   *
   * 保留这个标志是因为链的 REST 仍可能不通。false 时 UI 必须标明「已用量未知」，
   * 不能让用户以为额度是满的 —— 他会按满额填金额，然后在链上被限流拒掉，还看不出
   * 为什么。
   */
  usage_available: boolean;
}

export type BridgeDirection = 'out' | 'in';

export type TxStepStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'waiting_liquidity';

export interface TxStep {
  id: number;
  /**
   * 步骤文案。
   *
   * nameKey / descKey 是 i18n 键，有就优先用 —— 真链模式发的是键，所以切换
   * 语言时进度条会跟着变。name / description 是已经成文的字符串，mock 模式
   * 用它（mock 的文案带具体金额，不值得为演示数据做参数化）。
   *
   * 原来两边都只发成文的中文，于是这一段无论切成英文都是中文。
   */
  nameKey?: string;
  descKey?: string;
  name: string;
  description: string;
  status: TxStepStatus;
  timestamp?: number;
  txHash?: string;
  explorerUrl?: string;
  messageId?: string;
}

export interface BridgeRecord {
  id: string;
  direction: BridgeDirection;
  amount: number; // 桥出为 ATOS，桥入为 ERC20 ATOS
  receivedAmount: number; // 桥出为 ERC20 ATOS，桥入为 ATOS
  sender: string;
  recipient: string;
  recipientFormatted32b?: string;
  status: 'submitted' | 'locked' | 'dispatched' | 'completed' | 'waiting_liquidity' | 'failed';
  currentStep: number; // 1 ~ 4
  steps: TxStep[];
  messageId?: string;
  sourceTxHash?: string;
  destTxHash?: string;
  createdAt: number;
  updatedAt: number;
  estimatedTimeRange: string; // "1–5 分钟"
  failureReason?: string;
  errorCode?: string;
}

export type BridgeErrorCode =
  | 'below_minimum'
  | 'crisis_mode'
  | 'daily_cap_reached'
  | 'large_quota_reached'
  | 'address_cap_reached'
  | 'bridge_disabled'
  | 'pool_insufficient'
  | 'invalid_address'
  | 'insufficient_balance'
  | 'unconfirmed_disclaimer';

export interface AddressBookItem {
  id: string;
  label: string;
  address: string;
  network: 'ethereum' | 'atoshi';
  lastUsedAt?: number;
}
