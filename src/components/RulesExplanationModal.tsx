import React from 'react';
import { X, Layers, DollarSign } from 'lucide-react';
import { BridgeLimits, BridgeParams } from '../types';
import { useI18n } from '../i18n';

interface RulesExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
  limits: BridgeLimits | null;
  params: BridgeParams | null;
}

export const RulesExplanationModal: React.FC<RulesExplanationModalProps> = ({
  isOpen,
  onClose,
  limits,
}) => {
  const { t, lang } = useI18n();
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="rules-explanation-dialog"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">{t('rules_modal.title')}</h3>
              <p className="text-xs text-gray-500">{t('rules_modal.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            id="btn-close-rules-modal"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-gray-600">
          {/* 固定锚定比 */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 flex items-start gap-3 text-gray-900">
            <DollarSign className="w-4 h-4 text-black shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-black text-xs">{t('rules_modal.rate_title')}</div>
              <div className="mt-0.5 text-[11px] text-gray-700 leading-relaxed">
                <strong className="font-mono">{t('rules_modal.rate_highlight')}</strong>. {t('rules_modal.rate_desc')}
              </div>
            </div>
          </div>

          {/* 5层规则列表 */}
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-800 text-xs tracking-wide uppercase text-[11px]">
              {t('rules_modal.section_title')}
            </h4>

            {/* 第1层 */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-black text-white text-[11px] font-bold inline-flex items-center justify-center">1</span>
                  {t('rules_modal.tier1_title')}
                </span>
                <span className="font-mono font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                  1,000 ATOS
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                {t('rules_modal.tier1_desc')}
              </p>
            </div>

            {/* 第2层 */}
            <div className={`border rounded-xl p-3 ${limits?.crisis_mode ? 'bg-amber-50 border-amber-300' : 'bg-gray-50 border-gray-200'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-[11px] font-bold inline-flex items-center justify-center">2</span>
                  {t('rules_modal.tier2_title')}
                </span>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${limits?.crisis_mode ? 'bg-amber-200 text-amber-900 font-semibold' : 'bg-gray-200 text-gray-700'}`}>
                  {limits?.crisis_mode ? (lang === 'zh' ? '🚨 当前已激活' : '🚨 Active Now') : t('rules_modal.tier2_tag')}
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                {t('rules_modal.tier2_desc')}
              </p>
            </div>

            {/* 第3层 */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-black text-white text-[11px] font-bold inline-flex items-center justify-center">3</span>
                  {t('rules_modal.tier3_title')}
                </span>
                <span className="font-mono font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                  5% Pool / Day
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                {t('rules_modal.tier3_desc')}
              </p>
            </div>

            {/* 第4层 */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-black text-white text-[11px] font-bold inline-flex items-center justify-center">4</span>
                  {t('rules_modal.tier4_title')}
                </span>
                <span className="font-mono font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                  20% Reserved
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                {t('rules_modal.tier4_desc')}
              </p>
            </div>

            {/* 第5层 */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-black text-white text-[11px] font-bold inline-flex items-center justify-center">5</span>
                  {t('rules_modal.tier5_title')}
                </span>
                <span className="font-mono font-bold text-gray-900 bg-white px-2 py-0.5 rounded border border-gray-200 text-[11px]">
                  2% Global Cap
                </span>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
                {t('rules_modal.tier5_desc')}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            id="btn-understand-rules"
            onClick={onClose}
            className="w-full py-2.5 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition-colors"
          >
            {t('rules_modal.close_btn')}
          </button>
        </div>
      </div>
    </div>
  );
};

