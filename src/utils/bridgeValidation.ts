import { BridgeErrorCode, BridgeLimits, BridgeParams } from '../types';

/**
 * 校验以太坊地址合法性 (0x 开头 42 位 hex，非全零地址，不包含 ENS)
 */
export function isValidEthereumAddress(address: string): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  const ethRegex = /^0x[a-fA-F0-9]{40}$/;
  if (!ethRegex.test(trimmed)) return false;
  // 排除全零地址
  if (trimmed.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    return false;
  }
  return true;
}

/**
 * 转换为链上所需的 32 字节 Hex 格式（左侧补 12 个零字节 = 24 个十六进制 0）
 * 例如 0x1234...5678 (42位) -> 0x0000000000000000000000001234...5678 (66位)
 */
export function formatEthAddressTo32Bytes(ethAddress: string): string {
  if (!isValidEthereumAddress(ethAddress)) return '';
  const cleanHex = ethAddress.trim().slice(2); // 去除 '0x'
  const padded = cleanHex.padStart(64, '0');
  return `0x${padded}`;
}

/**
 * 校验 Atoshi 地址合法性 (bech32 格式，以 atoshi1 开头)
 */
export function isValidAtoshiAddress(address: string): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  // Atoshi bech32 格式：atoshi1 开头后接 38~59 字符
  const atoshiRegex = /^atoshi1[a-z0-9]{38,59}$/;
  return atoshiRegex.test(trimmed);
}

/**
 * 错误码多语言解释转换器
 */
export function getErrorMessage(code: BridgeErrorCode | string, lang: 'en' | 'zh' = 'en'): string {
  if (lang === 'zh') {
    switch (code) {
      case 'below_minimum':
        return '单笔转账金额低于最低限额（1,000 ATOS），无法支付跨链信使开销。';
      case 'crisis_mode':
        return '当前流动性处于紧张状态，大额通道已临时锁定，仅受理 ≤100,000 ATOS 的小额转账。';
      case 'daily_cap_reached':
        return '全网今日跨链总额度已耗尽，请等待每日 00:00 重置后再试。';
      case 'large_quota_reached':
        return '今日大额共享配额已用尽。建议修改为 ≤100,000 ATOS 的小额转账，享受专属配额直接通过。';
      case 'address_cap_reached':
        return '已达到当前地址单日转账上限（全网每日额度的 2%），请明日重置后再试。';
      case 'indivisible_amount':
        return '转账金额必须是 100 的整数倍（因 100 ATOS : 1 ERC20 锚定规则，余数无法精确表示）。';
      case 'bridge_disabled':
        return '跨链桥系统正在例行维护中，跨链通道暂未开启。';
      case 'pool_insufficient':
        return 'Atoshi 链上资金池流动性不足，交易将进入安全排队等待流动性补充。';
      case 'invalid_address':
        return '输入的收款地址格式不正确，请仔细核对。';
      case 'insufficient_balance':
        return '钱包余额不足以支付当前转账金额。';
      case 'unconfirmed_disclaimer':
        return '请勾选确认收款地址所有权声明。';
      default:
        return '跨链请求处理失败，请稍后重试或联系客服协助。';
    }
  }

  // English (Default)
  switch (code) {
    case 'below_minimum':
      return 'Transfer amount is below the single transfer minimum (1,000 ATOS) required for cross-chain message fees.';
    case 'crisis_mode':
      return 'Liquidity crisis mode is active. Large transfers are locked; only ≤ 100,000 ATOS transfers are accepted.';
    case 'daily_cap_reached':
      return 'Global daily cross-chain quota has been exhausted. Please wait for 00:00 UTC daily reset.';
    case 'large_quota_reached':
      return 'Today’s large transfer quota is exhausted. Change to ≤ 100,000 ATOS to use the reserved small quota immediately.';
    case 'address_cap_reached':
      return 'Reached your personal daily cap (2% of global daily quota). Please try again after tomorrow’s reset.';
    case 'indivisible_amount':
      return 'Amount must be a multiple of 100 (100 ATOS : 1 ERC20 fixed peg; fractions cannot be represented).';
    case 'bridge_disabled':
      return 'Bridge system is under routine maintenance. Cross-chain channels are temporarily paused.';
    case 'pool_insufficient':
      return 'Atoshi on-chain pool liquidity is low. Transaction will enter a safe queue awaiting replenishment.';
    case 'invalid_address':
      return 'Invalid recipient address format. Please double-check.';
    case 'insufficient_balance':
      return 'Insufficient wallet balance for this transfer.';
    case 'unconfirmed_disclaimer':
      return 'Please accept the address ownership confirmation disclaimer.';
    default:
      return 'Cross-chain request failed. Please try again later or contact support.';
  }
}

/**
 * 获取就近的 100 整数倍合法值（向上和向下）
 */
export function getNearest100Multiples(amount: number): { lower: number; upper: number } {
  if (isNaN(amount) || amount <= 0) return { lower: 1000, upper: 1100 };
  const lower = Math.floor(amount / 100) * 100;
  const upper = Math.ceil(amount / 100) * 100;
  return {
    lower: Math.max(1000, lower),
    upper: upper === lower ? lower + 100 : upper,
  };
}

export interface AmountValidationResult {
  isValid: boolean;
  errorCode?: BridgeErrorCode;
  errorMessage?: string;
  suggestedAmount?: number;
  highlightTier?: 'single_min' | 'crisis' | 'global_cap' | 'large_quota' | 'address_cap' | 'indivisible' | 'balance';
  isLargeTransfer: boolean;
}

/**
 * 核心五层限流与金额实时校验（在用户提交前精准判定是哪一层拦截）
 */
export function validateBridgeOutAmount(
  amount: number,
  balance: number,
  limits: BridgeLimits,
  params: BridgeParams,
  lang: 'en' | 'zh' = 'en'
): AmountValidationResult {
  if (!amount || isNaN(amount) || amount <= 0) {
    return {
      isValid: false,
      isLargeTransfer: false,
    };
  }

  const isLargeTransfer = amount > params.small_transfer_threshold;

  // 1. 余额检查
  if (amount > balance) {
    return {
      isValid: false,
      errorCode: 'insufficient_balance',
      errorMessage: lang === 'zh'
        ? `钱包余额不足（当前可用：${balance.toLocaleString()} ATOS）`
        : `Insufficient balance (Available: ${balance.toLocaleString()} ATOS)`,
      highlightTier: 'balance',
      isLargeTransfer,
    };
  }

  // 2. 单笔下限（1,000 ATOS）
  if (amount < params.min_transfer_out) {
    return {
      isValid: false,
      errorCode: 'below_minimum',
      errorMessage: lang === 'zh'
        ? `低于单笔最低限额（${params.min_transfer_out.toLocaleString()} ATOS）`
        : `Below minimum single transfer limit (${params.min_transfer_out.toLocaleString()} ATOS)`,
      suggestedAmount: params.min_transfer_out,
      highlightTier: 'single_min',
      isLargeTransfer: false,
    };
  }

  // 3. 100 的整数倍硬性格式要求
  if (amount % 100 !== 0) {
    const { lower, upper } = getNearest100Multiples(amount);
    return {
      isValid: false,
      errorCode: 'indivisible_amount',
      errorMessage: lang === 'zh'
        ? `金额需为 100 的整数倍，建议改为 ${lower.toLocaleString()} 或 ${upper.toLocaleString()}`
        : `Must be multiple of 100. Suggested: ${lower.toLocaleString()} or ${upper.toLocaleString()}`,
      suggestedAmount: lower <= limits.max_transferable ? lower : upper,
      highlightTier: 'indivisible',
      isLargeTransfer,
    };
  }

  // 4. 危机模式（池子 < 10%，只允许小额 ≤ 100,000 ATOS）
  if (limits.crisis_mode && isLargeTransfer) {
    return {
      isValid: false,
      errorCode: 'crisis_mode',
      errorMessage: lang === 'zh'
        ? `流动性紧张模式下大额已暂停，改为 ≤${params.small_transfer_threshold.toLocaleString()} ATOS 可立即通过`
        : `Large transfers paused in crisis mode. Change to ≤${params.small_transfer_threshold.toLocaleString()} ATOS to pass`,
      suggestedAmount: params.small_transfer_threshold,
      highlightTier: 'crisis',
      isLargeTransfer: true,
    };
  }

  // 5. 单地址日上限 (全局额度的 2%)
  if (amount > limits.address_remaining) {
    return {
      isValid: false,
      errorCode: 'address_cap_reached',
      errorMessage: lang === 'zh'
        ? `超出你今日个人剩余额度（剩余 ${limits.address_remaining.toLocaleString()} ATOS）`
        : `Exceeds your personal daily quota (Remaining: ${limits.address_remaining.toLocaleString()} ATOS)`,
      suggestedAmount: Math.floor(limits.address_remaining / 100) * 100,
      highlightTier: 'address_cap',
      isLargeTransfer,
    };
  }

  // 6. 大额预留配额（大额只能用掉全局 80% 共享配额）
  if (isLargeTransfer && amount > limits.large_remaining) {
    return {
      isValid: false,
      errorCode: 'large_quota_reached',
      errorMessage: lang === 'zh'
        ? `超出今日大额可用配额，改为 ≤${params.small_transfer_threshold.toLocaleString()} ATOS 可享小额专属配额立即通过`
        : `Exceeds large quota. Change to ≤${params.small_transfer_threshold.toLocaleString()} ATOS to use reserved quota`,
      suggestedAmount: params.small_transfer_threshold,
      highlightTier: 'large_quota',
      isLargeTransfer: true,
    };
  }

  // 7. 全局日上限
  if (amount > limits.global_remaining) {
    return {
      isValid: false,
      errorCode: 'daily_cap_reached',
      errorMessage: lang === 'zh'
        ? `超出全网今日总剩余额度（剩余 ${limits.global_remaining.toLocaleString()} ATOS）`
        : `Exceeds global daily quota (Remaining: ${limits.global_remaining.toLocaleString()} ATOS)`,
      suggestedAmount: Math.floor(limits.global_remaining / 100) * 100,
      highlightTier: 'global_cap',
      isLargeTransfer,
    };
  }

  return {
    isValid: true,
    isLargeTransfer,
  };
}

/**
 * 格式化数字为千分位
 */
export function formatNumber(num: number, decimals: number = 0): string {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 缩写哈希/地址
 */
export function shortenAddress(addr: string, startChars: number = 6, endChars: number = 4): string {
  if (!addr) return '';
  if (addr.length <= startChars + endChars) return addr;
  return `${addr.slice(0, startChars)}...${addr.slice(-endChars)}`;
}
