import React, { useState } from 'react';
import { X, Headphones, MessageCircle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useI18n } from '../i18n';

interface FAQAndSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTxId?: string;
}

export const FAQAndSupportModal: React.FC<FAQAndSupportModalProps> = ({
  isOpen,
  onClose,
  selectedTxId,
}) => {
  const { t } = useI18n();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const faqs = [
    {
      q: t('faq.q1'),
      a: t('faq.a1'),
    },
    {
      q: t('faq.q2'),
      a: t('faq.a2'),
    },
    {
      q: t('faq.q3'),
      a: t('faq.a3'),
    },
    {
      q: t('faq.q4'),
      a: t('faq.a4'),
    },
  ];

  const handleCopySupportInfo = () => {
    const text = `【Atoshi Bridge Ticket】\nApp: Atoshi Wallet v3.8.0\nTxID: ${selectedTxId || 'N/A'}\nTime: ${new Date().toISOString()}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        id="faq-support-dialog"
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-black text-white flex items-center justify-center">
              <Headphones className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-900">{t('faq.title')}</h3>
              <p className="text-xs text-gray-500">{t('faq.subtitle')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 hover:text-black flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* 客服卡片 */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="font-bold text-gray-900 text-xs flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4 text-black" />
                <span>{t('faq.support_title')}</span>
              </div>
              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                {t('faq.support_online')}
              </span>
            </div>
            <p className="text-[11px] text-gray-600 mt-1.5 leading-relaxed">
              {t('faq.support_desc')}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                id="btn-copy-support-info"
                onClick={handleCopySupportInfo}
                className="flex-1 py-2 px-3 bg-white border border-gray-200 text-gray-800 hover:bg-gray-50 font-medium rounded-lg text-[11px] flex items-center justify-center gap-1.5 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? t('faq.support_copied') : t('faq.support_copy_btn')}</span>
              </button>
            </div>
          </div>

          {/* 常见问题 */}
          <div>
            <h4 className="font-semibold text-gray-800 text-xs uppercase tracking-wide text-[11px] mb-2.5">
              {t('faq.faq_section_title')}
            </h4>
            <div className="space-y-2">
              {faqs.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div
                    key={index}
                    className="border border-gray-200 rounded-xl overflow-hidden bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className="w-full p-3 text-left font-semibold text-xs text-gray-800 flex items-center justify-between hover:bg-gray-50 transition-colors"
                    >
                      <span>{faq.q}</span>
                      {isOpen ? (
                        <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                      )}
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 text-[11px] text-gray-600 leading-relaxed border-t border-gray-100 pt-2 bg-gray-50/50">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 bg-black hover:bg-gray-800 text-white font-bold rounded-xl text-xs transition-colors"
          >
            {t('faq.back_btn')}
          </button>
        </div>
      </div>
    </div>
  );
};

