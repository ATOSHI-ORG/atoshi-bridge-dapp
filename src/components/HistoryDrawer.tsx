import React, { useState } from 'react';
import { X, History, ArrowUpRight, ArrowDownLeft, ChevronRight, Inbox } from 'lucide-react';
import { BridgeDirection, BridgeRecord } from '../types';
import { formatNumber, shortenAddress } from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  records: BridgeRecord[];
  onSelectRecord: (record: BridgeRecord) => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  records,
  onSelectRecord,
}) => {
  const { t } = useI18n();
  const [filterDirection, setFilterDirection] = useState<'all' | BridgeDirection>('all');

  if (!isOpen) return null;

  const filteredRecords = records.filter((r) => {
    if (filterDirection === 'all') return true;
    return r.direction === filterDirection;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="history-drawer-dialog"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">{t('history.title')}</h3>
              <p className="text-xs text-gray-500">{t('history.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-history-drawer"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Filters */}
        <div className="px-5 pt-3 pb-1 border-b border-gray-100 flex gap-2">
          <button
            type="button"
            onClick={() => setFilterDirection('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterDirection === 'all'
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('history.filter_all')} ({records.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterDirection('out')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterDirection === 'out'
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('history.filter_out')}
          </button>
          <button
            type="button"
            onClick={() => setFilterDirection('in')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              filterDirection === 'in'
                ? 'bg-black text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t('history.filter_in')}
          </button>
        </div>

        {/* Content List */}
        <div className="p-5 overflow-y-auto flex-1 space-y-2.5">
          {filteredRecords.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center mx-auto">
                <Inbox className="w-6 h-6" />
              </div>
              <div className="text-sm font-semibold text-gray-700">{t('history.empty_title')}</div>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                {t('history.empty_desc')}
              </p>
            </div>
          ) : (
            filteredRecords.map((item) => {
              const isOut = item.direction === 'out';
              const isCompleted = item.status === 'completed';
              const isWaiting = item.status === 'waiting_liquidity';

              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onSelectRecord(item);
                  }}
                  className="p-3.5 bg-white hover:bg-gray-50 border border-gray-200 hover:border-black rounded-xl transition-all cursor-pointer shadow-2xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isOut ? 'bg-black text-white' : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {isOut ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                    </div>

                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-gray-900">
                          {isOut ? t('history.item_out_label') : t('history.item_in_label')}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.2 rounded-md ${
                            isCompleted
                              ? 'bg-emerald-50 text-emerald-700'
                              : isWaiting
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-black text-white'
                          }`}
                        >
                          {isCompleted
                            ? t('tx_modal.status_completed')
                            : isWaiting
                            ? t('tx_modal.status_waiting_liquidity')
                            : `${t('tx_modal.status_processing')} (${item.currentStep}/${item.steps.length})`}
                        </span>
                      </div>

                      <div className="font-mono text-xs font-bold text-gray-900">
                        {isOut
                          ? `${formatNumber(item.amount)} ATOS ➔ ${formatNumber(item.receivedAmount)} ERC20`
                          : `${formatNumber(item.amount)} ERC20 ➔ ${formatNumber(item.receivedAmount)} ATOS`}
                      </div>

                      <div className="text-[10px] text-gray-400 font-mono">
                        {new Date(item.createdAt).toLocaleString()} · {t('tx_modal.recipient_addr')}: {shortenAddress(item.recipient, 6, 4)}
                      </div>
                    </div>
                  </div>

                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 ml-2" />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition-colors"
          >
            {t('history.back')}
          </button>
        </div>
      </div>
    </div>
  );
};

