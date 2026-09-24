/**
 * 页面拿账户和链状态只用这一个 hook。
 *
 * 桥比质押页多一件事：**每个方向要求钱包在不同的链上**。
 * 桥出要在 Atoshi，桥入要在 Ethereum。签之前必须确认，签错链不会失败 ——
 * 只是发出一笔发在另一条链上的无意义交易，钱照样花掉。
 */

import { useEffect, useMemo, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';

import { ATOSHI_CHAIN_ID, ETH_CHAIN_ID, bech32ToHex, hexToBech32 } from './chains';
import { cosmosAccountAddress, getCosmosProvider } from './cosmos';

/**
 * 有没有注入的 EVM provider。只看 window.ethereum 存不存在，不嗅探是哪个钱包 ——
 * 各家的 isXxx 标志不可靠（Atoshi 自己的 provider 就把 isMetaMask 设成 true）。
 */
function hasInjectedProvider(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).ethereum);
}

/**
 * Whether an injected provider exists, as REACTIVE state.
 *
 * Extensions inject window.ethereum asynchronously, and often after this app has
 * already mounted. Reading it once during render is a race: lose it and the
 * connect button never appears, on a machine where the wallet is installed and
 * working. Nothing re-renders to correct it either, because a plain function
 * call is not a subscription. This is what EIP-6963 exists to solve.
 *
 * Three signals, because no single one covers every wallet:
 *   - eip6963:announceProvider, which modern wallets emit on request
 *   - ethereum#initialized, MetaMask's older signal
 *   - a short poll, for wallets that emit neither and simply assign the global
 *
 * The poll stops as soon as a provider appears, and gives up after ~3s: past
 * that, no wallet is coming.
 */
function useHasProvider(): boolean {
  const [present, setPresent] = useState(hasInjectedProvider);

  useEffect(() => {
    if (present || typeof window === 'undefined') return;

    let stop = false;
    const found = () => {
      if (stop) return;
      if (hasInjectedProvider()) {
        stop = true;
        setPresent(true);
      }
    };

    window.addEventListener('eip6963:announceProvider', found);
    window.addEventListener('ethereum#initialized', found);
    // Asking is half of EIP-6963: wallets announce in response to this.
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    const timer = window.setInterval(found, 200);
    const giveUp = window.setTimeout(() => window.clearInterval(timer), 3000);

    return () => {
      stop = true;
      window.removeEventListener('eip6963:announceProvider', found);
      window.removeEventListener('ethereum#initialized', found);
      window.clearInterval(timer);
      window.clearTimeout(giveUp);
    };
  }, [present]);

  return present;
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
  const { disconnect } = useDisconnect();
  const [autoTried, setAutoTried] = useState(false);
  const [cosmosAddress, setCosmosAddress] = useState('');
  const [cosmosLoading, setCosmosLoading] = useState(false);
  const [cosmosAvailable, setCosmosAvailable] = useState(() => Boolean(getCosmosProvider()));
  const hasProvider = useHasProvider();

  const injectedConnector = connectors.find((c) => c.id === 'injected' || c.type === 'injected');

  useEffect(() => {
    if (cosmosAvailable || typeof window === 'undefined') return;
    const timer = window.setInterval(() => {
      if (getCosmosProvider()) {
        setCosmosAvailable(true);
        window.clearInterval(timer);
      }
    }, 200);
    return () => window.clearInterval(timer);
  }, [cosmosAvailable]);

  // 只在 Atoshi 钱包内自动连接 —— 用户已经在钱包里了，再点一次「连接钱包」是多余的。
  // 第三方钱包里不自动连：那属于「授权把地址给这个网站」，该由用户主动触发。
  useEffect(() => {
    if (autoTried || isConnected || isPending) return;
    if (!isAtoshiWebView() || !injectedConnector) return;
    connect({ connector: injectedConnector });
    setAutoTried(true);
  }, [autoTried, isConnected, isPending, injectedConnector, connect]);

  useEffect(() => {
    if (!cosmosAvailable || cosmosAddress || cosmosLoading) return;
    let cancelled = false;
    setCosmosLoading(true);
    cosmosAccountAddress()
      .then((next) => {
        if (!cancelled) setCosmosAddress(next);
      })
      .catch(() => {
        if (!cancelled) setCosmosAddress('');
      })
      .finally(() => {
        if (!cancelled) setCosmosLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cosmosAvailable, cosmosAddress, cosmosLoading]);

  const bech32Address = useMemo(() => {
    if (cosmosAddress) return cosmosAddress;
    if (!address) return '';
    try {
      return hexToBech32(address);
    } catch {
      return '';
    }
  }, [address, cosmosAddress]);

  const effectiveAddress = useMemo(() => {
    if (address) return address;
    if (!cosmosAddress) return undefined;
    try {
      return bech32ToHex(cosmosAddress);
    } catch {
      return undefined;
    }
  }, [address, cosmosAddress]);

  const chainIdFor = (side: BridgeSide) => (side === 'atoshi' ? ATOSHI_CHAIN_ID : ETH_CHAIN_ID);

  return {
    /** 0x 地址：以太坊侧交易、Atoshi 侧 EVM 交易都用这个 */
    address: effectiveAddress,
    /** atoshi1… 地址：Cosmos REST 查询用 */
    bech32Address,
    isConnected: isConnected || Boolean(cosmosAddress),
    isConnecting: isPending || cosmosLoading,
    isSwitching,
    chainId,
    atoshiChainId: ATOSHI_CHAIN_ID,
    ethChainId: ETH_CHAIN_ID,
    hasProvider: hasProvider || cosmosAvailable,

    /** 当前这个方向需要的链，钱包连对了吗 */
    isOnChainFor: (side: BridgeSide) =>
      side === 'atoshi'
        ? Boolean(cosmosAddress) || (isConnected && chainId === chainIdFor(side))
        : isConnected && chainId === chainIdFor(side),
    switchTo: (side: BridgeSide) => switchChain({ chainId: chainIdFor(side) }),

    connect: () => {
      if (injectedConnector) connect({ connector: injectedConnector });
      if (cosmosAvailable && !cosmosAddress) {
        setCosmosLoading(true);
        cosmosAccountAddress()
          .then(setCosmosAddress)
          .catch(() => setCosmosAddress(''))
          .finally(() => setCosmosLoading(false));
      }
    },

    /**
     * Disconnect. The injected connector is created with shimDisconnect, so
     * wagmi remembers the choice and does not silently reconnect on reload --
     * without that this button would look broken after a refresh.
     *
     * It does not revoke the site in the wallet itself; no extension API allows
     * that. A user who wants the authorisation gone has to remove the site in
     * their wallet, which is out of a page's reach.
     */
    disconnect: () => {
      disconnect();
      setCosmosAddress('');
    },
  };
}
