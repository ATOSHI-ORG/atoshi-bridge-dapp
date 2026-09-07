import React, { useState } from 'react';
import {
  X,
  CheckCircle2,
  Clock,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Headphones,
  RotateCw,
} from 'lucide-react';
import { BridgeRecord } from '../types';
import { formatNumber, shortenAddress } from '../utils/bridgeValidation';
import { useI18n } from '../i18n';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: BridgeRecord | null;
  onOpenSupport: (recordId?: string) => void;
  onRetryBridgeIn?: (recordId: string) => void;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  record,
  onOpenSupport,
  onRetryBridgeIn,
}) => {
  const { t } = useI18n();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!isOpen || !record) return null;

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRetry = async () => {
    if (!onRetryBridgeIn || !record) return;
    setIsRetrying(true);
    await onRetryBridgeIn(record.id);
    setIsRetrying(false);
  };

  const isCompleted = record.status === 'completed';
  const isWaitingLiquidity = record.status === 'waiting_liquidity';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="transaction-status-dialog"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                isCompleted
                  ? 'bg-emerald-50 text-emerald-600'
                  : isWaitingLiquidity
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-black text-white'
              }`}
            >
              {isCompleted ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : isWaitingLiquidity ? (
                <Clock className="w-5 h-5 animate-pulse" />
              ) : (
                <RotateCw className="w-4 h-4 animate-spin" />
              )}
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {record.direction === 'out' ? t('tx_modal.title_out') : t('tx_modal.title_in')}
              </h3>
              <p className="text-xs text-gray-500 font-mono">
                {record.direction === 'out'
                  ? `${formatNumber(record.amount)} ATOS ➔ ${formatNumber(record.receivedAmount)} ERC20`
                  : `${formatNumber(record.amount)} ERC20 ➔ ${formatNumber(record.receivedAmount)} ATOS`}
              </p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-tx-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          {/* 状态总览卡片 */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between pb-2.5 border-b border-gray-200/60">
              <span className="text-gray-500">{t('tx_modal.status_label')}</span>
              <span
                className={`font-semibold px-2.5 py-0.5 rounded-full text-[11px] ${
                  isCompleted
                    ? 'bg-emerald-100 text-emerald-800'
                    : isWaitingLiquidity
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-black text-white'
                }`}
              >
                {isCompleted
                  ? t('tx_modal.status_completed')
                  : isWaitingLiquidity
                  ? t('tx_modal.status_waiting_liquidity')
                  : t('tx_modal.status_processing')}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2.5">
              <div>
                <div className="text-[11px] text-gray-400">{t('tx_modal.est_time')}</div>
                <div className="font-semibold text-gray-700 text-xs mt-0.5">
                  {record.estimatedTimeRange || t('tx.est_range')}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-gray-400">{t('tx_modal.init_time')}</div>
                <div className="font-mono text-gray-700 text-[11px] mt-0.5">
                  {new Date(record.createdAt).toLocaleTimeString()}
                </div>
              </div>
            </div>

            {/* 收款地址 */}
            <div className="mt-2.5 pt-2.5 border-t border-gray-200/60">
              <div className="text-[11px] text-gray-400">{t('tx_modal.recipient_addr')}</div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="font-mono text-gray-800 text-[11px] truncate max-w-[240px]">
                  {record.recipient}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(record.recipient, 'recipient')}
                  className="text-gray-400 hover:text-black p-1"
                >
                  {copiedKey === 'recipient' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* 四步状态机 Timeline */}
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-800 text-xs uppercase tracking-wide text-[11px]">
              {t('tx_modal.stepper_title')}
            </h4>

            <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
              {record.steps.map((step, idx) => {
                const isStepCompleted = step.status === 'completed';
                const isStepProcessing = step.status === 'processing';
                const isStepWaiting = step.status === 'waiting_liquidity';

                return (
                  <div key={step.id} className="relative group">
                    {/* 节点图标 */}
                    <div
                      className={`absolute -left-6 top-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ring-4 ring-white ${
                        isStepCompleted
                          ? 'bg-emerald-500 text-white'
                          : isStepProcessing
                          ? 'bg-black text-white animate-pulse'
                          : isStepWaiting
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isStepCompleted ? (
                        <Check className="w-3 h-3 stroke-[3]" />
                      ) : (
                        step.id
                      )}
                    </div>

                    {/* 步骤内容 */}
                    <div
                      className={`p-3 rounded-xl border transition-all ${
                        isStepProcessing
                          ? 'bg-gray-50 border-gray-300'
                          : isStepWaiting
                          ? 'bg-amber-50/60 border-amber-200'
                          : 'bg-white border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`font-bold text-xs ${
                            isStepCompleted
                              ? 'text-gray-900'
                              : isStepProcessing
                              ? 'text-black'
                              : isStepWaiting
                              ? 'text-amber-900'
                              : 'text-gray-400'
                          }`}
                        >
                          {step.nameKey ? t(step.nameKey) : step.name}
                        </span>
                        {step.timestamp && (
                          <span className="text-[10px] font-mono text-gray-400">
                            {new Date(step.timestamp).toLocaleTimeString()}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">
                        {step.descKey ? t(step.descKey) : step.description}
                      </p>

                      {/* 附加元数据 (Tx Hash / Hyperlane Message ID) */}
                      {step.txHash && (
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">{t('tx_modal.tx_hash_label')}</span>
                          <div className="flex items-center gap-1.5 font-mono text-gray-700">
                            <span>{shortenAddress(step.txHash, 8, 6)}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(step.txHash!, `tx_${step.id}`)}
                              className="text-gray-400 hover:text-black"
                            >
                              {copiedKey === `tx_${step.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            {step.explorerUrl && (
                              <a
                                href={step.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Hyperlane 消息 ID */}
                      {step.messageId && (
                        <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-[11px]">
                          <span className="text-gray-400">Hyperlane:</span>
                          <div className="flex items-center gap-1.5 font-mono text-gray-700">
                            <span>{shortenAddress(step.messageId, 8, 6)}</span>
                            <button
                              type="button"
                              onClick={() => handleCopy(step.messageId!, `msg_${step.id}`)}
                              className="text-gray-400 hover:text-black"
                            >
                              {copiedKey === `msg_${step.id}` ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                            {step.explorerUrl && (
                              <a
                                href={step.explorerUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:text-blue-700"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 等待流动性补充重试按钮 */}
                      {isStepWaiting && (
                        <div className="mt-2 pt-2 border-t border-amber-200/80 flex items-center justify-between">
                          <span className="text-[11px] text-amber-800 font-medium">
                            {t('tx_modal.queue_waiting_hint')}
                          </span>
                          <button
                            type="button"
                            onClick={handleRetry}
                            disabled={isRetrying}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium text-[11px] flex items-center gap-1 transition-colors"
                          >
                            <RotateCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                            <span>{t('tx_modal.check_retry_btn')}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center gap-2.5">
          <button
            type="button"
            id="btn-contact-support-tx"
            onClick={() => onOpenSupport(record.id)}
            className="flex-1 py-2.5 bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-medium rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors"
          >
            <Headphones className="w-3.5 h-3.5 text-gray-500" />
            <span>{t('tx_modal.contact_support')}</span>
          </button>
          <button
            type="button"
            id="btn-close-tx-status"
            onClick={onClose}
            className="flex-1 py-2.5 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition-colors"
          >
            {t('tx_modal.done_btn')}
          </button>
        </div>
      </div>
    </div>
  );
};

