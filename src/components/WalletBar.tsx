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
import { AlertTriangle, Wallet } from 'lucide-react';

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
  onConnect: () => void;
  onSwitch: () => void;
}

export function WalletBar({
  side,
  isConnected,
  isConnecting,
  isSwitching,
  hasProvider,
  isOnRightChain,
  loadError,
  onConnect,
  onSwitch,
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
    return (
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-xl border border-[#ECEFF3] bg-white px-3 py-2.5">
        <p className="flex-1 text-[12px] leading-snug text-gray-500">
          {/* 普通浏览器里根本没有钱包可连，这时提示「请连接钱包」是误导 —— 点了不会有反应 */}
          {hasProvider
            ? t('wallet.connect_hint')
            : t('wallet.no_provider')}
        </p>
        {hasProvider && (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-[12px] font-medium text-white active:bg-black disabled:opacity-50"
          >
            <Wallet className="h-3.5 w-3.5" />
            {isConnecting ? t('wallet.connecting') : t('wallet.connect')}
          </button>
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

  return null;
}
