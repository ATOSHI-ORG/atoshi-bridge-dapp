import React from 'react';
import { History, Headphones } from 'lucide-react';
import { shortenAddress } from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface HeaderProps {
  currentAddress: string;
  /** 没连钱包时顶栏不能显示地址，也不能显示「已连接」的绿点。 */
  isConnected: boolean;
  balanceAtos: number;
  activeDirection: 'out' | 'in';
  onDirectionChange: (direction: 'out' | 'in') => void;
  onOpenHistory: () => void;
  onOpenFAQ: () => void;
  pendingCount: number;
  bridgeEnabled: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentAddress,
  isConnected,
  activeDirection,
  onDirectionChange,
  onOpenHistory,
  onOpenFAQ,
  pendingCount,
}) => {
  const { lang, setLang, t } = useI18n();

  return (
    <header className="bg-white border-b border-gray-100">
      {/* 顶部实用工具栏：钱包状态、语言切换、客服与历史 */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100/80 bg-gray-50/50">
        {/* 钱包连接状态 */}
        {/*
          未连接时显示「未连接」和一个灰点。
          原来这里无条件渲染地址 + 脉动的绿点，没连钱包也一样 —— 页面看起来
          像已经连上了某个账户，而那个地址其实是代码里的兜底值。
        */}
        <div className="flex items-center space-x-1.5 bg-white px-2.5 py-1 rounded-full border border-gray-200 shadow-2xs">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${
              isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'
            }`}
          ></div>
          <span
            className={`text-[11px] font-medium font-mono select-none ${
              isConnected ? 'text-gray-700' : 'text-gray-400'
            }`}
          >
            {isConnected ? shortenAddress(currentAddress, 6, 4) : t('header.not_connected')}
          </span>
        </div>

        {/* 右侧工具组：语言切换器 + 客服 + 历史 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 中英文平铺切换器 */}
          <div
            id="lang-switcher-container"
            className="inline-flex items-center bg-gray-200/80 p-0.5 rounded-full border border-gray-200/90 text-xs shrink-0"
          >
            <button
              type="button"
              id="btn-lang-en"
              onClick={() => setLang('en')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
                lang === 'en'
                  ? 'bg-black text-white shadow-xs'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              EN
            </button>
            <button
              type="button"
              id="btn-lang-zh"
              onClick={() => setLang('zh')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
                lang === 'zh'
                  ? 'bg-black text-white shadow-xs'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              中文
            </button>
          </div>

          {/* 客服帮助 */}
          <button
            type="button"
            id="btn-header-faq"
            onClick={onOpenFAQ}
            className="w-7 h-7 rounded-full bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 flex items-center justify-center transition-colors shrink-0 shadow-2xs"
            title={t('app.faq_tooltip')}
          >
            <Headphones className="w-3.5 h-3.5" />
          </button>

          {/* 历史记录 */}
          <button
            type="button"
            id="btn-header-history"
            onClick={onOpenHistory}
            className="w-7 h-7 rounded-full bg-white hover:bg-gray-100 text-gray-700 border border-gray-200 flex items-center justify-center transition-colors relative shrink-0 shadow-2xs"
            title={t('app.history_tooltip')}
          >
            <History className="w-3.5 h-3.5" />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-black text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
                {pendingCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* 品牌标题与网络信息 */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 bg-black rounded-xl flex items-center justify-center shrink-0 shadow-xs">
            <div className="w-3.5 h-3.5 border-2 border-white rotate-45"></div>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-gray-900 leading-none">
              {t('app.title')}
            </h1>
            <p className="text-[10px] text-gray-400 font-medium mt-1 font-mono">
              Atoshi Mainnet ⇄ Ethereum
            </p>
          </div>
        </div>

      </div>

      {/* 两个方向切换 Tabs */}
      <div className="flex border-t border-gray-100 px-3">
        <button
          type="button"
          id="tab-bridge-out"
          onClick={() => onDirectionChange('out')}
          className={`flex min-h-12 flex-1 items-center justify-center px-1 py-2 text-center text-xs font-semibold leading-tight transition-all border-b-2 sm:text-sm ${
            activeDirection === 'out'
              ? 'border-black text-black font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
        >
          {t('app.tab_bridge_out')}
        </button>

        <button
          type="button"
          id="tab-bridge-in"
          onClick={() => onDirectionChange('in')}
          className={`flex min-h-12 flex-1 items-center justify-center px-1 py-2 text-center text-xs font-semibold leading-tight transition-all border-b-2 sm:text-sm ${
            activeDirection === 'in'
              ? 'border-black text-black font-bold'
              : 'border-transparent text-gray-400 hover:text-gray-700'
          }`}
        >
          {t('app.tab_bridge_in')}
        </button>
      </div>
    </header>
  );
};

