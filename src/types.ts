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
  max_transferable: number; // 用户当前最多可转金额（五层取最小值，已向下取整至 100 的倍数）
  global_remaining: number; // 全网今日剩余额度
  global_total: number; // 全网今日总额度
  large_remaining: number; // 大额可用剩余配额 (80% 共享池剩余)
  large_total: number; // 大额总配额 (80% 共享上限)
  address_remaining: number; // 当前地址今日剩余额度 (2%)
  address_total: number; // 当前地址今日总额度
  crisis_mode: boolean; // 是否处于危机模式（流动性 < 10%）
  resets_at: number; // 今日额度重置时间戳 (ms)
}

export type BridgeDirection = 'out' | 'in';

export type TxStepStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'waiting_liquidity';

export interface TxStep {
  id: number;
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
  | 'indivisible_amount'
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
