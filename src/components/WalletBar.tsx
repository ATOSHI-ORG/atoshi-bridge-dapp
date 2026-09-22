/**
 * 钱包状态条。
 *
 * 桥比质押页多一层判断：**每个方向要求钱包在不同的链上** ——
 * 桥出要在 Atoshi，桥入要在以太坊。签错链不会报失败，只是发出一笔发在
 * 另一条链上的无意义交易，钱照样花掉，所以这里必须在签之前拦住。
 *
 * 四种状态，按优先级：
 *  1. 读取链上数据失败 → 红条显示原因（最高优先级，其它信息都不可信了）
 *  2. 未连接 → 连接按钮
 *  3. 连着但不在当前方向要的链上 → 橙条 + 一键切链
 *  4. 一切正常 → 什么都不显示
 */

import { useI18n } from '../i18n';
import { AlertTriangle, LogOut, Wallet } from 'lucide-react';

import type { BridgeSide } from '../wallet/useWallet';

interface WalletBarProps {
  /** 当前 UI 选的方向决定需要哪条链 */
  side: BridgeSide;
  isConnected: boolean;
  isConnecting: boolean;
  isSwitching: boolean;
  hasProvider: boolean;
  isOnRightChain: boolean;
  loadError?: string | null;
  /** 0x address of the connected account, for the disconnect row */
  address?: string;
  onConnect: () => void;
  onSwitch: () => void;
  onDisconnect: () => void;
}

export function WalletBar({
  side,
  isConnected,
  isConnecting,
  isSwitching,
  hasProvider,
  isOnRightChain,
  loadError,
  address,
  onConnect,
  onSwitch,
  onDisconnect,
}: WalletBarProps) {
  const { t } = useI18n();
  if (loadError) {
    return (
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="flex-1">
          <p className="text-[12px] font-medium text-red-700">{t('wallet.load_failed')}</p>
          <p className="mt-0.5 break-words text-[11px] leading-snug text-red-600">{loadError}</p>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    /*
      The button is rendered whether or not a provider was detected.

      It used to be hidden without one, on the reasoning that a dead button is
      worse than none. In practice the opposite happened: in a private window,
      where extensions are disabled unless explicitly allowed, the page offered
      no control at all and one line of text the user could not act on. Nothing
      said the wallet was merely switched off rather than missing.

      Detection is also not something to hide a control behind. Extensions
      inject window.ethereum asynchronously, so "not detected" can simply mean
      "not yet" -- see useHasProvider.

      So the button stays, and the hint below it says what to do when there is
      no provider.
    */
    return (
      <div className="mx-4 mt-3 rounded-xl border border-[#ECEFF3] bg-white px-3 py-2.5">
        <div className="flex items-center gap-3">
          <p className="flex-1 text-[12px] leading-snug text-gray-500">
            {hasProvider ? t('wallet.connect_hint') : t('wallet.no_provider')}
          </p>
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-[12px] font-medium text-white active:bg-black disabled:opacity-50"
          >
            <Wallet className="h-3.5 w-3.5" />
            {isConnecting ? t('wallet.connecting') : t('wallet.connect')}
          </button>
        </div>
        {!hasProvider && (
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
            {t('wallet.no_provider_help')}
          </p>
        )}
      </div>
    );
  }

  if (!isOnRightChain) {

    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="flex-1 text-[12px] leading-snug text-amber-800">
          {side === 'atoshi' ? t('wallet.wrong_chain_out') : t('wallet.wrong_chain_in')}
        </p>
        <button
          onClick={onSwitch}
          disabled={isSwitching}
          className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[12px] font-medium text-white active:bg-amber-700 disabled:opacity-50"
        >
          {isSwitching
            ? t('wallet.switching')
            : side === 'atoshi'
              ? t('wallet.switch_to_atoshi')
              : t('wallet.switch_to_eth')}
        </button>
      </div>
    );
  }

  /*
    Connected and on the right chain. This used to render nothing, which left no
    way to disconnect -- a real problem on a shared or public machine, and the
    staking app has had the control all along.

    Deliberately quiet: one line, the address, and the control. The bar's other
    states are warnings and should stay visually louder than this one.
  */
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-[#ECEFF3] bg-white px-3 py-2">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      <span className="flex-1 truncate font-mono text-[12px] text-gray-600">
        {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : t('wallet.connected')}
      </span>
      <button
        type="button"
        id="btn-wallet-disconnect"
        onClick={onDisconnect}
        className="flex shrink-0 items-center gap-1 rounded-lg border border-[#ECEFF3] px-2 py-1 text-[11px] font-medium text-gray-500 transition-colors hover:border-gray-300 hover:text-gray-800"
      >
        <LogOut className="h-3 w-3" />
        {t('wallet.disconnect')}
      </button>
    </div>
  );
}
