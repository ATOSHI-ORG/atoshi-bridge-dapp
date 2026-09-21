import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, ChevronRight, HelpCircle, Flame, Info } from 'lucide-react';
import { BridgeLimits, BridgeParams } from '../types';
import { formatNumber } from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface QuotaPanelProps {
  limits: BridgeLimits | null;
  params: BridgeParams | null;
  inputAmount: number;
  highlightTier?: string;
  onOpenRulesModal: () => void;
}

export const QuotaPanel: React.FC<QuotaPanelProps> = ({
  limits,
  params,
  inputAmount,
  highlightTier,
  onOpenRulesModal,
}) => {
  const { t } = useI18n();
  const [timeLeft, setTimeLeft] = useState<string>('--:--:--');

  // 倒计时计算到每日重置时间
  useEffect(() => {
    if (!limits?.resets_at) return;

    const updateCountdown = () => {
      const diff = Math.max(0, limits.resets_at - Date.now());
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [limits?.resets_at]);

  if (!limits || !params) {
    return (
      <div id="quota-panel-loading" className="w-full bg-slate-50 border border-slate-200/80 rounded-2xl p-4 animate-pulse">
        <div className="h-4 bg-slate-200 rounded w-1/3 mb-3"></div>
        <div className="h-6 bg-slate-200 rounded w-1/2 mb-4"></div>
        <div className="space-y-2">
          <div className="h-3 bg-slate-200 rounded"></div>
          <div className="h-3 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  const isLargeInput = inputAmount > params.small_transfer_threshold;

  // 进度计算 (剩余 / 总量)
  const globalPercent = limits.global_total > 0
    ? Math.min(100, Math.max(0, (limits.global_remaining / limits.global_total) * 100))
    : 0;
  const largePercent = limits.large_total > 0
    ? Math.min(100, Math.max(0, (limits.large_remaining / limits.large_total) * 100))
    : 0;
  const addressPercent = limits.address_total > 0
    ? Math.min(100, Math.max(0, (limits.address_remaining / limits.address_total) * 100))
    : 0;

  /*
    链上把限流整个关掉了（bridgeadapter 的 rate_limits_disabled）。

    这时 limits 里的 cap / remaining 仍然是真实返回的数字 —— 参数原样留在链上，
    它们表示「如果开着会是多少」。照常画额度条会告诉用户「今日剩余 29.99 亿」，
    而根本没有人在执行这个限制：一个看起来精确、实际不存在的约束，比不显示更糟。

    所以这里整块换掉，只说明当前不限额。参数还在链上，治理一条提案就能开回来，
    届时这个面板自动恢复。
  */
  if (limits.rate_limits_disabled) {
    return (
      <div
        id="quota-panel"
        className="w-full bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-2"
      >
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <span>{t('quota.limits_off_title')}</span>
          <button
            type="button"
            id="btn-quota-rules-info"
            onClick={onOpenRulesModal}
            className="text-gray-400 hover:text-black transition-colors inline-flex items-center"
            title={t('quota.rules_btn')}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[11px] leading-relaxed text-gray-600">
          {t('quota.limits_off_desc')}
        </p>
      </div>
    );
  }

  return (
    <div
      id="quota-panel"
      className={`w-full bg-gray-50 rounded-xl p-4 border transition-all duration-200 space-y-4 ${
        limits.crisis_mode ? 'border-amber-300 ring-2 ring-amber-100 bg-amber-50/40' : 'border-gray-200'
      }`}
    >
      {/* 危机模式橙色紧急提示条 */}
      {/*
        正常情况下 DApp 从 BridgeOut 日志重建今日用量。浏览器索引暂时不可用时，
        *_remaining 只能降级为 *_total；这里必须说明当前显示的是上限，避免用户
        误以为额度仍是满的。
      */}
      {!limits.usage_available && (
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
          <p className="text-[11px] leading-snug text-blue-800">
            {t('quota.usage_unavailable')}
          </p>
        </div>
      )}

      {limits.crisis_mode && (
        <div
          id="crisis-mode-banner"
          className="flex items-start gap-2.5 bg-amber-100/80 border border-amber-300 rounded-lg p-3 text-amber-950 text-xs leading-relaxed"
        >
          <ShieldAlert className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold text-amber-900">{t('quota.crisis_title')} </span>
            {t('quota.crisis_desc')}
          </div>
        </div>
      )}

      {/* 核心第一行：当前可转上限 */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-200">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
            <span>{t('quota.max_transferable_label')}</span>
            <button
              type="button"
              id="btn-quota-rules-info"
              onClick={onOpenRulesModal}
              className="text-gray-400 hover:text-black transition-colors inline-flex items-center"
              title={t('quota.rules_btn')}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              id="quota-max-transferable"
              className={`text-xl font-bold font-mono tracking-tight ${
                limits.max_transferable > 0 ? 'text-black' : 'text-rose-600'
              }`}
            >
              {formatNumber(limits.max_transferable)}
            </span>
            <span className="text-xs font-semibold text-gray-500 font-mono">ATOS</span>
          </div>
        </div>

        {/* 重置倒计时 */}
        <div className="text-right">
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{t('quota.reset_countdown')}</div>
          <div className="text-xs font-mono font-bold text-gray-800 mt-0.5 bg-white border border-gray-200 px-2 py-0.5 rounded-md inline-block shadow-2xs">
            {timeLeft}
          </div>
        </div>
      </div>

      {/* 三行限流进度指示 */}
      <div className="space-y-3 text-xs">
        {/* 1. 全网今日额度 */}
        <div id="quota-tier-global" className="space-y-1.5">
          <div className="flex justify-between text-[10px] uppercase font-bold text-gray-400">
            <span className="flex items-center gap-1">
              {t('quota.tier_global')}
            </span>
            <span className="font-mono text-gray-700">
              {limits.usage_available ? (
                <>
                  <span className="font-bold text-black">{formatNumber(limits.global_remaining)}</span> / {formatNumber(limits.global_total)}
                </>
              ) : (
                <span className="font-bold text-black">{formatNumber(limits.global_total)}</span>
              )}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                globalPercent < 15 ? 'bg-rose-500' : globalPercent < 40 ? 'bg-amber-500' : 'bg-black'
              }`}
              style={{ width: `${globalPercent}%` }}
            />
          </div>
        </div>

        {/* 2. 大额额度剩余 (当本笔属于大额时高亮) */}
        <div
          id="quota-tier-large"
          className={`space-y-1.5 p-2 rounded-lg transition-all ${
            isLargeInput || highlightTier === 'large_quota' || highlightTier === 'crisis'
              ? 'bg-amber-100/60 border border-amber-300/80 -mx-2 px-2'
              : ''
          }`}
        >
          <div className="flex justify-between text-[10px] uppercase font-bold text-gray-400">
            <span className="flex items-center gap-1">
              <span>{t('quota.tier_large')}</span>
              {isLargeInput && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-black text-white">
                  <Flame className="w-2.5 h-2.5 text-amber-400" />
                  {t('quota.large_badge')}
                </span>
              )}
            </span>
            <span className="font-mono text-gray-700">
              {limits.crisis_mode ? (
                <span className="text-amber-800 font-bold">{t('quota.locked_crisis')}</span>
              ) : (
                <>
                  {limits.usage_available ? (
                    <>
                      <span className="font-bold text-black">{formatNumber(limits.large_remaining)}</span> / {formatNumber(limits.large_total)}
                    </>
                  ) : (
                    <span className="font-bold text-black">{formatNumber(limits.large_total)}</span>
                  )}
                </>
              )}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                limits.crisis_mode
                  ? 'bg-amber-400'
                  : largePercent < 15
                  ? 'bg-rose-500'
                  : largePercent < 40
                  ? 'bg-amber-500'
                  : 'bg-blue-600'
              }`}
              style={{ width: limits.crisis_mode ? '0%' : `${largePercent}%` }}
            />
          </div>
        </div>

        {/* 3. 个人今日额度 */}
        <div id="quota-tier-address" className="space-y-1.5">
          <div className="flex justify-between text-[10px] uppercase font-bold text-gray-400">
            <span>{t('quota.tier_address')}</span>
            <span className="font-mono text-gray-700">
              {limits.usage_available ? (
                <>
                  <span className="font-bold text-black">{formatNumber(limits.address_remaining)}</span> / {formatNumber(limits.address_total)}
                </>
              ) : (
                <span className="font-bold text-black">{formatNumber(limits.address_total)}</span>
              )}
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                addressPercent < 15 ? 'bg-rose-500' : 'bg-emerald-600'
              }`}
              style={{ width: `${addressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/*
        桥入额度。

        只在链上真的配置了才显示：cap 为 0 在链上的含义是「未配置 = 不限」，
        照着渲染会变成「剩余 0」，看起来像桥入被封了 —— 和事实正好相反。
      */}
      {limits.usage_available && limits.inbound_cap > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-gray-600">{t('quota.inbound_label')}</span>
            <span className="font-mono text-gray-800">
              <span className="font-bold text-black">{formatNumber(limits.inbound_remaining)}</span>
              {' / '}
              {formatNumber(limits.inbound_cap)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gray-800 transition-all"
              style={{
                width: `${Math.min(100, Math.max(0, (limits.inbound_remaining / limits.inbound_cap) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 底部硬性规则说明与细则按钮 */}
      <div className="pt-3 border-t border-gray-200 flex items-center justify-between text-[11px] text-gray-600">
        <div className="flex items-center gap-3">
          <div className="flex items-center">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full mr-1.5"></div>
            {t('quota.min_limit_tag')} <span className="font-mono font-bold text-black ml-1">1,000</span>
          </div>
        </div>

        <button
          type="button"
          id="btn-rules-breakdown"
          onClick={onOpenRulesModal}
          className="text-black hover:text-gray-600 font-bold inline-flex items-center gap-0.5 shrink-0"
        >
          <span>{t('quota.rules_btn')}</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};
