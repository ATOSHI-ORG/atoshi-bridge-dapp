/**
 * 桥要同时连两条链，这是它和质押页最大的结构差别。
 *
 *   桥出 Atoshi → Ethereum：交易发在 Atoshi 链上
 *   桥入 Ethereum → Atoshi：交易发在 Ethereum（测试网是 Sepolia）上
 *
 * 所以钱包必须能切链，UI 上每个方向都要先确认钱包在对的链上再让用户签。
 * 签错链的后果不是失败而是「发到另一条链上的一笔无意义交易」，钱照样花掉。
 */

import { tr } from '../i18n';

import { bech32 } from 'bech32';
import { defineChain } from 'viem';
import { sepolia, mainnet } from 'viem/chains';

export const BECH32_PREFIX = 'atoshi';

export const ATOSHI_CHAIN_ID = Number(import.meta.env.VITE_ATOSHI_CHAIN_ID ?? 88288);

/**
 * 以太坊侧用哪条链。
 *
 * 必须和链上 bridgeadapter 参数里的 ethereum_domain 一致 —— Hyperlane 的
 * domain id 约定就是 chain id，两边不一致的话消息会被目标链的 ISM 拒掉。
 * 测试网应该是 11155111（Sepolia），主网是 1。
 */
export const ETH_CHAIN_ID = Number(import.meta.env.VITE_ETH_CHAIN_ID ?? sepolia.id);

const ATOSHI_RPC = (
  (import.meta.env.VITE_ATOSHI_EVM_RPC as string) || 'https://rpc-testnet.atoshi.org'
).replace(/\/+$/, '');

export const ATOSHI_EXPLORER = (
  (import.meta.env.VITE_ATOSHI_EXPLORER as string) || 'https://explorer-testnet.atoshi.org'
).replace(/\/+$/, '');

export const ATOSHI_EXPLORER_API = (
  (import.meta.env.VITE_ATOSHI_EXPLORER_API as string) || `${ATOSHI_EXPLORER}/api/v2`
).replace(/\/+$/, '');

export const atoshi = defineChain({
  id: ATOSHI_CHAIN_ID,
  name: 'Atoshi',
  // 链上最小单位叫 liao（1 ATOS = 10^18 liao），名字取自项目方指定，不要改
  nativeCurrency: { name: 'ATOS', symbol: 'ATOS', decimals: 18 },
  rpcUrls: { default: { http: [ATOSHI_RPC] } },
  blockExplorers: {
    default: {
      name: 'Atoshi Explorer',
      url: ATOSHI_EXPLORER,
    },
  },
  testnet: ATOSHI_CHAIN_ID !== 88888,
});

export const ethChain = ETH_CHAIN_ID === mainnet.id ? mainnet : sepolia;

/* ───────────────────────── 地址换算 ───────────────────────── */

/**
 * Atoshi 是 Ethermint 系的链，一个账户同时有 0x 和 atoshi1 两种表示，
 * 同一个私钥派生，可以纯前端互转。
 *
 * 桥这边比质押多一层：Hyperlane 的收款地址是 **32 字节**，
 * 20 字节的 EVM 地址要左侧补 12 个零字节。补错位置（右侧补零）是
 * 一个很常见的错，结果是钱转给一个不存在的地址，不可逆。
 */
export function hexToBech32(hex: string, prefix = BECH32_PREFIX): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{40}$/.test(clean)) {
    throw new Error(tr('err.bad_evm_addr', { addr: hex }));
  }
  const bytes = new Uint8Array(20);
  for (let i = 0; i < 20; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bech32.encode(prefix, bech32.toWords(bytes));
}

export function bech32ToHex(addr: string): `0x${string}` {
  const { words } = bech32.decode(addr);
  const bytes = bech32.fromWords(words);
  if (bytes.length !== 20) {
    throw new Error(tr('err.bad_addr_len', { got: bytes.length, addr }));
  }
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`;
}

/**
 * 任意地址 → Hyperlane 的 32 字节表示。
 *
 * 20 字节地址**左侧**补零到 32 字节（高位补零，即 uint256 的自然表示）。
 * 这跟 abi.encode(address) 的结果一致，可以用 cast 交叉验证：
 *   cast abi-encode 'f(address)' 0x71C8...31Eb
 */
export function toHyperlane32Bytes(addr: string): `0x${string}` {
  const hex = addr.startsWith('0x') ? addr : bech32ToHex(addr);
  const clean = hex.slice(2).toLowerCase();
  if (clean.length === 64) return `0x${clean}` as `0x${string}`;
  if (clean.length !== 40) throw new Error(tr('err.bad_addr_pad', { addr }));
  return `0x${'0'.repeat(24)}${clean}` as `0x${string}`;
}

export function toBech32(addr: string): string {
  return addr.startsWith('0x') ? hexToBech32(addr) : addr;
}

export function toHex(addr: string): `0x${string}` {
  return addr.startsWith('0x') ? (addr as `0x${string}`) : bech32ToHex(addr);
}
