/**
 * Atoshi 侧的 Cosmos REST 客户端。
 *
 * ⚠️ 要的是 Cosmos REST API（节点 app.toml 的 [api]，默认 1317），
 * 不是 EVM JSON-RPC（8545），也不是 CometBFT RPC（26657）。
 * bridgeadapter 的参数、migration_pool 余额都在 Cosmos 模块里，
 * EVM JSON-RPC 一个都查不到。
 *
 * 测试网的 REST 挂在 /rest-api/ 子路径下反代，不是独立域名。
 */

export const DECIMALS_18 = 1000000000000000000n;

export const BOND_DENOM = (import.meta.env.VITE_BOND_DENOM as string) || 'liao';

export const REST_BASE = ((import.meta.env.VITE_REST_URL as string) || '').replace(/\/+$/, '');

export class ChainRestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'ChainRestError';
  }
}

/** 超时用 AbortController —— 浏览器 fetch 默认没有超时，节点无响应时页面会一直转圈。 */
export async function restGet<T>(path: string, timeoutMs = 12000): Promise<T> {
  if (!REST_BASE) {
    throw new ChainRestError(
      '未配置 VITE_REST_URL。桥的链上参数需要节点的 Cosmos REST 端点（app.toml 的 [api]，默认 1317）。',
      undefined,
      path,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${REST_BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.message || body?.error || '';
      } catch {
        /* body 不是 JSON，用状态码就行 */
      }
      throw new ChainRestError(detail || `请求失败 (HTTP ${res.status})`, res.status, path);
    }

    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof ChainRestError) throw e;
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ChainRestError(`请求超时 (${timeoutMs}ms)`, undefined, path);
    }
    // 跨域被拦、DNS 失败、节点没起来，在 fetch 里都是同一个 TypeError，分不出来
    throw new ChainRestError(
      '连不上节点。检查 VITE_REST_URL 是否可达、节点 [api] 是否开启、是否允许跨域。',
      undefined,
      path,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** 取 coins 数组里指定 denom 的数量，缺失返回 "0"。 */
export function amountOf(
  coins: Array<{ denom: string; amount: string }> | undefined | null,
  denom: string,
): string {
  if (!coins) return '0';
  return coins.find((c) => c.denom === denom)?.amount ?? '0';
}

/* ─────────────────────── 单位换算 ─────────────────────── */

/**
 * liao（最小单位，字符串）→ ATOS（展示单位，number）。
 *
 * 这个方向用 number 是安全的：除以 10^18 之后最大值是 3000 亿（3e11），
 * 远在 Number 的精确范围（2^53 ≈ 9e15）之内。实测 Number(liao)/1e18 和
 * BigInt 路径结果完全一致，这里用 BigInt 只是为了不依赖那个巧合。
 *
 * **真正不能用浮点的是另外两处**，都在下面和 bridgeValidation 里：
 *   1. atosToLiao —— 交易金额必须精确到 liao，浮点乘 1e18 会引入误差
 *   2. 整除判断 —— 桥要求金额是 100 ATOS 的整数倍（peg），
 *      余数会在以太坊侧被静默吞掉，这个判断必须整数运算
 */
export function liaoToAtos(liao: string | undefined): number {
  if (!liao) return 0;
  try {
    const v = BigInt(liao);
    const whole = v / DECIMALS_18;
    // 保留 6 位小数就够展示了，桥的最小单笔是 1000 ATOS
    const frac = ((v % DECIMALS_18) * 1000000n) / DECIMALS_18;
    return Number(whole) + Number(frac) / 1000000;
  } catch {
    return 0;
  }
}

/** ATOS（展示单位）→ liao（最小单位，字符串）。 */
export function atosToLiao(atos: number): string {
  // 不用 BigInt(atos * 1e18) —— 浮点乘 1e18 会引入误差。
  // 拆成整数和小数两段，小数最多取 18 位。
  const s = atos.toFixed(18);
  const [whole, frac = ''] = s.split('.');
  const padded = (frac + '0'.repeat(18)).slice(0, 18);
  return (BigInt(whole) * DECIMALS_18 + BigInt(padded || '0')).toString();
}
