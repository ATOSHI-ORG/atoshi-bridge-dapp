import React, { useEffect } from 'react';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, X } from 'lucide-react';
import type { BridgeRecord } from '../types';
import { useI18n } from '../i18n';
import { formatNumber } from '../utils/bridgeValidation';

interface ArrivalToastProps {
  record: BridgeRecord | null;
  onView: () => void;
  onDismiss: () => void;
}

/**
 * 到账提示。
 *
 * 为什么需要它：确认到账是异步的（轮询在 App 里跑，跟弹窗开不开无关），
 * 但在这之前**成功了也没人告诉用户** —— 关掉弹窗就只能自己去翻历史，
 * 而跨链要一分钟左右，没人会一直盯着那个弹窗。
 *
 * 只在页面开着的时候有效。真正的离开页面也能收到通知需要浏览器通知权限
 * 加 service worker，那是另一件事 —— 这里不假装能做到。
 */
export const ArrivalToast: React.FC<ArrivalToastProps> = ({ record, onView, onDismiss }) => {
  const { t } = useI18n();

  // 8 秒自动消失。不做「点任意处关闭」——用户可能正在填下一笔，
  // 误触把提示关掉就再也不知道刚才那笔成了。
  useEffect(() => {
    if (!record) return;
    const timer = setTimeout(onDismiss, 8000);
    return () => clearTimeout(timer);
  }, [record, onDismiss]);

  if (!record) return null;

  const isOut = record.direction === 'out';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm
                 bg-white border border-emerald-200 rounded-xl shadow-lg
                 animate-in slide-in-from-bottom-4 fade-in duration-200"
    >
      <div className="flex items-start gap-3 p-3.5">
        <div className="mt-0.5 shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-gray-900">{t('toast.arrived_title')}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-600 font-mono">
            {isOut ? (
              <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ArrowDownLeft className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">
              {formatNumber(record.receivedAmount)} {isOut ? 'ERC20 ATOS' : 'ATOS'}
            </span>
          </div>

          <button
            type="button"
            onClick={onView}
            className="mt-2 text-xs font-bold text-black underline underline-offset-2
                       hover:text-gray-700 transition-colors"
          >
            {t('toast.view_detail')}
          </button>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('toast.dismiss')}
          className="shrink-0 p-1 -m-1 text-gray-400 hover:text-gray-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
