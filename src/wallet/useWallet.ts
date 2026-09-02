/**
 * 页面拿账户和链状态只用这一个 hook。
 *
 * 桥比质押页多一件事：**每个方向要求钱包在不同的链上**。
 * 桥出要在 Atoshi，桥入要在 Ethereum。签之前必须确认，签错链不会失败 ——
 * 只是发出一笔发在另一条链上的无意义交易，钱照样花掉。
 */

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';

import { ATOSHI_CHAIN_ID, ETH_CHAIN_ID, hexToBech32 } from './chains';

/**
 * 有没有注入的 EVM provider。只看 window.ethereum 存不存在，不嗅探是哪个钱包 ——
 * 各家的 isXxx 标志不可靠（Atoshi 自己的 provider 就把 isMetaMask 设成 true）。
 */
function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).ethereum);
}

/** 是不是 Atoshi 钱包自己的 WebView。只在这里面才自动连接。 */
function isAtoshiWebView(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean((window as any).ethereum?.isAtoshiWallet);
}

export type BridgeSide = 'atoshi' | 'ethereum';

export function useWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const [autoTried, setAutoTried] = useState(false);

  const injectedConnector = connectors.find((c) => c.id === 'injected' || c.type === 'injected');

  // 只在 Atoshi 钱包内自动连接 —— 用户已经在钱包里了，再点一次「连接钱包」是多余的。
  // 第三方钱包里不自动连：那属于「授权把地址给这个网站」，该由用户主动触发。
  useEffect(() => {
    if (autoTried || isConnected || isPending) return;
    if (!isAtoshiWebView() || !injectedConnector) return;
    connect({ connector: injectedConnector });
    setAutoTried(true);
  }, [autoTried, isConnected, isPending, injectedConnector, connect]);

  const bech32Address = useMemo(() => {
    if (!address) return '';
    try {
      return hexToBech32(address);
    } catch {
      return '';
    }
  }, [address]);

  const chainIdFor = (side: BridgeSide) => (side === 'atoshi' ? ATOSHI_CHAIN_ID : ETH_CHAIN_ID);

  return {
    /** 0x 地址：以太坊侧交易、Atoshi 侧 EVM 交易都用这个 */
    address,
    /** atoshi1… 地址：Cosmos REST 查询用 */
    bech32Address,
    isConnected,
    isConnecting: isPending,
    isSwitching,
    chainId,
    atoshiChainId: ATOSHI_CHAIN_ID,
    ethChainId: ETH_CHAIN_ID,
    hasProvider: hasInjectedProvider(),

    /** 当前这个方向需要的链，钱包连对了吗 */
    isOnChainFor: (side: BridgeSide) => isConnected && chainId === chainIdFor(side),
    switchTo: (side: BridgeSide) => switchChain({ chainId: chainIdFor(side) }),

    connect: () => {
      if (injectedConnector) connect({ connector: injectedConnector });
    },
  };
}
