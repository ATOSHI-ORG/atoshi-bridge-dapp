/**
 * wagmi 配置。两条链：Atoshi（桥出）和 Ethereum/Sepolia（桥入）。
 *
 * 只用 injected connector，不引 RainbowKit / MetaMask SDK / Coinbase SDK ——
 * 这个页面是钱包里的 DApp，用户从钱包内置浏览器打开，钱包直接注入
 * window.ethereum，不需要任何 SDK 去建连接。加上那些 connector 实测让打包
 * 涨十几倍（质押页那边量过：99 kB → 1420 kB gzip），移动端 WebView 里不划算。
 */

import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';

import { atoshi, ethChain } from './chains';

export const wagmiConfig = createConfig({
  chains: [atoshi, ethChain],
  connectors: [
    // shimDisconnect: 用户主动断开后记住这个选择，刷新不会又自动连上
    injected({ shimDisconnect: true }),
  ],
  transports: {
    [atoshi.id]: http(),
    [ethChain.id]: http(import.meta.env.VITE_ETH_RPC_URL as string | undefined),
  },
  ssr: false,
});
