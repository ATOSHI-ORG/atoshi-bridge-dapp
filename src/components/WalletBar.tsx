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
  if (loadError) {
    return (
      <div className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        <div className="flex-1">
          <p className="text-[12px] font-medium text-red-700">读取链上数据失败</p>
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
            ? '查看额度无需连接。发起跨链需要签名，请先连接钱包。'
            : '当前环境没有检测到钱包。请在 Atoshi 钱包内打开本页面。'}
        </p>
        {hasProvider && (
          <button
            onClick={onConnect}
            disabled={isConnecting}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#111827] px-3 py-1.5 text-[12px] font-medium text-white active:bg-black disabled:opacity-50"
          >
            <Wallet className="h-3.5 w-3.5" />
            {isConnecting ? '连接中…' : '连接钱包'}
          </button>
        )}
      </div>
    );
  }

  if (!isOnRightChain) {
    const need = side === 'atoshi' ? 'Atoshi' : '以太坊';
    return (
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
        <p className="flex-1 text-[12px] leading-snug text-amber-800">
          {side === 'atoshi' ? '桥出' : '桥入'}的交易发在 {need} 链上，钱包当前不在这条链。
        </p>
        <button
          onClick={onSwitch}
          disabled={isSwitching}
          className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1.5 text-[12px] font-medium text-white active:bg-amber-700 disabled:opacity-50"
        >
          {isSwitching ? '切换中…' : `切到 ${need}`}
        </button>
      </div>
    );
  }

  return null;
}
