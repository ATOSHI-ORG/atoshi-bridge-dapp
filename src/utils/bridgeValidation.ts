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
 * 校验 Atoshi 收款地址。**0x 和 atoshi1 两种都算合法。**
 *
 * Atoshi 是 Ethermint 系的链，一个账户同时有这两种表示，指的是同一个账户 ——
 * 底层就是同一个 20 字节。而链上收款时（asset_bridge.go 的
 * CosmosAddressFromHyperlane）取的是 Hyperlane 32 字节里的低 20 字节，
 * 所以 0x 地址左侧补零之后和 bech32 解出来的字节完全一致。
 *
 * 只收 bech32 是没必要的限制：用户从 MetaMask 过来，手上有的是 0x 地址，
 * 让他自己去找 bech32 形式是凭空加一步。实测三笔桥入用的都是 0x 形式，
 * 钱都正常落到对应的 atoshi1 账户上。
 *
 * 大小写不校验 EIP-55 校验和：字节相同就是同一个账户，而 MetaMask 给的是
 * 带校验和的混合大小写，用户手抄可能全小写 —— 拒掉纯粹是添麻烦。
 */
export function isValidAtoshiAddress(address: string): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return true;
  // bech32：atoshi1 开头后接 38~59 字符
  return /^atoshi1[a-z0-9]{38,59}$/.test(trimmed);
}

/**
 * 建议金额取整到整数 ATOS。
 *
 * 以前这里取整到 100 的整数倍，因为当时以为链上要求金额是 100 ATOS 的整数倍。
 * 不是 —— 见下面 validateAmount 里那条被删掉的规则。整数 ATOS 只是为了让
 * 建议值好看，不是合法性要求。
 */
function floorToAtos(amount: number): number {
  if (isNaN(amount) || amount <= 0) return 0;
  return Math.floor(amount);
}

export interface AmountValidationResult {
  isValid: boolean;
  errorCode?: BridgeErrorCode;
  errorMessage?: string;
  suggestedAmount?: number;
  highlightTier?: 'single_min' | 'crisis' | 'global_cap' | 'large_quota' | 'address_cap' | 'balance';
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

  // 3. 曾经这里有一条「金额必须是 100 ATOS 的整数倍」。**链上没有这条要求。**
  //
  // 链上是 x/bridgeadapter/types/ratelimit.go 的 AtosToErc20，它检查的是
  //   liao % atos_per_erc20 == 0        （liao，不是 ATOS）
  // atos_per_erc20 是 100，而 1 ATOS = 1e18 liao，所以真实粒度是 100 liao
  // = 1e-16 ATOS —— 前端这种十进制输入框根本碰不到。
  //
  // 之前那条规则把 1,050 ATOS 这种完全合法的金额也拒了（链上换出 10.5 ERC20，
  // 没有任何问题）。删掉而不是改成 1e-16：写一条永远不会触发的规则只会让人
  // 以后又去猜它是干什么的。真要有余数，链上会 revert，服务层也会先拦（见
  // bridgeApiChain.ts 里按 liao 判的那一条）。

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
      suggestedAmount: floorToAtos(limits.address_remaining),
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
      suggestedAmount: floorToAtos(limits.global_remaining),
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

/**
 * Whether the quota panel has anything to say.
 *
 * Lives here rather than inside QuotaPanel because the panel occupies a fixed
 * 340px column in BridgeOutView's desktop grid. A component that hides itself
 * leaves that column standing and the form sitting off-centre next to an empty
 * strip -- the layout has to collapse in the same breath, and only the parent
 * that owns the grid can do that.
 *
 * Null limits means they have not loaded yet: show the panel, which renders its
 * own loading state, rather than flashing a one-column layout and then jumping.
 */
export function shouldShowQuota(limits: { rate_limits_disabled: boolean } | null): boolean {
  return limits === null || !limits.rate_limits_disabled;
}
